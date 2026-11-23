/**
 * The part of an abort signal a run uses: it only ever asks whether it should stop.
 *
 * Named structurally instead of as `AbortSignal` so this package stays free of the DOM and of
 * Node's globals; a real `AbortSignal` satisfies it wherever a signal comes from.
 */
export interface AbortLike {
  readonly aborted: boolean;
  throwIfAborted(): void;
}

/**
 * What a rule works with: the value as it now is, and what it is being processed as.
 */
export type ProcessorArgs<TValue, TContext, TSignal extends AbortLike = AbortLike> = Readonly<{
  value: TValue;
  /** The same context for every rule, describing what is being processed. */
  context: TContext;
  signal?: TSignal;
}>;

/**
 * One step of a processing chain: takes the file as it now is, and returns what the next step
 * sees. Returns its input when it has nothing to do.
 *
 * The interface both sides implement, which is why it is the value and its context rather than a
 * client's file or a server's stored object: what a step is handed is the caller's business.
 */
export type FileProcessor<TValue, TContext, TSignal extends AbortLike = AbortLike> = (
  args: ProcessorArgs<TValue, TContext, TSignal>,
) => TValue | Promise<TValue>;

/**
 * One step of a preprocessing chain.
 *
 * The rule is named so a failure can say which one it was, and so a worker or a log can find it
 * later; a rule that has nothing to do returns its input rather than being skipped.
 */
export type ProcessorRule<TValue, TContext, TSignal extends AbortLike = AbortLike> = Readonly<{
  name: string;
  process: FileProcessor<TValue, TContext, TSignal>;
  /** Whether this run needs the rule. Omitted means always. Sees the value as it started. */
  when?: (context: TContext) => boolean;
}>;

/** Everything one run needs: the rules, the value as it started, and its context. */
export type ProcessorRun<TValue, TContext, TSignal extends AbortLike = AbortLike> = Readonly<{
  rules: readonly ProcessorRule<TValue, TContext, TSignal>[];
  value: TValue;
  context: TContext;
  signal?: TSignal;
}>;

/** A rule failed, either its `when` predicate or its work; `cause` carries what it threw. */
export class ProcessorError extends Error {
  constructor(
    readonly processor: string,
    options?: ErrorOptions,
  ) {
    super(`Processor "${processor}" failed`, options);
    this.name = "ProcessorError";
  }
}

/**
 * Applies the rules that ask for this run, in order, feeding each the previous result.
 *
 * Predicates see the context, which carries the value as it started rather than what a rule
 * produced, while processors see the value as it now is. A processor that has nothing to do
 * returns its input, and one that throws fails the run as a {@link ProcessorError} rather than
 * being skipped, so a typo in a predicate does not hide.
 *
 * The signal is checked between rules, never inside one: a processor that is doing work owns
 * deciding how far it can be interrupted.
 *
 * @human
 */
export async function runProcessors<TValue, TContext, TSignal extends AbortLike = AbortLike>({
  rules,
  value,
  context,
  signal,
}: ProcessorRun<TValue, TContext, TSignal>): Promise<TValue> {
  let current = value;

  for (const rule of rules) {
    signal?.throwIfAborted();

    if (!applies(rule, context)) continue;

    try {
      current = await rule.process({ value: current, context, signal });
    } catch (cause) {
      throw new ProcessorError(rule.name, { cause });
    }

    signal?.throwIfAborted();
  }

  return current;
}

function applies<TValue, TContext, TSignal extends AbortLike>(
  rule: ProcessorRule<TValue, TContext, TSignal>,
  context: TContext,
): boolean {
  if (!rule.when) return true;

  try {
    return rule.when(context);
  } catch (cause) {
    throw new ProcessorError(rule.name, { cause });
  }
}
