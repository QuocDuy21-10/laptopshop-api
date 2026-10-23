const money = (value: number) => value.toLocaleString("vi-VN") + "đ";

export const renderEmailVerification = (input: { code: string; expiresMinutes: number }) => ({
  subject: "Xác minh email LaptopShop",
  text:
    "Mã xác minh LaptopShop của bạn là " +
    input.code +
    ". Mã hết hạn sau " +
    input.expiresMinutes +
    " phút.",
  html:
    "<p>Mã xác minh LaptopShop của bạn là <strong>" +
    input.code +
    "</strong>.</p><p>Mã hết hạn sau " +
    input.expiresMinutes +
    " phút.</p>",
});

export const renderPriceAlertEmail = (input: {
  productName: string;
  oldPrice: number;
  newPrice: number;
  source: string;
  validUntil: Date | null;
  productUrl: string;
  settingsUrl: string;
}) => {
  const expiry = input.validUntil ? input.validUntil.toISOString() : "không giới hạn";
  return {
    subject: "Sản phẩm yêu thích vừa giảm giá",
    text:
      input.productName +
      " đã giảm từ " +
      money(input.oldPrice) +
      " xuống " +
      money(input.newPrice) +
      ". Nguồn giá: " +
      input.source +
      ". Hạn giá: " +
      expiry +
      ". Xem: " +
      input.productUrl +
      ". Quản lý thông báo: " +
      input.settingsUrl,
    html:
      "<p><strong>" +
      input.productName +
      "</strong> đã giảm giá.</p><p>Nguồn giá: " +
      input.source +
      '</p><p><a href="' +
      input.productUrl +
      '">Xem sản phẩm</a></p><p><a href="' +
      input.settingsUrl +
      '">Quản lý thông báo</a></p>',
  };
};
