import { describe, expect, it } from "vitest";

import {
  type SuitcaseResourceUsage,
  type SuitcaseUploadUsage,
  totalUsage,
} from "../../src/contracts/usage.js";

const givenResourceUsage = (resourceCount: number, size: number): SuitcaseResourceUsage => ({
  resourceCount,
  scope: "resource",
  size,
});

const givenUploadUsage = (uploadCount: number, size: number): SuitcaseUploadUsage => ({
  scope: "upload",
  size,
  uploadCount,
});

describe("totalUsage", () => {
  it("adds the counts and sizes of both scopes", () => {
    const total = totalUsage(givenResourceUsage(2, 350), givenUploadUsage(3, 192));

    expect(total).toEqual({ resourceCount: 2, scope: "total", size: 542, uploadCount: 3 });
  });

  it("leaves an empty scope out of the sum", () => {
    const total = totalUsage(givenResourceUsage(1, 500), givenUploadUsage(0, 0));

    expect(total).toEqual({ resourceCount: 1, scope: "total", size: 500, uploadCount: 0 });
  });

  it("answers zero when both scopes are empty", () => {
    const total = totalUsage(givenResourceUsage(0, 0), givenUploadUsage(0, 0));

    expect(total).toEqual({ resourceCount: 0, scope: "total", size: 0, uploadCount: 0 });
  });
});
