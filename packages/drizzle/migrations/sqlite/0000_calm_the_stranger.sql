CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`deleted_at` text,
	`hash_hex` text NOT NULL,
	`hash_algorithm` text NOT NULL,
	`size` integer NOT NULL,
	`mime_type` text NOT NULL,
	`bucket` text NOT NULL,
	`key` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assets_digest_unique` ON `assets` (`bucket`,`hash_hex`,`hash_algorithm`);--> statement-breakpoint
CREATE UNIQUE INDEX `assets_location_unique` ON `assets` (`bucket`,`key`);--> statement-breakpoint
CREATE TABLE `resources` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`kind` text NOT NULL,
	`owner` text NOT NULL,
	`label` text,
	`file_name` text NOT NULL,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `resources_asset_idx` ON `resources` (`asset_id`);--> statement-breakpoint
CREATE INDEX `resources_created_at_idx` ON `resources` (`created_at`);--> statement-breakpoint
CREATE INDEX `resources_kind_asset_idx` ON `resources` (`kind`,`asset_id`);--> statement-breakpoint
CREATE TABLE `upload_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`resource_id` text,
	`kind` text NOT NULL,
	`owner` text NOT NULL,
	`intent` text,
	`metadata` text,
	`hash_hex` text NOT NULL,
	`hash_algorithm` text NOT NULL,
	`size` integer NOT NULL,
	`mime_type` text NOT NULL,
	`file_name` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text,
	FOREIGN KEY (`resource_id`) REFERENCES `resources`(`id`) ON UPDATE cascade ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `upload_sessions_expiry_idx` ON `upload_sessions` (`expires_at`) WHERE "upload_sessions"."status" <> 'completed';--> statement-breakpoint
CREATE INDEX `upload_sessions_resource_idx` ON `upload_sessions` (`resource_id`);--> statement-breakpoint
CREATE INDEX `upload_sessions_kind_idx` ON `upload_sessions` (`kind`);