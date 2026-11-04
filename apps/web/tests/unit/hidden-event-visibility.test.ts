import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const src = (rel: string) =>
  readFileSync(path.resolve(__dirname, "../../src", rel), "utf8");

describe("HIDDEN event + invisible ticket types", () => {
  it("getBySlug excludes HIDDEN visibility (404 for public slug)", () => {
    const service = src("services/event-service.ts");
    expect(service).toMatch(/getBySlug[\s\S]*?visibility:\s*\{\s*in:\s*\["PUBLIC",\s*"UNLISTED"\]/);
    expect(service).toContain("HIDDEN events are admin-only");
  });

  it("reserve rejects HIDDEN events and isVisible=false with TICKET_TYPE_NOT_AVAILABLE 403", () => {
    const reserve = src("services/reservation-service.ts");
    expect(reserve).toContain('event.visibility === "HIDDEN"');
    expect(reserve).toContain("TICKET_TYPE_NOT_AVAILABLE");
    expect(reserve).toContain("is_visible");
    expect(reserve).toMatch(/!row\.is_visible[\s\S]*?TICKET_TYPE_NOT_AVAILABLE[\s\S]*?403/);
  });
});
