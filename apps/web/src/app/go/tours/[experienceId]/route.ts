import { after } from "next/server";
import { tourGo } from "@/lib/tour-go";

/**
 * `GET /go/tours/:experienceId` — the click redirect for database tour pages
 * (spec 0005, AC-9 to AC-12). Next matches this static `tours` segment before
 * the `/go/[slug]/[id]` dynamic route. The logic lives in `src/lib/tour-go.ts`.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ experienceId: string }> },
): Promise<Response> {
  const { experienceId } = await params;
  return tourGo(request, experienceId, { after });
}
