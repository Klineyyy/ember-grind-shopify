CREATE TABLE `activity_log` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`shop_id` bigint unsigned NOT NULL,
	`actor` enum('merchant','system','webhook') NOT NULL,
	`entity_type` enum('plan','supplier','product','alert','sync','settings') NOT NULL,
	`entity_id` bigint unsigned,
	`action` varchar(64) NOT NULL,
	`summary` varchar(500) NOT NULL,
	`changes` json,
	`created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `activity_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `alerts` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`shop_id` bigint unsigned NOT NULL,
	`product_id` bigint unsigned NOT NULL,
	`type` enum('stockout_risk','out_of_stock','velocity_spike','overstock') NOT NULL,
	`severity` enum('critical','warning','info') NOT NULL,
	`status` enum('open','acknowledged','resolved') NOT NULL DEFAULT 'open',
	`message` varchar(500) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`resolved_at` timestamp,
	CONSTRAINT `alerts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `inventory_snapshots` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`product_id` bigint unsigned NOT NULL,
	`available` int NOT NULL,
	`source` enum('sync','webhook','receipt') NOT NULL,
	`captured_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `inventory_snapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`shop_id` bigint unsigned NOT NULL,
	`shopify_product_id` varchar(64) NOT NULL,
	`shopify_variant_id` varchar(64) NOT NULL,
	`inventory_item_id` varchar(64),
	`title` varchar(255) NOT NULL,
	`variant_title` varchar(255),
	`sku` varchar(128),
	`image_url` text,
	`price` decimal(10,2) NOT NULL DEFAULT 0,
	`unit_cost` decimal(10,2),
	`available` int NOT NULL DEFAULT 0,
	`supplier_id` bigint unsigned,
	`lead_time_days_override` int,
	`min_order_qty` int NOT NULL DEFAULT 1,
	`is_tracked` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `products_id` PRIMARY KEY(`id`),
	CONSTRAINT `products_shop_variant_uq` UNIQUE(`shop_id`,`shopify_variant_id`)
);
--> statement-breakpoint
CREATE TABLE `restock_plan_items` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`plan_id` bigint unsigned NOT NULL,
	`product_id` bigint unsigned NOT NULL,
	`quantity` int NOT NULL,
	`unit_cost` decimal(10,2),
	`suggested_qty` int,
	CONSTRAINT `restock_plan_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `plan_items_plan_product_uq` UNIQUE(`plan_id`,`product_id`)
);
--> statement-breakpoint
CREATE TABLE `restock_plans` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`shop_id` bigint unsigned NOT NULL,
	`supplier_id` bigint unsigned,
	`reference` varchar(32) NOT NULL,
	`status` enum('draft','ordered','received','cancelled') NOT NULL DEFAULT 'draft',
	`notes` text,
	`expected_at` date,
	`ordered_at` timestamp,
	`received_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `restock_plans_id` PRIMARY KEY(`id`),
	CONSTRAINT `plans_shop_reference_uq` UNIQUE(`shop_id`,`reference`)
);
--> statement-breakpoint
CREATE TABLE `risk_scores` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`shop_id` bigint unsigned NOT NULL,
	`product_id` bigint unsigned NOT NULL,
	`score` int NOT NULL,
	`tier` enum('critical','high','watch','healthy','overstock','no_demand') NOT NULL,
	`velocity` decimal(10,3) NOT NULL,
	`days_of_cover` decimal(10,1),
	`incoming` int NOT NULL DEFAULT 0,
	`recommended_qty` int NOT NULL DEFAULT 0,
	`order_by_date` date,
	`factors` json NOT NULL,
	`computed_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `risk_scores_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sales_daily` (
	`product_id` bigint unsigned NOT NULL,
	`day` date NOT NULL,
	`units` int NOT NULL DEFAULT 0,
	`revenue` decimal(12,2) NOT NULL DEFAULT 0,
	`is_simulated` boolean NOT NULL DEFAULT false,
	CONSTRAINT `sales_daily_product_id_day_pk` PRIMARY KEY(`product_id`,`day`)
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` varchar(255) NOT NULL,
	`shop` text NOT NULL,
	`state` text NOT NULL,
	`isOnline` boolean NOT NULL DEFAULT false,
	`scope` text,
	`expires` timestamp,
	`accessToken` text NOT NULL,
	`userId` bigint,
	`firstName` text,
	`lastName` text,
	`email` text,
	`accountOwner` boolean,
	`locale` text,
	`collaborator` boolean,
	`emailVerified` boolean,
	`refreshToken` text,
	`refreshTokenExpires` timestamp,
	CONSTRAINT `session_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `shops` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`domain` varchar(255) NOT NULL,
	`name` varchar(255),
	`currency` varchar(3) NOT NULL DEFAULT 'USD',
	`default_lead_time_days` int NOT NULL DEFAULT 14,
	`safety_stock_days` int NOT NULL DEFAULT 7,
	`review_period_days` int NOT NULL DEFAULT 14,
	`overstock_days` int NOT NULL DEFAULT 120,
	`last_synced_at` timestamp,
	`installed_at` timestamp NOT NULL DEFAULT (now()),
	`uninstalled_at` timestamp,
	CONSTRAINT `shops_id` PRIMARY KEY(`id`),
	CONSTRAINT `shops_domain_unique` UNIQUE(`domain`)
);
--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`shop_id` bigint unsigned NOT NULL,
	`name` varchar(255) NOT NULL,
	`email` varchar(255),
	`lead_time_days` int NOT NULL DEFAULT 14,
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `suppliers_id` PRIMARY KEY(`id`),
	CONSTRAINT `suppliers_shop_name_uq` UNIQUE(`shop_id`,`name`)
);
--> statement-breakpoint
ALTER TABLE `activity_log` ADD CONSTRAINT `activity_log_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `alerts` ADD CONSTRAINT `alerts_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `alerts` ADD CONSTRAINT `alerts_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inventory_snapshots` ADD CONSTRAINT `inventory_snapshots_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_supplier_id_suppliers_id_fk` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `restock_plan_items` ADD CONSTRAINT `restock_plan_items_plan_id_restock_plans_id_fk` FOREIGN KEY (`plan_id`) REFERENCES `restock_plans`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `restock_plan_items` ADD CONSTRAINT `restock_plan_items_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `restock_plans` ADD CONSTRAINT `restock_plans_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `restock_plans` ADD CONSTRAINT `restock_plans_supplier_id_suppliers_id_fk` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `risk_scores` ADD CONSTRAINT `risk_scores_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `risk_scores` ADD CONSTRAINT `risk_scores_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sales_daily` ADD CONSTRAINT `sales_daily_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `suppliers` ADD CONSTRAINT `suppliers_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `activity_shop_time_idx` ON `activity_log` (`shop_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `activity_entity_idx` ON `activity_log` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `alerts_shop_status_idx` ON `alerts` (`shop_id`,`status`);--> statement-breakpoint
CREATE INDEX `alerts_product_type_idx` ON `alerts` (`product_id`,`type`,`status`);--> statement-breakpoint
CREATE INDEX `snapshots_product_time_idx` ON `inventory_snapshots` (`product_id`,`captured_at`);--> statement-breakpoint
CREATE INDEX `products_inventory_item_idx` ON `products` (`inventory_item_id`);--> statement-breakpoint
CREATE INDEX `products_supplier_idx` ON `products` (`supplier_id`);--> statement-breakpoint
CREATE INDEX `plans_shop_status_idx` ON `restock_plans` (`shop_id`,`status`);--> statement-breakpoint
CREATE INDEX `risk_product_time_idx` ON `risk_scores` (`product_id`,`computed_at`);--> statement-breakpoint
CREATE INDEX `risk_shop_time_idx` ON `risk_scores` (`shop_id`,`computed_at`);