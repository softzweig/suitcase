---

title: Persistence
description: Repository ports, Drizzle adapters, transactions, and migrations.
---

The server needs three repositories and a transaction runner. Suitcase ships with Drizzle adapters
for Postgres and SQLite, and the repository port is small enough to implement for anything else.

## What the server needs

```ts
interface ServerAdapters {
  repositories: {
    assets: AssetRepository;
    resources: ResourceRepository;
    uploadSessions: UploadSessionRepository;
  };
  transaction: SuitcaseTransactionRunner;
  createUploadKey?: (uploadId: string) => string | Promise<string>;
  createJobQueue?: (handlers) => JobQueue<SuitcaseJobs>;
}
```

`createUploadKey` defaults to `uploads/<uploadId>`. `createJobQueue` defaults to a no-op queue, which
means deletions mark assets but never purge bytes. See [Background jobs](/suitcase/guides/jobs/).

## Drizzle

```ts
import { createClient } from "@libsql/client";
import { createSqliteServerAdapters } from "@softzweig/suitcase-drizzle/sqlite-core";
import { drizzle } from "drizzle-orm/libsql";

const db = drizzle(createClient({ url: "file:./suitcase.db" }));

const server = createSuitcaseServer(definition, createSqliteServerAdapters(db));
```

For Postgres, use `createPostgresServerAdapters` from `@softzweig/suitcase-drizzle/pg-core`. Both
take a `DrizzleDatabase`, a structural port rather than a concrete drizzle type, so any drizzle
driver that supports `returning()` works.

The adapter provides the three repositories, their transaction runner, and the upload key naming.
The definition stays data.

## Migrations

The package ships committed migrations for both dialects:

```text
packages/drizzle/migrations/pg
packages/drizzle/migrations/sqlite
```

Apply them with your migration tool of choice, or use `drizzle-kit push` in development. The repo
generates migrations with `pnpm db:generate`; the generator discovers every `drizzle.*.config.ts`,
runs each config, and exits non-zero if any fails.

## Custom repositories

If you use Drizzle with a table shape of your own, extend `AbstractDrizzleRepository` and supply the
table, two mappers, and the id filter:

```ts
import { AbstractDrizzleRepository } from "@softzweig/suitcase-drizzle";

class AssetRepository extends AbstractDrizzleRepository<Asset, typeof assets, AssetFilter> {
  protected readonly table = assets;

  protected toDto(row: AssetRow): Asset {
    return { id: row.id, key: row.key, size: row.size /* ... */ };
  }

  protected toRow(dto: Partial<Omit<Asset, "id">>): Partial<AssetRow> {
    return { key: dto.key, size: dto.size /* ... */ };
  }

  protected idFilter(ids: string[]): AssetFilter {
    return { id: ids };
  }
}
```

The base class builds `findOne`, `findById`, `findByIds`, `patch`, `delete`, and `transaction` on top
of `findMany`, `insert`, `patchWhere`, and `deleteWhere`. The column map for filters is derived from
the table, so it needs no separate declaration.

If you do not use Drizzle, implement the same repository methods directly. Keep the identity rules:
ids are generated once, updates replace whole fields, and filters match stored values.

## Filters

Filter keys are DTO property names. A scalar becomes `=`, an array becomes `in (...)`, and an unknown
property throws a `TypeError` instead of silently widening the query.

## Transactions

`transaction` runs a callback against copies of the repositories bound to the transaction handle:

```ts
await assets.transaction(async (context) => {
  await resources.withContext(context).patch(resourceId, { label: "Avatar" });
});
```

`context.isTransactional` is `true`, and `context.db` is the transaction handle. `withContext` is how
a second repository joins the same transaction.

A service operation commits or fails as one unit. Authorization that fails after a write causes a
rollback, so a refused mutation leaves no partial row behind.
