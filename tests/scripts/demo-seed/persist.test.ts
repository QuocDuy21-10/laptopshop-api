jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import { buildDemoDataset } from "scripts/demo-seed/build";
import { persistDemoDataset } from "scripts/demo-seed/persist";
import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { ADMIN_ID, BASE_PRODUCTS, NOW } from "./fixtures";

const dataset = buildDemoDataset({
  seed: 20261102,
  now: NOW,
  baseProducts: BASE_PRODUCTS,
  adminId: ADMIN_ID,
  userRoleId: 2,
  firstUserId: 3,
  passwordHash: "hash",
});
const order = (mock: jest.Mock) => mock.mock.invocationCallOrder[0];

describe("persistDemoDataset", () => {
  beforeEach(resetPrisma);

  it("writes parents before children and replaces the opening ledger", async () => {
    await persistDemoDataset(dataset);
    expect(order(prismaMock.stockMovement.deleteMany)).toBeLessThan(
      order(prismaMock.stockMovement.createMany),
    );
    expect(order(prismaMock.product.createMany)).toBeLessThan(order(prismaMock.order.createMany));
    expect(order(prismaMock.user.createMany)).toBeLessThan(order(prismaMock.order.createMany));
    expect(order(prismaMock.promotion.createMany)).toBeLessThan(order(prismaMock.order.createMany));
    expect(order(prismaMock.order.createMany)).toBeLessThan(
      order(prismaMock.orderDetail.createMany),
    );
    expect(order(prismaMock.orderDetail.createMany)).toBeLessThan(
      order(prismaMock.review.createMany),
    );
    expect(order(prismaMock.serviceRequest.createMany)).toBeLessThan(
      order(prismaMock.serviceRequestItem.createMany),
    );
    expect(order(prismaMock.serviceQuote.createMany)).toBeLessThan(
      order(prismaMock.serviceQuoteLine.createMany),
    );
    expect(prismaMock.product.update).toHaveBeenCalledTimes(BASE_PRODUCTS.length);
    expect(prismaMock.order.createMany).toHaveBeenCalledWith({ data: dataset.orders });
  });
});
