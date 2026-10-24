ALTER TABLE `payments`
  ADD COLUMN `providerMode` VARCHAR(20) NULL,
  ADD COLUMN `reviewAfter` DATETIME(3) NULL;

UPDATE `payments`
SET `providerMode` = 'test'
WHERE `provider` = 'fake' AND `providerMode` IS NULL;

UPDATE `payments`
SET `reviewAfter` = DATE_ADD(`expiresAt`, INTERVAL 60 MINUTE)
WHERE `reviewAfter` IS NULL;

ALTER TABLE `payments`
  MODIFY COLUMN `reviewAfter` DATETIME(3) NOT NULL,
  ADD INDEX `payments_status_reviewAfter_idx`(`status`, `reviewAfter`);

ALTER TABLE `payment_webhook_events`
  ADD COLUMN `providerMode` VARCHAR(20) NULL;

UPDATE `payment_webhook_events`
SET `providerMode` = 'test'
WHERE `provider` = 'fake' AND `providerMode` IS NULL;

DROP INDEX `payment_webhook_events_provider_providerEventId_key` ON `payment_webhook_events`;
DROP INDEX `payment_webhook_events_provider_providerTransactionKey_key` ON `payment_webhook_events`;

CREATE UNIQUE INDEX `payment_events_provider_mode_event_key`
  ON `payment_webhook_events`(`provider`, `providerMode`, `providerEventId`);
CREATE UNIQUE INDEX `payment_events_provider_mode_tx_key`
  ON `payment_webhook_events`(`provider`, `providerMode`, `providerTransactionKey`);

ALTER TABLE `payment_provider_checkpoints`
  ADD COLUMN `previousVerifiedThroughAt` DATETIME(3) NULL,
  ADD COLUMN `verifiedThroughAt` DATETIME(3) NULL,
  ADD COLUMN `leaseOwner` CHAR(36) NULL,
  ADD COLUMN `leaseExpiresAt` DATETIME(3) NULL,
  ADD COLUMN `lastDurationMs` INTEGER NULL,
  ADD COLUMN `lastProcessedCount` INTEGER NULL,
  ADD COLUMN `consecutiveSuccesses` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `consecutiveFailures` INTEGER NOT NULL DEFAULT 0;

CREATE TABLE `payment_review_cases` (
    `id` CHAR(36) NOT NULL,
    `paymentId` CHAR(36) NOT NULL,
    `reason` VARCHAR(50) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    `version` INTEGER NOT NULL DEFAULT 0,
    `openedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `nextReviewAt` DATETIME(3) NULL,
    `resolvedAt` DATETIME(3) NULL,
    `resolvedById` INTEGER NULL,
    `resolution` VARCHAR(50) NULL,
    UNIQUE INDEX `payment_review_cases_paymentId_key`(`paymentId`),
    INDEX `payment_review_cases_status_openedAt_idx`(`status`, `openedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `payment_review_actions` (
    `id` CHAR(36) NOT NULL,
    `reviewCaseId` CHAR(36) NOT NULL,
    `actorId` INTEGER NOT NULL,
    `action` VARCHAR(30) NOT NULL,
    `note` VARCHAR(500) NOT NULL,
    `holdUntil` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `payment_review_actions_reviewCaseId_createdAt_idx`(`reviewCaseId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `payment_review_cases`
  ADD CONSTRAINT `payment_review_cases_paymentId_fkey`
    FOREIGN KEY (`paymentId`) REFERENCES `payments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `payment_review_cases_resolvedById_fkey`
    FOREIGN KEY (`resolvedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `payment_review_actions`
  ADD CONSTRAINT `payment_review_actions_reviewCaseId_fkey`
    FOREIGN KEY (`reviewCaseId`) REFERENCES `payment_review_cases`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `payment_review_actions_actorId_fkey`
    FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
