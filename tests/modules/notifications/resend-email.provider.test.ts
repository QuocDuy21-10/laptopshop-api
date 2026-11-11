import { createResendEmailProvider } from "modules/notifications/providers/resend-email.provider";

const email = {
  to: "user@example.test",
  subject: "Test",
  html: "<p>Test</p>",
  text: "Test",
  idempotencyKey: "delivery-1",
};
const provider = createResendEmailProvider({
  apiKey: "re_test",
  from: "LaptopShop <no-reply@example.test>",
});
const mockFetch = jest.fn();

beforeEach(() => {
  mockFetch.mockReset();
  global.fetch = mockFetch as never;
});

describe("ResendEmailProvider", () => {
  it("posts to Resend with bearer key and idempotency key", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: "msg-1" }) });
    await expect(provider.send(email)).resolves.toEqual({ providerMessageId: "msg-1" });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer re_test",
      "Idempotency-Key": "delivery-1",
    });
    expect(JSON.parse(init.body)).toEqual({
      from: "LaptopShop <no-reply@example.test>",
      to: ["user@example.test"],
      subject: "Test",
      html: "<p>Test</p>",
      text: "Test",
    });
  });

  it.each([429, 500, 503])("marks %i as retryable", async (status) => {
    mockFetch.mockResolvedValue({ ok: false, status });
    await expect(provider.send(email)).rejects.toMatchObject({ retryable: true });
  });

  it.each([401, 403, 422])("marks %i as not retryable", async (status) => {
    mockFetch.mockResolvedValue({ ok: false, status });
    await expect(provider.send(email)).rejects.toMatchObject({ retryable: false });
  });

  it("marks network errors and timeouts as retryable without leaking the key", async () => {
    mockFetch.mockRejectedValue(new Error("boom re_test"));
    const err = await provider.send(email).catch((e) => e);
    expect(err.retryable).toBe(true);
    expect(err.message).not.toContain("re_test");
  });
});
