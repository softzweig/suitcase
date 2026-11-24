import type { ServiceOperations } from "@softzweig/suitcase-core/contracts";
import type { AssetService, AssetServiceContext } from "../services/asset.service.js";
import type { ResourceService, ResourceServiceContext } from "../services/resource.service.js";
import type { UploadService } from "../services/upload.service.js";
import type {
  AnyDefinition,
  InferDefinitionExecutionContext,
  InferDefinitionSuppliedContext,
} from "../suitcase.js";
import { SuitcaseAssets } from "./assets.js";
import { SuitcaseResources } from "./resources.js";
import { SuitcaseUploads } from "./uploads.js";

export * from "./assets.js";
export * from "./resources.js";
export * from "./uploads.js";

export interface SuitcaseServerApi<TDefinition extends AnyDefinition> {
  readonly definition: TDefinition;
  readonly execution: InferDefinitionExecutionContext<TDefinition>;
  /** The same endpoints as one call per operation: what a transport binds, whatever it speaks. */
  readonly operations: ServiceOperations;
  readonly uploads: SuitcaseUploads<TDefinition>;
  readonly assets: SuitcaseAssets<TDefinition>;
  readonly resources: SuitcaseResources<TDefinition>;
}

/**
 * The api as one call per operation. The two casts are where the wire is looser than the typed api:
 * claims and intent belong to the definition, and `update` calls its patch `delta`.
 */
const apiOperations = <TDefinition extends AnyDefinition>(
  resources: SuitcaseResources<TDefinition>,
  uploads: SuitcaseUploads<TDefinition>,
): ServiceOperations => ({
  "resources.delete": (input) => resources.delete(input),
  "resources.resolve": (input) =>
    resources.resolve(input as Parameters<typeof resources.resolve>[0]),
  "resources.update": (input) => resources.update({ delta: input }),
  "uploads.constraints": (input) => ({ data: uploads.constraints(input.kind), ok: true }),
  "uploads.finalize": (input) => uploads.finalize(input),
  "uploads.initialize": (input) =>
    uploads.initialize(input as Parameters<typeof uploads.initialize>[0]),
});

export const createSuitcaseServerApi = <TDefinition extends AnyDefinition>(
  definition: TDefinition,
  context: InferDefinitionSuppliedContext<TDefinition>,
  services: Readonly<{
    uploads: UploadService<TDefinition>;
    assets: AssetService<AssetServiceContext<TDefinition>>;
    resources: ResourceService<TDefinition, ResourceServiceContext<TDefinition>>;
  }>,
): SuitcaseServerApi<TDefinition> => {
  // What the hooks receive: the caller's context plus the buckets they are deciding about, added
  // here so no caller has to repeat what the definition already holds.
  const execution = {
    ...context,
    buckets: definition.buckets,
  } as InferDefinitionExecutionContext<TDefinition>;

  const uploads = new SuitcaseUploads(definition, services.uploads, execution);
  const resources = new SuitcaseResources(services.resources, execution);

  return {
    definition,
    execution,
    operations: apiOperations(resources, uploads),
    uploads,
    assets: new SuitcaseAssets(services.assets),
    resources,
  };
};
