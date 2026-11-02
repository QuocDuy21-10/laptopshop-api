import { toAdminServiceRequestDto } from "modules/after-sales/after-sales.mapper";

const item = (status: string, quotes: Array<{ status: string }> = []) => ({
  id: 1,
  orderDetailId: 3,
  orderDetail: { id: 3, orderId: 9 },
  position: 0,
  productNameSnapshot: "Laptop",
  deviceLabel: "Máy",
  serialNumber: null,
  issueDescription: "Lỗi",
  coverageAtCreation: "IN_WARRANTY",
  status,
  resolution: null,
  version: 4,
  resolvedAt: null,
  returnedAt: null,
  confirmationDueAt: null,
  customerConfirmedAt: null,
  closedAt: null,
  closeReason: null,
  warrantyVerifications: [],
  quotes: quotes.map((quote, index) => ({
    id: index + 1,
    version: quotes.length - index,
    currency: "VND",
    subtotal: 1,
    total: 1,
    note: null,
    validUntil: new Date(Date.now() + 86_400_000),
    respondedAt: null,
    createdAt: new Date(),
    lines: [],
    ...quote,
  })),
});
const row = (type: string, items: unknown[]) =>
  ({ id: 9, type, items, events: [], followUps: [], customer: null, assignee: null }) as never;

describe("after-sales admin mapper", () => {
  it("lists the transitions an admin may apply to each item", () => {
    const dto = toAdminServiceRequestDto(row("WARRANTY", [item("APPROVED")]));
    expect(dto.items[0].allowedTransitions).toEqual(["AWAITING_ITEM", "CANCELLED"]);
  });

  it("only offers IN_SERVICE after the latest quote was accepted", () => {
    const waiting = toAdminServiceRequestDto(
      row("TECHNICAL_SUPPORT", [item("AWAITING_QUOTE_DECISION", [{ status: "SENT" }])]),
    );
    const accepted = toAdminServiceRequestDto(
      row("TECHNICAL_SUPPORT", [item("AWAITING_QUOTE_DECISION", [{ status: "ACCEPTED" }])]),
    );
    expect(waiting.items[0].allowedTransitions).toEqual(["DIAGNOSING"]);
    expect(accepted.items[0].allowedTransitions).toEqual(["DIAGNOSING", "IN_SERVICE"]);
  });
});
