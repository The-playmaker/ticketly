import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

describe("GitHub cron workflow", () => {
  const yml = readFileSync(
    path.resolve(__dirname, "../../../../.github/workflows/cron.yml"),
    "utf8"
  );
  const checklist = readFileSync(
    path.resolve(__dirname, "../../../../docs/LAUNCH_CHECKLIST.md"),
    "utf8"
  );

  it("has schedules and workflow_dispatch", () => {
    expect(yml).toContain("schedule:");
    expect(yml).toContain("workflow_dispatch:");
    expect(yml).toContain("reservations-cleanup");
    expect(yml).toContain("payments-reconcile");
    expect(yml).toContain("CRON_SECRET");
    expect(yml).toContain("APP_URL");
  });

  it("LAUNCH_CHECKLIST documents cron secrets", () => {
    expect(checklist).toContain("CRON_SECRET");
    expect(checklist).toContain("APP_URL");
    expect(checklist).toContain("cron.yml");
  });
});
