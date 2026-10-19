ALTER TABLE `order_status_history` ADD COLUMN `reason` VARCHAR(50) NULL;

CREATE TABLE `payments` (
    `id` CHAR(36) NOT NULL,
    `orderId` INTEGER NOT NULL,
    `provider` VARCHAR(20) NOT NULL,
    `method` VARCHAR(30) NOT NULL DEFAULT 'BANK_TRANSFER',
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `amount` INTEGER NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'VND',
    `transferCode` VARCHAR(32) NOT NULL,
    `bankCode` VARCHAR(30) NOT NULL,
    `accountNumber` VARCHAR(64) NOT NULL,
    `accountName` VARCHAR(255) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `cancelAfter` DATETIME(3) NOT NULL,
    `paidAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `payments_orderId_key`(`orderId`),
    UNIQUE INDEX `payments_transferCode_key`(`transferCode`),
    INDEX `payments_status_cancelAfter_idx`(`status`, `cancelAfter`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `payment_webhook_events` (
    `id` CHAR(36) NOT NULL,
    `provider` VARCHAR(20) NOT NULL,
    `source` VARCHAR(20) NOT NULL,
    `providerEventId` VARCHAR(150) NOT NULL,
    `providerTransactionKey` VARCHAR(150) NOT NULL,
    `paymentId` CHAR(36) NULL,
    `direction` VARCHAR(10) NOT NULL,
    `amount` INTEGER NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'VND',
    `transferCode` VARCHAR(64) NULL,
    `accountNumber` VARCHAR(64) NULL,
    `occurredAt` DATETIME(3) NULL,
    `status` VARCHAR(30) NOT NULL DEFAULT 'REVIEW_REQUIRED',
    `reviewReason` VARCHAR(40) NULL,
    `payloadHash` CHAR(64) NOT NULL,
    `rawPayload` LONGBLOB NULL,
    `rawPayloadIv` VARBINARY(16) NULL,
    `rawPayloadTag` VARBINARY(16) NULL,
    `encryptionKeyId` VARCHAR(32) NULL,
    `note` VARCHAR(500) NULL,
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resolvedAt` DATETIME(3) NULL,
    `resolvedById` INTEGER NULL,
    UNIQUE INDEX `payment_webhook_events_provider_providerEventId_key`(`provider`, `providerEventId`),
    UNIQUE INDEX `payment_webhook_events_provider_providerTransactionKey_key`(`provider`, `providerTransactionKey`),
    INDEX `payment_webhook_events_status_receivedAt_idx`(`status`, `receivedAt`),
    INDEX `payment_webhook_events_paymentId_idx`(`paymentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `payment_provider_checkpoints` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `provider` VARCHAR(20) NOT NULL,
    `mode` VARCHAR(20) NOT NULL,
    `cursor` VARCHAR(150) NULL,
    `lastStartedAt` DATETIME(3) NULL,
    `lastSucceededAt` DATETIME(3) NULL,
    `lastErrorAt` DATETIME(3) NULL,
    `lastError` VARCHAR(500) NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `payment_provider_checkpoints_provider_mode_key`(`provider`, `mode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `payments`
  ADD CONSTRAINT `payments_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `payment_webhook_events`
  ADD CONSTRAINT `payment_webhook_events_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `payments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `payment_webhook_events_resolvedById_fkey` FOREIGN KEY (`resolvedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
