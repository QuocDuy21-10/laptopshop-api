export type EmailSendInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
};

export type EmailProvider = {
  send: (input: EmailSendInput) => Promise<{ providerMessageId: string | null }>;
};
