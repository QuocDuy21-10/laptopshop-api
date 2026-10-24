import { SePayPaymentProvider } from "modules/payments/providers/sepay-payment.provider";
import type { SePayConfig } from "modules/payments/providers/sepay-payment.provider";
import type { PaymentAuthority } from "modules/payments/payment-authority";

export class FakePaymentProvider extends SePayPaymentProvider {
  readonly id = "fake";

  readonly authority: PaymentAuthority = { provider: "fake", mode: "test" };

  constructor(config: SePayConfig) {
    super({ ...config, mode: "test" });
  }
}
