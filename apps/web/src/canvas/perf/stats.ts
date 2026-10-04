/**
 * Pan frame recorder for the `/discover?perf=1` overlay (BRI-223), kept from the
 * canvas performance spike as a permanent dev tool. Frame times are
 * requestAnimationFrame deltas, long tasks come from a PerformanceObserver.
 * Everything is exposed on `window.__canvasPerf` for Playwright.
 *
 * Only pan frames count. A pan window opens at the first input that pans the
 * view (the engine's `onPanInput`, glide and ease frames included) and closes
 * `PAN_TAIL_MS` after the last one. A frame counts when it ends inside a window,
 * so idle time between pans never appears as frames. A frame that spans a time
 * the page was hidden (background tab, locked phone) is never recorded at all.
 */

/** How long after the last pan input its frames still count, in ms. */
export const PAN_TAIL_MS = 300;

/** A frame longer than this, in ms, is a visible hitch. */
export const HITCH_MS = 25;

/** A pan window, [first input, last input + tail], in performance.now() ms. */
export type PanWindow = [number, number];

/** Record one pan input at `now`: extend the open window, or open a new one. */
export function notePanInput(windows: PanWindow[], now: number, tail = PAN_TAIL_MS): void {
  const open = windows[windows.length - 1];
  if (open && now <= open[1]) open[1] = now + tail;
  else windows.push([now, now + tail]);
}

/**
 * The deltas of the frames that ended inside a pan window (start exclusive, end
 * inclusive) and at or after `since`. Frames are [end, delta]; frames and
 * windows are in time order.
 */
export function panFrameDeltas(
  frames: readonly (readonly [number, number])[],
  windows: readonly PanWindow[],
  since = -Infinity,
): number[] {
  const out: number[] = [];
  let w = 0;
  for (const [t, delta] of frames) {
    while (w < windows.length && windows[w][1] < t) w++;
    if (w === windows.length) break;
    if (t > windows[w][0] && t >= since) out.push(delta);
  }
  return out;
}

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

/** What the overlay shows, and freezes on when a scripted pan ends. */
export interface PanSummary {
  p50: number;
  p95: number;
  p99: number;
  worst: number;
  frames: number;
  /** Frames longer than HITCH_MS. */
  hitches: number;
  /** View distance covered, in px. */
  distance: number;
  seconds: number;
  maxMounted: number;
  longTasks: number;
}

export function summarize(
  deltas: readonly number[],
  extra: Pick<PanSummary, "distance" | "seconds" | "maxMounted" | "longTasks">,
): PanSummary {
  return {
    p50: percentile(deltas, 50),
    p95: percentile(deltas, 95),
    p99: percentile(deltas, 99),
    worst: Math.max(0, ...deltas),
    frames: deltas.length,
    hitches: deltas.filter((d) => d > HITCH_MS).length,
    ...extra,
  };
}

export interface PanStats {
  /** [end timestamp, delta] of every visible frame since the last reset, pan or not. */
  frames: [number, number][];
  windows: PanWindow[];
  longTasks: { start: number; duration: number }[];
  mounted: number;
  maxMounted: number;
  /** Tile clicks that got through the pan controller since the last reset. */
  clicks: number;
  /** View distance moved since the last reset, in px. */
  distance: number;
  /** The last scripted pan's result, once it has finished. */
  autoResult: PanSummary | null;
  panInput(): void;
  /** Record the mounted tile count after a cull. */
  noteMounted(count: number): void;
  /** Record a view move, for the distance column. */
  noteMove(dx: number, dy: number): void;
  panFrames(since?: number): number[];
  summary(seconds: number): PanSummary;
  reset(): void;
}

declare global {
  interface Window {
    __canvasPerf?: PanStats;
  }
}

export function startRecorder(): { stats: PanStats; stop(): void } {
  let last = 0;
  const panLongTasks = () =>
    stats.longTasks.filter((task) =>
      stats.windows.some(([start, end]) => task.start + task.duration > start && task.start + task.duration <= end),
    );
  const stats: PanStats = {
    frames: [],
    windows: [],
    longTasks: [],
    mounted: 0,
    maxMounted: 0,
    clicks: 0,
    distance: 0,
    autoResult: null,
    panInput() {
      notePanInput(stats.windows, performance.now());
    },
    noteMounted(count) {
      stats.mounted = count;
      stats.maxMounted = Math.max(stats.maxMounted, count);
    },
    noteMove(dx, dy) {
      stats.distance += Math.hypot(dx, dy);
    },
    panFrames(since) {
      return panFrameDeltas(stats.frames, stats.windows, since);
    },
    summary(seconds) {
      return summarize(stats.panFrames(), {
        distance: stats.distance,
        seconds,
        maxMounted: stats.maxMounted,
        longTasks: panLongTasks().length,
      });
    },
    reset() {
      stats.frames = [];
      stats.windows = [];
      stats.longTasks = [];
      stats.distance = 0;
      stats.maxMounted = stats.mounted;
      stats.clicks = 0;
      last = 0;
    },
  };

  let raf = 0;
  const tick = (t: number) => {
    if (last) stats.frames.push([t, t - last]);
    last = t;
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  // rAF stops while the page is hidden. Forget the last frame, so the first one
  // after the page comes back is not recorded with the hidden time as its delta.
  const onVisibility = () => {
    if (document.hidden) last = 0;
  };
  document.addEventListener("visibilitychange", onVisibility);

  let observer: PerformanceObserver | null = null;
  try {
    observer = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) stats.longTasks.push({ start: e.startTime, duration: e.duration });
    });
    observer.observe({ type: "longtask", buffered: false });
  } catch {
    // Safari has no longtask entries; the overlay shows 0.
  }

  window.__canvasPerf = stats;
  return {
    stats,
    stop() {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
      observer?.disconnect();
      if (window.__canvasPerf === stats) delete window.__canvasPerf;
    },
  };
}
