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
