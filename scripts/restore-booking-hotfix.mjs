#!/usr/bin/env node
/**
 * One-shot restore for booking hotfix service files from base64 parts.
 * Safe to re-run; skips if target already contains the hotfix markers.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const partsDir = join(root, "scripts/booking-hotfix-parts");
const manifestPath = join(partsDir, "manifest.json");

if (!existsSync(manifestPath)) {
  console.log("[booking-hotfix] no manifest — skip");
  process.exit(0);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

for (const entry of manifest) {
  const target = join(root, entry.path);
  const existing = existsSync(target) ? readFileSync(target, "utf8") : "";
  const already =
    (entry.path.includes("event-service") &&
      existing.includes("endsAt: { gte: now }") &&
      existing.includes('visibility: { in: ["PUBLIC", "UNLISTED"] }')) ||
    (entry.path.includes("reservation-service") &&
      existing.includes('event.visibility === "HIDDEN"') &&
      existing.includes("is_visible"));
  if (already) {
    console.log(`[booking-hotfix] skip ${entry.path} (already applied)`);
    continue;
  }
  const missing = entry.parts.filter((p) => !existsSync(join(partsDir, p)));
  if (missing.length) {
    console.warn(
      `[booking-hotfix] skip ${entry.path} — missing parts: ${missing.join(", ")}`
    );
    continue;
  }
  const b64 = entry.parts.map((p) => readFileSync(join(partsDir, p), "utf8").trim()).join("");
  writeFileSync(target, Buffer.from(b64, "base64"));
  console.log(`[booking-hotfix] restored ${entry.path}`);
}
