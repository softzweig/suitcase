import { describe, expect, it, test } from "vitest";

import {
  AssetHashAlgorithm,
  AssetSchema,
  AssetStatus,
  ResourceSchema,
  UploadSessionSchema,
  UploadStatus,
} from "../src/index.js";

const ID = "3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const HASH = "a".repeat(64);
const NOW = "2026-11-11T10:00:00.000Z";

const asset = {
  id: ID,
  status: AssetStatus.ACTIVE,
  deletedAt: null,
  hashHex: HASH,
  hashAlgorithm: "sha256",
  size: 1024,
  mimeType: "image/png",
  bucket: "suitcase-uploads",
  key: `assets/${ID}`,
};

const uploadSession = {
  id: ID,
  status: UploadStatus.PENDING,
  resourceId: null,
  kind: "user-avatar",
  owner: { userId: "u_1" },
  intent: null,
  metadata: null,
  hashHex: HASH,
  hashAlgorithm: "sha256",
  size: 2048,
  mimeType: "image/png",
  fileName: "avatar.png",
  expiresAt: NOW,
  createdAt: NOW,
  updatedAt: null,
};

describe("AssetSchema", () => {
  it("accepts a stored asset", () => {
    expect(AssetSchema.parse(asset).key).toBe(`assets/${ID}`);
  });

  test.for([AssetStatus.DELETED, AssetStatus.PURGING])("accepts a %s asset", (status) => {
    const parsed = AssetSchema.parse({ ...asset, status, deletedAt: NOW });

    expect(parsed.status).toBe(status);
    expect(parsed.deletedAt).toBe(NOW);
  });

  it("rejects a status outside the lifecycle", () => {
    expect(() => AssetSchema.parse({ ...asset, status: "zombie" })).toThrow();
  });

  it("rejects a negative size", () => {
    expect(() => AssetSchema.parse({ ...asset, size: -1 })).toThrow();
  });

  it("rejects an unknown hash algorithm", () => {
    expect(() => AssetSchema.parse({ ...asset, hashAlgorithm: "md5" })).toThrow();
  });

  test.for(Object.values(AssetHashAlgorithm))("accepts the %s algorithm", (hashAlgorithm) => {
    expect(AssetSchema.safeParse({ ...asset, hashAlgorithm }).success).toBe(true);
  });

  test.for([
    {
      label: "a base64 digest",
      hashHex: "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
    },
    { label: "an uppercase digest", hashHex: HASH.toUpperCase() },
    { label: "a prefixed digest", hashHex: `sha256:${HASH}` },
  ])("rejects $label", ({ hashHex }) => {
    expect(() => AssetSchema.parse({ ...asset, hashHex })).toThrow();
  });
});

describe("UploadSessionSchema", () => {
  it("accepts a pending session", () => {
    expect(UploadSessionSchema.parse(uploadSession).status).toBe("pending");
  });

  it("requires a kind", () => {
    expect(() => UploadSessionSchema.parse({ ...uploadSession, kind: undefined })).toThrow();
  });

  it("requires an owner", () => {
    const { owner: _omitted, ...withoutOwner } = uploadSession;

    expect(() => UploadSessionSchema.parse(withoutOwner)).toThrow();
  });

  it("keeps the ownership decision on the session, not the kind", () => {
    const session = UploadSessionSchema.parse({ ...uploadSession, owner: { teamId: "t_1" } });

    expect(session.owner).toEqual({ teamId: "t_1" });
    expect(session.kind).toBe("user-avatar");
  });

  it("rejects non-ISO timestamps", () => {
    expect(() => UploadSessionSchema.parse({ ...uploadSession, expiresAt: "tomorrow" })).toThrow();
  });

  it("keeps the intent the client declared", () => {
    const session = UploadSessionSchema.parse({ ...uploadSession, intent: { folderId: "docs" } });

    expect(session.intent).toEqual({ folderId: "docs" });
  });

  it("rejects an intent that is not an object", () => {
    expect(() => UploadSessionSchema.parse({ ...uploadSession, intent: "docs" })).toThrow();
  });

  it("trims the file name", () => {
    expect(
      UploadSessionSchema.parse({
        ...uploadSession,
        fileName: "  avatar.png  ",
      }).fileName,
    ).toBe("avatar.png");
  });
});

describe("ResourceSchema", () => {
  const resource = {
    id: ID,
    assetId: ID,
    owner: { userId: "u_1", system: true },
    kind: "userAvatar",
    label: null,
    fileName: "avatar.png",
    metadata: null,
    createdAt: NOW,
    updatedAt: null,
  };

  it("accepts a valid resource", () => {
    expect(ResourceSchema.parse(resource).owner).toEqual({
      userId: "u_1",
      system: true,
    });
  });

  it("requires a kind", () => {
    const { kind: _omitted, ...withoutKind } = resource;

    expect(() => ResourceSchema.parse(withoutKind)).toThrow();
  });

  it("rejects a kind longer than 512 characters", () => {
    expect(() => ResourceSchema.parse({ ...resource, kind: "a".repeat(513) })).toThrow();
  });

  it("rejects non-primitive owner values", () => {
    expect(() => ResourceSchema.parse({ ...resource, owner: { user: { id: "u_1" } } })).toThrow();
  });
});
