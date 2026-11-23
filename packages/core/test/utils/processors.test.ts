import { describe, expect, test } from "vitest";
import {
  type AbortLike,
  type FileProcessor,
  ProcessorError,
  type ProcessorRule,
  runProcessors,
} from "../../src/utils/processors.js";

type Value = { readonly size: number };

/** The value the run started with; the client puts the picked file here the same way. */
type Context = { readonly kind: string; readonly started: Value };

const started: Value = { size: 2 };
const context: Context = { kind: "avatar", started };

/** A rule is a named processor, which is all this helper adds. */
const rule = (
  name: string,
  process: FileProcessor<Value, Context>,
): ProcessorRule<Value, Context> => ({ name, process });

const double = rule("double", ({ value }) => ({ size: value.size * 2 }));
const untouched = rule("untouched", ({ value }) => value);

/** A signal a test can trip, since this package has no timer or DOM globals to borrow one from. */
const abortable = () => {
  let aborted = false;

  const signal: AbortLike & { abort(): void } = {
    get aborted() {
      return aborted;
    },
    abort: () => {
      aborted = true;
    },
    throwIfAborted: () => {
      if (aborted) throw new Error("aborted");
    },
  };

  return signal;
};

describe("runProcessors", () => {
  test("feeds each rule what the one before it produced", async () => {
    const sizes: number[] = [];

    await runProcessors({
      context,
      rules: [
        double,
        rule("record", ({ value }) => {
          sizes.push(value.size);
          return value;
        }),
      ],
      value: started,
    });

    expect(sizes).toEqual([4]);
  });

  test("hands every rule the same context", async () => {
    const kinds: string[] = [];

    await runProcessors({
      context,
      rules: [
        rule("first", ({ value, context: seen }) => {
          kinds.push(seen.kind);
          return value;
        }),
        rule("second", ({ value, context: seen }) => {
          kinds.push(seen.kind);
          return value;
        }),
      ],
      value: started,
    });

    expect(kinds).toEqual(["avatar", "avatar"]);
  });

  test("never hands a predicate what a rule produced", async () => {
    const seen: number[] = [];

    await runProcessors({
      context,
      rules: [
        double,
        {
          name: "after",
          process: ({ value }) => value,
          when: ({ started: picked }) => {
            seen.push(picked.size);
            return false;
          },
        },
      ],
      value: started,
    });

    // The rule before it doubled the size; the context still says what the run was given.
    expect(seen).toEqual([2]);
  });

  test("returns the value untouched when no rule applies", async () => {
    await expect(
      runProcessors({
        context,
        rules: [{ name: "skipped", process: () => ({ size: 0 }), when: () => false }],
        value: started,
      }),
    ).resolves.toBe(started);
  });

  test.for([
    {
      case: "its work fails",
      failing: {
        name: "broken",
        process: () => {
          throw new Error("no canvas");
        },
      } satisfies ProcessorRule<Value, Context>,
    },
    {
      case: "its predicate fails",
      failing: {
        name: "broken",
        process: ({ value }) => value,
        when: () => {
          throw new Error("bad predicate");
        },
      } satisfies ProcessorRule<Value, Context>,
    },
  ])("attributes a failure to the rule whose $case", async ({ failing }) => {
    const thrown = await runProcessors({ context, rules: [failing], value: started }).catch(
      (error: unknown) => error,
    );

    expect(thrown).toBeInstanceOf(ProcessorError);
    expect(thrown).toMatchObject({ processor: "broken" });
  });

  test("stops between rules once the signal is tripped", async () => {
    const signal = abortable();
    const ran: string[] = [];

    const run = runProcessors({
      context,
      rules: [
        rule("aborts", ({ value }) => {
          ran.push("aborts");
          signal.abort();
          return value;
        }),
        untouched,
      ],
      signal,
      value: started,
    });

    await expect(run).rejects.toThrow("aborted");
    expect(ran).toEqual(["aborts"]);
  });
});
