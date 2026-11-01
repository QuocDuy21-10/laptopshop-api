import { env } from "config/env";
import { sendEmail, setEmailProvider } from "modules/email-verification/email-verification.service";
import { renderNewsletterConfirmationEmail } from "modules/notifications/notification-template";

describe("renderNewsletterConfirmationEmail", () => {
  const email = renderNewsletterConfirmationEmail({
    confirmUrl: "https://shop.test/newsletter/confirm?token=abc&x=1",
    unsubscribeUrl: "https://shop.test/newsletter/unsubscribe?token=7.sig",
  });

  it("is Vietnamese and contains both links in text and html", () => {
    expect(email.subject).toBe("Xác nhận đăng ký nhận ưu đãi LaptopShop");
    expect(email.text).toContain("https://shop.test/newsletter/confirm?token=abc&x=1");
    expect(email.text).toContain("https://shop.test/newsletter/unsubscribe?token=7.sig");
    expect(email.text).toContain("24 giờ");
    expect(email.text).toContain("bỏ qua email này");
    expect(email.html).toContain('href="https://shop.test/newsletter/confirm?token=abc&amp;x=1"');
    expect(email.html).toContain('href="https://shop.test/newsletter/unsubscribe?token=7.sig"');
  });

  it("escapes html in the urls", () => {
    const evil = renderNewsletterConfirmationEmail({
      confirmUrl: 'https://x.test/"><script>alert(1)</script>',
      unsubscribeUrl: "https://x.test/u",
    });
    expect(evil.html).not.toContain("<script>");
  });
});

describe("sendEmail", () => {
  const original = env.EMAIL_ENABLED;
  afterEach(() => {
    Object.assign(env, { EMAIL_ENABLED: original });
    setEmailProvider(null);
  });

  const input = { to: "a@b.co", subject: "s", html: "<p>h</p>", text: "t", idempotencyKey: "k1" };

  it("delegates to the provider when email is enabled", async () => {
    const send = jest.fn().mockResolvedValue({ providerMessageId: "m1" });
    Object.assign(env, { EMAIL_ENABLED: true });
    setEmailProvider({ send });
    await expect(sendEmail(input)).resolves.toEqual({ providerMessageId: "m1" });
    expect(send).toHaveBeenCalledWith(input);
  });

  it("throws EMAIL_DELIVERY_UNAVAILABLE when email is disabled or has no provider", async () => {
    Object.assign(env, { EMAIL_ENABLED: false });
    setEmailProvider({ send: jest.fn() });
    await expect(sendEmail(input)).rejects.toMatchObject({
      status: 503,
      code: "EMAIL_DELIVERY_UNAVAILABLE",
    });
    Object.assign(env, { EMAIL_ENABLED: true });
    setEmailProvider(null);
    await expect(sendEmail(input)).rejects.toMatchObject({ status: 503 });
  });
});
