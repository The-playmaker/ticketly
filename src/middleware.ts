import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(_req: NextRequest) {
  const res = NextResponse.next();
  // Secure cookie hints for session (Auth.js also sets httpOnly cookies)
  if (process.env.NODE_ENV === "production") {
    res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
