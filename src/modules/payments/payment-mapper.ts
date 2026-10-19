import { Prisma } from "@prisma/client";
import { PaymentInstructions } from "modules/payments/providers/payment-provider";

export const paymentInclude = {
  order: { select: { id: true, userId: true, status: true, paymentStatus: true } },
} satisfies Prisma.PaymentInclude;
export type PaymentRow = Prisma.PaymentGetPayload<{ include: typeof paymentInclude }>;

export const toPaymentDto = (
  payment: PaymentRow,
  instructions: PaymentInstructions | null,
  serverTime: Date,
) => ({
  id: payment.id,
  orderId: payment.orderId,
  provider: payment.provider,
  method: payment.method,
  status: payment.status,
  amount: payment.amount,
  currency: payment.currency,
  expiresAt: payment.expiresAt,
  cancelAfter: payment.cancelAfter,
  paidAt: payment.paidAt,
  serverTime,
  instructions,
});
