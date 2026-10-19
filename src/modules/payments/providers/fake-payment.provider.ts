import { SePayPaymentProvider } from "modules/payments/providers/sepay-payment.provider";

export class FakePaymentProvider extends SePayPaymentProvider {
  readonly id = "fake";
}
