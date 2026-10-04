"use client";

/**
 * One mounted canvas item: a slot title, a placeholder, a tour tile or the exit
 * tile (spec 0004 tile design, AC-T1 to AC-T10). Placeholder styling: the
 * designer's `design.md` pass restyles these later.
 *
 * Fixed caption heights come from the tokens in `globals.css`, set as an explicit
 * height with overflow hidden, so the layout's reserved outline is always exact.
 * No transitions and no animation: a tile never springs or scales. Hover is
 * desktop only (Tailwind's `hover:` applies only where the device can hover), and
 * keyboard focus shows the same outline.
 *
 * Tilt rotates the photo only, about the tile's top left corner (where the photo
 * sits), so the photo's outline is the one the layout seeded. The caption stays
 * upright in its place below the photo, and nothing inside it is ever
 * transformed: on the iPhone 16 rotated caption text cost about 8 ms of pan p95
 * (spec 0004 tile design). The seeded jitter is already in the tile's position.
 */

import { memo, type MouseEvent } from "react";
import { LANDSCAPE_RATIO, TIER_CAPTION_GAP, type CanvasCity, type TileTier } from "@folio/shared";
import { formatDuration, formatPrice, formatRating } from "./format";
import { exitHref, exitTileCopy, tourHref } from "./links";
import type { SceneItem } from "./scene";

const CAPTION_HEIGHT: Record<TileTier, string> = {
  lg: "h-(--container-caption-lg)",
  md: "h-(--container-caption-md)",
  sm: "h-(--container-caption-sm)",
};

const TITLE_TYPE: Record<TileTier, string> = {
  lg: "text-lg leading-tight line-clamp-2 font-semibold",
  md: "text-base leading-tight line-clamp-2 font-semibold",
  sm: "text-xs leading-(--container-caption-sm) line-clamp-1",
};

const META_TYPE: Record<Exclude<TileTier, "sm">, string> = {
  lg: "mt-1 truncate text-sm leading-sm text-muted",
  md: "mt-1 truncate text-xs leading-xs text-muted",
};

const FOCUS = "outline-offset-4 hover:outline-2 hover:outline-accent focus-visible:outline-2 focus-visible:outline-accent";

const hideBrokenImage = (e: { currentTarget: HTMLImageElement }) => {
  // AC-T10: the photo box keeps its size and its surface fill shows instead.
  e.currentTarget.style.visibility = "hidden";
};

function Photo({ url, width, height, rot = 0 }: { url: string; width: number; height: number; rot?: number }) {
  return (
    <div
      className="overflow-hidden rounded-lg bg-surface"
      style={rot ? { width, height, transform: `rotate(${rot}deg)`, transformOrigin: "0 0" } : { width, height }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- the feed's tier sized variant, used as is */}
      <img
        src={url}
        alt=""
        width={width}
        height={height}
        draggable={false}
        decoding="async"
        onError={hideBrokenImage}
        className="h-full w-full object-cover"
      />
    </div>
  );
}

export type ActivateHandler = (item: SceneItem, e: MouseEvent<HTMLAnchorElement>) => void;

interface Props {
  item: SceneItem;
  index: number;
  city: CanvasCity;
  onActivate: ActivateHandler;
}

function CanvasItemView({ item, index, city, onActivate }: Props) {
  const { x, y, w, h } = item.rect;
  const place = { position: "absolute", left: x, top: y, width: w } as const;

  switch (item.kind) {
    case "title":
      return (
        <div data-item={index} className="overflow-hidden" style={{ ...place, height: h }}>
          <h2 className="line-clamp-2 text-base leading-sm font-semibold">{item.slot.categoryLabel}</h2>
          <p className="truncate text-xs leading-xs text-muted">
            {city.name}
            {item.total !== null ? ` · ${item.total.toLocaleString("en-US")} experiences` : ""}
          </p>
        </div>
      );

    case "placeholder":
      return (
        <div data-item={index} aria-hidden style={place}>
          <Photo url={item.image.url} width={w} height={h} />
        </div>
      );

    case "exit":
      return (
        <a
          data-item={index}
          href={exitHref(city)}
          draggable={false}
          onClick={(e) => onActivate(item, e)}
          className={`flex items-center justify-center rounded-lg bg-accent px-4 text-center text-base leading-tight font-semibold text-surface ${FOCUS}`}
          style={{ ...place, height: h }}
        >
          {exitTileCopy(city.name)}
        </a>
      );

    case "tour": {
      const { tile, tier, shape, rot } = item;
      const photoHeight = shape === "1:1" ? w : (w * LANDSCAPE_RATIO.height) / LANDSCAPE_RATIO.width;
      const meta =
        tier === "sm"
          ? null
          : [
              formatDuration(tile.durationMin),
              formatPrice(tile.price.amountMinor, tile.price.currency),
              tier === "lg" ? formatRating(tile.ratingAvg, tile.ratingCount) : null,
            ]
              .filter(Boolean)
              .join(" · ");
      return (
        <a
          data-item={index}
          href={tourHref({ ...tile, citySlug: city.slug })}
          draggable={false}
          onClick={(e) => onActivate(item, e)}
          className={`group block ${FOCUS}`}
          style={place}
        >
          <Photo url={tile.image.url} width={w} height={photoHeight} rot={rot} />
          <div className={`overflow-hidden ${CAPTION_HEIGHT[tier]}`} style={{ marginTop: TIER_CAPTION_GAP[tier] }}>
            <p className={`text-ink group-hover:text-accent group-focus-visible:text-accent ${TITLE_TYPE[tier]}`}>
              {tile.title}
            </p>
            {meta ? <p className={META_TYPE[tier as "lg" | "md"]}>{meta}</p> : null}
          </div>
        </a>
      );
    }
  }
}

export const CanvasItem = memo(CanvasItemView);
