CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"hash_hex" text NOT NULL,
	"hash_algorithm" text NOT NULL,
	"size" integer NOT NULL,
	"mime_type" text NOT NULL,
	"bucket" text NOT NULL,
	"key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"asset_id" uuid NOT NULL,
	"owner" jsonb NOT NULL,
	"label" text,
	"file_name" text NOT NULL,
	"metadata" jsonb,
	"created_at" text NOT NULL,
	"updated_at" text
);
--> statement-breakpoint
CREATE TABLE "upload_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"resource_id" uuid,
	"target" jsonb NOT NULL,
	"metadata" jsonb,
	"hash_hex" text NOT NULL,
	"hash_algorithm" text NOT NULL,
	"size" integer NOT NULL,
	"mime_type" text NOT NULL,
	"file_name" text NOT NULL,
	"expires_at" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "assets_bucket_hash_hex_hash_algorithm_index" ON "assets" USING btree ("bucket","hash_hex","hash_algorithm");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_bucket_key_index" ON "assets" USING btree ("bucket","key");--> statement-breakpoint
CREATE INDEX "resources_asset_id_index" ON "resources" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "resources_owner_gin" ON "resources" USING gin ("owner" jsonb_path_ops);--> statement-breakpoint
CREATE INDEX "resources_created_at_index" ON "resources" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "upload_sessions_expires_at_index" ON "upload_sessions" USING btree ("expires_at") WHERE "upload_sessions"."status" <> 'completed';--> statement-breakpoint
CREATE UNIQUE INDEX "upload_sessions_resource_id_index" ON "upload_sessions" USING btree ("resource_id");