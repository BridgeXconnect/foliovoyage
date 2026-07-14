import type { Metadata } from "next";
import { LegalLayout } from "../LegalLayout";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms of Use",
  description:
    "The terms governing your use of Folio Voyage, an independent curated travel content site.",
  alternates: { canonical: "/legal/terms" },
};

export default function TermsPage() {
  return (
    <LegalLayout title="Terms of Use" updated="June 2026">
      <p>
        Welcome to Folio Voyage. By accessing or using foliovoyage.com you agree
        to these Terms of Use. If you do not agree, please do not use the site.
      </p>

      <h2>About this site</h2>
      <p>
        Folio Voyage is a curated travel content site. We recommend destinations,
        tours, and experiences and may link to third-party booking partners. We
        are an independent publisher and are not a travel agency, tour operator,
        or booking provider.
      </p>

      <h2>No warranty</h2>
      <p>
        Content is provided for general information on an &quot;as is&quot; basis.
        Prices, availability, and details shown are illustrative and are set and
        fulfilled entirely by third-party partners. We make no warranty as to the
        accuracy, completeness, or timeliness of any information and are not liable
        for bookings made with third parties.
      </p>

      <h2>Intellectual property</h2>
      <p>
        The Folio Voyage name, branding, and original written content are our
        property. Destination photography is licensed from third parties or used
        under Creative Commons and remains the property of its respective owners.
        You may not reproduce our content without permission.
      </p>

      <h2>Changes</h2>
      <p>
        We may update these terms from time to time. Continued use of the site
        after changes constitutes acceptance of the revised terms.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these terms? Email{" "}
        <a href={`mailto:${site.email}`}>{site.email}</a>.
      </p>
    </LegalLayout>
  );
}
