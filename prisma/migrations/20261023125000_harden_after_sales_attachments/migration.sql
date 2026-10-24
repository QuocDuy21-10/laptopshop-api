ALTER TABLE `service_request_attachments`
  ADD COLUMN `uploadKey` VARCHAR(64) NULL,
  ADD COLUMN `uploadHash` CHAR(64) NULL,
  ADD COLUMN `uploadPosition` SMALLINT UNSIGNED NULL,
  ADD UNIQUE INDEX `service_request_attachments_item_upload_position_key`(`serviceRequestItemId`, `uploadKey`, `uploadPosition`);
