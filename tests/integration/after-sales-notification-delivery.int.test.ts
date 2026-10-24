import { prisma } from "config/client";
import { createAfterSalesNotification } from "modules/after-sales/after-sales.notifications";
import { createServiceRequest } from "modules/after-sales/after-sales.service";
import { createCompletedOrderItem, createProduct, createUser, resetDb } from "./fixtures";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("after-sales notification delivery integration", () => {
  it("creates consented email delivery and outbox in the same transaction", async () => {
    const user = await createUser();
    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    await prisma.notificationPreference.create({
      data: {
        userId: user.id,
        emailEnabled: true,
        webPushEnabled: false,
        afterSalesEmailEnabled: true,
        afterSalesWebPushEnabled: false,
      },
    });
    const detail = await createCompletedOrderItem(user.id, (await createProduct(1)).id);
    const request = await createServiceRequest(user.id, "delivery-int", {
      type: "TECHNICAL_SUPPORT",
      subject: "Delivery",
      items: [{ orderDetailId: detail.id, deviceLabel: "Máy", issueDescription: "Lỗi" }],
    });

    await prisma.$transaction((tx) =>
      createAfterSalesNotification(tx, {
        event: "ADMIN_STATUS",
        requestId: request.request.id,
        customerId: user.id,
        assigneeId: null,
        type: "AFTER_SALES_STATUS_CHANGED",
        title: "Cập nhật",
        message: "Đã cập nhật",
        dedupeKey: "delivery-int-status",
      }),
    );

    const notification = await prisma.notification.findFirstOrThrow({
      where: { serviceRequestId: request.request.id },
    });
    expect(
      await prisma.notificationDelivery.count({ where: { notificationId: notification.id } }),
    ).toBe(1);
    expect(
      await prisma.outboxEvent.count({ where: { eventType: "NOTIFICATION_DELIVERY_REQUESTED" } }),
    ).toBe(1);
  });

  it("does not create external delivery when after-sales category consent is disabled", async () => {
    const user = await createUser();
    const detail = await createCompletedOrderItem(user.id, (await createProduct(1)).id);
    const request = await createServiceRequest(user.id, "delivery-disabled", {
      type: "TECHNICAL_SUPPORT",
      subject: "Disabled",
      items: [{ orderDetailId: detail.id, deviceLabel: "Máy", issueDescription: "Lỗi" }],
    });
    await prisma.notificationPreference.create({
      data: {
        userId: user.id,
        emailEnabled: true,
        webPushEnabled: false,
        afterSalesEmailEnabled: false,
        afterSalesWebPushEnabled: false,
      },
    });
    await prisma.$transaction((tx) =>
      createAfterSalesNotification(tx, {
        event: "ADMIN_STATUS",
        requestId: request.request.id,
        customerId: user.id,
        assigneeId: null,
        type: "AFTER_SALES_STATUS_CHANGED",
        title: "Cập nhật",
        message: "Đã cập nhật",
        dedupeKey: "delivery-disabled",
      }),
    );
    expect(await prisma.notificationDelivery.count()).toBe(0);
    expect(await prisma.outboxEvent.count()).toBe(0);
  });
});
