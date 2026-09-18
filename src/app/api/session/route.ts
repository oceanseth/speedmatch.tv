import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

// v1 anonymous identity until real auth (Better Auth is next): an httpOnly
// random uuid. It is NOT authentication and NOT a spend boundary — a client
// that drops the cookie and re-calls this route gets a fresh id, so
// rotation costs one request. The real mint guards are the per-IP cap and
// the global budget; sm_sid exists for audit correlation and as the id
// tournament ownership will bind to. Idempotent: an existing cookie is
// left untouched.
export async function GET() {
  const jar = await cookies();
  if (!jar.get("sm_sid")?.value) {
    jar.set("sm_sid", crypto.randomUUID(), {
      httpOnly: true,
      sameSite: "lax",
      // Conditional so local http builds (Bartolomej's harness, next start)
      // still receive the cookie; prod is always https behind Cloudflare.
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  return NextResponse.json({ ok: true });
}
