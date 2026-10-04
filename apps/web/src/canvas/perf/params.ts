/**
 * The `/discover` dev tool switches, read from the query string (BRI-223):
 * `perf=1` loads the pan frame overlay, `auto=1` adds the scripted 30 s pan, and
 * `tau`, `velocityWindow` and `maxVelocity` tune the release inertia. The tuning
 * params only apply in perf mode, so a shared link can never change how the
 * canvas feels for anyone else.
 */

import { DEFAULT_INERTIA, type InertiaConfig } from "../engine/motion";

export interface PerfParams {
  readonly perf: boolean;
  readonly auto: boolean;
  readonly inertia: InertiaConfig;
}

/** Accepted range for each inertia param; anything outside it falls back to the default. */
const RANGES: Record<keyof InertiaConfig, readonly [number, number]> = {
  tau: [1, 5000],
  velocityWindow: [16, 1000],
  maxVelocity: [1, 50_000],
};

const read = (params: URLSearchParams, key: keyof InertiaConfig): number => {
  const raw = params.get(key);
  const value = raw === null || raw.trim() === "" ? NaN : Number(raw);
  const [min, max] = RANGES[key];
  return Number.isFinite(value) && value >= min && value <= max ? value : DEFAULT_INERTIA[key];
};

export function parsePerfParams(search: string | URLSearchParams): PerfParams {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const perf = params.get("perf") === "1";
  if (!perf) return { perf: false, auto: false, inertia: DEFAULT_INERTIA };
  return {
    perf,
    auto: params.get("auto") === "1",
    inertia: {
      tau: read(params, "tau"),
      velocityWindow: read(params, "velocityWindow"),
      maxVelocity: read(params, "maxVelocity"),
    },
  };
}
