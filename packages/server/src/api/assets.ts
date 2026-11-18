import type {
  AssetDeleteInput,
  AssetDownloadUrlInput,
  AssetService,
  AssetServiceContext,
} from "../services/asset.service.js";
import type { AnyDefinition } from "../suitcase.js";

/**
 * The asset endpoints. Unlike the others these take no execution context: a download link is
 * decided by the resource read authorization that produced the resource, not by who asks again.
 *
 * Methods return the service's result unchanged: await it for a `ServiceResult` to branch on,
 * or `unwrap()` it to throw at the edge.
 */
export class SuitcaseAssets<TDefinition extends AnyDefinition> {
  constructor(private readonly service: AssetService<AssetServiceContext<TDefinition>>) {}

  /**
   * Creates the download link for a stored asset: a signed URL for a private bucket, the public
   * URL for a public one, with a private bucket falling back to a signed URL when an object has
   * no public address.
   *
   * @see {@link AssetService.createDownloadUrl}
   * @human
   */
  createDownloadUrl(input: AssetDownloadUrlInput) {
    return this.service.createDownloadUrl(input);
  }

  /**
   * Deletes an asset, and **every resource that points at it**. The cascade is explicit, not a
   * database constraint, because the repository contract guarantees no cascades. The stored object
   * goes first (removal is idempotent, so a retry is safe), then all of the asset's resources, then
   * the asset row itself, in one transaction.
   *
   * @important Nothing on this path authorizes the cascade: the resource kinds' owner authorizers
   * are not consulted, so removing an asset also removes resources nobody sanctioned removing. A
   * transport must authorize this itself before calling it.
   *
   * @see {@link AssetService.delete}
   * @human
   */
  delete(input: AssetDeleteInput) {
    return this.service.delete(input);
  }
}
