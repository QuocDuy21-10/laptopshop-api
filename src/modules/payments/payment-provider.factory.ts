import { env } from "config/env";
import { FakePaymentProvider } from "modules/payments/providers/fake-payment.provider";
import { PaymentProvider } from "modules/payments/providers/payment-provider";
import { SePayPaymentProvider } from "modules/payments/providers/sepay-payment.provider";

const config = () => ({
  webhookSecret: env.SEPAY_WEBHOOK_SECRET ?? "test-webhook-secret",
  apiToken: env.SEPAY_API_TOKEN ?? "test-api-token",
  bankCode: env.SEPAY_BANK_CODE ?? "VCB",
  accountNumber: env.SEPAY_ACCOUNT_NUMBER ?? "0123456789",
  accountName: env.SEPAY_ACCOUNT_NAME ?? "LAPTOP SHOP",
  apiBaseUrl:
    env.SEPAY_MODE === "test"
      ? "https://userapi-sandbox.sepay.vn/v2"
      : "https://userapi.sepay.vn/v2",
});

export const paymentProvider = (): PaymentProvider =>
  env.PAYMENT_PROVIDER === "sepay"
    ? new SePayPaymentProvider(config())
    : new FakePaymentProvider(config());
