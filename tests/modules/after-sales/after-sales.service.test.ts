jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));
jest.mock("modules/after-sales/after-sales.mapper", () => ({
  toCustomerServiceRequestDto: (row: unknown) => row,
  toEligibleDeviceDto: (row: unknown) => row,
}));

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { AppError } from "lib/errors";
import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { createServiceRequest } from "modules/after-sales/after-sales.service";

beforeEach(resetPrisma);

const input = {
  type: "WARRANTY" as const,
  subject: "Không lên nguồn",
  items: [{ orderDetailId: 3, deviceLabel: "Laptop", issueDescription: "Hỏng" }],
};
const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");

describe("after-sales createServiceRequest", () => {
  it("replays the winner when a concurrent request with the same key loses the device lock", async () => {
    const winner = { id: 42, requestHash: hash };
    prismaMock.serviceRequest.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
    prismaMock.$transaction.mockRejectedValue(
      new AppError("Active after-sales request limit reached", 409, "ACTIVE_DEVICE_LIMIT_REACHED"),
    );
    await expect(createServiceRequest(11, "key-1", input)).resolves.toEqual({
      request: winner,
      created: false,
    });
  });

  it("reports a reused key when the concurrent winner had a different body", async () => {
    prismaMock.serviceRequest.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 42, requestHash: "other" });
    prismaMock.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "test" }),
    );
    await expect(createServiceRequest(11, "key-1", input)).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
    });
  });

  it("keeps the original error when no request owns the key", async () => {
    prismaMock.serviceRequest.findUnique.mockResolvedValue(null);
    prismaMock.$transaction.mockRejectedValue(
      new AppError("Active after-sales request limit reached", 409, "ACTIVE_DEVICE_LIMIT_REACHED"),
    );
    await expect(createServiceRequest(11, "key-1", input)).rejects.toMatchObject({
      code: "ACTIVE_DEVICE_LIMIT_REACHED",
    });
  });
});
