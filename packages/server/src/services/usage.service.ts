import { SpindleErrorCode } from "@softzweig/spindle-core/result";
import {
  Service,
  ServiceError,
  type ServiceExecutionContract,
} from "@softzweig/spindle-core/service";
import { type ResourceOwner, UploadStatus } from "@softzweig/suitcase-core";
import type { SuitcaseKindUsage, SuitcaseTotalUsage } from "@softzweig/suitcase-core/contracts";
import type {
  Definition,
  InferDefinitionExecutionContext,
  InferDefinitionUsageKinds,
  ResourceTransactionContext,
  SchemaOutput,
} from "../suitcase.js";
import { findDefinitionResource } from "../suitcase.js";
import { ResourceAction } from "./resource.authorizers.js";
import type { ResourceService } from "./resource.service.js";
import type { SuitcaseServiceContext } from "./service.js";

export type UsageServiceContext<TDefinition extends Definition = Definition> =
  SuitcaseServiceContext<TDefinition> & {
    /** Carried so the owner authorizer sees the transaction view it expects. */
    resourceService: ResourceService<TDefinition>;
  };

/** One kind to count: the execution it runs as, the kind, and the owner it is about. */
export type UsageKindQuery<TDefinition extends Definition = Definition> = Readonly<{
  execution: InferDefinitionExecutionContext<TDefinition>;
  kind: InferDefinitionUsageKinds<TDefinition>;
  owner: ResourceOwner;
}>;

/**
 * What an owner holds, counted where the bytes live: a resource counts its asset, an upload session
 * the bytes it reserves.
 *
 * The owner is named by the caller, because it cannot be derived the way an upload derives it:
 * `ownedBy` may read the upload's intent, and a query carries none. Naming one is still a request
 * rather than a permission: the owner's schema validates it, and its `authorize` answers for
 * `action: "usage"`, the same hook and the same membership check its mutations use.
 *
 * One kind is {@link usageOfKind}; {@link usage} is the same query over several, authorized and
 * counted one at a time, because two kinds may have different owners. Both tables are filtered by
 * the same `kind` and `owner`, which is what a cache keys on later.
 */
export class UsageService<
    TDefinition extends Definition = Definition,
    TCtx extends UsageServiceContext<TDefinition> = UsageServiceContext<TDefinition>,
  >
  extends Service<TCtx>
  implements ServiceExecutionContract<UsageService<TDefinition, TCtx>>
{
  /**
   * What one owner holds for one kind: the query {@link usage} adds up.
   *
   * Resolves the kind, validates the owner against its schema, asks the owner's `authorize` for
   * `action: "usage"` and counts both tables.
   */
  usageOfKind(query: UsageKindQuery<TCtx["definition"]>) {
    return this.count(query);
  }

  /**
   * What one owner holds across the kinds it names, added up.
   *
   * Every kind is authorized and counted on its own: two kinds may have different owners, and one
   * verdict for another kind's owner says nothing about this one.
   */
  usage<const TKinds extends readonly InferDefinitionUsageKinds<TCtx["definition"]>[]>({
    execution,
    kinds,
    owner,
  }: Readonly<{
    execution: InferDefinitionExecutionContext<TCtx["definition"]>;
    kinds: TKinds;
    owner: ResourceOwner;
  }>) {
    return this.prepare(async (): Promise<SuitcaseTotalUsage> => {
      ServiceError.assertValidInput(kinds.length > 0, "A usage query needs a kind", { kinds });

      // One at a time: each count opens its own scope for the two tables, and those do not take
      // kindly to being opened concurrently on the same connection.
      const perKind: SuitcaseKindUsage[] = [];
      for (const kind of new Set(kinds)) {
        perKind.push(await this.count({ execution, kind, owner }).unwrap());
      }

      const summed = perKind.reduce(
        (total, entry) => ({
          resourceCount: total.resourceCount + entry.resources.resourceCount,
          resourceSize: total.resourceSize + entry.resources.size,
          uploadCount: total.uploadCount + entry.uploads.uploadCount,
          uploadSize: total.uploadSize + entry.uploads.size,
        }),
        { resourceCount: 0, resourceSize: 0, uploadCount: 0, uploadSize: 0 },
      );

      return {
        scope: "total",
        resourceCount: summed.resourceCount,
        uploadCount: summed.uploadCount,
        size: summed.resourceSize + summed.uploadSize,
      };
    });
  }

  /** Resolves one kind, authorizes its owner and counts both tables. */
  private count({ execution, kind, owner }: UsageKindQuery<TCtx["definition"]>) {
    return this.prepare(async (ctx): Promise<SuitcaseKindUsage> => {
      const definition = findDefinitionResource(ctx.definition.resources, kind);
      ServiceError.assert(
        definition,
        "Resource definition not found",
        { kind },
        SpindleErrorCode.NOT_FOUND,
      );

      // Reporting the owner's storage is a capability of the definition, so a kind whose owner does
      // not opt in answers as if it did not exist.
      const { owner: ownerDefinition } = definition;
      ServiceError.assertFound(ownerDefinition.usage, "Resource kind does not report usage", {
        kind,
      });

      // The owner is an open record on the wire; its schema turns it into the owner its hook judges,
      // the same way an update or a delete is checked.
      const parsed = ownerDefinition.schema.safeParse(owner);
      ServiceError.assert(
        parsed.success,
        "Resource owner does not match the owner schema",
        { kind },
        SpindleErrorCode.INVALID_INPUT,
      );

      // Erased, like every definition hook: the schema typed it before it got here.
      const subject = parsed.data as SchemaOutput<typeof ownerDefinition.schema>;

      ServiceError.assertPermitted(
        await ownerDefinition.authorize({
          action: ResourceAction.USAGE,
          execution,
          owner: subject,
          transaction: this.hookTransaction(ctx),
        }),
        { kind, owner },
      );

      // The stored kind is the definition's, which an explicit alias may have set.
      const filter = { kind: definition.kind ?? kind, owner: subject };

      // Only the two counts share a scope: they have to describe the same moment, and nothing else
      // here reads anything.
      const [resources, uploads] = await this.transaction((scoped) =>
        Promise.all([
          scoped.resourceRepo.aggregateUsage(filter),
          scoped.uploadSessionRepo.aggregateUsage({
            ...filter,
            // A completed session's bytes are the resource's by now, so only what is still in
            // flight is reserved on top of it. Counting in processing is quite important especially
            // to have people concurrently within their usage quotas (if usage is used for limits).
            status: [UploadStatus.PENDING, UploadStatus.PROCESSING],
          }),
        ]),
      );

      return { resources, uploads };
    });
  }

  /**
   * The transaction view a definition's hooks receive. Their contract erases it to its loosest
   * shape, while this service's own context is the same repositories plus the resource service.
   */
  private hookTransaction(ctx: Readonly<TCtx>): ResourceTransactionContext {
    return { ...ctx } as unknown as ResourceTransactionContext;
  }
}
