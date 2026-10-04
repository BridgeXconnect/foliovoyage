/**
 * The `/discover` dev tool switches, read from the query string (BRI-223):
 * `perf=1` loads the pan frame overlay, `auto=1` adds the scripted 30 s pan, and
 * `tau`, `velocityWindow` and `maxVelocity` tune the release inertia. The tuning
 * params only apply in perf mode, so a shared link can never change how the
 * canvas feels for anyone else.
 *
 * The ablation switches each take one cost out of a tile, to find what a phone
 * pays for during a pan: `radius=0` (no rounded clip on the photo), `tilt=0` (no
 * rotation and no jitter), `captions=off` (captions hidden, space kept),
 * `prefetch=all` (every bucket loaded and laid out before the scripted pan), and
 * `flat=1` (radius, tilt and captions off together). A value the page doesn't
 * know, or a switch that contradicts `flat=1`, is listed in `invalid`, shown
 * as INVALID and ignored.
 */

import { DEFAULT_INERTIA, type InertiaConfig } from "../engine/motion";

export interface Ablation {
  /** False with `radius=0`: the photo has no rounded corners and no clip. */
  readonly radius: boolean;
  /** False with `tilt=0`: tiles sit upright, without the seeded jitter. */
  readonly tilt: boolean;
  /** False with `captions=off`: the caption block is hidden and keeps its space. */
  readonly captions: boolean;
  /** True with `prefetch=all`: every bucket is loaded before the scripted pan starts. */
  readonly prefetch: boolean;
}

export const NO_ABLATION: Ablation = { radius: true, tilt: true, captions: true, prefetch: false };

export interface PerfParams {
  readonly perf: boolean;
  readonly auto: boolean;
  readonly inertia: InertiaConfig;
  readonly ablation: Ablation;
  /** True with `flat=1`, so the overlay can name it. */
  readonly flat: boolean;
  /** `name=value` of every switch that was not understood. */
  readonly invalid: readonly string[];
}

/** Accepted range for each inertia param; anything outside it falls back to the default. */
const RANGES: Record<keyof InertiaConfig, readonly [number, number]> = {
  tau: [1, 5000],
  velocityWindow: [16, 1000],
  maxVelocity: [1, 50_000],
};

const OFF: PerfParams = { perf: false, auto: false, inertia: DEFAULT_INERTIA, ablation: NO_ABLATION, flat: false, invalid: [] };

/** Each switch's accepted values, the first one being the "on" (default look) value. */
const SWITCHES = {
  radius: ["1", "0"],
  tilt: ["1", "0"],
  captions: ["on", "off"],
  prefetch: ["near", "all"],
  flat: ["0", "1"],
} as const;

export function parsePerfParams(search: string | URLSearchParams): PerfParams {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  if (params.get("perf") !== "1") return OFF;
  const invalid: string[] = [];

  const read = (key: keyof InertiaConfig): number => {
    const raw = params.get(key);
    if (raw === null) return DEFAULT_INERTIA[key];
    const value = raw.trim() === "" ? NaN : Number(raw);
    const [min, max] = RANGES[key];
    if (Number.isFinite(value) && value >= min && value <= max) return value;
    invalid.push(`${key}=${raw}`);
    return DEFAULT_INERTIA[key];
  };

  /** True when the switch is set to its second (ablated) value. */
  const ablated = (key: keyof typeof SWITCHES): boolean => {
    const raw = params.get(key);
    if (raw === null) return false;
    const [normal, off] = SWITCHES[key];
    if (raw === off) return true;
    if (raw !== normal) invalid.push(`${key}=${raw}`);
    return false;
  };

  // `img` is a spike switch the page can't honour: the feed carries one URL per tile.
  if (params.has("img")) invalid.push(`img=${params.get("img")}`);

  const flat = ablated("flat");
  const one = (key: "radius" | "tilt" | "captions"): boolean => {
    if (flat && params.has(key)) {
      invalid.push(`${key}=${params.get(key)}`);
      return true;
    }
    return flat || ablated(key);
  };

  return {
    perf: true,
    auto: params.get("auto") === "1",
    inertia: { tau: read("tau"), velocityWindow: read("velocityWindow"), maxVelocity: read("maxVelocity") },
    ablation: {
      radius: !one("radius"),
      tilt: !one("tilt"),
      captions: !one("captions"),
      prefetch: ablated("prefetch"),
    },
    flat,
    invalid,
  };
}

/** The switches in effect, for the overlay's last line. */
export function describeSwitches(p: PerfParams): string {
  const on: string[] = [];
  if (p.flat) on.push("flat=1 (radius=0 tilt=0 captions=off)");
  else {
    if (!p.ablation.radius) on.push("radius=0");
    if (!p.ablation.tilt) on.push("tilt=0");
    if (!p.ablation.captions) on.push("captions=off");
  }
  if (p.ablation.prefetch) on.push("prefetch=all");
  return `switches: ${on.length ? on.join(" ") : "none"}`;
}
