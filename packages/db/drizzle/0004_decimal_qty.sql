ALTER TABLE `mutations` MODIFY COLUMN `qty` decimal(14,4) NOT NULL;--> statement-breakpoint
ALTER TABLE `stock_balances` MODIFY COLUMN `opening_qty` decimal(14,4) NOT NULL DEFAULT '0';--> statement-breakpoint
ALTER TABLE `stock_balances` MODIFY COLUMN `in_qty` decimal(14,4) NOT NULL DEFAULT '0';--> statement-breakpoint
ALTER TABLE `stock_balances` MODIFY COLUMN `out_qty` decimal(14,4) NOT NULL DEFAULT '0';--> statement-breakpoint
ALTER TABLE `stock_balances` MODIFY COLUMN `closing_qty` decimal(14,4) NOT NULL DEFAULT '0';