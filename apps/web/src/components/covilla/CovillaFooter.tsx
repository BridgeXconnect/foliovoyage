import Link from "next/link";
import { Instagram, Facebook, Linkedin } from "lucide-react";
import { site } from "@/lib/site";

const columns = [
  {
    heading: "Destinations",
    links: [
      { href: "/destinations/bangkok", label: "Bangkok" },
      { href: "/destinations/kyoto", label: "Kyoto" },
      { href: "/destinations/lisbon", label: "Lisbon" },
      { href: "/destinations/rome", label: "Rome" },
      { href: "/destinations/hanoi", label: "Hanoi" },
      { href: "/destinations/bali", label: "Bali" },
    ],
  },
  {
    heading: "Explore",
    links: [
      { href: "/destinations", label: "All destinations" },
      { href: "/guides", label: "Guides" },
      { href: "/legal/contact", label: "Contact" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { href: "/legal/disclosure", label: "Affiliate disclosure" },
      { href: "/legal/privacy", label: "Privacy" },
      { href: "/legal/terms", label: "Terms" },
      { href: "/image-credits", label: "Image credits" },
    ],
  },
];

const socials = [
  { Icon: Instagram, href: "https://instagram.com", label: "Instagram" },
  { Icon: Facebook, href: "https://facebook.com", label: "Facebook" },
  { Icon: Linkedin, href: "https://linkedin.com", label: "LinkedIn" },
];

/** Covilla-style footer: link columns, an oversized wordmark, and a base bar. */
export function CovillaFooter() {
  return (
    <footer className="bg-ink text-white">
      <div className="container-page grid gap-10 py-16 md:grid-cols-[1.5fr_repeat(3,1fr)]">
        <div className="max-w-xs">
          <span className="flex items-baseline gap-[4px] text-[24px]">
            <span className="font-serif font-semibold text-white">Folio</span>
            <span className="font-sans font-light tracking-[0.5px] text-white">
              Voyage
            </span>
          </span>
          <p className="mt-4 text-[14px] leading-6 text-white/60">
            A hand-picked travel folio — original city guides and vetted tours
            and experiences worth taking.
          </p>
          <div className="mt-6 flex gap-4">
            {socials.map(({ Icon, href, label }) => (
              <a
                key={label}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={label}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 text-white/70 transition-colors hover:border-white/50 hover:text-white"
              >
                <Icon size={16} />
              </a>
            ))}
          </div>
        </div>

        {columns.map((col) => (
          <div key={col.heading}>
            <p className="eyebrow !text-white/50">{col.heading}</p>
            <ul className="mt-4 space-y-3">
              {col.links.map((l) => (
                <li key={l.href + l.label}>
                  <Link
                    href={l.href}
                    className="text-[14px] text-white/75 transition-colors hover:text-white"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Oversized wordmark */}
      <div className="overflow-hidden border-t border-white/10">
        <div className="container-page py-10">
          <p className="select-none text-center font-display text-[16vw] font-semibold leading-none tracking-[-0.03em] text-white/[0.07] md:text-[11vw]">
            FOLIO VOYAGE
          </p>
        </div>
      </div>

      <div className="border-t border-white/10">
        <div className="container-page flex flex-col items-center justify-between gap-3 py-6 text-center sm:flex-row sm:text-left">
          <p className="text-[13px] text-white/50">
            © {new Date().getFullYear()} {site.name}. All rights reserved.
          </p>
          <p className="text-[13px] text-white/50">
            Reader-supported ·{" "}
            <Link href="/legal/disclosure" className="underline hover:text-white/80">
              affiliate disclosure
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}
