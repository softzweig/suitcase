import type { SuitcaseClient } from "@softzweig/suitcase-client";
import type { ClientDefinition } from "@softzweig/suitcase-core/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { useUploadQueue } from "./suitcase-context.js";

export type UploadInput<TDefinition extends ClientDefinition> = Parameters<
  SuitcaseClient<TDefinition>["upload"]["start"]
>[0];

export type UploadResult<TDefinition extends ClientDefinition> = Awaited<
  ReturnType<SuitcaseClient<TDefinition>["upload"]["start"]>
>;

export type UploadState<TDefinition extends ClientDefinition = ClientDefinition> =
  | { phase: "idle" | "uploading"; error?: never; result?: never }
  | { phase: "uploaded"; result: UploadResult<TDefinition>; error?: never }
  | { phase: "failed"; error: Error; result?: never };

export type UploadPhase = UploadState["phase"];

export type UploadHandlers<TDefinition extends ClientDefinition> = UploadState<TDefinition> & {
  /** Settles with the result, or `undefined` when it failed. */
  upload(input: UploadInput<TDefinition>): Promise<UploadResult<TDefinition> | undefined>;
  reset(): void;
};

/**
 * Queues uploads through the provider's queue and reports where the latest one got to; failures
 * are state, not throws.
 *
 * Each call settles with its own result, while the state follows the most recent call, so two
 * uploads started in a row do not blur together. Unmounting aborts whatever is still in flight,
 * which drops it from the queue or stops it inside `upload.start`.
 */
export function useUploadResource<
  TDefinition extends ClientDefinition = ClientDefinition,
>(): UploadHandlers<TDefinition> {
  const uploads = useUploadQueue();
  const [state, setState] = useState<UploadState<TDefinition>>({ phase: "idle" });
  const controllers = useRef(new Set<AbortController>());
  const latest = useRef(0);

  useEffect(() => {
    const inFlight = controllers.current;

    return () => {
      for (const controller of inFlight) controller.abort();
    };
  }, []);

  const upload = useCallback(
    async (input: UploadInput<TDefinition>) => {
      const call = ++latest.current;
      // The caller's own signal still wins: this controller follows it, and the unmount.
      const controller = new AbortController();
      controllers.current.add(controller);
      input.signal?.addEventListener("abort", () => controller.abort(input.signal?.reason), {
        once: true,
      });
      setState({ phase: "uploading" });

      try {
        const result = await uploads.enqueue({ ...input, signal: controller.signal });

        if (call === latest.current) setState({ phase: "uploaded", result });

        return result;
      } catch (error) {
        if (call === latest.current) {
          setState({
            phase: "failed",
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }

        return undefined;
      } finally {
        controllers.current.delete(controller);
      }
    },
    [uploads],
  );

  const reset = useCallback(() => setState({ phase: "idle" }), []);

  return { ...state, upload, reset };
}
