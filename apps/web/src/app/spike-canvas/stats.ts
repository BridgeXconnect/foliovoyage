/**
 * THROWAWAY (canvas performance spike, BRI-223). Frame time and long task
 * recorder. Frame times are requestAnimationFrame deltas, long tasks come from a
 * PerformanceObserver. Everything is exposed on `window.__spike` for Playwright.
 */

export interface SpikeStats {
  /** [timestamp, delta] pairs since the last reset. */
  frames: [number, number][];
  longTasks: { start: number; duration: number }[];
  mounted: number;
  maxMounted: number;
  clicks: number;
  reset(): void;
}

declare global {
  interface Window {
    __spike?: SpikeStats;
  }
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

export function startRecorder(): { stats: SpikeStats; stop(): void } {
  const stats: SpikeStats = {
    frames: [],
    longTasks: [],
    mounted: 0,
    maxMounted: 0,
    clicks: 0,
    reset() {
      stats.frames = [];
      stats.longTasks = [];
      stats.maxMounted = stats.mounted;
      stats.clicks = 0;
      last = 0;
    },
  };
  let last = 0;
  let raf = 0;
  const tick = (t: number) => {
    if (last) stats.frames.push([t, t - last]);
    last = t;
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

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
      observer?.disconnect();
    },
  };
}
