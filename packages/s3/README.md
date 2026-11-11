# @softzweig/suitcase-s3

The S3 storage adapter implementation for Suitcase.

## Usage

```ts
import { S3StorageBucket, createS3Client } from "@softzweig/suitcase-s3";

const bucket = await S3StorageBucket.create({
  s3: createS3Client({ region: "eu-central-1" }),
  name: "suitcase-uploads",
});
```

Use `createS3Client` rather than constructing an `S3Client` yourself. The SDK
defaults to `requestChecksumCalculation: "WHEN_SUPPORTED"`, which attaches a
CRC32 of an empty body to every `PutObject`. For a presigned URL that checksum
becomes part of the signature, so no client can ever satisfy it. The factory
pins `"WHEN_REQUIRED"`; checksums are then only applied when `checksum` is
supplied.

`createUploadUrl` verifies this and throws a `StorageError` if you pass a client
built with `new S3Client(...)` directly, instead of handing out a URL that would
fail on upload. The check runs at presign time because the policy is only
readable asynchronously.

`S3StorageBucket.create` runs that same check up front, so a misconfigured client
fails at startup rather than on the first upload request. The constructor skips it
and defers to `createUploadUrl` — use it only when presigning is not needed.

## Presigned uploads

`createUploadUrl` returns the `headers` the client must send verbatim:

```ts
const { url, method, headers } = await bucket.createUploadUrl({
  key: "assets/a.png",
  expiresInSeconds: 600,
  contentType: "image/png",
  contentLength: 3,
  checksum: { hashHex, hashAlgorithm: "sha256" },
});

await fetch(url, { method, headers, body });
```

Every header returned is part of the signature — omitting one, or sending a
different value, fails with `SignatureDoesNotMatch`. Headers you do not pass in
are never signed, so the URL carries no obligation you cannot fulfil.
