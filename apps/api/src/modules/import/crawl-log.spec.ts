import { describe, expect, it } from "@jest/globals";

import {
  endOfFeedSignal,
  formatCrawlEndLine,
  formatCrawlPageLine,
  formatCrawlStartLine,
  shortCursor,
} from "./crawl-log";

describe("shortCursor", () => {
  it("logs short cursors whole and names the missing ones", () => {
    expect(shortCursor("abc")).toBe("abc");
    expect(shortCursor(undefined)).toBe("none");
    expect(shortCursor(null)).toBe("none");
    expect(shortCursor("")).toBe("empty");
  });

  it("truncates long cursors but keeps two different ones distinguishable", () => {
    const a = `${"x".repeat(60)}AAAAAAAAAA`;
    const b = `${"x".repeat(60)}BBBBBBBBBB`;
    expect(shortCursor(a)).toBe("xxxxxxxxxx…AAAAAAAAAA(len=70)");
    expect(shortCursor(a)).not.toBe(shortCursor(b));
    // Different head, same tail and length must differ too.
    expect(shortCursor(`1${"x".repeat(69)}`)).not.toBe(shortCursor(`2${"x".repeat(69)}`));
  });
});

describe("crawl log lines (BRI-227)", () => {
  const now = new Date("2026-10-09T12:00:05.000Z");

  it("page line carries every required field", () => {
    const line = formatCrawlPageLine({
      now,
      runId: "run-1",
      trigger: "manual",
      page: 3,
      cursorSent: "C2",
      cursorReceived: "C3",
      status: 200,
      products: 500,
      runningTotal: 1500,
      attempts: 2,
    });
    expect(line).toBe(
      "[crawl] ts=2026-10-09T12:00:05.000Z run=run-1 trigger=manual page=3 " +
        "cursor_sent=C2 cursor_received=C3 status=200 products=500 total=1500 attempts=2",
    );
  });

  it("page line says none for a first page and end-of-feed page, n/a for unknown status", () => {
    const line = formatCrawlPageLine({
      now,
      runId: "r",
      trigger: "scheduled",
      page: 1,
      cursorSent: undefined,
      cursorReceived: undefined,
      status: undefined,
      products: 0,
      runningTotal: 0,
      attempts: undefined,
    });
    expect(line).toContain("cursor_sent=none cursor_received=none status=n/a");
    expect(line).toContain("trigger=scheduled");
    expect(line).toContain("attempts=n/a");
  });

  it("start line states mode and parameters", () => {
    expect(
      formatCrawlStartLine({
        now,
        runId: "r",
        trigger: "manual",
        mode: "full",
        startCursor: null,
        modifiedSince: undefined,
      }),
    ).toBe(
      "[crawl] start ts=2026-10-09T12:00:05.000Z run=r trigger=manual mode=full " +
        "start_cursor=none modified_since=none",
    );
  });

  it("end line carries stop reason, totals and duration", () => {
    const line = formatCrawlEndLine({
      now,
      runId: "r",
      trigger: "manual",
      status: "failed",
      reason: "guard-failure",
      pages: 21,
      products: 10500,
      startedAt: new Date("2026-10-09T11:58:05.000Z"),
      detail: "below floor",
    });
    expect(line).toContain("status=failed stop_reason=guard-failure pages=21 products=10500 duration_s=120");
    expect(line).toContain('detail="below floor"');
  });

  it("names the end-of-feed signal: absent, empty or none", () => {
    expect(endOfFeedSignal(undefined)).toBe("next-cursor-absent");
    expect(endOfFeedSignal("")).toBe("next-cursor-empty");
    expect(endOfFeedSignal("C9")).toBeNull();
  });
});
