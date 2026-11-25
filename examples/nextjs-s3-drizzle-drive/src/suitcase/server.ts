import { createHttpHandler } from "@softzweig/suitcase-http/server";
import { createSuitcaseServer } from "@softzweig/suitcase-server";
import { adapters } from "../db";
import { DEFAULT_USER } from "../user";
import { definition } from "./definition";

export const server = createSuitcaseServer(definition, adapters);

/** Stands in for a verified session: a real app validates a token here, not a header. */
const userFrom = (request: Request) => request.headers.get("x-user")?.trim() || DEFAULT_USER;

/** Every request runs as the user its header names; `bind` is where a real session is read. */
export const handleOperation = createHttpHandler(
  (request) => server.forExecution({ userId: userFrom(request) }).operations,
);

/**
 * What one user's files add up to, asked through the same typed api the browser talks to: the
 * owner named here is the execution, so the definition's `authorize` answers for `action: "usage"`
 * exactly as it does for a delete.
 */
export const usageOf = (userId: string) =>
  server
    .forExecution({ userId })
    .usage.total({ kinds: ["file"], owner: { userId } })
    .unwrap();
