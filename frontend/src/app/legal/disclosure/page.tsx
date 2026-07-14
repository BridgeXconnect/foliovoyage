import type { Metadata } from "next";
import { LegalLayout } from "../LegalLayout";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Affiliate Disclosure",
  description:
    "Folio Voyage is reader-supported. How we earn affiliate commissions, our partners, and our FTC-compliant disclosure.",
  alternates: { canonical: "/legal/disclosure" },
};

export default function DisclosurePage() {
  return (
    <LegalLayout title="Affiliate Disclosure" updated="June 2026">
      <p>
        Folio Voyage is reader-supported. To keep our recommendations free, we
        participate in travel affiliate programs, which means we may earn a
        commission when you book or purchase through links on our site — at no
        additional cost to you.
      </p>

      <h2>How it works</h2>
      <p>
        When we feature a tour, activity, or experience, some links are affiliate
        links to partner platforms such as Viator and GetYourGuide. If you click
        one and make a booking, the partner may pay us a referral commission. This
        never changes the price you pay.
      </p>

      <h2>Our partners</h2>
      <p>
        We work with reputable travel experience providers and aggregators.
        Commissions help fund our research and curation but do not dictate our
        recommendations — we feature experiences we genuinely believe are worth
        your time.
      </p>

      <h2>FTC compliance</h2>
      <p>
        In accordance with the U.S. Federal Trade Commission&apos;s guidelines, we
        disclose that material connections exist between Folio Voyage and the
        partners whose products we link to. We are committed to transparency so
        you can make informed decisions.
      </p>

      <h2>Questions</h2>
      <p>
        If you&apos;d like to know more about how we earn or curate, email{" "}
        <a href={`mailto:${site.email}`}>{site.email}</a>.
      </p>
    </LegalLayout>
  );
}
