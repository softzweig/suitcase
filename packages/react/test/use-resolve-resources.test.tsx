import type { Operation, ResourceDownload } from "@softzweig/suitcase-core/contracts";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { ResolveResourcesState } from "../src/index.js";
import { useResolveResources } from "../src/index.js";
import { download, givenClient, missing, resourceId } from "./support/client.js";

const contexts = { avatar: { userId: "u_1" } };

function deferred<TValue>() {
  let settle!: (value: TValue) => void;
  const promise = new Promise<TValue>((resolve) => {
    settle = resolve;
  });

  return { promise, settle };
}

function resolved(state: ResolveResourcesState) {
  if (state.phase !== "resolved") throw new Error(`expected resolved, got ${state.phase}`);

  return state.entries;
}

function failed(state: ResolveResourcesState) {
  if (state.phase !== "failed") throw new Error(`expected failed, got ${state.phase}`);

  return state.error?.message;
}

describe("useResolveResources", () => {
  test("asks for nothing when it is given nothing", async () => {
    const client = givenClient({});

    const { result } = renderHook(() => useResolveResources(client, { contexts, ids: [] }));

    await waitFor(() => expect(result.current.phase).toBe("resolved"));
    expect(resolved(result.current)).toEqual([]);
  });

  test("hands back one entry per requested id", async () => {
    const other = crypto.randomUUID();
    const client = givenClient({ "resources.resolve": [download, { ...missing, id: other }] });

    const { result } = renderHook(() =>
      useResolveResources(client, { contexts, ids: [resourceId, other] }),
    );

    await waitFor(() => expect(result.current.phase).toBe("resolved"));
    expect(resolved(result.current)).toEqual([download, { ...missing, id: other }]);
  });

  test("merges the ids two hooks ask for in the same tick into one call", async () => {
    const other = crypto.randomUUID();
    const calls: Operation[] = [];
    const client = givenClient(
      { "resources.resolve": [download, { ...missing, id: other }] },
      calls,
    );

    const { result } = renderHook(() => ({
      first: useResolveResources(client, { contexts, ids: [resourceId] }),
      second: useResolveResources(client, {
        contexts: { avatar: { userId: "u_1" } },
        ids: [other],
      }),
    }));

    await waitFor(() => expect(result.current.second.phase).toBe("resolved"));

    expect(calls.filter((operation) => operation === "resources.resolve")).toHaveLength(1);
    expect(resolved(result.current.first)).toEqual([download]);
    expect(resolved(result.current.second)).toEqual([{ ...missing, id: other }]);
  });

  test("takes one kind or many before the input", async () => {
    const client = givenClient({ "resources.resolve": [download] });

    const { result } = renderHook(() => ({
      one: useResolveResources(client, "avatar", {
        contexts: { userId: "u_1" },
        ids: [resourceId],
      }),
      many: useResolveResources(client, ["avatar"], { contexts, ids: [resourceId] }),
    }));

    await waitFor(() => expect(result.current.many.phase).toBe("resolved"));
    expect(resolved(result.current.one)).toEqual([download]);
    expect(resolved(result.current.many)).toEqual([download]);
  });

  test("resolves again when the contexts change, and not when they do not", async () => {
    const calls: Operation[] = [];
    const client = givenClient({ "resources.resolve": [download] }, calls);
    const { result, rerender } = renderHook(
      ({ contexts }: { contexts: { avatar: { userId: string } } }) =>
        useResolveResources(client, { contexts, ids: [resourceId] }),
      { initialProps: { contexts } },
    );

    await waitFor(() => expect(result.current.phase).toBe("resolved"));

    rerender({ contexts: { avatar: { userId: "u_1" } } });
    rerender({ contexts: { avatar: { userId: "u_2" } } });

    await waitFor(() => expect(result.current.phase).toBe("resolved"));
    expect(calls.filter((operation) => operation === "resources.resolve")).toHaveLength(2);
  });

  test("keeps a refusal as state", async () => {
    const client = givenClient({ "resources.resolve": new Error("the request never arrived") });

    const { result } = renderHook(() =>
      useResolveResources(client, { contexts, ids: [resourceId] }),
    );

    await waitFor(() => expect(result.current.phase).toBe("failed"));
    expect(failed(result.current)).toBe("the request never arrived");
  });

  test("asks once per context set, since a call carries one", async () => {
    const other = crypto.randomUUID();
    const calls: Operation[] = [];
    const client = givenClient(
      { "resources.resolve": [download, { ...missing, id: other }] },
      calls,
    );

    const { result } = renderHook(() => ({
      first: useResolveResources(client, { contexts, ids: [resourceId] }),
      second: useResolveResources(client, {
        contexts: { avatar: { userId: "u_2" } },
        ids: [other],
      }),
    }));

    await waitFor(() => expect(result.current.second.phase).toBe("resolved"));

    expect(calls.filter((operation) => operation === "resources.resolve")).toHaveLength(2);
  });

  test("ignores an answer a newer request has replaced", async () => {
    const slow = deferred<ResourceDownload[]>();
    const client = givenClient({});
    const resolve = vi
      .spyOn(client.resources, "resolve")
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce([download]);

    const { result, rerender } = renderHook(
      ({ contexts }: { contexts: { avatar: { userId: string } } }) =>
        useResolveResources(client, { contexts, ids: [resourceId] }),
      { initialProps: { contexts } },
    );

    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));

    rerender({ contexts: { avatar: { userId: "u_2" } } });
    await waitFor(() => expect(resolved(result.current)).toEqual([download]));

    slow.settle([{ ...missing, id: resourceId }]);
    await slow.promise;
    await Promise.resolve();

    expect(resolved(result.current)).toEqual([download]);
  });

  test("stays silent when an answer lands after unmount", async () => {
    const slow = deferred<ResourceDownload[]>();
    const client = givenClient({});
    vi.spyOn(client.resources, "resolve").mockReturnValue(slow.promise);

    const { result, unmount } = renderHook(() =>
      useResolveResources(client, { contexts, ids: [resourceId] }),
    );

    await waitFor(() => expect(result.current.phase).toBe("loading"));
    unmount();

    slow.settle([download]);
    await slow.promise;
    await Promise.resolve();

    expect(result.current.phase).toBe("loading");
  });
});
