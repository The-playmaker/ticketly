import { describe, expect, it } from "vitest";
import {
  sanitizeSpreadsheetCell,
  sanitizeSpreadsheetRow,
} from "@/lib/security/sanitize-spreadsheet-cell";

describe("sanitizeSpreadsheetCell", () => {
  it("prefixes formula-like strings starting with = + - @", () => {
    expect(sanitizeSpreadsheetCell("=1+1")).toBe("'=1+1");
    expect(sanitizeSpreadsheetCell("+cmd")).toBe("'+cmd");
    expect(sanitizeSpreadsheetCell("-2+3")).toBe("'-2+3");
    expect(sanitizeSpreadsheetCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(sanitizeSpreadsheetCell("\t=HYPERLINK()")).toBe("'\t=HYPERLINK()");
  });

  it("leaves safe values unchanged", () => {
    expect(sanitizeSpreadsheetCell("hello")).toBe("hello");
    expect(sanitizeSpreadsheetCell(42)).toBe(42);
    expect(sanitizeSpreadsheetCell(null)).toBeNull();
    expect(sanitizeSpreadsheetCell("123")).toBe("123");
  });

  it("sanitizes whole rows", () => {
    expect(sanitizeSpreadsheetRow({ name: "=cmd", total: 10 })).toEqual({
      name: "'=cmd",
      total: 10,
    });
  });
});
