import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { tables } from "../../src/pg-core/schema.js";
import { indexOver, sqlOf } from "../support/index-metadata.js";

const { assets, resources, uploadSessions } = tables;

describe("pg-core schema indexes", () => {
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

    it("indexes owner containment for listings", () => {
      const gin = indexes.find(({ config }) => config.method === "gin");

      if (gin === undefined) throw new Error("no gin index on resources");

      expect(sqlOf(gin.config.columns[0])).toBe("owner jsonb_path_ops");
    });

    it("sorts listings newest first", () => {
      const { columns } = indexOver(indexes, ["created_at"]);

      expect(columns).toMatchObject([{ name: "created_at", indexConfig: { order: "desc" } }]);
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
