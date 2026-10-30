import Link from "next/link";
import type { ReactNode } from "react";
import BrandMark from "@/app/components/BrandMark";
import { linkClassName } from "@/app/lib/theme";

/**
 * The shell of the pages people see before they sign in (login, signup, the
 * password pages and an invite): the brand above one centred card, with a
 * faint wash of the theme's accent behind it, and the privacy policy and
 * terms links in a footer below it (a sibling of the main element, so it is
 * the contentinfo landmark). No AppNav.
 */
export default function PublicShell({ children }: { children: ReactNode }) {
  return (
    <>
      <main
        id="main-content"
        className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-4 pb-6 pt-10 sm:pb-8 sm:pt-16"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-[28rem] bg-[radial-gradient(ellipse_55%_60%_at_50%_0%,color-mix(in_srgb,var(--type-accent)_12%,transparent),transparent)]"
        />
        <div className="relative w-full max-w-[26rem]">
          <Link
            href="/"
            className={`${linkClassName} mx-auto flex w-fit items-center gap-2.5 px-1 py-1`}
          >
            <BrandMark className="h-8 w-8" />
            <span className="text-base font-semibold tracking-tight text-text">PokeDrafts</span>
          </Link>
          <div className="mt-6 rounded-2xl border border-line bg-panel p-6 shadow-2xl shadow-black/30 sm:p-8">
            {children}
          </div>
        </div>
      </main>
      <footer className="px-4 pb-6">
        <nav aria-label="Legal" className="flex justify-center gap-5 text-xs">
          <Link href="/privacy" className={`${linkClassName} text-faint hover:text-text`}>
            Privacy Policy
          </Link>
          <Link href="/terms" className={`${linkClassName} text-faint hover:text-text`}>
            Terms of Service
          </Link>
        </nav>
      </footer>
    </>
  );
}
