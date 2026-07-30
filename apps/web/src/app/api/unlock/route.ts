import { NextResponse, type NextRequest } from "next/server";
import { GATE_COOKIE, gatePassword, gateToken } from "@/lib/site-gate";

/**
 * Accepts the preview password from the coming-soon form. On success it sets a
 * signed-by-hash preview cookie and sends the visitor into the real site; on
 * failure it bounces back to the holding page with an error flag.
 */
export async function POST(req: NextRequest) {
  const password = gatePassword();
  const form = await req.formData();
  const supplied = String(form.get("password") ?? "");

  if (!password || supplied !== password) {
    return NextResponse.redirect(new URL("/coming-soon?error=1", req.url), 303);
  }

  const res = NextResponse.redirect(new URL("/", req.url), 303);
  res.cookies.set(GATE_COOKIE, await gateToken(password), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });
  return res;
}
