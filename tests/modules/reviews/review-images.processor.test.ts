import sharp from "sharp";
import { processReviewImage } from "modules/reviews/review-images.processor";

const file = (buffer: Buffer, mimetype = "image/png", size = buffer.length) =>
  ({ buffer, mimetype, size }) as Express.Multer.File;

const createImage = async (width: number, height: number, format: "png" | "jpeg" | "webp") =>
  sharp({
    create: { width, height, channels: 3, background: { r: 20, g: 80, b: 120 } },
  })
    [format]()
    .toBuffer();

describe("processReviewImage", () => {
  it.each(["png", "jpeg", "webp"] as const)("normalizes valid %s input to WebP", async (format) => {
    const result = await processReviewImage(
      file(await createImage(80, 40, format), `image/${format}`),
    );
    const metadata = await sharp(result.buffer).metadata();

    expect(result.mimeType).toBe("image/webp");
    expect(metadata.format).toBe("webp");
    expect(result.width).toBe(80);
    expect(result.height).toBe(40);
    expect(result.byteSize).toBe(result.buffer.length);
  });

  it("uses detected bytes instead of trusting a spoofed MIME type", async () => {
    const result = await processReviewImage(file(await createImage(20, 10, "png"), "image/jpeg"));
    expect(result.mimeType).toBe("image/webp");
  });

  it("rejects unsupported bytes even when the MIME claims PNG", async () => {
    await expect(
      processReviewImage(file(Buffer.from("not an image"), "image/png")),
    ).rejects.toMatchObject({
      code: "REVIEW_IMAGE_INVALID_FILE",
    });
  });

  it("rejects input larger than 3 MB before decoding", async () => {
    await expect(
      processReviewImage(file(Buffer.alloc(3 * 1024 * 1024 + 1), "image/png", 3 * 1024 * 1024 + 1)),
    ).rejects.toMatchObject({ code: "REVIEW_IMAGE_TOO_LARGE" });
  });

  it("removes metadata and applies EXIF orientation", async () => {
    const oriented = await sharp(await createImage(2, 1, "jpeg"))
      .withMetadata({ orientation: 6, density: 300 })
      .toBuffer();
    const result = await processReviewImage(file(oriented, "image/jpeg"));
    const metadata = await sharp(result.buffer).metadata();

    expect(result.width).toBe(1);
    expect(result.height).toBe(2);
    expect(metadata.exif).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
  });

  it("does not upscale small images and caps large images at 1600 pixels", async () => {
    const small = await processReviewImage(file(await createImage(100, 50, "png")));
    const large = await processReviewImage(file(await createImage(2000, 1000, "png")));

    expect({ width: small.width, height: small.height }).toEqual({ width: 100, height: 50 });
    expect({ width: large.width, height: large.height }).toEqual({ width: 1600, height: 800 });
  });
});
