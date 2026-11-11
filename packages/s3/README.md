# @softzweig/suitcase-s3

The S3 storage adapter implementation for Suitcase.

## Usage

```ts
import { S3StorageBucket, createS3Client } from "@softzweig/suitcase-s3";

const bucket = new S3StorageBucket(createS3Client({ region: "eu-central-1" }), "suitcase-uploads");
```

Use `createS3Client` rather than constructing an `S3Client` yourself. The SDK
defaults to `requestChecksumCalculation: "WHEN_SUPPORTED"`, which attaches a
CRC32 of an empty body to every `PutObject`. For a presigned URL that header
becomes part of the signature, so no client can ever satisfy it. The factory
pins `"WHEN_REQUIRED"`; checksums are then only applied when `checksum` is
supplied.

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
