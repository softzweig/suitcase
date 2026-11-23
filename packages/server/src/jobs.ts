import type { JobHandlers } from "@softzweig/suitcase-job-queue";
import type { AssetService, AssetServiceContext } from "./services/asset.service.js";
import type { AnyDefinition } from "./suitcase.js";

/**
 * The background work a Suitcase server schedules, keyed by job name.
 *
 * The names are stable strings because another process may be the one that runs them: a worker
 * outside this server, or a queue's own dashboard. Renaming one is a deployment concern.
 *
 * @human
 */
export type SuitcaseJobs = {
  /**
   * Removes a marked asset's bytes and its row, unless something still needs them.
   *
   * Queued by the resource service once a delete has committed.
   *
   * @see {@link AssetService.purge}
   */
  "assets.purge": { readonly assetId: string };
};

/**
 * Binds the jobs to the services that carry them out: what the server defines is what a queue
 * outside it receives, so the queue only has to know how to run a handler.
 */
export const createJobHandlers = <TDefinition extends AnyDefinition>(services: {
  /**
   * Resolved when a job runs, not when the handlers are bound: the queue is built before the
   * services are, because they enqueue into it.
   */
  readonly assets: () => AssetService<AssetServiceContext<TDefinition>>;
}): JobHandlers<SuitcaseJobs> => ({
  "assets.purge": async ({ assetId }) => {
    // Finding nothing to do is a success: the asset was revived, is still shared, or is gone.
    await services.assets().purge({ assetId }).unwrap();
  },
});
