import type { SuitcaseClient } from "@softzweig/suitcase-client";
import type {
  ClientDefinition,
  ClientResolveClaims,
  ClientResourceKind,
  ResourceDownload,
} from "@softzweig/suitcase-core/contracts";
import type { DeclaredField } from "@softzweig/suitcase-core/utils";
import { readCall, useResolveEntries } from "./use-resolve-entries.js";

export type ResolveResourceState =
  | { phase: "idle" | "loading"; entry?: never; error?: never }
  | { phase: "resolved"; entry?: ResourceDownload; error?: never }
  | { phase: "failed"; error?: Error; entry?: never };

export type ResolveResourcePhase = ResolveResourceState["phase"];

/** The id to resolve, plus one context per kind, keyed by kind. */
export interface ResolveResourceInput<TDefinition extends ClientDefinition> {
  readonly contexts?: ClientResolveClaims<TDefinition>;
  readonly id: string;
}

/** The id to resolve, plus the context of the one kind named. */
export type ResolveResourceKindInput<
  TDefinition extends ClientDefinition,
  TKind extends ClientResourceKind<TDefinition>,
> = { readonly id: string } & DeclaredField<"contexts", TDefinition["resources"][TKind]["read"]>;

/**
 * Resolves one id under the contexts given, and reports its entry. It takes the same call shapes
 * {@link useResolveResources} does, one id at a time.
 */
export function useResolveResource<TDefinition extends ClientDefinition>(
  client: SuitcaseClient<TDefinition>,
  input: ResolveResourceInput<TDefinition>,
): ResolveResourceState;
export function useResolveResource<
  TDefinition extends ClientDefinition,
  TKind extends ClientResourceKind<TDefinition>,
>(
  client: SuitcaseClient<TDefinition>,
  kind: TKind,
  input: ResolveResourceKindInput<TDefinition, TKind>,
): ResolveResourceState;
export function useResolveResource<TDefinition extends ClientDefinition>(
  client: SuitcaseClient<TDefinition>,
  kinds: readonly ClientResourceKind<TDefinition>[],
  input: ResolveResourceInput<TDefinition>,
): ResolveResourceState;
export function useResolveResource<TDefinition extends ClientDefinition>(
  client: SuitcaseClient<TDefinition>,
  kindOrInput: unknown,
  maybeInput?: { readonly contexts?: unknown; readonly id: string },
): ResolveResourceState {
  const { claims, input } = readCall<{
    readonly contexts?: unknown;
    readonly id: string;
  }>(kindOrInput, maybeInput);

  const state = useResolveEntries(client, claims, [input.id]);

  if (state.phase !== "resolved") return state;

  return { entry: state.entries[0], phase: "resolved" };
}
