"use client";

/**
 * THROWAWAY (canvas performance spike, BRI-223). Bangkok's first four buckets,
 * laid out by the real `layoutBucket`, culled and panned by the engine in
 * `src/canvas/engine`. Plain styling on purpose: no design work happens here.
 * The diagnostic switches (`img`, `tilt`, `cap`, `decode`, `layers`) are
 * described in `config.ts`; the overlay shows the value each one ran with.
 */

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  CANVAS_CITIES,
  JITTER,
  LANDSCAPE_RATIO,
  SECTION_OVERSCAN,
  SECTION_SIZE,
  SLOT_HEIGHT,
  SLOT_WIDTH,
  TIER_CAPTION_GAP,
  TIER_CAPTION_HEIGHT,
  TILT_DEGREES,
  TILT_STEPS_PER_DEGREE,
  TITLE_BLOCK,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  fnv1a,
  layoutBucket,
  mulberry32,
  slotOriginByIndex,
  type Placement,
} from "@folio/shared";
import {
  buildSectionIndex,
  createPanController,
  itemsInRange,
  rotatedBounds,
  sameRange,
  sectionRange,
  type Point,
  type Rect,
  type SectionRange,
} from "@/canvas/engine";
import fixture from "./fixture.json";
import { describeConfig, imageVariant, parseConfig, type Config, type ImageVariant } from "./config";
import {
  AFTER_CROSSING_MS,
  HITCH_MS,
  PAN_TAIL_MS,
  crossingSummary,
  panFrameEntries,
  percentile,
  startRecorder,
  type Crossing,
  type RunResult,
  type SpikeStats,
} from "./stats";

type FixtureTile = (typeof fixture.slots)[number]["tiles"][number];

interface Item {
  key: string;
  kind: "title" | "tour" | "exit";
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  placement?: Placement;
  tile?: FixtureTile;
  label?: string;
  /** Tours only: the photo box height and the image this tile loads (null with `img=off`). */
  photoH?: number;
  image?: ImageVariant | null;
}

const WORLD = { width: WORLD_WIDTH, height: WORLD_HEIGHT };

/**
 * The jitter `layoutBucket` seeded for a tile, recomputed from its id the same
 * way (`seedTile` in packages/shared). A tile the layout straightened has its
 * jitter zeroed along with its tilt, so it has none to remove.
 */
function seededJitter(p: Placement): { jx: number; jy: number } {
  const rand = mulberry32(fnv1a(p.id));
  const jx = Math.round((rand() * 2 - 1) * JITTER) + 0;
  const jy = Math.round((rand() * 2 - 1) * JITTER) + 0;
  const rot = Math.round((rand() * 2 - 1) * TILT_DEGREES * TILT_STEPS_PER_DEGREE) / TILT_STEPS_PER_DEGREE + 0;
  return rot === p.rot ? { jx, jy } : { jx: 0, jy: 0 };
}

function buildItems(config: Config): Item[] {
  const items: Item[] = [];
  const cityIndex = CANVAS_CITIES.findIndex((c) => c.slug === "bangkok");
  fixture.slots.forEach((slot, k) => {
    const origin = slotOriginByIndex(cityIndex, k);
    const byId = new Map(slot.tiles.map((t) => [t.id, t]));
    const layout = layoutBucket({
      bucketKey: `bangkok/${slot.categorySlug}`,
      tiles: slot.tiles.map((t) => ({ id: t.id, rank: t.rank })),
    });
    items.push({
      key: `${slot.categorySlug}/title`,
      kind: "title",
      x: origin.x + TITLE_BLOCK.x,
      y: origin.y + TITLE_BLOCK.y,
      w: TITLE_BLOCK.width,
      h: TITLE_BLOCK.height,
      rot: 0,
      label: `${slot.categoryLabel} · ${slot.total}`,
    });
    for (const p of layout.tiles) {
      const tile = byId.get(p.id)!;
      const { jx, jy } = config.tilt ? { jx: 0, jy: 0 } : seededJitter(p);
      const photoH = p.shape === "1:1" ? p.w : (p.w * LANDSCAPE_RATIO.height) / LANDSCAPE_RATIO.width;
      items.push({
        key: p.id,
        kind: "tour",
        x: origin.x + p.x - jx,
        y: origin.y + p.y - jy,
        w: p.w,
        h: p.h,
        rot: config.tilt ? p.rot : 0,
        placement: p,
        tile,
        photoH,
        image: imageVariant(tile.imageUrl, p.w, photoH, p.shape === "1:1", config.imageMode),
      });
    }
    items.push({
      key: `${slot.categorySlug}/exit`,
      kind: "exit",
      x: origin.x + layout.exit.x,
      y: origin.y + layout.exit.y,
      w: layout.exit.w,
      h: layout.exit.h,
      rot: 0,
      label: `All ${slot.total} in ${slot.cityName} · ${slot.categoryLabel}`,
    });
  });
  return items;
}

const price = (t: FixtureTile) => `from $${Math.round(t.priceMinor / 100)}`;
const duration = (t: FixtureTile) =>
  t.durationMin == null ? "" : t.durationMin >= 60 ? `${Math.round(t.durationMin / 60)} h · ` : `${t.durationMin} min · `;

let clickStats: SpikeStats | null = null;

// decode=pre: each image is loaded and decoded once, off screen, and the decoded
// element is kept so the browser has no reason to drop its bitmap.
const predecoded = new Map<string, Promise<HTMLImageElement>>();
const decodedUrls = new Set<string>();

function predecode(url: string): Promise<HTMLImageElement> {
  let p = predecoded.get(url);
  if (!p) {
    const img = new Image();
    img.src = url;
    p = img.decode().then(
      () => img,
      () => img,
    );
    p.then(() => decodedUrls.add(url));
    predecoded.set(url, p);
  }
  return p;
}

function Photo({ image, w, h, decodePre, lazy }: { image: ImageVariant; w: number; h: number; decodePre: boolean; lazy: boolean }) {
  const [ready, setReady] = useState(() => !decodePre || decodedUrls.has(image.url));
  useEffect(() => {
    if (ready) return;
    let alive = true;
    predecode(image.url).then(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, [image.url, ready]);
  const style: React.CSSProperties = { display: "block", width: w, height: h, objectFit: "cover", background: "#ddd" };
  // mount=batch: the stable list renders every tile hidden, and the mounter sets
  // `src` the first time it shows the tile, so nothing loads before that.
  if (lazy) {
    // eslint-disable-next-line @next/next/no-img-element -- spike measures raw image cost
    return <img data-src={image.url} alt="" width={w} height={h} decoding="async" draggable={false} style={style} />;
  }
  if (!ready) return <div style={style} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- spike measures raw image cost
    <img src={image.url} alt="" width={w} height={h} decoding="async" draggable={false} style={style} />
  );
}

/** A solid colour per tile for `img=off`, so tiles stay distinguishable while panning. */
const solidColour = (id: string) => `hsl(${fnv1a(id) % 360} 30% 78%)`;

const TileView = memo(function TileView({ item, config }: { item: Item; config: Config }) {
  const box: React.CSSProperties = {
    position: "absolute",
    left: item.x,
    top: item.y,
    width: item.w,
    height: item.h,
    transform: item.rot ? `rotate(${item.rot}deg)` : undefined,
    transformOrigin: "0 0",
    contain: config.layers ? undefined : "paint",
    // mount=batch: hidden until the mounter shows it.
    ...(config.mount === "batch" ? { display: "none" } : {}),
  };
  if (item.kind === "title") {
    return (
      <div style={{ ...box, font: "600 20px/26px system-ui, sans-serif", color: "#222" }}>{item.label}</div>
    );
  }
  if (item.kind === "exit") {
    return (
      <a href="#exit" draggable={false} style={{ ...box, background: "#222", color: "#fff", padding: 16, font: "500 15px/20px system-ui, sans-serif", textDecoration: "none" }}>
        {item.label}
      </a>
    );
  }
  const p = item.placement!;
  const t = item.tile!;
  const photoH = item.photoH!;
  const captionH = TIER_CAPTION_HEIGHT[p.tier];
  const fontSize = p.tier === "lg" ? 15 : p.tier === "md" ? 13 : 11;
  return (
    <a
      href={`#tile-${t.id}`}
      draggable={false}
      onClick={(e) => {
        e.preventDefault();
        if (clickStats) clickStats.clicks++;
      }}
      style={{ display: "block", ...box, color: "#222", textDecoration: "none" }}
    >
      {item.image ? (
        <Photo image={item.image} w={p.w} h={photoH} decodePre={config.decodePre} lazy={config.mount === "batch"} />
      ) : (
        <div style={{ width: p.w, height: photoH, background: solidColour(t.id) }} />
      )}
      <div
        style={{
          marginTop: TIER_CAPTION_GAP[p.tier],
          height: captionH,
          overflow: "hidden",
          font: `400 ${fontSize}px/${fontSize + 5}px system-ui, sans-serif`,
        }}
      >
        {p.tier === "sm" ? (
          price(t)
        ) : (
          <>
            <div style={{ fontWeight: 600, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
              {t.title}
            </div>
            <div>
              {duration(t)}
              {price(t)}
            </div>
          </>
        )}
      </div>
    </a>
  );
});

function readConfig(): Config {
  return parseConfig(window.location.search, { sectionSize: SECTION_SIZE, overscan: SECTION_OVERSCAN });
}

const sameList = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Scripted pan (`auto=1`): a countdown to put the phone down, then a fixed length pan. */
const AUTO_COUNTDOWN_MS = 3000;
const AUTO_MS = 30_000;
/** The scripted pan drifts down and back up over this period, so rows of sections are crossed too. */
const AUTO_DRIFT_PERIOD_MS = 7500;

type AutoState =
  | { phase: "idle" }
  | { phase: "countdown" | "running"; until: number }
  | { phase: "done"; result: RunResult };

const ms = (v: number) => v.toFixed(1);

function liveText(stats: SpikeStats): string {
  // Pan frames only: from a pan's first input to 300 ms after its last.
  const recent = stats.panFrames(performance.now() - 5000);
  const all = stats.panFrames();
  let pixels = 0;
  for (const v of stats.imagePixels.values()) pixels += v;
  const s = crossingSummary(
    panFrameEntries(stats.frames, stats.windows),
    stats.crossings.map((c) => c.t),
  );
  return [
    `mounted ${stats.mounted} (max ${stats.maxMounted})`,
    `pan, last 5 s: p95 ${ms(percentile(recent, 95))} ms, worst ${ms(Math.max(0, ...recent))} ms`,
    `pan, since reset: p95 ${ms(percentile(all, 95))} ms, worst ${ms(Math.max(0, ...all))} ms`,
    `${all.length} pan frames of ${stats.frames.length}, ${stats.windows.length} pans`,
    `crossings ${s.crossings} · >${HITCH_MS} ms ${s.hitches}, ${s.hitchesAfterCrossing} within ${AFTER_CROSSING_MS} ms after a crossing`,
    `long tasks in pans ${stats.panLongTasks().length}, clicks ${stats.clicks}`,
    `images since load: ${stats.imagePixels.size} distinct, ${stats.imageMounts} mounts, ${(pixels / 1e6).toFixed(1)} MP`,
  ].join("\n");
}

function resultText(r: RunResult, config: Config, stats: SpikeStats): string {
  let pixels = 0;
  for (const v of stats.imagePixels.values()) pixels += v;
  const work = config.mount === "batch" ? "show/hide per drain frame" : "React commit per crossing";
  return [
    `RESULT · ${r.seconds} s scripted pan`,
    `pan p50 ${ms(r.p50)} · p95 ${ms(r.p95)} · p99 ${ms(r.p99)} · worst ${ms(r.worst)} ms`,
    `${r.frames} pan frames · ${Math.round(r.distance).toLocaleString("en-US")} px covered`,
    `crossings ${r.crossings} · tiles per crossing mean ${r.addedMean.toFixed(1)}, max ${r.addedMax}`,
    `frames >${HITCH_MS} ms: ${r.hitches}`,
    `  of them within ${AFTER_CROSSING_MS} ms after a crossing: ${r.hitchesAfterCrossing}`,
    `  (by chance: ${Math.round(r.baseRate * 100)}% of frames are)`,
    `${work}: p50 ${ms(r.workP50)} · p95 ${ms(r.workP95)} · max ${ms(r.workMax)} ms`,
    `max mounted ${r.maxMounted} · images ${(pixels / 1e6).toFixed(1)} MP`,
  ].join("\n");
}

function Overlay({
  stats,
  config,
  auto,
  onStart,
}: {
  stats: SpikeStats;
  config: Config;
  auto: AutoState;
  onStart: () => void;
}) {
  const lite = config.overlay === "lite";
  const [text, setText] = useState("");
  const [now, setNow] = useState(0);
  const frozen = auto.phase === "done";
  useEffect(() => {
    if (frozen) return;
    const update = () => {
      setText(liveText(stats));
      setNow(performance.now());
    };
    update();
    // full: every 250 ms. lite: once a second, so the cost of measuring can be compared.
    const id = setInterval(update, lite ? 1000 : 250);
    return () => clearInterval(id);
  }, [stats, lite, frozen]);
  const bad = config.invalid.length > 0;
  const status =
    auto.phase === "countdown"
      ? `starting in ${Math.max(0, Math.ceil((auto.until - now) / 1000))} s, put the phone down`
      : auto.phase === "running"
        ? `scripted pan running, ${Math.max(0, Math.ceil((auto.until - now) / 1000))} s left`
        : null;
  const background = bad ? (lite ? "#a00" : "rgba(170,0,0,.9)") : lite ? "#000" : "rgba(0,0,0,.75)";
  const button: React.CSSProperties = { padding: "4px 10px", background: "#fff", color: "#000", borderRadius: 4, marginRight: 8 };
  return (
    <div style={{ position: "fixed", top: 8, left: 8, maxWidth: "calc(100vw - 16px)", zIndex: 2, background, color: "#fff", font: "12px/16px ui-monospace, monospace", padding: 8, borderRadius: 6, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
      {frozen ? resultText(auto.result, config, stats) : text}
      {status && `\n${status}`}
      {"\n"}
      {describeConfig(config)}
      {"\n"}
      {`query ${window.location.search || "(none)"}`}
      {bad && <div style={{ fontWeight: 700 }}>{`INVALID: ${config.invalid.join(", ")} (running defaults for these)`}</div>}
      <div style={{ marginTop: 6 }}>
        {config.auto && (auto.phase === "idle" || auto.phase === "done") && (
          <button type="button" data-testid="auto-start" onClick={onStart} style={button}>
            {auto.phase === "done" ? "start again" : `start ${AUTO_MS / 1000} s pan`}
          </button>
        )}
        {!config.auto && (
          <button type="button" onClick={() => stats.reset()} style={button}>
            reset
          </button>
        )}
      </div>
    </div>
  );
}

export default function SpikeCanvas() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [stats, setStats] = useState<SpikeStats | null>(null);
  const [mounted, setMounted] = useState<number[]>([]);
  const [auto, setAuto] = useState<AutoState>({ phase: "idle" });
  const startAuto = useRef<() => void>(() => {});

  const items = useMemo(() => (config ? buildItems(config) : []), [config]);
  const bounds = useMemo(() => items.map((i): Rect => rotatedBounds(i, i.rot)), [items]);
  const index = useMemo(() => (config ? buildSectionIndex(bounds, config.sectionSize) : null), [bounds, config]);
  const everyItem = useMemo(() => items.map((_, i) => i), [items]);

  // mount=react: time React's render plus DOM commit of each new mounted set.
  // The render starts in this body (the first render that sees the new state)
  // and the commit ends in the layout effect below.
  const renderStart = useRef(0);
  const renderedList = useRef(mounted);
  const pendingCrossing = useRef<Crossing | null>(null);
  if (renderedList.current !== mounted) {
    renderedList.current = mounted;
    renderStart.current = performance.now();
  }
  useLayoutEffect(() => {
    const crossing = pendingCrossing.current;
    if (!crossing) return;
    pendingCrossing.current = null;
    const end = performance.now();
    crossing.commitMs = end - renderStart.current;
    crossing.delayMs = renderStart.current - crossing.t;
    performance.measure("spike:commit", { start: renderStart.current, end });
  }, [mounted]);

  useEffect(() => {
    setConfig(readConfig());
    const recorder = startRecorder();
    clickStats = recorder.stats;
    setStats(recorder.stats);
    return () => {
      recorder.stop();
      clickStats = null;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const world = worldRef.current;
    if (!config || !index || !stats || !canvas || !world) return;
    const batch = config.mount === "batch";
    let range: SectionRange | null = null;
    let candidates: number[] = [];
    let shown: number[] = [];
    let last: Point | null = null;
    let current = { view: { x: 0, y: 0 }, viewport: { width: 0, height: 0 } };

    const noteImage = (i: number) => {
      const image = items[i].image;
      if (!image) return;
      stats.imageMounts++;
      stats.imagePixels.set(image.url, image.width * image.height);
    };

    // mount=batch ------------------------------------------------------------
    // Every tile is already in the DOM, hidden, in item order. A crossing hides
    // what left the range at once and queues what entered it; each frame shows
    // at most `config.batch` queued tiles, those ahead of the direction of
    // travel first. React is not involved after the first render.
    const elements = batch ? (Array.from(world.children) as HTMLElement[]) : [];
    const visible = new Set<number>();
    const queue = new Set<number>();
    let velocity = { x: 0, y: 0 };
    let drainFrame = 0;

    const show = (i: number) => {
      const el = elements[i];
      el.style.display = "block";
      const img = el.querySelector<HTMLImageElement>("img[data-src]");
      if (img) {
        img.src = img.dataset.src!;
        img.removeAttribute("data-src");
      }
      visible.add(i);
      noteImage(i);
    };
    const hide = (i: number) => {
      elements[i].style.display = "none";
      visible.delete(i);
    };

    const drain = () => {
      drainFrame = 0;
      if (queue.size === 0) return;
      const t0 = performance.now();
      const { view, viewport } = current;
      // Aim at where the view will be in about 200 ms (12 frames at the current velocity).
      const ax = view.x + viewport.width / 2 + velocity.x * 12;
      const ay = view.y + viewport.height / 2 + velocity.y * 12;
      const onScreen = (i: number) => {
        const b = bounds[i];
        return b.x < view.x + viewport.width && b.x + b.w > view.x && b.y < view.y + viewport.height && b.y + b.h > view.y ? 1 : 0;
      };
      const dist = (i: number) => (bounds[i].x + bounds[i].w / 2 - ax) ** 2 + (bounds[i].y + bounds[i].h / 2 - ay) ** 2;
      const next = [...queue].sort((a, b) => onScreen(b) - onScreen(a) || dist(a) - dist(b)).slice(0, config.batch);
      for (const i of next) {
        queue.delete(i);
        show(i);
      }
      stats.drainMs.push(performance.now() - t0);
      stats.mounted = visible.size;
      stats.maxMounted = Math.max(stats.maxMounted, visible.size);
      if (queue.size > 0) drainFrame = requestAnimationFrame(drain);
    };

    const controller = createPanController({
      canvas,
      world,
      worldSize: WORLD,
      onPanInput: stats.panInput,
      onView(view, viewport) {
        current = { view, viewport };
        if (last) {
          const dx = view.x - last.x;
          const dy = view.y - last.y;
          stats.distance += Math.hypot(dx, dy);
          velocity = { x: velocity.x * 0.7 + dx * 0.3, y: velocity.y * 0.7 + dy * 0.3 };
        }
        last = view;
        const next = sectionRange(view, viewport, WORLD, config);
        const rangeChanged = !range || !sameRange(range, next);

        if (batch) {
          if (!rangeChanged) return;
          range = next;
          const before = new Set(candidates);
          candidates = itemsInRange(index, next);
          const target = new Set(candidates);
          let added = 0;
          for (const i of candidates) if (!before.has(i)) added++;
          let removed = 0;
          for (const i of before) if (!target.has(i)) removed++;
          // Counted like mount=react: a range change that moves no tile is not a crossing.
          if (added === 0 && removed === 0) return;
          for (const i of [...visible]) if (!target.has(i)) hide(i);
          for (const i of [...queue]) if (!target.has(i)) queue.delete(i);
          for (const i of candidates) if (!visible.has(i)) queue.add(i);
          const t = performance.now();
          performance.mark("spike:crossing");
          stats.crossings.push({ t, added, removed, commitMs: null, delayMs: null });
          stats.mounted = visible.size;
          if (queue.size > 0 && !drainFrame) drainFrame = requestAnimationFrame(drain);
          return;
        }

        // Without a cap the mounted set changes only when a section line is
        // crossed. With one, the nearest n can change on any frame.
        if (!rangeChanged && config.cap === null) return;
        if (rangeChanged) {
          range = next;
          candidates = itemsInRange(index, next);
        }
        let list = candidates;
        if (config.cap !== null && list.length > config.cap) {
          const cx = view.x + viewport.width / 2;
          const cy = view.y + viewport.height / 2;
          const dist = (i: number) => (bounds[i].x + bounds[i].w / 2 - cx) ** 2 + (bounds[i].y + bounds[i].h / 2 - cy) ** 2;
          list = [...list]
            .sort((a, b) => dist(a) - dist(b))
            .slice(0, config.cap)
            .sort((a, b) => a - b);
        }
        if (sameList(shown, list)) return;
        const before = new Set(shown);
        const after = new Set(list);
        let added = 0;
        for (const i of list) {
          if (before.has(i)) continue;
          added++;
          noteImage(i);
        }
        let removed = 0;
        for (const i of shown) if (!after.has(i)) removed++;
        if (rangeChanged) {
          performance.mark("spike:crossing");
          const crossing: Crossing = { t: performance.now(), added, removed, commitMs: null, delayMs: null };
          stats.crossings.push(crossing);
          pendingCrossing.current = crossing;
        }
        shown = list;
        stats.mounted = list.length;
        stats.maxMounted = Math.max(stats.maxMounted, list.length);
        setMounted(list);
      },
    });

    // auto=1 -------------------------------------------------------------------
    // The same entry point a drag uses after pointer handling: the pan input
    // hook, then a delta for the next frame. Left to right across the four
    // slots and back at `config.speed`, drifting down and up within the slot row.
    let autoFrame = 0;
    let autoTimer = 0;
    const stopAuto = () => {
      cancelAnimationFrame(autoFrame);
      clearTimeout(autoTimer);
    };
    startAuto.current = () => {
      stopAuto();
      const from = controller.view;
      controller.panBy({ x: -from.x, y: -from.y }); // back to the start, not counted as a pan
      setAuto({ phase: "countdown", until: performance.now() + AUTO_COUNTDOWN_MS });
      autoTimer = window.setTimeout(() => {
        const spanX = SLOT_WIDTH * fixture.slots.length - canvas.clientWidth;
        const spanY = Math.max(0, SLOT_HEIGHT - canvas.clientHeight);
        const path = (t: number): Point => {
          const d = (config.speed * t) / 1000;
          const leg = d % (2 * spanX);
          return {
            x: leg <= spanX ? leg : 2 * spanX - leg,
            y: (spanY * (1 - Math.cos((2 * Math.PI * t) / AUTO_DRIFT_PERIOD_MS))) / 2,
          };
        };
        stats.reset();
        stats.autoResult = null;
        setAuto({ phase: "running", until: performance.now() + AUTO_MS });
        let t0 = 0;
        let prev: Point = { x: 0, y: 0 };
        const step = (t: number) => {
          if (!t0) t0 = t;
          const elapsed = Math.min(t - t0, AUTO_MS);
          const p = path(elapsed);
          stats.panInput();
          controller.panBy({ x: p.x - prev.x, y: p.y - prev.y });
          prev = p;
          if (elapsed < AUTO_MS) {
            autoFrame = requestAnimationFrame(step);
            return;
          }
          // Wait out the pan tail so the last frames are in before freezing.
          autoTimer = window.setTimeout(() => {
            const result = stats.summary(AUTO_MS / 1000);
            stats.autoResult = result;
            setAuto({ phase: "done", result });
          }, PAN_TAIL_MS + 50);
        };
        autoFrame = requestAnimationFrame(step);
      }, AUTO_COUNTDOWN_MS);
    };

    canvas.focus();
    return () => {
      stopAuto();
      cancelAnimationFrame(drainFrame);
      controller.destroy();
    };
  }, [config, index, stats, items, bounds]);

  const overlayShown =
    config !== null && (config.overlay !== "off" || config.auto || config.invalid.some((v) => v.startsWith("overlay=")));

  return (
    <>
      <div
        ref={canvasRef}
        tabIndex={0}
        data-testid="canvas"
        style={{
          position: "fixed",
          inset: 0,
          overflow: "hidden",
          touchAction: "none",
          userSelect: "none",
          WebkitUserSelect: "none",
          overscrollBehavior: "none",
          background: "#f4f1ea",
          outline: "none",
        }}
      >
        <div ref={worldRef} style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0 }}>
          {config &&
            (config.mount === "batch" ? everyItem : mounted).map((i) => (
              <TileView key={items[i].key} item={items[i]} config={config} />
            ))}
        </div>
      </div>
      {overlayShown && stats && <Overlay stats={stats} config={config} auto={auto} onStart={() => startAuto.current()} />}
    </>
  );
}
