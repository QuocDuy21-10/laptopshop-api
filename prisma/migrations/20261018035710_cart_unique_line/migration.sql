-- merge duplicate lines (keep the lowest id, sum the quantities) so the unique index can be created
UPDATE `cart_detail` AS keep
JOIN (
    SELECT MIN(`id`) AS `id`, SUM(`quantity`) AS `qty`
    FROM `cart_detail`
    GROUP BY `cartId`, `productId`
    HAVING COUNT(*) > 1
) AS dup ON dup.`id` = keep.`id`
SET keep.`quantity` = dup.`qty`;

DELETE d FROM `cart_detail` AS d
JOIN `cart_detail` AS k
  ON k.`cartId` = d.`cartId` AND k.`productId` = d.`productId` AND k.`id` < d.`id`;

-- AlterTable
ALTER TABLE `cart` MODIFY `sum` INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `cart_detail` MODIFY `price` INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX `cart_detail_cartId_productId_key` ON `cart_detail`(`cartId`, `productId`);

