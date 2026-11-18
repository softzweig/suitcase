import type { ServerAdapters } from "@softzweig/suitcase-server";
import type { DrizzleDatabase } from "../repository.js";
import { createDrizzleAdapters } from "../server.js";
import { createPostgresRepositories } from "./repositories.js";

/**
 * Adapters for a Postgres database:
 *
 * ```ts
 * const server = createSuitcaseServer(definition, createPostgresServerAdapters(db));
 * ```
 */
export const createPostgresServerAdapters = (db: DrizzleDatabase): ServerAdapters =>
  createDrizzleAdapters(db, createPostgresRepositories(db));
