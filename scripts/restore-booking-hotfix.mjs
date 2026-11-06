#!/usr/bin/env node
/**
 * Apply booking hotfixes in-place (string patches).
 * Safe to re-run; no-ops when markers already present.
 * Does not fail the build if targets are missing.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function patchFile(rel, patches) {
  const target = join(root, rel);
  if (!existsSync(target)) {
    console.warn(`[booking-hotfix] skip ${rel} — file missing`);
    return;
  }
  let src = readFileSync(target, "utf8");
  let changed = false;
  for (const { find, replace, already } of patches) {
    if (already && already(src)) continue;
    if (!src.includes(find)) {
      console.warn(`[booking-hotfix] pattern not found in ${rel}: ${find.slice(0, 60)}…`);
      continue;
    }
    src = src.replace(find, replace);
    changed = true;
  }
  if (changed) {
    writeFileSync(target, src);
    console.log(`[booking-hotfix] patched ${rel}`);
  } else {
    console.log(`[booking-hotfix] skip ${rel} (already applied or no match)`);
  }
}

// 1) Public list: keep in-progress nightlife events visible
patchFile("apps/web/src/services/event-service.ts", [
  {
    find: "        startsAt: { gte: now },\n",
    replace:
      "        // Show future AND in-progress events (nightlife sells through the evening).\n" +
      "        // startsAt >= now hid tonight's event as soon as doors/show started.\n" +
      "        endsAt: { gte: now },\n",
    already: (s) => s.includes("endsAt: { gte: now }"),
  },
  {
    find: "      where: {\n        slug,\n        OR: [\n",
    replace:
      "      where: {\n        slug,\n        // HIDDEN events are admin-only (preview via /admin/events/[id], not public slug)\n" +
      '        visibility: { in: ["PUBLIC", "UNLISTED"] },\n' +
      "        OR: [\n",
    already: (s) => s.includes('visibility: { in: ["PUBLIC", "UNLISTED"] }'),
  },
]);

// 2) Reserve: reject HIDDEN events + invisible ticket types
patchFile("apps/web/src/services/reservation-service.ts", [
  {
    find:
      '      if (!event) throw new AppError("EVENT_NOT_FOUND", "Arrangement ikke funnet", 404);\n' +
      "      if (event.status === EventStatus.CANCELLED) {\n",
    replace:
      '      if (!event) throw new AppError("EVENT_NOT_FOUND", "Arrangement ikke funnet", 404);\n' +
      '      if (event.visibility === "HIDDEN") {\n' +
      "        throw new AppError(\n" +
      '          "TICKET_TYPE_NOT_AVAILABLE",\n' +
      '          "Billettene er ikke tilgjengelige",\n' +
      "          403\n" +
      "        );\n" +
      "      }\n" +
      "      if (event.status === EventStatus.CANCELLED) {\n",
    already: (s) => s.includes('event.visibility === "HIDDEN"'),
  },
  {
    find: "            is_publicly_purchasable: boolean;\n            sales_start_at: Date | null;\n",
    replace:
      "            is_publicly_purchasable: boolean;\n" +
      "            is_visible: boolean;\n" +
      "            sales_start_at: Date | null;\n",
    already: (s) => s.includes("is_visible: boolean;"),
  },
  {
    find:
      '                 "isPubliclyPurchasable" as is_publicly_purchasable,\n' +
      '                 "salesStartAt" as sales_start_at,',
    replace:
      '                 "isPubliclyPurchasable" as is_publicly_purchasable,\n' +
      '                 "isVisible" as is_visible,\n' +
      '                 "salesStartAt" as sales_start_at,',
    already: (s) => s.includes('"isVisible" as is_visible'),
  },
  {
    find:
      "        if (row.event_id !== input.eventId) {\n" +
      '          throw new AppError("TICKET_TYPE_WRONG_EVENT", "Billettype tilhører ikke arrangementet", 400);\n' +
      "        }\n" +
      "        if (!row.is_publicly_purchasable) {\n",
    replace:
      "        if (row.event_id !== input.eventId) {\n" +
      '          throw new AppError("TICKET_TYPE_WRONG_EVENT", "Billettype tilhører ikke arrangementet", 400);\n' +
      "        }\n" +
      "        if (!row.is_visible) {\n" +
      "          throw new AppError(\n" +
      '            "TICKET_TYPE_NOT_AVAILABLE",\n' +
      '            "Billettene er ikke tilgjengelige",\n' +
      "            403\n" +
      "          );\n" +
      "        }\n" +
      "        if (!row.is_publicly_purchasable) {\n",
    already: (s) => s.includes("!row.is_visible"),
  },
]);
