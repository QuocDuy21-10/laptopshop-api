export type PaymentInstructionInput = {
  amount: number;
  transferCode: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
};

export type PaymentInstructions = {
  qrImageUrl: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  transferCode: string;
};

export type NormalizedPaymentTransaction = {
  providerEventId: string;
  providerTransactionKey: string;
  direction: "IN" | "OUT";
  amount: number;
  currency: string;
  transferCode: string | null;
  accountNumber: string | null;
  occurredAt: Date;
};

export type VerifyWebhookInput = {
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
  now?: Date;
};

export type ListTransactionsInput = { cursor?: string | null; limit?: number };

export interface PaymentProvider {
  readonly id: string;
  buildInstructions(input: PaymentInstructionInput): PaymentInstructions;
  verifyWebhook(input: VerifyWebhookInput): NormalizedPaymentTransaction;
  listTransactions(input: ListTransactionsInput): Promise<{
    items: NormalizedPaymentTransaction[];
    cursor: string | null;
    hasMore: boolean;
  }>;
}
