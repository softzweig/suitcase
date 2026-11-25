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
    page.tsx               one user's files, and what they add up to, from the app's own tables
    drive.tsx              useResolveResources: ids in, signed links out; useDeleteResource: a row goes
    controls.tsx           useUploadResource, and the "acting as" field
    file-icon.tsx          what a file that is not an image looks like
  suitcase/                what Suitcase serves, and the two ends that talk to it
    definition.ts          one kind, file, and the owner authorizer that keeps it private
    server.ts              createSuitcaseServer, the execution per request, and usageOf
    client.ts              createSuitcaseClient, whose transport sends the acting user
  user.ts                  the cookie the page and the transport both read
  db.ts                    SQLite through @libsql/client, plus the in-process job queue
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

## Who may delete a file

`Delete` on a row calls `resources.delete` through `useDeleteResource`, and the definition decides:
`owner.authorize` receives the action and the row's owner, and answers `true` only when that owner is
the execution's user. The same authorizer answers uploads — where the payload's owner is what
`ownedBy` resolved — and updates, so one comparison covers every mutation. A delete that is refused
answers `FORBIDDEN` and the row stays; nothing is deleted and rolled back.

Once the row is gone, Suitcase marks its asset and only purges the bytes when no other resource
points at it. The purge is a job, so `db.ts` wires a queue: `createJobQueue` returns
[`createMemoryJobQueue(handlers)`](../../packages/job-queue), which runs the `assets.purge` handler
in this process right after the call that queued it. The default is a no-op queue, so without that
line the row would disappear and the bytes would stay. The queue lives on `globalThis` so a dev
reload does not drop a purge that is still running; a real deployment points `createJobQueue` at a
durable queue and the handler does not change.

## What the files add up to

Under the title the drive shows `2 files · 879 KB used`: Suitcase's own `usage.total` query, not a
`size` column the page sums itself. `src/suitcase/server.ts` exports `usageOf(userId)`, which asks
`server.forExecution({ userId }).usage.total({ kinds: ["file"], owner: { userId } })`, and
`page.tsx` passes the answer down. The figure therefore moves with the render: an upload or a
delete refreshes the page, and the number comes back with it.

Two things make that answer possible, and both are the definition's decision:

- **`usage: true` on the owner.** A kind whose owner does not opt in answers `NOT_FOUND`, so a
  definition cannot start reporting storage by accident.
- **The same `authorize` hook.** Asking for an owner's usage is a request, not a permission: the
  owner's schema validates `{ userId }`, and `authorize` answers for `action: "usage"`. Asking for
  another name returns `FORBIDDEN`, the same refusal a delete of their file gets.

The browser can ask the very same question through the client —
`client.usage.total({ kinds: ["file"], owner: { userId } })` — because both ends are typed from
the definition, down to which kinds may be named at all.

## What is deliberately left out

- **Auth.** `src/suitcase/server.ts` puts the `x-user` header straight into the execution context,
  so any caller can claim any name. A real app validates a token there; the cookie and the header
  are here to show where a session would be read. The digest is not a hook at all: the client
  defaults to sha256 over the bytes.
- **Quotas.** Usage is reported, not enforced: there is no limit the drive checks an upload against.
  `upload.accept` is where one would go, called at both the start and the end of an upload.
- **Folders, sharing, paging.** There is one flat list of one user's files, capped at 100.
- **Renaming.** `resources.update` exists in the API; the page does not call it.
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
- A query failing with `Failed query: select … from "resources"` is usually `no such table` on the
  next line of the stack: the database file exists but the schema was never pushed. Run
  `pnpm db:push` once before the first `pnpm dev`.
- Everything the example writes lives in `.data/`: the database, and `s3/<bucket>/<key>` objects.
