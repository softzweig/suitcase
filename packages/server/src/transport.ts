import type {
  ClientDefinition,
  ClientResourceDefinition,
} from "@softzweig/suitcase-core/contracts";
import type z from "zod";
import type { AnyDefinition, SchemaOutput } from "./suitcase.js";

/**
 * Infers the client-side types for the resources defined in a suitcase definition.
 *
 * Builds a transport-agnostic generalized interface for clients to communicate directly
 * with the resources defined in the suitcase definition.
 *
 * This is used to allow for end-to-end type-safety across client-server interactions.
 *
 * @important
 * As a consumer of Suitcase, you may want to export this interface for use in your client code.
 * You want to make sure to add your server backend (or whereever the Suitcase definition lives),
 * is **only added to your client environment as a _dev-dependency_**. You may only want to import:
 * ```ts
 * import type { SuitcaseClient } from "path-to-your-server-definition";
 * //     ^ Ensure you use a type import, to avoid leaking server internals
 * ```
 * (...) to avoid leaking implementation details. This entire principle is quite similar to
 * how [tRPC](https://trpc.io/docs) handles type-safe client-server communication.
 *
 * @example
 * ```ts
 * export type SuitcaseClient = InferSuitcaseClient<typeof definition>;
 * //                                               ^ Suitcase.* result within server
 * ```
 *
 * @human
 */
export type InferSuitcaseClient<T extends AnyDefinition> = ClientDefinition<{
  [K in keyof T["resources"]]: ClientResourceDefinition<{
    read: SchemaOutput<(T["resources"][K]["read"] & {})["claim"] & {}>;
    owner: SchemaOutput<T["resources"][K]["owner"]["schema"]>;
    uploadIntent: SchemaOutput<(T["resources"][K]["upload"] & {})["intent"] & {}>;
    uploadMetadata: NonNullable<T["resources"][K]["upload"]> extends {
      metadata?: infer TSchema;
    }
      ? TSchema extends z.ZodType
        ? 0 extends 1 & z.infer<TSchema>
          ? never
          : SchemaOutput<TSchema>
        : never
      : never;
    // Carried so the client can refuse a usage query for a kind that does not report it.
    usage: string extends keyof T["resources"] & string
      ? boolean
      : T["resources"][K]["owner"] extends { usage: true }
        ? true
        : false;
  }>;
}>;
