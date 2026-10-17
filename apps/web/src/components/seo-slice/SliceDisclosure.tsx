import { SLICE_DISCLOSURE } from "@/lib/seo-slice/templates";

/** The affiliate disclosure, in full inline (spec 0006 page template, AC-T11, AC-T9). */
export function SliceDisclosure() {
  return <p className="mt-6 max-w-3xl text-[13px] leading-6 text-muted">{SLICE_DISCLOSURE}</p>;
}
