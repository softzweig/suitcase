import { ServiceError } from "./services/service.error.js";

export interface TransactionalContext {
  /** False if the transaction is not active (no binding) */
  readonly isInTransaction: boolean;
}

export interface Transactional<TCtx extends TransactionalContext> {
  /** Returns the current transaction context */
  getContext(): Readonly<TCtx>;

  /** Returns a copy of this object bound to the given transaction context */
  withContext(context: Readonly<TCtx>): this;

  /** Binds this object to a transaction context for the duration of the callback */
  transaction<T>(callback: (this: this, context: Readonly<TCtx>) => Promise<T>): Promise<T>;

  /** Throws if this object is not bound to a transaction context */
  assertTransaction(): void;

  /** Throws if this object is bound to a transaction context */
  assertNotTransaction(): void;
}

/**
 * Marks the instances a context rebinds when it is bound.
 *
 * Services follow the context that holds them, so a sibling called inside a
 * transaction joins it. Repositories do not: their context carries their own
 * state, and the transaction runner hands back handles that are already bound.
 */
export const FOLLOWS_CONTEXT: unique symbol = Symbol.for(
  "@softzweig/suitcase-server/follows-context",
);

/** Whether a context holding this member has to rebind it. */
function isFollowing(value: unknown): value is Transactional<TransactionalContext> {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { [FOLLOWS_CONTEXT]?: boolean })[FOLLOWS_CONTEXT] === true
  );
}

/** A copy of `instance` carrying `context`, leaving the context's members alone. */
function bindInstance<TInstance extends Transactional<TransactionalContext>>(
  instance: TInstance,
  context: TransactionalContext,
): TInstance {
  const bound = Object.create(instance);
  Object.defineProperty(bound, "context", { value: context, writable: false });
  return bound;
}

/**
 * Binds every service held by `context` to that same context, so a sibling called
 * inside a transaction joins it instead of keeping the binding it was constructed
 * with. A stale sibling would pass its own guards and run its work on the other
 * side of the transaction boundary, silently.
 *
 * One level deep on purpose: a bound member keeps the context it was handed, so a
 * service context has to accumulate the contexts of the services it holds, and
 * recurring would not terminate on a mutually dependent pair.
 */
const bindMembers = <TCtx extends TransactionalContext>(ctx: Readonly<TCtx>) =>
  Object.fromEntries(
    Object.entries(ctx).map(([k, v]) => [k, isFollowing(v) ? bindInstance(v, ctx) : v]),
  ) as Readonly<TCtx>;

export class BaseTransactional<TCtx extends TransactionalContext> implements Transactional<TCtx> {
  constructor(
    protected readonly context: TCtx,
    private readonly createTransaction: <T>(
      context: TCtx,
      fn: (context: TCtx) => Promise<T>,
    ) => Promise<T>,
  ) {
    this.context = context;
  }

  getContext(): Readonly<TCtx> {
    return this.context;
  }

  /**
   * A copy of this service, of the same subclass, carrying another context.
   *
   * The services held by that context are bound to it as well; every other value
   * is carried over as it is.
   */
  withContext(context: Readonly<TCtx>): this {
    return bindInstance(this, bindMembers(context));
  }

  /**
   * Runs `fn` with a copy of this service bound to a transaction, so every
   * repository call inside it joins the same transaction.
   *
   * A nested call is a savepoint: the inner scope that throws undoes only its
   * own writes and leaves the outer transaction usable, while an outer failure
   * still discards everything the inner one committed.
   */
  transaction<T>(fn: (this: this, context: Readonly<TCtx>) => Promise<T>): Promise<T> {
    return this.createTransaction(this.context, (context) => {
      const service = this.withContext(context);
      return fn.call(service, service.getContext());
    });
  }

  /**
   * Asserts that this object is currently bound to a transaction.
   *
   * @see {@link assertNotTransaction}
   */
  assertTransaction(): void {
    ServiceError.assertPrecondition(
      this.context.isInTransaction,
      "This service is not bound to a transaction.",
    );
  }

  /**
   * Asserts that this object is currently not bound to a transaction.
   *
   * @reasoning The reason for this assertion and its existence, is to be completely
   * certain that an expensive operation, such as calling an external service like
   * the underlying storage layer, is only performed outside an active transaction.
   * This is to ensure no unnecessary potential deadlocks occur during transactional
   * operations, causing transactional conflicts.
   *
   * @human
   */
  assertNotTransaction(): void {
    ServiceError.assertPrecondition(
      !this.context.isInTransaction,
      "This service is bound to a transaction.",
    );
  }
}
