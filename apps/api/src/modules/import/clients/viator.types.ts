import { z } from "zod";

/**
 * Viator `/products/modified-since` response shape (ST-6 / BRI-103).
 *
 * We deliberately validate only the envelope we depend on — the `products`
 * array and the `nextCursor` used to drive pagination — and keep each product
 * as an opaque record. The raw bytes are archived verbatim to R2, so ST-7
 * (normalization) works from the archive and owns the full product schema; the
 * client has no reason to couple itself to every field Viator returns.
 */
export const viatorModifiedSinceResponseSchema = z.object({
  /** Products in this page. Opaque here; normalized downstream. */
  products: z.array(z.record(z.string(), z.unknown())).default([]),
  /**
   * Cursor for the next page. Absent/empty once the crawl is exhausted — that
   * is the pagination stop condition.
   */
  nextCursor: z.string().optional(),
});

export type ViatorModifiedSinceResponse = z.infer<
  typeof viatorModifiedSinceResponseSchema
>;

/**
 * Viator `POST /products/bulk` response (BRI-227). Observed against the live
 * API on 2026-10-02: a **bare array** of the same full product records
 * `/products/modified-since` returns inside `products[]` (not wrapped in an
 * object), so the elements reuse the same opaque record shape and only the
 * wrapper is new. Normalization stays downstream.
 */
export const viatorBulkResponseSchema = z.array(
  z.record(z.string(), z.unknown()),
);

/** A single Viator product, unmodelled at this layer. */
export type ViatorProduct = Record<string, unknown>;
