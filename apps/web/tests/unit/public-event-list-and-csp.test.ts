import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const root = path.resolve(__dirname, "../..");

describe("public booking discoverability + Nexi CSP", () => {
  it("listPublic keeps in-progress events (endsAt >= now, not startsAt)", () => {
    const service = readFileSync(
      path.join(root, "src/services/event-service.ts"),
      "utf8"
    );
    const listPublic = service.slice(
      service.indexOf("static async listPublic"),
      service.indexOf("static async getBySlug")
    );
    expect(listPublic).toMatch(/endsAt:\s*\{\s*gte:\s*now\s*\}/);
    expect(listPublic).not.toMatch(/startsAt:\s*\{\s*gte:\s*now\s*\}/);
  });

  it("CSP allows Nexi Checkout script, API, and frames (test + live)", () => {
    const config = readFileSync(path.join(root, "next.config.ts"), "utf8");
    for (const host of [
      "https://checkout.dibspayment.eu",
      "https://test.checkout.dibspayment.eu",
      "https://api.dibspayment.eu",
      "https://test.api.dibspayment.eu",
    ]) {
      expect(config).toContain(host);
    }
    expect(config).toMatch(/script-src[\s\S]*checkout\.dibspayment\.eu/);
    expect(config).toMatch(/frame-src[\s\S]*checkout\.dibspayment\.eu/);
    expect(config).toMatch(/connect-src[\s\S]*api\.dibspayment\.eu/);
  });
});
