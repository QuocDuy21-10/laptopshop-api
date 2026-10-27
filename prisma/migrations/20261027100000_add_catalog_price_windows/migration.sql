CREATE TABLE `catalog_price_windows` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `productId` INT NOT NULL,
  `validFrom` DATETIME(3) NOT NULL,
  `validUntil` DATETIME(3) NULL,
  `source` VARCHAR(20) NOT NULL,
  `listPrice` INT NOT NULL,
  `effectiveCatalogPrice` INT NOT NULL,
  `automaticPromotionId` INT NULL,
  `promotionPricingVersion` INT NULL,
  `policyVersion` INT NOT NULL,
  `computedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE INDEX `catalog_price_windows_productId_validFrom_key` (`productId`, `validFrom`),
  INDEX `catalog_price_windows_productId_validFrom_validUntil_idx` (`productId`, `validFrom`, `validUntil`),
  INDEX `catalog_price_windows_automaticPromotionId_idx` (`automaticPromotionId`),
  CONSTRAINT `catalog_price_windows_productId_fkey`
    FOREIGN KEY (`productId`) REFERENCES `products` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `catalog_price_windows_automaticPromotionId_fkey`
    FOREIGN KEY (`automaticPromotionId`) REFERENCES `promotions` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
