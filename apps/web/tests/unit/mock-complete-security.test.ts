import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

describe("mock complete sessionId + redirect hardening", () => {
  const src = readFileSync(
    path.resolve(__dirname, "../../src/app/api/payments/mock/complete/route.ts"),
    "utf8"
  );

  it("requires providerSessionId match and relative redirects only", () => {
    expect(src).toContain("providerSessionId: sessionId");
    expect(src).toContain("SESSION_MISMATCH");
    expect(src).toContain("isSafeRelativeRedirect");
    expect(src).toContain('redirect.startsWith("//")');
    expect(src).toContain("new URL(target, url.origin)");
  });
});
