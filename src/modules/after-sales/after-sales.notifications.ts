import type { Prisma } from "@prisma/client";

export type AfterSalesNotificationEvent =
  | "CUSTOMER_MESSAGE"
  | "ADMIN_STATUS"
  | "QUOTE_SENT"
  | "CONFIRMATION_REQUIRED"
  | "INTERNAL_NOTE"
  | "QUOTE_DECISION"
  | "CUSTOMER_CONFIRMATION";

export type AfterSalesNotificationInput = {
  event: AfterSalesNotificationEvent;
  requestId: number;
  customerId: number;
  assigneeId: number | null;
  type:
    | "AFTER_SALES_MESSAGE"
    | "AFTER_SALES_STATUS_CHANGED"
    | "AFTER_SALES_QUOTE_SENT"
    | "AFTER_SALES_CONFIRMATION_REQUIRED"
    | "AFTER_SALES_AUTO_CLOSED";
  title: string;
  message: string;
  dedupeKey: string;
};

export const recipientsFor = (
  input: Pick<AfterSalesNotificationInput, "event" | "customerId" | "assigneeId">,
) => {
  if (input.event === "INTERNAL_NOTE") return [];
  if (["CUSTOMER_MESSAGE", "QUOTE_DECISION", "CUSTOMER_CONFIRMATION"].includes(input.event))
    return input.assigneeId ? [input.assigneeId] : [];
  return [input.customerId];
};

export const createAfterSalesNotification = async (
  tx: Pick<Prisma.TransactionClient, "notification">,
  input: AfterSalesNotificationInput,
) => {
  const recipients = recipientsFor(input);
  await Promise.all(
    recipients.map((userId) =>
      tx.notification.create({
        data: {
          userId,
          serviceRequestId: input.requestId,
          type: input.type,
          title: input.title,
          message: input.message,
          dedupeKey: `${input.dedupeKey}:${userId}`,
        },
      }),
    ),
  );
};
