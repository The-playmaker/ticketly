import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const src = (rel: string) =>
  readFileSync(path.resolve(__dirname, "../../src", rel), "utf8");

describe("reports/search/waitlist use jsonError", () => {
  it("does not leak e.message on unknown errors", () => {
    for (const rel of [
      "app/api/admin/reports/route.ts",
      "app/api/tickets/search/route.ts",
      "app/api/waitlist/route.ts",
    ]) {
      const body = src(rel);
      expect(body).toContain("jsonError");
      expect(body).not.toMatch(/e instanceof Error \? e\.message/);
    }
  });
});
