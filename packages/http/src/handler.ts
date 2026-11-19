import {
  ServiceErrorCode,
  type ServiceFailure,
  type ServiceResult,
} from "@softzweig/suitcase-core";
import {
  type Operation,
  OperationSchemas,
  type ServiceOperations,
} from "@softzweig/suitcase-core/contracts";

/**
 * Serves the operations over HTTP: `POST {mount}/{operation}` with the operation's input as the
 * body, answered with a `ServiceResult` whose code becomes the status.
 *
 * @example
 * ```ts
 * export default {
 *   fetch: createHttpHandler((request) => server.forExecution(auth(request)).operations),
 * };
 * ```
 */
export const createHttpHandler =
  (bind: (request: Request) => ServiceOperations | PromiseLike<ServiceOperations>) =>
  async (request: Request): Promise<Response> => {
    if (request.method !== "POST") {
      return respond(405, failure(ServiceErrorCode.INVALID_INPUT, "The endpoints take POST."));
    }

    const operation = operationOf(request.url);
    if (operation === undefined) {
      const { pathname } = new URL(request.url);
      return respond(
        404,
        failure(ServiceErrorCode.NOT_FOUND, `No Suitcase operation at ${pathname}.`),
      );
    }

    try {
      // The input was parsed with the schema the operation is typed against.
      const call = (await bind(request))[operation] as (
        input: unknown,
      ) => ServiceResult<unknown> | PromiseLike<ServiceResult<unknown>>;
      const result = await call(OperationSchemas[operation].input.parse(await readJson(request)));
      const answer = checked(operation, result);
      return respond(statusOf(answer), answer);
    } catch (cause) {
      const refused = asFailure(cause);
      return respond(statusOf(refused), refused);
    }
  };

/** The last path segment: `…/uploads.initialize` is the initialize operation. */
const operationOf = (url: string): Operation | undefined => {
  const name = new URL(url).pathname.split("/").filter(Boolean).at(-1);
  return name !== undefined && Object.hasOwn(OperationSchemas, name)
    ? (name as Operation)
    : undefined;
};

/**
 * The payload is parsed on the way out too, so the wire carries exactly the contract's fields. A
 * payload that does not fit is the server's own doing, hence `unknown` and a 500, not a 400.
 */
function checked(operation: Operation, result: ServiceResult<unknown>): ServiceResult<unknown> {
  if (!result.ok) return result;

  try {
    const parsed = OperationSchemas[operation].output.parse(result.data);
    return { data: parsed, ok: true };
  } catch (cause) {
    return failure(ServiceErrorCode.UNKNOWN, `The ${operation} result does not fit the contract.`, {
      issues: cause instanceof Error && "issues" in cause ? cause.issues : undefined,
    });
  }
}

/** A body that is not JSON parses to nothing, which every operation schema then refuses. */
const readJson = async (request: Request): Promise<unknown> =>
  request.json().catch(() => undefined);

/** A schema's refusal is the caller's problem; anything else is opaque, so no driver detail leaks. */
function asFailure(cause: unknown): ServiceFailure {
  if (cause instanceof Error && cause.name === "ZodError" && "issues" in cause) {
    return failure(ServiceErrorCode.INVALID_INPUT, "The body does not fit the operation.", {
      issues: cause.issues,
    });
  }

  if (cause instanceof Error && "code" in cause && isServiceCode(cause.code)) {
    const details = "details" in cause && isRecord(cause.details) ? cause.details : undefined;
    return { code: cause.code, details, message: cause.message, ok: false };
  }

  return failure(ServiceErrorCode.UNKNOWN, "The operation failed.");
}

const STATUS_CODES = Object.freeze<Readonly<Record<ServiceErrorCode, number>>>({
  [ServiceErrorCode.NOT_FOUND]: 404,
  [ServiceErrorCode.INVALID_INPUT]: 400,
  [ServiceErrorCode.FORBIDDEN]: 403,
  [ServiceErrorCode.CONFLICT]: 409,
  [ServiceErrorCode.PRECONDITION_FAILED]: 412,
  [ServiceErrorCode.UNAVAILABLE]: 503,
  [ServiceErrorCode.UNKNOWN]: 500,
});

const statusOf = (result: ServiceResult<unknown>) => (result.ok ? 200 : STATUS_CODES[result.code]);

const failure = (
  code: ServiceErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ServiceFailure => ({ code, details, message, ok: false });

const respond = (status: number, body: ServiceResult<unknown>) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isServiceCode = (value: unknown): value is ServiceErrorCode =>
  Object.values(ServiceErrorCode).some((code) => code === value);
