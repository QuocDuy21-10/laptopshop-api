import crypto from "node:crypto";
import { SePayPaymentProvider } from "modules/payments/providers/sepay-payment.provider";

const config = {
  webhookSecret: "secret",
  apiToken: "token",
  bankCode: "VCB",
  accountNumber: "0123456789",
  accountName: "LAPTOP SHOP",
};

const body = JSON.stringify({
  id: 92704,
  gateway: "Vietcombank",
  transactionDate: "2026-10-19 11:08:33",
  accountNumber: "0123456789",
  code: "LSABC12345678",
  content: "LSABC12345678 chuyen tien",
  transferType: "in",
  transferAmount: 18500000,
  referenceCode: "FT24012345678",
});

const signedHeaders = (timestamp: number) => ({
  "x-sepay-timestamp": String(timestamp),
  "x-sepay-signature": `sha256=${crypto.createHmac("sha256", config.webhookSecret).update(`${timestamp}.${body}`).digest("hex")}`,
});

describe("SePayPaymentProvider", () => {
  it("builds a dynamic VietQR instruction URL", () => {
    const provider = new SePayPaymentProvider(config);
    const result = provider.buildInstructions({ amount: 18500000, transferCode: "LSABC12345678" });
    const url = new URL(result.qrImageUrl);
    expect(url.origin).toBe("https://vietqr.app");
    expect(url.searchParams.get("acc")).toBe(config.accountNumber);
    expect(url.searchParams.get("bank")).toBe(config.bankCode);
    expect(url.searchParams.get("amount")).toBe("18500000");
    expect(url.searchParams.get("des")).toBe("LSABC12345678");
    expect(result.accountName).toBe(config.accountName);
  });

  it("verifies raw-body HMAC and normalizes an inbound transaction", () => {
    const provider = new SePayPaymentProvider(config);
    const result = provider.verifyWebhook({
      rawBody: Buffer.from(body),
      headers: signedHeaders(Math.floor(Date.now() / 1000)),
      now: new Date(),
    });
    expect(result).toMatchObject({
      providerEventId: "92704",
      providerTransactionKey: "FT24012345678",
      direction: "IN",
      amount: 18500000,
      transferCode: "LSABC12345678",
      accountNumber: "0123456789",
    });
  });

  it("rejects an invalid signature and stale timestamp", () => {
    const provider = new SePayPaymentProvider(config);
    expect(() =>
      provider.verifyWebhook({
        rawBody: Buffer.from(body),
        headers: signedHeaders(Math.floor(Date.now() / 1000) - 301),
        now: new Date(),
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_WEBHOOK_SIGNATURE" }));
    expect(() =>
      provider.verifyWebhook({
        rawBody: Buffer.from(body),
        headers: {
          ...signedHeaders(Math.floor(Date.now() / 1000)),
          "x-sepay-signature": "sha256=bad",
        },
        now: new Date(),
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_WEBHOOK_SIGNATURE" }));
  });
});
