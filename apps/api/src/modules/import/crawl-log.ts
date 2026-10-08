/**
 * Per-page crawl log lines (BRI-227). Pure formatters, so the fields and the
 * stop reasons are unit-testable without a logger or a crawl.
 *
 * Plain `key=value` text, like the `[mem]` line in `import.pipeline.ts`: the
 * repo logs through Nest's `Logger`, and Nest's own timestamp is locale
 * formatted, so each line carries an explicit ISO 8601 UTC `ts`.
 */

/** Why a run (or a crawl loop) stopped. */
export type StopReason =
  | "end-of-feed"
  | "error"
  | "guard-failure"
  | "mass-deletion-guard"
  | "worker-crash";

/**
 * A cursor short enough for one log line that still tells two cursors apart:
 * head, tail and length. Short cursors are logged whole.
 */
export function shortCursor(cursor: string | null | undefined): string {
  if (cursor === undefined || cursor === null) return "none";
  if (cursor === "") return "empty";
  if (cursor.length <= 24) return cursor;
  return `${cursor.slice(0, 10)}…${cursor.slice(-10)}(len=${cursor.length})`;
}

export interface CrawlPageLine {
  now: Date;
  runId: string;
  trigger: string;
  /** 1-based page number within the run. */
  page: number;
  cursorSent: string | undefined;
  cursorReceived: string | undefined;
  status: number | undefined;
  products: number;
  /** Raw products fetched so far in the whole run, this page included. */
  runningTotal: number;
  /** HTTP attempts the retry helper made for this page (1 = no retry). */
  attempts: number | undefined;
}

export function formatCrawlPageLine(l: CrawlPageLine): string {
  return (
    `[crawl] ts=${l.now.toISOString()} run=${l.runId} trigger=${l.trigger} ` +
    `page=${l.page} cursor_sent=${shortCursor(l.cursorSent)} ` +
    `cursor_received=${shortCursor(l.cursorReceived)} status=${l.status ?? "n/a"} ` +
    `products=${l.products} total=${l.runningTotal} attempts=${l.attempts ?? "n/a"}`
  );
}

/** Full cursor values, for the `debug` level (dropped by the CLIs' logger config). */
export function formatCrawlCursorsDebug(
  runId: string,
  page: number,
  cursorSent: string | undefined,
  cursorReceived: string | undefined,
): string {
  return (
    `[crawl] run=${runId} page=${page} ` +
    `cursor_sent=${cursorSent ?? "none"} cursor_received=${cursorReceived ?? "none"}`
  );
}

export interface CrawlStartLine {
  now: Date;
  runId: string;
  trigger: string;
  /** `full` = no starting cursor; `resume` = seeded from an earlier run; `since` = explicit modifiedSince. */
  mode: "full" | "resume" | "since";
  startCursor: string | null;
  modifiedSince: string | undefined;
  /**
   * The completeness floor (`IMPORT_FULL_RUN_MIN_FETCHED`) a full run will be
   * held to: its value, or `null` when unset. Omitted (`undefined`) for modes
   * the guard does not apply to, which leaves the field off the line.
   */
  floor?: number | null;
}

export function formatCrawlStartLine(l: CrawlStartLine): string {
  return (
    `[crawl] start ts=${l.now.toISOString()} run=${l.runId} trigger=${l.trigger} ` +
    `mode=${l.mode} start_cursor=${shortCursor(l.startCursor)} ` +
    `modified_since=${l.modifiedSince ?? "none"}` +
    (l.floor === undefined ? "" : ` floor=${l.floor ?? "none"}`)
  );
}

export interface CrawlEndLine {
  now: Date;
  runId: string;
  trigger: string;
  status: string;
  reason: StopReason;
  pages: number | null;
  products: number;
  startedAt: Date;
  detail?: string;
}

export function formatCrawlEndLine(l: CrawlEndLine): string {
  const seconds = Math.round((l.now.getTime() - l.startedAt.getTime()) / 1000);
  return (
    `[crawl] end ts=${l.now.toISOString()} run=${l.runId} trigger=${l.trigger} ` +
    `status=${l.status} stop_reason=${l.reason} pages=${l.pages ?? 0} ` +
    `products=${l.products} duration_s=${seconds}` +
    (l.detail ? ` detail="${l.detail}"` : "")
  );
}

/** What the final page said about the feed ending. */
export function endOfFeedSignal(
  nextCursor: string | undefined,
): "next-cursor-absent" | "next-cursor-empty" | null {
  if (nextCursor === undefined) return "next-cursor-absent";
  if (nextCursor === "") return "next-cursor-empty";
  return null;
}
