import type { ExchangeRateResolver } from "./exchange-rate-resolver";
import type { TourDTO } from "./normalizer";

/**
 * Convert a supplier "from" price in minor units to reference-currency (USD)
 * minor units via an FX rate. Null in / no rate → null out (never fabricated).
 * `priceMinor` is uniformly `major × 100` (set that way by `price-resolver.ts`
 * `toResolvedPrice`), so USD minor = round(priceMinor × rate).
 */
export function computeReferenceMinor(
  priceMinor: number | null,
  rate: number | undefined,
): number | null {
  if (priceMinor === null || rate === undefined || !Number.isFinite(rate)) {
    return null;
  }
  return Math.round(priceMinor * rate);
}

/**
 * Attach-after-price-resolution batch step (category/currency promotion plan,
 * Task 4) — same shape as {@link import("./location-resolver").LocationResolver}
 * and {@link import("./price-resolver").PriceResolver}: `import.pipeline.ts`
 * calls this once per page, right after {@link import("./price-resolver").PriceResolver.attachPrices}.
 *
 * Resolves every FX rate this page's tours need in **one** batched
 * {@link ExchangeRateResolver.ratesToUsd} call (never one call per tour), then
 * maps each tour's supplier-currency `price_minor` to a reference-currency
 * (USD) `price_reference_minor` via the pure {@link computeReferenceMinor}.
 * Input DTOs are never mutated — each result is a new object, mirroring the
 * other attach-after-normalize steps.
 */
export class ReferencePriceResolver {
  constructor(
    private readonly rates: ExchangeRateResolver,
    /** Reference currency every reference price is expressed in ("USD"). */
    private readonly referenceCurrency: string,
  ) {}

  async attachReferencePrices(tours: TourDTO[]): Promise<TourDTO[]> {
    const currencies = [
      ...new Set(
        tours
          .map((t) => t.currency)
          .filter((c): c is string => c !== null)
          .map((c) => c.toUpperCase()),
      ),
    ];
    const rates = await this.rates.ratesToUsd(currencies);

    return tours.map((tour) => {
      const rate =
        tour.currency === null ? undefined : rates.get(tour.currency.toUpperCase());
      const price_reference_minor = computeReferenceMinor(tour.price_minor, rate);
      return {
        ...tour,
        price_reference_minor,
        price_reference_currency:
          price_reference_minor === null ? null : this.referenceCurrency,
      };
    });
  }
}
