import type { Metadata } from "next";
import { LegalLayout } from "../LegalLayout";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Get in touch with Folio Voyage — reader questions, destination partnerships, and press.",
  alternates: { canonical: "/legal/contact" },
};

export default function ContactPage() {
  return (
    <LegalLayout title="Contact">
      <p>
        We&apos;d love to hear from you: travellers with a question, destination
        partners, or anyone who just wants to say hello.
      </p>

      <h2>Email</h2>
      <p>
        The fastest way to reach us is by email:{" "}
        <a href={`mailto:${site.email}`}>{site.email}</a>. We aim to reply within
        two business days.
      </p>

      <h2>Partnerships</h2>
      <p>
        Are you a tour operator or experience provider interested in being
        featured? Reach out to{" "}
        <a href={`mailto:${site.partnersEmail}`}>{site.partnersEmail}</a>.
      </p>

      <h2>Feedback &amp; corrections</h2>
      <p>
        Spotted something out of date, or been somewhere we feature and have a
        tip? Corrections and first-hand notes from travellers improve our
        guides — send them to{" "}
        <a href={`mailto:${site.email}`}>{site.email}</a>.
      </p>
    </LegalLayout>
  );
}
