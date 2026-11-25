import type { JobHandlers, JobQueue } from "@softzweig/suitcase-job-queue";
import { createNoopJobQueue } from "@softzweig/suitcase-job-queue";
import { createSuitcaseServerApi } from "./api/index.js";
import { createJobHandlers, type SuitcaseJobs } from "./jobs.js";
import type { SuitcaseRepositories } from "./repository.js";
import { AssetService, type AssetServiceContext } from "./services/asset.service.js";
import { ResourceService, type ResourceServiceContext } from "./services/resource.service.js";
import { UploadService, type UploadServiceContext } from "./services/upload.service.js";
import { UsageService } from "./services/usage.service.js";
import type { AnyDefinition, InferDefinitionSuppliedContext } from "./suitcase.js";
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
  readonly createJobQueue?: (handlers: JobHandlers<SuitcaseJobs>) => JobQueue<SuitcaseJobs>;
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
  const {
    repositories,
    transaction,
    createUploadKey = defaultUploadKey,
    createJobQueue = () => createNoopJobQueue<SuitcaseJobs>(),
  } = adapters;

  const context = Object.freeze({
    definition,
    assetRepo: repositories.assets,
    resourceRepo: repositories.resources,
    uploadSessionRepo: repositories.uploadSessions,
    isInTransaction: false,
  });

  // Built before the services, which enqueue into it. The handlers resolve the assets service
  // lazily, because it can only be built once the queue it enqueues into exists.
  const jobs = createJobQueue(createJobHandlers({ assets: () => assets }));
  const assets = new AssetService<AssetServiceContext<TDefinition>>(
    { ...context, jobs },
    transaction,
  );
  const resources = new ResourceService<TDefinition, ResourceServiceContext<TDefinition>>(
    { ...context, assetService: assets },
    transaction,
  );
  const uploads = new UploadService<TDefinition, UploadServiceContext<TDefinition>>(
    { ...context, assetService: assets, resourceService: resources, createUploadKey },
    transaction,
  );
  const usage = new UsageService<TDefinition>(
    { ...context, resourceService: resources },
    transaction,
  );

  /**
   * The handle a transport binds once per request: the context it was given is closed over, so
   * nothing below this line has to carry it, and the services stay unreachable from the facade.
   */
  const forExecution = (context: InferDefinitionSuppliedContext<TDefinition>) =>
    createSuitcaseServerApi(definition, context, { uploads, assets, resources, usage });

  return { definition, assets, resources, uploads, usage, jobs, forExecution };
}
