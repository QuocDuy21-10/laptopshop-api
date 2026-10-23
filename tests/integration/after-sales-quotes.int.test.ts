import { prisma } from "config/client";
import { transitionItem } from "modules/after-sales/after-sales.actions";
import { createServiceRequest } from "modules/after-sales/after-sales.service";
import { decideQuote, sendQuote } from "modules/after-sales/after-sales.quotes";
import { createCompletedOrderItem, createProduct, createUser, resetDb } from "./fixtures";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("after-sales quotes", () => {
  it("sends and independently accepts a technical-support quote", async () => {
    const user = await createUser();
    const detail = await createCompletedOrderItem(user.id, (await createProduct(1)).id);
    const created = await createServiceRequest(user.id, "quote-int", {
      type: "TECHNICAL_SUPPORT",
      subject: "Báo giá",
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
      to: "DIAGNOSING",
      expectedVersion: 3,
    });
    const sent = await sendQuote(user.id, created.request.id, itemId, {
      expectedVersion: 4,
      validDays: 7,
      lines: [{ description: "Cài driver", quantity: 2, unitPrice: 150_000 }],
    });
    expect(sent.items[0].status).toBe("AWAITING_QUOTE_DECISION");
    const quoteId = sent.items[0].quotes[0].id;
    const accepted = await decideQuote(user.id, created.request.id, itemId, quoteId, "ACCEPT");
    expect(accepted.items[0].quotes[0].status).toBe("ACCEPTED");
    expect(await prisma.payment.count()).toBe(0);
  });
});
