# Postgres bindings

- `schema.ts` — `pg-core` tables for `Asset`, `Resource` and `UploadSession`.
- `repositories.ts` — generic `PostgresRepository` and `createPostgresRepositories(db)`.

```ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createPostgresRepositories } from "@softzweig/suitcase-drizzle";

const db = drizzle(new Pool({ connectionString: process.env.DATABASE_URL }));
const { assets, resources } = createPostgresRepositories(db);

await assets.findById(id);
await resources.patch(id, { label: "Avatar" });

await assets.transaction(async (context) => {
  await resources.withContext(context).patch(resourceId, { label: "Avatar" });
});
```

DTOs match the table rows, so a repository only needs its table: columns and
mappers are derived. Everything else comes from the base classes.

## Notes

- Timestamps are `text`. Store one canonical ISO-8601 form
  (`2026-01-01T00:00:00.000Z`); mixed forms break `created_at` ordering and expiry sweeps.
- `owner`, `target` and `metadata` are `jsonb`.
- Index names are left to drizzle.

| Table             | Index                                       | For                      |
| ----------------- | ------------------------------------------- | ------------------------ |
| `assets`          | unique `(bucket, hash_hex, hash_algorithm)` | content lookup           |
| `assets`          | unique `(bucket, key)`                      | object location          |
| `resources`       | `(asset_id)`                                | per-asset lookups        |
| `resources`       | GIN `(owner jsonb_path_ops)`                | owner containment (`@>`) |
| `resources`       | `(created_at DESC)`                         | newest-first lists       |
| `upload_sessions` | `(expires_at)` where status ≠ completed     | expiry sweeps            |
| `upload_sessions` | unique `(resource_id)`                      | one session per resource |

`jsonb_path_ops` is smaller than the default GIN op class and only indexes `@>`,
which is exactly how owner listings query. The expiry index is partial because
completed sessions never expire.
