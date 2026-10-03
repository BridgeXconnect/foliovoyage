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
 * The deltas of the frames that ended inside a pan window (start exclusive, end
 * inclusive) and at or after `since`. Frames and windows are in time order.
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
  /** Called by the page on every pan input. */
  panInput(): void;
  /** Deltas of the pan frames since the last reset, or since `since`. */
  panFrames(since?: number): number[];
  /** Long tasks that ended inside a pan window. */
  panLongTasks(): { start: number; duration: number }[];
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
    reset() {
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
