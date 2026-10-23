jest.mock("nodemailer", () => ({ createTransport: jest.fn() }));

import nodemailer from "nodemailer";
import { createSmtpEmailProvider } from "modules/notifications/providers/smtp-email.provider";

describe("SmtpEmailProvider", () => {
  it("sends HTML/text with an idempotency header", async () => {
    const sendMail = jest.fn().mockResolvedValue({ messageId: "mail-1" });
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });
    const provider = createSmtpEmailProvider({
      host: "mailpit",
      port: 1025,
      secure: false,
      from: "LaptopShop <no-reply@laptopshop.test>",
    });

    await expect(
      provider.send({
        to: "user@example.test",
        subject: "Test",
        html: "<p>Test</p>",
        text: "Test",
        idempotencyKey: "delivery-1",
      }),
    ).resolves.toEqual({ providerMessageId: "mail-1" });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "user@example.test",
        headers: { "X-LaptopShop-Idempotency-Key": "delivery-1" },
      }),
    );
  });
});
