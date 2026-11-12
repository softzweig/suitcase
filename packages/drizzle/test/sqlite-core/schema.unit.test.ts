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

    it("leaves owner listings unindexed, as sqlite has no containment index", () => {
      expect(indexes).toHaveLength(2);
    });
  });

  describe("upload sessions", () => {
    const indexes = getTableConfig(uploadSessions).indexes;

    it("keeps only expirable sessions in the expiry index", () => {
      const { where } = indexOver(indexes, ["expires_at"]);

      expect(sqlOf(where)).toBe("status <> 'completed'");
    });

    it("allows a resource to be finalized by one session", () => {
      expect(indexOver(indexes, ["resource_id"])).toMatchObject({ unique: true });
    });
  });
});
