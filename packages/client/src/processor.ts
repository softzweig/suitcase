import type { UploadConstraintsResult } from "@softzweig/suitcase-core/contracts";
import {
  type FileProcessor as CoreFileProcessor,
  type ProcessorRule as CoreProcessorRule,
  type ProcessorArgs,
  runProcessors,
} from "@softzweig/suitcase-core/utils";
import type { UploadFile } from "./upload.js";

/** What a rule is decided with: the file as picked, the kind, and what that kind advertises. */
export type ProcessorContext = Readonly<{
  kind: string;
  file: UploadFile;
  constraints: UploadConstraintsResult;
}>;

/** A step of this client's preprocessing: the shared interface, with its types bound. */
export type FileProcessor = CoreFileProcessor<UploadFile, ProcessorContext, AbortSignal>;

/** What a processor is called with: the file as it now is, and what it is being uploaded as. */
export type FileProcessorArgs = ProcessorArgs<UploadFile, ProcessorContext, AbortSignal>;

/** One step of an upload's preprocessing: the core rule, with this client's types bound to it. */
export type ProcessorRule = CoreProcessorRule<UploadFile, ProcessorContext, AbortSignal>;

/** Everything one run needs: the rules, the file as picked, and what it is being uploaded as. */
export type ProcessorRun = Readonly<
  ProcessorContext & {
    rules: readonly ProcessorRule[];
    signal?: AbortSignal;
  }
>;

/**
 * Applies the rules that ask for this upload, in order, feeding each the previous result.
 *
 * The flattened form of the core runner: the file is the value, and the kind with its limits is
 * the context every rule and predicate reads. See {@link runProcessors} for the guarantees.
 *
 * @human
 */
export function runFileProcessors({ rules, file, kind, constraints, signal }: ProcessorRun) {
  return runProcessors({ rules, value: file, context: { constraints, file, kind }, signal });
}
