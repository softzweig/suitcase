import type { Operation } from "@softzweig/suitcase-core/contracts";
import { waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { UpdateResourceState } from "../src/index.js";
import { useUpdateResource } from "../src/index.js";
import { givenClient, resourceId, reused, type TestDefinition } from "./support/client.js";
import { renderWithClient } from "./support/render.js";

const renamed = { ...reused.resource, label: "renamed" } as const;

function updated(state: UpdateResourceState<TestDefinition>) {
  if (state.phase !== "updated") throw new Error(`expected updated, got ${state.phase}`);

  return state.result;
}

function failed(state: UpdateResourceState<TestDefinition>) {
  if (state.phase !== "failed") throw new Error(`expected failed, got ${state.phase}`);

  return state.error?.message;
}

describe("useUpdateResource", () => {
  test("reports an update from idle to updated", async () => {
    const calls: Operation[] = [];
    const { result } = renderWithClient(givenClient({ "resources.update": renamed }, calls), () =>
      useUpdateResource<TestDefinition>(),
    );

    expect(result.current.phase).toBe("idle");

    await result.current.update({ id: resourceId, label: "renamed" });

    await waitFor(() => expect(result.current.phase).toBe("updated"));
    expect(updated(result.current).label).toBe("renamed");
    expect(calls).toEqual(["resources.update"]);
  });

  test("carries the id and only the fields that may change", async () => {
    const client = givenClient<TestDefinition>({ "resources.update": renamed });
    const update = vi.spyOn(client.resources, "update");
    const { result } = renderWithClient(client, () => useUpdateResource<TestDefinition>());

    await result.current.update({ id: resourceId, label: "renamed", metadata: { tags: ["a"] } });

    expect(update).toHaveBeenCalledWith({
      id: resourceId,
      label: "renamed",
      metadata: { tags: ["a"] },
    });
  });

  test("keeps a refusal as state, instead of throwing at the component", async () => {
    const client = givenClient<TestDefinition>({
      "resources.update": new Error("Forbidden"),
    });
    const { result } = renderWithClient(client, () => useUpdateResource<TestDefinition>());

    await expect(result.current.update({ id: resourceId, label: "x" })).resolves.toBeUndefined();

    await waitFor(() => expect(result.current.phase).toBe("failed"));
    expect(failed(result.current)).toBe("Forbidden");
  });

  test("forgets the last outcome when reset", async () => {
    const { result } = renderWithClient(
      givenClient<TestDefinition>({ "resources.update": renamed }),
      () => useUpdateResource<TestDefinition>(),
    );

    await result.current.update({ id: resourceId, label: "renamed" });
    await waitFor(() => expect(result.current.phase).toBe("updated"));

    result.current.reset();

    await waitFor(() => expect(result.current.phase).toBe("idle"));
  });

  test("settles each update with its own resource, and follows the latest", async () => {
    const client = givenClient<TestDefinition>({});
    const second = { ...renamed, label: "second" } as const;
    const update = vi
      .spyOn(client.resources, "update")
      .mockResolvedValueOnce(renamed)
      .mockResolvedValueOnce(second);
    const { result } = renderWithClient(client, () => useUpdateResource<TestDefinition>());
    const { update: run } = result.current;

    const first = run({ id: resourceId, label: "renamed" });
    const later = run({ id: resourceId, label: "second" });

    await expect(first).resolves.toEqual(renamed);
    await expect(later).resolves.toEqual(second);
    await waitFor(() => expect(result.current.phase).toBe("updated"));
    expect(updated(result.current)).toEqual(second);
    expect(update).toHaveBeenCalledTimes(2);
  });

  test("keeps the state idle when it is reset while the call is still out", async () => {
    const client = givenClient<TestDefinition>({});
    let settle: (row: typeof renamed) => void = () => {};
    vi.spyOn(client.resources, "update").mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    const { result } = renderWithClient(client, () => useUpdateResource<TestDefinition>());

    const call = result.current.update({ id: resourceId, label: "renamed" });
    await waitFor(() => expect(result.current.phase).toBe("updating"));

    result.current.reset();
    await waitFor(() => expect(result.current.phase).toBe("idle"));

    // The row still reaches the caller, but the dismissed state stays dismissed.
    settle(renamed);

    await expect(call).resolves.toEqual(renamed);
    expect(result.current.phase).toBe("idle");
  });
});
