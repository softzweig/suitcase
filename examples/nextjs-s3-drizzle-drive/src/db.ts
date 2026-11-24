import { createClient } from "@libsql/client";
import { createSqliteServerAdapters } from "@softzweig/suitcase-drizzle/sqlite-core";
import type { ServerAdapters } from "@softzweig/suitcase-server";
import { drizzle } from "drizzle-orm/libsql";
import { DATABASE_URL, ensureDataFolder } from "./paths";

/** Dev reloads the module graph, so the connection is kept on the global object. */
const cached = globalThis as typeof globalThis & { galleryAdapters?: ServerAdapters };

function connect(): ServerAdapters {
  ensureDataFolder();
  return createSqliteServerAdapters(drizzle(createClient({ url: DATABASE_URL })));
}

if (!cached.galleryAdapters) {
  cached.galleryAdapters = connect();
}

export const adapters = cached.galleryAdapters;
