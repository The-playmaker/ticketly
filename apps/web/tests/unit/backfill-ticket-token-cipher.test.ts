import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

describe("backfill-ticket-token-cipher script", () => {
  const script = readFileSync(
    path.resolve(__dirname, "../../../../scripts/backfill-ticket-token-cipher.ts"),
    "utf8"
  );
  const docs = readFileSync(
    path.resolve(__dirname, "../../../../docs/TICKET_SECURITY.md"),
    "utf8"
  );

  it("is dry-run by default and idempotent (skip existing hash/cipher)", () => {
    expect(script).toContain("--dry-run");
    expect(script).toContain("--apply");
    expect(script).toContain("tokenHash: null");
    expect(script).toContain("tokenCipher: null");
    expect(script).toContain("Does NOT remove the check-in secureToken fallback");
  });

  it("is documented in TICKET_SECURITY.md", () => {
    expect(docs).toContain("backfill-ticket-token-cipher");
  });
});
