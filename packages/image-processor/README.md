# @softzweig/suitcase-image-processor

An image processor for Suitcase: compresses and converts an upload before it is claimed, in a
worker, so the page keeps drawing while ImageMagick works.

It is a `ProcessorRule`, so it plugs into the client's `processors` and runs in the same chain as
any other rule:

```ts
import wasmUrl from "@imagemagick/magick-wasm/magick.wasm?url";
import { createImageProcessor } from "@softzweig/suitcase-image-processor";

const client = createSuitcaseClient(definition, {
  processors: [createImageProcessor({ maxDimension: 1600, quality: 80 }, { wasmUrl })],
});
```

The rule only asks for `image/*`; anything else is handed on untouched, and a caller's `when`
narrows that further. The file keeps its name with the extension of the format it was written as,
so the claims and the kind's limits are checked against what will actually be sent.

## Options

| Option         | Default   | Meaning                                                        |
| -------------- | --------- | -------------------------------------------------------------- |
| `format`       | `"webp"`  | `gif`, `jpeg`, `png` or `webp`.                                |
| `quality`      | `80`      | 1-100, higher keeps more detail.                               |
| `maxDimension` | none      | Longest edge in pixels; only larger images scale down.         |
| `background`   | `"white"` | What transparency is composited onto, for a format without it. |
| `when`         | none      | Narrows the rule further; it always asks for `image/*`.        |

Images are read as a collection and written back as one, so an animated gif keeps its frames in
`gif` and `webp`. `jpeg` and `png` cannot hold them and keep the first frame. A transparent image
written as `jpeg` is composited onto `background`; every other format keeps its alpha.

A name that already ends in one of the format's extensions is kept as written (`photo.jpeg` stays
`photo.jpeg`); anything else takes the format's first one, `.jpg`.

## Environment

`wasmUrl` is where the ImageMagick wasm is served; a bundler app can pass the URL it imported (as
above), and the worker loads it once. The processing itself lives in `src/convert.ts`, free of any
worker global, so a Node runner can reuse it.

The second argument also takes a `run`, which is how a test, or an environment without module
workers, supplies its own transport:

```ts
createImageProcessor({ quality: 70 }, { run: (request) => myWorkerThread(request) });
```

**Note: this is written for the client first.** The processor types come from
`@softzweig/suitcase-client`, and the defaults are tuned for uploads; a server binding arrives with
the server's processors.
