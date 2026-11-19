import { expectTypeOf, test } from "vitest";
import type { DeclaredField } from "../../src/utils/fields.js";

type Intent = { folderId: string };

test("requires a declared value", () => {
  expectTypeOf<DeclaredField<"intent", Intent>>().toEqualTypeOf<{ intent: Intent }>();

  const stated: DeclaredField<"intent", Intent> = { intent: { folderId: "f1" } };
  void stated;

  const silent: DeclaredField<"intent", Intent> = {
    // @ts-expect-error - a kind that declares an intent cannot be satisfied by silence.
    intent: undefined,
  };
  void silent;
});

test("accepts nothing when nothing is declared", () => {
  expectTypeOf<DeclaredField<"intent", never>>().toEqualTypeOf<{ intent?: never }>();
  expectTypeOf<DeclaredField<"intent", undefined>>().toEqualTypeOf<{ intent?: never }>();

  const bare: DeclaredField<"intent", never> = {};
  void bare;

  const stated: DeclaredField<"intent", never> = {
    // @ts-expect-error - there is nothing to state, so any value is wrong.
    intent: {},
  };
  void stated;
});

test("stays permissive when the type cannot say", () => {
  expectTypeOf<DeclaredField<"intent", unknown>>().toEqualTypeOf<{ intent?: unknown }>();

  const silent: DeclaredField<"intent", unknown> = {};
  const stated: DeclaredField<"intent", unknown> = { intent: { anything: true } };
  void silent;
  void stated;
});

test("asks only for the part of a union a caller can supply", () => {
  expectTypeOf<DeclaredField<"intent", Intent | undefined>>().toEqualTypeOf<{ intent?: Intent }>();
});

test("takes the property name it is given", () => {
  expectTypeOf<DeclaredField<"owner", { userId: string }>>().toEqualTypeOf<{
    owner: { userId: string };
  }>();
});
