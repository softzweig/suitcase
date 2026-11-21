import type { SuitcaseClient } from "@softzweig/suitcase-client";
import type {
  ClientDefinition,
  ClientResolveClaims,
  ClientResourceKind,
} from "@softzweig/suitcase-core/contracts";
import type { DeclaredField } from "@softzweig/suitcase-core/utils";
import { type ResolveResourcesState, readCall, useResolveEntries } from "./use-resolve-entries.js";

export type { ResolveResourcesState };

export type ResolveResourcesPhase = ResolveResourcesState["phase"];

/** The ids to resolve, plus one context per kind, keyed by kind. */
export interface ResolveResourcesInput<TDefinition extends ClientDefinition> {
  readonly contexts?: ClientResolveClaims<TDefinition>;
  readonly ids: readonly string[];
}

/** The ids to resolve, plus the context of the one kind named. */
export type ResolveResourcesKindInput<
  TDefinition extends ClientDefinition,
  TKind extends ClientResourceKind<TDefinition>,
> = { readonly ids: readonly string[] } & DeclaredField<
  "contexts",
  TDefinition["resources"][TKind]["read"]
>;

/**
 * Resolves the ids under the contexts given, and reports one entry per id in the order asked.
 *
 * The kind is optional and only types the contexts: left out, they are keyed by kind; named once,
 * its context is taken bare. Hooks asking with equal contexts in the same tick share a single call.
 */
export function useResolveResources<TDefinition extends ClientDefinition>(
  client: SuitcaseClient<TDefinition>,
  input: ResolveResourcesInput<TDefinition>,
): ResolveResourcesState;
export function useResolveResources<
  TDefinition extends ClientDefinition,
  TKind extends ClientResourceKind<TDefinition>,
>(
  client: SuitcaseClient<TDefinition>,
  kind: TKind,
  input: ResolveResourcesKindInput<TDefinition, TKind>,
): ResolveResourcesState;
export function useResolveResources<TDefinition extends ClientDefinition>(
  client: SuitcaseClient<TDefinition>,
  kinds: readonly ClientResourceKind<TDefinition>[],
  input: ResolveResourcesInput<TDefinition>,
): ResolveResourcesState;
export function useResolveResources<TDefinition extends ClientDefinition>(
  client: SuitcaseClient<TDefinition>,
  kindOrInput: unknown,
  maybeInput?: { readonly contexts?: unknown; readonly ids: readonly string[] },
): ResolveResourcesState {
  const { claims, input } = readCall<{
    readonly contexts?: unknown;
    readonly ids: readonly string[];
  }>(kindOrInput, maybeInput);

  return useResolveEntries(client, claims, input.ids);
}
