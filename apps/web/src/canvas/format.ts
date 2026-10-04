/** Caption text for canvas tiles (spec 0004, AC-T1). Pure. */

/** `45 min`, `2 h`, `2 h 30 min`, `3 days`; null when unknown or not positive. */
export function formatDuration(minutes: number | null): string | null {
  if (minutes === null || minutes <= 0) return null;
  if (minutes < 60) return `${minutes} min`;
  if (minutes >= 24 * 60 && minutes % (24 * 60) === 0) {
    const days = minutes / (24 * 60);
    return `${days} ${days === 1 ? "day" : "days"}`;
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** `from $35`, using the currency's own minor unit; a whole amount drops its decimals. */
export function formatPrice(amountMinor: number, currency: string): string {
  let format: Intl.NumberFormat;
  try {
    format = new Intl.NumberFormat("en-US", { style: "currency", currency });
  } catch {
    return `from ${(amountMinor / 100).toFixed(2)} ${currency}`;
  }
  const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
  const amount = amountMinor / 10 ** digits;
  const whole = Number.isInteger(amount);
  const out = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: whole ? 0 : digits,
    maximumFractionDigits: whole ? 0 : digits,
  });
  return `from ${out.format(amount)}`;
}

/** `★ 4.8 (1,234)`; null without a rating. */
export function formatRating(avg: number | null, count: number | null): string | null {
  if (avg === null || !count) return null;
  return `★ ${avg.toFixed(1)} (${count.toLocaleString("en-US")})`;
}
