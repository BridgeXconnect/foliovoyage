import { SEO_SLICE_NO_COPY_TEXT, SEO_SLICE_PREVIEW_BANNER } from "@/lib/seo-slice/preview";

/** The local preview banner (spec 0006 page template, AC-T15). Never in a production build. */
export function PreviewBanner({ reasons, noCopy }: { reasons: string[]; noCopy: boolean }) {
  return (
    <div role="note" className="border-b border-[#e0b44c] bg-[#fff6dc] px-6 py-3 text-[14px] leading-6 text-[#5b4300]">
      <p className="font-semibold">{SEO_SLICE_PREVIEW_BANNER}</p>
      {noCopy && <p>{SEO_SLICE_NO_COPY_TEXT}</p>}
      {reasons.map((r, i) => (
        <p key={i}>Not live: {r}</p>
      ))}
    </div>
  );
}
