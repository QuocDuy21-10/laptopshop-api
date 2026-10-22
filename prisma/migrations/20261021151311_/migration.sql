-- DropForeignKey
ALTER TABLE `payment_webhook_events`
DROP FOREIGN KEY `payment_webhook_events_paymentId_fkey`;

-- DropForeignKey
ALTER TABLE `stock_receipts`
DROP FOREIGN KEY `stock_receipts_postedById_fkey`;

-- DropIndex
DROP INDEX `stock_receipts_postedById_fkey`
ON `stock_receipts`;

-- AlterTable
ALTER TABLE `payment_webhook_events`
MODIFY `paymentId` VARCHAR(191) NULL;

-- AddForeignKey
ALTER TABLE `payment_webhook_events`
ADD CONSTRAINT `payment_webhook_events_paymentId_fkey`
FOREIGN KEY (`paymentId`)
REFERENCES `payments`(`id`)
ON DELETE SET NULL
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_receipts`
ADD CONSTRAINT `stock_receipts_postedById_fkey`
FOREIGN KEY (`postedById`)
REFERENCES `users`(`id`)
ON DELETE SET NULL
ON UPDATE CASCADE;