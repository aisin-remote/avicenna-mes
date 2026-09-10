CREATE TABLE `bom_lines` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`plant_id` bigint unsigned NOT NULL,
	`parent_part_id` bigint unsigned NOT NULL,
	`component_part_id` bigint unsigned NOT NULL,
	`qty_per` decimal(12,4) NOT NULL,
	`uom` varchar(16) NOT NULL DEFAULT 'pcs',
	`scrap_pct` decimal(5,2) NOT NULL DEFAULT '0',
	`sequence` int NOT NULL DEFAULT 0,
	`effective_from` date NOT NULL,
	`effective_to` date,
	`note` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bom_lines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `consumptions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`plant_id` bigint unsigned NOT NULL,
	`line_id` bigint unsigned,
	`produced_part_id` bigint unsigned NOT NULL,
	`component_part_id` bigint unsigned NOT NULL,
	`lot_id` bigint unsigned,
	`qty` decimal(14,4) NOT NULL,
	`uom` varchar(16) NOT NULL DEFAULT 'pcs',
	`source` enum('BACKFLUSH','MANUAL','ADJUSTMENT') NOT NULL,
	`occurred_at` timestamp NOT NULL,
	`user_id` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `consumptions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `genealogy` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`plant_id` bigint unsigned NOT NULL,
	`parent_serial` varchar(64) NOT NULL,
	`parent_part_id` bigint unsigned NOT NULL,
	`component_part_id` bigint unsigned NOT NULL,
	`component_serial` varchar(64),
	`component_lot_id` bigint unsigned,
	`qty` decimal(14,4) NOT NULL DEFAULT '1',
	`evidence` enum('SCANNED','INFERRED') NOT NULL DEFAULT 'INFERRED',
	`occurred_at` timestamp NOT NULL,
	`meta` json,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `genealogy_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `lots` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`plant_id` bigint unsigned NOT NULL,
	`part_id` bigint unsigned NOT NULL,
	`lot_number` varchar(64) NOT NULL,
	`supplier_lot_number` varchar(64),
	`supplier_id` bigint unsigned,
	`received_at` timestamp,
	`expires_at` date,
	`initial_qty` decimal(14,4) NOT NULL DEFAULT '0',
	`status` enum('OPEN','CONSUMED','BLOCKED','RETURNED') NOT NULL DEFAULT 'OPEN',
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `lots_id` PRIMARY KEY(`id`),
	CONSTRAINT `lots_plant_number_unique` UNIQUE(`plant_id`,`lot_number`)
);
--> statement-breakpoint
CREATE TABLE `receipt_lines` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`receipt_id` bigint unsigned NOT NULL,
	`part_id` bigint unsigned NOT NULL,
	`lot_id` bigint unsigned,
	`qty` decimal(14,4) NOT NULL,
	`uom` varchar(16) NOT NULL DEFAULT 'pcs',
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `receipt_lines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `receipts` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`plant_id` bigint unsigned NOT NULL,
	`supplier_id` bigint unsigned NOT NULL,
	`document_number` varchar(64) NOT NULL,
	`supplier_doc_number` varchar(64),
	`received_at` timestamp NOT NULL,
	`location_id` bigint unsigned,
	`status` enum('DRAFT','RECEIVED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
	`received_by_id` bigint unsigned,
	`note` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `receipts_id` PRIMARY KEY(`id`),
	CONSTRAINT `receipts_plant_document_unique` UNIQUE(`plant_id`,`document_number`)
);
--> statement-breakpoint
CREATE TABLE `transfer_lines` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`transfer_id` bigint unsigned NOT NULL,
	`part_id` bigint unsigned NOT NULL,
	`lot_id` bigint unsigned,
	`serial_number` varchar(64),
	`qty` decimal(14,4) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `transfer_lines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `transfers` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`plant_id` bigint unsigned NOT NULL,
	`document_number` varchar(64) NOT NULL,
	`from_location_id` bigint unsigned,
	`to_location_id` bigint unsigned,
	`from_line_id` bigint unsigned,
	`to_line_id` bigint unsigned,
	`moved_at` timestamp NOT NULL,
	`status` enum('DRAFT','MOVED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
	`user_id` bigint unsigned,
	`note` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `transfers_id` PRIMARY KEY(`id`),
	CONSTRAINT `transfers_plant_document_unique` UNIQUE(`plant_id`,`document_number`)
);
--> statement-breakpoint
ALTER TABLE `mutations` MODIFY COLUMN `type` enum('PRODUCTION_IN','DELIVERY_OUT','NG_OUT','ADJUSTMENT','STOCK_TAKE','TRANSFER_IN','TRANSFER_OUT','RECEIVING_IN','CONSUMPTION_OUT') NOT NULL;--> statement-breakpoint
ALTER TABLE `parts` ADD `part_type` enum('RAW_MATERIAL','COMPONENT','WIP','FINISHED_GOOD') DEFAULT 'FINISHED_GOOD' NOT NULL;--> statement-breakpoint
ALTER TABLE `parts` ADD `source_type` enum('PURCHASED','MANUFACTURED') DEFAULT 'MANUFACTURED' NOT NULL;--> statement-breakpoint
ALTER TABLE `parts` ADD `tracking_mode` enum('SERIAL','LOT','QUANTITY') DEFAULT 'SERIAL' NOT NULL;--> statement-breakpoint
ALTER TABLE `parts` ADD `uom` varchar(16) DEFAULT 'pcs' NOT NULL;--> statement-breakpoint
ALTER TABLE `bom_lines` ADD CONSTRAINT `bom_lines_plant_id_plants_id_fk` FOREIGN KEY (`plant_id`) REFERENCES `plants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bom_lines` ADD CONSTRAINT `bom_lines_parent_part_id_parts_id_fk` FOREIGN KEY (`parent_part_id`) REFERENCES `parts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bom_lines` ADD CONSTRAINT `bom_lines_component_part_id_parts_id_fk` FOREIGN KEY (`component_part_id`) REFERENCES `parts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `consumptions` ADD CONSTRAINT `consumptions_plant_id_plants_id_fk` FOREIGN KEY (`plant_id`) REFERENCES `plants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `consumptions` ADD CONSTRAINT `consumptions_line_id_lines_id_fk` FOREIGN KEY (`line_id`) REFERENCES `lines`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `consumptions` ADD CONSTRAINT `consumptions_produced_part_id_parts_id_fk` FOREIGN KEY (`produced_part_id`) REFERENCES `parts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `consumptions` ADD CONSTRAINT `consumptions_component_part_id_parts_id_fk` FOREIGN KEY (`component_part_id`) REFERENCES `parts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `consumptions` ADD CONSTRAINT `consumptions_lot_id_lots_id_fk` FOREIGN KEY (`lot_id`) REFERENCES `lots`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `consumptions` ADD CONSTRAINT `consumptions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `genealogy` ADD CONSTRAINT `genealogy_plant_id_plants_id_fk` FOREIGN KEY (`plant_id`) REFERENCES `plants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `genealogy` ADD CONSTRAINT `genealogy_parent_part_id_parts_id_fk` FOREIGN KEY (`parent_part_id`) REFERENCES `parts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `genealogy` ADD CONSTRAINT `genealogy_component_part_id_parts_id_fk` FOREIGN KEY (`component_part_id`) REFERENCES `parts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `genealogy` ADD CONSTRAINT `genealogy_component_lot_id_lots_id_fk` FOREIGN KEY (`component_lot_id`) REFERENCES `lots`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lots` ADD CONSTRAINT `lots_plant_id_plants_id_fk` FOREIGN KEY (`plant_id`) REFERENCES `plants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lots` ADD CONSTRAINT `lots_part_id_parts_id_fk` FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lots` ADD CONSTRAINT `lots_supplier_id_suppliers_id_fk` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `receipt_lines` ADD CONSTRAINT `receipt_lines_receipt_id_receipts_id_fk` FOREIGN KEY (`receipt_id`) REFERENCES `receipts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `receipt_lines` ADD CONSTRAINT `receipt_lines_part_id_parts_id_fk` FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `receipt_lines` ADD CONSTRAINT `receipt_lines_lot_id_lots_id_fk` FOREIGN KEY (`lot_id`) REFERENCES `lots`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `receipts` ADD CONSTRAINT `receipts_plant_id_plants_id_fk` FOREIGN KEY (`plant_id`) REFERENCES `plants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `receipts` ADD CONSTRAINT `receipts_supplier_id_suppliers_id_fk` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `receipts` ADD CONSTRAINT `receipts_location_id_locations_id_fk` FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `receipts` ADD CONSTRAINT `receipts_received_by_id_users_id_fk` FOREIGN KEY (`received_by_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `transfer_lines` ADD CONSTRAINT `transfer_lines_transfer_id_transfers_id_fk` FOREIGN KEY (`transfer_id`) REFERENCES `transfers`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `transfer_lines` ADD CONSTRAINT `transfer_lines_part_id_parts_id_fk` FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `transfer_lines` ADD CONSTRAINT `transfer_lines_lot_id_lots_id_fk` FOREIGN KEY (`lot_id`) REFERENCES `lots`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `transfers` ADD CONSTRAINT `transfers_plant_id_plants_id_fk` FOREIGN KEY (`plant_id`) REFERENCES `plants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `transfers` ADD CONSTRAINT `transfers_from_location_id_locations_id_fk` FOREIGN KEY (`from_location_id`) REFERENCES `locations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `transfers` ADD CONSTRAINT `transfers_to_location_id_locations_id_fk` FOREIGN KEY (`to_location_id`) REFERENCES `locations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `transfers` ADD CONSTRAINT `transfers_from_line_id_lines_id_fk` FOREIGN KEY (`from_line_id`) REFERENCES `lines`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `transfers` ADD CONSTRAINT `transfers_to_line_id_lines_id_fk` FOREIGN KEY (`to_line_id`) REFERENCES `lines`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `transfers` ADD CONSTRAINT `transfers_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `bom_lines_parent_idx` ON `bom_lines` (`parent_part_id`,`effective_from`);--> statement-breakpoint
CREATE INDEX `bom_lines_component_idx` ON `bom_lines` (`component_part_id`);--> statement-breakpoint
CREATE INDEX `consumptions_produced_idx` ON `consumptions` (`produced_part_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `consumptions_component_idx` ON `consumptions` (`component_part_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `consumptions_lot_idx` ON `consumptions` (`lot_id`);--> statement-breakpoint
CREATE INDEX `genealogy_parent_idx` ON `genealogy` (`parent_serial`);--> statement-breakpoint
CREATE INDEX `genealogy_lot_idx` ON `genealogy` (`component_lot_id`);--> statement-breakpoint
CREATE INDEX `genealogy_component_serial_idx` ON `genealogy` (`component_serial`);--> statement-breakpoint
CREATE INDEX `genealogy_part_time_idx` ON `genealogy` (`parent_part_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `lots_part_idx` ON `lots` (`part_id`);--> statement-breakpoint
CREATE INDEX `lots_supplier_lot_idx` ON `lots` (`supplier_lot_number`);--> statement-breakpoint
CREATE INDEX `receipt_lines_receipt_idx` ON `receipt_lines` (`receipt_id`);--> statement-breakpoint
CREATE INDEX `receipt_lines_part_idx` ON `receipt_lines` (`part_id`);--> statement-breakpoint
CREATE INDEX `receipts_supplier_date_idx` ON `receipts` (`supplier_id`,`received_at`);--> statement-breakpoint
CREATE INDEX `transfer_lines_transfer_idx` ON `transfer_lines` (`transfer_id`);--> statement-breakpoint
CREATE INDEX `transfer_lines_part_idx` ON `transfer_lines` (`part_id`);--> statement-breakpoint
CREATE INDEX `transfers_moved_idx` ON `transfers` (`moved_at`);