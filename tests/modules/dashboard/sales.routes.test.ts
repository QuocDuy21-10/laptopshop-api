jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import request from "supertest";
import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { buildApp } from "../../helpers/app";
import { ADMIN, USER, cookieFor } from "../../helpers/auth";

const get = (qs: string, who = ADMIN) =>
  request(buildApp()).get(`/api/v1/admin/dashboard/sales?${qs}`).set("Cookie", cookieFor(who));

beforeEach(resetPrisma);

describe("GET /api/v1/admin/dashboard/sales", () => {
  it("fills empty days, converts SQL numbers and sums the totals", async () => {
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ day: "2026-10-02", revenue: "300", orders: BigInt(2) }])
      .mockResolvedValueOnce([{ productId: 3, name: "Dell", quantity: "2", revenue: "300" }]);
    const res = await get("from=2026-10-01&to=2026-10-03");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      daily: [
        { date: "2026-10-01", revenue: 0, orders: 0 },
        { date: "2026-10-02", revenue: 300, orders: 2 },
        { date: "2026-10-03", revenue: 0, orders: 0 },
      ],
      topProducts: [{ productId: 3, name: "Dell", quantity: 2, revenue: 300 }],
      totals: { revenue: 300, orders: 2 },
    });
  });

  it("requires both days", async () => {
    expect((await get("from=2026-10-01")).status).toBe(400);
  });

  it("rejects a reversed range", async () => {
    expect((await get("from=2026-10-03&to=2026-10-01")).status).toBe(400);
  });

  it("rejects a range longer than 366 days", async () => {
    expect((await get("from=2025-01-01&to=2026-12-31")).status).toBe(400);
  });

  it("is admin only", async () => {
    expect((await get("from=2026-10-01&to=2026-10-03", USER)).status).toBe(403);
  });
});
