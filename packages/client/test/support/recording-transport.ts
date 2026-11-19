import type {
  Operation,
  OperationRequest,
  SuitcaseTransport,
} from "@softzweig/suitcase-core/contracts";

/**
 * A transport that records what it was handed and answers each operation with what is registered
 * for it. Nothing on the client inspects an answer, so the values only have to come back unchanged.
 */
export const createRecordingTransport = (answers: Partial<Record<Operation, unknown>> = {}) => {
  const calls: OperationRequest[] = [];

  const transport: SuitcaseTransport = {
    call: (async (request: OperationRequest) => {
      calls.push(request);
      return answers[request.operation];
    }) as SuitcaseTransport["call"],
  };

  return { calls, transport };
};

export const resourceId = "3f1c9a7e-5f4b-4c2a-9d1e-8b6f0a2c4d5e";
