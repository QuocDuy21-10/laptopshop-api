-- CreateTable
CREATE TABLE `home_banners` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `placement` ENUM('HERO', 'SIDE') NOT NULL,
  `eyebrow` VARCHAR(60) NULL,
  `title` VARCHAR(80) NOT NULL,
  `highlight` VARCHAR(80) NULL,
  `description` VARCHAR(200) NULL,
  `ctaText` VARCHAR(30) NULL,
  `linkUrl` VARCHAR(255) NULL,
  `secondaryCtaText` VARCHAR(30) NULL,
  `secondaryLinkUrl` VARCHAR(255) NULL,
  `badges` JSON NOT NULL,
  `imagePath` VARCHAR(255) NULL,
  `imageAlt` VARCHAR(120) NULL,
  `position` INTEGER NOT NULL DEFAULT 0,
  `isActive` BOOLEAN NOT NULL DEFAULT false,
  `startsAt` DATETIME(3) NULL,
  `endsAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `home_banners_placement_isActive_position_idx`(`placement`, `isActive`, `position`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
