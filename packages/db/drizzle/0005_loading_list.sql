ALTER TABLE `customers` ADD `part_number_format` enum('TMMIN','SUZUKI','MMKI','TBINA','NONE') DEFAULT 'NONE' NOT NULL;--> statement-breakpoint
ALTER TABLE `deliveries` ADD `pds_number` varchar(64);--> statement-breakpoint
ALTER TABLE `deliveries` ADD `truck_status` enum('PENDING','ARRIVED','LOADING','DEPARTED') DEFAULT 'PENDING' NOT NULL;--> statement-breakpoint
ALTER TABLE `deliveries` ADD `truck_picked_at` timestamp;--> statement-breakpoint
ALTER TABLE `deliveries` ADD `truck_picked_by_id` bigint unsigned;--> statement-breakpoint
ALTER TABLE `delivery_lines` ADD `customer_part_id` bigint unsigned;--> statement-breakpoint
ALTER TABLE `delivery_lines` ADD `qty_per_kanban` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `delivery_lines` ADD `actual_kanban` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `deliveries` ADD CONSTRAINT `deliveries_truck_picked_by_id_users_id_fk` FOREIGN KEY (`truck_picked_by_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;