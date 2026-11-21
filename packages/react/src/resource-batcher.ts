import type { SuitcaseClient } from "@softzweig/suitcase-client";
import type {
  ClientDefinition,
  ClientResolveClaims,
  ResourceDownload,
} from "@softzweig/suitcase-core/contracts";
import { create, windowedFiniteBatchScheduler } from "@yornaath/batshit";
import stringify from "safe-stable-stringify";

export type ResourceQuery = Readonly<{
  claims: ClientResolveClaims<ClientDefinition>;
  id: string;
}>;

export type ResourceBatcher = ReturnType<typeof createResourceBatcher>;

export type ResourceBatcherOptions = Readonly<{
  windowMs: number;
  maxBatchSize: number;
}>;

export const DEFAULT_RESOURCE_BATCHER_OPTIONS = Object.freeze<ResourceBatcherOptions>({
  windowMs: 25,
  maxBatchSize: 50,
});

const batchers = new WeakMap<object, ResourceBatcher>();

/**
 * The batcher for one client, so every hook asking with it shares the same windows.
 *
 * A batcher belongs to the client rather than to a provider, because the resolve hooks take the
 * client explicitly and can be used without one.
 */
export function resourceBatcherFor<TDefinition extends ClientDefinition>(
  client: SuitcaseClient<TDefinition>,
): ResourceBatcher {
  const existing = batchers.get(client);

  if (existing) return existing;

  const created = createResourceBatcher(client as SuitcaseClient); // <- widened, as the hook does
  batchers.set(client, created);

  return created;
}

/**
 * Turns single-id lookups into one resolve call per window, and one per claim set inside it: a call
 * carries a single claim set, so queries are grouped by the claims they were asked with.
 */
export function createResourceBatcher(
  client: SuitcaseClient,
  { windowMs, maxBatchSize } = DEFAULT_RESOURCE_BATCHER_OPTIONS,
) {
  return create({
    fetcher: async (queries: ResourceQuery[]) => {
      const groups = new Map<
        string,
        { claims: ClientResolveClaims<ClientDefinition>; ids: Set<string> }
      >();

      // Since claims determine the grouping, we stringify them to use as a key in the map.
      // Thus we use the stringified claims as the key to group queries with the same claims
      // together (kind of like a "sub"-batching) ~vz
      for (const { claims, id } of queries) {
        const key = stringify(claims);
        const group = groups.get(key) ?? { claims, ids: new Set<string>() };
        group.ids.add(id);
        groups.set(key, group);
      }

      const batches = await Promise.all(
        [...groups.values()].map(({ claims, ids }) =>
          client.resources.resolve({ claims, requestedIds: [...ids] }),
        ),
      );

      return batches.flat();
    },
    resolver: (entries: readonly ResourceDownload[], { id }: ResourceQuery) =>
      entries.find((entry) => entry.id === id),
    scheduler: windowedFiniteBatchScheduler({ windowMs, maxBatchSize }),
  });
}
