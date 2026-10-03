"use client";

/**
 * THROWAWAY (canvas performance spike, BRI-223). Bangkok's first four buckets,
 * laid out by the real `layoutBucket`, culled and panned by the engine in
 * `src/canvas/engine`. Plain styling on purpose: no design work happens here.
 */

import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  CANVAS_CITIES,
  LANDSCAPE_RATIO,
  SECTION_OVERSCAN,
  SECTION_SIZE,
  TIER_CAPTION_GAP,
  TIER_CAPTION_HEIGHT,
  TITLE_BLOCK,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  layoutBucket,
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
import { percentile, startRecorder, type SpikeStats } from "./stats";

type FixtureTile = (typeof fixture.slots)[number]["tiles"][number];
type ImageMode = "full" | "1x" | "2x";

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
}

const WORLD = { width: WORLD_WIDTH, height: WORLD_HEIGHT };

function buildItems(): Item[] {
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
      items.push({
        key: p.id,
        kind: "tour",
        x: origin.x + p.x,
        y: origin.y + p.y,
        w: p.w,
        h: p.h,
        rot: p.rot,
        placement: p,
        tile: byId.get(p.id),
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

function imageUrl(url: string, w: number, h: number, mode: ImageMode): string {
  if (mode === "full") return url;
  const scale = mode === "2x" ? 2 : 1;
  return url.replace(/spp-\d+x\d+/, `spp-${w * scale}x${h * scale}`);
}

const price = (t: FixtureTile) => `from $${Math.round(t.priceMinor / 100)}`;
const duration = (t: FixtureTile) =>
  t.durationMin == null ? "" : t.durationMin >= 60 ? `${Math.round(t.durationMin / 60)} h · ` : `${t.durationMin} min · `;

let clickStats: SpikeStats | null = null;

const TileView = memo(function TileView({ item, imageMode }: { item: Item; imageMode: ImageMode }) {
  const box: React.CSSProperties = {
    position: "absolute",
    left: item.x,
    top: item.y,
    width: item.w,
    height: item.h,
    transform: item.rot ? `rotate(${item.rot}deg)` : undefined,
    transformOrigin: "0 0",
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
  const photoH = p.shape === "1:1" ? p.w : (p.w * LANDSCAPE_RATIO.height) / LANDSCAPE_RATIO.width;
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
      {/* eslint-disable-next-line @next/next/no-img-element -- spike measures raw image cost */}
      <img
        src={imageUrl(t.imageUrl, p.w, photoH, imageMode)}
        alt=""
        width={p.w}
        height={photoH}
        decoding="async"
        draggable={false}
        style={{ display: "block", width: p.w, height: photoH, objectFit: "cover", background: "#ddd" }}
      />
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

interface Config {
  sectionSize: number;
  overscan: number;
  overlay: boolean;
  imageMode: ImageMode;
}

function readConfig(): Config {
  const q = new URLSearchParams(window.location.search);
  const num = (name: string, fallback: number) => {
    const v = Number(q.get(name));
    return q.has(name) && Number.isFinite(v) ? v : fallback;
  };
  const img = q.get("img");
  return {
    sectionSize: num("section", SECTION_SIZE),
    overscan: num("overscan", SECTION_OVERSCAN),
    overlay: q.get("overlay") === "1",
    imageMode: img === "1x" || img === "2x" ? img : "full",
  };
}

function Overlay({ stats, config }: { stats: SpikeStats; config: Config }) {
  const [text, setText] = useState("");
  useEffect(() => {
    const id = setInterval(() => {
      const now = performance.now();
      const recent = stats.frames.filter(([t]) => t > now - 5000).map(([, d]) => d);
      const all = stats.frames.map(([, d]) => d);
      setText(
        [
          `mounted ${stats.mounted} (max ${stats.maxMounted})`,
          `last 5 s: p95 ${percentile(recent, 95).toFixed(1)} ms, worst ${Math.max(0, ...recent).toFixed(1)} ms`,
          `since reset: p95 ${percentile(all, 95).toFixed(1)} ms, worst ${Math.max(0, ...all).toFixed(1)} ms, ${all.length} frames`,
          `long tasks ${stats.longTasks.length}, clicks ${stats.clicks}`,
          `section ${config.sectionSize}, overscan ${config.overscan}, img ${config.imageMode}`,
        ].join("\n"),
      );
    }, 250);
    return () => clearInterval(id);
  }, [stats, config]);
  return (
    <div style={{ position: "fixed", top: 8, left: 8, zIndex: 2, background: "rgba(0,0,0,.75)", color: "#fff", font: "12px/16px ui-monospace, monospace", padding: 8, borderRadius: 6, whiteSpace: "pre" }}>
      {text}
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

  const items = useMemo(buildItems, []);
  const index = useMemo(
    () => (config ? buildSectionIndex(items.map((i): Rect => rotatedBounds(i, i.rot)), config.sectionSize) : null),
    [items, config],
  );

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
    const controller = createPanController({
      canvas,
      world,
      worldSize: WORLD,
      onView(view, viewport) {
        const next = sectionRange(view, viewport, WORLD, config);
        if (range && sameRange(range, next)) return;
        range = next;
        const list = itemsInRange(index, next);
        stats.mounted = list.length;
        stats.maxMounted = Math.max(stats.maxMounted, list.length);
        setMounted(list);
      },
    });
    canvas.focus();
    return () => controller.destroy();
  }, [config, index, stats]);

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
          {config && mounted.map((i) => <TileView key={items[i].key} item={items[i]} imageMode={config.imageMode} />)}
        </div>
      </div>
      {config?.overlay && stats && <Overlay stats={stats} config={config} />}
    </>
  );
}
