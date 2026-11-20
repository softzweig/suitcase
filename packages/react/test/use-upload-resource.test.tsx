import { waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { UploadState } from "../src/index.js";
import { useUploadQueue, useUploadResource } from "../src/index.js";
import { file, givenClient, reused, reusing, type TestDefinition } from "./support/client.js";
import { renderWithClient } from "./support/render.js";

const avatarUpload = { file, intent: { folderId: "f_1" }, kind: "avatar" } as const;

function uploaded(state: UploadState<TestDefinition>) {
  if (state.phase !== "uploaded") throw new Error(`expected uploaded, got ${state.phase}`);

  return state.result;
}

function failed(state: UploadState<TestDefinition>) {
  if (state.phase !== "failed") throw new Error(`expected failed, got ${state.phase}`);

  return state.error?.message;
}

describe("useUploadResource", () => {
  test("reports an upload from idle to uploaded", async () => {
    const { result } = renderWithClient(givenClient(reusing()), () =>
      useUploadResource<TestDefinition>(),
    );

    expect(result.current.phase).toBe("idle");

    await result.current.upload(avatarUpload);

    await waitFor(() => expect(result.current.phase).toBe("uploaded"));
    expect(uploaded(result.current).reused).toBe(true);
  });

  test("keeps a failure as state, instead of throwing at the component", async () => {
    const client = givenClient(reusing({ "uploads.constraints": new Error("the disk is full") }));

    const { result } = renderWithClient(client, () => useUploadResource<TestDefinition>());

    await result.current.upload(avatarUpload);

    await waitFor(() => expect(result.current.phase).toBe("failed"));
    expect(failed(result.current)).toBe("the disk is full");
  });

  test("forgets the last outcome when reset", async () => {
    const { result } = renderWithClient(givenClient(reusing()), () =>
      useUploadResource<TestDefinition>(),
    );

    await result.current.upload(avatarUpload);
    await waitFor(() => expect(result.current.phase).toBe("uploaded"));

    result.current.reset();

    await waitFor(() => expect(result.current.phase).toBe("idle"));
  });

  test("aborts the upload when the component unmounts", async () => {
    const client = givenClient(reusing());
    const start = vi.spyOn(client.upload, "start").mockReturnValue(new Promise(() => {}));

    const { result, unmount } = renderWithClient(client, () => useUploadResource<TestDefinition>());

    void result.current.upload(avatarUpload);
    await waitFor(() => expect(start).toHaveBeenCalled());

    unmount();

    expect(start.mock.calls[0]?.[0].signal?.aborted).toBe(true);
  });

  test("settles each upload with its own result, and follows the latest", async () => {
    const client = givenClient(reusing());
    const second = { ...reused, upload: { ...reused.upload, fileName: "dog.png" } };
    const start = vi
      .spyOn(client.upload, "start")
      .mockResolvedValueOnce(reused)
      .mockResolvedValueOnce(second);

    const { result } = renderWithClient(client, () => useUploadResource<TestDefinition>());
    const { upload } = result.current;

    const first = upload(avatarUpload);
    const later = upload(avatarUpload);

    await expect(first).resolves.toEqual(reused);
    await expect(later).resolves.toEqual(second);
    await waitFor(() => expect(result.current.phase).toBe("uploaded"));
    expect(uploaded(result.current)).toEqual(second);
    expect(start).toHaveBeenCalledTimes(2);
  });

  test("stops when the caller's own signal aborts", async () => {
    const client = givenClient(reusing());
    const start = vi.spyOn(client.upload, "start").mockReturnValue(new Promise(() => {}));
    const { result } = renderWithClient(client, () => useUploadResource<TestDefinition>());
    const abort = new AbortController();

    void result.current.upload({ ...avatarUpload, signal: abort.signal });
    await waitFor(() => expect(start).toHaveBeenCalled());

    abort.abort();

    expect(start.mock.calls[0]?.[0].signal?.aborted).toBe(true);
  });

  test("drops a queued upload when the component unmounts", async () => {
    const client = givenClient(reusing());
    const start = vi.spyOn(client.upload, "start").mockReturnValue(new Promise(() => {}));
    const { result, unmount } = renderWithClient(client, () => ({
      queue: useUploadQueue(),
      handlers: useUploadResource<TestDefinition>(),
    }));
    const { queue } = result.current;

    queue.pause();
    void result.current.handlers.upload(avatarUpload);
    await waitFor(() => expect(queue.size()).toBe(1));

    unmount();

    await waitFor(() => expect(queue.size()).toBe(0));
    expect(start).not.toHaveBeenCalled();
  });
});
