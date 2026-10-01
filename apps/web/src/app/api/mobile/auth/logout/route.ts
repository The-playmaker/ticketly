import { NextResponse } from "next/server";
import { revokeMobileSession } from "@/app/api/mobile/auth/login/route";

export async function POST(req: Request) {
  await revokeMobileSession(req.headers.get("authorization"));
  return NextResponse.json({ ok: true });
}
