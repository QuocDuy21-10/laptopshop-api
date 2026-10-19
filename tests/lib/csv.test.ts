import { assertExportSize, toCsv } from "lib/csv";

type Row = { name: string | null; n: number };
const cols = [
  { header: "Tên", value: (r: Row) => r.name },
  { header: "Số", value: (r: Row) => r.n },
];

describe("toCsv", () => {
  it("starts with a BOM and uses CRLF rows", () => {
    expect(toCsv(cols, [{ name: "A", n: 1 }])).toBe("﻿Tên,Số\r\nA,1\r\n");
  });

  it("quotes separators, quotes and line breaks", () => {
    expect(toCsv(cols, [{ name: 'a,"b"\nc', n: 2 }])).toContain('"a,""b""\nc",2');
  });

  it("neutralises cells that a spreadsheet would run as a formula", () => {
    const out = toCsv(cols, [
      { name: "=HYPERLINK(1)", n: -5 },
      { name: "@x", n: 0 },
      { name: "+1", n: 0 },
    ]);
    expect(out).toContain("'=HYPERLINK(1),-5");
    expect(out).toContain("'@x,0");
    expect(out).toContain("'+1,0");
  });

  it("leaves null cells empty", () => {
    expect(toCsv(cols, [{ name: null, n: 3 }])).toContain("\r\n,3\r\n");
  });
});

describe("assertExportSize", () => {
  it("refuses more than 10 000 rows", () => {
    expect(() => assertExportSize(10_000)).not.toThrow();
    expect(() => assertExportSize(10_001)).toThrow(
      expect.objectContaining({ code: "EXPORT_TOO_LARGE", status: 400 }),
    );
  });
});
