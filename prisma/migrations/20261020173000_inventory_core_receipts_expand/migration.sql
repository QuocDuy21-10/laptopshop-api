ALTER TABLE `stock_movements`
    ADD COLUMN `balanceBefore` INTEGER NULL,
    ADD COLUMN `balanceAfter` INTEGER NULL,
    ADD COLUMN `idempotencyKey` VARCHAR(64) NULL,
    ADD COLUMN `requestHash` CHAR(64) NULL,
    ADD COLUMN `receiptId` CHAR(36) NULL;

CREATE TABLE `stock_receipts` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(40) NOT NULL,
    `supplierName` VARCHAR(255) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    `note` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `postedAt` DATETIME(3) NULL,
    `createdById` INTEGER NOT NULL,
    `postedById` INTEGER NULL,

    UNIQUE INDEX `stock_receipts_code_key`(`code`),
    INDEX `stock_receipts_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `stock_receipts_createdById_createdAt_idx`(`createdById`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `stock_receipt_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `receiptId` CHAR(36) NOT NULL,
    `productId` INTEGER NOT NULL,
    `quantity` INTEGER NOT NULL,
    `unitCost` INTEGER NULL,

    UNIQUE INDEX `stock_receipt_items_receiptId_productId_key`(`receiptId`, `productId`),
    INDEX `stock_receipt_items_productId_idx`(`productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `stock_receipts`
    ADD CONSTRAINT `stock_receipts_createdById_fkey`
      FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `stock_receipts_postedById_fkey`
      FOREIGN KEY (`postedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `stock_receipt_items`
    ADD CONSTRAINT `stock_receipt_items_receiptId_fkey`
      FOREIGN KEY (`receiptId`) REFERENCES `stock_receipts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `stock_receipt_items_productId_fkey`
      FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `stock_movements`
    ADD UNIQUE INDEX `stock_movements_actorId_idempotencyKey_key`(`actorId`, `idempotencyKey`),
    ADD INDEX `stock_movements_receiptId_idx`(`receiptId`),
    ADD CONSTRAINT `stock_movements_receiptId_fkey`
      FOREIGN KEY (`receiptId`) REFERENCES `stock_receipts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
