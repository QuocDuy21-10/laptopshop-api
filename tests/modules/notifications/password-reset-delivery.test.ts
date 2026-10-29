import { env } from "config/env";
import { createEmailOtp } from "modules/email-verification/email-otp.crypto";
import { processNotificationDelivery } from "modules/notifications/notification-delivery.service";

const KEY = "1".repeat(64);
const original = env.EMAIL_OTP_ENCRYPTION_KEY;
beforeAll(() => Object.assign(env, { EMAIL_OTP_ENCRYPTION_KEY: KEY }));
afterAll(() => Object.assign(env, { EMAIL_OTP_ENCRYPTION_KEY: original }));

const send = async (purpose: "EMAIL_VERIFICATION" | "PASSWORD_RESET") => {
  const otp = createEmailOtp(KEY, "v1");
  const provider = { send: jest.fn().mockResolvedValue({ providerMessageId: "m1" }) };
  const delivery = {
    id: 7,
    channel: "EMAIL",
    status: "PENDING",
    attemptCount: 0,
    destinationKey: "a@b.co",
    destinationSnapshot: null,
    notificationId: null,
    emailVerificationChallengeId: 3,
    emailVerificationChallenge: {
      ...otp,
      email: "a@b.co",
      purpose,
      consumedAt: null,
      invalidatedAt: null,
    },
    preference: null,
    user: null,
    pushSubscription: null,
  };
  await processNotificationDelivery(
    {
      client: {
        notificationDelivery: {
          findUnique: jest.fn().mockResolvedValue(delivery),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      },
      providers: { EMAIL: provider },
      now: new Date("2026-10-29T00:00:00.000Z"),
      leaseOwner: "w",
      maxAttempts: 5,
    } as never,
    7,
  );
  return { call: provider.send.mock.calls[0][0], code: otp.code };
};

describe("email challenge deliveries", () => {
  it("renders the password reset template with the code", async () => {
    const { call, code } = await send("PASSWORD_RESET");
    expect(call.subject).toBe("Đặt lại mật khẩu LaptopShop");
    expect(call.text).toContain(code);
    expect(call.text).toContain("15 phút");
  });

  it("keeps the verification template for verification challenges", async () => {
    const { call } = await send("EMAIL_VERIFICATION");
    expect(call.subject).toBe("Xác minh email LaptopShop");
  });
});
