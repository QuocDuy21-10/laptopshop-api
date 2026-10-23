import nodemailer from "nodemailer";
import type { EmailProvider } from "modules/notifications/providers/email.provider";

export const createSmtpEmailProvider = (input: {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
}): EmailProvider => {
  const transport = nodemailer.createTransport({
    host: input.host,
    port: input.port,
    secure: input.secure,
    ...(input.user && input.password ? { auth: { user: input.user, pass: input.password } } : {}),
  });
  return {
    send: async (email) => {
      const result = await transport.sendMail({
        from: input.from,
        to: email.to,
        subject: email.subject,
        html: email.html,
        text: email.text,
        headers: { "X-LaptopShop-Idempotency-Key": email.idempotencyKey },
      });
      return { providerMessageId: result.messageId ?? null };
    },
  };
};
