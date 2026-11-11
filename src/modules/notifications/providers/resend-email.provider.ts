import type { EmailProvider } from "modules/notifications/providers/email.provider";

const RESEND_URL = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;

const providerError = (code: string, retryable: boolean) =>
  Object.assign(new Error(code), { code, retryable });

export const createResendEmailProvider = (input: {
  apiKey: string;
  from: string;
}): EmailProvider => ({
  send: async (email) => {
    let res: Response;
    try {
      res = await fetch(RESEND_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": email.idempotencyKey,
        },
        body: JSON.stringify({
          from: input.from,
          to: [email.to],
          subject: email.subject,
          html: email.html,
          text: email.text,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw providerError("EMAIL_PROVIDER_NETWORK_ERROR", true);
    }
    if (!res.ok) {
      throw providerError(
        "EMAIL_PROVIDER_ERROR",
        res.status === 429 || res.status === 408 || res.status >= 500,
      );
    }
    const body = (await res.json().catch(() => null)) as { id?: unknown } | null;
    return { providerMessageId: typeof body?.id === "string" ? body.id : null };
  },
});
