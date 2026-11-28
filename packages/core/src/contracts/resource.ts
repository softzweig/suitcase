import { SpindleErrorCode } from "@softzweig/spindle-core/result";
import z from "zod";
import { AssetDownloadUrlSchema } from "../schemas/asset.js";
import { ResourceMetadataSchema, ResourceSchema } from "../schemas/resource.js";

/**
 * The resource operations a client and a backend agree on.
 *
 * Reads are scoped by the claim a kind declares, so the resolve request stays a type and the
 * transport composes its schema from that claim.
 */
export type ResourceResolveRequest<TClaim = undefined> = {
  /** The user-requested resource IDs to resolve */
  requestedIds: readonly string[];
  claims: TClaim;
};

/** One entry per requested id: the link, or the category of the failure that kept it from it. */
export type ResourceDownload = z.infer<typeof ResourceDownloadSchema>;

export type ResourceResolveResult = readonly ResourceDownload[];

export type ResourceUpdateRequest = z.infer<typeof ResourceUpdateRequestSchema>;

export type ResourceUpdateResult = z.infer<typeof ResourceUpdateResultSchema>;

export type ResourceDeleteRequest = z.infer<typeof ResourceDeleteRequestSchema>;

export type ResourceDeleteResult = z.infer<typeof ResourceDeleteResultSchema>;

/**
 * Failures carry a code only. Messages and details hold infrastructure specifics, and `NOT_FOUND`
 * deliberately covers both "does not exist" and "not readable", so the list cannot be used to
 * discover resources the caller may not read.
 */
export const ResourceDownloadSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    id: z.uuid(),
    label: z.string().nullable(),
    fileName: z.string(),
    url: AssetDownloadUrlSchema,
  }),
  z.object({ ok: z.literal(false), id: z.uuid(), code: z.enum(SpindleErrorCode) }),
]);

/** What an update may change. Identity is immutable by contract. */
export const ResourceResolveRequestSchema = <TClaims extends z.ZodType>(claims: TClaims) =>
  z.object({ requestedIds: z.array(z.uuid()), claims });

export const ResourceResolveResultSchema = z.array(ResourceDownloadSchema);
export const ResourceUpdateRequestSchema = z.object({
  id: z.uuid(),
  label: z.string().max(255).nullable().optional(),
  metadata: ResourceMetadataSchema.optional(),
});

export const ResourceUpdateResultSchema = ResourceSchema;

export const ResourceDeleteRequestSchema = z.object({
  resourceId: z.uuid(),
});

export const ResourceDeleteResultSchema = ResourceSchema;
