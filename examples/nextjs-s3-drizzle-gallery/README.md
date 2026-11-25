# Next.js S3 Drizzle gallery

A wall of images you can add to: Next.js on the outside, Suitcase on the inside, SQLite through
Drizzle for the rows, and S3 for the bytes. The S3 is [s3rver](https://github.com/20minutes/s3rver),
started in-process and backed by the filesystem, so the app talks to the real
`@softzweig/suitcase-s3` adapter and nothing needs Docker:

```sh
pnpm install
pnpm db:push   # creates .data/gallery.db from the tables @softzweig/suitcase-drizzle ships
pnpm dev       # http://localhost:3000
```

## What is wired where

```text
src/
  app/                     the wall, plain Next.js: it calls Suitcase, it is not Suitcase
    api/suitcase/[...op]/  POST target: createHttpHandler
    page.tsx               newest photos, queried from the app's own tables
    gallery.tsx            useResolveResources: ids in, signed links out; useDeleteResource: a card goes
    controls.tsx           useUploadResource, and the "acting as" field
    providers.tsx          SuitcaseProvider
  suitcase/                what Suitcase serves, and the two ends that talk to it
    definition.ts          one kind, photo, over two S3 buckets, and its owner
    server.ts              createSuitcaseServer, and the execution per request
    client.ts              createSuitcaseClient, whose transport reads the acting user
  db.ts                    SQLite through @libsql/client, plus the in-process job queue
  schema.ts                the tables drizzle-kit pushes
  s3.ts                    s3rver on 127.0.0.1:4568, and the bucket names
  session.ts               who the browser is acting as
  paths.ts                 where `.data` lives
  instrumentation.ts       starts the local S3 before the first request
scripts/copy-wasm.mjs      puts ImageMagick in `public/`, where the worker fetches it
drizzle.config.ts          `pnpm db:push`
```

`@/` is `src/`, so a page imports the client as `@/suitcase/client`.

The browser side is all `@softzweig/suitcase-react`: the provider holds the client, the upload hook
queues through the provider's queue, and the resolve hook asks the client's batcher for the ids the
server rendered. The flow it runs is the one every deployment runs: `uploads.constraints`, then
`uploads.initialize` for a signed target, a `PUT` of the bytes straight at that target, then
`uploads.finalize`. No file ever passes through the operation endpoints, and the promoted asset is a
server-side S3 copy.

## Who a request runs as

Type a name in the header field and the next call carries it as `x-user`: the transport's
`configure` is asked before every call, so it reads the current name instead of one captured at
startup. `src/suitcase/server.ts` turns that header into the execution context's `userId`, which is
what `ownedBy` reads, so the photo you upload is owned by the name you typed.

## Removing a card, and why a shared upload survives it

`Remove` on a card calls `resources.delete` through `useDeleteResource`. The row goes at once; the
asset behind it does not, because two cards may share one upload. Suitcase marks the asset only once
no resource points at it, and the bytes are purged by the `assets.purge` job the mark queues.

That job is the reason `db.ts` wires a queue at all: `createJobQueue` returns
[`createMemoryJobQueue(handlers)`](../../packages/job-queue), which runs the purge in this process
right after the call that queued it. The default is a no-op queue, so without this line deletions
would still work but the bytes would stay. The queue lives on `globalThis` so a dev reload does not
drop a purge that is still running; a real deployment points `createJobQueue` at a durable queue
instead, and the `assets.purge` handler stays exactly the same.

## What is shrunk before it is claimed

`src/suitcase/client.ts` configures one processor,
[`createImageProcessor({ maxDimension: 1600, quality: 80 })`](../../packages/image-processor). A
picked file that is an image goes through a worker before anything is claimed, comes back as webp
with its name's extension changed to match, and that is what the constraints are checked against and
what is uploaded, so the 20 MB limit and the four image mimes apply to the bytes actually sent. The
worker is started on the first upload, everything that is not an image is handed on untouched, and
the card reads `photo.webp` because that is what was stored.

The worker loads ImageMagick from `/magick.wasm`. Turbopack has no asset import for it, so
`scripts/copy-wasm.mjs` copies it out of `node_modules` into `public/` before `dev` or `build` runs;
the copy is gitignored.

## What is deliberately left out

- **Auth.** `src/suitcase/server.ts` puts the `x-user` header straight into the execution context,
  so any caller can claim any name. A real app validates a token there; the header is here to show
  what `configure` can feed the transport. The digest is not a hook at all: the client defaults to
  sha256 over the bytes.
- **Listing through Suitcase.** There is no "give me everything" operation, on purpose: the server
  component queries its own `resources` table for the newest ids, and the browser resolves those
  through `useResolveResources`, which is where the read authorization happens.
- **Deleting and renaming.** Deleting exists and the wall calls it; renaming (`resources.update`)
  exists too, but no control calls it.

## Replacing the parts

- **Storage**: set `S3_ENDPOINT` and the credentials below, and `src/s3.ts` steps aside. A real
  bucket needs the same CORS rule it gives s3rver, because browsers upload straight to the signed
  URL.
- **Database**: `createSqliteServerAdapters` becomes `createPostgresServerAdapters`, and
  `drizzle.config.ts` points at Postgres. The definition does not change.

## Notes

- Styling is Tailwind v4: `src/app/globals.css` imports it and `postcss.config.mjs` compiles it, so
  the components are plain utility classes and nothing else.
- `S3_ENDPOINT` (default `http://127.0.0.1:4568`), `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` and
  `S3_REGION` configure the client; the defaults only ever match s3rver.
- `@20minutes/s3rver` asks for Node 24 in its own `engines`; it runs on the 22 this repo targets.
- `DATABASE_URL` (default `file:./.data/gallery.db`) also feeds `drizzle.config.ts`.
- A query failing with `Failed query: select … from "resources"` is usually `no such table` on the
  next line of the stack: the database file exists but the schema was never pushed. Run
  `pnpm db:push` once before the first `pnpm dev`.
- Everything the example writes lives in `.data/`: the database, and `s3/<bucket>/<key>` objects.
