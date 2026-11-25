import type { Operation } from "@softzweig/suitcase-core/contracts";
import { waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { DeleteResourceState } from "../src/index.js";
import { useDeleteResource } from "../src/index.js";
import { givenClient, resourceId, reused, type TestDefinition } from "./support/client.js";
import { renderWithClient } from "./support/render.js";

function deleted(state: DeleteResourceState<TestDefinition>) {
  if (state.phase !== "deleted") throw new Error(`expected deleted, got ${state.phase}`);

  return state.result;
}

function failed(state: DeleteResourceState<TestDefinition>) {
  if (state.phase !== "failed") throw new Error(`expected failed, got ${state.phase}`);

  return state.error?.message;
}

describe("useDeleteResource", () => {
  test("reports a deletion from idle to deleted", async () => {
    const calls: Operation[] = [];
    const { result } = renderWithClient(
      givenClient({ "resources.delete": reused.resource }, calls),
      () => useDeleteResource<TestDefinition>(),
    );

    expect(result.current.phase).toBe("idle");

    await result.current.remove(resourceId);

    await waitFor(() => expect(result.current.phase).toBe("deleted"));
    expect(deleted(result.current).id).toBe(resourceId);
    expect(calls).toEqual(["resources.delete"]);
  });

  test("sends the requested id", async () => {
    const client = givenClient<TestDefinition>({ "resources.delete": reused.resource });
    const remove = vi.spyOn(client.resources, "delete");
    const { result } = renderWithClient(client, () => useDeleteResource<TestDefinition>());

    await result.current.remove(resourceId);

    expect(remove).toHaveBeenCalledWith({ resourceId });
  });

  test("keeps a refusal as state, instead of throwing at the component", async () => {
    const client = givenClient<TestDefinition>({
      "resources.delete": new Error("Forbidden"),
    });
    const { result } = renderWithClient(client, () => useDeleteResource<TestDefinition>());

    await expect(result.current.remove(resourceId)).resolves.toBeUndefined();

    await waitFor(() => expect(result.current.phase).toBe("failed"));
    expect(failed(result.current)).toBe("Forbidden");
  });

  test("forgets the last outcome when reset", async () => {
    const { result } = renderWithClient(
      givenClient<TestDefinition>({ "resources.delete": reused.resource }),
      () => useDeleteResource<TestDefinition>(),
    );

    await result.current.remove(resourceId);
    await waitFor(() => expect(result.current.phase).toBe("deleted"));

    result.current.reset();

    await waitFor(() => expect(result.current.phase).toBe("idle"));
  });

  test("settles each call with its own row, and follows the latest", async () => {
    const client = givenClient<TestDefinition>({});
    const other = crypto.randomUUID();
    const second = { ...reused.resource, id: other } as const;
    const remove = vi
      .spyOn(client.resources, "delete")
      .mockResolvedValueOnce(reused.resource)
      .mockResolvedValueOnce(second);
    const { result } = renderWithClient(client, () => useDeleteResource<TestDefinition>());
    const { remove: run } = result.current;

    const first = run(resourceId);
    const later = run(other);

    await expect(first).resolves.toEqual(reused.resource);
    await expect(later).resolves.toEqual(second);
    await waitFor(() => expect(result.current.phase).toBe("deleted"));
    expect(deleted(result.current).id).toBe(other);
    expect(remove).toHaveBeenCalledTimes(2);
  });

  test("keeps the state idle when it is reset while the call is still out", async () => {
    const client = givenClient<TestDefinition>({});
    let settle: (row: typeof reused.resource) => void = () => {};
    vi.spyOn(client.resources, "delete").mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    const { result } = renderWithClient(client, () => useDeleteResource<TestDefinition>());

    const call = result.current.remove(resourceId);
    await waitFor(() => expect(result.current.phase).toBe("deleting"));

    result.current.reset();
    await waitFor(() => expect(result.current.phase).toBe("idle"));

    // The row still reaches the caller, but the dismissed state stays dismissed.
    settle(reused.resource);

    await expect(call).resolves.toEqual(reused.resource);
    expect(result.current.phase).toBe("idle");
  });
});
