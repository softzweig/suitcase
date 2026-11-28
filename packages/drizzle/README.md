# @softzweig/suitcase-drizzle

Drizzle-backed repositories for `@softzweig/suitcase-server`, built on
`@softzweig/spindle-drizzle`.

`@softzweig/spindle-drizzle` owns the abstract repository, cursor paging and the
translation of driver constraint errors. This package adds what only Suitcase
knows: the three entity repositories, the usage aggregates its endpoints need,
and adapters that wire one database into `createSuitcaseServer`.

## Usage

Postgres and SQLite bindings ship today, as `./pg-core` and `./sqlite-core`.
Each wires the three repositories and the transaction runner:

```ts
import { drizzle } from "drizzle-orm/node-postgres";
import { createPostgresServerAdapters } from "@softzweig/suitcase-drizzle/pg-core";
import { createSuitcaseServer } from "@softzweig/suitcase-server";

const server = createSuitcaseServer(definition, createPostgresServerAdapters(drizzle(pool)));
```

## Custom repositories

Extend `AbstractDrizzleRepository` from this package when a repository needs a
different mapping or a usage aggregate. It is Spindle's repository plus the one
aggregate Suitcase's usage endpoints read, and pages by the row id unless a
paging specification says otherwise.

```ts
import type { EntityFilter, EntityInsert } from "@softzweig/spindle-core/repository";
import { AbstractDrizzleRepository } from "@softzweig/suitcase-drizzle";
import type { DrizzleDatabase } from "@softzweig/spindle-drizzle";
import { assets } from "./schema.js";

type AssetFilter = EntityFilter<Asset, SQL>;

export class AssetRepository extends AbstractDrizzleRepository<typeof assets, Asset, AssetFilter> {
  constructor(db: DrizzleDatabase) {
    super(db, assets);
  }

  protected toDto(row: AssetRow): Asset {
    return { id: row.id, key: row.key, size: row.size };
  }

  protected toRow(dto: Readonly<Partial<EntityInsert<Asset>>>): Partial<AssetRow> {
    return { key: dto.key, size: dto.size };
  }

  idFilter(ids: readonly string[]): AssetFilter {
    return { id: [...ids] };
  }
}
```

The base class implements `findMany`, `insert`, `patchWhere` and `deleteWhere`
once; `findOne`, `findById`, `findByIds`, `patch`, `delete`, `count`, `list` and
`transaction` are built on them.

## Transactions

`transaction` runs the callback against a copy of the repository bound to the
transaction handle, and hands it a `DrizzleContext` so services can tell whether
they are inside one:

```ts
await assets.transaction(async (context) => {
  await resources.withContext(context).patch(resourceId, { label: "Avatar" });
});
```

`context.isInTransaction` is `true` and `context.db` is the transaction handle.
`withContext` is how a second repository joins the same transaction.

## Filters

Filter keys are entity property names and are resolved through the table's
columns. A scalar becomes `=`, an array becomes `in (...)`, `null` becomes
`is null`, and an unknown property throws a `TypeError` instead of silently
widening the query.
