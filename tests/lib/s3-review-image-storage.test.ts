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

import { createS3ObjectStorage } from "lib/storage/s3-object-storage";

const config = (overrides: Record<string, unknown> = {}) => ({
  enabled: true,
  region: "us-east-1",
  bucket: "review-images",
  endpoint: "http://localhost:9000",
  accessKeyId: "minio",
  secretAccessKey: "minio-secret",
  forcePathStyle: true,
  ...overrides,
});

beforeEach(() => {
  send.mockReset();
  getSignedUrl.mockReset();
});

describe("createS3ObjectStorage for review images", () => {
  it("returns null when review images are disabled", () => {
    expect(createS3ObjectStorage(config({ enabled: false }))).toBeNull();
  });

  it("puts WebP bytes with the configured bucket and key", async () => {
    send.mockResolvedValueOnce({});
    const storage = createS3ObjectStorage(config());

    await storage!.putObject({
      key: "reviews/1/a.webp",
      body: Buffer.from("webp"),
      contentLength: 4,
      contentType: "image/webp",
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
    const storage = createS3ObjectStorage(config());

    await expect(storage!.deleteObject("reviews/1/missing.webp")).resolves.toBeUndefined();
  });

  it("maps a missing head object to false", async () => {
    send.mockRejectedValueOnce(
      Object.assign(new Error("missing"), { name: "NotFound", $metadata: { httpStatusCode: 404 } }),
    );
    const storage = createS3ObjectStorage(config());

    await expect(storage!.objectExists("reviews/1/missing.webp")).resolves.toBe(false);
  });

  it("passes the requested TTL when signing a read URL", async () => {
    getSignedUrl.mockResolvedValueOnce("https://signed.example/review.webp");
    const storage = createS3ObjectStorage(config());

    await expect(storage!.getSignedReadUrl("reviews/1/a.webp", 900)).resolves.toBe(
      "https://signed.example/review.webp",
    );
    expect(getSignedUrl).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      expiresIn: 900,
    });
  });
});
