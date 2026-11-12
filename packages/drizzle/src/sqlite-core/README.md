# SQLite bindings

Same entities and API as `pg-core`, with SQLite column types.

- `schema.ts` — `sqlite-core` tables for `Asset`, `Resource` and `UploadSession`.
- `repositories.ts` — generic `SqliteRepository` and `createSqliteRepositories(db)`.

```ts
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { createSqliteRepositories } from "@softzweig/suitcase-drizzle/sqlite-core";

const db = drizzle(new Database("suitcase.db"));
const { assets, resources } = createSqliteRepositories(db);

await assets.findById(id);
await resources.patch(id, { label: "Avatar" });
```

DTOs match the table rows, so a repository only needs its table. The only
difference from `PostgresRepository` is the `SQLiteTable` constraint.

## Differences from Postgres

- Ids are `text`; SQLite has no uuid type.
- JSON columns are `text` in drizzle's json mode (serialized on write, parsed on read).
- Index names are explicit, because drizzle's SQLite helpers require one.
- One ascending `created_at` index serves newest-first too; SQLite scans btrees both ways.
- Owner listings are unindexed: there is no containment index. Add an expression index
  over `json_extract(owner, '$.<key>')` once the lookup key is fixed.
