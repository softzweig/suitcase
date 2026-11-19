import { AssetSchema } from "@softzweig/suitcase-core";
import z from "zod";

export type UploadReusePolicy = z.infer<typeof UploadReusePolicySchema>;

/**
 * How the backend reuses what it already stores.
 *
 * This never crosses the wire: a client asks to store a file, and the backend decides whether to
 * point at bytes it already has. Keeping the vocabulary here rather than in the contracts is what
 * makes `exact` (hand it a known asset) and `none` (bypass deduplication) unreachable from outside.
 */
export const UploadReusePolicySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("exact"), asset: AssetSchema }),
  z.object({ type: z.literal("auto") }),
  z.object({ type: z.literal("none") }),
]);

/** Deduplicate by digest, which is what an upload gets unless the backend says otherwise. */
export const DEFAULT_UPLOAD_REUSE_POLICY: UploadReusePolicy = Object.freeze({ type: "auto" });

/** How long a session may stay open before `finalize` refuses it. */
export const DEFAULT_UPLOAD_EXPIRY_SECONDS = 3600;
