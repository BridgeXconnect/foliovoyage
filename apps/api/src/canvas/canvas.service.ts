import { Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CanvasBucketResponse,
  CanvasBucketSummary,
  CanvasBucketsResponse,
  CanvasTile,
} from "@folio/shared";

import { CURATED_CITIES } from "../modules/import/curated-cities";
import { PrismaService } from "../prisma/prisma.service";
import { CANVAS_CATEGORY_COPY, SHOWN_CATEGORY_TAG_IDS, categoryBySlug } from "./canvas-categories";
import { pickImage } from "./canvas-image";

/**
 * The discovery canvas feed (BRI-225, spec 0004-canvas-feed-endpoint).
 *
 * Two reads, one query each (AC-F10): the summaries of every bucket (a grouped
 * query), and one bucket's best tiles. Both run the same ranking SQL
 * ({@link rankedCte}) so a summary's picture is always the picture of the
 * bucket's rank 1 tile. Ranking is a Bayesian score computed per request and
 * never stored (AC-F5); results are held in process for 10 minutes (AC-F8).
 *
 * Cities come from `curated-cities.ts` (the same list the importer links to) and
 * categories from {@link CANVAS_CATEGORY_COPY}, both in world order. Unknown
 * slugs never reach the database.
 */

/** A bucket never carries more than this many tiles (AC-F2). Pinned to the shared constant by a spec. */
export const MAX_TILES = 50;
/** Bayesian prior weight `m` (AC-F5): the number of ratings a tour needs before its own average outweighs the bucket mean. */
export const BAYESIAN_M = 10;
/** How long a computed response is reused (AC-F8). */
export const CACHE_TTL_MS = 10 * 60 * 1000;

/** One tile row, as the ranked query returns it. `bigint` columns are converted before they reach JSON. */
interface FeedRow {
  country_slug: string;
  city_slug: string;
  city_name: string;
  category_tag_id: number;
  experience_id: string;
  tour_id: string;
  title: string;
  duration_min: number | null;
  rating_avg: number | null;
  rating_count: number | null;
  price_minor: bigint;
  currency: string;
  image_url: string | null;
  images: unknown;
  rank_no: bigint;
  total: bigint;
}

/**
 * Eligibility, scoring, one tile per Experience, and ranking, in one statement.
 * `scope` narrows the rows (all six cities and seven categories, or one bucket).
 *
 * - eligible (AC-F3): live, published, in scope, priced, with a usable image.
 *   An empty string is not a usable url (it would fail the response schema).
 * - prior: `C`, the mean rating of each bucket's rated eligible tours, taken
 *   before the one tile per Experience step (AC-F5).
 * - scored: the Bayesian score for rated tours, null for unrated.
 * - best (AC-F4): per Experience, the best score, ties on Tour id.
 * - ranked: rated before unrated, then score, then Tour id with `COLLATE "C"`
 *   (ids are text), numbered within each bucket, with the uncapped total.
 */
function rankedCte(scope: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    WITH eligible AS (
      SELECT c."countrySlug" AS country_slug,
             c."slug" AS city_slug,
             c."name" AS city_name,
             t."primaryCategoryTagId" AS category_tag_id,
             e."id" AS experience_id,
             t."id" AS tour_id,
             t."title" AS title,
             t."durationMin" AS duration_min,
             t."ratingAvg" AS rating_avg,
             t."ratingCount" AS rating_count,
             t."priceReferenceMinor" AS price_minor,
             COALESCE(t."priceReferenceCurrency", 'USD') AS currency,
             t."imageUrl" AS image_url,
             t."images" AS images,
             (t."ratingAvg" IS NOT NULL AND COALESCE(t."ratingCount", 0) > 0) AS rated
      FROM "Tour" t
      JOIN "Experience" e ON e."id" = t."experienceId"
      JOIN "City" c ON c."id" = e."cityId"
      WHERE t."deletedAt" IS NULL
        AND e."status" = 'published'
        AND t."priceReferenceMinor" IS NOT NULL
        AND (
          (t."imageUrl" IS NOT NULL AND t."imageUrl" <> '')
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements(
                   CASE WHEN jsonb_typeof(t."images") = 'array' THEN t."images" ELSE '[]'::jsonb END
                 ) AS im
            CROSS JOIN jsonb_array_elements(
                   CASE WHEN jsonb_typeof(im -> 'variants') = 'array' THEN im -> 'variants' ELSE '[]'::jsonb END
                 ) AS v
            WHERE COALESCE(v ->> 'url', '') <> ''
          )
        )
        AND ${scope}
    ),
    prior AS (
      SELECT country_slug, city_slug, category_tag_id, AVG(rating_avg) AS prior_mean
      FROM eligible
      WHERE rated
      GROUP BY country_slug, city_slug, category_tag_id
    ),
    scored AS (
      SELECT el.*,
             CASE WHEN el.rated THEN
               (el.rating_count::float8 / (el.rating_count + ${BAYESIAN_M})) * el.rating_avg
               + (${BAYESIAN_M}::float8 / (el.rating_count + ${BAYESIAN_M})) * p.prior_mean
             END AS score
      FROM eligible el
      LEFT JOIN prior p
        ON p.country_slug = el.country_slug
       AND p.city_slug = el.city_slug
       AND p.category_tag_id = el.category_tag_id
    ),
    best AS (
      SELECT DISTINCT ON (country_slug, city_slug, category_tag_id, experience_id) *
      FROM scored
      ORDER BY country_slug, city_slug, category_tag_id, experience_id,
               rated DESC, score DESC NULLS LAST, tour_id COLLATE "C" ASC
    ),
    ranked AS (
      SELECT b.*,
             ROW_NUMBER() OVER (
               PARTITION BY country_slug, city_slug, category_tag_id
               ORDER BY rated DESC, score DESC NULLS LAST, tour_id COLLATE "C" ASC
             ) AS rank_no,
             COUNT(*) OVER (PARTITION BY country_slug, city_slug, category_tag_id) AS total
      FROM best b
    )`;
}

/** A city the feed serves: matched to the database on `countrySlug` plus `slug`. */
export interface FeedCity {
  readonly slug: string;
  readonly countrySlug: string;
}

/**
 * Provider token for the served city list. Production never sets it, so the
 * list is the curated cities in world order; the integration spec provides a
 * fixture city so its assertions do not depend on what the database holds.
 */
export const CANVAS_FEED_CITIES = Symbol("CANVAS_FEED_CITIES");

interface CacheEntry<T> {
  expiresAt: number;
  value: Promise<T>;
}

@Injectable()
export class CanvasService {
  /** `summaries`, and `city.category` per bucket: at most 43 keys, since slugs are checked first. */
  private readonly cache = new Map<string, CacheEntry<unknown>>();

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(CANVAS_FEED_CITIES) private readonly cities: readonly FeedCity[] = CURATED_CITIES,
  ) {}

  /** `GET /v1/canvas/buckets`: one summary per bucket with at least one eligible tile, in world order (AC-F1). */
  getSummaries(): Promise<CanvasBucketsResponse> {
    return this.cached("summaries", () => this.loadSummaries());
  }

  /**
   * `GET /v1/canvas/buckets/:citySlug/:categorySlug` (AC-F2).
   * @throws {NotFoundException} for an unknown city or category slug, or a bucket with no eligible tile.
   */
  async getBucket(citySlug: string, categorySlug: string): Promise<CanvasBucketResponse> {
    const city = this.cities.find((c) => c.slug === citySlug);
    if (!city) throw new NotFoundException("Unknown city");
    const category = categoryBySlug(categorySlug);
    if (!category) throw new NotFoundException("Unknown category");

    const bucket = await this.cached(`${city.slug}.${category.slug}`, () =>
      this.loadBucket(city.countrySlug, city.slug, category.tagId),
    );
    if (!bucket) throw new NotFoundException("No tours in this bucket");
    return bucket;
  }

  /** Reuse a computed value for {@link CACHE_TTL_MS}; concurrent misses share one query; a failure is not kept. */
  private cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this.cache.get(key) as CacheEntry<T> | undefined;
    if (hit && hit.expiresAt > now) return hit.value;

    const value = load();
    this.cache.set(key, { expiresAt: now + CACHE_TTL_MS, value });
    value.catch(() => {
      if (this.cache.get(key)?.value === value) this.cache.delete(key);
    });
    return value;
  }

  private async loadSummaries(): Promise<CanvasBucketsResponse> {
    const cityPairs = Prisma.join(this.cities.map((c) => Prisma.sql`(${c.countrySlug}, ${c.slug})`));
    const rows = await this.prisma.$queryRaw<FeedRow[]>(Prisma.sql`
      ${rankedCte(Prisma.sql`
        t."primaryCategoryTagId" IN (${Prisma.join([...SHOWN_CATEGORY_TAG_IDS])})
        AND (c."countrySlug", c."slug") IN (${cityPairs})`)}
      SELECT * FROM ranked WHERE rank_no = 1`);

    const byBucket = new Map<string, FeedRow>();
    for (const row of rows) {
      byBucket.set(`${row.country_slug}/${row.city_slug}/${row.category_tag_id}`, row);
    }

    const buckets: CanvasBucketSummary[] = [];
    for (const city of this.cities) {
      for (const category of CANVAS_CATEGORY_COPY) {
        const row = byBucket.get(`${city.countrySlug}/${city.slug}/${category.tagId}`);
        if (!row) continue;
        const image = pickImage(row.images, row.image_url, 1);
        if (!image) continue;
        buckets.push({
          citySlug: city.slug,
          countrySlug: city.countrySlug,
          cityName: row.city_name,
          categorySlug: category.slug,
          categoryLabel: category.label,
          total: Number(row.total),
          image,
        });
      }
    }
    return { buckets };
  }

  private async loadBucket(
    countrySlug: string,
    citySlug: string,
    categoryTagId: number,
  ): Promise<CanvasBucketResponse | null> {
    const rows = await this.prisma.$queryRaw<FeedRow[]>(Prisma.sql`
      ${rankedCte(Prisma.sql`
        t."primaryCategoryTagId" = ${categoryTagId}
        AND c."countrySlug" = ${countrySlug}
        AND c."slug" = ${citySlug}`)}
      SELECT * FROM ranked WHERE rank_no <= ${MAX_TILES} ORDER BY rank_no`);
    if (rows.length === 0) return null;

    // A tile whose picture cannot be picked is dropped and the ranks close up.
    // The SQL filter makes that unreachable for a well formed row.
    const tiles: CanvasTile[] = [];
    for (const row of rows) {
      const image = pickImage(row.images, row.image_url, tiles.length + 1);
      if (!image) continue;
      tiles.push({
        id: row.experience_id,
        tourId: row.tour_id,
        rank: tiles.length + 1,
        title: row.title,
        image,
        durationMin: row.duration_min,
        price: { amountMinor: Number(row.price_minor), currency: row.currency },
        ratingAvg: row.rating_avg,
        ratingCount: row.rating_count,
      });
    }
    if (tiles.length === 0) return null;

    const first = rows[0]!;
    const category = CANVAS_CATEGORY_COPY.find((c) => c.tagId === categoryTagId)!;
    return {
      citySlug,
      countrySlug,
      cityName: first.city_name,
      categorySlug: category.slug,
      categoryLabel: category.label,
      total: Number(first.total),
      image: tiles[0]!.image,
      tiles,
    };
  }
}
