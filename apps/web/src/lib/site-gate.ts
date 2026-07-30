/**
 * Shared helpers for the pre-launch "coming soon" gate.
 *
 * The gate is ON whenever `SITE_GATE_PASSWORD` is set to a non-empty value, and
 * OFF (site fully public) when the variable is absent — so launching is just a
 * matter of deleting the env var in Vercel, with no code change or redeploy of
 * new logic. Set it in Vercel → Project Settings → Environment Variables for
 * Production (and Preview, if previews should be gated too).
 */

export const GATE_COOKIE = "folio-preview";

export function gatePassword(): string | undefined {
  const value = process.env.SITE_GATE_PASSWORD?.trim();
  return value ? value : undefined;
}

/**
 * Cookie value = a SHA-256 of the password (never the raw password), so the
 * preview cookie can't be forged without knowing the password and the plaintext
 * never rides in the cookie. Web Crypto is used so this runs unchanged in both
 * the Edge middleware and the Node route handler.
 */
export async function gateToken(password: string): Promise<string> {
  const data = new TextEncoder().encode(`folio-voyage:site-gate:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
