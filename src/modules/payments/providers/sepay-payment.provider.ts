import crypto from "node:crypto";
import { AppError } from "lib/errors";
import type { PaymentAuthority } from "modules/payments/payment-authority";
import {
  ListTransactionsInput,
  NormalizedPaymentTransaction,
  PaymentInstructions,
  PaymentInstructionInput,
  PaymentProvider,
  VerifyWebhookInput,
} from "modules/payments/providers/payment-provider";

export type SePayConfig = {
  webhookSecret: string;
  apiToken: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  mode?: "test" | "live";
  timeoutMs?: number;
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
  const referenceValue = data.referenceCode ?? data.reference_number;
  const reference = referenceValue ? String(referenceValue) : eventId;
  const amount = Number(data.transferAmount ?? data.amount_in ?? 0);
  const directionValue = data.transferType ?? data.transfer_type;
  if (
    !eventId ||
    !reference ||
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    (directionValue !== "in" && directionValue !== "out")
  ) {
    throw new AppError("Invalid webhook payload", 400, "INVALID_WEBHOOK_PAYLOAD");
  }
  return {
    providerEventId: eventId,
    providerTransactionKey: reference,
    direction: directionValue === "out" ? "OUT" : "IN",
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
  readonly authority: PaymentAuthority;
  private readonly config: SePayConfig;

  constructor(config: SePayConfig) {
    this.config = config;
    this.authority = { provider: "sepay", mode: config.mode ?? "test" };
  }

  buildInstructions(input: PaymentInstructionInput): PaymentInstructions {
    const url = new URL("https://vietqr.app/img");
    url.searchParams.set("acc", input.accountNumber);
    url.searchParams.set("bank", input.bankCode);
    url.searchParams.set("amount", String(input.amount));
    url.searchParams.set("des", input.transferCode);
    url.searchParams.set("template", "compact");
    url.searchParams.set("showinfo", "true");
    url.searchParams.set("holder", input.accountName);
    url.searchParams.set("store", "LaptopShop");
    return {
      qrImageUrl: url.toString(),
      bankCode: input.bankCode,
      accountNumber: input.accountNumber,
      accountName: input.accountName,
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
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${this.config.apiToken}` },
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 10_000),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"))
        throw new AppError("Payment provider request timed out", 504, "PAYMENT_PROVIDER_TIMEOUT");
      throw new AppError("Payment provider unavailable", 502, "PAYMENT_PROVIDER_UNAVAILABLE");
    }
    if (!response.ok)
      throw new AppError("Payment provider unavailable", 502, "PAYMENT_PROVIDER_UNAVAILABLE");
    const body = (await response.json()) as {
      data?: Record<string, unknown>[];
      meta?: { pagination?: { has_more?: boolean } };
    };
    if (!Array.isArray(body.data) || typeof body.meta?.pagination?.has_more !== "boolean")
      throw new AppError(
        "Invalid payment provider response",
        502,
        "PAYMENT_PROVIDER_INVALID_RESPONSE",
      );
    const items = body.data.map(parseTransaction);
    return {
      items,
      cursor: items.length ? items.at(-1)!.providerEventId : (cursor ?? null),
      hasMore: Boolean(body.meta?.pagination?.has_more),
    };
  }
}
