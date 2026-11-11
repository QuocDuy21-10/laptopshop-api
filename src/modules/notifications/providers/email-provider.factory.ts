import { env } from "config/env";
import type { EmailProvider } from "modules/notifications/providers/email.provider";
import { createSmtpEmailProvider } from "modules/notifications/providers/smtp-email.provider";
import { createResendEmailProvider } from "modules/notifications/providers/resend-email.provider";

export const createEmailProviderFromEnv = (): EmailProvider | null => {
  if (!env.EMAIL_ENABLED) return null;
  if (env.EMAIL_PROVIDER === "http")
    return createResendEmailProvider({ apiKey: env.RESEND_API_KEY!, from: env.EMAIL_FROM });
  return createSmtpEmailProvider({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    user: env.SMTP_USER,
    password: env.SMTP_PASSWORD,
    from: env.EMAIL_FROM,
  });
};
