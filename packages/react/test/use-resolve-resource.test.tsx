import type { Operation } from "@softzweig/suitcase-core/contracts";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, expectTypeOf, test } from "vitest";
import type { ResolveResourceKindInput, ResolveResourceState } from "../src/index.js";
import { useResolveResource, useResolveResources } from "../src/index.js";
import {
  download,
  givenClient,
  missing,
  type OpenDefinition,
  resourceId,
  type TestDefinition,
} from "./support/client.js";

const context = { userId: "u_1" };
const contexts = { avatar: context };

function entry(state: ResolveResourceState) {
  if (state.phase !== "resolved") throw new Error(`expected resolved, got ${state.phase}`);

  return state.entry;
}

describe("useResolveResource", () => {
  test("requires the context a kind declares, and only then", () => {
    expectTypeOf<ResolveResourceKindInput<TestDefinition, "avatar">["contexts"]>().toEqualTypeOf<{
      userId: string;
    }>();
    expectTypeOf<
      ResolveResourceKindInput<OpenDefinition, "avatar">["contexts"]
    >().toEqualTypeOf<undefined>();
  });

  test("hands back the entry for one id", async () => {
    const client = givenClient({ "resources.resolve": [download] });

    const { result } = renderHook(() =>
      useResolveResource(client, "avatar", { contexts: context, id: resourceId }),
    );

    await waitFor(() => expect(result.current.phase).toBe("resolved"));
    expect(entry(result.current)).toEqual(download);
  });

  test("takes one kind, many kinds, or none before the input", async () => {
    const client = givenClient({ "resources.resolve": [download] });

    const { result } = renderHook(() => ({
      one: useResolveResource(client, "avatar", { contexts: context, id: resourceId }),
      many: useResolveResource(client, ["avatar"], { contexts, id: resourceId }),
      none: useResolveResource(client, { contexts, id: resourceId }),
    }));

    await waitFor(() => expect(result.current.none.phase).toBe("resolved"));
    expect(entry(result.current.one)).toEqual(download);
    expect(entry(result.current.many)).toEqual(download);
    expect(entry(result.current.none)).toEqual(download);
  });

  test("shares a call with a plural hook asking in the same tick", async () => {
    const other = crypto.randomUUID();
    const calls: Operation[] = [];
    const client = givenClient(
      { "resources.resolve": [download, { ...missing, id: other }] },
      calls,
    );

    const { result } = renderHook(() => ({
      one: useResolveResource(client, "avatar", { contexts: context, id: resourceId }),
      many: useResolveResources(client, { contexts, ids: [other] }),
    }));

    await waitFor(() => expect(result.current.many.phase).toBe("resolved"));

    expect(calls.filter((operation) => operation === "resources.resolve")).toHaveLength(1);
    expect(entry(result.current.one)).toEqual(download);
  });

  test("keeps a refusal as state", async () => {
    const client = givenClient({ "resources.resolve": new Error("the request never arrived") });

    const { result } = renderHook(() =>
      useResolveResource(client, "avatar", { contexts: context, id: resourceId }),
    );

    await waitFor(() => expect(result.current.phase).toBe("failed"));
    expect(result.current.phase === "failed" && result.current.error?.message).toBe(
      "the request never arrived",
    );
  });

  test("leaves the context out for a kind that declares no claim", async () => {
    const client = givenClient<OpenDefinition>({ "resources.resolve": [download] });

    const { result } = renderHook(() => useResolveResource(client, "avatar", { id: resourceId }));

    await waitFor(() => expect(result.current.phase).toBe("resolved"));
    expect(entry(result.current)).toEqual(download);
  });

  test("hands back no entry when the backend omits the id", async () => {
    const client = givenClient({ "resources.resolve": [] });

    const { result } = renderHook(() =>
      useResolveResource(client, "avatar", { contexts: context, id: resourceId }),
    );

    await waitFor(() => expect(result.current.phase).toBe("resolved"));
    expect(entry(result.current)).toBeUndefined();
  });
});
