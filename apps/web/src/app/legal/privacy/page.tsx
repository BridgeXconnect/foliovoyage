import type { Metadata } from "next";
import Link from "next/link";
import { LegalLayout } from "../LegalLayout";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How Folio Voyage collects, uses, and protects your information, and how affiliate links and third parties are handled.",
  alternates: { canonical: "/legal/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy" updated="July 2026">
      <p>
        Folio Voyage (&quot;we&quot;, &quot;us&quot;) respects your privacy. This
        policy explains what information we collect when you visit foliovoyage.com
        and how we use it. By using this site you agree to the practices described
        here.
      </p>

      <h2>Information we collect</h2>
      <p>
        We collect only what you choose to give us. If you contact us, we receive
        the email address and any message you submit. We also use third-party
        analytics providers (PostHog, and our host Vercel) to understand how the
        site is used — for example pages visited, approximate region, and which
        links are clicked. This usage data is collected in an anonymised form (we
        do not create accounts or user profiles), stored using cookies or similar
        technologies, and processed on our behalf in the United States solely to
        understand and improve the site. PostHog also records basic error
        diagnostics so we can fix problems.
      </p>

      <h2>How we use it</h2>
      <p>
        Any details you send us are used only to respond to you. We never sell
        your personal information. If we add an email list in future, it will be
        opt-in and you will be able to unsubscribe at any time.
      </p>

      <h2>Affiliate links &amp; third parties</h2>
      <p>
        Folio Voyage participates in travel affiliate programs (see our{" "}
        <Link href="/legal/disclosure">Affiliate Disclosure</Link>). When you
        click a partner link, that partner may set cookies or collect data under
        their own privacy policies. We are not responsible for the practices of
        third-party sites.
      </p>

      <h2>Your rights</h2>
      <p>
        You may request access to, correction of, or deletion of the personal
        data we hold about you. To make a request, email us at{" "}
        <a href={`mailto:${site.email}`}>{site.email}</a>.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this policy? Reach us at{" "}
        <a href={`mailto:${site.email}`}>{site.email}</a>.
      </p>
    </LegalLayout>
  );
}
