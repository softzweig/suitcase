import type { SuitcaseClient } from "@softzweig/suitcase-client";
import type { ClientDefinition } from "@softzweig/suitcase-core/contracts";
import { useCallback } from "react";
import { useSuitcaseClient } from "./suitcase-context.js";
import { type MutationState, useResourceMutation } from "./use-resource-mutation.js";

/** The resource the backend removed, which is what a delete answers with. */
export type DeletedResource<TDefinition extends ClientDefinition> = Awaited<
  ReturnType<SuitcaseClient<TDefinition>["resources"]["delete"]>
>;

/** The two phases this hook adds to `idle` and `failed`. */
const DELETE_PHASES = { done: "deleted", running: "deleting" } as const;

export type DeleteResourceState<TDefinition extends ClientDefinition = ClientDefinition> =
  MutationState<DeletedResource<TDefinition>, "deleting", "deleted">;

export type DeleteResourcePhase = DeleteResourceState["phase"];

export type DeleteResourceHandlers<TDefinition extends ClientDefinition> =
  DeleteResourceState<TDefinition> & {
    /** Removes one resource by id, settling with the row that went, or `undefined` on failure. */
    remove(resourceId: string): Promise<DeletedResource<TDefinition> | undefined>;
    reset(): void;
  };

/**
 * Deletes one resource by id and reports where the latest call got to; a failure is state, not a
 * throw.
 *
 * The row is gone for good once the backend agrees: a resource has no deleted marker, and the
 * asset behind it is marked and purged out of band, so a later resolve of the same id answers
 * `not_found`. Whether this caller may delete it is the kind's owner authorizer's decision.
 *
 * Each call settles with its own resource while the state follows the most recent one, so a burst
 * of deletions does not blur together, and a reset takes the state back to `idle` even if a call
 * is still on its way.
 */
export function useDeleteResource<
  TDefinition extends ClientDefinition = ClientDefinition,
>(): DeleteResourceHandlers<TDefinition> {
  const client = useSuitcaseClient<TDefinition>();
  const mutate = useCallback(
    (resourceId: string) => client.resources.delete({ resourceId }),
    [client],
  );
  const { state, run, reset } = useResourceMutation({ mutate, phases: DELETE_PHASES });

  return { ...state, remove: run, reset };
}
