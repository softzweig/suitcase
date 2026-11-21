import type { SuitcaseClient } from "@softzweig/suitcase-client";
import type {
  ClientDefinition,
  ClientResolveClaims,
  ResourceDownload,
} from "@softzweig/suitcase-core/contracts";
import { useEffect, useMemo, useState } from "react";
import stringify from "safe-stable-stringify";
import { resourceBatcherFor } from "./resource-batcher.js";

/** What resolving one or more ids reports. */
export type ResolveResourcesState =
  | { phase: "idle" | "loading"; entries?: never; error?: never }
  | { phase: "resolved"; entries: readonly ResourceDownload[]; error?: never }
  | { phase: "failed"; error?: Error; entries?: never };

/** A call as the resolve hooks take it: no kind, one kind, or many kinds before the input. */
export function readCall<TInput extends { readonly contexts?: unknown }>(
  kindOrInput: unknown,
  maybeInput: TInput | undefined,
): { readonly claims: ClientResolveClaims<ClientDefinition>; readonly input: TInput } {
  const kind =
    typeof kindOrInput === "string" || Array.isArray(kindOrInput) ? kindOrInput : undefined;
  const input = (kind === undefined ? kindOrInput : maybeInput) as TInput;

  // A bare context is wrapped under the one kind it was given for; a record of them goes as it came.
  return {
    claims:
      typeof kind === "string" && input.contexts !== undefined
        ? { [kind]: input.contexts }
        : ((input.contexts ?? {}) as ClientResolveClaims<ClientDefinition>),
    input,
  };
}

/**
 * The body both resolve hooks share: ids asked under one claim set, through the client's batcher.
 *
 * Hooks asking with equal claims in the same tick share a single backend call, since the batcher
 * groups a window by the claims each lookup was made with. Claims are compared by their stable
 * serialisation, so they have to be plain data.
 *
 * @human
 */
export function useResolveEntries<TDefinition extends ClientDefinition>(
  client: SuitcaseClient<TDefinition>,
  claims: ClientResolveClaims<ClientDefinition>,
  ids: readonly string[],
): ResolveResourcesState {
  // One batcher per client, kept for the life of that client: it groups a window, it caches nothing.
  const batcher = useMemo(() => resourceBatcherFor(client), [client]);
  const [state, setState] = useState<ResolveResourcesState>({ phase: "idle" });

  // biome-ignore lint/correctness/useExhaustiveDependencies: compare claims and ids by value
  useEffect(() => {
    let cancelled = false;
    setState({ phase: "loading" });

    Promise.all(ids.map((id) => batcher.fetch({ claims, id })))
      .then((entries) => {
        if (cancelled) return;

        setState({ entries: entries.filter((entry) => !!entry), phase: "resolved" });
      })
      .catch((error: unknown) => {
        if (cancelled) return;

        setState({
          phase: "failed",
          error: error instanceof Error ? error : new Error(String(error)),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [batcher, stringify(claims), ids.join(",")]);

  return state;
}
