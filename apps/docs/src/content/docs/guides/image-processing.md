---

title: Image processing
description: Shrink and convert images before they are claimed.
---

`@softzweig/suitcase-image-processor` is a client-side processor rule. It runs before the upload is
claimed, in a worker, so the page keeps drawing while ImageMagick works.

## Add it to the client

```ts {4}
import wasmUrl from "@imagemagick/magick-wasm/magick.wasm?url";
import { createSuitcaseClient } from "@softzweig/suitcase-client";
import { createImageProcessor } from "@softzweig/suitcase-image-processor";
import type { SuitcaseClient } from "./definition.js";

export const client = createSuitcaseClient<SuitcaseClient>({
  operations,
  processors: [createImageProcessor({ maxDimension: 1600, quality: 80 }, { wasmUrl })],
  transfer,
});
```

The rule only asks for `image/*`. Anything else is handed on untouched, and a caller's `when`
narrows it further.

```ts title="processors.ts" {3}
createImageProcessor(
  { maxDimension: 1600, quality: 80, when: ({ file }) => file.size > 2_000_000 },
  { wasmUrl },
);
```

The file keeps its name with the extension of the format it was written as. Limits are checked
against what will actually be sent, so a processor can shrink a file into range or turn it into an
allowed type.

## Options

| Option         | Default   | Meaning                                                       |
| -------------- | --------- | ------------------------------------------------------------- |
| `format`       | `"webp"`  | `gif`, `jpeg`, `png`, or `webp`                               |
| `quality`      | `80`      | 1 to 100, higher keeps more detail                            |
| `maxDimension` | none      | Longest edge in pixels; only larger images scale down         |
| `background`   | `"white"` | What transparency is composited onto, for a format without it |
| `when`         | none      | Narrows the rule further; it always asks for `image/*`        |

Images are read as a collection and written back as one, so an animated gif keeps its frames in
`gif` and `webp`. `jpeg` and `png` cannot hold them and keep the first frame. A transparent image
written as `jpeg` is composited onto `background`; every other format keeps its alpha.

A name that already ends in one of the format's extensions is kept as written (`photo.jpeg` stays
`photo.jpeg`). Anything else takes the format's first extension, so `photo` becomes `photo.webp`.

## Environment

`wasmUrl` is where the ImageMagick wasm is served. A bundler app can pass the URL it imported, and
the worker loads it once. Next.js Turbopack has no asset import for it, so the gallery example
copies it into `public/` before `dev` or `build` runs and points `wasmUrl` at `/magick.wasm`.

The second argument also takes a `run` function, which is how a test, or an environment without
module workers, supplies its own transport:

```ts
createImageProcessor({ quality: 70 }, { run: (request) => myWorkerThread(request) });
```

The conversion itself lives in `src/convert.ts`, free of worker globals, so a Node runner can reuse
it.
