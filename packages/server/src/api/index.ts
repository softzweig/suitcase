import type { AssetService, AssetServiceContext } from "../services/asset.service.js";
import type { ResourceService, ResourceServiceContext } from "../services/resource.service.js";
import type { UploadService } from "../services/upload.service.js";
import type { AnyDefinition, InferDefinitionExecutionContext } from "../suitcase.js";
import { SuitcaseAssets } from "./assets.js";
import { SuitcaseResources } from "./resources.js";
import { SuitcaseUploads } from "./uploads.js";

export * from "./assets.js";
export * from "./resources.js";
export * from "./uploads.js";

export interface SuitcaseServerApi<TDefinition extends AnyDefinition> {
  readonly definition: TDefinition;
  readonly execution: InferDefinitionExecutionContext<TDefinition>;
  readonly uploads: SuitcaseUploads<TDefinition>;
  readonly assets: SuitcaseAssets<TDefinition>;
  readonly resources: SuitcaseResources<TDefinition>;
}

export const createSuitcaseServerApi = <TDefinition extends AnyDefinition>(
  definition: TDefinition,
  execution: InferDefinitionExecutionContext<TDefinition>,
  services: Readonly<{
    uploads: UploadService<TDefinition>;
    assets: AssetService<AssetServiceContext<TDefinition>>;
    resources: ResourceService<TDefinition, ResourceServiceContext<TDefinition>>;
  }>,
): SuitcaseServerApi<TDefinition> => ({
  definition,
  execution,
  uploads: new SuitcaseUploads(definition, services.uploads, execution),
  assets: new SuitcaseAssets(services.assets),
  resources: new SuitcaseResources(services.resources, execution),
});
