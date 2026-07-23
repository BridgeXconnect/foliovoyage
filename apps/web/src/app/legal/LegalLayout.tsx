import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

/** Shared, natively-responsive shell for the text-only legal & contact pages. */
export function LegalLayout({
  title,
  updated,
  children,
}: {
  title: string;
  updated?: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-12 sm:py-16">
        <h1 className="text-[32px] font-semibold leading-tight sm:text-[40px]">
          {title}
        </h1>
        {updated && (
          <p className="mt-2 text-sm text-muted">Last updated: {updated}</p>
        )}
        <div className="mt-8 space-y-5 text-[15px] leading-7 text-ink-soft [&_a]:text-accent [&_a]:underline [&_h2]:mt-9 [&_h2]:text-[20px] [&_h2]:font-semibold [&_h2]:text-ink">
          {children}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
