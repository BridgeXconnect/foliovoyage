/**
 * THROWAWAY (canvas performance spike, BRI-223). Frame time and long task
 * recorder. Frame times are requestAnimationFrame deltas, long tasks come from a
 * PerformanceObserver. Everything is exposed on `window.__spike` for Playwright.
 *
 * Only pan frames count. A pan window opens at the first user input that pans
 * the view (the engine's `onPanInput`) and closes `PAN_TAIL_MS` after the last
 * one, a drag's release included. A frame counts when it ends inside a window,
 * so idle time between pans never appears as frames. A frame that spans a time
 * the page was hidden (background tab, locked phone) is never recorded at all.
 */

/** How long after the last pan input its frames still count, in ms. */
export const PAN_TAIL_MS = 300;

/** A pan window, [first input, last input + tail], in performance.now() ms. */
export type PanWindow = [number, number];

/** Record one pan input at `now`: extend the open window, or open a new one. */
export function notePanInput(windows: PanWindow[], now: number, tail = PAN_TAIL_MS): void {
  const open = windows[windows.length - 1];
  if (open && now <= open[1]) open[1] = now + tail;
  else windows.push([now, now + tail]);
}

/**
 * The [end, delta] of the frames that ended inside a pan window (start exclusive,
 * end inclusive) and at or after `since`. Frames and windows are in time order.
 */
export function panFrameEntries(
  frames: readonly (readonly [number, number])[],
  windows: readonly PanWindow[],
  since = -Infinity,
): [number, number][] {
  const out: [number, number][] = [];
  let w = 0;
  for (const [t, delta] of frames) {
    while (w < windows.length && windows[w][1] < t) w++;
    if (w === windows.length) break;
    if (t > windows[w][0] && t >= since) out.push([t, delta]);
  }
  return out;
}

export const panFrameDeltas = (...args: Parameters<typeof panFrameEntries>): number[] =>
  panFrameEntries(...args).map(([, delta]) => delta);

/** A section crossing: the culler's range changed and the mounted set with it. */
export interface Crossing {
  /** performance.now() in the frame that crossed. */
  t: number;
  /** Tiles that enter and leave the mounted set. */
  added: number;
  removed: number;
  /** mount=react: render plus DOM commit of the new set, in ms. Null until React commits. */
  commitMs: number | null;
  /** mount=react: from the crossing to the start of React's render, in ms. */
  delayMs: number | null;
}

/** A frame ends within `windowMs` after a crossing when crossing < end <= crossing + windowMs. */
export const HITCH_MS = 25;
export const AFTER_CROSSING_MS = 100;

export interface CrossingSummary {
  frames: number;
  crossings: number;
  /** Frames longer than HITCH_MS, and how many of them end within AFTER_CROSSING_MS after a crossing. */
  hitches: number;
  hitchesAfterCrossing: number;
  /** The share of all frames that end within AFTER_CROSSING_MS after a crossing: what hitches would show by chance. */
  baseRate: number;
}

export function crossingSummary(
  frames: readonly (readonly [number, number])[],
  crossingTimes: readonly number[],
  hitchMs = HITCH_MS,
  windowMs = AFTER_CROSSING_MS,
): CrossingSummary {
  const times = [...crossingTimes].sort((a, b) => a - b);
  const after = (t: number) => {
    // The latest crossing before t.
    let lo = 0;
    let hi = times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    return lo > 0 && t - times[lo - 1] <= windowMs;
  };
  let hitches = 0;
  let hitchesAfterCrossing = 0;
  let framesAfter = 0;
  for (const [t, delta] of frames) {
    const near = after(t);
    if (near) framesAfter++;
    if (delta > hitchMs) {
      hitches++;
      if (near) hitchesAfterCrossing++;
    }
  }
  return {
    frames: frames.length,
    crossings: times.length,
    hitches,
    hitchesAfterCrossing,
    baseRate: frames.length ? framesAfter / frames.length : 0,
  };
}

/** What the overlay freezes on when a scripted pan ends. */
export interface RunResult extends CrossingSummary {
  p50: number;
  p95: number;
  p99: number;
  worst: number;
  /** View distance covered, in px, and the run's length in s. */
  distance: number;
  seconds: number;
  maxMounted: number;
  /** Tiles mounted per crossing, mean and max. */
  addedMean: number;
  addedMax: number;
  /** mount=react: commit ms per crossing. mount=batch: ms per drain frame. p50, p95, max. */
  workP50: number;
  workP95: number;
  workMax: number;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

export interface SpikeStats {
  /** [end timestamp, delta] of every visible frame since the last reset, pan or not. */
  frames: [number, number][];
  /** Pan windows since the last reset. */
  windows: PanWindow[];
  longTasks: { start: number; duration: number }[];
  mounted: number;
  maxMounted: number;
  clicks: number;
  /** Image tiles mounted since load, a remount counted again. */
  imageMounts: number;
  /** Decoded pixel area of each distinct image mounted since load, by URL. */
  imagePixels: Map<string, number>;
  /** Section crossings since the last reset. */
  crossings: Crossing[];
  /** mount=batch: ms of each frame's imperative show/hide work since the last reset. */
  drainMs: number[];
  /** View distance moved since the last reset, in px. */
  distance: number;
  /** The last scripted pan's result, once it has finished. */
  autoResult: RunResult | null;
  /** Called by the page on every pan input. */
  panInput(): void;
  /** Deltas of the pan frames since the last reset, or since `since`. */
  panFrames(since?: number): number[];
  /** Long tasks that ended inside a pan window. */
  panLongTasks(): { start: number; duration: number }[];
  /** Summary of the pan frames since the last reset. */
  summary(seconds: number): RunResult;
  reset(): void;
}

declare global {
  interface Window {
    __spike?: SpikeStats;
  }
}

export function startRecorder(): { stats: SpikeStats; stop(): void } {
  let last = 0;
  const stats: SpikeStats = {
    frames: [],
    windows: [],
    longTasks: [],
    mounted: 0,
    maxMounted: 0,
    clicks: 0,
    imageMounts: 0,
    imagePixels: new Map(),
    crossings: [],
    drainMs: [],
    distance: 0,
    autoResult: null,
    panInput() {
      notePanInput(stats.windows, performance.now());
    },
    panFrames(since) {
      return panFrameDeltas(stats.frames, stats.windows, since);
    },
    panLongTasks() {
      return stats.longTasks.filter((task) =>
        stats.windows.some(([start, end]) => task.start + task.duration > start && task.start + task.duration <= end),
      );
    },
    summary(seconds) {
      const entries = panFrameEntries(stats.frames, stats.windows);
      const deltas = entries.map(([, d]) => d);
      const added = stats.crossings.map((c) => c.added);
      const work = stats.drainMs.length
        ? stats.drainMs
        : stats.crossings.flatMap((c) => (c.commitMs === null ? [] : [c.commitMs]));
      return {
        ...crossingSummary(
          entries,
          stats.crossings.map((c) => c.t),
        ),
        p50: percentile(deltas, 50),
        p95: percentile(deltas, 95),
        p99: percentile(deltas, 99),
        worst: Math.max(0, ...deltas),
        distance: stats.distance,
        seconds,
        maxMounted: stats.maxMounted,
        addedMean: added.length ? added.reduce((a, b) => a + b, 0) / added.length : 0,
        addedMax: Math.max(0, ...added),
        workP50: percentile(work, 50),
        workP95: percentile(work, 95),
        workMax: Math.max(0, ...work),
      };
    },
    reset() {
      stats.crossings = [];
      stats.drainMs = [];
      stats.distance = 0;
      stats.frames = [];
      stats.windows = [];
      stats.longTasks = [];
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

  window.__spike = stats;
  return {
    stats,
    stop() {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
      observer?.disconnect();
    },
  };
}
