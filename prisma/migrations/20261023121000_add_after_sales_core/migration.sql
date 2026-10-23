ALTER TABLE `order_detail` MODIFY `warrantyPolicySource` ENUM('CHECKOUT_SNAPSHOT', 'CURRENT_PRODUCT_POLICY_BACKFILL', 'UNAVAILABLE') NOT NULL DEFAULT 'UNAVAILABLE';

CREATE TABLE `service_requests` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(32) NOT NULL,
    `userId` INTEGER NOT NULL,
    `type` ENUM('WARRANTY', 'TECHNICAL_SUPPORT') NOT NULL,
    `status` ENUM('SUBMITTED', 'REVIEWING', 'IN_PROGRESS', 'AWAITING_CUSTOMER', 'PARTIALLY_COMPLETED', 'CLOSED') NOT NULL DEFAULT 'SUBMITTED',
    `subject` VARCHAR(200) NOT NULL,
    `assignedToId` INTEGER NULL,
    `previousRequestId` INTEGER NULL,
    `idempotencyKey` VARCHAR(64) NOT NULL,
    `requestHash` CHAR(64) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `closedAt` DATETIME(3) NULL,
    UNIQUE INDEX `service_requests_code_key`(`code`),
    INDEX `service_requests_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `service_requests_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `service_requests_assignedToId_status_idx`(`assignedToId`, `status`),
    INDEX `service_requests_previousRequestId_idx`(`previousRequestId`),
    UNIQUE INDEX `service_requests_userId_idempotencyKey_key`(`userId`, `idempotencyKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `service_request_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `serviceRequestId` INTEGER NOT NULL,
    `orderDetailId` INTEGER NOT NULL,
    `position` SMALLINT UNSIGNED NOT NULL,
    `productNameSnapshot` VARCHAR(255) NOT NULL,
    `deviceLabel` VARCHAR(100) NOT NULL,
    `serialNumber` VARCHAR(100) NULL,
    `serialNumberNormalized` VARCHAR(100) NULL,
    `issueDescription` TEXT NOT NULL,
    `coverageAtCreation` ENUM('IN_WARRANTY', 'OUT_OF_WARRANTY', 'NO_WARRANTY', 'REQUIRES_VERIFICATION') NOT NULL,
    `status` ENUM('SUBMITTED', 'REVIEWING', 'APPROVED', 'AWAITING_ITEM', 'RECEIVED', 'DIAGNOSING', 'AWAITING_QUOTE_DECISION', 'IN_SERVICE', 'READY_FOR_RETURN', 'RETURNED', 'RESOLVED', 'CLOSED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'SUBMITTED',
    `resolution` TEXT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `resolvedAt` DATETIME(3) NULL,
    `returnedAt` DATETIME(3) NULL,
    `confirmationDueAt` DATETIME(3) NULL,
    `customerConfirmedAt` DATETIME(3) NULL,
    `closedAt` DATETIME(3) NULL,
    `closeReason` ENUM('CUSTOMER_CONFIRMED', 'CUSTOMER_CONFIRMATION_TIMEOUT', 'ADMINISTRATIVE', 'REJECTED', 'CUSTOMER_CANCELLED') NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    INDEX `service_request_items_orderDetailId_status_idx`(`orderDetailId`, `status`),
    INDEX `service_request_items_serviceRequestId_status_idx`(`serviceRequestId`, `status`),
    INDEX `service_request_items_confirmationDueAt_status_idx`(`confirmationDueAt`, `status`),
    UNIQUE INDEX `service_request_items_serviceRequestId_position_key`(`serviceRequestId`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `service_request_events` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `serviceRequestId` INTEGER NOT NULL,
    `serviceRequestItemId` INTEGER NULL,
    `actorId` INTEGER NULL,
    `kind` ENUM('REQUEST_CREATED', 'STATUS_CHANGED', 'PUBLIC_MESSAGE', 'INTERNAL_NOTE', 'ASSIGNED', 'QUOTE_SENT', 'QUOTE_DECIDED', 'DEVICE_RETURNED', 'CUSTOMER_CONFIRMED', 'COMPLETION_DISPUTED', 'AUTO_CLOSED', 'ADMIN_CLOSED', 'FOLLOW_UP_CREATED') NOT NULL,
    `visibility` ENUM('PUBLIC', 'INTERNAL') NOT NULL DEFAULT 'PUBLIC',
    `fromStatus` ENUM('SUBMITTED', 'REVIEWING', 'APPROVED', 'AWAITING_ITEM', 'RECEIVED', 'DIAGNOSING', 'AWAITING_QUOTE_DECISION', 'IN_SERVICE', 'READY_FOR_RETURN', 'RETURNED', 'RESOLVED', 'CLOSED', 'REJECTED', 'CANCELLED') NULL,
    `toStatus` ENUM('SUBMITTED', 'REVIEWING', 'APPROVED', 'AWAITING_ITEM', 'RECEIVED', 'DIAGNOSING', 'AWAITING_QUOTE_DECISION', 'IN_SERVICE', 'READY_FOR_RETURN', 'RETURNED', 'RESOLVED', 'CLOSED', 'REJECTED', 'CANCELLED') NULL,
    `body` TEXT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `service_request_events_serviceRequestId_createdAt_id_idx`(`serviceRequestId`, `createdAt`, `id`),
    INDEX `service_request_events_serviceRequestItemId_createdAt_id_idx`(`serviceRequestItemId`, `createdAt`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `service_request_attachments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `serviceRequestId` INTEGER NOT NULL,
    `serviceRequestItemId` INTEGER NULL,
    `eventId` INTEGER NULL,
    `uploadedById` INTEGER NOT NULL,
    `objectKey` VARCHAR(512) NOT NULL,
    `mimeType` VARCHAR(50) NOT NULL,
    `byteSize` INTEGER NOT NULL,
    `width` INTEGER NOT NULL,
    `height` INTEGER NOT NULL,
    `visibility` ENUM('PUBLIC', 'INTERNAL') NOT NULL DEFAULT 'PUBLIC',
    `status` ENUM('PENDING', 'READY', 'DELETING') NOT NULL DEFAULT 'PENDING',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `storageDeletedAt` DATETIME(3) NULL,
    UNIQUE INDEX `service_request_attachments_objectKey_key`(`objectKey`),
    INDEX `service_request_attachments_serviceRequestId_createdAt_idx`(`serviceRequestId`, `createdAt`),
    INDEX `service_request_attachments_serviceRequestItemId_status_crea_idx`(`serviceRequestItemId`, `status`, `createdAt`),
    INDEX `service_request_attachments_status_updatedAt_idx`(`status`, `updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `service_quotes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `serviceRequestItemId` INTEGER NOT NULL,
    `version` INTEGER NOT NULL,
    `status` ENUM('SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'SUPERSEDED') NOT NULL DEFAULT 'SENT',
    `currency` CHAR(3) NOT NULL DEFAULT 'VND',
    `subtotal` INTEGER NOT NULL,
    `total` INTEGER NOT NULL,
    `note` VARCHAR(1000) NULL,
    `validUntil` DATETIME(3) NOT NULL,
    `createdById` INTEGER NOT NULL,
    `respondedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `service_quotes_serviceRequestItemId_status_idx`(`serviceRequestItemId`, `status`),
    INDEX `service_quotes_validUntil_status_idx`(`validUntil`, `status`),
    UNIQUE INDEX `service_quotes_serviceRequestItemId_version_key`(`serviceRequestItemId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `service_quote_lines` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `quoteId` INTEGER NOT NULL,
    `description` VARCHAR(255) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `unitPrice` INTEGER NOT NULL,
    `lineTotal` INTEGER NOT NULL,
    `position` SMALLINT UNSIGNED NOT NULL,
    UNIQUE INDEX `service_quote_lines_quoteId_position_key`(`quoteId`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `service_requests`
  ADD CONSTRAINT `service_requests_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `service_requests_assignedToId_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `service_requests_previousRequestId_fkey` FOREIGN KEY (`previousRequestId`) REFERENCES `service_requests`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `service_request_items`
  ADD CONSTRAINT `service_request_items_serviceRequestId_fkey` FOREIGN KEY (`serviceRequestId`) REFERENCES `service_requests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `service_request_items_orderDetailId_fkey` FOREIGN KEY (`orderDetailId`) REFERENCES `order_detail`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `service_request_events`
  ADD CONSTRAINT `service_request_events_serviceRequestId_fkey` FOREIGN KEY (`serviceRequestId`) REFERENCES `service_requests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `service_request_events_serviceRequestItemId_fkey` FOREIGN KEY (`serviceRequestItemId`) REFERENCES `service_request_items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `service_request_events_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `service_request_attachments`
  ADD CONSTRAINT `service_request_attachments_serviceRequestId_fkey` FOREIGN KEY (`serviceRequestId`) REFERENCES `service_requests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `service_request_attachments_serviceRequestItemId_fkey` FOREIGN KEY (`serviceRequestItemId`) REFERENCES `service_request_items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `service_request_attachments_uploadedById_fkey` FOREIGN KEY (`uploadedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `service_quotes`
  ADD CONSTRAINT `service_quotes_serviceRequestItemId_fkey` FOREIGN KEY (`serviceRequestItemId`) REFERENCES `service_request_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `service_quotes_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `service_quote_lines`
  ADD CONSTRAINT `service_quote_lines_quoteId_fkey` FOREIGN KEY (`quoteId`) REFERENCES `service_quotes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
