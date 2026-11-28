---
"@softzweig/suitcase-core": major
"@softzweig/suitcase-server": major
"@softzweig/suitcase-drizzle": major
"@softzweig/suitcase-client": major
"@softzweig/suitcase-http": major
"@softzweig/suitcase-react": major
---

Migrate the extracted primitives to `@softzweig/spindle-core` and
`@softzweig/spindle-drizzle`.

The errors, services, transactions and repositories Suitcase used to own now live
in Spindle, so this release consumes them instead of duplicating them:

- The result vocabulary is Spindle's: `SpindleResult`, `SpindleFailure`,
  `SpindleErrorCode` and `SpindleFailureSchema`, imported from
  `@softzweig/spindle-core/result`. `@softzweig/suitcase-core` no longer
  re-exports them.
- Services extend Spindle's `Service` and every public method is checked against
  `ServiceExecutionContract`. A use case returns a `ServiceExecution`: call
  `run()` for a `SpindleResult` or `unwrap()` to throw. The server API returns
  the same executions.
- `ServiceError` comes from `@softzweig/spindle-core/service`, and the
  storage-aware failure converter must be part of a service context as
  `toServiceFailure`. `createSuitcaseServer` supplies it.
- Repositories implement Spindle's `Repository` contract, which adds `count` and
  cursor paging through `list`. `AbstractSuitcaseRepository`,
  `SuitcaseRepository`, `SuitcaseDtoFilter` and `SuitcaseInsert` are gone; use
  `AbstractRepository`, `Repository`, `EntityFilter` and `EntityInsert`.
- `@softzweig/suitcase-drizzle` builds on `@softzweig/spindle-drizzle`. Its
  `AbstractDrizzleRepository` takes `<TTable, TEntity, TFilter>`, a constructor
  of `(db, table)` and pages by the row id.
- The in-memory backend uses `@softzweig/spindle-memory` stores and exports
  `createMemoryRepositories()`, which wires the three repositories and the
  transaction runner. `@softzweig/suitcase-server/memory` no longer re-exports
  `MemoryStore`.
- `@softzweig/suitcase-server` no longer exports the transaction primitives;
  import them from `@softzweig/spindle-core/transactional`.
