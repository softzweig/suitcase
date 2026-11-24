import { createHttpHandler } from "@softzweig/suitcase-http/server";
import { createSuitcaseServer } from "@softzweig/suitcase-server";
import { adapters } from "../db";
import { definition } from "./definition";

/** Stands in for a session: a real app reads the user from the request it was given. */
export const DEMO_USER_ID = "demo-user";

export const server = createSuitcaseServer(definition, adapters);

/** Stands in for a verified session: a real app validates a token here, not a header. */
const userFrom = (request: Request) => request.headers.get("x-user")?.trim() || DEMO_USER_ID;

/** Every request runs as the user its header names; `bind` is where a real session is read. */
export const handleOperation = createHttpHandler(
  (request) => server.forExecution({ userId: userFrom(request) }).operations,
);
