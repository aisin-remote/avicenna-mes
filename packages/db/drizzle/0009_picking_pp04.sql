ALTER TABLE `deliveries` MODIFY COLUMN `status` enum('DRAFT','PICKING','PICKED','LOADING','SHIPPED','RECEIVED','CANCELLED') NOT NULL DEFAULT 'DRAFT';--> statement-breakpoint
ALTER TABLE `deliveries` ADD `staging_location_id` bigint unsigned;--> statement-breakpoint
ALTER TABLE `delivery_lines` ADD `picked_kanban` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `delivery_lines` ADD `picked_qty` int DEFAULT 0 NOT NULL;