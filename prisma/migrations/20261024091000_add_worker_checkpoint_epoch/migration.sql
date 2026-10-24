-- AlterTable
ALTER TABLE `worker_checkpoints` ADD COLUMN `ownerEpoch` INTEGER NOT NULL DEFAULT 0;
