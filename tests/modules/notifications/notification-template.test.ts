import {
  renderEmailVerification,
  renderPriceAlertEmail,
} from "modules/notifications/notification-template";

describe("notification email templates", () => {
  it("renders OTP with expiry and no provider secrets", () => {
    const result = renderEmailVerification({ code: "123456", expiresMinutes: 10 });
    expect(result.text).toContain("123456");
    expect(result.html).toContain("123456");
    expect(result.text).toContain("10");
  });

  it("renders a price snapshot and settings link", () => {
    const result = renderPriceAlertEmail({
      productName: "Laptop",
      oldPrice: 1_000,
      newPrice: 500,
      source: "FLASH_SALE",
      validUntil: new Date("2026-10-23T01:00:00.000Z"),
      productUrl: "/products/7",
      settingsUrl: "/account/notifications/settings",
    });
    expect(result.text).toContain("Laptop");
    expect(result.text).toContain("/products/7");
    expect(result.text).toContain("/account/notifications/settings");
    expect(result.html).toContain("FLASH_SALE");
  });
});
