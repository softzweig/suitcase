# Suitcase

Lean TypeScript library monorepo — pnpm workspaces + Turborepo, Biome for lint/format, shared
`tsconfig` presets, and publishing to GitHub Packages.

## Layout

```
packages/
  typescript-config/   @suitcase/typescript-config  (private, shared tsconfig presets)
  sample/              @suitcase/sample             (publishable template package)
```

No `apps/**` — this repo only ships libraries.

## Commands

| Command                 | Description                                  |
| ----------------------- | -------------------------------------------- |
| `pnpm install`          | Install all workspace dependencies           |
| `pnpm build`            | Build every package (Turborepo, cached)      |
| `pnpm test`             | Run all packages' tests in one Vitest run    |
| `pnpm test:watch`       | Vitest watch mode (all packages)             |
| `pnpm typecheck`        | Typecheck every package                      |
| `pnpm lint`             | Biome check across the repo                  |
| `pnpm check`            | Biome check + safe fixes                     |
| `pnpm format`           | Biome format + write                         |
| `pnpm changeset`        | Record a release note (bump type) for a PR   |
| `pnpm version:packages` | Apply pending changesets (bump + changelogs) |
| `pnpm publish:packages` | Build, then publish unpublished versions     |

## Shared TypeScript configs

Each package extends one of the presets from `@suitcase/typescript-config` (a `workspace:*`
dev dependency, never published):

| Preset               | Use                                              |
| -------------------- | ------------------------------------------------ |
| `base.json`          | Typecheck-only (no emit) strict baseline         |
| `library.json`       | Node ESM library emitting `dist/` + declarations |
| `react-library.json` | Same as `library.json` with React JSX + DOM libs |

```jsonc
// packages/<name>/tsconfig.build.json
{
  "extends": "@suitcase/typescript-config/library.json",
  "include": ["src"],
  "compilerOptions": { "rootDir": "src", "outDir": "dist" }
}
```

Rule of thumb: `tsconfig.json` extends `base.json` and includes tests (typecheck), while
`tsconfig.build.json` extends the library preset and includes only `src` (emit).

## Testing

Vitest is installed and configured **globally**, like Biome — one root config, one command:

```ts
// vitest.config.ts
projects: ["packages/*", "!packages/typescript-config"];
```

Every package under `packages/` is its own Vitest project (named after its `package.json`
`name`), so a single `pnpm test` runs the whole repo while keeping per-package isolation:

| Command                                | Description      |
| -------------------------------------- | ---------------- |
| `pnpm test`                            | Run all projects |
| `pnpm test --project @suitcase/sample` | Run one project  |
| `pnpm test:watch`                      | Watch mode       |

Tests live next to their package (`packages/<name>/test/**/*.test.ts`) and import the public
API from source (`../src/index.js`), so no build step is required. Add a config-only package to
the negation list in `vitest.config.ts` if it has no tests.

## Adding a package

1. Copy `packages/sample` to `packages/<name>` and rename to `@suitcase/<name>`.
2. Keep `publishConfig.registry` pointed at GitHub Packages.
3. `pnpm install`.

## Versioning

Versions are managed by [Changesets](https://changesets.dev) — never edit a `version` by hand.

1. In your PR, run `pnpm changeset`, pick the packages and the bump type (`patch` / `minor` /
   `major`), and commit the generated `.changeset/*.md` file.
2. On every push to `main`, CI keeps a **Version Packages** PR up to date (`changeset version`):
   it bumps versions, writes `CHANGELOG.md`, and refreshes the lockfile.
3. Merge that PR when you want to release, then publish via the usual trigger (GitHub release,
   push to `release` / `release/**`, or `workflow_dispatch`).

`changeset publish` only publishes versions missing from the registry, so re-running the publish
job is safe. The private `@suitcase/typescript-config` is never versioned or published.

> The `version` job needs _Settings → Actions → General → "Allow GitHub Actions to create and
> approve pull requests"_ enabled so it can open the Version Packages PR.

## Publishing

Packages publish to GitHub Packages as **private** (`restricted`) packages, so the npm scope
(`@suitcase`) must match the GitHub owner (org or user) that owns this repository.

- `publishConfig` in each package sets `registry` and `access: restricted`.
- `.npmrc` routes `@suitcase/*` to `https://npm.pkg.github.com`.
- Consumers need a token with `read:packages` in their `~/.npmrc`:

  ```
  @suitcase:registry=https://npm.pkg.github.com
  //npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
  ```

### CI/CD (`.github/workflows/ci.yml`)

- `verify` — runs on pushes to `main`/`release/**`, pull requests, releases and manual runs:
  install → lint → build → typecheck → test.
- `version` — on pushes to `main`, maintains the Version Packages PR (opens a PR with the
  bumped versions and changelogs). Needs `contents: write` + `pull-requests: write`.
- `publish` — runs only on a published GitHub release, a push to `release` / `release/**`, or
  `workflow_dispatch`. Never on `pull_request`. Runs `pnpm publish:packages` (the same command
  as locally) with `GITHUB_TOKEN`, `packages: write` and `contents: write` (for release tags).
