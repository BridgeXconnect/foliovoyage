import { Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { withTransientRetry, type TransientRetryOptions } from "./transient-retry";

/**
 * Prisma client extension that retries **standalone** queries on a transient
 * DB error (BRI-210), so call sites don't opt in one by one. Queries inside a
 * `$transaction` are never retried here: a drop kills the whole transaction,
 * so the caller's whole-transaction `withTransientRetry` owns that retry.
 *
 * Only operations on the allow-list below are retried, because a committed
 * write whose ack was lost runs again on retry.
 */

const READ_OPERATIONS: ReadonlySet<string> = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);

const ATOMIC_NUMBER_OPERATIONS: ReadonlySet<string> = new Set([
  "increment",
  "decrement",
  "multiply",
  "divide",
]);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

/**
 * True if `value` contains an atomic number operation at any depth. A JSON
 * column value with such a key is a false positive, which only costs a retry.
 */
function containsAtomicNumberOperation(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsAtomicNumberOperation);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(
    ([key, nested]) =>
      ATOMIC_NUMBER_OPERATIONS.has(key) || containsAtomicNumberOperation(nested),
  );
}

/**
 * Whether rerunning `operation` with `args` is safe after a lost ack.
 * `create`, raw queries, `*AndReturn` and anything unlisted are never retried.
 */
export function isRetryableOperation(operation: string, args: unknown): boolean {
  if (READ_OPERATIONS.has(operation)) return true;
  const a = isRecord(args) ? args : {};
  switch (operation) {
    case "delete":
    case "deleteMany":
      return true;
    case "update":
    case "updateMany":
      return !containsAtomicNumberOperation(a.data);
    case "upsert":
      return !containsAtomicNumberOperation(a.update);
    case "createMany":
      return a.skipDuplicates === true;
    default:
      return false;
  }
}

export type TransactionContext = "standalone" | "transaction" | "unknown";

/**
 * Whether a query hook is running inside a `$transaction`.
 *
 * RISK: this reads `__internalParams.transaction`, which is undocumented and
 * not in Prisma's types. On 6.19.3 it is `undefined` for a standalone query,
 * `{ kind: "itx" }` inside an interactive transaction and `{ kind: "batch" }`
 * inside an array transaction. Anything else is `"unknown"`, and callers must
 * not retry on unknown: retrying a query inside a dead transaction is the
 * failure this layer exists to avoid. The canary tests in
 * `transient-retry.extension.spec.ts` fail if a Prisma upgrade changes the
 * shape.
 */
export function classifyTransactionContext(hookParams: unknown): TransactionContext {
  if (!isRecord(hookParams)) return "unknown";
  const internal = hookParams.__internalParams;
  if (!isRecord(internal)) return "unknown";
  const transaction = internal.transaction;
  if (transaction === undefined) return "standalone";
  if (isRecord(transaction) && (transaction.kind === "itx" || transaction.kind === "batch")) {
    return "transaction";
  }
  return "unknown";
}

const defaultLogger = new Logger("TransientRetry");
let warnedUnknownTxContext = false;

/** Test-only: re-arm the once-per-process unknown-context warning. */
export function resetTxContextWarningForTests(): void {
  warnedUnknownTxContext = false;
}

interface QueryHookParams {
  model?: string;
  operation: string;
  args: unknown;
  query: (args: unknown) => Promise<unknown>;
}

export type StandaloneRetryDeps = Omit<TransientRetryOptions, "label">;

/** The extension's hook body, exported so it can be tested without a client. */
export async function retryStandaloneQuery(
  hookParams: unknown,
  deps: StandaloneRetryDeps = {},
): Promise<unknown> {
  const { model, operation, args, query } = hookParams as QueryHookParams;
  if (!isRetryableOperation(operation, args)) return query(args);

  const context = classifyTransactionContext(hookParams);
  if (context === "transaction") return query(args);
  if (context === "unknown") {
    if (!warnedUnknownTxContext) {
      warnedUnknownTxContext = true;
      (deps.logger ?? defaultLogger).warn(
        "Can't read Prisma's __internalParams.transaction (Prisma upgrade?); " +
          "standalone-query retry is disabled for this process.",
      );
    }
    return query(args);
  }

  return withTransientRetry(() => query(args), {
    ...deps,
    label: `${model ?? "?"}.${operation}`,
  });
}

export const transientRetryExtension = Prisma.defineExtension({
  name: "transient-retry",
  query: {
    $allModels: {
      $allOperations: (params) => retryStandaloneQuery(params),
    },
  },
});
