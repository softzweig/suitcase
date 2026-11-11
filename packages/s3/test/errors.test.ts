import { StorageErrorCode } from "@softzweig/suitcase-server";
import { describe, expect, it, test } from "vitest";

import { isNotFound, toStorageError } from "../src/errors.js";
import { s3Error } from "./support.js";

describe("isNotFound", () => {
  test.for([
    {
      label: "a 404 NotFound response",
      error: s3Error("NotFound", 404),
      expected: true,
    },
    {
      label: "a 404 NoSuchKey response",
      error: s3Error("NoSuchKey", 404),
      expected: true,
    },
    {
      label: "a 403 AccessDenied response",
      error: s3Error("AccessDenied", 403),
      expected: false,
    },
    { label: "an unrelated error", error: new Error("boom"), expected: false },
    { label: "a non-error value", error: "boom", expected: false },
  ])("returns $expected for $label", ({ error, expected }) => {
    expect(isNotFound(error)).toBe(expected);
  });
});

describe("toStorageError", () => {
  test.for([
    {
      label: "a missing bucket",
      error: s3Error("NoSuchBucket", 404),
      expected: StorageErrorCode.BUCKET_MISSING,
    },
    {
      label: "a digest mismatch",
      error: s3Error("BadDigest", 400),
      expected: StorageErrorCode.CHECKSUM_MISMATCH,
    },
    {
      label: "a checksum mismatch",
      error: s3Error("XAmzContentChecksumMismatch", 400),
      expected: StorageErrorCode.CHECKSUM_MISMATCH,
    },
    {
      label: "a denied request",
      error: s3Error("AccessDenied", 403),
      expected: StorageErrorCode.FORBIDDEN,
    },
    {
      label: "a forbidden status",
      error: s3Error("UnexpectedResponse", 403),
      expected: StorageErrorCode.FORBIDDEN,
    },
    {
      label: "a missing object",
      error: s3Error("NoSuchKey", 404),
      expected: StorageErrorCode.NOT_FOUND,
    },
    {
      label: "a not-found status",
      error: s3Error("UnexpectedResponse", 404),
      expected: StorageErrorCode.NOT_FOUND,
    },
    {
      label: "a server fault",
      error: s3Error("InternalError", 500),
      expected: StorageErrorCode.UNAVAILABLE,
    },
    {
      label: "an unclassified response",
      error: s3Error("ValidationException", 400),
      expected: StorageErrorCode.UNKNOWN,
    },
    {
      label: "a non-SDK failure",
      error: new Error("socket hang up"),
      expected: StorageErrorCode.UNAVAILABLE,
    },
    {
      label: "a non-error value",
      error: "boom",
      expected: StorageErrorCode.UNAVAILABLE,
    },
  ])("maps $label to $expected", ({ error, expected }) => {
    expect(toStorageError(error)).toMatchObject({ code: expected });
  });

  it("keeps the original failure as the cause", () => {
    const cause = s3Error("AccessDenied", 403);

    expect(toStorageError(cause).cause).toBe(cause);
  });

  it("returns an already translated error untouched", () => {
    const translated = toStorageError(s3Error("AccessDenied", 403));

    expect(toStorageError(translated)).toBe(translated);
  });
});
