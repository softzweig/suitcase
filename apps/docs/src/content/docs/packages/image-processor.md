---

title: image-processor
description: Compress and convert images before they are claimed.
---

`@softzweig/suitcase-image-processor` is a `ProcessorRule` for the client. It runs in a worker, so
the page keeps drawing while ImageMagick works.

## Usage

```ts {3-4}
import wasmUrl from "@imagemagick/magick-wasm/magick.wasm?url";
import { createImageProcessor } from "@softzweig/suitcase-image-processor";
import { createSuitcaseClient } from "@softzweig/suitcase-client";
import type { SuitcaseClient } from "./definition.js";

const client = createSuitcaseClient<SuitcaseClient>({
  operations,
  processors: [createImageProcessor({ maxDimension: 1600, quality: 80 }, { wasmUrl })],
  transfer,
});
```

The rule asks for `image/*` only. Anything else is handed on untouched. Limits are checked against
the processed file, so the rule can shrink a file into range or change its type.

## Options

| Option         | Default   | Meaning                                             |
| -------------- | --------- | --------------------------------------------------- |
| `format`       | `"webp"`  | `gif`, `jpeg`, `png`, or `webp`                     |
| `quality`      | `80`      | 1 to 100                                            |
| `maxDimension` | none      | Longest edge in pixels                              |
| `background`   | `"white"` | Background for formats without alpha                |
| `when`         | none      | Extra narrowing; the rule always asks for `image/*` |

## Animations and alpha

Images are read as a collection and written back as one, so animated gifs keep their frames in
`gif` and `webp`. `jpeg` and `png` keep only the first frame. A transparent image written as `jpeg`
is composited onto `background`; other formats keep alpha.

## Environment

`wasmUrl` is where the wasm file is served. The worker loads it once. The second argument also takes
a `run` function for tests or environments without module workers.

The conversion lives in `src/convert.ts` without worker globals, so a Node runner can reuse it.
