-- TiDB cannot add a column and an index on it in one ALTER TABLE, so split.
ALTER TABLE `service_request_attachments`
  ADD COLUMN `uploadKey` VARCHAR(64) NULL,
  ADD COLUMN `uploadHash` CHAR(64) NULL,
  ADD COLUMN `uploadPosition` SMALLINT UNSIGNED NULL;

ALTER TABLE `service_request_attachments`
  ADD UNIQUE INDEX `service_request_attachments_item_upload_position_key`(`serviceRequestItemId`, `uploadKey`, `uploadPosition`);
