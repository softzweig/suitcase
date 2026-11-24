import { mkdirSync } from "node:fs";
import path from "node:path";

/** Everything the example writes: the sqlite file and the stored objects. */
export const DATA = path.join(process.cwd(), ".data");

export const DATABASE_URL = process.env.DATABASE_URL ?? `file:${path.join(DATA, "gallery.db")}`;

/** The sqlite file cannot be opened before its directory exists, and drizzle-kit will not make it. */
export const ensureDataFolder = () => mkdirSync(DATA, { recursive: true });
