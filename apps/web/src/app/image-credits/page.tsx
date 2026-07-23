import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import credits from "@/data/credits.json";

export const metadata: Metadata = {
  title: "Image Credits",
  description:
    "Attribution for the placeholder photography used across Folio Voyage, sourced from Wikimedia Commons.",
  alternates: { canonical: "/image-credits" },
  robots: { index: false, follow: true },
};

type Credit = {
  file: string;
  descriptionUrl: string;
  artist: string;
  license: string;
  licenseUrl: string;
};

export default function ImageCreditsPage() {
  const entries = Object.entries(credits as Record<string, Credit>);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-12 sm:py-16">
        <h1 className="text-[32px] font-semibold leading-tight sm:text-[40px]">
          Image credits
        </h1>
        <p className="mt-4 text-[15px] leading-7 text-ink-soft">
          The photography currently shown across Folio Voyage is placeholder
          imagery sourced from{" "}
          <a
            href="https://commons.wikimedia.org"
            className="text-accent underline"
            rel="noopener"
          >
            Wikimedia Commons
          </a>{" "}
          under Creative Commons and public-domain licences, and is credited
          below. These images will be replaced with licensed provider photography
          as partnerships go live.
        </p>

        <ul className="mt-8 divide-y divide-line text-[14px] leading-6">
          {entries.map(([key, c]) => (
            <li key={key} className="py-3">
              <a
                href={c.descriptionUrl || undefined}
                className="font-medium text-ink underline decoration-line hover:decoration-ink"
                rel="noopener"
              >
                {c.file}
              </a>
              <span className="text-muted">
                {" — "}
                {c.artist}
                {c.license ? ` · ${c.license}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </main>
      <SiteFooter />
    </>
  );
}
