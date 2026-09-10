CREATE TABLE `devices` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`code` varchar(64) NOT NULL,
	`name` varchar(128) NOT NULL,
	`plant_id` bigint unsigned,
	`kind` enum('SCANNER','RFID','MACHINE_PANEL','PRINTER') NOT NULL,
	`token_hash` varchar(255),
	`last_seen_at` varchar(32),
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `devices_id` PRIMARY KEY(`id`),
	CONSTRAINT `devices_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `plants` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`code` varchar(32) NOT NULL,
	`name` varchar(128) NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `plants_id` PRIMARY KEY(`id`),
	CONSTRAINT `plants_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`name` varchar(64) NOT NULL,
	`label` varchar(128),
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `roles_id` PRIMARY KEY(`id`),
	CONSTRAINT `roles_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`npk` varchar(32) NOT NULL,
	`name` varchar(128) NOT NULL,
	`email` varchar(191),
	`password_hash` varchar(255),
	`role_id` bigint unsigned,
	`plant_id` bigint unsigned,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_npk_unique` UNIQUE(`npk`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `customer_parts` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`part_id` bigint unsigned NOT NULL,
	`customer_id` bigint unsigned NOT NULL,
	`customer_part_number` varchar(64) NOT NULL,
	`customer_back_number` varchar(64),
	`qty_per_kanban` int,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `customer_parts_id` PRIMARY KEY(`id`),
	CONSTRAINT `customer_parts_unique` UNIQUE(`customer_id`,`customer_part_number`)
);
--> statement-breakpoint
CREATE TABLE `customers` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`code` varchar(32) NOT NULL,
	`name` varchar(128) NOT NULL,
	`dock` varchar(32),
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `customers_id` PRIMARY KEY(`id`),
	CONSTRAINT `customers_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `lines` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`plant_id` bigint unsigned NOT NULL,
	`code` varchar(32) NOT NULL,
	`name` varchar(128) NOT NULL,
	`process_type` enum('CASTING','MACHINING','ASSEMBLING','INJECTION') NOT NULL,
	`sort_order` int NOT NULL DEFAULT 0,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `lines_id` PRIMARY KEY(`id`),
	CONSTRAINT `lines_plant_code_unique` UNIQUE(`plant_id`,`code`)
);
--> statement-breakpoint
CREATE TABLE `machines` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`plant_id` bigint unsigned NOT NULL,
	`line_id` bigint unsigned,
	`code` varchar(32) NOT NULL,
	`name` varchar(128) NOT NULL,
	`external_ref` varchar(64),
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `machines_id` PRIMARY KEY(`id`),
	CONSTRAINT `machines_plant_code_unique` UNIQUE(`plant_id`,`code`)
);
--> statement-breakpoint
CREATE TABLE `parts` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`plant_id` bigint unsigned NOT NULL,
	`line_id` bigint unsigned,
	`part_number` varchar(64) NOT NULL,
	`back_number` varchar(64),
	`name` varchar(191) NOT NULL,
	`process_type` enum('CASTING','MACHINING','ASSEMBLING','INJECTION') NOT NULL,
	`qty_per_kanban` int,
	`standard_stock` int NOT NULL DEFAULT 0,
	`photo_path` varchar(255),
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `parts_id` PRIMARY KEY(`id`),
	CONSTRAINT `parts_plant_partnumber_unique` UNIQUE(`plant_id`,`part_number`)
);
--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`code` varchar(32) NOT NULL,
	`name` varchar(128) NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `suppliers_id` PRIMARY KEY(`id`),
	CONSTRAINT `suppliers_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `tooling_parts` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`tooling_id` bigint unsigned NOT NULL,
	`part_id` bigint unsigned NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tooling_parts_id` PRIMARY KEY(`id`),
	CONSTRAINT `tooling_parts_unique` UNIQUE(`tooling_id`,`part_id`)
);
--> statement-breakpoint
CREATE TABLE `toolings` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`plant_id` bigint unsigned NOT NULL,
	`code` varchar(32) NOT NULL,
	`name` varchar(128) NOT NULL,
	`kind` enum('MOLD','DIES','JIG') NOT NULL,
	`cavity` int NOT NULL DEFAULT 1,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `toolings_id` PRIMARY KEY(`id`),
	CONSTRAINT `toolings_plant_code_unique` UNIQUE(`plant_id`,`code`)
);
--> statement-breakpoint
CREATE TABLE `kanban_events` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`kanban_id` bigint unsigned NOT NULL,
	`type` enum('PRODUCED','PULLED','PAIRED','STORED','LOADED','DELIVERED','CANCELLED','ADJUSTED') NOT NULL,
	`line_id` bigint unsigned,
	`paired_kanban_id` bigint unsigned,
	`qty` int,
	`user_id` bigint unsigned,
	`device_id` bigint unsigned,
	`occurred_at` timestamp NOT NULL,
	`meta` json,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `kanban_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `kanbans` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`plant_id` bigint unsigned NOT NULL,
	`part_id` bigint unsigned NOT NULL,
	`customer_id` bigint unsigned,
	`serial_number` varchar(64) NOT NULL,
	`qty` int NOT NULL,
	`status` enum('CREATED','PRODUCED','STORED','PULLED','LOADED','DELIVERED','CANCELLED') NOT NULL DEFAULT 'CREATED',
	`produced_at` timestamp,
	`delivered_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `kanbans_id` PRIMARY KEY(`id`),
	CONSTRAINT `kanbans_plant_serial_unique` UNIQUE(`plant_id`,`serial_number`)
);
--> statement-breakpoint
CREATE TABLE `production_plans` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`plant_id` bigint unsigned NOT NULL,
	`line_id` bigint unsigned NOT NULL,
	`part_id` bigint unsigned NOT NULL,
	`customer_id` bigint unsigned,
	`plan_date` date NOT NULL,
	`cycle` int NOT NULL DEFAULT 1,
	`seq_no` int NOT NULL DEFAULT 0,
	`order_qty` int NOT NULL DEFAULT 0,
	`direct_pulling_qty` int NOT NULL DEFAULT 0,
	`stock_chute_qty` int NOT NULL DEFAULT 0,
	`dock` varchar(32),
	`dn_number` varchar(64),
	`working_start` time,
	`working_end` time,
	`delivery_time` time,
	`actual_start_at` timestamp,
	`actual_end_at` timestamp,
	`plan_source` enum('MANUAL','IMPORT','STATIC_SEQ','API') NOT NULL DEFAULT 'MANUAL',
	`status` enum('DRAFT','RELEASED','RUNNING','DONE','CANCELLED') NOT NULL DEFAULT 'DRAFT',
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `production_plans_id` PRIMARY KEY(`id`),
	CONSTRAINT `production_plans_slot_unique` UNIQUE(`line_id`,`plan_date`,`cycle`,`seq_no`)
);
--> statement-breakpoint
CREATE TABLE `scan_events` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`plant_id` bigint unsigned NOT NULL,
	`kind` enum('PRODUCTION','PULLING','DELIVERY','RECEIVING','INSPECTION','STOCK_TAKE') NOT NULL,
	`process_type` enum('CASTING','MACHINING','ASSEMBLING','INJECTION'),
	`line_id` bigint unsigned,
	`part_id` bigint unsigned,
	`machine_id` bigint unsigned,
	`production_plan_id` bigint unsigned,
	`raw_code` varchar(255) NOT NULL,
	`serial_number` varchar(64),
	`qty` int NOT NULL DEFAULT 1,
	`user_id` bigint unsigned,
	`device_id` bigint unsigned,
	`scanned_at` timestamp NOT NULL,
	`dedupe_key` varchar(128) NOT NULL,
	`meta` json,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `scan_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `scan_events_dedupe_unique` UNIQUE(`dedupe_key`)
);
--> statement-breakpoint
CREATE TABLE `locations` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`plant_id` bigint unsigned NOT NULL,
	`code` varchar(32) NOT NULL,
	`name` varchar(128) NOT NULL,
	`kind` enum('WIP','FINISH_GOOD','CHUTE','NG','TRANSIT') NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `locations_id` PRIMARY KEY(`id`),
	CONSTRAINT `locations_plant_code_unique` UNIQUE(`plant_id`,`code`)
);
--> statement-breakpoint
CREATE TABLE `mutations` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`plant_id` bigint unsigned NOT NULL,
	`part_id` bigint unsigned NOT NULL,
	`location_id` bigint unsigned,
	`line_id` bigint unsigned,
	`type` enum('PRODUCTION_IN','DELIVERY_OUT','NG_OUT','ADJUSTMENT','STOCK_TAKE','TRANSFER_IN','TRANSFER_OUT','RECEIVING_IN') NOT NULL,
	`qty` int NOT NULL,
	`source_table` varchar(64),
	`source_id` bigint unsigned,
	`npk` varchar(32),
	`user_id` bigint unsigned,
	`occurred_at` timestamp NOT NULL,
	`note` varchar(255),
	`meta` json,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `mutations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `stock_balances` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`part_id` bigint unsigned NOT NULL,
	`location_id` bigint unsigned,
	`balance_date` date NOT NULL,
	`opening_qty` int NOT NULL DEFAULT 0,
	`in_qty` int NOT NULL DEFAULT 0,
	`out_qty` int NOT NULL DEFAULT 0,
	`closing_qty` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `stock_balances_id` PRIMARY KEY(`id`),
	CONSTRAINT `stock_balances_unique` UNIQUE(`part_id`,`location_id`,`balance_date`)
);
--> statement-breakpoint
CREATE TABLE `inspection_details` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`inspection_id` bigint unsigned NOT NULL,
	`ng_master_id` bigint unsigned NOT NULL,
	`qty` int NOT NULL DEFAULT 0,
	`meta` json,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `inspection_details_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ng_masters` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`plant_id` bigint unsigned NOT NULL,
	`code` varchar(32) NOT NULL,
	`name` varchar(128) NOT NULL,
	`process_type` enum('CASTING','MACHINING','ASSEMBLING','INJECTION'),
	`category` varchar(64),
	`sort_order` int NOT NULL DEFAULT 0,
	`is_active` enum('0','1') NOT NULL DEFAULT '1',
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ng_masters_id` PRIMARY KEY(`id`),
	CONSTRAINT `ng_masters_plant_code_unique` UNIQUE(`plant_id`,`code`)
);
--> statement-breakpoint
CREATE TABLE `quality_inspections` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`plant_id` bigint unsigned NOT NULL,
	`part_id` bigint unsigned NOT NULL,
	`line_id` bigint unsigned,
	`machine_id` bigint unsigned,
	`process_type` enum('CASTING','MACHINING','ASSEMBLING','INJECTION') NOT NULL,
	`inspected_at` timestamp NOT NULL,
	`shift` enum('1','2','3'),
	`checked_qty` int NOT NULL DEFAULT 0,
	`ok_qty` int NOT NULL DEFAULT 0,
	`ng_qty` int NOT NULL DEFAULT 0,
	`inspector_id` bigint unsigned,
	`note` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `quality_inspections_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `deliveries` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`plant_id` bigint unsigned NOT NULL,
	`customer_id` bigint unsigned NOT NULL,
	`document_number` varchar(64) NOT NULL,
	`manifest_number` varchar(64),
	`delivery_date` date NOT NULL,
	`cycle` int NOT NULL DEFAULT 1,
	`dock` varchar(32),
	`plan_time` time,
	`departed_at` timestamp,
	`arrived_at` timestamp,
	`status` enum('DRAFT','LOADING','LOADED','SHIPPED','RECEIVED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
	`truck_number` varchar(32),
	`driver_name` varchar(128),
	`created_by_id` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `deliveries_id` PRIMARY KEY(`id`),
	CONSTRAINT `deliveries_plant_document_unique` UNIQUE(`plant_id`,`document_number`)
);
--> statement-breakpoint
CREATE TABLE `delivery_lines` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`delivery_id` bigint unsigned NOT NULL,
	`part_id` bigint unsigned NOT NULL,
	`plan_qty` int NOT NULL DEFAULT 0,
	`actual_qty` int NOT NULL DEFAULT 0,
	`kanban_count` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `delivery_lines_id` PRIMARY KEY(`id`),
	CONSTRAINT `delivery_lines_unique` UNIQUE(`delivery_id`,`part_id`)
);
--> statement-breakpoint
CREATE TABLE `machine_events` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`plant_id` bigint unsigned NOT NULL,
	`machine_id` bigint unsigned,
	`type` enum('SHOT','CYCLE_END','ALARM','DOWNTIME_START','DOWNTIME_END','STATUS_CHANGE','DANDORI_START','DANDORI_END') NOT NULL,
	`source` enum('MQTT','J922_SYNC','MANUAL') NOT NULL,
	`status` varchar(64),
	`shot_count` int,
	`occurred_at` timestamp NOT NULL,
	`dedupe_key` varchar(128),
	`payload` json,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `machine_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `devices` ADD CONSTRAINT `devices_plant_id_plants_id_fk` FOREIGN KEY (`plant_id`) REFERENCES `plants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_role_id_roles_id_fk` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_plant_id_plants_id_fk` FOREIGN KEY (`plant_id`) REFERENCES `plants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_parts` ADD CONSTRAINT `customer_parts_part_id_parts_id_fk` FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_parts` ADD CONSTRAINT `customer_parts_customer_id_customers_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lines` ADD CONSTRAINT `lines_plant_id_plants_id_fk` FOREIGN KEY (`plant_id`) REFERENCES `plants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `machines` ADD CONSTRAINT `machines_plant_id_plants_id_fk` FOREIGN KEY (`plant_id`) REFERENCES `plants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `machines` ADD CONSTRAINT `machines_line_id_lines_id_fk` FOREIGN KEY (`line_id`) REFERENCES `lines`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `parts` ADD CONSTRAINT `parts_plant_id_plants_id_fk` FOREIGN KEY (`plant_id`) REFERENCES `plants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `parts` ADD CONSTRAINT `parts_line_id_lines_id_fk` FOREIGN KEY (`line_id`) REFERENCES `lines`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tooling_parts` ADD CONSTRAINT `tooling_parts_tooling_id_toolings_id_fk` FOREIGN KEY (`tooling_id`) REFERENCES `toolings`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tooling_parts` ADD CONSTRAINT `tooling_parts_part_id_parts_id_fk` FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `toolings` ADD CONSTRAINT `toolings_plant_id_plants_id_fk` FOREIGN KEY (`plant_id`) REFERENCES `plants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `kanban_events` ADD CONSTRAINT `kanban_events_kanban_id_kanbans_id_fk` FOREIGN KEY (`kanban_id`) REFERENCES `kanbans`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `kanban_events` ADD CONSTRAINT `kanban_events_line_id_lines_id_fk` FOREIGN KEY (`line_id`) REFERENCES `lines`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `kanban_events` ADD CONSTRAINT `kanban_events_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `kanban_events` ADD CONSTRAINT `kanban_events_device_id_devices_id_fk` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `kanbans` ADD CONSTRAINT `kanbans_plant_id_plants_id_fk` FOREIGN KEY (`plant_id`) REFERENCES `plants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `kanbans` ADD CONSTRAINT `kanbans_part_id_parts_id_fk` FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `kanbans` ADD CONSTRAINT `kanbans_customer_id_customers_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `production_plans` ADD CONSTRAINT `production_plans_plant_id_plants_id_fk` FOREIGN KEY (`plant_id`) REFERENCES `plants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `production_plans` ADD CONSTRAINT `production_plans_line_id_lines_id_fk` FOREIGN KEY (`line_id`) REFERENCES `lines`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `production_plans` ADD CONSTRAINT `production_plans_part_id_parts_id_fk` FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `production_plans` ADD CONSTRAINT `production_plans_customer_id_customers_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scan_events` ADD CONSTRAINT `scan_events_plant_id_plants_id_fk` FOREIGN KEY (`plant_id`) REFERENCES `plants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scan_events` ADD CONSTRAINT `scan_events_line_id_lines_id_fk` FOREIGN KEY (`line_id`) REFERENCES `lines`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scan_events` ADD CONSTRAINT `scan_events_part_id_parts_id_fk` FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scan_events` ADD CONSTRAINT `scan_events_machine_id_machines_id_fk` FOREIGN KEY (`machine_id`) REFERENCES `machines`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scan_events` ADD CONSTRAINT `scan_events_production_plan_id_production_plans_id_fk` FOREIGN KEY (`production_plan_id`) REFERENCES `production_plans`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scan_events` ADD CONSTRAINT `scan_events_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scan_events` ADD CONSTRAINT `scan_events_device_id_devices_id_fk` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `locations` ADD CONSTRAINT `locations_plant_id_plants_id_fk` FOREIGN KEY (`plant_id`) REFERENCES `plants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `mutations` ADD CONSTRAINT `mutations_plant_id_plants_id_fk` FOREIGN KEY (`plant_id`) REFERENCES `plants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `mutations` ADD CONSTRAINT `mutations_part_id_parts_id_fk` FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `mutations` ADD CONSTRAINT `mutations_location_id_locations_id_fk` FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `mutations` ADD CONSTRAINT `mutations_line_id_lines_id_fk` FOREIGN KEY (`line_id`) REFERENCES `lines`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `mutations` ADD CONSTRAINT `mutations_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_balances` ADD CONSTRAINT `stock_balances_part_id_parts_id_fk` FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_balances` ADD CONSTRAINT `stock_balances_location_id_locations_id_fk` FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inspection_details` ADD CONSTRAINT `inspection_details_inspection_id_quality_inspections_id_fk` FOREIGN KEY (`inspection_id`) REFERENCES `quality_inspections`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inspection_details` ADD CONSTRAINT `inspection_details_ng_master_id_ng_masters_id_fk` FOREIGN KEY (`ng_master_id`) REFERENCES `ng_masters`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ng_masters` ADD CONSTRAINT `ng_masters_plant_id_plants_id_fk` FOREIGN KEY (`plant_id`) REFERENCES `plants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `quality_inspections` ADD CONSTRAINT `quality_inspections_plant_id_plants_id_fk` FOREIGN KEY (`plant_id`) REFERENCES `plants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `quality_inspections` ADD CONSTRAINT `quality_inspections_part_id_parts_id_fk` FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `quality_inspections` ADD CONSTRAINT `quality_inspections_line_id_lines_id_fk` FOREIGN KEY (`line_id`) REFERENCES `lines`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `quality_inspections` ADD CONSTRAINT `quality_inspections_machine_id_machines_id_fk` FOREIGN KEY (`machine_id`) REFERENCES `machines`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `quality_inspections` ADD CONSTRAINT `quality_inspections_inspector_id_users_id_fk` FOREIGN KEY (`inspector_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `deliveries` ADD CONSTRAINT `deliveries_plant_id_plants_id_fk` FOREIGN KEY (`plant_id`) REFERENCES `plants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `deliveries` ADD CONSTRAINT `deliveries_customer_id_customers_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `deliveries` ADD CONSTRAINT `deliveries_created_by_id_users_id_fk` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `delivery_lines` ADD CONSTRAINT `delivery_lines_delivery_id_deliveries_id_fk` FOREIGN KEY (`delivery_id`) REFERENCES `deliveries`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `delivery_lines` ADD CONSTRAINT `delivery_lines_part_id_parts_id_fk` FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `machine_events` ADD CONSTRAINT `machine_events_plant_id_plants_id_fk` FOREIGN KEY (`plant_id`) REFERENCES `plants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `machine_events` ADD CONSTRAINT `machine_events_machine_id_machines_id_fk` FOREIGN KEY (`machine_id`) REFERENCES `machines`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `devices_plant_idx` ON `devices` (`plant_id`);--> statement-breakpoint
CREATE INDEX `users_plant_idx` ON `users` (`plant_id`);--> statement-breakpoint
CREATE INDEX `customer_parts_part_idx` ON `customer_parts` (`part_id`);--> statement-breakpoint
CREATE INDEX `lines_process_idx` ON `lines` (`process_type`);--> statement-breakpoint
CREATE INDEX `machines_external_ref_idx` ON `machines` (`external_ref`);--> statement-breakpoint
CREATE INDEX `parts_back_number_idx` ON `parts` (`back_number`);--> statement-breakpoint
CREATE INDEX `parts_line_idx` ON `parts` (`line_id`);--> statement-breakpoint
CREATE INDEX `kanban_events_kanban_idx` ON `kanban_events` (`kanban_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `kanban_events_type_time_idx` ON `kanban_events` (`type`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `kanbans_part_status_idx` ON `kanbans` (`part_id`,`status`);--> statement-breakpoint
CREATE INDEX `kanbans_status_created_idx` ON `kanbans` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `production_plans_date_line_idx` ON `production_plans` (`plan_date`,`line_id`);--> statement-breakpoint
CREATE INDEX `production_plans_part_date_idx` ON `production_plans` (`part_id`,`plan_date`);--> statement-breakpoint
CREATE INDEX `scan_events_time_idx` ON `scan_events` (`scanned_at`);--> statement-breakpoint
CREATE INDEX `scan_events_line_kind_time_idx` ON `scan_events` (`line_id`,`kind`,`scanned_at`);--> statement-breakpoint
CREATE INDEX `scan_events_part_time_idx` ON `scan_events` (`part_id`,`scanned_at`);--> statement-breakpoint
CREATE INDEX `scan_events_serial_idx` ON `scan_events` (`serial_number`);--> statement-breakpoint
CREATE INDEX `mutations_part_time_idx` ON `mutations` (`part_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `mutations_type_time_idx` ON `mutations` (`type`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `mutations_source_idx` ON `mutations` (`source_table`,`source_id`);--> statement-breakpoint
CREATE INDEX `stock_balances_date_idx` ON `stock_balances` (`balance_date`);--> statement-breakpoint
CREATE INDEX `inspection_details_inspection_idx` ON `inspection_details` (`inspection_id`);--> statement-breakpoint
CREATE INDEX `quality_inspections_part_time_idx` ON `quality_inspections` (`part_id`,`inspected_at`);--> statement-breakpoint
CREATE INDEX `quality_inspections_line_time_idx` ON `quality_inspections` (`line_id`,`inspected_at`);--> statement-breakpoint
CREATE INDEX `deliveries_date_customer_idx` ON `deliveries` (`delivery_date`,`customer_id`);--> statement-breakpoint
CREATE INDEX `deliveries_status_idx` ON `deliveries` (`status`);--> statement-breakpoint
CREATE INDEX `delivery_lines_part_idx` ON `delivery_lines` (`part_id`);--> statement-breakpoint
CREATE INDEX `machine_events_machine_time_idx` ON `machine_events` (`machine_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `machine_events_type_time_idx` ON `machine_events` (`type`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `machine_events_dedupe_idx` ON `machine_events` (`dedupe_key`);