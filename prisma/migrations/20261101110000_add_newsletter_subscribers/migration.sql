-- CreateTable
CREATE TABLE `newsletter_subscribers` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(254) NOT NULL,
  `status` ENUM('PENDING', 'CONFIRMED', 'UNSUBSCRIBED') NOT NULL DEFAULT 'PENDING',
  `confirmTokenHash` VARCHAR(64) NULL,
  `confirmExpiresAt` DATETIME(3) NULL,
  `lastConfirmationSentAt` DATETIME(3) NULL,
  `confirmedAt` DATETIME(3) NULL,
  `unsubscribedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `newsletter_subscribers_email_key`(`email`),
  UNIQUE INDEX `newsletter_subscribers_confirmTokenHash_key`(`confirmTokenHash`),
  INDEX `newsletter_subscribers_status_createdAt_idx`(`status`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
