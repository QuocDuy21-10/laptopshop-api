import { Response } from "express";
import { AppError } from "lib/errors";
import { toShopDay } from "lib/shop-time";

export const EXPORT_LIMIT = 10_000;

export type CsvColumn<T> = { header: string; value: (row: T) => string | number | null };

// a leading = + - @ tab or CR makes Excel/Sheets evaluate the cell; receiver names come from customers
const FORMULA = /^[=+\-@\t\r]/;

const cell = (v: string | number | null) => {
  if (v === null) return "";
  if (typeof v === "number") return String(v);
  const safe = FORMULA.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

// BOM so Excel opens UTF-8 Vietnamese correctly
export const toCsv = <T>(columns: CsvColumn<T>[], rows: T[]) =>
  "﻿" +
  [columns.map((c) => cell(c.header)), ...rows.map((r) => columns.map((c) => cell(c.value(r))))]
    .map((line) => `${line.join(",")}\r\n`)
    .join("");

// shortcut: the file is built in memory; stream rows if exports ever need more than EXPORT_LIMIT
export const assertExportSize = (count: number) => {
  if (count > EXPORT_LIMIT) {
    throw new AppError("Too many rows; narrow the filters", 400, "EXPORT_TOO_LARGE", {
      limit: EXPORT_LIMIT,
    });
  }
};

export const sendCsv = (res: Response, name: string, body: string) => {
  res.attachment(`${name}-${toShopDay(new Date())}.csv`);
  res.type("text/csv; charset=utf-8");
  res.send(body);
};
