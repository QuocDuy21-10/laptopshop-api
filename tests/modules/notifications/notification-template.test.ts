import {
  formatStoreDateTime,
  renderEmailVerification,
  renderAfterSalesEmail,
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
      timeZone: "Asia/Ho_Chi_Minh",
      productUrl: "/products/7",
      settingsUrl: "/account/notifications/settings",
    });
    expect(result.text).toContain("Laptop");
    expect(result.text).toContain("/products/7");
    expect(result.text).toContain("/account/notifications/settings");
    expect(result.html).toContain("Flash Sale");
  });

  it("shows old/new VND prices and the store-local validity in the HTML body", () => {
    const result = renderPriceAlertEmail({
      productName: "Laptop",
      oldPrice: 10_000_000,
      newPrice: 9_000_000,
      source: "AUTOMATIC",
      validUntil: new Date("2026-10-22T16:59:00.000Z"),
      timeZone: "Asia/Ho_Chi_Minh",
      productUrl: "https://shop.example/products/7",
      settingsUrl: "https://shop.example/account/notifications/settings",
    });
    for (const body of [result.html, result.text]) {
      expect(body).toContain("10.000.000đ");
      expect(body).toContain("9.000.000đ");
      expect(body).toContain("Khuyến mãi tự động");
      expect(body).toContain("23:59 22/10/2026 (GMT+7)");
      expect(body).not.toContain("2026-10-22T16:59");
    }
  });

  it("formats the validity in the configured time zone", () => {
    const at = new Date("2026-10-22T16:59:00.000Z");
    expect(formatStoreDateTime(at, "UTC")).toMatch(/^16:59 22\/10\/2026 \(GMT/);
    expect(formatStoreDateTime(at, "Asia/Bangkok")).toBe("23:59 22/10/2026 (GMT+7)");
  });

  it("escapes the product name in price alert HTML", () => {
    const result = renderPriceAlertEmail({
      productName: "<b>Laptop</b>",
      oldPrice: 1_000,
      newPrice: 500,
      source: "AUTOMATIC",
      validUntil: null,
      timeZone: "Asia/Ho_Chi_Minh",
      productUrl: "https://shop.example/products/7",
      settingsUrl: "https://shop.example/account/notifications/settings",
    });
    expect(result.html).not.toContain("<b>Laptop");
    expect(result.html).toContain("&lt;b&gt;Laptop");
  });

  it("escapes after-sales message HTML and uses an absolute request URL", () => {
    const result = renderAfterSalesEmail({
      title: "Cập nhật",
      message: '<img src=x onerror="alert(1)">',
      requestUrl: "https://shop.example/account/after-sales/9",
    });
    expect(result.html).not.toContain("<img");
    expect(result.html).toContain("&lt;img");
    expect(result.html).toContain("https://shop.example/account/after-sales/9");
    expect(result.text).toContain('<img src=x onerror="alert(1)">');
  });
});
