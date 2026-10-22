/*
  Warnings:

  - Made the column `subtotalPrice` on table `orders` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE `orders` MODIFY `subtotalPrice` INTEGER NOT NULL;
