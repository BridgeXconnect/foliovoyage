"use client";

/**
 * The `/discover?perf=1` overlay (BRI-223), a permanent dev tool. Loaded with
 * `next/dynamic` only when the param is set, so it costs nothing otherwise.
 *
 * Shows pan frame stats once a second (only frames inside a pan window count,
 * glides and eases included), the mounted tile counts, the clicks that got
 * through, and the inertia params in effect. `auto=1` runs the scripted 30 s pan
 * through the controller's `panBy`, then freezes on the result, which is also
 * left on `window.__canvasPerf.autoResult` for Playwright.
 */

import { useEffect, useState, type RefObject } from "react";
import { CITY_REGION_SLOT_COLUMNS, SLOT_HEIGHT, SLOT_WIDTH } from "@folio/shared";
import type { InertiaConfig, PanController } from "../engine";
import { AUTO_COUNTDOWN_MS, AUTO_RUN_MS, autoPanPosition } from "./auto-pan";
import { PAN_TAIL_MS, startRecorder, type PanStats, type PanSummary } from "./stats";

interface Props {
  controllerRef: RefObject<PanController | null>;
  canvasRef: RefObject<HTMLElement | null>;
  auto: boolean;
  inertia: InertiaConfig;
  onStats: (stats: PanStats | null) => void;
}

type AutoPhase = { phase: "off" } | { phase: "countdown"; left: number } | { phase: "running"; left: number } | { phase: "done" };

const ms = (v: number) => v.toFixed(1);

function lines(s: PanSummary, clicks: number, mounted: number): string[] {
  return [
    `pan p50 ${ms(s.p50)} · p95 ${ms(s.p95)} · p99 ${ms(s.p99)} · worst ${ms(s.worst)} ms`,
    `frames ${s.frames} · >25ms ${s.hitches} · long tasks ${s.longTasks}`,
    `mounted ${mounted} · max ${s.maxMounted} · clicks ${clicks}`,
    `distance ${Math.round(s.distance)} px`,
  ];
}

export default function PerfOverlay({ controllerRef, canvasRef, auto, inertia, onStats }: Props) {
  const [stats, setStats] = useState<PanStats | null>(null);
  const [live, setLive] = useState<string[]>([]);
  const [autoPhase, setAutoPhase] = useState<AutoPhase>({ phase: auto ? "countdown" : "off", left: 3 } as AutoPhase);
  const [result, setResult] = useState<string[] | null>(null);

  useEffect(() => {
    const recorder = startRecorder();
    setStats(recorder.stats);
    onStats(recorder.stats);
    const started = performance.now();
    const timer = setInterval(() => {
      const s = recorder.stats;
      setLive(lines(s.summary((performance.now() - started) / 1000), s.clicks, s.mounted));
    }, 1000);
    return () => {
      clearInterval(timer);
      onStats(null);
      recorder.stop();
    };
  }, [onStats]);

  useEffect(() => {
    if (!auto || !stats) return;
    let raf = 0;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const countdownStart = performance.now();

    const countdown = () => {
      const left = AUTO_COUNTDOWN_MS - (performance.now() - countdownStart);
      if (left > 0) {
        setAutoPhase({ phase: "countdown", left: Math.ceil(left / 1000) });
        timers.push(setTimeout(countdown, 250));
        return;
      }
      begin();
    };

    const begin = () => {
      const controller = controllerRef.current;
      const canvas = canvasRef.current;
      if (!controller || !canvas || cancelled) return;
      // Start from the region's top left, then measure only the run itself.
      controller.panBy({ x: -controller.view.x, y: -controller.view.y });
      const spanX = SLOT_WIDTH * CITY_REGION_SLOT_COLUMNS - canvas.clientWidth;
      const spanY = SLOT_HEIGHT - canvas.clientHeight;
      let start = 0;
      let last = { x: 0, y: 0 };
      const step = (t: number) => {
        if (cancelled) return;
        if (!start) {
          start = t;
          stats.reset();
        }
        const elapsed = Math.min(AUTO_RUN_MS, t - start);
        const p = autoPanPosition(elapsed, spanX, spanY);
        stats.panInput();
        controller.panBy({ x: p.x - last.x, y: p.y - last.y });
        last = p;
        if (elapsed < AUTO_RUN_MS) {
          setAutoPhase({ phase: "running", left: Math.ceil((AUTO_RUN_MS - elapsed) / 1000) });
          raf = requestAnimationFrame(step);
          return;
        }
        timers.push(
          setTimeout(() => {
            const summary = stats.summary(AUTO_RUN_MS / 1000);
            stats.autoResult = summary;
            setResult(lines(summary, stats.clicks, stats.mounted));
            setAutoPhase({ phase: "done" });
          }, PAN_TAIL_MS + 50),
        );
      };
      raf = requestAnimationFrame(step);
    };

    countdown();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
    };
  }, [auto, stats, controllerRef, canvasRef]);

  const status =
    autoPhase.phase === "countdown" ? `auto pan starts in ${autoPhase.left} s` :
    autoPhase.phase === "running" ? `auto pan running, ${autoPhase.left} s left` :
    autoPhase.phase === "done" ? "auto pan result (frozen)" : null;

  return (
    <div className="pointer-events-none fixed top-2 left-2 z-10 max-w-[calc(100vw-1rem)] rounded-lg bg-ink/85 px-3 py-2 font-mono text-[11px] leading-4 text-surface">
      {status ? <p className="font-semibold">{status}</p> : null}
      {(result ?? live).map((line) => (
        <p key={line.slice(0, 8)}>{line}</p>
      ))}
      <p>
        tau {inertia.tau} · window {inertia.velocityWindow} · vmax {inertia.maxVelocity}
      </p>
      {!auto ? (
        <button
          type="button"
          className="pointer-events-auto mt-1 underline"
          onClick={() => {
            stats?.reset();
            setLive([]);
          }}
        >
          reset
        </button>
      ) : null}
    </div>
  );
}
