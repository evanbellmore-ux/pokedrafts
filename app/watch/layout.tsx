import Link from "next/link";
import AppNav from "@/app/components/AppNav";
import BrandMark from "@/app/components/BrandMark";
import { ButtonLink } from "@/app/components/ui/Button";
import { createServerSupabase } from "@/app/lib/supabase/server";
import { linkClassName } from "@/app/lib/theme";

/**
 * The Watch pages are public (docs/release-architecture.md section 15): a
 * signed-in visitor keeps the app's navigation, which has a Watch tab, and a
 * signed-out visitor gets the landing page's header and footer.
 */
export default async function WatchLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabase();
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  return (
    <>
      {signedIn ? (
        <AppNav />
      ) : (
        <header className="border-b border-hairline">
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-on-accent"
          >
            Skip to content
          </a>
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
            <Link href="/" className={`${linkClassName} -ml-1 flex items-center gap-2.5 px-1 py-1`}>
              <BrandMark className="h-7 w-7" />
              <span className="text-[15px] font-semibold tracking-tight text-text">PokeDrafts</span>
            </Link>
            <nav aria-label="Account" className="flex items-center gap-1.5">
              <ButtonLink href="/login" variant="ghost" size="sm">
                Log in
              </ButtonLink>
              <ButtonLink href="/signup" size="sm">
                Sign up
              </ButtonLink>
            </nav>
          </div>
        </header>
      )}
      <main id="main-content" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </main>
      {!signedIn && (
        <footer className="border-t border-line">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
            <p className="text-xs text-faint">
              PokeDrafts is a fan project and is not affiliated with Nintendo, Game Freak or The
              Pokémon Company.
            </p>
            <nav aria-label="Footer" className="flex flex-wrap gap-x-4 gap-y-2">
              <Link href="/signup" className={`${linkClassName} text-sm text-muted hover:text-text`}>
                Run your own league
              </Link>
              <Link href="/privacy" className={`${linkClassName} text-sm text-muted hover:text-text`}>
                Privacy
              </Link>
              <Link href="/terms" className={`${linkClassName} text-sm text-muted hover:text-text`}>
                Terms
              </Link>
            </nav>
          </div>
        </footer>
      )}
    </>
  );
}
