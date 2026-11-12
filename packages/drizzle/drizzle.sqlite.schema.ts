// Drizzle-kit discovers tables through named exports, which the public `tables`
// object deliberately hides. This file exists only for drizzle-kit.
import { tables } from "./src/sqlite-core/schema.js";

export const { assets, resources, uploadSessions } = tables;
