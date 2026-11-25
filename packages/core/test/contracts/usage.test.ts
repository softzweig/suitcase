import { describe, expect, it } from "vitest";

import {
  type SuitcaseResourceUsage,
  type SuitcaseUploadUsage,
  SuitcaseUsageRequestSchema,
  SuitcaseUsageSchema,
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

describe("usage schemas", () => {
  it("reads a document of any scope", () => {
    expect(SuitcaseUsageSchema.parse(givenResourceUsage(1, 10)).scope).toBe("resource");
    expect(SuitcaseUsageSchema.parse(givenUploadUsage(1, 10)).scope).toBe("upload");
    expect(
      SuitcaseUsageSchema.parse(totalUsage(givenResourceUsage(1, 10), givenUploadUsage(1, 10))),
    ).toMatchObject({ scope: "total", size: 20 });
  });

  it("refuses a scope the contract does not define", () => {
    expect(SuitcaseUsageSchema.safeParse({ scope: "tenant", size: 1 }).success).toBe(false);
  });

  it("asks for at least one kind and an owner", () => {
    expect(
      SuitcaseUsageRequestSchema.safeParse({ kinds: [], owner: { userId: "u_1" } }).success,
    ).toBe(false);
    expect(SuitcaseUsageRequestSchema.safeParse({ kinds: ["avatar"] }).success).toBe(false);
    expect(
      SuitcaseUsageRequestSchema.safeParse({ kinds: ["avatar"], owner: { userId: "u_1" } }).success,
    ).toBe(true);
  });
});
