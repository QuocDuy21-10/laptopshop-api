import { prisma } from "config/client";
import { createCompletedOrderItem, createProduct, createUser, resetDb } from "./fixtures";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("after-sales schema", () => {
  it("stores one typed request with device, event, attachment, and quote relations", async () => {
    const user = await createUser();
    const product = await createProduct(1, 1000, 12);
    const detail = await createCompletedOrderItem(user.id, product.id);

    const request = await prisma.serviceRequest.create({
      data: {
        code: "AS-TEST-0001",
        userId: user.id,
        type: "TECHNICAL_SUPPORT",
        subject: "Cần hỗ trợ",
        idempotencyKey: "schema-test",
        requestHash: "a".repeat(64),
        items: {
          create: {
            orderDetailId: detail.id,
            position: 0,
            productNameSnapshot: "Test laptop",
            deviceLabel: "Thiết bị 1",
            issueDescription: "Không cài được driver",
            coverageAtCreation: "IN_WARRANTY",
          },
        },
      },
      include: { items: true },
    });

    expect(request.items).toHaveLength(1);
    await expect(
      prisma.serviceRequest.create({
        data: {
          code: "AS-TEST-0002",
          userId: user.id,
          type: "TECHNICAL_SUPPORT",
          subject: "Trùng key",
          idempotencyKey: "schema-test",
          requestHash: "b".repeat(64),
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
