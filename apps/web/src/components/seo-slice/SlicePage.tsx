import type { SlicePageModel } from "@/lib/seo-slice/page-model";
import { ChooseSections } from "./ChooseSections";
import { GoodToKnow } from "./GoodToKnow";
import { HowMadeNote } from "./HowMadeNote";
import { HubIndex } from "./HubIndex";
import { LocalNotes } from "./LocalNotes";
import { PreviewBanner } from "./PreviewBanner";
import { RuleLine } from "./RuleLine";
import { SliceBreadcrumbs } from "./SliceBreadcrumbs";
import { SliceDisclosure } from "./SliceDisclosure";
import { StatStrip } from "./StatStrip";

/**
 * One template for every slice page (spec 0006 page template, AC-T3), in the
 * spec's block order. A block with nothing to show renders nothing.
 */
export function SlicePage({ model }: { model: SlicePageModel }) {
  return (
    <>
      {model.preview && <PreviewBanner reasons={model.preview.reasons} noCopy={model.preview.noCopy} />}
      <article className="mx-auto max-w-[1100px] px-6 py-10">
        <SliceBreadcrumbs crumbs={model.breadcrumbs} />
        <h1 className="mt-6 font-display text-[36px] font-semibold leading-tight text-ink md:text-[44px]">{model.h1}</h1>
        <RuleLine rule={model.ruleLine} checked={model.checkedLine} />
        {model.intro && <p className="mt-6 max-w-3xl text-[17px] leading-8 text-ink-soft">{model.intro}</p>}
        <StatStrip lines={model.strip} caption={model.countsCaption} />
        {model.kind === "hub" ? (
          <HubIndex pages={model.hubPages} caption={model.countsCaption} pageSlug={model.slug} />
        ) : (
          <>
            <ChooseSections sections={model.sections} pageSlug={model.slug} />
            <LocalNotes notes={model.notes} />
          </>
        )}
        <GoodToKnow facts={model.goodToKnow} />
        <HowMadeNote note={model.howMade} computedOn={model.computedOn} />
        <SliceDisclosure />
      </article>
    </>
  );
}
