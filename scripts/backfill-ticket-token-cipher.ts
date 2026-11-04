/**
 * Backfill ticket tokenHash + tokenCipher for tickets that still rely on
 * legacy plaintext secureToken at check-in.
 *
 * Default: dry-run (report only). Pass --apply to write.
 * Idempotent: only rows with null tokenHash or null tokenCipher are updated.
 *
 * Does NOT remove the check-in secureToken fallback — that stays until a
 * later migration after this backfill has been applied in production.
 *
 * Usage:
 *   npx tsx scripts/backfill-ticket-token-cipher.ts
 *   npx tsx scripts/backfill-ticket-token-cipher.ts --apply
 *
 * Requires DATABASE_URL and TICKET_TOKEN_SECRET (or AUTH_SECRET).
 */
import { PrismaClient } from "@prisma/client";
import { createHash, createHmac, randomBytes, createCipheriv } from "crypto";

const APPLY = process.argv.includes("--apply");
const DRY_RUN = !APPLY;

function requireSecret(): string {
  const s = process.env.TICKET_TOKEN_SECRET || process.env.AUTH_SECRET;
  if (!s || s.length < 16) {
    throw new Error("TICKET_TOKEN_SECRET or AUTH_SECRET (>=16 chars) required");
  }
  return s;
}

function hashToken(raw: string, secret: string): string {
  return createHmac("sha256", secret).update(raw).digest("hex");
}

function encryptToken(raw: string, secret: string): string {
  const key = createHash("sha256").update(secret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(raw, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

async function main() {
  const secret = requireSecret();
  const prisma = new PrismaClient();
  try {
    const candidates = await prisma.ticket.findMany({
      where: {
        OR: [{ tokenHash: null }, { tokenCipher: null }],
        secureToken: { not: null },
      },
      select: { id: true, secureToken: true, tokenHash: true, tokenCipher: true },
      take: 10_000,
    });

    console.log(`Found ${candidates.length} tickets needing hash/cipher backfill`);
    if (DRY_RUN) {
      console.log("Dry-run only. Re-run with --apply to write.");
      return;
    }

    let updated = 0;
    for (const t of candidates) {
      if (!t.secureToken) continue;
      const tokenHash = t.tokenHash ?? hashToken(t.secureToken, secret);
      const tokenCipher = t.tokenCipher ?? encryptToken(t.secureToken, secret);
      if (t.tokenHash && t.tokenCipher) continue;
      await prisma.ticket.update({
        where: { id: t.id },
        data: {
          ...(t.tokenHash ? {} : { tokenHash }),
          ...(t.tokenCipher ? {} : { tokenCipher }),
        },
      });
      updated += 1;
    }
    console.log(`Updated ${updated} tickets`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
