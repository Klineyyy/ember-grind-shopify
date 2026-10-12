CREATE TABLE `clearance_discount_items` (
	`discount_id` bigint unsigned NOT NULL,
	`product_id` bigint unsigned NOT NULL,
	`available_at_start` int NOT NULL,
	`excess_at_start` int NOT NULL,
	CONSTRAINT `clearance_discount_items_discount_id_product_id_pk` PRIMARY KEY(`discount_id`,`product_id`)
);
--> statement-breakpoint
CREATE TABLE `clearance_discounts` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`shop_id` bigint unsigned NOT NULL,
	`shopify_discount_id` varchar(64) NOT NULL,
	`code` varchar(64) NOT NULL,
	`percent_off` int NOT NULL,
	`status` enum('active','ended') NOT NULL DEFAULT 'active',
	`starts_at` timestamp NOT NULL,
	`ends_at` timestamp,
	`ended_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `clearance_discounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `clearance_shop_code_uq` UNIQUE(`shop_id`,`code`)
);
--> statement-breakpoint
ALTER TABLE `activity_log` MODIFY COLUMN `entity_type` enum('plan','supplier','product','alert','sync','settings','discount') NOT NULL;--> statement-breakpoint
ALTER TABLE `clearance_discount_items` ADD CONSTRAINT `clearance_discount_items_discount_id_clearance_discounts_id_fk` FOREIGN KEY (`discount_id`) REFERENCES `clearance_discounts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `clearance_discount_items` ADD CONSTRAINT `clearance_discount_items_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `clearance_discounts` ADD CONSTRAINT `clearance_discounts_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `clearance_shop_status_idx` ON `clearance_discounts` (`shop_id`,`status`);