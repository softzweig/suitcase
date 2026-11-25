# Suitcase docs

The documentation site for the `@softzweig/suitcase` packages. It is an Astro Starlight app whose
content lives in Markdown and MDX under `src/content/docs`.

From the repository root:

```sh
pnpm docs:dev      # local server
pnpm docs:build    # static output in apps/docs/dist
pnpm docs:preview  # serve the static output under /suitcase
```

The site uses `/suitcase` as its base path for GitHub Pages. Opening `dist/index.html` directly or
serving `dist` at `/` makes every internal link 404; use the dev server or preview script instead.
`pnpm docs:build` also runs `scripts/check-links.mjs` against the built HTML and fails on a broken
internal link.

The sidebar is declared in `astro.config.mjs`. Add a page under `src/content/docs`, then add its
slug to the sidebar. Pushes to `main` that touch `apps/docs` deploy the site to GitHub Pages.
