import {
  type Asset,
  AssetSchema,
  type Resource,
  ResourceSchema,
  type UploadSession,
  UploadSessionSchema,
} from "@softzweig/suitcase-core";

/** Hex-encoded random bytes, in the digest format the core schema accepts. */
const randomHex = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

export const newAsset = (overrides: Partial<Asset> = {}) =>
  AssetSchema.parse({
    id: crypto.randomUUID(),
    hashHex: randomHex(32),
    hashAlgorithm: "sha256",
    size: 42,
    mimeType: "image/png",
    bucket: "bucket",
    key: `assets/${crypto.randomUUID()}`,
    ...overrides,
  });

export const newResource = (overrides: Partial<Resource> = {}) =>
  ResourceSchema.parse({
    id: crypto.randomUUID(),
    assetId: crypto.randomUUID(),
    owner: { userId: "u_1" },
    kind: "userAvatar",
    label: null,
    fileName: "cat.png",
    metadata: null,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    ...overrides,
  });

export const newUploadSession = (overrides: Partial<UploadSession> = {}) =>
  UploadSessionSchema.parse({
    id: crypto.randomUUID(),
    status: "pending",
    resourceId: null,
    kind: "s3",
    owner: { userId: "u_1" },
    intent: null,
    metadata: null,
    hashHex: randomHex(32),
    hashAlgorithm: "sha256",
    size: 42,
    mimeType: "image/png",
    fileName: "cat.png",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: null,
    ...overrides,
  });
