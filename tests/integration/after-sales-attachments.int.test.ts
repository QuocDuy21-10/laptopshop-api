import sharp from "sharp";
import { prisma } from "config/client";
import {
  addServiceAttachments,
  listServiceAttachments,
  redactServiceAttachment,
} from "modules/after-sales/after-sales.attachments";
import { cleanupServiceAttachment } from "modules/after-sales/after-sales-attachment-cleanup";
import { createServiceRequest } from "modules/after-sales/after-sales.service";
import { createCompletedOrderItem, createProduct, createUser, resetDb } from "./fixtures";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const imageFile = async (background: string = "red") => {
  const buffer = await sharp({ create: { width: 10, height: 10, channels: 3, background } })
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

  it("does not re-upload a ready batch for the same key and rejects a different payload", async () => {
    const user = await createUser();
    const detail = await createCompletedOrderItem(user.id, (await createProduct(1)).id);
    const created = await createServiceRequest(user.id, "attachment-idempotency", {
      type: "TECHNICAL_SUPPORT",
      subject: "Idempotency",
      items: [{ orderDetailId: detail.id, deviceLabel: "Máy", issueDescription: "Lỗi" }],
    });
    const itemId = created.request.items[0].id;
    let putCalls = 0;
    const storage = {
      putObject: async () => {
        putCalls += 1;
      },
      deleteObject: async () => undefined,
      objectExists: async () => true,
      getSignedReadUrl: async (key: string) => `https://storage.test/${key}`,
    };
    const deps = { storage };
    await addServiceAttachments(
      deps,
      { id: user.id, role: "USER" },
      created.request.id,
      itemId,
      [await imageFile("red")],
      "same-key",
    );
    await addServiceAttachments(
      deps,
      { id: user.id, role: "USER" },
      created.request.id,
      itemId,
      [await imageFile("red")],
      "same-key",
    );
    expect(putCalls).toBe(1);
    await expect(
      addServiceAttachments(
        deps,
        { id: user.id, role: "USER" },
        created.request.id,
        itemId,
        [await imageFile("blue")],
        "same-key",
      ),
    ).rejects.toMatchObject({ code: "ATTACHMENT_IDEMPOTENCY_CONFLICT" });
  });

  it("serializes concurrent reservations so the active limit cannot be exceeded", async () => {
    const user = await createUser();
    const detail = await createCompletedOrderItem(user.id, (await createProduct(1)).id);
    const created = await createServiceRequest(user.id, "attachment-limit-race", {
      type: "TECHNICAL_SUPPORT",
      subject: "Limit race",
      items: [{ orderDetailId: detail.id, deviceLabel: "Máy", issueDescription: "Lỗi" }],
    });
    const itemId = created.request.items[0].id;
    await prisma.serviceRequestAttachment.createMany({
      data: Array.from({ length: 13 }, (_, index) => ({
        serviceRequestId: created.request.id,
        serviceRequestItemId: itemId,
        uploadedById: user.id,
        objectKey: `seed/${index}.webp`,
        mimeType: "image/webp",
        byteSize: 10,
        width: 10,
        height: 10,
        status: "READY" as const,
      })),
    });
    const storage = {
      putObject: async () => new Promise<void>((resolve) => setTimeout(resolve, 25)),
      deleteObject: async () => undefined,
      objectExists: async () => true,
      getSignedReadUrl: async (key: string) => `https://storage.test/${key}`,
    };
    const results = await Promise.allSettled([
      addServiceAttachments(
        { storage },
        { id: user.id, role: "USER" },
        created.request.id,
        itemId,
        [await imageFile("red"), await imageFile("red")],
        "race-a",
      ),
      addServiceAttachments(
        { storage },
        { id: user.id, role: "USER" },
        created.request.id,
        itemId,
        [await imageFile("blue"), await imageFile("blue")],
        "race-b",
      ),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(
      results
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => (result.reason as { code: string }).code),
    ).toEqual(["ATTACHMENT_LIMIT_REACHED"]);
    expect(
      await prisma.serviceRequestAttachment.count({
        where: {
          serviceRequestItemId: itemId,
          deletedAt: null,
          status: { in: ["PENDING", "READY"] },
        },
      }),
    ).toBe(15);
  });

  it("lists ready images and redacts them through a cleanup outbox", async () => {
    const user = await createUser();
    const detail = await createCompletedOrderItem(user.id, (await createProduct(1)).id);
    const created = await createServiceRequest(user.id, "attachment-redact", {
      type: "TECHNICAL_SUPPORT",
      subject: "Redact",
      items: [{ orderDetailId: detail.id, deviceLabel: "Máy", issueDescription: "Lỗi" }],
    });
    const itemId = created.request.items[0].id;
    const deleted: string[] = [];
    const storage = {
      putObject: async () => undefined,
      deleteObject: async (key: string) => {
        deleted.push(key);
      },
      objectExists: async () => true,
      getSignedReadUrl: async (key: string) => `https://storage.test/${key}`,
    };
    const uploaded = await addServiceAttachments(
      { storage },
      { id: user.id, role: "USER" },
      created.request.id,
      itemId,
      [await imageFile()],
      "redact-key",
    );
    expect(
      await listServiceAttachments(
        { storage },
        { id: user.id, role: "USER" },
        created.request.id,
        itemId,
      ),
    ).toHaveLength(1);
    await redactServiceAttachment(
      { id: user.id, role: "USER" },
      created.request.id,
      uploaded[0].id,
      "Không còn cần ảnh",
    );
    expect(await prisma.serviceRequestEvent.count({ where: { kind: "ATTACHMENT_REDACTED" } })).toBe(
      1,
    );
    expect(
      await prisma.outboxEvent.count({
        where: { eventType: "AFTER_SALES_ATTACHMENT_DELETE_REQUESTED" },
      }),
    ).toBe(1);
    await expect(cleanupServiceAttachment({ storage }, uploaded[0].id)).resolves.toBe("deleted");
    expect(deleted).toHaveLength(1);
    expect(
      await listServiceAttachments(
        { storage },
        { id: user.id, role: "USER" },
        created.request.id,
        itemId,
      ),
    ).toHaveLength(0);
  });
});
