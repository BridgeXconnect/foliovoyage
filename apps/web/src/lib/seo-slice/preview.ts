/**
 * The local preview switch for the SEO slice (spec 0006 page template, AC-T15).
 *
 * The preview renders slice pages that are not live, under a "Not approved"
 * banner, so Roy can read them before `hub-copy:approve`. It runs only under
 * `next dev` on a developer's machine: `next build` sets `NODE_ENV` to
 * `production`, and Vercel sets `VERCEL`, so a production build never takes
 * this path even with `SEO_SLICE_PREVIEW=1` set.
 */

type Env = Record<string, string | undefined>;

export function isSlicePreview(env: Env = process.env): boolean {
  return env.SEO_SLICE_PREVIEW === "1" && env.NODE_ENV === "development" && !env.VERCEL;
}

/** The banner heading on every preview page. The leak scan fails on it (AC-T6). */
export const SEO_SLICE_PREVIEW_BANNER = "Not approved: local preview only";

/** The extra banner line on a page that has a snapshot but no copy file yet. */
export const SEO_SLICE_NO_COPY_TEXT = "No copy yet";

/**
 * Marks the placeholder intro, title and description of a preview page with no
 * copy file (AC-T15, amended 16 Oct 2026). The leak scan fails on it.
 */
export const SEO_SLICE_PLACEHOLDER_MARKER = "[placeholder until hub-copy:run]";

/** Texts that exist only in the preview, so a built page holding one has leaked it. */
export const SEO_SLICE_PREVIEW_TERMS = ["Not approved", SEO_SLICE_NO_COPY_TEXT, SEO_SLICE_PLACEHOLDER_MARKER] as const;
