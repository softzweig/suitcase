# Contributing

Thanks for helping with Suitcase. This repository uses a protected `main` branch, so every change
lands through a pull request.

## Requirements

- Node.js 22 or newer
- pnpm via Corepack: `corepack enable`
- Git

## Setup

```bash
git clone https://github.com/softzweig/suitcase.git
cd suitcase
pnpm install
pnpm build
```

If you do not have write access to the repository, fork it first and add the upstream remote:

```bash
git remote add upstream https://github.com/softzweig/suitcase.git
```

## Making a change

1. Start from an up-to-date `main`.
2. Create a focused branch:
   - `feat/short-description`
   - `fix/short-description`
   - `docs/short-description`
   - `chore/short-description`
3. Make the change and add tests.
4. Run the checks below.
5. Commit with a conventional message such as `feat: add upload retry policy` or
   `fix: reject expired sessions`.
6. Push to your fork or branch and open a pull request against `main`.

Do not push directly to `main`, force-push it, or include unrelated changes in a pull request.

## Checks

Run these before opening a pull request:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
```

For docs changes, also run:

```bash
pnpm docs:build
```

`pnpm lint` is read-only. Use `pnpm check` to apply Biome fixes, then re-run the checks.

Integration tests use local PGlite and SQLite databases. They do not need external services or
credentials.

## Tests and changesets

- Add or update tests for behavior changes and bug fixes.
- Add a changeset for any change that should release a published package:

  ```bash
  pnpm changeset
  ```

  While the packages are pre-1.0, use `patch` for fixes and `minor` for features or breaking
  changes. Use `major` only when intentionally moving a package to 1.0.
- Docs, examples, and private workspace tooling do not need a changeset.

## Pull requests

- Keep each pull request focused on one problem.
- Describe what changed, why, and how you tested it.
- Update documentation when the public API or configuration changes.
- Resolve review conversations before merging.
- CI must pass. `Verify` is required by branch protection.

Maintainers merge pull requests and run the release workflow. Contributors do not publish packages.

## AI-assisted code

AI-assisted code is allowed only when it is properly reviewed and tested:

- tests must be focused, lean, and validated locally
- the behavior must be covered by meaningful tests
- the generated code must be reviewed thoroughly, preferably line by line or at least per module
- you must understand the change and be able to explain it during review

Do not submit generated code you have not reviewed. Unreviewed or untested AI output is not accepted.

## Attribution

Use `@human` in the multi-line comment block for code that is:

- entirely human-made
- AI-assisted but then rewritten by a human
- AI-assisted and confirmed to follow the existing code guidelines, after a line-by-line review

Alternatively, use `@author` with your nickname or full name instead of `@human`. Either tag is
acceptable, but use one of them for code that meets the criteria above.

```ts
/**
 * Resolves the owner an upload belongs to.
 *
 * @human
 */
```

## Licensing

The project is MIT licensed. Sign off your commits with `git commit -s` to certify the Developer
Certificate of Origin. No separate contributor license agreement is required.

## Security

Do not report security issues in a public issue or pull request. Follow [SECURITY.md](SECURITY.md).
