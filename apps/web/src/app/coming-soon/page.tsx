import type { Metadata } from "next";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Coming soon",
  // Never index the holding page, even if it is somehow reached directly.
  robots: { index: false, follow: false },
};

export default async function ComingSoonPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-surface px-6 py-16 text-center">
      {/* Soft brand-blue backdrop glow. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[38rem] w-[38rem] -translate-x-1/2 rounded-full opacity-[0.07] blur-3xl"
        style={{
          background:
            "radial-gradient(circle, var(--color-accent), transparent 70%)",
        }}
      />

      <div className="relative z-10 flex w-full max-w-xl flex-col items-center">
        {/* Wordmark — mirrors src/components/Wordmark.tsx. */}
        <div className="mb-10 inline-flex items-baseline gap-[4px] text-[22px] leading-none text-ink">
          <span className="font-serif font-semibold">Folio</span>
          <span className="font-sans font-light tracking-[0.5px]">Voyage</span>
        </div>

        <p className="eyebrow mb-5">Arriving soon</p>

        <h1 className="font-serif text-[2.5rem] font-semibold leading-[1.1] text-ink sm:text-[3.25rem]">
          The folio is being written.
        </h1>

        <p className="mt-6 max-w-md text-[1.05rem] leading-relaxed text-muted">
          {site.name} is a hand-picked travel folio — original city guides and
          experiences across the world&apos;s most rewarding destinations. We&apos;re putting the finishing touches on it.
        </p>

        <p className="mt-8 text-sm text-muted">
          Questions or partnerships?{" "}
          <a
            href={`mailto:${site.email}`}
            className="text-accent underline-offset-4 hover:underline"
          >
            {site.email}
          </a>
        </p>

        {/* Team preview — deliberately understated. */}
        <details className="mt-14 w-full max-w-sm text-left">
          <summary className="cursor-pointer list-none text-center text-xs uppercase tracking-[0.18em] text-muted transition hover:text-ink">
            Team preview
          </summary>
          <form
            method="POST"
            action="/api/unlock"
            className="mt-4 flex flex-col gap-3"
          >
            <label htmlFor="password" className="sr-only">
              Preview password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="Preview password"
              className="w-full rounded-[var(--radius-lg)] border border-line-strong bg-white px-4 py-2.5 text-ink outline-none transition focus:border-accent"
            />
            {error ? (
              <p className="text-sm text-[#b3261e]">
                That password didn&apos;t work. Try again.
              </p>
            ) : null}
            <button
              type="submit"
              className="rounded-[var(--radius-lg)] bg-ink px-4 py-2.5 font-medium text-white transition hover:opacity-90"
            >
              Enter site
            </button>
          </form>
        </details>
      </div>
    </main>
  );
}
