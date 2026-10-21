-- CreateTable
CREATE TABLE `reviews` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `productId` INTEGER NOT NULL,
    `orderDetailId` INTEGER NOT NULL,
    `rating` TINYINT UNSIGNED NOT NULL,
    `title` VARCHAR(150) NULL,
    `content` VARCHAR(1500) NOT NULL,
    `isAnonymous` BOOLEAN NOT NULL,
    `status` ENUM('PUBLISHED', 'HIDDEN') NOT NULL DEFAULT 'PUBLISHED',
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `contentUpdatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `hiddenReason` VARCHAR(500) NULL,
    `moderatedAt` DATETIME(3) NULL,
    `moderatedById` INTEGER NULL,

    UNIQUE INDEX `reviews_orderDetailId_key`(`orderDetailId`),
    INDEX `reviews_productId_status_deletedAt_createdAt_idx`(`productId`, `status`, `deletedAt`, `createdAt`),
    INDEX `reviews_status_deletedAt_createdAt_idx`(`status`, `deletedAt`, `createdAt`),
    UNIQUE INDEX `reviews_userId_productId_key`(`userId`, `productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddConstraint
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_rating_check` CHECK (`rating` BETWEEN 1 AND 5);

-- AddForeignKey
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_orderDetailId_fkey` FOREIGN KEY (`orderDetailId`) REFERENCES `order_detail`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_moderatedById_fkey` FOREIGN KEY (`moderatedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

