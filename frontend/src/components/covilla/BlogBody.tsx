import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { Block } from "@/data/blog";

/**
 * Renders a structured blog body (see `Block` in data/blog.ts): headings,
 * paragraphs, bullet lists, and curated "pick" callouts. Server component —
 * no interactivity, fully SSR'd.
 *
 * `pick` mirrors the Experience affiliate seam: today `href` points at an
 * internal destination guide; when a partner program is approved it can become
 * a disclosed `sponsored nofollow` deep link with no layout change.
 */
export function BlogBody({ blocks }: { blocks: Block[] }) {
  return (
    <div className="space-y-6 text-[18px] leading-8 text-ink-soft">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case "h2":
            return (
              <h2
                key={i}
                className="!mt-12 font-display text-[26px] font-semibold leading-tight text-ink md:text-[30px]"
              >
                {block.text}
              </h2>
            );

          case "p":
            return <p key={i}>{block.text}</p>;

          case "list":
            return (
              <ul key={i} className="ml-1 space-y-2">
                {block.items.map((item, j) => (
                  <li key={j} className="flex gap-3">
                    <span
                      aria-hidden
                      className="mt-[13px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                    />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            );

          case "pick": {
            const inner = (
              <>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h3 className="font-display text-[20px] font-medium leading-snug text-ink">
                    {block.title}
                  </h3>
                  {block.meta && (
                    <span className="text-[13px] font-medium text-muted">
                      {block.meta}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-[15px] leading-7 text-ink-soft">
                  {block.note}
                </p>
                {block.href && (
                  <span className="mt-4 inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.16em] text-accent">
                    See the guide <ArrowUpRight size={14} />
                  </span>
                )}
              </>
            );

            const cardClass =
              "block rounded-[10px] border border-line bg-surface p-6 transition-shadow duration-300 hover:shadow-[0_18px_40px_-28px_rgba(15,19,38,0.45)]";

            if (!block.href) {
              return (
                <div key={i} className={cardClass}>
                  {inner}
                </div>
              );
            }

            // Internal guide link vs. (future) external affiliate link.
            return block.href.startsWith("/") ? (
              <Link key={i} href={block.href} className={`group ${cardClass}`}>
                {inner}
              </Link>
            ) : (
              <a
                key={i}
                href={block.href}
                target="_blank"
                rel="sponsored nofollow noopener"
                className={`group ${cardClass}`}
              >
                {inner}
              </a>
            );
          }

          default:
            return null;
        }
      })}
    </div>
  );
}
