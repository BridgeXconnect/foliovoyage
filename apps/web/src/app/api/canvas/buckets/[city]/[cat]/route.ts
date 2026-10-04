import { proxyCanvasBucket } from "@/lib/canvas-api";

/**
 * GET /api/canvas/buckets/:city/:cat — the browser's path to one canvas bucket
 * (spec 0004, AC-L16). Proxies the api and passes its cache headers through.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ city: string; cat: string }> },
): Promise<Response> {
  const { city, cat } = await params;
  return proxyCanvasBucket(city, cat);
}
