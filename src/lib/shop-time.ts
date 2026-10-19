import { AppError } from "lib/errors";

// shop days are Vietnam days (UTC+7, no DST); timestamps are stored in UTC
export const SHOP_UTC_OFFSET = "+07:00";
export const DAY_MS = 86_400_000;
const OFFSET_MS = 7 * 3_600_000;

export const dayStart = (day: string) => new Date(`${day}T00:00:00${SHOP_UTC_OFFSET}`);
// exclusive upper bound: the first instant of the next shop day
export const dayEnd = (day: string) => new Date(dayStart(day).getTime() + DAY_MS);

const shifted = (d: Date) => new Date(d.getTime() + OFFSET_MS).toISOString();
export const toShopDay = (d: Date) => shifted(d).slice(0, 10);
export const formatShopDateTime = (d: Date) => shifted(d).slice(0, 16).replace("T", " ");

export const assertDayRange = (from?: string, to?: string, maxDays?: number) => {
  if (!from || !to) return;
  if (from > to) {
    throw new AppError("from must not be after to", 400, "VALIDATION_ERROR", [
      { path: "from", message: "must not be after to" },
    ]);
  }
  if (maxDays && (dayEnd(to).getTime() - dayStart(from).getTime()) / DAY_MS > maxDays) {
    throw new AppError(`Range must not exceed ${maxDays} days`, 400, "VALIDATION_ERROR", [
      { path: "to", message: `range must not exceed ${maxDays} days` },
    ]);
  }
};

export const createdAtRange = (from?: string, to?: string) =>
  from || to
    ? {
        createdAt: {
          ...(from ? { gte: dayStart(from) } : {}),
          ...(to ? { lt: dayEnd(to) } : {}),
        },
      }
    : {};
