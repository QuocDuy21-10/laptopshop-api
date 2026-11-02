const money = (value: number) => value.toLocaleString("vi-VN") + "đ";

export const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

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

export const renderPasswordResetEmail = (input: { code: string; expiresMinutes: number }) => ({
  subject: "Đặt lại mật khẩu LaptopShop",
  text:
    "Mã đặt lại mật khẩu LaptopShop của bạn là " +
    input.code +
    ". Mã hết hạn sau " +
    input.expiresMinutes +
    " phút. Nếu bạn không yêu cầu, hãy bỏ qua email này.",
  html:
    "<p>Mã đặt lại mật khẩu LaptopShop của bạn là <strong>" +
    input.code +
    "</strong>.</p><p>Mã hết hạn sau " +
    input.expiresMinutes +
    " phút.</p><p>Nếu bạn không yêu cầu, hãy bỏ qua email này.</p>",
});

const PRICE_SOURCE_LABELS: Record<string, string> = {
  LIST_PRICE: "Giá niêm yết",
  AUTOMATIC: "Khuyến mãi tự động",
  FLASH_SALE: "Flash Sale",
};

const priceSourceLabel = (source: string) => PRICE_SOURCE_LABELS[source] ?? source;

// e.g. "23:59 22/10/2026 (GMT+7)" in the store's time zone instead of a raw UTC ISO string
export const formatStoreDateTime = (value: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hourCycle: "h23",
    timeZoneName: "shortOffset",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("hour")}:${part("minute")} ${part("day")}/${part("month")}/${part("year")} (${part("timeZoneName")})`;
};

export const renderPriceAlertEmail = (input: {
  productName: string;
  oldPrice: number;
  newPrice: number;
  source: string;
  validUntil: Date | null;
  timeZone: string;
  productUrl: string;
  settingsUrl: string;
}) => {
  const expiry = input.validUntil
    ? formatStoreDateTime(input.validUntil, input.timeZone)
    : "không giới hạn";
  const source = priceSourceLabel(input.source);
  return {
    subject: "Sản phẩm yêu thích vừa giảm giá",
    text:
      input.productName +
      " đã giảm từ " +
      money(input.oldPrice) +
      " xuống " +
      money(input.newPrice) +
      ". Nguồn giá: " +
      source +
      ". Hạn giá: " +
      expiry +
      ". Xem: " +
      input.productUrl +
      ". Quản lý thông báo: " +
      input.settingsUrl,
    html:
      "<p><strong>" +
      escapeHtml(input.productName) +
      "</strong> đã giảm từ <s>" +
      money(input.oldPrice) +
      "</s> xuống <strong>" +
      money(input.newPrice) +
      "</strong>.</p><p>Nguồn giá: " +
      escapeHtml(source) +
      "</p><p>Hạn giá: " +
      escapeHtml(expiry) +
      '</p><p><a href="' +
      escapeHtml(input.productUrl) +
      '">Xem sản phẩm</a></p><p><a href="' +
      escapeHtml(input.settingsUrl) +
      '">Quản lý thông báo</a></p>',
  };
};

export const renderAfterSalesEmail = (input: {
  title: string;
  message: string;
  requestUrl: string;
}) => ({
  subject: input.title,
  text: `${input.message}. Xem yêu cầu: ${input.requestUrl}`,
  html: `<p>${escapeHtml(input.message)}</p><p><a href="${escapeHtml(input.requestUrl)}">Xem yêu cầu hậu mãi</a></p>`,
});

export const renderNewsletterConfirmationEmail = (input: {
  confirmUrl: string;
  unsubscribeUrl: string;
}) => ({
  subject: "Xác nhận đăng ký nhận ưu đãi LaptopShop",
  text:
    "Cảm ơn bạn đã đăng ký nhận ưu đãi từ LaptopShop. Mở liên kết sau để xác nhận: " +
    input.confirmUrl +
    " (liên kết hết hạn sau 24 giờ). Nếu không phải bạn đăng ký, hãy bỏ qua email này. " +
    "Hủy nhận tin: " +
    input.unsubscribeUrl,
  html:
    "<p>Cảm ơn bạn đã đăng ký nhận ưu đãi từ LaptopShop.</p>" +
    '<p><a href="' +
    escapeHtml(input.confirmUrl) +
    '">Xác nhận đăng ký</a></p>' +
    "<p>Liên kết hết hạn sau 24 giờ. Nếu không phải bạn đăng ký, hãy bỏ qua email này.</p>" +
    '<p><a href="' +
    escapeHtml(input.unsubscribeUrl) +
    '">Hủy nhận tin</a></p>',
});
