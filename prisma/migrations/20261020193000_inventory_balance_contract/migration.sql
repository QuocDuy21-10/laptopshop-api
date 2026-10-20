-- BACKFILL_START
UPDATE `stock_movements` AS sm
JOIN (
    SELECT `id`,
           SUM(`delta`) OVER (
             PARTITION BY `productId`
             ORDER BY `createdAt`, `id`
             ROWS UNBOUNDED PRECEDING
           ) AS `computedAfter`
    FROM `stock_movements`
) AS running ON running.`id` = sm.`id`
SET sm.`balanceAfter` = running.`computedAfter`,
    sm.`balanceBefore` = running.`computedAfter` - sm.`delta`;
-- BACKFILL_END

ALTER TABLE `stock_movements`
    MODIFY COLUMN `balanceBefore` INTEGER NOT NULL,
    MODIFY COLUMN `balanceAfter` INTEGER NOT NULL;
