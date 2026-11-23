import { describe, expect, test } from "vitest";
import { ProcessorError } from "../src/error.js";
import type { ProcessorRule } from "../src/processor.js";
import {
  bytes,
  constraints,
  createClient,
  file,
  finalized,
  operations,
  reused,
  reusing,
  sendTo,
  sentClaims,
  upload,
} from "./support/upload-client.js";

/** Ends with a smaller webp, which is what a real image processor would hand back. */
const toWebp = (size = 6): ProcessorRule => ({
  name: "webp",
  process: async () => ({
    arrayBuffer: async () => new ArrayBuffer(size),
    name: "avatar.webp",
    size,
    type: "image/webp",
  }),
});

/** Passes the file through untouched. */
const untouched: ProcessorRule = { name: "untouched", process: async ({ value }) => value };

/** Fails if it is ever reached, which is how a test says "this one must not run". */
const mustNotRun = (name: string): ProcessorRule => ({
  name,
  process: async () => {
    throw new Error(`processor ${name} ran`);
  },
});

const throwing = {
  work: {
    name: "broken",
    process: async () => {
      throw new Error("no canvas");
    },
  },
  predicate: {
    name: "broken",
    when: () => {
      throw new Error("bad predicate");
    },
    process: async ({ value }) => value,
  },
} satisfies Record<string, ProcessorRule>;

describe("running the rules", () => {
  test("claims what the processors produced", async () => {
    const { calls, client, transferred } = createClient(
      {
        "uploads.constraints": constraints({ maxSize: bytes("1 MB"), mimeTypes: ["image/webp"] }),
        "uploads.finalize": finalized,
        "uploads.initialize": sendTo("https://storage.test/avatar.webp"),
      },
      { processors: [toWebp(6), untouched] },
    );

    await upload(client);

    expect(sentClaims(calls)).toMatchObject({
      fileName: "avatar.webp",
      mimeType: "image/webp",
      size: 6,
    });
    expect(operations(calls)).toEqual([
      "uploads.constraints",
      "uploads.initialize",
      "uploads.finalize",
    ]);
    expect(transferred.map(({ url }) => url)).toEqual(["https://storage.test/avatar.webp"]);
  });

  test("leaves the file alone when the predicate says no", async () => {
    const { calls, client } = createClient(reusing(), {
      processors: [{ ...toWebp(), when: ({ file: picked }) => picked.type === "image/gif" }],
    });

    await upload(client);

    expect(sentClaims(calls)).toMatchObject({
      fileName: "avatar.png",
      mimeType: "image/png",
      size: 12,
    });
  });

  test("checks the limits against the processed file, not the picked one", async () => {
    const { client } = createClient(
      reusing({ "uploads.constraints": constraints({ maxSize: bytes("1 KB") }) }),
      { processors: [toWebp(512)] },
    );

    await expect(upload(client, { file: file(bytes("4 KiB")) })).resolves.toEqual(reused);
  });

  test("shows a predicate the file as picked, not what a processor produced", async () => {
    const seen: string[] = [];
    const { client } = createClient(reusing(), {
      processors: [
        toWebp(),
        {
          name: "after-webp",
          process: async ({ value }) => value,
          when: ({ file: picked }) => {
            seen.push(picked.type);
            return false;
          },
        },
      ],
    });

    await upload(client);

    // The rule before it turned the file into a webp; the predicate still decides on the picked png.
    expect(seen).toEqual(["image/png"]);
  });

  test("feeds each processor what the one before it produced", async () => {
    const seen: number[] = [];
    const { client } = createClient(reusing(), {
      processors: [
        toWebp(6),
        {
          name: "after-webp",
          process: async ({ value }) => {
            seen.push(value.size);
            return value;
          },
        },
      ],
    });

    await upload(client);

    // The picked file is 12 bytes; 6 is what the webp rule handed over.
    expect(seen).toEqual([6]);
  });
});

describe("failures", () => {
  test.for([
    { case: "its work fails", rule: throwing.work },
    { case: "its predicate fails", rule: throwing.predicate },
  ])("fails the upload when $case", async ({ rule }) => {
    const { calls, client } = createClient(reusing(), { processors: [rule] });

    await expect(upload(client)).rejects.toBeInstanceOf(ProcessorError);
    expect(operations(calls)).toEqual(["uploads.constraints"]);
  });
});

describe("cancellation", () => {
  test("stops before the next processor when aborted", async () => {
    const controller = new AbortController();
    const { client } = createClient(reusing(), {
      processors: [
        {
          name: "abort",
          process: async ({ value }) => {
            controller.abort();
            return value;
          },
        },
        // Reaching this would fail the upload as a ProcessorError, so the AbortError proves it did not.
        mustNotRun("after-abort"),
      ],
    });

    await expect(upload(client, { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});
