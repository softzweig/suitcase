import { createClient } from "@libsql/client";
import { createSqliteServerAdapters } from "@softzweig/suitcase-drizzle/sqlite-core";
import {
  createMemoryJobQueue,
  type JobHandlers,
  type JobQueue,
} from "@softzweig/suitcase-job-queue";
import type { ServerAdapters, SuitcaseJobs } from "@softzweig/suitcase-server";
import { drizzle } from "drizzle-orm/libsql";
import { DATABASE_URL, ensureDataFolder } from "./paths";

/**
 * Dev reloads the module graph, so the connection — and the queue the purge jobs run on — are kept
 * on the global object rather than rebuilt with the module.
 */
const cached = globalThis as typeof globalThis & {
  driveAdapters?: ServerAdapters;
  driveJobs?: JobQueue<SuitcaseJobs>;
};

/** The in-process queue: a delete queues its asset purge here, and it runs right away. */
function queue(handlers: JobHandlers<SuitcaseJobs>): JobQueue<SuitcaseJobs> {
  cached.driveJobs ??= createMemoryJobQueue(handlers, {
    onError: (error, job) => console.error(`"${job.name}" failed ${job.attempts} times`, error),
  });

  return cached.driveJobs;
}

function connect(): ServerAdapters {
  ensureDataFolder();

  return {
    ...createSqliteServerAdapters(drizzle(createClient({ url: DATABASE_URL }))),
    createJobQueue: queue,
  };
}

if (!cached.driveAdapters) {
  cached.driveAdapters = connect();
}

export const adapters = cached.driveAdapters;
