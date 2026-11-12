import { S3Client, S3ServiceException } from "@aws-sdk/client-s3";
import { vi } from "vitest";

import { createS3Client, S3StorageBucket } from "../../src/index.js";

export type TestBucket = {
  readonly bucket: S3StorageBucket;
  readonly commands: readonly unknown[];
};

/**
 * Doubles for the unit tests: a client whose `send` records commands instead of
 * talking to a server. Integration tests use a real backend, see `server.ts`.
 */

export const BUCKET = "suitcase-uploads";
export const KEY = "assets/a.png";

export const SHA256_HEX = "ab".repeat(32);
export const SHA512_HEX = "ab".repeat(64);

export const toBase64 = (hex: string): string => Buffer.from(hex, "hex").toString("base64");

/** Dummy credentials keep signing local: `getSignedUrl` never touches the network. */
export const createClient = (): S3Client =>
  createS3Client({
    region: "eu-central-1",
    credentials: {
      accessKeyId: "test-access-key",
      secretAccessKey: "test-secret-key",
    },
  });

/** A client with the SDK's default checksum policy, which breaks presigning (ON PURPOSE!) */
export const createDefaultClient = (): S3Client =>
  new S3Client({
    region: "eu-central-1",
    credentials: {
      accessKeyId: "test-access-key",
      secretAccessKey: "test-secret-key",
    },
  });

export const s3Error = (name: string, statusCode: number) =>
  new S3ServiceException({ name, $fault: "client", $metadata: { httpStatusCode: statusCode } });

/** A bucket whose client records every command and answers with `handler`. */
export function createBucket(
  handler: (command: unknown) => unknown = () => ({}),
  publicUrl?: string,
): TestBucket {
  const client = createClient();
  const commands: unknown[] = [];

  vi.spyOn(client, "send").mockImplementation(async (command) => {
    commands.push(command);
    return handler(command) as never;
  });

  return {
    // We can ignore the deprecation here, as the constructor explicitly allows it for test use
    bucket: new S3StorageBucket({ s3: client, name: BUCKET, publicUrl }),
    commands,
  };
}

/** The parameters the adapter handed to the SDK for the command at `index`. */
export const sentInput = (commands: readonly unknown[], index = 0): Record<string, unknown> =>
  (commands[index] as { input: Record<string, unknown> }).input;
