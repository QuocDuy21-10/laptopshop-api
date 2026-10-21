const send = jest.fn();
const getSignedUrl = jest.fn();

jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send })),
  PutObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
  DeleteObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
  HeadObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
  GetObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

jest.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl }));

import { parseEnv, type Env } from "config/env";
import { createReviewImageStorage } from "lib/storage/s3-review-image-storage";

const config = (overrides: Record<string, unknown> = {}): Env =>
  parseEnv({
    NODE_ENV: "test",
    DATABASE_URL: "mysql://u:p@localhost:3306/db",
    JWT_SECRET: "x".repeat(16),
    REVIEW_IMAGES_ENABLED: "true",
    REVIEW_IMAGE_S3_REGION: "us-east-1",
    REVIEW_IMAGE_S3_BUCKET: "review-images",
    REVIEW_IMAGE_S3_ENDPOINT: "http://localhost:9000",
    REVIEW_IMAGE_S3_ACCESS_KEY_ID: "minio",
    REVIEW_IMAGE_S3_SECRET_ACCESS_KEY: "minio-secret",
    REVIEW_IMAGE_S3_FORCE_PATH_STYLE: "true",
    ...overrides,
  });

beforeEach(() => {
  send.mockReset();
  getSignedUrl.mockReset();
});

describe("createReviewImageStorage", () => {
  it("returns null when review images are disabled", () => {
    expect(createReviewImageStorage(config({ REVIEW_IMAGES_ENABLED: "false" }))).toBeNull();
  });

  it("puts WebP bytes with the configured bucket and key", async () => {
    send.mockResolvedValueOnce({});
    const storage = createReviewImageStorage(config());

    await storage!.putObject({
      key: "reviews/1/a.webp",
      body: Buffer.from("webp"),
      contentLength: 4,
    });

    expect(send).toHaveBeenCalledWith({
      input: {
        Bucket: "review-images",
        Key: "reviews/1/a.webp",
        Body: Buffer.from("webp"),
        ContentType: "image/webp",
        ContentLength: 4,
      },
    });
  });

  it("treats a missing object as an idempotent delete", async () => {
    send.mockRejectedValueOnce(Object.assign(new Error("missing"), { name: "NoSuchKey" }));
    const storage = createReviewImageStorage(config());

    await expect(storage!.deleteObject("reviews/1/missing.webp")).resolves.toBeUndefined();
  });

  it("maps a missing head object to false", async () => {
    send.mockRejectedValueOnce(
      Object.assign(new Error("missing"), { name: "NotFound", $metadata: { httpStatusCode: 404 } }),
    );
    const storage = createReviewImageStorage(config());

    await expect(storage!.objectExists("reviews/1/missing.webp")).resolves.toBe(false);
  });

  it("passes the requested TTL when signing a read URL", async () => {
    getSignedUrl.mockResolvedValueOnce("https://signed.example/review.webp");
    const storage = createReviewImageStorage(config());

    await expect(storage!.getSignedReadUrl("reviews/1/a.webp", 900)).resolves.toBe(
      "https://signed.example/review.webp",
    );
    expect(getSignedUrl).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      expiresIn: 900,
    });
  });
});
