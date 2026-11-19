type ResourceConfig = Record<"read" | "uploadIntent" | "owner", unknown>;
type ResourceMap = Record<string, ClientResourceDefinition>;

/**
 * Resource-centric client definition for Suitcase.
 *
 * We use this to have clients do type-safe interactions with any Suitcase backend.
 * This kind of mirrors some types we define more thoroughly in the server package, which
 * is on purpose. Clients need not to know the full server-side implementation details,
 * even if it's just types.
 *
 * @human
 */
export interface ClientDefinition<TResources extends ResourceMap = ResourceMap> {
  readonly resources: TResources;
}

export interface ClientResourceDefinition<TConfig extends ResourceConfig = ResourceConfig> {
  readonly owner: TConfig["owner"];
  readonly read: TConfig["read"];
  readonly uploadIntent: TConfig["uploadIntent"];
}
