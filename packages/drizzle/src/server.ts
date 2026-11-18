import type { ServerAdapters, SuitcaseTransactionRunner } from "@softzweig/suitcase-server";
import type { SuitcaseRepositories } from "@softzweig/suitcase-server/repository";
import type { DrizzleContext, DrizzleDatabase } from "./repository.js";

/**
 * Runs a service transaction on one drizzle transaction handle.
 *
 * Unlike services, repositories do not follow a context, so each handle is rebound explicitly;
 * `isInTransaction` is what lets the services assert that they are inside the scope.
 */
const createTransactionRunner =
  (db: DrizzleDatabase, repositories: SuitcaseRepositories): SuitcaseTransactionRunner =>
  (context, work) =>
    db.transaction((transaction) => {
      const executor: DrizzleContext = { db: transaction, isInTransaction: true };

      const bound = {
        ...context,
        isInTransaction: true,
        assetRepo: repositories.assets.withContext(executor),
        resourceRepo: repositories.resources.withContext(executor),
        uploadSessionRepo: repositories.uploadSessions.withContext(executor),
      };

      // The server cannot express "this context, with these members rebound" generically, so the
      // adapter asserts the shape it just built; the members it replaces are the ones it owns.
      return work(bound as typeof context);
    });

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
