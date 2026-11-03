import { ADMIN_ID, NOW, buildOrderFixture, time } from "./fixtures";
import { SCENARIOS, buildAfterSales, isValidPath } from "scripts/demo-seed/after-sales";
import { SERVICE_REQUEST_STATUSES } from "modules/after-sales/after-sales.types";

const { rng, catalog, orders } = buildOrderFixture(6);
const result = buildAfterSales(rng, {
  now: NOW,
  placed: orders.placed,
  productNames: new Map(catalog.products.map((p) => [p.id, p.name])),
  adminId: ADMIN_ID,
});
const ownerOf = new Map(orders.placed.flatMap((o) => o.lines.map((l) => [l.detailId, o] as const)));

describe("after-sales scenarios", () => {
  it("only uses transitions the service allows", () => {
    SCENARIOS.forEach((scenario) =>
      scenario.items.forEach((steps) => expect(isValidPath(scenario.type, steps)).toBe(true)),
    );
    expect(
      isValidPath("WARRANTY", [{ to: "REVIEWING" }, { to: "APPROVED" }, { to: "DIAGNOSING" }]),
    ).toBe(false);
  });
});

describe("buildAfterSales", () => {
  it("creates 15 requests covering every request status", () => {
    expect(result.serviceRequests).toHaveLength(15);
    expect(new Set(result.serviceRequests.map((r) => r.status))).toEqual(
      new Set(SERVICE_REQUEST_STATUSES),
    );
    expect(new Set(result.serviceRequests.map((r) => r.code)).size).toBe(15);
    result.serviceRequests.forEach((r) => expect(r.code).toMatch(/^AS-\d+-[0-9a-f]{8}$/));
  });

  it("links each item to a distinct completed device of the requester", () => {
    const requestById = new Map(result.serviceRequests.map((r) => [r.id, r]));
    const details = result.serviceRequestItems.map((item) => item.orderDetailId);
    expect(new Set(details).size).toBe(details.length);
    for (const item of result.serviceRequestItems) {
      const request = requestById.get(item.serviceRequestId);
      const order = ownerOf.get(item.orderDetailId);
      expect(order?.status).toBe("COMPLETED");
      expect(order?.userId).toBe(request?.userId);
      expect(time(order?.completedAt)).toBeLessThan(time(request?.createdAt));
      if (request?.type === "WARRANTY") expect(item.coverageAtCreation).toBe("IN_WARRANTY");
    }
    expect(result.serviceRequestItems.some((i) => i.coverageAtCreation === "OUT_OF_WARRANTY")).toBe(
      true,
    );
  });

  it("keeps quotes, verifications and events consistent with now", () => {
    const sent = result.serviceQuotes.filter((q) => q.status === "SENT");
    expect(sent.length).toBeGreaterThan(0);
    sent.forEach((q) => expect(time(q.validUntil)).toBeGreaterThan(NOW.getTime()));
    expect(result.serviceQuotes.map((q) => q.status)).toEqual(
      expect.arrayContaining(["ACCEPTED", "DECLINED"]),
    );
    result.serviceQuotes.forEach((q) => {
      const total = result.serviceQuoteLines
        .filter((l) => l.quoteId === q.id)
        .reduce((s, l) => s + l.lineTotal, 0);
      expect(q.total).toBe(total);
    });
    expect(result.warrantyVerifications.map((v) => v.decision)).toEqual(
      expect.arrayContaining(["IN_WARRANTY", "OUT_OF_WARRANTY"]),
    );
    result.serviceRequestEvents.forEach((e) =>
      expect(time(e.createdAt)).toBeLessThan(NOW.getTime()),
    );
  });
});
