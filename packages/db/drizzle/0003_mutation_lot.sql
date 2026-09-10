ALTER TABLE `mutations` ADD `lot_id` bigint unsigned;--> statement-breakpoint
CREATE INDEX `mutations_lot_idx` ON `mutations` (`lot_id`,`occurred_at`);