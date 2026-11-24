import { createSuitcaseClient } from "@softzweig/suitcase-client";
import { createSuitcaseOperations } from "@softzweig/suitcase-core/contracts";
import { createHttpTransport } from "@softzweig/suitcase-http";
import { currentUser } from "../user";
import type { DriveClient } from "./definition";

/**
 * The browser's client: operations at `/api/suitcase`, and the bytes PUT straight at the signed
 * URL the backend hands out, which is why no file ever passes through the operation endpoints.
 *
 * The acting user rides in a header, read per call rather than captured, so switching the name
 * changes what the very next call claims. The digest is the package's default.
 */
export const client = createSuitcaseClient<DriveClient>({
  operations: createSuitcaseOperations<DriveClient>({
    transport: createHttpTransport({
      configure: () => ({ headers: { "x-user": currentUser() } }),
      url: "/api/suitcase",
    }),
  }),
  transfer: async (target, bytes) => {
    const response = await fetch(target.url, {
      body: bytes,
      headers: target.headers,
      method: target.method,
    });

    if (!response.ok) {
      throw new Error(`The upload was refused (${response.status}).`);
    }
  },
});
