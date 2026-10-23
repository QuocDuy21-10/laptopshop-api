import { prisma } from "config/client";
import { createAfterSalesNotification } from "modules/after-sales/after-sales.notifications";
import { createServiceRequest } from "modules/after-sales/after-sales.service";
import { createCompletedOrderItem, createProduct, createUser, resetDb } from "./fixtures";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("after-sales notifications", () => {
  it("creates an in-app notification targeted to the service request", async () => {
    const user = await createUser();
    const detail = await createCompletedOrderItem(user.id, (await createProduct(1)).id);
    const request = await createServiceRequest(user.id, "notification-int", {
      type: "TECHNICAL_SUPPORT",
      subject: "Thông báo",
      items: [{ orderDetailId: detail.id, deviceLabel: "Máy", issueDescription: "Lỗi" }],
    });
    await prisma.$transaction((tx) =>
      createAfterSalesNotification(tx, {
        event: "ADMIN_STATUS",
        requestId: request.request.id,
        customerId: user.id,
        assigneeId: null,
        type: "AFTER_SALES_STATUS_CHANGED",
        title: "Cập nhật hậu mãi",
        message: "Yêu cầu đã được cập nhật",
        dedupeKey: "notification-int-status",
      }),
    );
    await expect(
      prisma.notification.findFirst({ where: { serviceRequestId: request.request.id } }),
    ).resolves.toMatchObject({
      userId: user.id,
      type: "AFTER_SALES_STATUS_CHANGED",
    });
  });
});
