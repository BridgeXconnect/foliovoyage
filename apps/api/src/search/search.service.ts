import { Injectable } from "@nestjs/common";

import { priceBandFromMinor } from "../destinations/destination.service";
import { PrismaService } from "../prisma/prisma.service";
import type {
  SearchDestinationResult,
  SearchExperienceResult,
  SearchResponse,
  SearchResultItem,
} from "./search.types";

/**
 * Free-text search over Experiences + Destinations (ST-13 / BRI-125).
 *
 * Phase A per docs/02 §8: Postgres FTS, no extra infra. `Experience` and
 * `City` each carry a trigger/generated `tsvector` column (see the
 * `add_search_vectors` migration) queried here via raw SQL — Prisma has no
 * native tsvector type, so `$queryRaw` is required for the `@@`/`ts_rank_cd`
 * operators. Both queries are parameterized tagged templates (safe from
 * injection); nothing here concatenates user input into SQL text.
 *
 * Ranking blends three terms (docs/02 §8's `text_relevance·w1 + editor_rating·w2
 * + popularity(clicks)·w3 + featured_boost`) — see {@link SEARCH_WEIGHTS} and
 * {@link scoreExperienceRow} for what each term actually contributes at the
 * real current data volume, most of which is near-zero today (see the ST-13
 * report, not restated in code comments beyond the pointers below).
 */

/** Default and max results per page, matching {@link DestinationService}'s convention. */
const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 48;

/**
 * Per-entity-type candidate cap fetched (ranked) before merging + paginating
 * in application code. Bounds query cost at the real ~26K-Experience scale.
 * Phase-A limitation: pagination beyond this many combined matches of one
 * entity type is not exact — acceptable for now (Phase B's dedicated search
 * engine, BRI-148, replaces this app-side merge; nothing here needs to survive
 * that migration).
 */
const CANDIDATE_LIMIT = 200;

/**
 * Ranking weights for the three terms that are actually populated today.
 * Sums to 1 across text/editor/popularity; `featured_boost` (docs/02 §8) is a
 * reserved 0 — no `featured` field exists on `Experience` yet. See the ST-13
 * report for the full rationale (editor_rating and popularity are both
 * near-empty at real data volume right now, hence their small weights).
 */
export const SEARCH_WEIGHTS = {
  text: 0.7,
  editorRating: 0.2,
  popularity: 0.1,
} as const;

/** Click counts beyond this contribute no further popularity score, so one
 * outlier tour can't dominate ranking. */
const POPULARITY_CLICK_CLAMP = 50;

/** One ranked Experience row as returned by the raw SQL queries below. */
export interface ExperienceSearchRow {
  id: string;
  title: string;
  description: string;
  editorRating: number | null;
  citySlug: string;
  countrySlug: string;
  cityName: string;
  country: string;
  imageUrl: string | null;
  imageAlt: string | null;
  priceMinor: number | bigint | null;
  /** `ts_rank_cd(...)` (0 in the featured/empty-query fallback — no query to rank). */
  textRank: number;
  clickCount: number;
}

/** One ranked Destination (City) row as returned by the raw SQL queries below. */
export interface DestinationSearchRow {
  citySlug: string;
  countrySlug: string;
  name: string;
  country: string;
  heroImageUrl: string;
  heroImageAlt: string;
  textRank: number;
}

/**
 * Score one Experience row. `featured_boost` is omitted entirely (contributes
 * 0) rather than coded as a dead term — there is nothing in the schema for it
 * to read from yet.
 */
export function scoreExperienceRow(row: {
  textRank: number;
  editorRating: number | null;
  clickCount: number;
}): number {
  const editorTerm = row.editorRating !== null ? row.editorRating / 5 : 0;
  const popularityTerm =
    Math.min(row.clickCount, POPULARITY_CLICK_CLAMP) / POPULARITY_CLICK_CLAMP;
  return (
    row.textRank * SEARCH_WEIGHTS.text +
    editorTerm * SEARCH_WEIGHTS.editorRating +
    popularityTerm * SEARCH_WEIGHTS.popularity
  );
}

/**
 * Score one Destination row. Deliberately **not** scaled by
 * {@link SEARCH_WEIGHTS.text} — a City carries no editor-rating/popularity
 * signal today, so an equally strong whole-destination text match should rank
 * at or above a same-strength individual Experience match, not be discounted
 * to `text * 0.7` alongside it (see the ST-13 report).
 */
export function scoreDestinationRow(row: { textRank: number }): number {
  return row.textRank;
}

function toExperienceResult(row: ExperienceSearchRow): SearchExperienceResult {
  return {
    type: "experience",
    id: row.id,
    title: row.title,
    description: row.description,
    imageUrl: row.imageUrl,
    imageAlt: row.imageAlt,
    editorRating: row.editorRating,
    priceBand: priceBandFromMinor(row.priceMinor),
    city: row.cityName,
    citySlug: row.citySlug,
    countrySlug: row.countrySlug,
    score: scoreExperienceRow(row),
  };
}

function toDestinationResult(row: DestinationSearchRow): SearchDestinationResult {
  return {
    type: "destination",
    citySlug: row.citySlug,
    countrySlug: row.countrySlug,
    name: row.name,
    country: row.country,
    heroImageUrl: row.heroImageUrl,
    heroImageAlt: row.heroImageAlt,
    score: scoreDestinationRow(row),
  };
}

/** Tie-break name for stable sort ordering among equally-scored results. */
function sortName(item: SearchResultItem): string {
  return item.type === "experience" ? item.title : item.name;
}

/**
 * Merge two already-fetched, already-ranked candidate sets into one scored,
 * sorted list and slice out the requested page. Pure — no I/O — so this is
 * unit-testable independent of Postgres.
 */
export function mergeRankAndPaginate(
  experiences: ExperienceSearchRow[],
  destinations: DestinationSearchRow[],
  totalMatched: number,
  page: number,
  pageSize: number,
): { results: SearchResultItem[]; total: number } {
  const items: SearchResultItem[] = [
    ...experiences.map(toExperienceResult),
    ...destinations.map(toDestinationResult),
  ];
  items.sort((a, b) => b.score - a.score || sortName(a).localeCompare(sortName(b)));
  const start = (page - 1) * pageSize;
  return { results: items.slice(start, start + pageSize), total: totalMatched };
}

/**
 * Paginate the two **featured** (empty-query) candidate sets, preserving each
 * side's own SQL ordering rather than re-sorting by `score`.
 *
 * This is deliberately a different code path from {@link mergeRankAndPaginate}:
 * with no query, almost every Experience ties at `score ≈ 0` (editorRating is
 * null for the ~100% of the catalogue that hasn't been curated yet — see the
 * ST-13 report), so a score-sorted merge would bury the handful of curated
 * Destinations under thousands of equally-(un)scored Experiences, decided by
 * incidental alphabetical order. Concatenating Destinations first instead
 * guarantees they surface — reasonable "featured" behaviour given there is no
 * real `featured` flag yet to sort by.
 */
export function concatenateFeaturedAndPaginate(
  experiences: ExperienceSearchRow[],
  destinations: DestinationSearchRow[],
  totalMatched: number,
  page: number,
  pageSize: number,
): { results: SearchResultItem[]; total: number } {
  const items: SearchResultItem[] = [
    ...destinations.map(toDestinationResult),
    ...experiences.map(toExperienceResult),
  ];
  const start = (page - 1) * pageSize;
  return { results: items.slice(start, start + pageSize), total: totalMatched };
}

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(
    rawQuery: string | undefined,
    page = 1,
    pageSize = DEFAULT_PAGE_SIZE,
  ): Promise<SearchResponse> {
    const q = (rawQuery ?? "").trim();
    const clampedPage = Math.max(1, Math.trunc(page));
    const clampedPageSize = clamp(Math.trunc(pageSize), 1, MAX_PAGE_SIZE);

    const isFeatured = q.length === 0;
    const { experiences, destinations, totalExperiences, totalDestinations } = isFeatured
      ? await this.runFeatured()
      : await this.runTextSearch(q);

    const { results, total } = (isFeatured ? concatenateFeaturedAndPaginate : mergeRankAndPaginate)(
      experiences,
      destinations,
      totalExperiences + totalDestinations,
      clampedPage,
      clampedPageSize,
    );

    return {
      query: q,
      results,
      pagination: {
        page: clampedPage,
        pageSize: clampedPageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / clampedPageSize)),
      },
    };
  }

  /** `q` non-empty: rank both entity types by `ts_rank_cd` against their tsvector. */
  private async runTextSearch(q: string): Promise<{
    experiences: ExperienceSearchRow[];
    destinations: DestinationSearchRow[];
    totalExperiences: number;
    totalDestinations: number;
  }> {
    const [experiences, destinations, expCount, destCount] = await Promise.all([
      this.prisma.$queryRaw<ExperienceSearchRow[]>`
        SELECT
          e.id, e.title, e.description, e."editorRating",
          c.slug AS "citySlug", c."countrySlug" AS "countrySlug",
          c.name AS "cityName", c.country AS "country",
          tour."imageUrl" AS "imageUrl", tour."imageAlt" AS "imageAlt",
          tour."priceMinor" AS "priceMinor",
          ts_rank_cd(e."searchVector", query, 32) AS "textRank",
          COALESCE(clicks.n, 0)::int AS "clickCount"
        FROM "Experience" e
        JOIN "City" c ON c.id = e."cityId"
        CROSS JOIN plainto_tsquery('english', ${q}) AS query
        LEFT JOIN LATERAL (
          SELECT t."imageUrl", t."imageAlt", t."priceMinor"
          FROM "Tour" t
          WHERE t."experienceId" = e.id AND t."deletedAt" IS NULL
          ORDER BY t."updatedAt" DESC
          LIMIT 1
        ) tour ON true
        LEFT JOIN LATERAL (
          SELECT count(*)::int AS n
          FROM "Tour" t2
          JOIN "AffiliateClick" ac ON ac."tourId" = t2.id
          WHERE t2."experienceId" = e.id
        ) clicks ON true
        WHERE e.status = 'published' AND e."searchVector" @@ query
        ORDER BY "textRank" DESC, e.id ASC
        LIMIT ${CANDIDATE_LIMIT}
      `,
      this.prisma.$queryRaw<DestinationSearchRow[]>`
        SELECT
          c.slug AS "citySlug", c."countrySlug" AS "countrySlug",
          c.name AS "name", c.country AS "country",
          c."heroImageUrl" AS "heroImageUrl", c."heroImageAlt" AS "heroImageAlt",
          ts_rank_cd(c."searchVector", query, 32) AS "textRank"
        FROM "City" c
        CROSS JOIN plainto_tsquery('english', ${q}) AS query
        WHERE c."searchVector" @@ query
        ORDER BY "textRank" DESC, c.id ASC
        LIMIT ${CANDIDATE_LIMIT}
      `,
      this.prisma.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM "Experience" e
        CROSS JOIN plainto_tsquery('english', ${q}) AS query
        WHERE e.status = 'published' AND e."searchVector" @@ query
      `,
      this.prisma.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM "City" c
        CROSS JOIN plainto_tsquery('english', ${q}) AS query
        WHERE c."searchVector" @@ query
      `,
    ]);

    return {
      experiences,
      destinations,
      totalExperiences: Number(expCount[0]?.n ?? 0),
      totalDestinations: Number(destCount[0]?.n ?? 0),
    };
  }

  /**
   * `q` empty: the AC's "featured content" fallback. There is no `featured`
   * field in the schema (see the ST-13 report), so this stands in with the
   * best available proxy — highest-`editorRating` published Experiences, and
   * every curated Destination (a handful of rows, listed in full so the
   * empty-search state doubles as a destination browse).
   */
  private async runFeatured(): Promise<{
    experiences: ExperienceSearchRow[];
    destinations: DestinationSearchRow[];
    totalExperiences: number;
    totalDestinations: number;
  }> {
    const [experiences, destinations, expCount, destCount] = await Promise.all([
      this.prisma.$queryRaw<ExperienceSearchRow[]>`
        SELECT
          e.id, e.title, e.description, e."editorRating",
          c.slug AS "citySlug", c."countrySlug" AS "countrySlug",
          c.name AS "cityName", c.country AS "country",
          tour."imageUrl" AS "imageUrl", tour."imageAlt" AS "imageAlt",
          tour."priceMinor" AS "priceMinor",
          0::float AS "textRank",
          COALESCE(clicks.n, 0)::int AS "clickCount"
        FROM "Experience" e
        JOIN "City" c ON c.id = e."cityId"
        LEFT JOIN LATERAL (
          SELECT t."imageUrl", t."imageAlt", t."priceMinor"
          FROM "Tour" t
          WHERE t."experienceId" = e.id AND t."deletedAt" IS NULL
          ORDER BY t."updatedAt" DESC
          LIMIT 1
        ) tour ON true
        LEFT JOIN LATERAL (
          SELECT count(*)::int AS n
          FROM "Tour" t2
          JOIN "AffiliateClick" ac ON ac."tourId" = t2.id
          WHERE t2."experienceId" = e.id
        ) clicks ON true
        WHERE e.status = 'published'
        ORDER BY e."editorRating" DESC NULLS LAST, e.position ASC, e.title ASC
        LIMIT ${CANDIDATE_LIMIT}
      `,
      this.prisma.$queryRaw<DestinationSearchRow[]>`
        SELECT
          c.slug AS "citySlug", c."countrySlug" AS "countrySlug",
          c.name AS "name", c.country AS "country",
          c."heroImageUrl" AS "heroImageUrl", c."heroImageAlt" AS "heroImageAlt",
          0::float AS "textRank"
        FROM "City" c
        ORDER BY c.name ASC
        LIMIT ${CANDIDATE_LIMIT}
      `,
      this.prisma.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM "Experience" WHERE status = 'published'
      `,
      this.prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "City"`,
    ]);

    return {
      experiences,
      destinations,
      totalExperiences: Number(expCount[0]?.n ?? 0),
      totalDestinations: Number(destCount[0]?.n ?? 0),
    };
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
