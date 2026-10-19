-- CreateIndex
CREATE INDEX `orders_status_createdAt_idx` ON `orders`(`status`, `createdAt`);

-- CreateIndex
CREATE INDEX `orders_createdAt_idx` ON `orders`(`createdAt`);

