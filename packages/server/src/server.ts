import { createSuitcaseServerApi } from "./api/index.js";
import type { SuitcaseRepositories } from "./repository.js";
import { AssetService, type AssetServiceContext } from "./services/asset.service.js";
import { ResourceService, type ResourceServiceContext } from "./services/resource.service.js";
import { UploadService, type UploadServiceContext } from "./services/upload.service.js";
import type { AnyDefinition, InferDefinitionExecutionContext } from "./suitcase.js";
import type { TransactionalContext } from "./transactional.js";

/**
 * A transaction scope as the services consume it: the runner opens one, hands the services a
 * context bound to it, and commits, rolls back or releases a savepoint around the callback.
 */
export type SuitcaseTransactionRunner = <TContext extends TransactionalContext, TResult>(
  context: TContext,
  work: (context: TContext) => Promise<TResult>,
) => Promise<TResult>;

/**
 * What a server needs from its backend. Everything a definition deliberately cannot carry, so a
 * definition stays data and a deployment can swap any of it.
 */
export interface ServerAdapters {
  readonly repositories: SuitcaseRepositories;
  readonly transaction: SuitcaseTransactionRunner;
  /** The key an upload is stored under in the upload bucket. Defaults to `uploads/<id>`. */
  readonly createUploadKey?: (uploadId: string) => string | Promise<string>;
}

const defaultUploadKey = (uploadId: string) => `uploads/${uploadId}`;

/**
 * Wires a definition's services into one cohesive server API.
 *
 * The services are typed off the definition, so `kind`, owner payloads, intents and read claims
 * stay inferred for whoever calls them; the adapters are consumed here and never leak out.
 *
 * @example
 * ```ts
 * const server = createSuitcaseServer(definition, { repositories, transaction });
 * await server.uploads.initialize({ execution, kind: "userAvatar", claims });
 * ```
 */
export function createSuitcaseServer<TDefinition extends AnyDefinition>(
  definition: TDefinition,
  adapters: ServerAdapters,
) {
  const { repositories, transaction, createUploadKey = defaultUploadKey } = adapters;

  const context = Object.freeze({
    definition,
    assetRepo: repositories.assets,
    resourceRepo: repositories.resources,
    uploadSessionRepo: repositories.uploadSessions,
    isInTransaction: false,
  });

  const assets = new AssetService<AssetServiceContext<TDefinition>>(context, transaction);
  const resources = new ResourceService<TDefinition, ResourceServiceContext<TDefinition>>(
    { ...context, assetService: assets },
    transaction,
  );
  const uploads = new UploadService<TDefinition, UploadServiceContext<TDefinition>>(
    { ...context, assetService: assets, resourceService: resources, createUploadKey },
    transaction,
  );

  /**
   * The handle a transport binds once per request: `execution` is closed over, so nothing below
   * this line has to carry it, and the services themselves stay unreachable from the facade.
   */
  const forExecution = (execution: InferDefinitionExecutionContext<TDefinition>) =>
    createSuitcaseServerApi(definition, execution, { uploads, assets, resources });

  return { definition, assets, resources, uploads, forExecution };
}
