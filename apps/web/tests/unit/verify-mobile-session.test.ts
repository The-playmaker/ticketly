import { describe, expect, it, vi, afterEach } from "vitest";
import { createHmac } from "crypto";
import { readFileSync } from "fs";
import path from "path";

vi.mock("@/lib/db", () => ({
  prisma: {
    mobileSession: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

import { verifyMobileSession } from "@/app/api/mobile/auth/login/route";

describe("verifyMobileSession AUTH_SECRET gate", () => {
  const prev = process.env.AUTH_SECRET;

  afterEach(() => {
    if (prev === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = prev;
  });

  it("returns null when AUTH_SECRET missing or shorter than 16 chars", async () => {
    delete process.env.AUTH_SECRET;
    expect(await verifyMobileSession("Bearer x.y")).toBeNull();

    process.env.AUTH_SECRET = "short";
    expect(await verifyMobileSession("Bearer x.y")).toBeNull();
  });

  it("verifyMobileToken is removed from login route", () => {
    const src = readFileSync(
      path.resolve(__dirname, "../../src/app/api/mobile/auth/login/route.ts"),
      "utf8"
    );
    expect(src).not.toContain("export function verifyMobileToken");
    expect(src).toContain("export async function verifyMobileSession");
  });

  it("rejects forged tokens even with valid-looking secret length", async () => {
    process.env.AUTH_SECRET = "test-secret-16chars";
    const payload = Buffer.from(
      JSON.stringify({ sub: "u1", jti: "j1", exp: Date.now() + 60_000 })
    ).toString("base64url");
    const sig = createHmac("sha256", "other-secret-xxxxx").update(payload).digest("base64url");
    expect(await verifyMobileSession(`Bearer ${payload}.${sig}`)).toBeNull();
  });
});
