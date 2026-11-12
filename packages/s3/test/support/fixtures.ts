import { createHash, randomUUID } from "node:crypto";
import type { AssetHash } from "@softzweig/suitcase-core";
import { readBytes } from "@softzweig/suitcase-server/storage";

/** A key unique to this call, keeping concurrent tests off each other's objects. */
export const uniqueKey = (name = "object"): string => `${uniquePrefix()}${name}`;

/** A key prefix unique to this call, for tests that own a group of objects. */
export const uniquePrefix = (): string => `${randomUUID()}/`;

export const sha256 = (body: Uint8Array): AssetHash => ({
  hashAlgorithm: "sha256",
  hashHex: createHash("sha256").update(body).digest("hex"),
});

/** Drains a response body, so tests can compare bytes without caring it streamed. */
export const bytesOf = async (body: AsyncIterable<Uint8Array>): Promise<Buffer> =>
  Buffer.from(await readBytes(body));
