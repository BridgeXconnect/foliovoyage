"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, ChevronDown, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/cn";
import posthog from "posthog-js";
import {
  DestinationRevealCard,
  type RevealDestination,
} from "./DestinationRevealCard";

export type NavDestination = RevealDestination & { fromPrice: number };

// Continent grouping so the flyout mirrors Covilla's "choose a continent /
// choose a destination" structure using real Folio Voyage destinations.
const CONTINENT: Record<string, string> = {
  Thailand: "Asia",
  Japan: "Asia",
  Vietnam: "Asia",
  Indonesia: "Asia",
  Portugal: "Europe",
  Italy: "Europe",
};

/**
 * Covilla-style sticky header. On pages with a hero (`transparent`), it sits
 * transparent over the image on landing and turns solid white on scroll; other
 * pages are solid white throughout. A left hamburger opens the flyout menu, and
 * the DESTINATIONS dropdown reveals a card grid.
 */
export function CovillaHeader({
  destinations,
  transparent = false,
  dropdownOnLight = false,
}: {
  destinations: NavDestination[];
  transparent?: boolean;
  /**
   * On split pages the right column is white behind a transparent header, so
   * the DESTINATIONS button must stay dark even before scroll.
   */
  dropdownOnLight?: boolean;
}) {
  const [scrolled, setScrolled] = useState(false);
  const [flyout, setFlyout] = useState(false);
  const [dropdown, setDropdown] = useState(false);
  const [dropdownActive, setDropdownActive] = useState(0);
  const pathname = usePathname();

  const solid = !transparent || scrolled;
  const dropdownDark = solid || dropdownOnLight;

  // Top-level nav link classes: dark text on light chrome, white over a hero.
  const navLink = (activeMatch: boolean) =>
    cn(
      "text-[12px] font-medium uppercase tracking-[0.16em] transition-colors",
      dropdownDark
        ? activeMatch
          ? "text-ink"
          : "text-muted hover:text-ink"
        : activeMatch
          ? "text-white"
          : "text-white/70 hover:text-white",
    );
  const onDestinations = pathname?.startsWith("/destinations");
  const onGuides = pathname?.startsWith("/guides");
  const onContact = pathname === "/legal/contact";

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Lock body scroll while the flyout is open.
  useEffect(() => {
    document.body.style.overflow = flyout ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [flyout]);

  // Reset the revealed tile whenever the dropdown opens.
  useEffect(() => {
    if (dropdown) setDropdownActive(0);
  }, [dropdown]);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-[90] transition-[background-color,box-shadow] duration-300",
        solid ? "bg-white" : "bg-transparent",
        scrolled ? "shadow-[0_6px_24px_-18px_rgba(15,19,38,0.5)]" : "",
      )}
    >
      <div
        className={cn(
          "flex h-20 items-stretch",
          solid ? "border-b border-line" : "",
        )}
      >
        {/* hamburger — sits in the 80px left rail column */}
        <button
          type="button"
          onClick={() => {
            setFlyout(true);
            posthog.capture("navigation_flyout_opened");
          }}
          aria-label="Open menu"
          aria-expanded={flyout}
          className={cn(
            "flex w-16 items-center justify-center transition-colors lg:w-20",
            solid
              ? "border-r border-line text-ink hover:bg-surface"
              : "text-white hover:bg-white/10",
          )}
        >
          <Menu size={22} />
        </button>

        <div className="flex flex-1 items-center justify-between px-5 md:px-9">
          <Link
            href="/"
            aria-label="Folio Voyage home"
            className="flex items-baseline gap-[4px] text-[22px] leading-none"
          >
            <span
              className={cn(
                "font-serif font-semibold",
                solid ? "text-ink" : "text-white",
              )}
            >
              Folio
            </span>
            <span
              className={cn(
                "font-sans font-light tracking-[0.5px]",
                solid ? "text-ink" : "text-white",
              )}
            >
              Voyage
            </span>
          </Link>

          {/* Primary navigation (md+) */}
          <nav className="hidden items-center gap-8 md:flex">
            {/* Destinations dropdown */}
            <div
              className="relative"
              onMouseEnter={() => setDropdown(true)}
              onMouseLeave={() => setDropdown(false)}
            >
              <button
                type="button"
                onClick={() => setDropdown((v) => !v)}
                aria-expanded={dropdown}
                className={cn(
                  "flex items-center gap-2 transition-colors",
                  navLink(Boolean(onDestinations)),
                )}
              >
                Destinations
                <ChevronDown
                  size={15}
                  className={cn(
                    "transition-transform",
                    dropdown && "rotate-180",
                  )}
                />
              </button>

              {dropdown && (
              <div className="absolute right-0 top-full w-[min(92vw,680px)] pt-3">
                <div className="rounded-2xl border border-line bg-white p-6 shadow-[0_30px_70px_-30px_rgba(15,19,38,0.5)]">
                  <div className="flex items-center gap-4">
                    <p className="eyebrow whitespace-nowrap">Choose a location</p>
                    <span className="h-px flex-1 bg-line" />
                  </div>
                  <div className="mt-5 grid grid-cols-2 gap-4">
                    {destinations.map((d, i) => (
                      <DestinationRevealCard
                        key={d.slug}
                        destination={d}
                        variant="tile"
                        active={dropdownActive === i}
                        onActivate={() => setDropdownActive(i)}
                        onClick={() => {
                          setDropdown(false);
                          posthog.capture("navigation_destination_selected", {
                            destination_slug: d.slug,
                            city: d.city,
                            country: d.country,
                            source: "dropdown",
                          });
                        }}
                      />
                    ))}
                  </div>
                  <Link
                    href="/destinations"
                    onClick={() => setDropdown(false)}
                    className="mt-5 inline-flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.16em] text-accent hover:text-accent-ink"
                  >
                    View all destinations <ArrowUpRight size={15} />
                  </Link>
                </div>
              </div>
              )}
            </div>

            <Link href="/guides" className={navLink(Boolean(onGuides))}>
              Guides
            </Link>
            <Link
              href="/legal/contact"
              className={navLink(Boolean(onContact))}
            >
              Contact
            </Link>
          </nav>
        </div>
      </div>

      <FlyoutMenu
        open={flyout}
        onClose={() => setFlyout(false)}
        destinations={destinations}
      />
    </header>
  );
}

/** Full-screen flyout navigation opened by the hamburger. */
function FlyoutMenu({
  open,
  onClose,
  destinations,
}: {
  open: boolean;
  onClose: () => void;
  destinations: NavDestination[];
}) {
  // The active card reveals its destination image; the first is active by
  // default (as in Covilla), and hovering another moves the reveal.
  const [active, setActive] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (open) setActive(0);
  }, [open]);

  // Order by continent so we can show "choose a continent" style groupings.
  const order = ["Asia", "Europe", "Africa", "Americas", "Oceania"];
  const groups = order
    .map((label) => ({
      label,
      items: destinations.filter((d) => CONTINENT[d.country] === label),
    }))
    .filter((g) => g.items.length > 0);

  // Flat index across all cards, used to drive the reveal state.
  let idx = -1;

  return (
    <div
      className={cn(
        "fixed inset-0 z-[120] transition-opacity duration-300",
        open ? "visible opacity-100" : "invisible opacity-0",
      )}
      aria-hidden={!open}
    >
      <div className="absolute inset-0 bg-overlay/70" onClick={onClose} />
      <div
        className={cn(
          "absolute inset-y-0 left-0 flex w-full max-w-md flex-col bg-white transition-transform duration-500 ease-[cubic-bezier(0.76,0,0.24,1)]",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-20 items-center justify-between border-b border-line px-8">
          <span className="flex items-baseline gap-[4px] text-[22px]">
            <span className="font-serif font-semibold text-ink">Folio</span>
            <span className="font-sans font-light tracking-[0.5px] text-ink">
              Voyage
            </span>
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-line text-ink transition-colors hover:bg-surface"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex flex-1 flex-col overflow-y-auto px-8 py-10">
          <h2 className="font-display text-[32px] font-semibold text-ink">
            Explore destinations
          </h2>

          <nav className="mt-8 space-y-8">
            {groups.map((group) => (
              <div key={group.label}>
                <div className="flex items-center gap-4">
                  <p className="eyebrow whitespace-nowrap">{group.label}</p>
                  <span className="h-px flex-1 bg-line" />
                </div>
                <ul className="mt-4 space-y-3">
                  {group.items.map((d) => {
                    idx += 1;
                    const i = idx;
                    return (
                      <li key={d.slug}>
                        <DestinationRevealCard
                          destination={d}
                          variant="row"
                          active={active === i}
                          onActivate={() => setActive(i)}
                          onClick={() => {
                            onClose();
                            posthog.capture("navigation_destination_selected", {
                              destination_slug: d.slug,
                              city: d.city,
                              country: d.country,
                              source: "flyout",
                            });
                          }}
                        />
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>

          <div className="mt-10 border-t border-line pt-6">
            <div className="flex items-center gap-4">
              <p className="eyebrow whitespace-nowrap">More</p>
              <span className="h-px flex-1 bg-line" />
            </div>
            <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3">
              {[
                { href: "/", label: "Home" },
                { href: "/destinations", label: "All destinations" },
                { href: "/guides", label: "Guides" },
                { href: "/legal/contact", label: "Contact" },
              ].map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    onClick={onClose}
                    className="text-[15px] font-medium text-ink transition-colors hover:text-accent"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
