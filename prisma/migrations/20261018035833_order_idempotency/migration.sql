-- AlterTable
ALTER TABLE `orders` ADD COLUMN `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `idempotencyKey` VARCHAR(64) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `orders_userId_idempotencyKey_key` ON `orders`(`userId`, `idempotencyKey`);

