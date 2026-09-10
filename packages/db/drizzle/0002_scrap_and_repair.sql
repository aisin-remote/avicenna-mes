CREATE TABLE `ng_dispositions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`plant_id` bigint unsigned NOT NULL,
	`line_id` bigint unsigned,
	`part_id` bigint unsigned NOT NULL,
	`serial_number` varchar(64),
	`lot_id` bigint unsigned,
	`qty` decimal(14,4) NOT NULL,
	`disposition` enum('REMELT','REPAIR','DISCARD','RETURN_SUPPLIER') NOT NULL,
	`converted_to_part_id` bigint unsigned,
	`converted_qty` decimal(14,4),
	`converted_lot_id` bigint unsigned,
	`reason` varchar(255),
	`occurred_at` timestamp NOT NULL,
	`user_id` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ng_dispositions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `repair_lines` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`repair_id` bigint unsigned NOT NULL,
	`component_part_id` bigint unsigned NOT NULL,
	`removed_serial` varchar(64),
	`removed_lot_id` bigint unsigned,
	`removed_disposition` enum('REMELT','REPAIR','DISCARD','RETURN_SUPPLIER'),
	`installed_serial` varchar(64),
	`installed_lot_id` bigint unsigned,
	`qty` decimal(14,4) NOT NULL DEFAULT '1',
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `repair_lines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `repairs` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`plant_id` bigint unsigned NOT NULL,
	`line_id` bigint unsigned,
	`part_id` bigint unsigned NOT NULL,
	`serial_number` varchar(64) NOT NULL,
	`reason` varchar(255),
	`status` enum('OPEN','DONE','SCRAPPED') NOT NULL DEFAULT 'OPEN',
	`started_at` timestamp NOT NULL,
	`finished_at` timestamp,
	`user_id` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `repairs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `scrap_rules` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`plant_id` bigint unsigned NOT NULL,
	`part_id` bigint unsigned NOT NULL,
	`disposition` enum('REMELT','REPAIR','DISCARD','RETURN_SUPPLIER') NOT NULL,
	`converts_to_part_id` bigint unsigned,
	`conversion_qty` decimal(12,4),
	`conversion_uom` varchar(16),
	`note` varchar(255),
	`is_active` enum('0','1') NOT NULL DEFAULT '1',
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `scrap_rules_id` PRIMARY KEY(`id`),
	CONSTRAINT `scrap_rules_part_unique` UNIQUE(`plant_id`,`part_id`)
);
--> statement-breakpoint
ALTER TABLE `genealogy` ADD `superseded_at` timestamp;--> statement-breakpoint
ALTER TABLE `genealogy` ADD `superseded_by_repair_id` bigint unsigned;--> statement-breakpoint
ALTER TABLE `ng_dispositions` ADD CONSTRAINT `ng_dispositions_plant_id_plants_id_fk` FOREIGN KEY (`plant_id`) REFERENCES `plants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ng_dispositions` ADD CONSTRAINT `ng_dispositions_line_id_lines_id_fk` FOREIGN KEY (`line_id`) REFERENCES `lines`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ng_dispositions` ADD CONSTRAINT `ng_dispositions_part_id_parts_id_fk` FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ng_dispositions` ADD CONSTRAINT `ng_dispositions_lot_id_lots_id_fk` FOREIGN KEY (`lot_id`) REFERENCES `lots`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ng_dispositions` ADD CONSTRAINT `ng_dispositions_converted_to_part_id_parts_id_fk` FOREIGN KEY (`converted_to_part_id`) REFERENCES `parts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ng_dispositions` ADD CONSTRAINT `ng_dispositions_converted_lot_id_lots_id_fk` FOREIGN KEY (`converted_lot_id`) REFERENCES `lots`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ng_dispositions` ADD CONSTRAINT `ng_dispositions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `repair_lines` ADD CONSTRAINT `repair_lines_repair_id_repairs_id_fk` FOREIGN KEY (`repair_id`) REFERENCES `repairs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `repair_lines` ADD CONSTRAINT `repair_lines_component_part_id_parts_id_fk` FOREIGN KEY (`component_part_id`) REFERENCES `parts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `repair_lines` ADD CONSTRAINT `repair_lines_removed_lot_id_lots_id_fk` FOREIGN KEY (`removed_lot_id`) REFERENCES `lots`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `repair_lines` ADD CONSTRAINT `repair_lines_installed_lot_id_lots_id_fk` FOREIGN KEY (`installed_lot_id`) REFERENCES `lots`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `repairs` ADD CONSTRAINT `repairs_plant_id_plants_id_fk` FOREIGN KEY (`plant_id`) REFERENCES `plants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `repairs` ADD CONSTRAINT `repairs_line_id_lines_id_fk` FOREIGN KEY (`line_id`) REFERENCES `lines`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `repairs` ADD CONSTRAINT `repairs_part_id_parts_id_fk` FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `repairs` ADD CONSTRAINT `repairs_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scrap_rules` ADD CONSTRAINT `scrap_rules_plant_id_plants_id_fk` FOREIGN KEY (`plant_id`) REFERENCES `plants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scrap_rules` ADD CONSTRAINT `scrap_rules_part_id_parts_id_fk` FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scrap_rules` ADD CONSTRAINT `scrap_rules_converts_to_part_id_parts_id_fk` FOREIGN KEY (`converts_to_part_id`) REFERENCES `parts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ng_dispositions_part_time_idx` ON `ng_dispositions` (`part_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `ng_dispositions_serial_idx` ON `ng_dispositions` (`serial_number`);--> statement-breakpoint
CREATE INDEX `ng_dispositions_disposition_idx` ON `ng_dispositions` (`disposition`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `repair_lines_repair_idx` ON `repair_lines` (`repair_id`);--> statement-breakpoint
CREATE INDEX `repair_lines_component_idx` ON `repair_lines` (`component_part_id`);--> statement-breakpoint
CREATE INDEX `repairs_serial_idx` ON `repairs` (`serial_number`);--> statement-breakpoint
CREATE INDEX `repairs_status_idx` ON `repairs` (`status`,`started_at`);