import Link from "next/link";
import { cn } from "@/lib/cn";

/**
 * "Folio Voyage" wordmark — Fraunces serif "Folio" + light sans "Voyage",
 * baseline-aligned, exactly as in the original design.
 */
export function Wordmark({
  className,
  invert = false,
}: {
  className?: string;
  invert?: boolean;
}) {
  return (
    <Link
      href="/"
      aria-label="Folio Voyage home"
      className={cn(
        "inline-flex items-baseline gap-[4px] text-[20px] leading-none",
        invert ? "text-white" : "text-ink",
        className,
      )}
    >
      <span className="font-serif font-semibold">Folio</span>
      <span className="font-sans font-light tracking-[0.5px]">Voyage</span>
    </Link>
  );
}
