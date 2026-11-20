import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";

import { tables } from "../../src/sqlite-core/schema.js";
import { indexOver, sqlOf } from "../support/index-metadata.js";

const { assets, resources, uploadSessions } = tables;

describe("sqlite-core schema indexes", () => {
  describe("assets", () => {
    const indexes = getTableConfig(assets).indexes;

    it("keys content by digest within a bucket", () => {
      expect(indexOver(indexes, ["bucket", "hash_hex", "hash_algorithm"])).toMatchObject({
        unique: true,
      });
    });

    it("keys stored objects by location", () => {
      expect(indexOver(indexes, ["bucket", "key"])).toMatchObject({ unique: true });
    });
  });

  describe("resources", () => {
    const indexes = getTableConfig(resources).indexes;

    it("walks from an asset to its resources", () => {
      expect(indexOver(indexes, ["asset_id"]).unique).toBe(false);
    });

    it("sorts listings from a single index, since sqlite scans both directions", () => {
      expect(indexOver(indexes, ["created_at"]).unique).toBe(false);
    });

    it("narrows de-duplication by kind within an asset", () => {
      expect(indexOver(indexes, ["kind", "asset_id"])).toMatchObject({
        name: "resources_kind_asset_idx",
      });
    });

    it("leaves owner listings unindexed, as sqlite has no containment index", () => {
      expect(indexes).toHaveLength(3);
    });
  });

  describe("upload sessions", () => {
    const indexes = getTableConfig(uploadSessions).indexes;

    it("keeps only expirable sessions in the expiry index", () => {
      const { where } = indexOver(indexes, ["expires_at"]);

      expect(sqlOf(where)).toBe("status <> 'completed'");
    });

    it("looks up the resource a session resolved to", () => {
      expect(indexOver(indexes, ["resource_id"])).toMatchObject({ unique: false });
    });

    it("seeks the kind a session belongs to", () => {
      expect(indexOver(indexes, ["kind"])).toMatchObject({ name: "upload_sessions_kind_idx" });
    });
  });
});
