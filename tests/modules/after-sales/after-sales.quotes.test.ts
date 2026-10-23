jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import { prismaMock, resetPrisma } from "../../helpers/prisma";
import {
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
});
