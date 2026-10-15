import { NextResponse, type NextRequest } from "next/server";
import { isSlicePath } from "@/lib/seo-slice-gate";
import { GATE_COOKIE, gatePassword, gateToken } from "@/lib/site-gate";

// Paths that must stay reachable while the site is gated: the holding page
// itself, the unlock endpoint it posts to, and robots.txt (served as
// gated rules by robots.ts). The live SEO slice pages, their sitemap, click outs
// and the analytics proxy also pass (spec 0006, `isSlicePath`). Everything else
// is rewritten to the coming-soon page unless the request carries a valid
// preview cookie.
const PASSTHROUGH = new Set(["/coming-soon", "/api/unlock", "/robots.txt"]);

export async function middleware(req: NextRequest) {
  const password = gatePassword();
  // Gate off (no password configured) → behave like a normal site.
  if (!password) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (PASSTHROUGH.has(pathname) || isSlicePath(pathname)) return NextResponse.next();

  // A valid preview cookie unlocks the full site for the team.
  const token = req.cookies.get(GATE_COOKIE)?.value;
  if (token && token === (await gateToken(password))) {
    return NextResponse.next();
  }

  // Everyone else sees the coming-soon page at whatever URL they requested.
  const url = req.nextUrl.clone();
  url.pathname = "/coming-soon";
  url.search = "";
  const res = NextResponse.rewrite(url);
  res.headers.set("x-robots-tag", "noindex, nofollow");
  return res;
}

export const config = {
  // Run on everything except Next's build assets and the favicon/icon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
