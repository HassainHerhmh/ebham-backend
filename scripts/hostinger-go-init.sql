-- جو: إنشاء الجداول + فرع + مستخدم لوحة التحكم
-- استورد الملف من Hostinger: phpMyAdmin → Import
-- collation متوافق مع MariaDB (مو utf8mb4_0900_ai_ci)

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';

-- =========================
-- أساسيات
-- =========================

CREATE TABLE IF NOT EXISTS `branches` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL,
  `address` VARCHAR(500) NULL,
  `phone` VARCHAR(50) NULL,
  `is_admin` TINYINT(1) NOT NULL DEFAULT 0,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `boundary_points` LONGTEXT NULL,
  `created_at` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `users` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL,
  `email` VARCHAR(255) NULL,
  `phone` VARCHAR(50) NULL,
  `password` VARCHAR(255) NOT NULL,
  `role` VARCHAR(50) NULL DEFAULT 'admin',
  `permissions` LONGTEXT NULL,
  `status` VARCHAR(30) NULL DEFAULT 'active',
  `branch_id` INT NULL,
  `agent_id` INT NULL,
  `image_url` VARCHAR(500) NULL,
  `is_admin` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_users_email` (`email`),
  KEY `idx_users_branch` (`branch_id`),
  KEY `idx_users_agent` (`agent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `types` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL,
  `image_url` VARCHAR(500) NULL,
  `image_outline_url` VARCHAR(500) NULL,
  `image_color_url` VARCHAR(500) NULL,
  `sort_order` INT NULL DEFAULT 0,
  `created_at` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `agents` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL,
  `email` VARCHAR(255) NULL,
  `phone` VARCHAR(50) NULL,
  `address` VARCHAR(500) NULL,
  `password` VARCHAR(255) NULL,
  `branch_id` INT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `image_url` VARCHAR(500) NULL,
  `created_at` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_agents_branch` (`branch_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `agent_groups` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL,
  `code` INT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `restaurants` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL,
  `name_en` VARCHAR(255) NULL,
  `type_id` INT NULL,
  `display_type` VARCHAR(50) NULL DEFAULT 'product',
  `address` VARCHAR(500) NULL,
  `address_en` VARCHAR(500) NULL,
  `phone` VARCHAR(50) NULL,
  `image_url` VARCHAR(500) NULL,
  `map_url` VARCHAR(1000) NULL,
  `latitude` DECIMAL(10,7) NULL,
  `longitude` DECIMAL(10,7) NULL,
  `delivery_time` VARCHAR(50) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `sort_order` INT NULL DEFAULT 0,
  `branch_id` INT NULL,
  `agent_id` INT NULL,
  `rating` DECIMAL(3,1) NULL DEFAULT 4.5,
  `created_at` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_rest_branch` (`branch_id`),
  KEY `idx_rest_type` (`type_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `restaurant_schedule` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `restaurant_id` INT NOT NULL,
  `day` VARCHAR(50) NOT NULL,
  `start_time` TIME NULL,
  `end_time` TIME NULL,
  `closed` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_rs_rest` (`restaurant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `restaurant_categories` (
  `restaurant_id` INT NOT NULL,
  `category_id` INT NOT NULL,
  PRIMARY KEY (`restaurant_id`,`category_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `categories` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL,
  `image_url` VARCHAR(500) NULL,
  `created_at` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `units` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `products` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL,
  `price` DECIMAL(12,2) NULL,
  `image_url` VARCHAR(500) NULL,
  `notes` TEXT NULL,
  `unit_id` INT NULL,
  `restaurant_id` INT NULL,
  `is_available` TINYINT(1) NOT NULL DEFAULT 1,
  `is_parent` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_prod_rest` (`restaurant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `product_categories` (
  `product_id` INT NOT NULL,
  `category_id` INT NOT NULL,
  PRIMARY KEY (`product_id`,`category_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `product_children` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `parent_id` INT NOT NULL,
  `child_id` INT NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_pc_parent` (`parent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ads` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NULL,
  `description` TEXT NULL,
  `image_url` VARCHAR(500) NULL,
  `type` VARCHAR(50) NULL,
  `restaurant_id` INT NULL,
  `discount_percent` DECIMAL(5,2) NULL,
  `created_at` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ad_products` (
  `ad_id` INT NOT NULL,
  `product_id` INT NOT NULL,
  PRIMARY KEY (`ad_id`,`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `customers` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NULL,
  `phone` VARCHAR(50) NULL,
  `phone_alt` VARCHAR(50) NULL,
  `email` VARCHAR(255) NULL,
  `password` VARCHAR(255) NULL,
  `branch_id` INT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `is_online` TINYINT(1) NOT NULL DEFAULT 0,
  `is_profile_complete` TINYINT(1) NOT NULL DEFAULT 0,
  `last_login` DATETIME NULL,
  `last_active_at` DATETIME NULL,
  `created_at` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_cust_phone` (`phone`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `customer_addresses` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `customer_id` INT NULL,
  `branch_id` INT NULL,
  `address` VARCHAR(500) NULL,
  `neighborhood_name` VARCHAR(255) NULL,
  `district` INT NULL,
  `latitude` DECIMAL(10,7) NULL,
  `longitude` DECIMAL(10,7) NULL,
  `created_at` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_addr_cust` (`customer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cities` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL,
  `delivery_fee` DECIMAL(12,2) NULL DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `neighborhoods` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `branch_id` INT NULL,
  `city_id` INT NULL,
  `name` VARCHAR(255) NOT NULL,
  `delivery_fee` DECIMAL(12,2) NULL DEFAULT 0,
  `extra_store_fee` DECIMAL(12,2) NULL DEFAULT 0,
  `boundary_points` LONGTEXT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_neigh_branch` (`branch_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `captains` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL,
  `email` VARCHAR(255) NULL,
  `phone` VARCHAR(50) NULL,
  `password` VARCHAR(255) NULL,
  `vehicle_type` VARCHAR(100) NULL,
  `vehicle_number` VARCHAR(100) NULL,
  `status` VARCHAR(50) NULL DEFAULT 'available',
  `branch_id` INT NULL,
  `account_id` INT NULL,
  `image_url` VARCHAR(500) NULL,
  `fcm_token` VARCHAR(500) NULL,
  `created_at` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `captain_groups` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL,
  `code` INT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `captain_ratings` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `captain_id` INT NULL,
  `order_id` INT NULL,
  `rating` DECIMAL(3,1) NULL,
  `created_at` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `captain_sessions` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `captain_id` INT NULL,
  `token` VARCHAR(500) NULL,
  `created_at` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `orders` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `order_number` BIGINT NULL,
  `customer_id` INT NULL,
  `address_id` INT NULL,
  `restaurant_id` INT NULL,
  `created_by` INT NULL,
  `updated_by` INT NULL,
  `note` TEXT NULL,
  `gps_link` VARCHAR(500) NULL,
  `stores_count` INT NULL DEFAULT 1,
  `branch_id` INT NULL,
  `user_id` INT NULL,
  `delivery_fee` DECIMAL(12,2) NULL DEFAULT 0,
  `extra_store_fee` DECIMAL(12,2) NULL DEFAULT 0,
  `discount_amount` DECIMAL(12,2) NULL DEFAULT 0,
  `coupon_code` VARCHAR(100) NULL,
  `payment_method` VARCHAR(50) NULL,
  `bank_id` INT NULL,
  `scheduled_at` DATETIME NULL,
  `status` VARCHAR(50) NULL DEFAULT 'pending',
  `captain_id` INT NULL,
  `total_amount` DECIMAL(12,2) NULL DEFAULT 0,
  `cancel_reason` VARCHAR(500) NULL,
  `created_at` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_orders_branch` (`branch_id`),
  KEY `idx_orders_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `order_items` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `order_id` INT NOT NULL,
  `product_id` INT NULL,
  `restaurant_id` INT NULL,
  `name` VARCHAR(255) NULL,
  `price` DECIMAL(12,2) NULL,
  `quantity` INT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  KEY `idx_oi_order` (`order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `order_number_sequence` (
  `id` TINYINT NOT NULL PRIMARY KEY,
  `next_number` BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `wassel_order_types` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL,
  `created_at` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `wassel_transport_methods` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL,
  `base_fee` DECIMAL(12,2) NULL DEFAULT 0,
  `price_per_km` DECIMAL(12,2) NULL DEFAULT 0,
  `included_km` DECIMAL(12,2) NULL DEFAULT 0,
  `created_at` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `wassel_orders` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `order_number` BIGINT NULL,
  `customer_id` INT NULL,
  `order_type` INT NULL,
  `transport_method_id` INT NULL,
  `from_address_id` INT NULL,
  `to_address_id` INT NULL,
  `pickup_location` VARCHAR(500) NULL,
  `dropoff_location` VARCHAR(500) NULL,
  `pickup_lat` DECIMAL(10,7) NULL,
  `pickup_lng` DECIMAL(10,7) NULL,
  `dropoff_lat` DECIMAL(10,7) NULL,
  `dropoff_lng` DECIMAL(10,7) NULL,
  `notes` TEXT NULL,
  `delivery_fee` DECIMAL(12,2) NULL DEFAULT 0,
  `extra_fee` DECIMAL(12,2) NULL DEFAULT 0,
  `distance_km` DECIMAL(10,2) NULL,
  `status` VARCHAR(50) NULL DEFAULT 'pending',
  `captain_id` INT NULL,
  `user_id` INT NULL,
  `updated_by` INT NULL,
  `branch_id` INT NULL,
  `payment_method` VARCHAR(50) NULL,
  `created_at` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `wassel_order_items` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `order_id` INT NOT NULL,
  `name` VARCHAR(255) NULL,
  `qty` INT NULL DEFAULT 1,
  `price` DECIMAL(12,2) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `branch_work_times` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `branch_id` INT NOT NULL,
  `day_of_week` INT NOT NULL,
  `open_time` TIME NULL,
  `close_time` TIME NULL,
  `is_closed` TINYINT(1) NOT NULL DEFAULT 0,
  `notes` VARCHAR(255) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_branch_day` (`branch_id`,`day_of_week`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `branch_delivery_settings` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `branch_id` INT NOT NULL,
  `base_fee` DECIMAL(12,2) NULL DEFAULT 0,
  `extra_store_fee` DECIMAL(12,2) NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_bds_branch` (`branch_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `otp_codes` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `phone` VARCHAR(50) NOT NULL,
  `code_hash` VARCHAR(255) NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `created_at` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_otp_phone` (`phone`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `otp_security` (
  `phone` VARCHAR(20) NOT NULL,
  `failed_attempts` INT NOT NULL DEFAULT 0,
  `ban_strike` INT NOT NULL DEFAULT 0,
  `ban_until` TIMESTAMP NULL,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`phone`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `sms_gateway_heartbeat` (
  `id` TINYINT NOT NULL DEFAULT 1,
  `last_seen_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `sms_queue` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `recipient_phone` VARCHAR(20) NOT NULL,
  `message` TEXT NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
  `sms_type` VARCHAR(32) DEFAULT 'otp',
  `error_message` VARCHAR(500) NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `sent_at` TIMESTAMP NULL,
  PRIMARY KEY (`id`),
  KEY `idx_sms_queue_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `notifications` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `title` VARCHAR(255) NULL,
  `message` TEXT NULL,
  `user_id` INT NULL,
  `captain_id` INT NULL,
  `customer_id` INT NULL,
  `order_id` INT NULL,
  `is_read` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `coupon_codes` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(100) NOT NULL,
  `discount_percent` DECIMAL(5,2) NULL DEFAULT 0,
  `discount_amount` DECIMAL(12,2) NULL DEFAULT 0,
  `apply_on` VARCHAR(50) NULL DEFAULT 'order',
  `status` VARCHAR(30) NULL DEFAULT 'active',
  `start_date` DATETIME NULL,
  `end_date` DATETIME NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `coupon_users` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `coupon_id` INT NULL,
  `user_id` INT NULL,
  `customer_id` INT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `payment_methods` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `company` VARCHAR(255) NULL,
  `account_number` VARCHAR(100) NULL,
  `owner_name` VARCHAR(255) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `branch_payment_accounts` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `branch_id` INT NULL,
  `payment_method_id` INT NULL,
  `account_id` INT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `currencies` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name_ar` VARCHAR(255) NOT NULL,
  `code` VARCHAR(20) NOT NULL,
  `symbol` VARCHAR(20) NULL,
  `exchange_rate` DECIMAL(18,6) NOT NULL DEFAULT 1,
  `min_rate` DECIMAL(18,6) NULL,
  `max_rate` DECIMAL(18,6) NULL,
  `is_local` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `accounts` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name_ar` VARCHAR(255) NOT NULL,
  `name_en` VARCHAR(255) NULL,
  `parent_id` INT NULL,
  `account_group_id` INT NULL,
  `account_level` VARCHAR(50) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `account_groups` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name_ar` VARCHAR(255) NOT NULL,
  `name_en` VARCHAR(255) NULL,
  `code` VARCHAR(50) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `account_ceilings` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `scope` VARCHAR(20) NULL,
  `account_id` INT NULL,
  `account_group_id` INT NULL,
  `currency_id` INT NULL,
  `ceiling_amount` DECIMAL(18,2) NULL,
  `account_nature` VARCHAR(20) NULL,
  `exceed_action` VARCHAR(20) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `journal_entries` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `journal_type_id` INT NULL,
  `reference_type` VARCHAR(50) NULL,
  `reference_id` INT NULL,
  `journal_date` DATE NULL,
  `currency_id` INT NULL,
  `account_id` INT NULL,
  `debit` DECIMAL(18,2) NULL DEFAULT 0,
  `credit` DECIMAL(18,2) NULL DEFAULT 0,
  `notes` TEXT NULL,
  `cost_center_id` INT NULL,
  `created_at` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `journal_types` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name_ar` VARCHAR(255) NOT NULL,
  `name_en` VARCHAR(255) NULL,
  `sort_order` INT NULL DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `payment_types` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name_ar` VARCHAR(255) NOT NULL,
  `name_en` VARCHAR(255) NULL,
  `sort_order` INT NULL DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `receipt_types` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name_ar` VARCHAR(255) NOT NULL,
  `name_en` VARCHAR(255) NULL,
  `sort_order` INT NULL DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `payment_vouchers` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `receipt_vouchers` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cashbox_groups` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name_ar` VARCHAR(255) NOT NULL,
  `name_en` VARCHAR(255) NULL,
  `code` INT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cash_boxes` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name_ar` VARCHAR(255) NOT NULL,
  `name_en` VARCHAR(255) NULL,
  `cash_box_group_id` INT NULL,
  `parent_account_id` INT NULL,
  `account_id` INT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `banks` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bank_groups` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name_ar` VARCHAR(255) NOT NULL,
  `name_en` VARCHAR(255) NULL,
  `code` VARCHAR(50) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `commissions` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `account_id` INT NULL,
  `account_type` VARCHAR(50) NULL,
  `percent` DECIMAL(8,2) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `customer_guarantees` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `customer_id` INT NULL,
  `balance` DECIMAL(18,2) NULL DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `customer_guarantee_moves` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `guarantee_id` INT NULL,
  `currency_id` INT NULL,
  `rate` DECIMAL(18,6) NULL,
  `amount` DECIMAL(18,2) NULL,
  `amount_base` DECIMAL(18,2) NULL,
  `created_at` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `settings` (
  `id` INT NOT NULL,
  `commission_income_account` INT NULL,
  `courier_commission_account` INT NULL,
  `transfer_guarantee_account` INT NULL,
  `currency_exchange_account` INT NULL,
  `customer_guarantee_account` INT NULL,
  `customer_credit_account` INT NULL,
  `coupon_discount_account` INT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `support_chats` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `customer_id` INT NULL,
  `status` VARCHAR(50) NULL DEFAULT 'open',
  `created_at` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `support_chat_messages` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `chat_id` INT NULL,
  `sender_type` VARCHAR(50) NULL,
  `message` TEXT NULL,
  `created_at` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user_attendance_sessions` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `branch_id` INT NULL,
  `login_time` DATETIME NOT NULL,
  `logout_time` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `loyalty_settings` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `points_per_amount` DECIMAL(12,2) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `loyalty_points` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `customer_id` INT NULL,
  `points` INT NULL DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `loyalty_logs` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `customer_id` INT NULL,
  `points` INT NULL,
  `created_at` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `campaigns` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NULL,
  `created_at` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================
-- بيانات البداية
-- =========================

INSERT INTO `branches` (`id`, `name`, `address`, `phone`, `is_admin`, `is_active`)
VALUES (1, 'عتق', '', '', 1, 1)
ON DUPLICATE KEY UPDATE `is_admin` = 1, `is_active` = 1;

INSERT INTO `users` (`id`, `name`, `email`, `phone`, `password`, `role`, `permissions`, `status`, `branch_id`, `is_admin`)
VALUES (
  1,
  'مدير جو',
  'admin',
  '770000000',
  '$2b$10$qiYtYRFF2iHh0smoXckADeXmo6/lorAl17jJz5Z7cJUA2c35H5AnC',
  'admin',
  '{}',
  'active',
  1,
  1
)
ON DUPLICATE KEY UPDATE
  `password` = VALUES(`password`),
  `role` = 'admin',
  `status` = 'active',
  `branch_id` = 1,
  `is_admin` = 1;

INSERT INTO `currencies` (`id`, `name_ar`, `code`, `symbol`, `exchange_rate`, `is_local`)
VALUES (1, 'ريال يمني', 'YER', 'ر.ي', 1, 1)
ON DUPLICATE KEY UPDATE `is_local` = 1;

INSERT INTO `settings` (`id`)
VALUES (1)
ON DUPLICATE KEY UPDATE `id` = 1;

INSERT INTO `order_number_sequence` (`id`, `next_number`)
VALUES (1, 1)
ON DUPLICATE KEY UPDATE `next_number` = `next_number`;

INSERT INTO `branch_work_times` (`branch_id`, `day_of_week`, `open_time`, `close_time`, `is_closed`)
VALUES
  (1, 0, '00:00:00', '23:59:00', 0),
  (1, 1, '00:00:00', '23:59:00', 0),
  (1, 2, '00:00:00', '23:59:00', 0),
  (1, 3, '00:00:00', '23:59:00', 0),
  (1, 4, '00:00:00', '23:59:00', 0),
  (1, 5, '00:00:00', '23:59:00', 0),
  (1, 6, '00:00:00', '23:59:00', 0)
ON DUPLICATE KEY UPDATE `is_closed` = 0;

INSERT INTO `wassel_order_types` (`id`, `name`)
VALUES (1, 'توصيل طرد')
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

INSERT INTO `wassel_transport_methods` (`id`, `name`, `base_fee`, `price_per_km`, `included_km`)
VALUES (1, 'دراجة', 500, 100, 3)
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

SET FOREIGN_KEY_CHECKS = 1;
