import Link from "next/link";
import { Wordmark } from "./Wordmark";
import { MobileNav } from "./MobileNav";

export const navLinks = [
  { href: "/destinations", label: "Destinations" },
  { href: "/legal/disclosure", label: "Disclosure" },
  { href: "/legal/contact", label: "Contact" },
];

/**
 * Global site header. Transparent over the hero when `transparent` is set
 * (homepage), solid white otherwise. Server component; the mobile drawer is the
 * only interactive island.
 */
export function SiteHeader({ transparent = false }: { transparent?: boolean }) {
  const onDark = transparent;
  return (
    <header
      className={
        transparent
          ? "absolute inset-x-0 top-0 z-50"
          : "sticky top-0 z-50 border-b border-line bg-white/95 backdrop-blur"
      }
    >
      <div className="container-page flex h-20 items-center justify-between">
        <Wordmark invert={onDark} />

        <nav className="hidden items-center gap-9 md:flex">
          {navLinks.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={
                "eyebrow transition-colors " +
                (onDark
                  ? "!text-white/85 hover:!text-white"
                  : "hover:text-ink")
              }
            >
              {l.label}
            </Link>
          ))}
          <Link
            href="/destinations"
            className={
              "rounded-card px-6 py-3 text-[11px] font-medium uppercase tracking-[0.19em] transition-colors " +
              (onDark
                ? "bg-white text-ink hover:bg-white/90"
                : "bg-accent text-white hover:bg-accent-ink")
            }
          >
            Explore
          </Link>
        </nav>

        <MobileNav links={navLinks} onDark={onDark} />
      </div>
    </header>
  );
}
