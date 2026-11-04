/**
 * Backfill Ticket.tokenHash + tokenCipher from legacy plaintext secureToken.
 *
 * Usage:
 *   npx tsx scripts/backfill-ticket-token-cipher.ts --dry-run
 *   npx tsx scripts/backfill-ticket-token-cipher.ts --apply [--limit=500]
 *
 * Idempotent: skips rows that already have tokenHash and tokenCipher.
 * Does NOT remove the check-in secureToken fallback — that stays until
 * plaintext column is retired in a later change.
 *
 * Requires DATABASE_URL and TICKET_TOKEN_SECRET (or AUTH_SECRET ≥16 chars).
 */

import { PrismaClient } from "@prisma/client";
import { createCipheriv, createHash, randomBytes } from "crypto";

const prisma = new PrismaClient();
const ALGO = "aes-256-gcm";

function encryptionKey(): Buffer {
  const secret = process.env.TICKET_TOKEN_SECRET ?? process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("TICKET_TOKEN_SECRET or AUTH_SECRET (≥16) required");
  }
  return createHash("sha256").update(`ticket-token:${secret}`).digest();
}

function hashTicketToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function encryptTicketToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run") || !args.includes("--apply");
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : 500;

  const candidates = await prisma.ticket.findMany({
    where: {
      secureToken: { not: null },
      OR: [{ tokenHash: null }, { tokenCipher: null }],
    },
    select: { id: true, secureToken: true, tokenHash: true, tokenCipher: true },
    take: Number.isFinite(limit) && limit > 0 ? limit : 500,
    orderBy: { createdAt: "asc" },
  });

  console.log(
    `[backfill-ticket-token-cipher] mode=${dryRun ? "dry-run" : "apply"} candidates=${candidates.length}`
  );

  let updated = 0;
  let skipped = 0;

  for (const t of candidates) {
    if (!t.secureToken) {
      skipped++;
      continue;
    }
    const tokenHash = t.tokenHash ?? hashTicketToken(t.secureToken);
    const tokenCipher = t.tokenCipher ?? encryptTicketToken(t.secureToken);

    if (t.tokenHash && t.tokenCipher) {
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(` would update ticket ${t.id}`);
      updated++;
      continue;
    }

    await prisma.ticket.update({
      where: { id: t.id },
      data: { tokenHash, tokenCipher },
    });
    updated++;
  }

  console.log(
    `[backfill-ticket-token-cipher] done updated=${updated} skipped=${skipped} dryRun=${dryRun}`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
