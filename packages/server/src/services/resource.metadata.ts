import { ServiceError } from "@softzweig/spindle-core/service";
import type { ResourceMetadata, ResourceOwner } from "@softzweig/suitcase-core";
import type z from "zod";
import type {
  AnyResourceUpload,
  ResourceMetadataDecorateArgs,
  ResourceMetadataSchema,
} from "../suitcase.js";

/**
 * Parses a client metadata claim against the kind's schema. A kind without a schema accepts only
 * an empty claim, and a schema that does not allow `undefined` makes the claim required.
 */
export function parseResourceMetadata({
  claim,
  kind,
  schema,
}: Readonly<{
  claim: ResourceMetadata | undefined;
  kind: string;
  schema: ResourceMetadataSchema | undefined;
}>): ResourceMetadata {
  const parsed = schema?.safeParse(claim ?? undefined);

  ServiceError.assert(
    schema ? parsed?.success : claim == null,
    schema ? "Invalid resource metadata" : "Resource kind does not accept metadata",
    { kind },
  );

  return parsed?.success ? (parsed.data ?? null) : null;
}

/** What a decorator may look at, plus the erased upload contract that declares it. */
type ResourceMetadataDecoration<TServerContext> = Readonly<{
  upload: AnyResourceUpload<TServerContext>;
}> &
  ResourceMetadataDecorateArgs<TServerContext, ResourceOwner, z.ZodType, ResourceMetadata>;

/** Runs the kind's decorator, or stores the parsed metadata unchanged when it declares none. */
export async function decorateResourceMetadata<TServerContext>({
  upload,
  ...args
}: ResourceMetadataDecoration<TServerContext>): Promise<ResourceMetadata> {
  if (!upload.decorate) return args.metadata;

  return (await upload.decorate(args)) ?? null;
}
