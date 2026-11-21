import { renderHook } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { useSuitcaseClient, useUploadQueue } from "../src/index.js";
import { givenClient, reusing, type TestDefinition } from "./support/client.js";
import { renderWithClient } from "./support/render.js";

describe("the provider", () => {
  test("hands its client to the hooks below it", () => {
    const client = givenClient(reusing());

    const { result } = renderWithClient(client, () => useSuitcaseClient<TestDefinition>());

    expect(result.current).toBe(client);
  });

  test("holds one upload queue for the tree", () => {
    const client = givenClient(reusing());
    const { result, rerender } = renderWithClient(client, () => useUploadQueue());

    const uploads = result.current;
    rerender();

    expect(result.current).toBe(uploads);
  });

  test("refuses to answer outside a provider", () => {
    expect(() => renderHook(() => useSuitcaseClient<TestDefinition>())).toThrow(/SuitcaseProvider/);
    expect(() => renderHook(() => useUploadQueue())).toThrow(/SuitcaseProvider/);
  });
});
