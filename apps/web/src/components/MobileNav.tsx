"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { Wordmark } from "./Wordmark";

/** Slide-in mobile navigation. The only interactive part of the header. */
export function MobileNav({
  links,
  onDark,
}: {
  links: { href: string; label: string }[];
  onDark: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-label="Open menu"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={onDark ? "text-white" : "text-ink"}
      >
        <Menu size={24} />
      </button>

      {open && (
        <div className="fixed inset-0 z-[100]">
          <div
            className="absolute inset-0 bg-overlay/60"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute inset-y-0 right-0 flex w-[82%] max-w-sm flex-col bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <Wordmark />
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setOpen(false)}
                className="text-ink"
              >
                <X size={24} />
              </button>
            </div>
            <nav className="mt-10 flex flex-col gap-6">
              {links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="text-[20px] font-display font-medium text-ink"
                >
                  {l.label}
                </Link>
              ))}
              <Link
                href="/destinations"
                onClick={() => setOpen(false)}
                className="mt-2 rounded-card bg-accent px-6 py-3 text-center text-[11px] font-medium uppercase tracking-[0.19em] text-white"
              >
                Explore destinations
              </Link>
            </nav>
          </div>
        </div>
      )}
    </div>
  );
}
