import type { ServerAdapters } from "@softzweig/suitcase-server";
import type { DrizzleDatabase } from "../repository.js";
import { createDrizzleAdapters } from "../server.js";
import { createSqliteRepositories } from "./repositories.js";

/**
 * Adapters for a SQLite database:
 *
 * ```ts
 * const server = createSuitcaseServer(definition, createSqliteServerAdapters(db));
 * ```
 */
export const createSqliteServerAdapters = (db: DrizzleDatabase): ServerAdapters =>
  createDrizzleAdapters(db, createSqliteRepositories(db));
