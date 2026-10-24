-- CreateTable
CREATE TABLE `worker_checkpoints` (
    `workerName` VARCHAR(100) NOT NULL,
    `ownerToken` VARCHAR(128) NULL,
    `cursor` JSON NULL,
    `cycleStartedAt` DATETIME(3) NULL,
    `lastStartedAt` DATETIME(3) NULL,
    `lastCompletedAt` DATETIME(3) NULL,
    `lastSucceededAt` DATETIME(3) NULL,
    `lastDurationMs` INTEGER NULL,
    `consecutiveFailures` INTEGER NOT NULL DEFAULT 0,
    `lastErrorCode` VARCHAR(100) NULL,
    `lastStats` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`workerName`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
