import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

// v1 anonymous identity until real auth (Better Auth spec pending Seth's
// sign-off): an httpOnly random uuid. It is NOT authentication — it exists
// so the token broker has a stable per-visitor rate-limit/audit dimension
// the client can't rotate for free, and so tournament ownership has an id
// to bind to. Idempotent: an existing cookie is left untouched.
export async function GET() {
  const jar = await cookies();
  if (!jar.get("sm_sid")?.value) {
    jar.set("sm_sid", crypto.randomUUID(), {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  return NextResponse.json({ ok: true });
}
