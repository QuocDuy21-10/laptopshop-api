ALTER TABLE `notification_preferences`
  ADD COLUMN `afterSalesEmailEnabled` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `afterSalesWebPushEnabled` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `notifications`
  ADD COLUMN `serviceRequestId` INTEGER NULL,
  MODIFY `type` ENUM('PRICE_DROP', 'AFTER_SALES_MESSAGE', 'AFTER_SALES_STATUS_CHANGED', 'AFTER_SALES_QUOTE_SENT', 'AFTER_SALES_CONFIRMATION_REQUIRED', 'AFTER_SALES_AUTO_CLOSED') NOT NULL;

CREATE INDEX `notifications_serviceRequestId_createdAt_idx` ON `notifications`(`serviceRequestId`, `createdAt`);

ALTER TABLE `notifications`
  ADD CONSTRAINT `notifications_serviceRequestId_fkey` FOREIGN KEY (`serviceRequestId`) REFERENCES `service_requests`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
