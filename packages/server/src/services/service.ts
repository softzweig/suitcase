import type { SpindleFailure } from "@softzweig/spindle-core/result";
import type { ServiceContext } from "@softzweig/spindle-core/service";
import type {
  AssetRepository,
  ResourceRepository,
  UploadSessionRepository,
} from "../repository.js";
import type { Definition } from "../suitcase.js";

/**
 * What a Suitcase service works with: the repositories of its backend, the definition it serves,
 * and whatever a subclass adds on top.
 *
 * Built on `ServiceContext` from `@softzweig/spindle-core`, so a context that holds another
 * service is checked to expose executions, and a context member that is neither service,
 * repository nor plain data is refused.
 *
 * @example
 * ```ts
 * import { Service } from "@softzweig/spindle-core/service";
 *
 * type AssetServiceContext = SuitcaseServiceContext & { resourceService: ResourceService };
 *
 * class AssetService extends Service<AssetServiceContext> {
 *   describeAsset(id: string) {
 *     return this.prepare(async (ctx) => ctx.assetRepo.findById(id));
 *   }
 * }
 * ```
 *
 * @human
 */
export type SuitcaseServiceContext<TDefinition extends Definition = Definition> = ServiceContext<{
  assetRepo: AssetRepository;
  resourceRepo: ResourceRepository;
  uploadSessionRepo: UploadSessionRepository;
}> & {
  definition: TDefinition;

  /**
   * How a thrown error becomes a failure. Suitcase supplies the storage vocabulary here, so a
   * backend failure reaches a caller with the same codes its domain failures use.
   */
  toServiceFailure: (error: unknown) => SpindleFailure;
};
