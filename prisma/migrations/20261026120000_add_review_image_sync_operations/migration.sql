-- Add versioning to the visible image set.
ALTER TABLE `reviews`
    ADD COLUMN `imageVersion` INTEGER NOT NULL DEFAULT 0;

-- Add durable reservation metadata while preserving the existing review image lifecycle.
ALTER TABLE `review_images`
    ADD COLUMN `syncOperationId` INTEGER NULL,
    ADD COLUMN `syncClientId` VARCHAR(64) NULL,
    ADD COLUMN `purgeAfter` DATETIME(3) NULL;

-- Store idempotency keys with binary collation so case-distinct keys remain distinct.
CREATE TABLE `review_image_sync_operations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `reviewId` INTEGER NOT NULL,
    `idempotencyKey` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `requestFingerprint` CHAR(64) NOT NULL,
    `expectedVersion` INTEGER NOT NULL,
    `status` ENUM('PROCESSING', 'WAITING_RETRY', 'SUCCEEDED', 'FAILED') NOT NULL DEFAULT 'PROCESSING',
    `manifest` JSON NOT NULL,
    `result` JSON NULL,
    `errorCode` VARCHAR(80) NULL,
    `errorDetails` JSON NULL,
    `leaseOwner` VARCHAR(64) NULL,
    `leaseExpiresAt` DATETIME(3) NULL,
    `attemptCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `completedAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NULL,

    UNIQUE INDEX `review_image_sync_operations_userId_reviewId_idempotencyKey_key`(`userId`, `reviewId`, `idempotencyKey`),
    INDEX `review_image_sync_operations_status_leaseExpiresAt_idx`(`status`, `leaseExpiresAt`),
    INDEX `review_image_sync_operations_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `review_images_syncOperationId_syncClientId_key`
    ON `review_images`(`syncOperationId`, `syncClientId`);

ALTER TABLE `review_image_sync_operations`
    ADD CONSTRAINT `review_image_sync_operations_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `review_image_sync_operations_reviewId_fkey`
    FOREIGN KEY (`reviewId`) REFERENCES `reviews`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `review_images`
    ADD CONSTRAINT `review_images_syncOperationId_fkey`
    FOREIGN KEY (`syncOperationId`) REFERENCES `review_image_sync_operations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
