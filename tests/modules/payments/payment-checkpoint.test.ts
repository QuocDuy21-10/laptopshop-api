jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import {
  claimReconciliationLease,
  completeReconciliationCycle,
  failReconciliationCycle,
  renewReconciliationLease,
} from "modules/payments/payment-checkpoint.service";
import { prismaMock, resetPrisma } from "../../helpers/prisma";

const authority = { provider: "sepay" as const, mode: "live" as const };
const now = new Date("2026-10-24T10:00:00.000Z");

beforeEach(resetPrisma);

describe("payment reconciliation checkpoint", () => {
  it("claims an unowned provider-mode lease", async () => {
    prismaMock.paymentProviderCheckpoint.upsert.mockResolvedValue({ id: 7, cursor: "tx-1" });
    prismaMock.paymentProviderCheckpoint.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.paymentProviderCheckpoint.findUnique.mockResolvedValue({ id: 7, cursor: "tx-1" });

    await expect(claimReconciliationLease(authority, "owner-a", now)).resolves.toMatchObject({
      id: 7,
      cursor: "tx-1",
      owner: "owner-a",
    });
    expect(prismaMock.paymentProviderCheckpoint.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 7 }) }),
    );
  });

  it("does not steal a live lease from another owner", async () => {
    prismaMock.paymentProviderCheckpoint.upsert.mockResolvedValue({ id: 7, cursor: null });
    prismaMock.paymentProviderCheckpoint.updateMany.mockResolvedValue({ count: 0 });

    await expect(claimReconciliationLease(authority, "owner-b", now)).resolves.toBeNull();
  });

  it("renews only the current owner and fences completion/failure", async () => {
    prismaMock.paymentProviderCheckpoint.updateMany.mockResolvedValue({ count: 1 });

    await expect(renewReconciliationLease(7, "owner-a", now)).resolves.toBe(true);
    await expect(
      completeReconciliationCycle({
        checkpointId: 7,
        owner: "owner-a",
        cursor: "tx-2",
        verificationBoundary: now,
        processed: 3,
        now,
      }),
    ).resolves.toBe(true);
    await expect(
      failReconciliationCycle({
        checkpointId: 7,
        owner: "owner-a",
        error: "timeout",
        now,
      }),
    ).resolves.toBe(true);
    expect(prismaMock.paymentProviderCheckpoint.updateMany).toHaveBeenCalledTimes(3);
  });
});
