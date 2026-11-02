jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { MAX_DB_INT } from "lib/http";
import { sendQuoteBody } from "modules/after-sales/after-sales.schema";
import {
  decideQuote,
  calculateQuote,
  effectiveQuoteStatus,
  sendQuote,
} from "modules/after-sales/after-sales.quotes";

beforeEach(resetPrisma);

describe("after-sales quotes", () => {
  it("calculates VND totals on the server", () => {
    expect(calculateQuote([{ description: "Công", quantity: 2, unitPrice: 150_000 }])).toEqual({
      subtotal: 300_000,
      total: 300_000,
    });
  });

  it("derives expired status from validUntil", () => {
    expect(
      effectiveQuoteStatus(
        { status: "SENT", validUntil: new Date("2026-01-01T00:00:00.000Z") },
        new Date("2026-02-01T00:00:00.000Z"),
      ),
    ).toBe("EXPIRED");
  });

  it("does not send structured quotes for warranty items", async () => {
    prismaMock.serviceRequestItem.findFirst.mockResolvedValue({
      id: 7,
      serviceRequestId: 9,
      status: "DIAGNOSING",
      version: 2,
      request: { id: 9, type: "WARRANTY", userId: 11 },
      quotes: [],
    });
    await expect(
      sendQuote(2, 9, 7, {
        expectedVersion: 2,
        validDays: 7,
        lines: [{ description: "Công", quantity: 1, unitPrice: 100_000 }],
      }),
    ).rejects.toMatchObject({ code: "SERVICE_REQUEST_TYPE_MISMATCH" });
  });

  it("rejects quote amounts that overflow the INT columns", () => {
    const body = (lines: Array<{ quantity: number; unitPrice: number }>) =>
      sendQuoteBody.safeParse({
        expectedVersion: 1,
        lines: lines.map((line) => ({ description: "Công", ...line })),
      }).success;
    expect(body([{ quantity: 1, unitPrice: MAX_DB_INT }])).toBe(true);
    expect(body([{ quantity: 1, unitPrice: MAX_DB_INT + 1 }])).toBe(false);
    expect(body([{ quantity: 2, unitPrice: 2_000_000_000 }])).toBe(false);
    expect(
      body([
        { quantity: 1, unitPrice: 1_500_000_000 },
        { quantity: 1, unitPrice: 1_500_000_000 },
      ]),
    ).toBe(false);
  });

  it("refuses a quote decision once the item has left AWAITING_QUOTE_DECISION", async () => {
    prismaMock.serviceQuote.findFirst.mockResolvedValue({
      id: 5,
      status: "SENT",
      validUntil: new Date(Date.now() + 86_400_000),
      serviceRequestItemId: 7,
      item: { status: "CLOSED" },
    });
    await expect(decideQuote(11, 9, 7, 5, "ACCEPT")).rejects.toMatchObject({
      code: "INVALID_SERVICE_TRANSITION",
    });
    expect(prismaMock.serviceQuote.updateMany).not.toHaveBeenCalled();
  });
});
