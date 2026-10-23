-- AlterTable
ALTER TABLE `notifications` ADD COLUMN `priceSource` ENUM('LIST_PRICE', 'AUTOMATIC', 'FLASH_SALE') NULL,
    ADD COLUMN `pricingVersion` INTEGER NULL,
    ADD COLUMN `promotionId` INTEGER NULL,
    ADD COLUMN `validUntil` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `users` ADD COLUMN `emailVerifiedAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `wishlist_items` ADD COLUMN `alertVersion` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `includeFlashSale` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `notification_preferences` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `emailEnabled` BOOLEAN NOT NULL DEFAULT false,
    `webPushEnabled` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `notification_preferences_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `email_verification_challenges` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `otpHash` VARCHAR(255) NOT NULL,
    `otpCiphertext` TEXT NOT NULL,
    `otpIv` VARCHAR(64) NOT NULL,
    `otpTag` VARCHAR(64) NOT NULL,
    `encryptionKeyVersion` VARCHAR(32) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `failedAttempts` INTEGER NOT NULL DEFAULT 0,
    `sendCount` INTEGER NOT NULL DEFAULT 0,
    `lastSentAt` DATETIME(3) NULL,
    `consumedAt` DATETIME(3) NULL,
    `invalidatedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `email_verification_challenges_userId_consumedAt_invalidatedA_idx`(`userId`, `consumedAt`, `invalidatedAt`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `push_subscriptions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `endpoint` TEXT NOT NULL,
    `endpointHash` CHAR(64) NOT NULL,
    `p256dh` VARCHAR(255) NOT NULL,
    `auth` VARCHAR(255) NOT NULL,
    `userAgent` VARCHAR(255) NULL,
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `disabledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `push_subscriptions_endpointHash_key`(`endpointHash`),
    INDEX `push_subscriptions_userId_disabledAt_idx`(`userId`, `disabledAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_deliveries` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `notificationId` INTEGER NULL,
    `emailVerificationChallengeId` INTEGER NULL,
    `pushSubscriptionId` INTEGER NULL,
    `parentType` ENUM('NOTIFICATION', 'EMAIL_VERIFICATION') NOT NULL,
    `channel` ENUM('EMAIL', 'WEB_PUSH') NOT NULL,
    `status` ENUM('PENDING', 'PROCESSING', 'DELIVERED', 'RETRYING', 'FAILED', 'DEAD', 'CANCELLED', 'SUPPRESSED') NOT NULL DEFAULT 'PENDING',
    `dedupeKey` VARCHAR(191) NOT NULL,
    `destinationKey` VARCHAR(255) NOT NULL,
    `destinationSnapshot` TEXT NULL,
    `attemptCount` INTEGER NOT NULL DEFAULT 0,
    `nextAttemptAt` DATETIME(3) NULL,
    `leaseOwner` VARCHAR(128) NULL,
    `leaseExpiresAt` DATETIME(3) NULL,
    `providerMessageId` VARCHAR(255) NULL,
    `normalizedErrorCode` VARCHAR(100) NULL,
    `lastErrorAt` DATETIME(3) NULL,
    `deliveredAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `notification_deliveries_dedupeKey_key`(`dedupeKey`),
    INDEX `notification_deliveries_status_nextAttemptAt_idx`(`status`, `nextAttemptAt`),
    INDEX `notification_deliveries_notificationId_channel_idx`(`notificationId`, `channel`),
    INDEX `notification_deliveries_emailVerificationChallengeId_channel_idx`(`emailVerificationChallengeId`, `channel`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_delivery_audits` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `deliveryId` INTEGER NOT NULL,
    `actorId` INTEGER NULL,
    `action` VARCHAR(50) NOT NULL,
    `reason` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notification_delivery_audits_deliveryId_createdAt_idx`(`deliveryId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `outbox_events` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `eventType` ENUM('PRICE_REEVALUATION_REQUESTED', 'NOTIFICATION_DELIVERY_REQUESTED') NOT NULL,
    `schemaVersion` INTEGER NOT NULL DEFAULT 1,
    `aggregateType` VARCHAR(100) NOT NULL,
    `aggregateId` INTEGER NOT NULL,
    `dedupeKey` VARCHAR(191) NOT NULL,
    `payload` JSON NOT NULL,
    `availableAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `leaseOwner` VARCHAR(128) NULL,
    `leaseExpiresAt` DATETIME(3) NULL,
    `publishAttempts` INTEGER NOT NULL DEFAULT 0,
    `publishedAt` DATETIME(3) NULL,
    `lastErrorCode` VARCHAR(100) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `outbox_events_dedupeKey_key`(`dedupeKey`),
    INDEX `outbox_events_publishedAt_availableAt_leaseExpiresAt_idx`(`publishedAt`, `availableAt`, `leaseExpiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `worker_heartbeats` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `workerName` VARCHAR(100) NOT NULL,
    `instanceId` VARCHAR(128) NOT NULL,
    `status` VARCHAR(32) NOT NULL,
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `worker_heartbeats_workerName_lastSeenAt_idx`(`workerName`, `lastSeenAt`),
    UNIQUE INDEX `worker_heartbeats_workerName_instanceId_key`(`workerName`, `instanceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `notification_preferences` ADD CONSTRAINT `notification_preferences_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `email_verification_challenges` ADD CONSTRAINT `email_verification_challenges_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `push_subscriptions` ADD CONSTRAINT `push_subscriptions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_deliveries` ADD CONSTRAINT `notification_deliveries_notificationId_fkey` FOREIGN KEY (`notificationId`) REFERENCES `notifications`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_deliveries` ADD CONSTRAINT `notification_deliveries_emailVerificationChallengeId_fkey` FOREIGN KEY (`emailVerificationChallengeId`) REFERENCES `email_verification_challenges`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_deliveries` ADD CONSTRAINT `notification_deliveries_pushSubscriptionId_fkey` FOREIGN KEY (`pushSubscriptionId`) REFERENCES `push_subscriptions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_delivery_audits` ADD CONSTRAINT `notification_delivery_audits_deliveryId_fkey` FOREIGN KEY (`deliveryId`) REFERENCES `notification_deliveries`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_delivery_audits` ADD CONSTRAINT `notification_delivery_audits_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
