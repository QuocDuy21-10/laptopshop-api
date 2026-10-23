import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ObjectStorage, PutObjectInput } from "lib/storage/object-storage";

type S3ObjectStorageConfig = {
  enabled: boolean;
  region?: string;
  endpoint?: string;
  bucket?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
  prefix?: string;
};

const missing = (error: unknown) => {
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    candidate.name === "NoSuchKey" ||
    candidate.name === "NotFound" ||
    candidate.$metadata?.httpStatusCode === 404
  );
};

export const createS3ObjectStorage = (config: S3ObjectStorageConfig): ObjectStorage | null => {
  if (!config.enabled) return null;
  if (!config.region || !config.bucket)
    throw new Error("S3 region and bucket are required when storage is enabled");
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    ...(config.accessKeyId && config.secretAccessKey
      ? {
          credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
        }
      : {}),
  });
  const keyFor = (key: string) =>
    config.prefix ? `${config.prefix.replace(/\/$/, "")}/${key}` : key;
  const bucket = config.bucket;
  return {
    async putObject(input: PutObjectInput) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: keyFor(input.key),
          Body: input.body,
          ContentLength: input.contentLength,
          ContentType: input.contentType ?? "application/octet-stream",
        }),
      );
    },
    async deleteObject(key: string) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: keyFor(key) }));
      } catch (error) {
        if (!missing(error)) throw error;
      }
    },
    async objectExists(key: string) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: keyFor(key) }));
        return true;
      } catch (error) {
        if (missing(error)) return false;
        throw error;
      }
    },
    async getSignedReadUrl(key: string, ttlSeconds: number) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: keyFor(key) }), {
        expiresIn: ttlSeconds,
      });
    },
  };
};
