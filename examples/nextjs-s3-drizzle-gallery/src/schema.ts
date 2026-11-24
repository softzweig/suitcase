/**
 * The tables Suitcase stores: the package owns them, and drizzle-kit needs them as named exports
 * to push the schema.
 */
import { tables } from "@softzweig/suitcase-drizzle/sqlite-core";

export const { assets, resources, uploadSessions } = tables;
