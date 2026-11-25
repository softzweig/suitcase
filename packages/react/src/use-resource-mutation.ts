import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Where a one-shot resource mutation got to. The two in-between phases are named by the hook that
 * owns them (`updating`/`updated`, `deleting`/`deleted`), so each hook reads like its verb while the
 * machine underneath is one.
 */
export type MutationState<
  TResult,
  TRunning extends string = "pending",
  TDone extends string = "done",
> =
  | { phase: "idle" | TRunning; result?: never; error?: never }
  | { phase: TDone; result: TResult; error?: never }
  | { phase: "failed"; result?: never; error: Error };

/** What {@link useResourceMutation} hands back: where it is, the call, and a way to forget it. */
export type MutationHandlers<
  TInput,
  TResult,
  TRunning extends string,
  TDone extends string,
> = Readonly<{
  state: MutationState<TResult, TRunning, TDone>;
  /** Settles with the result of one call, or `undefined` when it failed. */
  run(input: TInput): Promise<TResult | undefined>;
  reset(): void;
}>;

const asError = (error: unknown) => (error instanceof Error ? error : new Error(String(error)));

/**
 * The state machine both resource mutation hooks are built on: one call at a time as far as the
 * state is concerned, a failure kept as state rather than thrown, and nothing written once the
 * component is gone.
 *
 * `mutate` and `phases` have to be stable, which in practice means module constants and a
 * `useCallback` over the client, or every render would rebuild `run`.
 */
export function useResourceMutation<
  TInput,
  TResult,
  TRunning extends string,
  TDone extends string,
>({
  mutate,
  phases,
}: Readonly<{
  mutate: (input: TInput) => Promise<TResult>;
  phases: Readonly<{ running: TRunning; done: TDone }>;
}>): MutationHandlers<TInput, TResult, TRunning, TDone> {
  const [state, setState] = useState<MutationState<TResult, TRunning, TDone>>({ phase: "idle" });

  // The call the state belongs to. Only the newest may write it, and `reset` takes the claim away
  // from whatever is still in flight, so a late answer cannot bring back an outcome the caller
  // already dismissed.
  const current = useRef(0);
  const mounted = useRef(true);

  // Written on mount and not only cleared on unmount: StrictMode runs both, and the flag has to be
  // true again for the effects that follow.
  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async (input: TInput) => {
      const call = ++current.current;
      const owns = () => mounted.current && call === current.current;

      if (owns()) setState({ phase: phases.running });

      try {
        const result = await mutate(input);

        if (owns()) setState({ phase: phases.done, result });

        return result;
      } catch (error) {
        if (owns()) setState({ phase: "failed", error: asError(error) });

        return undefined;
      }
    },
    [mutate, phases],
  );

  const reset = useCallback(() => {
    current.current++;
    if (!mounted.current) return;
    setState({ phase: "idle" });
  }, []);

  return { state, run, reset };
}
