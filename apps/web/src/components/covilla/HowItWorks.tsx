"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Plus, Minus } from "lucide-react";
import { cn } from "@/lib/cn";
import { IMG } from "@/data/media";

const steps = [
  {
    title: "Pick a destination",
    body: "Start with a Folio Voyage city guide. Each one is researched and checked around the experiences worth your time: landmarks, neighbourhoods, meals, and day trips.",
  },
  {
    title: "Shortlist the experiences",
    body: "Browse curated experiences with honest descriptions, price bands, and best-time notes. Save the ones that fit how you actually like to travel.",
  },
  {
    title: "Book with confidence",
    body: "As partner programs go live, book vetted operators directly through disclosed links — at no extra cost to you. Until then, every recommendation stands on its own.",
  },
  {
    title: "Travel, then tell us",
    body: "Go, enjoy it, and send back a tip or a correction. First-hand notes from travellers make the next person's guide better.",
  },
];

/** "How it works" (Covilla): image + intro on the left, an accordion of steps on the right. */
export function HowItWorks() {
  const [open, setOpen] = useState(0);

  return (
    <section className="container-page py-24 md:py-32">
      <div className="grid gap-14 md:grid-cols-2 md:gap-20">
        <div>
          <div className="relative aspect-[4/3] overflow-hidden rounded-[3px]">
            <Image
              src={IMG.bal_seminyak}
              alt="Travellers watching the sunset on a Bali beach"
              fill
              sizes="(max-width: 768px) 100vw, 45vw"
              className="object-cover"
            />
          </div>
          <p className="eyebrow mt-8">Get started today</p>
          <h2 className="mt-4 text-[30px] font-semibold leading-[1.1] md:text-[40px]">
            Take the stress out of planning
          </h2>
          <p className="mt-4 max-w-md text-[16px] leading-7 text-ink-soft">
            Four simple steps from &ldquo;where should we go?&rdquo; to a trip
            you&apos;re excited to take.
          </p>
          <Link
            href="/destinations"
            className="mt-7 inline-flex items-center bg-accent px-8 py-4 text-[11px] font-medium uppercase tracking-[0.2em] text-white transition-colors hover:bg-accent-ink"
          >
            Browse destinations
          </Link>
        </div>

        <div>
          <p className="eyebrow">How it works</p>
          <ul className="mt-6 divide-y divide-line border-y border-line">
            {steps.map((s, i) => {
              const isOpen = open === i;
              return (
                <li key={s.title}>
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? -1 : i)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center gap-5 py-6 text-left"
                  >
                    <span className="font-display text-[18px] font-semibold text-muted">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="flex-1 font-display text-[19px] font-medium text-ink md:text-[22px]">
                      {s.title}
                    </span>
                    <span className="text-muted">
                      {isOpen ? <Minus size={20} /> : <Plus size={20} />}
                    </span>
                  </button>
                  <div
                    className={cn(
                      "grid transition-all duration-300",
                      isOpen
                        ? "grid-rows-[1fr] pb-6 opacity-100"
                        : "grid-rows-[0fr] opacity-0",
                    )}
                  >
                    <div className="overflow-hidden">
                      <p className="pl-[42px] pr-4 text-[15px] leading-7 text-ink-soft">
                        {s.body}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
