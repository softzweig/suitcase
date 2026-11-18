import z from "zod";

/**
 * The entity that owns a resource, as a flat record of primitives: an open shape,
 * so a consumer defines its own keys (`userId`, `teamId`, ...) and a server
 * definition narrows them with its own schema.
 *
 * Shared by resources and by the upload sessions that resolve into them (a
 * session persists the owner it was authorized for) so both rows have to agree
 * on what an owner is. It lives in a module of its own to keep that contract free
 * of the resource/upload import cycle.
 *
 * @human
 */
export type ResourceOwner = z.infer<typeof ResourceOwnerSchema>;

export const ResourceOwnerSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean()]),
);
