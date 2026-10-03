/**
 * The client's in memory cache of canvas buckets (spec 0004, AC-L10).
 *
 * A bucket is fetched through the web proxy route the first time its slot comes
 * into range, and never again in the session once it has loaded. A failed fetch
 * leaves the slot on its placeholder and is retried on a later move into range,
 * at most once every `retryMs`. A 404 (a bucket with no eligible tiles) is final.
 */

import { canvasBucketResponseSchema, type CanvasBucketResponse } from "@folio/shared";

export type BucketState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly data: CanvasBucketResponse }
  | { readonly status: "empty" }
  | { readonly status: "failed"; readonly at: number };

const IDLE: BucketState = { status: "idle" };

/** Minimum wait before a failed bucket is fetched again, in ms. */
export const BUCKET_RETRY_MS = 3000;

export const bucketKey = (city: string, category: string): string => `${city}/${category}`;

export const bucketUrl = (city: string, category: string): string =>
  `/api/canvas/buckets/${encodeURIComponent(city)}/${encodeURIComponent(category)}`;

export interface BucketStore {
  get(city: string, category: string): BucketState;
  /** Fetch the bucket unless it is loaded, loading, empty, or failed less than `retryMs` ago. */
  request(city: string, category: string): void;
  subscribe(listener: () => void): () => void;
  /** Changes on every state change, for `useSyncExternalStore`. */
  version(): number;
}

export function createBucketStore(
  options: { fetchImpl?: typeof fetch; now?: () => number; retryMs?: number } = {},
): BucketStore {
  const fetchImpl = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const now = options.now ?? (() => Date.now());
  const retryMs = options.retryMs ?? BUCKET_RETRY_MS;
  const states = new Map<string, BucketState>();
  const listeners = new Set<() => void>();
  let version = 0;

  const set = (key: string, state: BucketState) => {
    states.set(key, state);
    version++;
    for (const l of listeners) l();
  };

  const load = async (key: string, city: string, category: string) => {
    set(key, { status: "loading" });
    try {
      const res = await fetchImpl(bucketUrl(city, category));
      if (res.status === 404) return set(key, { status: "empty" });
      if (!res.ok) throw new Error(String(res.status));
      const parsed = canvasBucketResponseSchema.safeParse(await res.json());
      if (!parsed.success) throw new Error("bucket off contract");
      set(key, { status: "ready", data: parsed.data });
    } catch {
      set(key, { status: "failed", at: now() });
    }
  };

  return {
    get: (city, category) => states.get(bucketKey(city, category)) ?? IDLE,
    request(city, category) {
      const key = bucketKey(city, category);
      const state = states.get(key) ?? IDLE;
      if (state.status === "idle" || (state.status === "failed" && now() - state.at >= retryMs)) {
        void load(key, city, category);
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    version: () => version,
  };
}
