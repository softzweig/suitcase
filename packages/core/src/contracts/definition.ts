type ResourceConfig = Record<"read" | "uploadIntent" | "owner", unknown> & {
  usage?: unknown;
  uploadMetadata?: unknown;
};
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
  /** Whether the kind reports its owner's storage usage. Omitted means it does not. */
  readonly usage?: TConfig["usage"];
  readonly uploadIntent: TConfig["uploadIntent"];
  /** The metadata the kind accepts. Use `never` when it accepts none. */
  readonly uploadMetadata: TConfig["uploadMetadata"];
}
