import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Env } from "config/env";
import type { ReviewImageStorage } from "lib/storage/review-image-storage";

const isMissingObject = (error: unknown) => {
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    candidate.name === "NoSuchKey" ||
    candidate.name === "NotFound" ||
    candidate.$metadata?.httpStatusCode === 404
  );
};

export const createReviewImageStorage = (config: Env): ReviewImageStorage | null => {
  if (!config.REVIEW_IMAGES_ENABLED) return null;
  const client = new S3Client({
    region: config.REVIEW_IMAGE_S3_REGION!,
    endpoint: config.REVIEW_IMAGE_S3_ENDPOINT,
    forcePathStyle: config.REVIEW_IMAGE_S3_FORCE_PATH_STYLE,
    ...(config.REVIEW_IMAGE_S3_ACCESS_KEY_ID && config.REVIEW_IMAGE_S3_SECRET_ACCESS_KEY
      ? {
          credentials: {
            accessKeyId: config.REVIEW_IMAGE_S3_ACCESS_KEY_ID,
            secretAccessKey: config.REVIEW_IMAGE_S3_SECRET_ACCESS_KEY,
          },
        }
      : {}),
  });
  const bucket = config.REVIEW_IMAGE_S3_BUCKET!;

  return {
    async putObject({ key, body, contentLength }) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: "image/webp",
          ContentLength: contentLength,
        }),
      );
    },
    async deleteObject(key) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      } catch (error) {
        if (!isMissingObject(error)) throw error;
      }
    },
    async objectExists(key) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
      } catch (error) {
        if (isMissingObject(error)) return false;
        throw error;
      }
    },
    async getSignedReadUrl(key, ttlSeconds) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
        expiresIn: ttlSeconds,
      });
    },
  };
};
