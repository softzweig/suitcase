import { createDrizzleAdapters, type DrizzleDatabase } from "@softzweig/spindle-drizzle";
import type { ServerAdapters } from "@softzweig/suitcase-server";
import { createPostgresRepositories } from "./repositories.js";

/**
 * Adapters for a Postgres database:
 *
 * ```ts
 * const server = createSuitcaseServer(definition, createPostgresServerAdapters(db));
 * ```
 */
export function createPostgresServerAdapters(db: DrizzleDatabase): ServerAdapters {
  const repositories = createPostgresRepositories(db);

  // The runner rebinds the repositories under the keys it is given, so they have to be the keys
  // the server's context reads. Spreading `repositories` itself would bind `assets` and leave
  // `assetRepo` pointing at the root connection.
  const { transaction } = createDrizzleAdapters(db, {
    assetRepo: repositories.assets,
    resourceRepo: repositories.resources,
    uploadSessionRepo: repositories.uploadSessions,
  });

  return { repositories, transaction };
}
