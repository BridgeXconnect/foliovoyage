"use client";

/**
 * The `/discover` canvas (spec 0004, AC-L7 to AC-L16), slice 1: one city.
 *
 * The pan controller moves the world element; on each frame that changes the
 * view it reports here, and this component (1) recomputes the culler's section
 * range and re-renders only when it changes, (2) asks the bucket store for every
 * slot within one viewport of the visible area, and (3) times the view centre's
 * stay in a slot for `canvas_bucket_enter`. Only items in the section range are
 * mounted, so only their images load.
 *
 * `?perf=1` lazily loads the pan frame overlay; see `perf/PerfOverlay.tsx`.
 */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { SECTION_OVERSCAN, SECTION_SIZE, type CanvasBucketSummary, type CanvasCity } from "@folio/shared";
import { trackCanvasBucketEnter, trackCanvasTileClick } from "@/lib/analytics";
import { createBucketStore } from "./bucket-store";
import { CanvasItem, type ActivateHandler } from "./CanvasItem";
import {
  buildSectionIndex,
  createPanController,
  itemsInRange,
  sameRange,
  sectionRange,
  type PanController,
  type Point,
  type SectionRange,
  type Size,
} from "./engine";
import { parsePerfParams, type PerfParams } from "./perf/params";
import type { PanStats } from "./perf/stats";
import { REGION_SIZE, buildScene, citySlots, slotAt, slotsInRect, type Slot } from "./scene";

const PerfOverlay = dynamic(() => import("./perf/PerfOverlay"), { ssr: false });

const CULLER = { sectionSize: SECTION_SIZE, overscan: SECTION_OVERSCAN };

/** The view the canvas opens on: the region's top left, the first slot's title and rank 1. */
const INITIAL_VIEW: Point = { x: 0, y: 0 };

/** The viewport the server assumes for its first render: a phone, mobile first. */
const SERVER_VIEWPORT: Size = { width: 390, height: 844 };

/** How long the view centre must stay in a slot before `canvas_bucket_enter` fires, in ms. */
const BUCKET_DWELL_MS = 600;

/** Space kept between a focused tile and the viewport edge when focus pans to it, in px. */
const FOCUS_MARGIN = 24;

// One store per page load: a bucket is never fetched twice in a session.
const store = createBucketStore();

export default function DiscoverCanvas({
  city,
  summaries,
}: {
  city: CanvasCity;
  summaries: readonly CanvasBucketSummary[];
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<PanController | null>(null);
  const statsRef = useRef<PanStats | null>(null);
  const [perf, setPerf] = useState<PerfParams | null>(null);
  const [range, setRange] = useState<SectionRange>(() =>
    sectionRange(INITIAL_VIEW, SERVER_VIEWPORT, REGION_SIZE, CULLER),
  );
  const rangeRef = useRef(range);

  const version = useSyncExternalStore(store.subscribe, store.version, () => 0);
  const slots = useMemo(() => citySlots(city), [city]);
  const scene = useMemo(
    () => buildScene(city, summaries, (category) => store.get(city.slug, category)),
    // `version` changes whenever a bucket's state does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [city, summaries, version],
  );
  const index = useMemo(() => buildSectionIndex(scene.bounds, SECTION_SIZE), [scene]);
  const mounted = useMemo(() => itemsInRange(index, range), [index, range]);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const mountedCount = useRef(0);
  mountedCount.current = mounted.length;

  useEffect(() => {
    statsRef.current?.noteMounted(mounted.length);
  }, [mounted]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const world = worldRef.current;
    if (!canvas || !world) return;
    const params = parsePerfParams(window.location.search);
    setPerf(params);

    let lastView: Point | null = null;
    let centreSlot: Slot | null = slotAt(slots, {
      x: INITIAL_VIEW.x + canvas.clientWidth / 2,
      y: INITIAL_VIEW.y + canvas.clientHeight / 2,
    });
    // The slot the page opens on is not an entry: only a move into a slot is.
    let reported: Slot | null = centreSlot;
    let dwell: ReturnType<typeof setTimeout> | undefined;

    const onView = (view: Point, viewport: Size) => {
      if (lastView) statsRef.current?.noteMove(view.x - lastView.x, view.y - lastView.y);
      lastView = view;

      const next = sectionRange(view, viewport, REGION_SIZE, CULLER);
      if (!sameRange(next, rangeRef.current)) {
        rangeRef.current = next;
        setRange(next);
      }

      // AC-L10: fetch every slot within one viewport of the visible area.
      const near = { x: view.x - viewport.width, y: view.y - viewport.height, w: viewport.width * 3, h: viewport.height * 3 };
      for (const slot of slotsInRect(slots, near)) store.request(city.slug, slot.categorySlug);

      const slot = slotAt(slots, { x: view.x + viewport.width / 2, y: view.y + viewport.height / 2 });
      if (slot !== centreSlot) {
        centreSlot = slot;
        clearTimeout(dwell);
        if (slot && slot !== reported) {
          dwell = setTimeout(() => {
            reported = slot;
            trackCanvasBucketEnter({ city: city.slug, category: slot.categorySlug, source: "pan" });
          }, BUCKET_DWELL_MS);
        }
      }
    };

    const controller = createPanController({
      canvas,
      world,
      worldSize: REGION_SIZE,
      initialView: INITIAL_VIEW,
      inertia: params.inertia,
      onView,
      onPanInput: () => statsRef.current?.panInput(),
    });
    controllerRef.current = controller;
    return () => {
      clearTimeout(dwell);
      controller.destroy();
      controllerRef.current = null;
    };
  }, [city, slots]);

  const onStats = useCallback((stats: PanStats | null) => {
    statsRef.current = stats;
    stats?.noteMounted(mountedCount.current);
  }, []);

  const onActivate = useCallback<ActivateHandler>(
    (item, e) => {
      if (item.kind !== "tour" && item.kind !== "exit") return;
      trackCanvasTileClick({
        city: city.slug,
        category: item.slot.categorySlug,
        rank: item.kind === "tour" ? item.tile.rank : null,
        tier: item.kind === "tour" ? item.tier : "md",
        tileKind: item.kind,
        ...(item.kind === "tour" ? { experienceId: item.tile.id, tourId: item.tile.tourId } : {}),
      });
      const stats = statsRef.current;
      if (stats) {
        // Perf mode: a click that got through the pan is counted, not followed.
        stats.clicks++;
        e.preventDefault();
      }
    },
    [city],
  );

  // AC-L11: focus moving to a tile outside the view pans to keep it visible.
  const onFocus = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
    const controller = controllerRef.current;
    const canvas = canvasRef.current;
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-item]");
    if (!controller || !canvas || !el) return;
    const b = sceneRef.current.bounds[Number(el.dataset.item)];
    if (!b) return;
    const { view } = controller;
    const vw = canvas.clientWidth;
    const vh = canvas.clientHeight;
    const dx =
      b.x - FOCUS_MARGIN < view.x ? b.x - FOCUS_MARGIN - view.x :
      b.x + b.w + FOCUS_MARGIN > view.x + vw ? b.x + b.w + FOCUS_MARGIN - (view.x + vw) : 0;
    const dy =
      b.y - FOCUS_MARGIN < view.y ? b.y - FOCUS_MARGIN - view.y :
      b.y + b.h + FOCUS_MARGIN > view.y + vh ? b.y + b.h + FOCUS_MARGIN - (view.y + vh) : 0;
    if (dx || dy) controller.easeBy({ x: dx, y: dy });
  }, []);

  return (
    <>
      <div
        ref={canvasRef}
        tabIndex={0}
        role="region"
        aria-label={`${city.name} experiences. Drag, scroll or use the arrow keys to move around.`}
        className="relative h-full w-full touch-none overflow-hidden outline-none select-none"
      >
        <div ref={worldRef} className="absolute top-0 left-0 h-0 w-0" onFocus={onFocus}>
          {mounted.map((i) => (
            <CanvasItem key={scene.items[i].key} item={scene.items[i]} index={i} city={city} onActivate={onActivate} />
          ))}
        </div>
      </div>
      {perf?.perf ? (
        <PerfOverlay
          controllerRef={controllerRef}
          canvasRef={canvasRef}
          auto={perf.auto}
          inertia={perf.inertia}
          onStats={onStats}
        />
      ) : null}
    </>
  );
}
