/**
 * THROWAWAY (canvas performance spike, BRI-223). Query parameters for the spike
 * page, and the image variant each tile asks the CDN for. Pure, so the parsing
 * that decides what a phone run actually measured is unit tested.
 *
 * Every parameter is checked. A value the page does not know, a parameter name
 * it does not know, or a parameter given twice is listed in `invalid`, and the
 * overlay shows it as INVALID instead of quietly running the default.
 */

export type ImageMode = "full" | "1x" | "2x" | "off";

export interface Config {
  sectionSize: number;
  overscan: number;
  overlay: boolean;
  /** `full`: the feed's own URL. `1x`/`2x`: the smallest CDN variant covering the photo box at that scale. `off`: no image. */
  imageMode: ImageMode;
  /** False with `tilt=0`: no rotation and no placement jitter. */
  tilt: boolean;
  /** With `cap=n`, only the n items nearest the viewport centre are mounted. */
  cap: number | null;
  /** With `decode=pre`, an image is loaded and decoded off screen before its tile shows it. */
  decodePre: boolean;
  /** False with `layers=0`: tiles get `contain: paint` and never `will-change` or `translateZ`. */
  layers: boolean;
  /** `name=value` of every parameter that was not understood. */
  invalid: string[];
}

export interface ConfigDefaults {
  sectionSize: number;
  overscan: number;
}

type Parser = (value: string, config: Config) => boolean;

const positiveInt = (v: string) => /^[1-9]\d*$/.test(v);
const nonNegativeInt = (v: string) => /^\d+$/.test(v);

const PARSERS: Record<string, Parser> = {
  overlay: (v, c) => (v === "1" || v === "0" ? ((c.overlay = v === "1"), true) : false),
  section: (v, c) => (positiveInt(v) ? ((c.sectionSize = Number(v)), true) : false),
  overscan: (v, c) => (nonNegativeInt(v) ? ((c.overscan = Number(v)), true) : false),
  img: (v, c) => (v === "full" || v === "1x" || v === "2x" || v === "off" ? ((c.imageMode = v), true) : false),
  tilt: (v, c) => (v === "0" || v === "1" ? ((c.tilt = v === "1"), true) : false),
  cap: (v, c) => (positiveInt(v) ? ((c.cap = Number(v)), true) : false),
  decode: (v, c) => (v === "pre" || v === "async" ? ((c.decodePre = v === "pre"), true) : false),
  layers: (v, c) => (v === "0" || v === "1" ? ((c.layers = v === "1"), true) : false),
};

export function parseConfig(search: string, defaults: ConfigDefaults): Config {
  const config: Config = {
    sectionSize: defaults.sectionSize,
    overscan: defaults.overscan,
    overlay: false,
    imageMode: "full",
    tilt: true,
    cap: null,
    decodePre: false,
    layers: true,
    invalid: [],
  };
  const q = new URLSearchParams(search);
  const seen = new Set<string>();
  for (const [name, value] of q) {
    const parse = PARSERS[name];
    if (!parse || seen.has(name) || !parse(value, config)) config.invalid.push(`${name}=${value}`);
    seen.add(name);
  }
  return config;
}

/** One line per setting, every value spelled out, for the overlay. */
export function describeConfig(config: Config): string {
  return [
    `img ${config.imageMode} · tilt ${config.tilt ? 1 : 0} · cap ${config.cap ?? "none"}`,
    `decode ${config.decodePre ? "pre" : "async"} · layers ${config.layers ? 1 : 0}`,
    `section ${config.sectionSize} · overscan ${config.overscan}`,
  ].join("\n");
}

// Image variants ------------------------------------------------------------

/**
 * The `spp-WxH` sizes the TripAdvisor CDN serves, probed 2026-10-03. Any other
 * size is a 404, so asking for the exact tile size breaks most tiles (no 168 px
 * size, and no square size between 200 and 400).
 */
export const CDN_LANDSCAPE_SIZES: readonly (readonly [number, number])[] = [
  [180, 120],
  [240, 160],
  [360, 240],
  [480, 320],
  [540, 360],
  [674, 446],
  [720, 480],
];
export const CDN_SQUARE_SIZES: readonly (readonly [number, number])[] = [
  [50, 50],
  [100, 100],
  [200, 200],
  [400, 400],
];

export interface ImageVariant {
  url: string;
  /** Pixel size of the image the browser decodes. */
  width: number;
  height: number;
}

const SIZE_IN_URL = /spp-(\d+)x(\d+)/;

/**
 * The image a tile loads for a photo box of `w` × `h` CSS px. `full` keeps the
 * feed's URL. `1x`/`2x` pick the smallest CDN size of the tile's shape that
 * covers the box at that scale, or the largest one when none does. Null for `off`.
 */
export function imageVariant(url: string, w: number, h: number, square: boolean, mode: ImageMode): ImageVariant | null {
  if (mode === "off") return null;
  const feed = SIZE_IN_URL.exec(url);
  if (mode === "full" || !feed) {
    return { url, width: feed ? Number(feed[1]) : 0, height: feed ? Number(feed[2]) : 0 };
  }
  const scale = mode === "2x" ? 2 : 1;
  const sizes = square ? CDN_SQUARE_SIZES : CDN_LANDSCAPE_SIZES;
  const [width, height] = sizes.find(([sw, sh]) => sw >= w * scale && sh >= h * scale) ?? sizes[sizes.length - 1];
  return { url: url.replace(SIZE_IN_URL, `spp-${width}x${height}`), width, height };
}
