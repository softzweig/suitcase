import { ServiceErrorCode } from "@softzweig/suitcase-core";
import { describe, expect, it, test } from "vitest";
import { ServiceError } from "../../src/services/service.error.js";
import { toServiceFailure } from "../../src/services/service.result.js";
import { StorageError, StorageErrorCode } from "../../src/storage/storage.errors.js";

describe("toServiceFailure", () => {
  test.for(Object.values(StorageErrorCode))("maps the %s storage code", (storageCode) => {
    const failure = toServiceFailure(new StorageError(storageCode, "nope"));

    expect(failure.ok).toBe(false);
    expect(Object.values(ServiceErrorCode)).toContain(failure.code);
  });

  it("keeps the storage message and code", () => {
    const failure = toServiceFailure(
      new StorageError(StorageErrorCode.CHECKSUM_MISMATCH, "digest mismatch"),
    );

    expect(failure).toEqual({
      ok: false,
      code: ServiceErrorCode.CONFLICT,
      message: "digest mismatch",
      details: { type: "storageError", code: "checksum_mismatch" },
    });
  });

  it("classifies a missing bucket as unavailable", () => {
    const failure = toServiceFailure(
      new StorageError(StorageErrorCode.BUCKET_MISSING, "no bucket"),
    );

    expect(failure.code).toBe(ServiceErrorCode.UNAVAILABLE);
  });

  it("hides the message of an unexpected error", () => {
    const failure = toServiceFailure(new Error("connect ECONNREFUSED 10.0.0.1:5432"));

    expect(failure).toEqual({
      ok: false,
      code: ServiceErrorCode.UNKNOWN,
      message: "Unexpected failure",
    });
  });

  it("classifies a non-error throw", () => {
    expect(toServiceFailure("boom").code).toBe(ServiceErrorCode.UNKNOWN);
  });

  it("keeps the code and details of a domain error", () => {
    const failure = toServiceFailure(ServiceError.conflict("duplicate digest", { hashHex: "ab" }));

    expect(failure).toEqual({
      ok: false,
      code: ServiceErrorCode.CONFLICT,
      message: "duplicate digest",
      details: { hashHex: "ab" },
    });
  });
});
