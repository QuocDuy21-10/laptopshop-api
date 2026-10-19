-- AlterTable
ALTER TABLE `products` ADD COLUMN `cpu` VARCHAR(255) NULL,
    ADD COLUMN `gpu` VARCHAR(255) NULL,
    ADD COLUMN `ramGb` INTEGER NULL,
    ADD COLUMN `storageGb` INTEGER NULL,
    ADD COLUMN `screenSizeInch` DOUBLE NULL,
    ADD COLUMN `screenResolution` VARCHAR(50) NULL,
    ADD COLUMN `refreshRateHz` INTEGER NULL,
    ADD COLUMN `batteryWh` INTEGER NULL,
    ADD COLUMN `weightGrams` INTEGER NULL,
    ADD COLUMN `warrantyMonths` INTEGER NULL;
