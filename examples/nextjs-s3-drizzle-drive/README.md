# Next.js S3 Drizzle drive

A private drive: every file belongs to the name you uploaded it as, and only that name is ever
handed a link to it. Next.js and Tailwind on the outside, Suitcase on the inside, SQLite through
Drizzle for the rows, and S3 for the bytes. The S3 is [s3rver](https://github.com/20minutes/s3rver),
started in-process and backed by the filesystem, so the app talks to the real
`@softzweig/suitcase-s3` adapter and nothing needs Docker:

```sh
pnpm install
pnpm db:push   # creates .data/drive.db from the tables @softzweig/suitcase-drizzle ships
pnpm dev       # http://localhost:3001
```

It listens on 3001 and 4569, so it can run at the same time as the gallery example.

## What is wired where

```text
src/
  app/                     the drive, plain Next.js: it calls Suitcase, it is not Suitcase
    api/suitcase/[...op]/  POST target: createHttpHandler
    page.tsx               one user's files, queried from the app's own tables
    drive.tsx              useResolveResources: ids in, signed links out, rows on the page
    controls.tsx           useUploadResource, and the "acting as" field
    file-icon.tsx          what a file that is not an image looks like
  suitcase/                what Suitcase serves, and the two ends that talk to it
    definition.ts          one kind, file, and the read authorizer that keeps it private
    server.ts              createSuitcaseServer, and the execution per request
    client.ts              createSuitcaseClient, whose transport sends the acting user
  user.ts                  the cookie the page and the transport both read
  db.ts                    SQLite through @libsql/client, as the server adapters
  schema.ts                the tables drizzle-kit pushes
  s3.ts                    s3rver on 127.0.0.1:4569, and the bucket names
  paths.ts                 where `.data` lives
  instrumentation.ts       starts the local S3 before the first request
drizzle.config.ts          `pnpm db:push`
```

`@/` is `src/`, so a page imports the client as `@/suitcase/client`.

## Why a link is private

Two separate decisions, in two places, and neither is enough on its own:

- **Which files are shown** is the host's own query. Suitcase has no list operation by design, so
  `src/app/page.tsx` reads its own `resources` table for this kind and this owner.
- **Which of them may become a URL** is the definition's call. `read`'s `expose` receives every id
  the caller asked for and answers with the ones they own; anything else resolves to `NOT_FOUND`,
  deliberately the same answer as an id that never existed, so a list cannot be probed.

The name you type is stored in a cookie. The page reads it while rendering, and the transport sends
it as `x-user` on every operation, so the rows and the links can never disagree about who is
asking.

## What is deliberately left out

- **Auth.** `src/suitcase/server.ts` puts the `x-user` header straight into the execution context,
  so any caller can claim any name. A real app validates a token there; the cookie and the header
  are here to show where a session would be read. The digest is not a hook at all: the client
  defaults to sha256 over the bytes.
- **Folders, sharing, paging.** There is one flat list of one user's files, capped at 100.
- **Deleting and renaming.** Both exist in the API; the page does not call them.
- **Image processing.** The drive takes any file, so there is nothing to shrink; the gallery
  ([`../nextjs-s3-drizzle-gallery`](../nextjs-s3-drizzle-gallery)) is where
  [`@softzweig/suitcase-image-processor`](../../packages/image-processor) is wired in.

## Replacing the parts

- **Storage**: set `S3_ENDPOINT` and the credentials below, and `src/s3.ts` steps aside. A real
  bucket needs the same CORS rule it gives s3rver, because browsers upload straight to the signed
  URL.
- **Database**: `createSqliteServerAdapters` becomes `createPostgresServerAdapters`, and
  `drizzle.config.ts` points at Postgres. The definition does not change.

## Notes

- Styling is Tailwind v4: `src/app/globals.css` imports it and `postcss.config.mjs` compiles it, so
  the components are plain utility classes and nothing else.
- `S3_ENDPOINT` (default `http://127.0.0.1:4569`), `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` and
  `S3_REGION` configure the client; the defaults only ever match s3rver.
- `@20minutes/s3rver` asks for Node 24 in its own `engines`; it runs on the 22 this repo targets.
- `DATABASE_URL` (default `file:./.data/drive.db`) also feeds `drizzle.config.ts`.
- Everything the example writes lives in `.data/`: the database, and `s3/<bucket>/<key>` objects.
