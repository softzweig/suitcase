import {
  type ServerAdapters,
  type SuitcaseTransactionRunner,
  TRANSACTION_EXECUTOR,
  type TransactionalContext,
} from "@softzweig/suitcase-server";
import type { SuitcaseRepositories } from "@softzweig/suitcase-server/repository";
import type { DrizzleContext, DrizzleDatabase } from "./repository.js";

/**
 * The handle the context is already bound to, when it is inside a transaction.
 *
 * A nested call has to nest on this handle instead of the root: asking the root for a second
 * transaction leaves it waiting for the outer one to finish, and on a single-connection driver the
 * two never settle. Nesting on the handle is a savepoint, which is what the services promise.
 *
 * The handle comes from the slot every adapter records it in, so this reads one known place rather
 * than searching the context for something that looks like a transaction.
 */
function boundHandle(context: TransactionalContext): DrizzleDatabase | undefined {
  const handle = context[TRANSACTION_EXECUTOR];
  return isDrizzleHandle(handle) ? handle : undefined;
}

const isDrizzleHandle = (value: unknown): value is DrizzleDatabase =>
  typeof value === "object" && value !== null && "transaction" in value;

/**
 * Runs a service transaction on one drizzle transaction handle.
 *
 * Unlike services, repositories do not follow a context, so each handle is rebound explicitly;
 * `isInTransaction` is what lets the services assert that they are inside the scope.
 */
const createTransactionRunner =
  (db: DrizzleDatabase, repositories: SuitcaseRepositories): SuitcaseTransactionRunner =>
  (context, work) => {
    const handle = (context.isInTransaction ? boundHandle(context) : undefined) ?? db;

    return handle.transaction((transaction) => {
      const executor = Object.freeze<DrizzleContext>({
        [TRANSACTION_EXECUTOR]: transaction,
        db: transaction,
        isInTransaction: true,
      });

      const bound = Object.freeze({
        ...context,
        ...executor,
        assetRepo: repositories.assets.withContext(executor),
        resourceRepo: repositories.resources.withContext(executor),
        uploadSessionRepo: repositories.uploadSessions.withContext(executor),
      });

      // The server cannot express "this context, with these members rebound" generically, so the
      // adapter asserts the shape it just built; the members it replaces are the ones it owns.
      return work(bound);
    });
  };

/**
 * What every dialect adapter shares: the repositories a dialect wired, and the transaction runner
 * that binds them to a single handle. A dialect only has to name its repositories.
 */
export const createDrizzleAdapters = (
  db: DrizzleDatabase,
  repositories: SuitcaseRepositories,
): ServerAdapters => ({
  repositories,
  transaction: createTransactionRunner(db, repositories),
});
