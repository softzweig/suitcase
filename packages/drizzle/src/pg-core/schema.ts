import {
  type Asset,
  type AssetHashAlgorithm,
  type Resource,
  type ResourceMetadata,
  type ResourceOwner,
  type UploadMetadata,
  type UploadSession,
  UploadStatus,
  type UploadTarget,
} from "@softzweig/suitcase-core";
import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export type AssetRow = typeof assets.$inferSelect;
export type ResourceRow = typeof resources.$inferSelect;
export type UploadSessionRow = typeof uploadSessions.$inferSelect;

const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hashHex: text("hash_hex").notNull(),
    hashAlgorithm: text("hash_algorithm").$type<AssetHashAlgorithm>().notNull(),
    size: integer("size").notNull(),
    mimeType: text("mime_type").notNull(),
    bucket: text("bucket").notNull(),
    key: text("key").notNull(),
  } satisfies Record<keyof Asset, unknown>,
  (table) => [
    // Content addressing makes the digest the natural key, scoped to the bucket
    // that stores the object: this is both the "do we already have these bytes?"
    // lookup and the guarantee that a bucket holds one row per content.
    uniqueIndex().on(table.bucket, table.hashHex, table.hashAlgorithm),
    // A physical object backs one asset only, so (bucket, key) is unique too —
    // and the index serves the point read taken when an object is fetched by
    // its location rather than through an asset row.
    uniqueIndex().on(table.bucket, table.key),
  ],
);

const resources = pgTable(
  "resources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id")
      .notNull()
      // RESTRICT, not CASCADE: the domain deletes dependents explicitly, so the
      // database only has to refuse a delete that forgot them.
      .references(() => assets.id, { onDelete: "restrict", onUpdate: "cascade" }),
    owner: jsonb("owner").$type<ResourceOwner>().notNull(),
    label: text("label"),
    fileName: text("file_name").notNull(),
    metadata: jsonb("metadata").$type<ResourceMetadata>(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at"),
  } satisfies Record<keyof Resource, unknown>,
  (table) => [
    // Reference counting and garbage collection walk from an asset to its
    // resources; without this every asset deletion scans the table.
    index().on(table.assetId),
    // `owner` is an open record, so "list what this principal owns" is asked as
    // containment (`owner @> '{"userId": …}'`). `jsonb_path_ops` indexes exactly
    // that operator, in less space and with fewer false positives than the
    // default op class. Expression indexes need an explicit name.
    index("resources_owner_gin").using("gin", sql`${table.owner} jsonb_path_ops`),
    // Listings are newest first; a descending index turns that into an index
    // scan instead of a sort over every matching row.
    index().on(table.createdAt.desc()),
  ],
);

const uploadSessions = pgTable(
  "upload_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    status: text("status").$type<UploadStatus>().notNull(),
    // Nullable: the session outlives the resource it produced, losing only the link.
    resourceId: uuid("resource_id").references(() => resources.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    target: jsonb("target").$type<UploadTarget>().notNull(),
    metadata: jsonb("metadata").$type<UploadMetadata>(),
    hashHex: text("hash_hex").notNull(),
    hashAlgorithm: text("hash_algorithm").$type<AssetHashAlgorithm>().notNull(),
    size: integer("size").notNull(),
    mimeType: text("mime_type").notNull(),
    fileName: text("file_name").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at"),
  } satisfies Record<keyof UploadSession, unknown>,
  (table) => [
    // Expiry only ever sweeps sessions that can still expire, so a partial index
    // stays proportional to in-flight uploads instead of growing with completed
    // history — and the sweep touches this index alone.
    index()
      .on(table.expiresAt)
      .where(sql`${table.status} <> ${sql.raw(`'${UploadStatus.COMPLETED}'`)}`),
    // A resource is the outcome of exactly one upload session. Postgres allows
    // unlimited NULLs in a unique index, so this constrains finalized rows only.
    uniqueIndex().on(table.resourceId),
  ],
);

export const tables = Object.freeze({ assets, resources, uploadSessions });
