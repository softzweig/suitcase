# Changesets

This folder holds the release notes for the `@softzweig` packages.

Record a change alongside your PR:

```bash
pnpm changeset
```

Pick the packages and the bump type (`patch` / `minor` / `major`), then commit the generated
`.changeset/*.md` file. CI keeps a **Version Packages** pull request up to date; merging it bumps
versions and writes `CHANGELOG.md` entries.

Docs: https://changesets.dev
