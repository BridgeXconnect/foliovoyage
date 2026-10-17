/**
 * The slice layout (spec 0006 page template, AC-T9): no site header or footer
 * while the site is gated, so every link on a slice page is one a visitor can
 * reach. The name is plain text, not a link to the gated home page.
 */
export default function SliceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-line">
        <div className="mx-auto max-w-[1100px] px-6 py-4">
          <span className="font-display text-[18px] font-semibold tracking-tight text-ink">Folio Voyage</span>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
