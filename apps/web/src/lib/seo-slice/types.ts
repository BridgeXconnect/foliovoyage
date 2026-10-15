import type {
  SeoSliceCopy,
  SeoSliceManifest,
  SeoSliceNotes,
  SeoSlicePublicSnapshot,
  SeoSliceSnapshot,
} from "@folio/shared";

/** Everything in `src/content/seo/bangkok/`, as read from disk. */
export interface SliceContent {
  /** Null before the manifest exists (scope row 19). */
  manifest: SeoSliceManifest | null;
  snapshots: Record<string, SeoSliceSnapshot>;
  copies: Record<string, SeoSliceCopy>;
  notes: Record<string, SeoSliceNotes>;
}

/**
 * One page as `pages.generated.ts` carries it: every page that has files, live
 * or not (the local preview renders the ones that are not live). The snapshot
 * has no `eligible` block (spec 0006 AC-9).
 */
export interface SeoSliceGeneratedPage {
  slug: string;
  snapshot: SeoSlicePublicSnapshot | null;
  copy: SeoSliceCopy | null;
  notes: SeoSliceNotes | null;
}

export type SeoSliceGeneratedPages = Record<string, SeoSliceGeneratedPage>;
