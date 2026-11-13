import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ServiceErrorCode, ServiceFailureSchema, serviceResultSchema } from "../../src/index.js";

const RowSchema = z.object({ id: z.uuid() });
const ResultSchema = serviceResultSchema(RowSchema);
const row = { id: "3f7c1d9e-6b1a-4c2f-9d0e-5a8b7c6d5e4f" };

describe("ServiceFailureSchema", () => {
  it("accepts a code from the shared set", () => {
    const parsed = ServiceFailureSchema.parse({
      ok: false,
      code: ServiceErrorCode.NOT_FOUND,
      message: "asset missing",
    });

    expect(parsed.code).toBe("not_found");
  });

  it("rejects a code outside the shared set", () => {
    const result = ServiceFailureSchema.safeParse({ ok: false, code: "teapot", message: "no" });

    expect(result.success).toBe(false);
  });
});

describe("serviceResultSchema", () => {
  it("accepts a success payload", () => {
    const parsed = ResultSchema.parse({ ok: true, data: row });

    expect(parsed.ok && parsed.data).toEqual(row);
  });

  it("accepts a failure", () => {
    const parsed = ResultSchema.parse({
      ok: false,
      code: ServiceErrorCode.INVALID_INPUT,
      message: "id is not a uuid",
      details: { field: "id" },
    });

    expect(parsed.ok).toBe(false);
  });

  it("rejects a success with a malformed payload", () => {
    const result = ResultSchema.safeParse({ ok: true, data: { id: "not-a-uuid" } });

    expect(result.success).toBe(false);
  });
});
