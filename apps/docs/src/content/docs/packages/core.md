---

title: core
description: Contracts, schemas, hashing, and byte-size helpers.
---

`@softzweig/suitcase-core` is the shared vocabulary. It has no server, storage, or browser code.

## What it exports

- **Schemas:** resources, assets, upload sessions, owners, results, and the operation contracts.
- **Types:** `Resource`, `Asset`, `UploadSession`, `ResourceOwner`, and the operation input and
  output types.
- **Hashing:** `AssetHash`, `AssetHashAlgorithm`, and `digestBytes`.
- **Byte sizes:** `ByteSize`, for parsing and formatting operands such as `"5 MB"`.
- **Contract helpers:** `createSuitcaseOperations` and the client operation types.

## Subpaths

| Import                               | Contents                                    |
| ------------------------------------ | ------------------------------------------- |
| `@softzweig/suitcase-core`           | Schemas and shared types                    |
| `@softzweig/suitcase-core/contracts` | Operation contracts, client operation types |
| `@softzweig/suitcase-core/utils`     | `ByteSize`, hashing, small helpers          |

## Hashes

Suitcase allows `sha256` and `sha512` only. `AssetHash.hashHex` is lowercase hex, enforced by a Zod
regex, so it is URL-safe and can double as an object key.

```ts
import { AssetHashAlgorithm, digestBytes } from "@softzweig/suitcase-core/utils";

const hash = await digestBytes(AssetHashAlgorithm.SHA256, bytes);
// { hashAlgorithm: "sha256", hashHex: "..." }
```

## Results

Every service operation answers with a `SpindleResult`, the result type `@softzweig/spindle-core`
defines for every Spindle service. It is the contract between the server, the HTTP handler, and the
client.

```ts
import type { SpindleResult } from "@softzweig/spindle-core/result";

type SpindleResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: SpindleErrorCode; message: string; details?: Record<string, unknown> };
```

`SpindleErrorCode` is the one vocabulary used by every side, so a caller does not need two error
models. Import it from `@softzweig/spindle-core/result`.
