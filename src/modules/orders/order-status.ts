import { AppError } from "lib/errors";

export const ORDER_STATUS = {
  PENDING: "PENDING",
  SHIPPING: "SHIPPING",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
} as const;
export type OrderStatus = keyof typeof ORDER_STATUS;
export const ORDER_STATUSES = Object.values(ORDER_STATUS) as [OrderStatus, ...OrderStatus[]];

export const PAYMENT_STATUS = {
  UNPAID: "PAYMENT_UNPAID",
  SUCCESS: "PAYMENT_SUCCESS",
  FAILED: "PAYMENT_FAILED",
} as const;

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ["SHIPPING", "CANCELLED"],
  SHIPPING: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export const canTransition = (from: string, to: OrderStatus) =>
  (TRANSITIONS[from as OrderStatus] ?? []).includes(to);

export const invalidTransition = (from: string, to: string) =>
  new AppError(`Cannot change order from ${from} to ${to}`, 409, "INVALID_STATUS_TRANSITION");
