jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import request from "supertest";
import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { buildApp } from "../../helpers/app";

beforeEach(resetPrisma);

describe("Flash Sale availability route", () => {
  it("accepts a public batch request and rejects userId from query", async () => {
    prismaMock.promotion.findMany.mockResolvedValue([]);

    const response = await request(buildApp()).get(
      "/api/v1/promotions/flash-sales/availability?productIds=1,2",
    );

    expect(response.status).toBe(200);
    expect(response.body.data.items).toEqual([]);
    expect(prismaMock.promotion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ kind: "FLASH_SALE" }) }),
    );
    const withUserId = await request(buildApp()).get(
      "/api/v1/promotions/flash-sales/availability?productIds=1,2&userId=99",
    );
    expect(withUserId.status).toBe(400);
  });
});
