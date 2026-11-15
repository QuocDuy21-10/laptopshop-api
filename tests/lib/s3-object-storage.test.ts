import { Readable } from "stream";

const send = jest.fn();

jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send })),
  PutObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
  DeleteObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
  HeadObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
  GetObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

import { createS3ObjectStorage } from "lib/storage/s3-object-storage";

const media = () =>
  createS3ObjectStorage({ enabled: true, region: "auto", bucket: "laptopshop-media" })!;

beforeEach(() => send.mockReset());

describe("S3 object storage", () => {
  it("returns null when image storage is disabled", () => {
    expect(createS3ObjectStorage({ enabled: false })).toBeNull();
  });

  it("streams an object with its metadata", async () => {
    const body = Readable.from([Buffer.from("webp")]);
    send.mockResolvedValue({
      Body: body,
      ContentType: "image/webp",
      ContentLength: 4,
      ETag: '"abc"',
    });
    await expect(media().getObject("images/product/a.webp")).resolves.toEqual({
      body,
      contentType: "image/webp",
      contentLength: 4,
      etag: '"abc"',
    });
    expect(send.mock.calls[0][0].input).toEqual({
      Bucket: "laptopshop-media",
      Key: "images/product/a.webp",
    });
  });

  it("returns null for a missing object", async () => {
    send.mockRejectedValue(Object.assign(new Error("missing"), { name: "NoSuchKey" }));
    await expect(media().getObject("images/x.webp")).resolves.toBeNull();
  });

  it("rethrows other storage errors", async () => {
    send.mockRejectedValue(new Error("boom"));
    await expect(media().getObject("images/x.webp")).rejects.toThrow("boom");
  });
});
