/**
 * Create the first (or additional) SUPER_ADMIN without shipping a default password.
 *
 * Usage:
 *   ADMIN_EMAIL=you@company.no ADMIN_FIRST_NAME=Ada ADMIN_LAST_NAME=Lovelace \
 *   ADMIN_PASSWORD='…' npm run admin:create
 *
 * Prefer interactive password when possible. Password is never logged.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient, GlobalRole } from "@prisma/client";
import { createInterface } from "readline/promises";
import { stdin as input, stdout as output } from "process";

const prisma = new PrismaClient();

async function readPassword(prompt: string): Promise<string> {
  if (process.env.ADMIN_PASSWORD?.trim()) {
    return process.env.ADMIN_PASSWORD.trim();
  }
  if (!input.isTTY) {
    throw new Error("ADMIN_PASSWORD env required in non-interactive mode");
  }
  const rl = createInterface({ input, output });
  const pwd = await rl.question(prompt);
  rl.close();
  return pwd.trim();
}

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const firstName = (process.env.ADMIN_FIRST_NAME ?? "Admin").trim();
  const lastName = (process.env.ADMIN_LAST_NAME ?? "").trim();
  if (!email || !email.includes("@")) {
    throw new Error("Set ADMIN_EMAIL to a valid email");
  }

  const existingAdmins = await prisma.user.count({
    where: { globalRole: GlobalRole.SUPER_ADMIN, isActive: true },
  });

  const password = await readPassword("Admin password (min 12 chars): ");
  if (password.length < 12) {
    throw new Error("Password must be at least 12 characters");
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const name = `${firstName} ${lastName}`.trim();

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      firstName,
      lastName,
      name,
      passwordHash,
      globalRole: GlobalRole.SUPER_ADMIN,
      isActive: true,
    },
    create: {
      email,
      firstName,
      lastName,
      name,
      passwordHash,
      globalRole: GlobalRole.SUPER_ADMIN,
      isActive: true,
    },
  });

  console.log(
    existingAdmins === 0
      ? `Created first SUPER_ADMIN: ${user.email}`
      : `Upserted SUPER_ADMIN: ${user.email}`
  );
  console.log("Password was set securely and is not printed.");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
