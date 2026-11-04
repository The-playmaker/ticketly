import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

describe("mock complete security", () => {
  const src = readFileSync(
    path.resolve(__dirname, "../../src/app/api/payments/mock/complete/route.ts"),
    "utf8"
  );

  it("requires sessionId to match Payment.providerSessionId", () => {
    expect(src).toContain("providerSessionId");
    expect(src).toContain("SESSION_MISMATCH");
  });

  it("only allows relative redirects starting with / not //", () => {
    expect(src).toContain("safeRelativePath");
    expect(src).toMatch(/startsWith\("\/"\)/);
    expect(src).toContain('startsWith("//")');
  });
});
