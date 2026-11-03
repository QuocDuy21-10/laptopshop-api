jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import { resetDatabase } from "scripts/demo-seed/reset";
import { prismaMock, resetPrisma } from "../../helpers/prisma";

describe("resetDatabase", () => {
  beforeEach(resetPrisma);

  it("truncates every listed table with foreign key checks off on one connection", async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ name: "orders" }, { name: "users" }]);
    await expect(resetDatabase()).resolves.toBe(2);
    expect(prismaMock.$executeRawUnsafe.mock.calls.map(([sql]: [string]) => sql)).toEqual([
      "SET FOREIGN_KEY_CHECKS = 0",
      "TRUNCATE TABLE `orders`",
      "TRUNCATE TABLE `users`",
      "SET FOREIGN_KEY_CHECKS = 1",
    ]);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });
});
