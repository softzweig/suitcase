import { describe, expect, it, test } from "vitest";

import {
  checksumFrom,
  checksumParams,
  expiresAt,
  toRange,
  toStoredObject,
} from "../src/mapping.js";
import { SHA256_HEX, SHA512_HEX, toBase64 } from "./support.js";

const SHA256_BASE64 = toBase64(SHA256_HEX);
const SHA512_BASE64 = toBase64(SHA512_HEX);

describe("checksumParams", () => {
  test.for([
    {
      label: "sha256",
      checksum: { hashHex: SHA256_HEX, hashAlgorithm: "sha256" },
      expected: { ChecksumSHA256: SHA256_BASE64 },
    },
    {
      label: "sha512",
      checksum: { hashHex: SHA512_HEX, hashAlgorithm: "sha512" },
      expected: { ChecksumSHA512: SHA512_BASE64 },
    },
  ] as const)("encodes $label under its S3 field", ({ checksum, expected }) => {
    expect(checksumParams(checksum)).toEqual(expected);
  });
});

describe("checksumFrom", () => {
  test.for([
    {
      label: "sha256",
      source: { ChecksumSHA256: SHA256_BASE64 },
      expected: { hashHex: SHA256_HEX, hashAlgorithm: "sha256" },
    },
    {
      label: "sha512",
      source: { ChecksumSHA512: SHA512_BASE64 },
      expected: { hashHex: SHA512_HEX, hashAlgorithm: "sha512" },
    },
    { label: "no checksum", source: {}, expected: undefined },
  ] as const)("reads $label", ({ source, expected }) => {
    expect(checksumFrom(source)).toEqual(expected);
  });
});

describe("toRange", () => {
  test.for([
    {
      label: "a closed range",
      range: { start: 0, end: 2 },
      expected: "bytes=0-2",
    },
    {
      label: "a single byte",
      range: { start: 0, end: 0 },
      expected: "bytes=0-0",
    },
    { label: "an open range", range: { start: 5 }, expected: "bytes=5-" },
    { label: "no range", range: undefined, expected: undefined },
  ])("maps $label", ({ range, expected }) => {
    expect(toRange(range)).toBe(expected);
  });
});

describe("expiresAt", () => {
  it("adds the ttl to the signing time", () => {
    const signedAt = new Date("2026-11-11T10:00:00.000Z");

    expect(expiresAt(signedAt, 600).toISOString()).toBe("2026-11-11T10:10:00.000Z");
  });
});

describe("toStoredObject", () => {
  const lastModified = new Date("2026-11-11T10:00:00.000Z");

  it("maps every field S3 reported", () => {
    expect(
      toStoredObject("assets/a.png", {
        ContentLength: 42,
        ContentType: "image/png",
        ETag: '"etag"',
        LastModified: lastModified,
        Metadata: { uploader: "u_1" },
        ChecksumSHA512: SHA512_BASE64,
      }),
    ).toEqual({
      key: "assets/a.png",
      size: 42,
      contentType: "image/png",
      etag: '"etag"',
      lastModified,
      metadata: { uploader: "u_1" },
      checksum: { hashHex: SHA512_HEX, hashAlgorithm: "sha512" },
    });
  });

  it("leaves the checksum undefined when S3 reported none", () => {
    expect(toStoredObject("assets/a.png", { ContentLength: 1 }).checksum).toBeUndefined();
  });

  it("falls back to the current time when LastModified is missing", () => {
    const before = Date.now();

    expect(toStoredObject("assets/a.png", {}).lastModified.getTime()).toBeGreaterThanOrEqual(
      before,
    );
  });

  test.for([
    { label: "ContentLength", source: { ContentLength: 42 }, expected: 42 },
    { label: "Size", source: { Size: 10 }, expected: 10 },
    { label: "neither field, defaulting to 0", source: {}, expected: 0 },
  ])("derives the size from $label", ({ source, expected }) => {
    expect(toStoredObject("assets/a.png", source).size).toBe(expected);
  });
});
