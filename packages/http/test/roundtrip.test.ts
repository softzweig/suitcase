import { SuitcaseClientError } from "@softzweig/suitcase-client";
import { ServiceErrorCode } from "@softzweig/suitcase-core";
import type { ServiceOperations } from "@softzweig/suitcase-core/contracts";
import { expect, test } from "vitest";
import { createHttpHandler } from "../src/handler.js";
import { createHttpTransport } from "../src/index.js";

const constraints = { hasIntent: true, maxSize: 1_000, mimeTypes: ["image/png"] };
const input = { kind: "avatar" };

const notCalled = () => Promise.reject(new Error("not part of this test"));

/** A client transport talking to this package's own handler through a real `Request`/`Response`. */
const paired = (constraints: ServiceOperations["uploads.constraints"]) => {
  const handler = createHttpHandler(() => ({
    "resources.delete": notCalled,
    "resources.resolve": notCalled,
    "resources.update": notCalled,
    "uploads.constraints": constraints,
    "uploads.finalize": notCalled,
    "uploads.initialize": notCalled,
  }));

  return createHttpTransport({
    fetch: (request, init) => handler(new Request(request, init)),
    url: "https://api.test/suitcase",
  });
};

test("carries an answer back to the client", async () => {
  const transport = paired(() => ({ data: constraints, ok: true }) as const);

  await expect(transport.call({ input, operation: "uploads.constraints" })).resolves.toEqual(
    constraints,
  );
});

test("carries a refusal back to the client as a client error", async () => {
  const transport = paired(() => {
    throw Object.assign(new Error("The file is too large."), {
      code: ServiceErrorCode.PRECONDITION_FAILED,
      details: { maxSize: 1_000 },
    });
  });

  const refused = transport.call({ input, operation: "uploads.constraints" });

  await expect(refused).rejects.toBeInstanceOf(SuitcaseClientError);
  await expect(refused).rejects.toMatchObject({
    code: ServiceErrorCode.PRECONDITION_FAILED,
    details: { maxSize: 1_000 },
    message: "The file is too large.",
  });
});
