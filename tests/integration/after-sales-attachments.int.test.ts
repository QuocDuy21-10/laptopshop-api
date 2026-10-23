import sharp from "sharp";
import { prisma } from "config/client";
import { addServiceAttachments } from "modules/after-sales/after-sales.attachments";
import { createServiceRequest } from "modules/after-sales/after-sales.service";
import { createCompletedOrderItem, createProduct, createUser, resetDb } from "./fixtures";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const imageFile = async () => {
  const buffer = await sharp({ create: { width: 10, height: 10, channels: 3, background: "red" } })
    .png()
    .toBuffer();
  return {
    buffer,
    size: buffer.length,
    mimetype: "image/png",
    originalname: "screen.png",
  } as Express.Multer.File;
};

describe("after-sales attachment persistence", () => {
  it("keeps the request and retries a failed storage batch without duplicate ready rows", async () => {
    const user = await createUser();
    const detail = await createCompletedOrderItem(user.id, (await createProduct(1)).id);
    const created = await createServiceRequest(user.id, "attachment-int", {
      type: "TECHNICAL_SUPPORT",
      subject: "Ảnh lỗi",
      items: [{ orderDetailId: detail.id, deviceLabel: "Máy", issueDescription: "Lỗi màn hình" }],
    });
    const itemId = created.request.items[0].id;
    let fail = true;
    const storage = {
      putObject: async () => {
        if (fail) throw new Error("storage down");
      },
      deleteObject: async () => undefined,
      objectExists: async () => true,
      getSignedReadUrl: async (key: string) => `https://storage.test/${key}`,
    };
    const deps = { storage };
    await expect(
      addServiceAttachments(
        deps,
        { id: user.id, role: "USER" },
        created.request.id,
        itemId,
        [await imageFile()],
        "retry-key",
      ),
    ).rejects.toMatchObject({ code: "ATTACHMENT_STORAGE_UNAVAILABLE" });
    expect(await prisma.serviceRequest.count({ where: { id: created.request.id } })).toBe(1);

    fail = false;
    const ready = await addServiceAttachments(
      deps,
      { id: user.id, role: "USER" },
      created.request.id,
      itemId,
      [await imageFile()],
      "retry-key",
    );
    expect(ready).toHaveLength(1);
    expect(
      await prisma.serviceRequestAttachment.count({
        where: { serviceRequestItemId: itemId, status: "READY" },
      }),
    ).toBe(1);
  });
});
