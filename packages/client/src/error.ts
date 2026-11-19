import type { ServiceErrorCode } from "@softzweig/suitcase-core";

/**
 * A failure the client decided on by itself, before the backend was asked to do the work.
 *
 * Codes come from the same vocabulary the server reports through its transport, so a caller can
 * branch on one set regardless of which side refused.
 */
export class SuitcaseClientError extends Error {
  constructor(
    readonly code: ServiceErrorCode,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "SuitcaseClientError";
  }
}
