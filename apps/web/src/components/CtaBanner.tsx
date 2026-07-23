import Link from "next/link";
import { ArrowRight } from "lucide-react";

/**
 * Full-bleed CTA band shown near the foot of content pages. Every instance
 * carries the affiliate Disclosure link, satisfying the requirement that
 * Disclosure is reachable from every CTA-bearing page.
 */
export function CtaBanner({
  eyebrow = "Plan your voyage",
  title = "Find your next experience",
  body = "Browse hand-picked guides to the world's most rewarding destinations.",
  href = "/destinations",
  cta = "Explore destinations",
}: {
  eyebrow?: string;
  title?: string;
  body?: string;
  href?: string;
  cta?: string;
}) {
  return (
    <section className="bg-ink text-white">
      <div className="container-page flex flex-col items-start gap-8 py-16 md:flex-row md:items-center md:justify-between">
        <div className="max-w-2xl">
          <p className="eyebrow !text-white/70">{eyebrow}</p>
          <h2 className="mt-3 text-[32px] font-display font-semibold leading-tight text-white md:text-[40px]">
            {title}
          </h2>
          <p className="mt-3 text-[16px] leading-7 text-white/80">{body}</p>
        </div>
        <div className="flex flex-col items-start gap-3">
          <Link
            href={href}
            className="inline-flex items-center gap-2 rounded-card bg-white px-7 py-4 text-[11px] font-medium uppercase tracking-[0.19em] text-ink transition-transform hover:-translate-y-0.5"
          >
            {cta}
            <ArrowRight size={16} />
          </Link>
          <Link
            href="/legal/disclosure"
            className="text-[12px] text-white/60 underline underline-offset-2 hover:text-white/90"
          >
            How we earn — affiliate disclosure
          </Link>
        </div>
      </div>
    </section>
  );
}
