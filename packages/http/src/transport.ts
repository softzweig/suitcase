import { SuitcaseClientError } from "@softzweig/suitcase-client";
import {
  ServiceErrorCode,
  type ServiceResult,
  serviceResultSchema,
} from "@softzweig/suitcase-core";
import {
  type Operation,
  type OperationInput,
  type OperationOutput,
  OperationSchemas,
  type SuitcaseTransport,
} from "@softzweig/suitcase-core/contracts";

export type HttpTransportOptions = Readonly<{
  /** Where the operations are mounted. Each call appends the operation name as one more segment. */
  url: string | URL;
  /** Sent with every call, e.g. an authorization header. `content-type` is set for you. */
  headers?: Readonly<Record<string, string>>;
  /** Injected so the transport runs wherever `fetch` does, and in a test without one. */
  fetch?: typeof globalThis.fetch;
}>;

/**
 * Calls a Suitcase backend over HTTP: one POST per operation, JSON in both directions.
 *
 * No bytes cross this transport. An upload's bytes go straight to the signed URL the backend hands
 * out, so every call here is a small JSON document and no request needs streaming or multipart.
 *
 * A refusal arrives as a {@link SuitcaseClientError} carrying the server's own `ServiceErrorCode`,
 * which is the vocabulary the client uses for its own refusals too, so a caller branches on one set
 * of codes whichever side said no.
 *
 * @example
 * ```ts
 * const client = createSuitcaseClient({
 *   operations: createSuitcaseOperations({ transport: createHttpTransport({ url: "/api/suitcase" }) }),
 *   digest,
 *   transfer,
 * });
 * ```
 */
export function createHttpTransport({
  url,
  headers = {},
  fetch = globalThis.fetch,
}: HttpTransportOptions): SuitcaseTransport {
  const base = String(url).replace(/\/+$/, "");

  async function call<TOperation extends Operation>({
    operation,
    input,
  }: {
    operation: TOperation;
    input: OperationInput<TOperation>;
  }): Promise<OperationOutput<TOperation>> {
    const response = await fetch(`${base}/${operation}`, {
      body: JSON.stringify(input),
      headers: { "content-type": "application/json", ...headers },
      method: "POST",
    });

    const result = await readResult(response, operation);
    if (!result.ok) throw new SuitcaseClientError(result.code, result.message, result.details);

    // The payload was the server's to type; the operation it belongs to is what names it here.
    return result.data as OperationOutput<TOperation>;
  }

  return { call };
}

/**
 * Reads the `ServiceResult` every operation answers with, validated against that operation's own
 * output schema. A response that is not one — a gateway page, an empty body, a proxy's timeout, a
 * deploy that drifted — is a broken wire rather than a domain failure, so it is refused with the
 * one code left over, and the issues say which part did not match.
 */
async function readResult(
  response: Response,
  operation: Operation,
): Promise<ServiceResult<unknown>> {
  const answered: unknown = await response.json().catch(() => undefined);
  const parsed = serviceResultSchema(OperationSchemas[operation].output).safeParse(answered);

  if (parsed.success) return parsed.data;

  throw new SuitcaseClientError(
    ServiceErrorCode.UNKNOWN,
    `The server did not answer ${operation} with a valid Suitcase result.`,
    { issues: parsed.error.issues, status: response.status },
  );
}
