import type { SliceCrumb } from "@/lib/seo-slice/page-model";

/** Breadcrumbs (spec 0006 page template, AC-T8). The last crumb is the page and is not a link. */
export function SliceBreadcrumbs({ crumbs }: { crumbs: SliceCrumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-[13px] text-muted">
      <ol className="flex flex-wrap items-center gap-1.5">
        {crumbs.map((c, i) => (
          <li key={i} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden>›</span>}
            {c.href ? (
              <a href={c.href} className="hover:text-accent">
                {c.name}
              </a>
            ) : (
              <span aria-current="page" className="text-ink-soft">
                {c.name}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
