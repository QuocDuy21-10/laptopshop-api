import { prismaError } from "../helpers/prisma";
import { withPrismaTransactionRetry } from "lib/prisma-retry";

describe("withPrismaTransactionRetry", () => {
  it("retries P2034 twice and returns the third result", async () => {
    const operation = jest
      .fn()
      .mockRejectedValueOnce(prismaError("P2034"))
      .mockRejectedValueOnce(prismaError("P2034"))
      .mockResolvedValue("ok");

    await expect(withPrismaTransactionRetry(operation, 3, async () => {})).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("does not retry validation errors", async () => {
    const error = new Error("invalid receipt");
    const operation = jest.fn().mockRejectedValue(error);
    await expect(withPrismaTransactionRetry(operation, 3, async () => {})).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("rethrows the final P2034 after max attempts", async () => {
    const error = prismaError("P2034");
    const operation = jest.fn().mockRejectedValue(error);
    await expect(withPrismaTransactionRetry(operation, 3, async () => {})).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(3);
  });
});
