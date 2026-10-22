-- AlterTable
ALTER TABLE `promotions` MODIFY `kind` ENUM('COUPON', 'AUTOMATIC', 'FLASH_SALE') NOT NULL;

-- CreateTable
CREATE TABLE `flash_sale_policies` (
    `promotionId` INTEGER NOT NULL,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `stackableWithCoupon` BOOLEAN NOT NULL DEFAULT false,
    `showRemainingQuota` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`promotionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `flash_sale_product_quotas` (
    `promotionId` INTEGER NOT NULL,
    `productId` INTEGER NOT NULL,
    `totalQuota` INTEGER NOT NULL,
    `claimedUnits` INTEGER NOT NULL DEFAULT 0,
    `maxUnitsPerUser` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `flash_sale_product_quotas_productId_promotionId_idx`(`productId`, `promotionId`),
    PRIMARY KEY (`promotionId`, `productId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `flash_sale_user_usages` (
    `promotionId` INTEGER NOT NULL,
    `productId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `claimedUnits` INTEGER NOT NULL DEFAULT 0,

    INDEX `flash_sale_user_usages_userId_promotionId_idx`(`userId`, `promotionId`),
    PRIMARY KEY (`promotionId`, `productId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `flash_sale_allocations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `promotionId` INTEGER NOT NULL,
    `productId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `orderId` INTEGER NOT NULL,
    `orderDetailId` INTEGER NOT NULL,
    `quantity` INTEGER NOT NULL,
    `discountAmount` INTEGER NOT NULL,
    `status` ENUM('CLAIMED', 'RELEASED') NOT NULL DEFAULT 'CLAIMED',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `releasedAt` DATETIME(3) NULL,
    `releaseReason` VARCHAR(50) NULL,

    UNIQUE INDEX `flash_sale_allocations_orderDetailId_key`(`orderDetailId`),
    INDEX `flash_sale_allocations_promotionId_productId_status_idx`(`promotionId`, `productId`, `status`),
    INDEX `flash_sale_allocations_userId_promotionId_status_idx`(`userId`, `promotionId`, `status`),
    INDEX `flash_sale_allocations_createdAt_idx`(`createdAt`),
    UNIQUE INDEX `flash_sale_allocations_promotionId_productId_orderId_key`(`promotionId`, `productId`, `orderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `flash_sale_policies` ADD CONSTRAINT `flash_sale_policies_promotionId_fkey` FOREIGN KEY (`promotionId`) REFERENCES `promotions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `flash_sale_product_quotas` ADD CONSTRAINT `flash_sale_product_quotas_promotion_fkey` FOREIGN KEY (`promotionId`) REFERENCES `promotions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `flash_sale_product_quotas` ADD CONSTRAINT `flash_sale_product_quotas_policy_fkey` FOREIGN KEY (`promotionId`) REFERENCES `flash_sale_policies`(`promotionId`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `flash_sale_product_quotas` ADD CONSTRAINT `flash_sale_product_quotas_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `flash_sale_user_usages` ADD CONSTRAINT `flash_sale_user_usages_promotionId_productId_fkey` FOREIGN KEY (`promotionId`, `productId`) REFERENCES `flash_sale_product_quotas`(`promotionId`, `productId`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `flash_sale_user_usages` ADD CONSTRAINT `flash_sale_user_usages_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `flash_sale_allocations` ADD CONSTRAINT `flash_sale_allocations_promotionId_productId_fkey` FOREIGN KEY (`promotionId`, `productId`) REFERENCES `flash_sale_product_quotas`(`promotionId`, `productId`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `flash_sale_allocations` ADD CONSTRAINT `flash_sale_allocations_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `flash_sale_allocations` ADD CONSTRAINT `flash_sale_allocations_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `flash_sale_allocations` ADD CONSTRAINT `flash_sale_allocations_orderDetailId_fkey` FOREIGN KEY (`orderDetailId`) REFERENCES `order_detail`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
