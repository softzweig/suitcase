import type { UploadConstraintsResult } from "@softzweig/suitcase-core/contracts";
import { ProcessorError } from "./error.js";
import type { UploadFile } from "./upload.js";

/** Takes the picked file and returns the one to upload, which may be the same object. */
export type FileProcessor = (file: UploadFile, signal?: AbortSignal) => Promise<UploadFile>;

/** What a rule is decided with: the file as picked, the kind, and what that kind advertises. */
export type ProcessorContext = Readonly<{
  kind: string;
  file: UploadFile;
  constraints: UploadConstraintsResult;
}>;

export type ProcessorRule = Readonly<{
  /** Named so a failure says which processor it was, and so a worker can find it later. */
  name: string;
  process: FileProcessor;
  /** Whether this upload needs it. Omitted means always. */
  when?: (context: ProcessorContext) => boolean;
}>;

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
 * Predicates see the file as it was picked; processors see it as it now is. A processor that has
 * nothing to do returns its input, and one that throws fails the upload as a `ProcessorError`
 * rather than being skipped, so a typo in a predicate does not hide.
 *
 * @human
 */
export async function runProcessors({
  rules,
  file,
  kind,
  constraints,
  signal,
}: ProcessorRun): Promise<UploadFile> {
  const context: ProcessorContext = { constraints, file, kind };
  let current = file;

  for (const rule of rules) {
    signal?.throwIfAborted();

    if (!applies(rule, context)) continue;

    try {
      current = await rule.process(current, signal);
    } catch (cause) {
      throw new ProcessorError(rule.name, { cause });
    }

    signal?.throwIfAborted();
  }

  return current;
}

function applies(rule: ProcessorRule, context: ProcessorContext): boolean {
  if (!rule.when) return true;

  try {
    return rule.when(context);
  } catch (cause) {
    throw new ProcessorError(rule.name, { cause });
  }
}
