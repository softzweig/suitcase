import type {
  ClientDefinition,
  ClientOperations,
  ClientResourceKind,
} from "@softzweig/suitcase-core/contracts";
import {
  startUpload,
  type UploadDependencies,
  type UploadStart,
  type UploadStartResult,
} from "./upload.js";

/**
 * The client a consumer calls: the operations that stand on their own, the workflows built over
 * the ones that do not, and the whole wire underneath both.
 *
 * `resolve`, `update` and `delete` are one call each, so they are exposed as they are. Uploading is
 * not one call: it checks limits, claims the file, maybe sends bytes and finalizes, so a caller
 * gets `upload.start` instead of the session operations it runs.
 *
 * `operations` is the surface the transport was bound to, `initialize` and `finalize` included.
 * Reaching through it means running your own flow, and with it the session lifetime becomes yours
 * to finish: one left open is expired by the backend, not by this client.
 *
 * The asset operations are absent for a different reason: a resource's link already comes back
 * from `resolve`, and asking by asset id would authorize off the asset rather than off the
 * resource read that proved the caller may see it. `assets.delete` has no authorizer at all.
 *
 * Everything the client cannot know on its own is passed in rather than read from a global:
 * `digest` hashes the file and `transfer` moves the bytes, because a package that does not assume
 * `crypto.subtle` or `fetch` exist cannot reach for them itself.
 */
export interface SuitcaseClient<TDefinition extends ClientDefinition = ClientDefinition> {
  /** Every operation, exactly as the transport serves them, session operations included. */
  readonly operations: ClientOperations<TDefinition>;

  /** The `resources` namespace: the very same calls as `operations.resources`. */
  readonly resources: ClientOperations<TDefinition>["resources"];

  readonly upload: {
    /** What a kind enforces, so limits can be shown before a file is even picked. */
    readonly constraints: ClientOperations<TDefinition>["uploads"]["constraints"];

    /**
     * Uploads one file as the given kind, checking the kind's limits before anything is claimed
     * and letting the backend reuse bytes it already stores.
     *
     * Configured `processors` see the file first, and what they return is what gets claimed and
     * checked, so a processor may shrink a file into range or change its type.
     *
     * @see {@link startUpload} for the order of the steps and how a `signal` cancels them.
     */
    start<TKind extends ClientResourceKind<TDefinition>>(
      input: UploadStart<TDefinition, TKind>,
    ): Promise<UploadStartResult>;
  };
}

/**
 * Builds the client on top of the operations.
 *
 * @example
 * ```ts
 * const operations = createSuitcaseOperations<MyDefinition>({ transport });
 * const client = createSuitcaseClient({ operations, digest: sha256, transfer: putToS3 });
 *
 * const limits = await client.upload.constraints({ kind: "avatar" });
 * const { resource, reused } = await client.upload.start({ kind: "avatar", file });
 * ```
 */
export const createSuitcaseClient = <TDefinition extends ClientDefinition = ClientDefinition>(
  dependencies: UploadDependencies<TDefinition>,
): SuitcaseClient<TDefinition> => ({
  operations: dependencies.operations,
  resources: dependencies.operations.resources,
  upload: {
    constraints: dependencies.operations.uploads.constraints,
    start: (input) => startUpload(input, dependencies),
  },
});
