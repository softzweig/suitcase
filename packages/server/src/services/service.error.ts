import { ServiceErrorCode } from "@softzweig/suitcase-core";

/** What an authorization hook may answer: only `true` permits, a string refuses with its reason. */
export type AuthorizationVerdict = boolean | undefined | null | string;

/**
 * A domain outcome that services throw and consumers translate into their own
 * transport (HTTP status, tRPC code, queue retry policy).
 *
 * Lives in server, not core: it is a thrown error, so nobody outside the
 * server process can receive it. Core carries only what crosses a boundary —
 * {@link ServiceErrorCode} and {@link ServiceFailure}.
 */
export class ServiceError extends Error {
  constructor(
    readonly code: ServiceErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ServiceError";
  }

  static notFound(message: string, details?: Record<string, unknown>) {
    return new ServiceError(ServiceErrorCode.NOT_FOUND, message, details);
  }

  static invalidInput(message: string, details?: Record<string, unknown>) {
    return new ServiceError(ServiceErrorCode.INVALID_INPUT, message, details);
  }

  static forbidden(message: string, details?: Record<string, unknown>) {
    return new ServiceError(ServiceErrorCode.FORBIDDEN, message, details);
  }

  static conflict(message: string, details?: Record<string, unknown>) {
    return new ServiceError(ServiceErrorCode.CONFLICT, message, details);
  }

  static assertPrecondition(
    condition: unknown,
    message: string,
    details?: Record<string, unknown>,
  ): asserts condition {
    if (condition) return;
    throw new ServiceError(ServiceErrorCode.PRECONDITION_FAILED, message, details);
  }

  static assertOrNotFound(
    condition: unknown,
    message: string,
    details?: Record<string, unknown>,
  ): asserts condition {
    if (condition) return;
    throw new ServiceError(ServiceErrorCode.NOT_FOUND, message, details);
  }

  static assertOrConflict(
    condition: unknown,
    message: string,
    details?: Record<string, unknown>,
  ): asserts condition {
    if (condition) return;
    throw new ServiceError(ServiceErrorCode.CONFLICT, message, details);
  }

  static assertOrForbidden(
    condition: unknown,
    message: string,
    details?: Record<string, unknown>,
  ): asserts condition {
    if (condition) return;
    throw new ServiceError(ServiceErrorCode.FORBIDDEN, message, details);
  }

  /**
   * Enforces an authorization hook's verdict: only `true` permits. A string refuses, and is already
   * the message the caller is told about.
   */
  static assertPermitted(
    verdict: AuthorizationVerdict,
    details?: Record<string, unknown>,
  ): asserts verdict is true {
    if (verdict === true) return;

    const reason = typeof verdict === "string" && verdict.length > 0 ? verdict : "Not permitted";
    throw ServiceError.forbidden(reason, details);
  }

  static assertOrInvalidInput(
    condition: unknown,
    message: string,
    details?: Record<string, unknown>,
  ): asserts condition {
    if (condition) return;
    throw new ServiceError(ServiceErrorCode.INVALID_INPUT, message, details);
  }
}
