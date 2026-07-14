import Link from "next/link";
import { Wordmark } from "./Wordmark";
import { site } from "@/lib/site";

const columns = [
  {
    heading: "Explore",
    links: [
      { href: "/destinations", label: "All destinations" },
      { href: "/destinations/bangkok", label: "Bangkok" },
      { href: "/destinations/kyoto", label: "Kyoto" },
      { href: "/destinations/rome", label: "Rome" },
    ],
  },
  {
    heading: "Company",
    links: [
      { href: "/legal/contact", label: "Contact" },
      { href: "/legal/disclosure", label: "Affiliate disclosure" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { href: "/legal/privacy", label: "Privacy" },
      { href: "/legal/terms", label: "Terms" },
      { href: "/legal/disclosure", label: "Disclosure" },
      { href: "/image-credits", label: "Image credits" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="container-page grid gap-10 py-14 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="max-w-xs">
          <Wordmark />
          <p className="mt-4 text-[14px] leading-6 text-muted">
            A hand-picked travel folio — original city guides and vetted tours
            and experiences worth taking.
          </p>
          <p className="mt-4 text-[13px] text-muted">
            Reader-supported. We may earn a commission from partner links —{" "}
            <Link href="/legal/disclosure" className="text-accent underline">
              how this works
            </Link>
            .
          </p>
        </div>

        {columns.map((col) => (
          <div key={col.heading}>
            <p className="eyebrow">{col.heading}</p>
            <ul className="mt-4 space-y-3">
              {col.links.map((l) => (
                <li key={l.href + l.label}>
                  <Link
                    href={l.href}
                    className="text-[14px] text-ink-soft transition-colors hover:text-ink"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-line">
        <div className="container-page flex flex-col items-center justify-between gap-3 py-6 text-center sm:flex-row sm:text-left">
          <p className="text-[13px] text-muted">
            © {new Date().getFullYear()} {site.name}. All rights reserved.
          </p>
          <p className="text-[13px] text-muted">
            Reader-supported ·{" "}
            <Link href="/legal/disclosure" className="underline hover:text-ink">
              affiliate disclosure
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}
