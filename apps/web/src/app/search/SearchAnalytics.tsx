"use client";

import { useEffect, useRef } from "react";
import { trackSearch } from "@/lib/analytics";
import type { SearchState } from "@/lib/search-url";

/**
 * Fires `search_performed` once per distinct (query+filters+resultCount) view,
 * so the server-computed `resultCount` — including the zero-result content-gap
 * signal (plan Decision 5) — is captured without any inline posthog.capture.
 */
export function SearchAnalytics({
  state,
  resultCount,
}: {
  state: SearchState;
  resultCount: number;
}) {
  const key = JSON.stringify([
    state.q,
    state.priceBands,
    state.categories,
    state.durations,
    state.minRating,
    resultCount,
  ]);
  const last = useRef<string | null>(null);

  useEffect(() => {
    if (last.current === key) return;
    last.current = key;
    // Don't log the bare, untouched browse view as a "search".
    if (
      !state.q &&
      !state.priceBands.length &&
      !state.categories.length &&
      !state.durations.length &&
      state.minRating === undefined
    ) {
      return;
    }
    trackSearch({
      query: state.q,
      resultCount,
      priceBands: state.priceBands,
      categories: state.categories,
      durations: state.durations,
      minRating: state.minRating,
    });
  }, [key, state, resultCount]);

  return null;
}
