import type { SuitcaseClient } from "@softzweig/suitcase-client";
import type { ClientDefinition } from "@softzweig/suitcase-core/contracts";
import { useCallback } from "react";
import { useSuitcaseClient } from "./suitcase-context.js";
import { type MutationState, useResourceMutation } from "./use-resource-mutation.js";

/** What an update carries, as the client takes it: the id plus the fields that may change. */
export type UpdateResourceInput<TDefinition extends ClientDefinition> = Parameters<
  SuitcaseClient<TDefinition>["resources"]["update"]
>[0];

/** The resource as the backend stored it, which is what an update answers with. */
export type UpdatedResource<TDefinition extends ClientDefinition> = Awaited<
  ReturnType<SuitcaseClient<TDefinition>["resources"]["update"]>
>;

/** The two phases this hook adds to `idle` and `failed`. */
const UPDATE_PHASES = { done: "updated", running: "updating" } as const;

export type UpdateResourceState<TDefinition extends ClientDefinition = ClientDefinition> =
  MutationState<UpdatedResource<TDefinition>, "updating", "updated">;

export type UpdateResourcePhase = UpdateResourceState["phase"];

export type UpdateResourceHandlers<TDefinition extends ClientDefinition> =
  UpdateResourceState<TDefinition> & {
    /** Settles with the stored resource, or `undefined` when the update failed. */
    update(
      input: UpdateResourceInput<TDefinition>,
    ): Promise<UpdatedResource<TDefinition> | undefined>;
    reset(): void;
  };

/**
 * Updates one resource's label or metadata and reports where the latest call got to; a failure is
 * state, not a throw.
 *
 * Only `label` and `metadata` travel: the id, kind, owner and asset of a resource are what every
 * later authorization is keyed on. Whether this caller may change the row at all is the kind's
 * owner authorizer's decision, so a refusal arrives as `phase: "failed"` with the service's error.
 *
 * Each call settles with its own resource while the state follows the most recent one, and a reset
 * takes the state back to `idle` even if a call is still on its way.
 */
export function useUpdateResource<
  TDefinition extends ClientDefinition = ClientDefinition,
>(): UpdateResourceHandlers<TDefinition> {
  const client = useSuitcaseClient<TDefinition>();
  const mutate = useCallback(
    (input: UpdateResourceInput<TDefinition>) => client.resources.update(input),
    [client],
  );
  const { state, run, reset } = useResourceMutation({ mutate, phases: UPDATE_PHASES });

  return { ...state, reset, update: run };
}
