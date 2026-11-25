import z from "zod";
import { ResourceOwnerSchema } from "../schemas/shared.js";

/** Resource storage quotas for a specific filter. @human */
export type SuitcaseResourceUsage = z.infer<typeof SuitcaseResourceUsageSchema>;

/** Upload storage quotas for a specific filter. @human */
export type SuitcaseUploadUsage = z.infer<typeof SuitcaseUploadUsageSchema>;

/** Total storage quotas for a specific filter. @human */
export type SuitcaseTotalUsage = z.infer<typeof SuitcaseTotalUsageSchema>;

/** What one kind accounts for, the two scopes before anything is added up. */
export type SuitcaseKindUsage = z.infer<typeof SuitcaseKindUsageSchema>;

/** Any of the three scopes, for a transport that validates a usage document without knowing which. */
export type SuitcaseUsage = z.infer<typeof SuitcaseUsageSchema>;

/** What a usage query asks for. */
export type SuitcaseUsageRequest = z.infer<typeof SuitcaseUsageRequestSchema>;

/** Resource storage quotas for a specific filter. @human */
export const SuitcaseResourceUsageSchema = z.object({
  scope: z.literal("resource"),
  resourceCount: z.number().int().nonnegative(),
  size: z.number().int().nonnegative(),
});

/** Upload storage quotas for a specific filter. @human */
export const SuitcaseUploadUsageSchema = z.object({
  scope: z.literal("upload"),
  uploadCount: z.number().int().nonnegative(),
  size: z.number().int().nonnegative(),
});

/**
 * What both scopes add up to: the number a quota is checked against.
 *
 * This is the shape a client receives, so it is a schema rather than a bare type.
 */
export const SuitcaseTotalUsageSchema = z.object({
  scope: z.literal("total"),
  resourceCount: z.number().int().nonnegative(),
  uploadCount: z.number().int().nonnegative(),
  size: z.number().int().nonnegative(),
});

/** What one kind accounts for, the two scopes before anything is added up. */
export const SuitcaseKindUsageSchema = z.object({
  resources: SuitcaseResourceUsageSchema,
  uploads: SuitcaseUploadUsageSchema,
});

/** Any of the three scopes, for a transport that validates a usage document without knowing which. */
export const SuitcaseUsageSchema = z.discriminatedUnion("scope", [
  SuitcaseResourceUsageSchema,
  SuitcaseUploadUsageSchema,
  SuitcaseTotalUsageSchema,
]);

/**
 * What a usage query asks for: the kinds to add up, and the owner whose storage the caller wants to
 * see. Each kind validates the owner against its own schema and answers for it, so the kinds need
 * not share one.
 *
 * The owner is an open record on the wire; its schema narrows it on the server, and the owner's
 * `authorize` answers for `action: "usage"`.
 */
export const SuitcaseUsageRequestSchema = z.object({
  kinds: z.array(z.string().min(1)).min(1),
  owner: ResourceOwnerSchema,
});

export const totalUsage = (
  resource: SuitcaseResourceUsage,
  upload: SuitcaseUploadUsage,
): SuitcaseTotalUsage => ({
  scope: "total",
  resourceCount: resource.resourceCount,
  uploadCount: upload.uploadCount,
  size: resource.size + upload.size,
});
