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
  assertTransactional(): void;

  /** Throws if this object is bound to a transaction context */
  assertNotTransactional(): void;
}

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

  /** A copy of this service, of the same subclass, carrying another context. */
  withContext(context: Readonly<TCtx>): this {
    const service: this = Object.create(this);
    Object.defineProperty(service, "context", { value: context, writable: false });
    return service;
  }

  /**
   * Runs `fn` with a copy of this service bound to a transaction, so every
   * repository call inside it joins the same transaction.
   */
  transaction<T>(fn: (this: this, context: Readonly<TCtx>) => Promise<T>): Promise<T> {
    return this.createTransaction(this.context, (context) => {
      const service = this.withContext(context);
      return fn.call(service, context);
    });
  }

  /**
   * Asserts that this object is currently bound to a transaction.
   *
   * @see {@link assertNotTransactional}
   */
  assertTransactional(): void {
    if (this.context.isInTransaction) return;
    throw new Error("This service is not bound to a transaction.");
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
  assertNotTransactional(): void {
    if (!this.context.isInTransaction) return;
    throw new Error("This service is bound to a transaction.");
  }
}
