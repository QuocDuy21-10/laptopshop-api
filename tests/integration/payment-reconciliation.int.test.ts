import { prisma } from "config/client";
import {
  claimReconciliationLease,
  completeReconciliationCycle,
} from "modules/payments/payment-checkpoint.service";
import { resetDb } from "./fixtures";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("payment reconciliation fencing", () => {
  it("prevents a stale owner from overwriting the newer cursor", async () => {
    const authority = { provider: "sepay" as const, mode: "live" as const };
    const first = await claimReconciliationLease(
      authority,
      "11111111-1111-4111-8111-111111111111",
      new Date("2026-10-24T10:00:00.000Z"),
    );
    const second = await claimReconciliationLease(
      authority,
      "22222222-2222-4222-8222-222222222222",
      new Date("2026-10-24T10:02:00.000Z"),
    );
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();

    await expect(
      completeReconciliationCycle({
        checkpointId: first!.id,
        owner: first!.owner,
        cursor: "stale-cursor",
        verificationBoundary: new Date("2026-10-24T10:00:00.000Z"),
        processed: 1,
        now: new Date("2026-10-24T10:02:01.000Z"),
      }),
    ).resolves.toBe(false);
    await expect(
      completeReconciliationCycle({
        checkpointId: second!.id,
        owner: second!.owner,
        cursor: "fresh-cursor",
        verificationBoundary: new Date("2026-10-24T10:02:00.000Z"),
        processed: 2,
        now: new Date("2026-10-24T10:02:01.000Z"),
      }),
    ).resolves.toBe(true);

    await expect(
      prisma.paymentProviderCheckpoint.findUnique({ where: { id: first!.id } }),
    ).resolves.toMatchObject({
      cursor: "fresh-cursor",
      leaseOwner: null,
    });
  });
});
