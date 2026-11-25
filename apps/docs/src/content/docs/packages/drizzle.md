---

title: drizzle
description: Postgres and SQLite repositories for the server.
---

`@softzweig/suitcase-drizzle` provides the repositories and transaction runner the server needs,
backed by Drizzle. It is dialect-agnostic: the base class targets a small structural
`DrizzleDatabase` port, not a concrete driver type.

## Server adapters

```ts
import { createSqliteServerAdapters } from "@softzweig/suitcase-drizzle/sqlite-core";

const server = createSuitcaseServer(definition, createSqliteServerAdapters(db));
```

```ts
import { createPostgresServerAdapters } from "@softzweig/suitcase-drizzle/pg-core";

const server = createSuitcaseServer(definition, createPostgresServerAdapters(db));
```

Both return `ServerAdapters`: the three repositories, a transaction runner, and the upload key
strategy. Writes require a driver that supports `returning()`.

## Tables and migrations

Both dialects ship a schema and committed migrations:

```text
packages/drizzle/src/pg-core/schema.ts
packages/drizzle/src/sqlite-core/schema.ts
packages/drizzle/migrations/pg
packages/drizzle/migrations/sqlite
```

Apply the migrations with your own tool, or use `drizzle-kit push` in development.

## Custom repositories

Extend `AbstractDrizzleRepository` and supply the table, two mappers, and the id filter:

```ts
class AssetRepository extends AbstractDrizzleRepository<Asset, typeof assets, AssetFilter> {
  protected readonly table = assets;
  protected toDto(row: AssetRow): Asset {
    // row -> domain
  }
  protected toRow(dto: Partial<Omit<Asset, "id">>): Partial<AssetRow> {
    // domain -> row
  }
  protected idFilter(ids: string[]): AssetFilter {
    return { id: ids };
  }
}
```

The base class builds `findOne`, `findById`, `findByIds`, `patch`, `delete`, and `transaction` on
top of `findMany`, `insert`, `patchWhere`, and `deleteWhere`.

## Filters

Filter keys are DTO property names, resolved through the table's columns. A scalar becomes `=`, an
array becomes `in (...)`, and an unknown property throws a `TypeError`.

## Transactions

`transaction` runs the callback against repositories bound to the transaction handle:

```ts
await assets.transaction(async (context) => {
  await resources.withContext(context).patch(resourceId, { label: "Avatar" });
});
```

`context.isTransactional` is `true`, and `context.db` is the transaction handle. `withContext` is how
a second repository joins the same transaction.

## In-memory alternative

The memory repositories in `@softzweig/suitcase-server/memory` implement the same contracts for
tests and local development. They are not durable and should not back a deployment.
