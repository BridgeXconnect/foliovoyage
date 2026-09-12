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
