#!/usr/bin/env node
/**
 * Restores security-audit sync targets from zlib bundles when placeholders/truncated.
 * Safe no-op when files already match expected markers.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, ".github/restore-parts/security-sync/manifest.json"), "utf8")
);

for (const [rel, zrel] of Object.entries(manifest)) {
  const target = path.join(root, rel);
  const zpath = path.join(root, zrel);
  let cur = "";
  try { cur = fs.readFileSync(target, "utf8"); } catch {}
  const broken =
    cur.length < 500 ||
    cur.includes("PLACEHOLDER") ||
    cur.startsWith("@file:") ||
    (rel.includes("event-service") && !cur.includes('visibility: { in: ["PUBLIC", "UNLISTED"] }')) ||
    (rel.includes("reservation-service") && !cur.includes("mergeTicketSelectionItems")) ||
    (rel.includes("payment-reconciliation") && !cur.includes("releasePromoForOrder")) ||
    (rel.includes("hardening.test") && !cur.includes("PAID webhook without amount"));
  if (!broken && process.env.FORCE_SECURITY_RESTORE !== "1") {
    continue;
  }
  const text = zlib.inflateSync(Buffer.from(fs.readFileSync(zpath, "utf8").trim(), "base64")).toString("utf8");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text);
  console.log(`security-sync: restored ${rel} (${text.length} chars)`);
}
