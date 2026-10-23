import { prisma } from "config/client";
import {
  cancelMyItem,
  confirmMyItem,
  transitionItem,
} from "modules/after-sales/after-sales.actions";
import { createServiceRequest } from "modules/after-sales/after-sales.service";
import { createCompletedOrderItem, createProduct, createUser, resetDb } from "./fixtures";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("after-sales item lifecycle", () => {
  it("records transitions and closes after customer confirmation", async () => {
    const user = await createUser();
    const detail = await createCompletedOrderItem(user.id, (await createProduct(1)).id);
    const created = await createServiceRequest(user.id, "life-1", {
      type: "TECHNICAL_SUPPORT",
      subject: "Hỗ trợ",
      items: [{ orderDetailId: detail.id, deviceLabel: "Máy", issueDescription: "Lỗi driver" }],
    });
    const itemId = created.request.items[0].id;

    let version = 1;
    await transitionItem({ id: user.id }, created.request.id, itemId, {
      to: "REVIEWING",
      expectedVersion: version++,
    });
    await transitionItem({ id: user.id }, created.request.id, itemId, {
      to: "APPROVED",
      expectedVersion: version++,
    });
    await transitionItem({ id: user.id }, created.request.id, itemId, {
      to: "DIAGNOSING",
      expectedVersion: version++,
    });
    const resolved = await transitionItem({ id: user.id }, created.request.id, itemId, {
      to: "RESOLVED",
      expectedVersion: version,
      resolution: "Đã cài driver",
    });
    expect(resolved.items[0].status).toBe("RESOLVED");
    expect(resolved.status).toBe("AWAITING_CUSTOMER");

    const closed = await confirmMyItem(user.id, created.request.id, itemId);
    expect(closed.items[0].status).toBe("CLOSED");
    expect(closed.status).toBe("CLOSED");
    expect(
      await prisma.serviceRequestEvent.count({ where: { serviceRequestId: created.request.id } }),
    ).toBe(6);
  });

  it("allows only one concurrent admin transition for an item version", async () => {
    const user = await createUser();
    const detail = await createCompletedOrderItem(user.id, (await createProduct(1)).id);
    const created = await createServiceRequest(user.id, "life-2", {
      type: "TECHNICAL_SUPPORT",
      subject: "Hỗ trợ",
      items: [{ orderDetailId: detail.id, deviceLabel: "Máy", issueDescription: "Lỗi driver" }],
    });
    const itemId = created.request.items[0].id;

    const results = await Promise.allSettled([
      transitionItem({ id: user.id }, created.request.id, itemId, {
        to: "REVIEWING",
        expectedVersion: 1,
      }),
      transitionItem({ id: user.id }, created.request.id, itemId, {
        to: "REVIEWING",
        expectedVersion: 1,
      }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(
      results
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => (result.reason as { code: string }).code),
    ).toEqual(["SERVICE_ITEM_VERSION_CONFLICT"]);
  });

  it("blocks customer cancellation after the device is received", async () => {
    const user = await createUser();
    const detail = await createCompletedOrderItem(user.id, (await createProduct(1)).id);
    const created = await createServiceRequest(user.id, "life-3", {
      type: "TECHNICAL_SUPPORT",
      subject: "Hỗ trợ",
      items: [{ orderDetailId: detail.id, deviceLabel: "Máy", issueDescription: "Lỗi driver" }],
    });
    const itemId = created.request.items[0].id;
    await transitionItem({ id: user.id }, created.request.id, itemId, {
      to: "REVIEWING",
      expectedVersion: 1,
    });
    await transitionItem({ id: user.id }, created.request.id, itemId, {
      to: "APPROVED",
      expectedVersion: 2,
    });
    await transitionItem({ id: user.id }, created.request.id, itemId, {
      to: "AWAITING_ITEM",
      expectedVersion: 3,
    });
    await transitionItem({ id: user.id }, created.request.id, itemId, {
      to: "RECEIVED",
      expectedVersion: 4,
    });
    await expect(cancelMyItem(user.id, created.request.id, itemId)).rejects.toMatchObject({
      code: "INVALID_SERVICE_TRANSITION",
    });
  });
});
