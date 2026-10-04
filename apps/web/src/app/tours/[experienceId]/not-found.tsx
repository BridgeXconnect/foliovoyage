import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { TourNotFoundBody } from "@/components/tour/TourNotFoundBody";

/**
 * The "no longer available" page for `/tours/:experienceId` (spec 0005, AC-8).
 * Next sends it with HTTP 404 when the tour page calls `notFound()`. It is
 * `noindex` like the tour page, and reads no request data on the server: the
 * city link comes from `?from=` in the browser (`TourNotFoundBody`).
 */
export const metadata: Metadata = {
  title: "Tour no longer available",
  robots: { index: false, follow: false },
};

export default function TourNotFound() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-14">
        <h1 className="text-[28px] font-semibold leading-tight">This tour is no longer available</h1>
        <Suspense
          fallback={
            <p className="mt-4 text-[15px] text-ink-soft">
              <Link href="/discover" className="underline">
                Discover more tours
              </Link>
            </p>
          }
        >
          <TourNotFoundBody />
        </Suspense>
      </main>
      <SiteFooter />
    </>
  );
}
