"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  VALID_PRICE_BANDS,
  VALID_CATEGORIES,
  VALID_DURATIONS,
  searchStateToQuery,
  type DurationBucket,
  type SearchState,
} from "@/lib/search-url";
import type { SearchFacets } from "@/lib/search-experiences";
import type { ExperienceCategory, PriceBand } from "@folio/shared";

const DURATION_LABELS: Record<DurationBucket, string> = {
  short: "A few hours",
  "half-day": "Half day",
  "full-day": "Full day",
  "multi-day": "Multi-day",
};

/**
 * Query input + facet chips for /search. The only source of truth is the URL:
 * every change writes a new query string via router.replace, and the server
 * component re-runs the engine from those params (plan Decision 4). Toggling any
 * filter resets to page 1.
 */
export function SearchControls({
  state,
  facets,
}: {
  state: SearchState;
  facets: SearchFacets;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [draft, setDraft] = useState(state.q);

  function push(next: SearchState) {
    const qs = searchStateToQuery(next);
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function submitQuery(e: React.FormEvent) {
    e.preventDefault();
    push({ ...state, q: draft.trim(), page: 1 });
  }

  function toggle<T extends string>(key: "priceBands" | "categories" | "durations", value: T) {
    const current = state[key] as T[];
    const nextList = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    // Cast the whole object: the computed key + typed value keep the shape
    // correct, but TS can't narrow a computed-property spread on its own.
    push({ ...state, [key]: nextList, page: 1 } as SearchState);
  }

  const priceCount = (b: PriceBand) => facets.priceBands.find((f) => f.value === b)?.count ?? 0;
  const catCount = (c: ExperienceCategory) =>
    facets.categories.find((f) => f.value === c)?.count ?? 0;
  const durCount = (d: DurationBucket) => facets.durations.find((f) => f.value === d)?.count ?? 0;

  const hasFilters =
    state.priceBands.length || state.categories.length || state.durations.length || state.q;

  return (
    <div className="space-y-6">
      <form onSubmit={submitQuery} role="search" className="relative">
        <Search
          size={18}
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted"
          aria-hidden
        />
        <input
          type="search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Search experiences and destinations…"
          aria-label="Search experiences and destinations"
          className="w-full rounded-[3px] border border-line bg-white py-3.5 pl-11 pr-4 text-[15px] text-ink outline-none focus:border-accent"
        />
      </form>

      <Facet label="Price">
        {VALID_PRICE_BANDS.filter((b) => priceCount(b) > 0 || state.priceBands.includes(b)).map(
          (b) => (
            <Chip
              key={b}
              active={state.priceBands.includes(b)}
              onClick={() => toggle("priceBands", b)}
              label={`${b} (${priceCount(b)})`}
            />
          ),
        )}
      </Facet>

      <Facet label="Category">
        {VALID_CATEGORIES.filter((c) => catCount(c) > 0 || state.categories.includes(c)).map((c) => (
          <Chip
            key={c}
            active={state.categories.includes(c)}
            onClick={() => toggle("categories", c)}
            label={`${c} (${catCount(c)})`}
          />
        ))}
      </Facet>

      <Facet label="Duration">
        {VALID_DURATIONS.filter((d) => durCount(d) > 0 || state.durations.includes(d)).map((d) => (
          <Chip
            key={d}
            active={state.durations.includes(d)}
            onClick={() => toggle("durations", d)}
            label={`${DURATION_LABELS[d]} (${durCount(d)})`}
          />
        ))}
      </Facet>

      {hasFilters ? (
        <button
          type="button"
          onClick={() => {
            setDraft("");
            push({ q: "", priceBands: [], categories: [], durations: [], page: 1 });
          }}
          className="inline-flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-[0.14em] text-muted hover:text-ink"
        >
          <X size={14} aria-hidden /> Clear all
        </button>
      ) : null}
    </div>
  );
}

function Facet({ label, children }: { label: string; children: React.ReactNode }) {
  const kids = Array.isArray(children) ? children.filter(Boolean) : children;
  if (Array.isArray(kids) && kids.length === 0) return null;
  return (
    <div>
      <p className="eyebrow mb-2">{label}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3.5 py-1.5 text-[12px] font-medium transition-colors",
        active
          ? "border-accent bg-accent text-white"
          : "border-line bg-white text-ink-soft hover:border-ink hover:text-ink",
      )}
    >
      {label}
    </button>
  );
}
