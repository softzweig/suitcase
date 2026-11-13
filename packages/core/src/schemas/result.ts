import z from "zod";

/** A successful service call, carrying the result payload. */
export type ServiceSuccess<T> = Readonly<{ ok: true; data: T }>;

export type ServiceFailure = z.infer<typeof ServiceFailureSchema>;

export type ServiceResult<T> = ServiceSuccess<T> | ServiceFailure;

export type ServiceErrorCode = (typeof ServiceErrorCode)[keyof typeof ServiceErrorCode];

/**
 * Failure categories a service reports to its callers.
 *
 * Services translate domain and adapter failures into these codes, so callers
 * branch on a stable vocabulary instead of on backend-specific errors.
 */
export const ServiceErrorCode = Object.freeze({
  /** The entity does not exist, or is not visible to the caller. */
  NOT_FOUND: "not_found",
  /** The input is malformed or breaks a domain rule. */
  INVALID_INPUT: "invalid_input",
  /** The caller is not allowed to perform this operation. */
  FORBIDDEN: "forbidden",
  /** The request contradicts existing state, e.g. a duplicate digest. */
  CONFLICT: "conflict",
  /** The operation is not allowed in the current state. */
  PRECONDITION_FAILED: "precondition_failed",
  /** A dependency is unavailable; the same request may succeed later. */
  UNAVAILABLE: "unavailable",
  /** A failure the service could not classify. */
  UNKNOWN: "unknown",
});

/**
 * A failed service call.
 *
 * `message` is for humans; `details` carries machine-readable context such as
 * the offending field, and stays free-form on purpose.
 */
export const ServiceFailureSchema = z.object({
  ok: z.literal(false),
  code: z.enum(ServiceErrorCode),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});

/** Success half of {@link ServiceResult}, for a given payload schema. */
export const serviceSuccessSchema = <TPayload extends z.ZodType>(payload: TPayload) =>
  z.object({ ok: z.literal(true), data: payload });

/** Full {@link ServiceResult} schema, for a given payload schema. */
export const serviceResultSchema = <TPayload extends z.ZodType>(payload: TPayload) =>
  z.discriminatedUnion("ok", [serviceSuccessSchema(payload), ServiceFailureSchema]);
