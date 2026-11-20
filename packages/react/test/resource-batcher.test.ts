import { describe, expect, test } from "vitest";
import { resourceBatcherFor } from "../src/index.js";
import { givenClient } from "./support/client.js";

describe("the resource batcher", () => {
  test("gives one batcher per client, so hooks asking with it share calls", () => {
    const client = givenClient({});

    expect(resourceBatcherFor(client)).toBe(resourceBatcherFor(client));
    expect(resourceBatcherFor(givenClient({}))).not.toBe(resourceBatcherFor(client));
  });
});
