jest.mock("modules/after-sales/after-sales.notifications", () => ({
  createAfterSalesNotification: jest.fn().mockRejectedValue(new Error("delivery down")),
}));

import { prisma } from "config/client";
import { addPublicMessage } from "modules/after-sales/after-sales.events";
import { createServiceRequest } from "modules/after-sales/after-sales.service";
import { createCompletedOrderItem, createProduct, createUser, resetDb } from "./fixtures";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("after-sales event atomicity", () => {
  it("rolls back a public event when notification publishing fails", async () => {
    const user = await createUser();
    const detail = await createCompletedOrderItem(user.id, (await createProduct(1)).id);
    const request = await createServiceRequest(user.id, "event-atomic", {
      type: "TECHNICAL_SUPPORT",
      subject: "Atomic",
      items: [{ orderDetailId: detail.id, deviceLabel: "Máy", issueDescription: "Lỗi" }],
    });
    await expect(
      addPublicMessage({ id: user.id, role: "USER" }, request.request.id, { body: "Xin chào" }),
    ).rejects.toThrow("delivery down");
    expect(
      await prisma.serviceRequestEvent.count({
        where: { serviceRequestId: request.request.id, kind: "PUBLIC_MESSAGE" },
      }),
    ).toBe(0);
  });
});
