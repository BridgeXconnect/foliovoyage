import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "../../app.module";
import { PrismaService } from "../../prisma/prisma.service";
import { ExchangeRateResolver } from "./exchange-rate-resolver";
import { computeReferenceMinor } from "./reference-price";

/**
 * One-time backfill of `Tour.priceReferenceMinor` over the existing catalogue
 * (category/currency promotion plan, Task 6).
 *
 * Every row upserted before the Task 3/4 ingest changes landed has
 * `priceReferenceMinor: null` even though it has a priced `priceMinor` +
 * `currency` — the USD reference value is only computed going forward, at
 * ingest. This CLI closes that gap once, for the ~29,624-row backlog, using
 * the exact same pure conversion (`computeReferenceMinor`) and FX resolver
 * (`ExchangeRateResolver.ratesToUsd`) the live pipeline uses, so a backfilled
 * row and a freshly-ingested row are computed identically.
 *
 * Never fabricates a value: a currency `ExchangeRateResolver` can't resolve a
 * rate for is logged and left `null` (same "honest, never a fabricated band"
 * rule Task 5's band fix relies on).
 *
 * Usage (from the repo root, against the real DB — always via Doppler):
 *
 *   doppler run -- pnpm --filter @folio/api exec ts-node src/modules/import/backfill-reference-price.cli.ts [--dry-run]
 *
 * `--dry-run` computes and reports the same totals without writing anything.
 */

const BATCH_SIZE = 1000;
/**
 * Max concurrent in-flight `prisma.tour.update()` calls. Kept well under the
 * Prisma client's connection pool limit (17 in this environment) — firing a
 * full 1000-row batch via one unthrottled `Promise.all` exhausted the pool
 * and crashed a real run (P2024) after only partially writing that batch.
 */
const WRITE_CONCURRENCY = 8;

interface PricedRow {
  id: string;
  priceMinor: bigint | null;
  currency: string | null;
}

interface PendingWrite {
  id: string;
  referenceMinor: number;
}

async function main(): Promise<void> {
  const logger = new Logger("backfill-reference-price");
  const dryRun = process.argv.includes("--dry-run");

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["log", "warn", "error"],
  });
  app.enableShutdownHooks();

  try {
    const prisma = app.get(PrismaService);
    const rates = app.get(ExchangeRateResolver);

    const whereClause = {
      priceReferenceMinor: null,
      priceMinor: { not: null },
      currency: { not: null },
      deletedAt: null,
    } as const;

    // Step 1: distinct currencies among the rows needing a backfill.
    const distinctCurrencies = await prisma.tour.findMany({
      where: whereClause,
      distinct: ["currency"],
      select: { currency: true },
    });
    const currencies = distinctCurrencies
      .map((row) => row.currency)
      .filter((c): c is string => c !== null);

    logger.log(
      `Found ${currencies.length} distinct currency/currencies needing a reference price: ` +
        currencies.join(", "),
    );

    // Step 2: resolve every rate once, up front.
    const rateByCurrency = await rates.ratesToUsd(currencies);
    const unresolvedCurrencies = currencies.filter(
      (c) => !rateByCurrency.has(c.toUpperCase()),
    );
    if (unresolvedCurrencies.length > 0) {
      logger.warn(
        `No FX rate resolved for: ${unresolvedCurrencies.join(", ")} — ` +
          `rows in these currencies will be left null, never fabricated.`,
      );
    }

    // Step 3: keyset-paginate on id, computing + updating per row (each row's
    // update carries a distinct computed value, so this cannot be a single
    // updateMany). Writes within a page are chunked to WRITE_CONCURRENCY
    // concurrent `prisma.tour.update()` calls at a time — a full page fired
    // as one unthrottled Promise.all previously exhausted the connection
    // pool (see WRITE_CONCURRENCY comment above).
    let updated = 0;
    let skippedNoRate = 0;
    const perCurrency = new Map<string, { updated: number; skipped: number }>();
    let cursor: string | undefined;

    for (;;) {
      const batch: PricedRow[] = await prisma.tour.findMany({
        where: whereClause,
        select: { id: true, priceMinor: true, currency: true },
        orderBy: { id: "asc" },
        take: BATCH_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });

      if (batch.length === 0) break;

      const pendingWrites: PendingWrite[] = [];
      for (const row of batch) {
        // The where clause guarantees these are non-null; the narrowing is
        // just to satisfy Prisma's generated (unnarrowed) select type.
        if (row.currency === null || row.priceMinor === null) continue;
        const currency = row.currency;
        const stats = perCurrency.get(currency) ?? { updated: 0, skipped: 0 };
        const rate = rateByCurrency.get(currency.toUpperCase());
        const referenceMinor = computeReferenceMinor(
          Number(row.priceMinor),
          rate,
        );

        if (referenceMinor === null) {
          skippedNoRate += 1;
          stats.skipped += 1;
          perCurrency.set(currency, stats);
          continue;
        }

        updated += 1;
        stats.updated += 1;
        perCurrency.set(currency, stats);

        if (!dryRun) {
          pendingWrites.push({ id: row.id, referenceMinor });
        }
      }

      if (pendingWrites.length > 0) {
        try {
          for (let i = 0; i < pendingWrites.length; i += WRITE_CONCURRENCY) {
            const chunk = pendingWrites.slice(i, i + WRITE_CONCURRENCY);
            await Promise.all(
              chunk.map((write) =>
                prisma.tour.update({
                  where: { id: write.id },
                  data: {
                    priceReferenceMinor: write.referenceMinor,
                    priceReferenceCurrency: "USD",
                  },
                }),
              ),
            );
          }
        } catch (error) {
          logger.error(
            `Write failed partway through a batch — stopping. ` +
              `${error instanceof Error ? error.message : String(error)}`,
          );
          console.log(
            JSON.stringify(
              {
                dryRun,
                aborted: true,
                updated,
                skippedNoRate,
                perCurrency: Object.fromEntries(perCurrency),
              },
              null,
              2,
            ),
          );
          process.exitCode = 1;
          return;
        }
      }

      cursor = batch[batch.length - 1]!.id;
      if (batch.length < BATCH_SIZE) break;
    }

    logger.log(
      `${dryRun ? "[dry-run] Would update" : "Updated"} ${updated} row(s); ` +
        `skipped ${skippedNoRate} row(s) with no resolvable FX rate.`,
    );

    console.log(
      JSON.stringify(
        {
          dryRun,
          updated,
          skippedNoRate,
          perCurrency: Object.fromEntries(perCurrency),
        },
        null,
        2,
      ),
    );

    process.exitCode = 0;
  } finally {
    await app.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
