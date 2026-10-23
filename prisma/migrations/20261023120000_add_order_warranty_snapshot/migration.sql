ALTER TABLE `order_detail`
  ADD COLUMN `warrantyMonthsSnapshot` INTEGER NULL,
  ADD COLUMN `warrantyStartAt` DATETIME(3) NULL,
  ADD COLUMN `warrantyEndAt` DATETIME(3) NULL,
  ADD COLUMN `warrantyPolicySource` VARCHAR(40) NOT NULL DEFAULT 'UNAVAILABLE';

UPDATE `order_detail` AS od
INNER JOIN `products` AS p ON p.`id` = od.`productId`
SET
  od.`warrantyMonthsSnapshot` = p.`warrantyMonths`,
  od.`warrantyPolicySource` = CASE
    WHEN p.`warrantyMonths` IS NULL THEN 'UNAVAILABLE'
    ELSE 'CURRENT_PRODUCT_POLICY_BACKFILL'
  END;

UPDATE `order_detail` AS od
INNER JOIN `orders` AS o ON o.`id` = od.`orderId`
SET
  od.`warrantyStartAt` = o.`completedAt`,
  od.`warrantyEndAt` = DATE_ADD(o.`completedAt`, INTERVAL od.`warrantyMonthsSnapshot` MONTH)
WHERE o.`status` = 'COMPLETED'
  AND o.`paymentStatus` = 'PAYMENT_SUCCESS'
  AND o.`completedAt` IS NOT NULL
  AND od.`warrantyMonthsSnapshot` > 0;
