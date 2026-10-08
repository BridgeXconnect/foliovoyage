/**
 * Server side access to the discovery canvas feed (spec 0004, AC-L10, AC-L16).
 *
 * `fetchCanvasSummaries` reads the bucket summaries. `proxyCanvasBucket` backs the `/api/canvas/buckets/[city]/[cat]` route
 * handler, the only way the browser reaches a bucket: `API_BASE_URL` is server
 * only and the api has no CORS.
 */

import {
  CANVAS_CATEGORIES,
  CANVAS_CITIES,
  canvasBucketsResponseSchema,
  type CanvasBucketSummary,
} from "@folio/shared";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3001";

// No caller until EP-21 (BRI-244); kept deliberately, do not delete as unused.
/**
 * Every bucket summary the api has, at most 42. Throws on a failed request or a
 * body that no longer matches the shared contract, like `fetchDestination`.
 */
export async function fetchCanvasSummaries(base = API_BASE_URL): Promise<CanvasBucketSummary[]> {
  const res = await fetch(`${base}/v1/canvas/buckets`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch canvas buckets: ${res.status} ${res.statusText}`);
  const parsed = canvasBucketsResponseSchema.safeParse(await res.json());
  if (!parsed.success) throw new Error(`Unexpected response for canvas buckets: ${parsed.error.message}`);
  return parsed.data.buckets;
}

const isCity = (slug: string) => CANVAS_CITIES.some((c) => c.slug === slug);
const isCategory = (slug: string) => CANVAS_CATEGORIES.some((c) => c.slug === slug);

function problem(status: number, title: string, detail: string): Response {
  return new Response(JSON.stringify({ type: "about:blank", title, status, detail }), {
    status,
    headers: { "content-type": "application/problem+json", "cache-control": "no-store" },
  });
}

// No caller until EP-21 (BRI-244); kept deliberately, do not delete as unused.
/**
 * Proxy one bucket from the api. The status, body, content type and cache
 * headers pass through as the api sent them, so the browser and the CDN cache a
 * bucket exactly as the api asks (and a 404 stays uncached, since the api sets
 * no cache header on it). A slug outside the canvas never reaches the api. A
 * network failure is a 502.
 */
export async function proxyCanvasBucket(
  city: string,
  category: string,
  base = API_BASE_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  if (!isCity(city) || !isCategory(category)) {
    return problem(404, "Not Found", `No canvas bucket ${city}/${category}.`);
  }
  let upstream: Response;
  try {
    upstream = await fetchImpl(
      `${base}/v1/canvas/buckets/${encodeURIComponent(city)}/${encodeURIComponent(category)}`,
      { cache: "no-store" },
    );
  } catch {
    return problem(502, "Bad Gateway", "The canvas feed could not be reached.");
  }
  const headers = new Headers();
  for (const name of ["content-type", "cache-control"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(await upstream.text(), { status: upstream.status, headers });
}
