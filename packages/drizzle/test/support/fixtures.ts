import { randomBytes, randomUUID } from "node:crypto";
import {
  type Asset,
  AssetSchema,
  type Resource,
  ResourceSchema,
  type UploadSession,
  UploadSessionSchema,
} from "@softzweig/suitcase-core";

export const newAsset = (overrides: Partial<Asset> = {}) =>
  AssetSchema.parse({
    id: randomUUID(),
    hashHex: randomBytes(32).toString("hex"),
    hashAlgorithm: "sha256",
    size: 42,
    mimeType: "image/png",
    bucket: "bucket",
    key: `assets/${randomUUID()}`,
    ...overrides,
  });

export const newResource = (overrides: Partial<Resource> = {}) =>
  ResourceSchema.parse({
    id: randomUUID(),
    assetId: randomUUID(),
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
    id: randomUUID(),
    status: "pending",
    resourceId: null,
    target: { kind: "s3", bucket: "bucket" },
    metadata: null,
    hashHex: randomBytes(32).toString("hex"),
    hashAlgorithm: "sha256",
    size: 42,
    mimeType: "image/png",
    fileName: "cat.png",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: null,
    ...overrides,
  });
