import { prisma } from "config/client";
import { createServiceRequest } from "modules/after-sales/after-sales.service";
import { createCompletedOrderItem, createProduct, createUser, resetDb } from "./fixtures";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const itemInput = (orderDetailId: number, label: string) => ({
  orderDetailId,
  deviceLabel: label,
  issueDescription: "Không cài được driver",
});

describe("after-sales request creation", () => {
  it("creates one technical-support request across different orders", async () => {
    const user = await createUser();
    const first = await createCompletedOrderItem(user.id, (await createProduct(1, 1000)).id);
    const second = await createCompletedOrderItem(user.id, (await createProduct(1, 1200)).id);

    const result = await createServiceRequest(user.id, "multi-order", {
      type: "TECHNICAL_SUPPORT",
      subject: "Hỗ trợ hai máy",
      items: [itemInput(first.id, "Máy A"), itemInput(second.id, "Máy B")],
    });

    expect(result.created).toBe(true);
    expect(result.request.items.map((item) => item.orderDetailId)).toEqual([first.id, second.id]);
  });

  it("accepts only one concurrent request when one purchased unit remains", async () => {
    const user = await createUser();
    const product = await createProduct(1, 1000);
    const detail = await createCompletedOrderItem(user.id, product.id);

    const results = await Promise.allSettled([
      createServiceRequest(user.id, "concurrent-a", {
        type: "TECHNICAL_SUPPORT",
        subject: "A",
        items: [itemInput(detail.id, "Máy A")],
      }),
      createServiceRequest(user.id, "concurrent-b", {
        type: "TECHNICAL_SUPPORT",
        subject: "B",
        items: [itemInput(detail.id, "Máy B")],
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(
      results
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => (result.reason as { code: string }).code),
    ).toEqual(["ACTIVE_DEVICE_LIMIT_REACHED"]);
  });

  it("replays the same idempotency key and rejects a foreign order detail", async () => {
    const user = await createUser();
    const product = await createProduct(1, 1000);
    const detail = await createCompletedOrderItem(user.id, product.id);
    const first = await createServiceRequest(user.id, "replay", {
      type: "TECHNICAL_SUPPORT",
      subject: "Replay",
      items: [itemInput(detail.id, "Máy")],
    });
    const replay = await createServiceRequest(user.id, "replay", {
      type: "TECHNICAL_SUPPORT",
      subject: "Replay",
      items: [itemInput(detail.id, "Máy")],
    });
    expect(first.request.id).toBe(replay.request.id);
    expect(replay.created).toBe(false);

    const otherUser = await createUser();
    const otherDetail = await createCompletedOrderItem(otherUser.id, product.id);
    await expect(
      createServiceRequest(user.id, "foreign", {
        type: "TECHNICAL_SUPPORT",
        subject: "Foreign",
        items: [itemInput(otherDetail.id, "Máy khác")],
      }),
    ).rejects.toMatchObject({ code: "ORDER_DETAIL_NOT_ELIGIBLE" });
  });
});
