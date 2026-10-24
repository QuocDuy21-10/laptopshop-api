ALTER TABLE `service_request_events`
  MODIFY `kind` ENUM('REQUEST_CREATED', 'STATUS_CHANGED', 'PUBLIC_MESSAGE', 'INTERNAL_NOTE', 'ASSIGNED', 'QUOTE_SENT', 'QUOTE_DECIDED', 'DEVICE_RETURNED', 'CUSTOMER_CONFIRMED', 'COMPLETION_DISPUTED', 'AUTO_CLOSED', 'ADMIN_CLOSED', 'FOLLOW_UP_CREATED', 'WARRANTY_VERIFIED') NOT NULL;

CREATE TABLE `warranty_verifications` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `orderDetailId` INTEGER NOT NULL,
    `serviceRequestItemId` INTEGER NOT NULL,
    `decision` ENUM('IN_WARRANTY', 'OUT_OF_WARRANTY', 'NO_WARRANTY', 'UNVERIFIABLE') NOT NULL,
    `warrantyStartAt` DATETIME(3) NULL,
    `warrantyEndAt` DATETIME(3) NULL,
    `verifiedById` INTEGER NOT NULL,
    `internalNote` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `warranty_verifications_orderDetailId_createdAt_id_idx`(`orderDetailId`, `createdAt`, `id`),
    INDEX `warranty_verifications_serviceRequestItemId_createdAt_id_idx`(`serviceRequestItemId`, `createdAt`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `warranty_verifications`
  ADD CONSTRAINT `warranty_verifications_orderDetailId_fkey` FOREIGN KEY (`orderDetailId`) REFERENCES `order_detail`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `warranty_verifications_serviceRequestItemId_fkey` FOREIGN KEY (`serviceRequestItemId`) REFERENCES `service_request_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `warranty_verifications_verifiedById_fkey` FOREIGN KEY (`verifiedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
