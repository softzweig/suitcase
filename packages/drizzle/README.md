# @softzweig/suitcase-drizzle

Drizzle-backed repositories for `@softzweig/suitcase-server`. Dialect-agnostic:
the base class targets a small structural `DrizzleDatabase` port rather than a
concrete drizzle type, so any drizzle driver can back it. Postgres and SQLite
bindings ship today.

## Usage

Extend `AbstractDrizzleRepository` and supply three things: the table, the two
mappers, and how ids become a filter. The column map used to translate filters
is derived from the table, so it needs no separate declaration.

```ts
import { AbstractDrizzleRepository } from "@softzweig/suitcase-drizzle";
import { assets } from "./schema.js";

type AssetFilter = SuitcaseDtoFilter<Asset>;

export class AssetRepository extends AbstractDrizzleRepository<Asset, typeof assets, AssetFilter> {
  protected readonly table = assets;

  protected toDto(row: AssetRow): Asset {
    return { id: row.id, key: row.key, size: row.size };
  }

  protected toRow(dto: Partial<Omit<Asset, "id">>): Partial<AssetRow> {
    return { key: dto.key, size: dto.size };
  }

  protected idFilter(ids: string[]): AssetFilter {
    return { id: ids };
  }
}
```

An adapter implements `findMany`, `insert`, `patchWhere` and `deleteWhere`; the
base classes build `findOne`, `findById`, `findByIds`, `patch`, `delete` and
`transaction` on top of them. Bindings for the three core entities ship for
Postgres as `./pg-core` and SQLite as `./sqlite-core`.

## Transactions

`transaction` runs the callback against a copy of the repository bound to the
transaction handle, and hands it a `DrizzleContext` so services can tell whether
they are inside one:

```ts
await assets.transaction(async (context) => {
  await resources.withContext(context).patch(resourceId, { label: "Avatar" });
});
```

`context.isTransactional` is `true` and `context.db` is the transaction handle —
`withContext` is how a second repository joins the same transaction.

## Filters

Filter keys are DTO property names and are resolved through `columns`. A scalar
becomes `=`, an array becomes `in (...)`, and an unknown property throws a
`TypeError` instead of silently widening the query.
