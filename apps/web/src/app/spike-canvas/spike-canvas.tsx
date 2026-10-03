"use client";

/**
 * THROWAWAY (canvas performance spike, BRI-223). Bangkok's first four buckets,
 * laid out by the real `layoutBucket`, culled and panned by the engine in
 * `src/canvas/engine`. Plain styling on purpose: no design work happens here.
 * The diagnostic switches (`img`, `tilt`, `cap`, `decode`, `layers`) are
 * described in `config.ts`; the overlay shows the value each one ran with.
 */

import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  CANVAS_CITIES,
  JITTER,
  LANDSCAPE_RATIO,
  SECTION_OVERSCAN,
  SECTION_SIZE,
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
  type Rect,
  type SectionRange,
} from "@/canvas/engine";
import fixture from "./fixture.json";
import { describeConfig, imageVariant, parseConfig, type Config, type ImageVariant } from "./config";
import { percentile, startRecorder, type SpikeStats } from "./stats";

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

function Photo({ image, w, h, decodePre }: { image: ImageVariant; w: number; h: number; decodePre: boolean }) {
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
      style={{ ...box, display: "block", color: "#222", textDecoration: "none" }}
    >
      {item.image ? (
        <Photo image={item.image} w={p.w} h={photoH} decodePre={config.decodePre} />
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

function Overlay({ stats, config }: { stats: SpikeStats; config: Config }) {
  const [text, setText] = useState("");
  useEffect(() => {
    const id = setInterval(() => {
      // Pan frames only: from a pan's first input to 300 ms after its last.
      const recent = stats.panFrames(performance.now() - 5000);
      const all = stats.panFrames();
      let pixels = 0;
      for (const v of stats.imagePixels.values()) pixels += v;
      setText(
        [
          `mounted ${stats.mounted} (max ${stats.maxMounted})`,
          `pan, last 5 s: p95 ${percentile(recent, 95).toFixed(1)} ms, worst ${Math.max(0, ...recent).toFixed(1)} ms`,
          `pan, since reset: p95 ${percentile(all, 95).toFixed(1)} ms, worst ${Math.max(0, ...all).toFixed(1)} ms`,
          `${all.length} pan frames of ${stats.frames.length}, ${stats.windows.length} pans`,
          `long tasks in pans ${stats.panLongTasks().length}, clicks ${stats.clicks}`,
          `images since load: ${stats.imagePixels.size} distinct, ${stats.imageMounts} mounts, ${(pixels / 1e6).toFixed(1)} MP`,
          describeConfig(config),
        ].join("\n"),
      );
    }, 250);
    return () => clearInterval(id);
  }, [stats, config]);
  const bad = config.invalid.length > 0;
  return (
    <div style={{ position: "fixed", top: 8, left: 8, maxWidth: "calc(100vw - 16px)", zIndex: 2, background: bad ? "rgba(170,0,0,.9)" : "rgba(0,0,0,.75)", color: "#fff", font: "12px/16px ui-monospace, monospace", padding: 8, borderRadius: 6, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
      {text}
      {"\n"}
      {`query ${window.location.search || "(none)"}`}
      {bad && <div style={{ fontWeight: 700 }}>{`INVALID: ${config.invalid.join(", ")} (running defaults for these)`}</div>}
      <button type="button" onClick={() => stats.reset()} style={{ display: "block", marginTop: 6, padding: "4px 10px", background: "#fff", color: "#000", borderRadius: 4 }}>
        reset
      </button>
    </div>
  );
}

export default function SpikeCanvas() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [stats, setStats] = useState<SpikeStats | null>(null);
  const [mounted, setMounted] = useState<number[]>([]);

  const items = useMemo(() => (config ? buildItems(config) : []), [config]);
  const bounds = useMemo(() => items.map((i): Rect => rotatedBounds(i, i.rot)), [items]);
  const index = useMemo(() => (config ? buildSectionIndex(bounds, config.sectionSize) : null), [bounds, config]);

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
    let range: SectionRange | null = null;
    let candidates: number[] = [];
    let shown: number[] = [];
    const controller = createPanController({
      canvas,
      world,
      worldSize: WORLD,
      onPanInput: stats.panInput,
      onView(view, viewport) {
        const next = sectionRange(view, viewport, WORLD, config);
        const rangeChanged = !range || !sameRange(range, next);
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
        for (const i of list) {
          const image = items[i].image;
          if (before.has(i) || !image) continue;
          stats.imageMounts++;
          stats.imagePixels.set(image.url, image.width * image.height);
        }
        shown = list;
        stats.mounted = list.length;
        stats.maxMounted = Math.max(stats.maxMounted, list.length);
        setMounted(list);
      },
    });
    canvas.focus();
    return () => controller.destroy();
  }, [config, index, stats, items, bounds]);

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
          {config && mounted.map((i) => <TileView key={items[i].key} item={items[i]} config={config} />)}
        </div>
      </div>
      {config && stats && (config.overlay || config.invalid.some((v) => v.startsWith("overlay="))) && (
        <Overlay stats={stats} config={config} />
      )}
    </>
  );
}
