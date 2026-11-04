/**
 * Neutralize CSV/XLSX formula injection (=, +, -, @, tab/CR) per OWASP.
 * Prefix with a single quote so spreadsheet apps treat the value as text.
 */
export function sanitizeSpreadsheetCell(value: unknown): string | number | null {
  if (value == null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return String(value);
    return value;
  }
  if (typeof value === "boolean") return value ? "true" : "false";

  let s = String(value);
  // Strip dangerous leading characters / whitespace that Excel interprets
  if (/^[\t\r\n ]*[=+\-@]/.test(s)) {
    s = `'${s}`;
  }
  return s;
}

export function sanitizeSpreadsheetRow(
  row: Record<string, string | number | null | undefined>
): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = sanitizeSpreadsheetCell(v);
  }
  return out;
}
