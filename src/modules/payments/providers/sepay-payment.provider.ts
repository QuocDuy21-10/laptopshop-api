import crypto from "node:crypto";
import { AppError } from "lib/errors";
import {
  ListTransactionsInput,
  NormalizedPaymentTransaction,
  PaymentInstructions,
  PaymentInstructionInput,
  PaymentProvider,
  VerifyWebhookInput,
} from "modules/payments/providers/payment-provider";

type SePayConfig = {
  webhookSecret: string;
  apiToken: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  apiBaseUrl?: string;
};

const header = (headers: VerifyWebhookInput["headers"], name: string) => {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
};

const invalidSignature = () =>
  new AppError("Invalid webhook signature", 401, "INVALID_WEBHOOK_SIGNATURE");

const parseDate = (value: unknown) => {
  if (typeof value !== "string")
    throw new AppError("Invalid transaction date", 400, "INVALID_WEBHOOK_PAYLOAD");
  const parsed = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}+07:00`);
  if (Number.isNaN(parsed.getTime()))
    throw new AppError("Invalid transaction date", 400, "INVALID_WEBHOOK_PAYLOAD");
  return parsed;
};

const parseTransaction = (data: Record<string, unknown>): NormalizedPaymentTransaction => {
  const eventId = String(data.id ?? "");
  const reference = String(data.referenceCode ?? data.reference_number ?? eventId);
  const amount = Number(data.transferAmount ?? data.amount_in ?? 0);
  if (!eventId || !reference || !Number.isSafeInteger(amount) || amount < 0) {
    throw new AppError("Invalid webhook payload", 400, "INVALID_WEBHOOK_PAYLOAD");
  }
  return {
    providerEventId: eventId,
    providerTransactionKey: reference,
    direction: data.transferType === "out" || data.transfer_type === "out" ? "OUT" : "IN",
    amount,
    currency: "VND",
    transferCode: data.code ? String(data.code) : null,
    accountNumber: data.accountNumber
      ? String(data.accountNumber)
      : data.account_number
        ? String(data.account_number)
        : null,
    occurredAt: parseDate(data.transactionDate ?? data.transaction_date),
  };
};

export class SePayPaymentProvider implements PaymentProvider {
  readonly id: string = "sepay";
  private readonly config: SePayConfig;

  constructor(config: SePayConfig) {
    this.config = config;
  }

  buildInstructions(input: PaymentInstructionInput): PaymentInstructions {
    const url = new URL("https://vietqr.app/img");
    url.searchParams.set("acc", this.config.accountNumber);
    url.searchParams.set("bank", this.config.bankCode);
    url.searchParams.set("amount", String(input.amount));
    url.searchParams.set("des", input.transferCode);
    url.searchParams.set("template", "compact");
    url.searchParams.set("showinfo", "true");
    url.searchParams.set("holder", this.config.accountName);
    url.searchParams.set("store", "LaptopShop");
    return {
      qrImageUrl: url.toString(),
      bankCode: this.config.bankCode,
      accountNumber: this.config.accountNumber,
      accountName: this.config.accountName,
      transferCode: input.transferCode,
    };
  }

  verifyWebhook({
    rawBody,
    headers,
    now = new Date(),
  }: VerifyWebhookInput): NormalizedPaymentTransaction {
    const timestamp = Number(header(headers, "x-sepay-timestamp") ?? 0);
    const signature = header(headers, "x-sepay-signature") ?? "";
    if (!Number.isFinite(timestamp) || Math.abs(now.getTime() / 1000 - timestamp) > 300)
      throw invalidSignature();
    const expected = `sha256=${crypto.createHmac("sha256", this.config.webhookSecret).update(`${timestamp}.${rawBody.toString()}`).digest("hex")}`;
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (
      actualBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(actualBuffer, expectedBuffer)
    )
      throw invalidSignature();
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(rawBody.toString()) as Record<string, unknown>;
    } catch {
      throw new AppError("Invalid webhook payload", 400, "INVALID_WEBHOOK_PAYLOAD");
    }
    return parseTransaction(data);
  }

  async listTransactions({ cursor, limit = 100 }: ListTransactionsInput) {
    const url = new URL(`${this.config.apiBaseUrl ?? "https://userapi.sepay.vn/v2"}/transactions`);
    url.searchParams.set("per_page", String(Math.min(100, Math.max(1, limit))));
    url.searchParams.set("transfer_type", "in");
    if (cursor) url.searchParams.set("since_id", cursor);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.config.apiToken}` },
    });
    if (!response.ok)
      throw new AppError("Payment provider unavailable", 502, "PAYMENT_PROVIDER_UNAVAILABLE");
    const body = (await response.json()) as {
      data?: Record<string, unknown>[];
      meta?: { pagination?: { has_more?: boolean } };
    };
    const items = (body.data ?? []).map(parseTransaction);
    return {
      items,
      cursor:
        items.length && body.meta?.pagination?.has_more ? items.at(-1)!.providerEventId : null,
    };
  }
}
