import { SuitcaseClientError } from "@softzweig/suitcase-client";
import { ServiceErrorCode } from "@softzweig/suitcase-core";
import { expect, test } from "vitest";
import { createHttpTransport } from "../src/index.js";

const constraints = { hasIntent: true, maxSize: null, mimeTypes: null };

/** A fetch double: it records what it was asked and answers with what the test registers. */
const answering = (status: number, body: unknown) => {
  const sent: { input: string; init?: RequestInit }[] = [];

  const fetch = (async (input: string, init?: RequestInit) => {
    sent.push({ init, input });
    return new Response(JSON.stringify(body), { status });
  }) as typeof globalThis.fetch;

  return { fetch, sent };
};

test("posts the operation and its input as JSON", async () => {
  const { fetch, sent } = answering(200, { data: constraints, ok: true });
  const transport = createHttpTransport({
    fetch,
    headers: { authorization: "Bearer token" },
    url: "https://api.test/suitcase/",
  });

  await expect(
    transport.call({ input: { kind: "avatar" }, operation: "uploads.constraints" }),
  ).resolves.toEqual(constraints);

  expect(sent[0]?.input).toBe("https://api.test/suitcase/uploads.constraints");
  expect(sent[0]?.init).toMatchObject({
    body: JSON.stringify({ kind: "avatar" }),
    headers: { authorization: "Bearer token", "content-type": "application/json" },
    method: "POST",
  });
});

test("asks configure for headers on every call, and its answer wins", async () => {
  const { fetch, sent } = answering(200, { data: constraints, ok: true });
  let user = "ada";
  const transport = createHttpTransport({
    configure: () => ({ headers: { "x-user": user } }),
    fetch,
    headers: { "x-static": "kept", "x-user": "ignored" },
    url: "https://api.test",
  });

  await transport.call({ input: { kind: "avatar" }, operation: "uploads.constraints" });
  user = "grace";
  await transport.call({ input: { kind: "avatar" }, operation: "uploads.constraints" });

  expect(sent[0]?.init?.headers).toMatchObject({ "x-static": "kept", "x-user": "ada" });
  expect(sent[1]?.init?.headers).toMatchObject({ "x-user": "grace" });
});

test("sends a call through the fetch configure hands it", async () => {
  const own = answering(200, { data: constraints, ok: true });
  const fallback = answering(200, { data: constraints, ok: true });
  const transport = createHttpTransport({
    configure: () => ({ fetch: own.fetch }),
    fetch: fallback.fetch,
    url: "https://api.test",
  });

  await transport.call({ input: { kind: "avatar" }, operation: "uploads.constraints" });

  expect(own.sent).toHaveLength(1);
  expect(fallback.sent).toHaveLength(0);
});

test("throws with the code the server refused with", async () => {
  const { fetch } = answering(412, {
    code: "precondition_failed",
    details: { maxSize: 1_000 },
    message: "The file is too large.",
    ok: false,
  });
  const transport = createHttpTransport({ fetch, url: "https://api.test" });

  const refused = transport.call({ input: { kind: "avatar" }, operation: "uploads.constraints" });

  await expect(refused).rejects.toBeInstanceOf(SuitcaseClientError);
  await expect(refused).rejects.toMatchObject({
    code: ServiceErrorCode.PRECONDITION_FAILED,
    details: { maxSize: 1_000 },
    message: "The file is too large.",
  });
});

test("refuses an answer that is not a Suitcase result", async () => {
  const { fetch } = answering(502, "<html>bad gateway</html>");
  const transport = createHttpTransport({ fetch, url: "https://api.test" });

  await expect(
    transport.call({ input: { kind: "avatar" }, operation: "uploads.constraints" }),
  ).rejects.toMatchObject({ code: ServiceErrorCode.UNKNOWN, details: { status: 502 } });
});

test("refuses an answer whose payload is not what the operation promises", async () => {
  // The envelope is well formed; only the operation's own output schema can tell.
  const { fetch } = answering(200, { data: { hasIntent: "yes" }, ok: true });
  const transport = createHttpTransport({ fetch, url: "https://api.test" });

  await expect(
    transport.call({ input: { kind: "avatar" }, operation: "uploads.constraints" }),
  ).rejects.toMatchObject({ code: ServiceErrorCode.UNKNOWN, details: { status: 200 } });
});
