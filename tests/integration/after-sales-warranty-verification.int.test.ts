import { prisma } from "config/client";
import { createWarrantyVerification } from "modules/after-sales/after-sales.warranty-verifications";
import { listMyEligibleDevices } from "modules/after-sales/after-sales.service";
import { createServiceRequest } from "modules/after-sales/after-sales.service";
import { createCompletedOrderItem, createProduct, createUser, resetDb } from "./fixtures";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("after-sales warranty verification", () => {
  it("persists a verification, keeps the order snapshot immutable and reuses the decision", async () => {
    const user = await createUser();
    const detail = await createCompletedOrderItem(user.id, (await createProduct(1)).id);
    await prisma.orderDetail.update({
      where: { id: detail.id },
      data: {
        warrantyMonthsSnapshot: 24,
        warrantyStartAt: new Date("2026-01-01T00:00:00.000Z"),
        warrantyEndAt: new Date("2028-01-01T00:00:00.000Z"),
        warrantyPolicySource: "CURRENT_PRODUCT_POLICY_BACKFILL",
      },
    });
    const first = await createServiceRequest(user.id, "verification-1", {
      type: "WARRANTY",
      subject: "Xác minh bảo hành",
      items: [{ orderDetailId: detail.id, deviceLabel: "Máy", issueDescription: "Lỗi màn hình" }],
    });
    const itemId = first.request.items[0].id;
    const verified = await createWarrantyVerification(user.id, first.request.id, itemId, {
      expectedVersion: 1,
      decision: "IN_WARRANTY",
      warrantyStartAt: new Date("2026-01-01T00:00:00.000Z"),
      warrantyEndAt: new Date("2028-01-01T00:00:00.000Z"),
      note: "Đã đối chiếu hóa đơn",
    });

    expect(verified.items[0].version).toBe(2);
    expect(verified.items[0].warrantyVerification).toMatchObject({ decision: "IN_WARRANTY" });
    expect(await prisma.serviceRequestEvent.count({ where: { kind: "WARRANTY_VERIFIED" } })).toBe(
      1,
    );
    await expect(
      prisma.orderDetail.findUnique({ where: { id: detail.id } }),
    ).resolves.toMatchObject({
      warrantyPolicySource: "CURRENT_PRODUCT_POLICY_BACKFILL",
      warrantyMonthsSnapshot: 24,
    });

    await prisma.serviceRequestItem.update({
      where: { id: itemId },
      data: { status: "CLOSED", closedAt: new Date(), closeReason: "ADMINISTRATIVE" },
    });
    const eligible = await listMyEligibleDevices(user.id, {
      type: "WARRANTY",
      page: 1,
      pageSize: 20,
    });
    expect(eligible.items[0].coverage).toBe("IN_WARRANTY");

    const second = await createServiceRequest(user.id, "verification-2", {
      type: "WARRANTY",
      subject: "Yêu cầu sau xác minh",
      items: [{ orderDetailId: detail.id, deviceLabel: "Máy", issueDescription: "Lỗi mới" }],
    });
    expect(second.request.items[0].coverageAtCreation).toBe("IN_WARRANTY");
  });
});
