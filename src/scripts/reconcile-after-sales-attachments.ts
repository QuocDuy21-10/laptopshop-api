import { env } from "config/env";
import { logger } from "lib/logger";
import { createS3ObjectStorage } from "lib/storage/s3-object-storage";
import { reconcileAfterSalesAttachments } from "modules/after-sales/after-sales-attachment-cleanup";

const main = async () => {
  const storage = createS3ObjectStorage({
    enabled: env.AFTER_SALES_IMAGES_ENABLED,
    endpoint: env.AFTER_SALES_IMAGE_S3_ENDPOINT,
    region: env.AFTER_SALES_IMAGE_S3_REGION,
    bucket: env.AFTER_SALES_IMAGE_S3_BUCKET,
    accessKeyId: env.AFTER_SALES_IMAGE_S3_ACCESS_KEY_ID,
    secretAccessKey: env.AFTER_SALES_IMAGE_S3_SECRET_ACCESS_KEY,
    forcePathStyle: env.AFTER_SALES_IMAGE_S3_FORCE_PATH_STYLE,
    prefix: "after-sales",
  });
  if (!storage) {
    logger.info("after-sales attachment storage is disabled");
    return;
  }
  const result = await reconcileAfterSalesAttachments(
    { storage },
    {
      now: new Date(),
      limit: env.AFTER_SALES_ATTACHMENT_CLEANUP_BATCH_SIZE,
      pendingTtlMs: env.AFTER_SALES_ATTACHMENT_PENDING_TTL_MS,
    },
  );
  logger.info(result, "after-sales attachment reconciliation complete");
};

if (require.main === module)
  main().catch((error) => {
    logger.error({ err: error }, "after-sales attachment reconciliation failed");
    process.exit(1);
  });
