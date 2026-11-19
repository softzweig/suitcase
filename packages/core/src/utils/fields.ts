/**
 * One property whose presence is decided by the type it carries.
 *
 * Three cases, all of which a definition-derived type runs into:
 *
 * - a declared value (`{ folderId: string }`) must be stated, so the property is required;
 * - nothing declared (`never`, or `undefined` for a declaration that is absent) leaves nothing to
 *   state, so the property is optional and accepts no value;
 * - an erased type (`unknown`, e.g. a schema reduced to `z.ZodType`) cannot be judged by types
 *   alone, so the property stays optional and permissive.
 *
 * @example
 * ```ts
 * type Start = { kind: string } & DeclaredField<"intent", TDefinition["resources"][K]["intent"]>;
 * ```
 */
export type DeclaredField<TKey extends string, TValue> = [TValue] extends [never]
  ? { [TProperty in TKey]?: never }
  : unknown extends TValue
    ? { [TProperty in TKey]?: TValue }
    : undefined extends TValue
      ? { [TProperty in TKey]?: Exclude<TValue, undefined> }
      : { [TProperty in TKey]: TValue };
