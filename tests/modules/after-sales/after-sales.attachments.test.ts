jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import sharp from "sharp";
import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { processUploadedImage } from "lib/images/process-uploaded-image";
import { addServiceAttachments } from "modules/after-sales/after-sales.attachments";

beforeEach(resetPrisma);

const pngFile = async () => {
  const buffer = await sharp({
    create: { width: 10, height: 10, channels: 3, background: { r: 255, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
  return {
    buffer,
    size: buffer.length,
    mimetype: "image/png",
    originalname: "screen.png",
  } as Express.Multer.File;
};

describe("after-sales attachments", () => {
  it("normalizes supported images to WebP", async () => {
    const result = await processUploadedImage(await pngFile());
    expect(result).toMatchObject({ mimeType: "image/webp", width: 10, height: 10 });
  });

  it("rejects a file whose bytes are not an image", async () => {
    const file = {
      buffer: Buffer.from("not-an-image"),
      size: 12,
      mimetype: "image/png",
      originalname: "bad.png",
    } as Express.Multer.File;
    await expect(processUploadedImage(file)).rejects.toMatchObject({
      code: "ATTACHMENT_INVALID_FILE",
    });
  });

  it("enforces the per-item active attachment limit", async () => {
    prismaMock.serviceRequestItem.findFirst.mockResolvedValue({
      id: 7,
      serviceRequestId: 9,
      status: "SUBMITTED",
      request: { userId: 11, status: "SUBMITTED" },
      attachments: Array.from({ length: 15 }, (_, id) => ({ id })),
    });
    await expect(
      addServiceAttachments(
        { storage: {} as never },
        { id: 11, role: "USER" },
        9,
        7,
        [await pngFile()],
        "upload-1",
      ),
    ).rejects.toMatchObject({ code: "ATTACHMENT_LIMIT_REACHED" });
  });
});
