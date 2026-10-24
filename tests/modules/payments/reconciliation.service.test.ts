jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));
jest.mock("config/env", () => ({
  env: {
    SEPAY_MODE: "live",
    PAYMENT_RECONCILIATION_LEASE_MS: 60_000,
    PAYMENT_RECONCILIATION_INTERVAL_MS: 120_000,
  },
}));
jest.mock("modules/payments/payment-provider.factory", () => ({ paymentProvider: jest.fn() }));
jest.mock("modules/payments/payment-ingestion.service", () => ({
  ingestPaymentTransaction: jest.fn(),
}));
jest.mock("modules/payments/payment-checkpoint.service", () => ({
  claimReconciliationLease: jest.fn(),
  completeReconciliationCycle: jest.fn(),
  failReconciliationCycle: jest.fn(),
  renewReconciliationLease: jest.fn(),
}));

import { paymentProvider } from "modules/payments/payment-provider.factory";
import { ingestPaymentTransaction } from "modules/payments/payment-ingestion.service";
import {
  claimReconciliationLease,
  completeReconciliationCycle,
  failReconciliationCycle,
  renewReconciliationLease,
} from "modules/payments/payment-checkpoint.service";
import { reconcilePayments } from "modules/payments/reconciliation.service";

const provider = {
  id: "sepay",
  authority: { provider: "sepay" as const, mode: "live" as const },
  listTransactions: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  (paymentProvider as jest.Mock).mockReturnValue(provider);
  (claimReconciliationLease as jest.Mock).mockResolvedValue({
    id: 7,
    cursor: "tx-1",
    owner: "owner-a",
  });
  (renewReconciliationLease as jest.Mock).mockResolvedValue(true);
  (completeReconciliationCycle as jest.Mock).mockResolvedValue(true);
  (failReconciliationCycle as jest.Mock).mockResolvedValue(true);
  (ingestPaymentTransaction as jest.Mock).mockResolvedValue({
    duplicate: false,
    status: "MATCHED",
  });
});

describe("reconcilePayments", () => {
  it("rejects a provider page that claims more data without advancing its cursor", async () => {
    provider.listTransactions.mockResolvedValue({ items: [], cursor: "tx-1", hasMore: true });

    await expect(reconcilePayments(new Date("2026-10-24T10:00:00.000Z"))).rejects.toMatchObject({
      code: "PAYMENT_RECONCILIATION_CURSOR_STALLED",
    });
    expect(failReconciliationCycle).toHaveBeenCalled();
    expect(completeReconciliationCycle).not.toHaveBeenCalled();
  });

  it("rejects a cursor that repeats an earlier high-water cursor", async () => {
    provider.listTransactions
      .mockResolvedValueOnce({ items: [], cursor: "tx-2", hasMore: true })
      .mockResolvedValueOnce({ items: [], cursor: "tx-1", hasMore: true });

    await expect(reconcilePayments(new Date("2026-10-24T10:00:00.000Z"))).rejects.toMatchObject({
      code: "PAYMENT_RECONCILIATION_CURSOR_STALLED",
    });
    expect(failReconciliationCycle).toHaveBeenCalled();
  });
});
