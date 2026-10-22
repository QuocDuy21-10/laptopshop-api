-- AlterTable
ALTER TABLE `order_detail` ADD COLUMN `automaticPromotionId` INTEGER NULL,
    ADD COLUMN `automaticPromotionName` VARCHAR(150) NULL,
    ADD COLUMN `couponDiscountAmount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `productDiscountAmount` INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `orders` ADD COLUMN `couponCode` VARCHAR(50) NULL,
    ADD COLUMN `couponDiscountAmount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `couponEligibleSubtotal` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `couponName` VARCHAR(150) NULL,
    ADD COLUMN `couponPromotionId` INTEGER NULL,
    ADD COLUMN `productDiscountAmount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `requestHash` CHAR(64) NULL,
    ADD COLUMN `subtotalPrice` INTEGER NULL;

-- BACKFILL_START
UPDATE `orders`
SET `subtotalPrice` = `totalPrice`,
    `productDiscountAmount` = 0,
    `couponEligibleSubtotal` = 0,
    `couponDiscountAmount` = 0
WHERE `subtotalPrice` IS NULL;

UPDATE `order_detail`
SET `productDiscountAmount` = 0,
    `couponDiscountAmount` = 0
WHERE `productDiscountAmount` IS NULL
   OR `couponDiscountAmount` IS NULL;
-- BACKFILL_END

-- CreateTable
CREATE TABLE `promotions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `kind` ENUM('COUPON', 'AUTOMATIC') NOT NULL,
    `state` ENUM('DRAFT', 'ACTIVE', 'PAUSED', 'ENDED') NOT NULL DEFAULT 'DRAFT',
    `name` VARCHAR(150) NOT NULL,
    `description` VARCHAR(500) NULL,
    `discountKind` ENUM('PERCENT', 'FIXED') NOT NULL,
    `discountValue` INTEGER NOT NULL,
    `pricingVersion` INTEGER NOT NULL DEFAULT 1,
    `startsAt` DATETIME(3) NOT NULL,
    `endsAt` DATETIME(3) NOT NULL,
    `activatedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdById` INTEGER NOT NULL,
    `updatedById` INTEGER NOT NULL,

    INDEX `promotions_kind_state_startsAt_endsAt_idx`(`kind`, `state`, `startsAt`, `endsAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `coupon_policies` (
    `promotionId` INTEGER NOT NULL,
    `code` VARCHAR(50) NOT NULL,
    `scope` ENUM('ORDER', 'PRODUCT') NOT NULL,
    `minOrderValue` INTEGER NOT NULL DEFAULT 0,
    `maxDiscount` INTEGER NULL,
    `maxUses` INTEGER NULL,
    `usedCount` INTEGER NOT NULL DEFAULT 0,
    `maxUsesPerUser` INTEGER NOT NULL DEFAULT 1,
    `isPublic` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `coupon_policies_code_key`(`code`),
    INDEX `coupon_policies_isPublic_idx`(`isPublic`),
    PRIMARY KEY (`promotionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `automatic_promotion_policies` (
    `promotionId` INTEGER NOT NULL,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `stackableWithCoupon` BOOLEAN NOT NULL DEFAULT false,

    INDEX `automatic_promotion_policies_priority_idx`(`priority`),
    PRIMARY KEY (`promotionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `promotion_products` (
    `promotionId` INTEGER NOT NULL,
    `productId` INTEGER NOT NULL,

    INDEX `promotion_products_productId_promotionId_idx`(`productId`, `promotionId`),
    PRIMARY KEY (`promotionId`, `productId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `promotion_user_usages` (
    `promotionId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `usedCount` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`promotionId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `promotion_redemptions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `promotionId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `orderId` INTEGER NOT NULL,
    `discountAmount` INTEGER NOT NULL,
    `status` ENUM('APPLIED', 'REVERSED') NOT NULL DEFAULT 'APPLIED',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reversedAt` DATETIME(3) NULL,
    `reverseReason` VARCHAR(50) NULL,

    UNIQUE INDEX `promotion_redemptions_orderId_key`(`orderId`),
    INDEX `promotion_redemptions_promotionId_status_createdAt_idx`(`promotionId`, `status`, `createdAt`),
    INDEX `promotion_redemptions_userId_promotionId_status_idx`(`userId`, `promotionId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_couponPromotionId_fkey` FOREIGN KEY (`couponPromotionId`) REFERENCES `promotions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_detail` ADD CONSTRAINT `order_detail_automaticPromotionId_fkey` FOREIGN KEY (`automaticPromotionId`) REFERENCES `promotions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `promotions` ADD CONSTRAINT `promotions_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `promotions` ADD CONSTRAINT `promotions_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `coupon_policies` ADD CONSTRAINT `coupon_policies_promotionId_fkey` FOREIGN KEY (`promotionId`) REFERENCES `promotions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `automatic_promotion_policies` ADD CONSTRAINT `automatic_promotion_policies_promotionId_fkey` FOREIGN KEY (`promotionId`) REFERENCES `promotions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `promotion_products` ADD CONSTRAINT `promotion_products_promotionId_fkey` FOREIGN KEY (`promotionId`) REFERENCES `promotions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `promotion_products` ADD CONSTRAINT `promotion_products_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `promotion_user_usages` ADD CONSTRAINT `promotion_user_usages_promotionId_fkey` FOREIGN KEY (`promotionId`) REFERENCES `promotions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `promotion_user_usages` ADD CONSTRAINT `promotion_user_usages_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `promotion_redemptions` ADD CONSTRAINT `promotion_redemptions_promotionId_fkey` FOREIGN KEY (`promotionId`) REFERENCES `promotions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `promotion_redemptions` ADD CONSTRAINT `promotion_redemptions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `promotion_redemptions` ADD CONSTRAINT `promotion_redemptions_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
