"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, LoaderCircle, LogOut, UserRound } from "lucide-react";
import BrandMark from "@/app/components/BrandMark";
import ThemeToggle from "@/app/components/ThemeToggle";
import Alert from "@/app/components/ui/Alert";
import Button from "@/app/components/ui/Button";
import Menu, { MenuItem, MenuSeparator } from "@/app/components/ui/Menu";
import { signOutLocally } from "@/app/lib/auth/sign-out";
import { friendlyError } from "@/app/lib/errors";
import { createClient } from "@/app/lib/supabase/client";
import { TRAINING_LABEL } from "@/app/(app)/training/model/format-facts";

type NavItem = {
  href: string;
  label: string;
  /** Other sections that belong under this tab (league pages under Dashboard). */
  also?: string[];
};

const items: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", also: ["/leagues"] },
  { href: "/builder", label: "Pool Builder" },
  { href: "/calculator", label: "Calculator" },
  { href: "/training", label: TRAINING_LABEL },
  // Public (app/watch, outside app/(app)), and the only tab a signed-out visitor could also open.
  { href: "/watch", label: "Watch" },
];

function within(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * `aria-current` for a tab: "page" on its own section, "true" on a section
 * it only contains (a league page is not the Dashboard page itself).
 */
function currentValue(pathname: string, item: NavItem): "page" | "true" | undefined {
  if (within(pathname, item.href)) return "page";
  return item.also?.some((href) => within(pathname, href)) ? "true" : undefined;
}

/**
 * Signed-in header: the brand, text tabs with an accent underline on the
 * current page, and an account menu holding the type theme and Sign out.
 * Below `sm` the tabs take their own full-width row that scrolls sideways
 * if it cannot fit (320px), like LeagueNav.
 */
export default function AppNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const style = document.documentElement.style;
    const updateHeight = () => {
      style.setProperty("--app-nav-height", `${header.getBoundingClientRect().height}px`);
    };
    // Sticky draft controls must follow wrapped navigation and error banners.
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(header);
    return () => {
      observer.disconnect();
      style.removeProperty("--app-nav-height");
    };
  }, []);

  /**
   * Navigates only after the session is really gone. When auth-js reports
   * an error the local session is still valid (see app/lib/auth/sign-out.ts),
   * and going to /login would only bounce back through the proxy, so the
   * failure is shown here instead. The pending state is kept on success so
   * the avatar spinner does not flicker while the router swaps in /login.
   */
  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);

    try {
      const result = await signOutLocally(createClient().auth);
      if (result.ok) {
        router.replace("/login");
        router.refresh();
        return;
      }
      setSignOutError(result.message);
    } catch (caught) {
      setSignOutError(friendlyError(caught));
    }

    setSigningOut(false);
  }

  return (
    <header
      ref={headerRef}
      className="sticky top-0 z-40 border-b border-hairline bg-bg/85 backdrop-blur-md"
    >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-on-accent"
      >
        Skip to content
      </a>
      {/* Phones: brand and account on one row, the tabs on a second. */}
      <div className="mx-auto flex max-w-6xl flex-wrap items-center px-4 sm:flex-nowrap sm:gap-6 sm:px-6 lg:px-8">
        <Link
          href="/dashboard"
          className="-ml-1 flex h-14 shrink-0 items-center gap-2.5 rounded-lg px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          <BrandMark className="h-7 w-7" />
          <span className="text-[15px] font-semibold tracking-tight text-text">
            PokeDrafts
          </span>
        </Link>

        <nav
          aria-label="Primary"
          className="order-last -mx-4 flex w-[calc(100%+2rem)] overflow-x-auto border-t border-hairline px-2 [scrollbar-width:none] sm:order-none sm:mx-0 sm:w-auto sm:gap-1 sm:overflow-visible sm:border-t-0 sm:px-0"
        >
          {items.map((item) => {
            const current = currentValue(pathname, item);
            const active = current !== undefined;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={current}
                className={`relative inline-flex h-11 flex-1 shrink-0 items-center justify-center whitespace-nowrap rounded-md px-2 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus sm:h-14 sm:flex-none sm:px-3 sm:text-sm ${
                  active ? "text-text" : "text-muted hover:text-text"
                }`}
              >
                {item.label}
                <span
                  aria-hidden="true"
                  className={`absolute inset-x-2 bottom-0 h-0.5 rounded-full sm:inset-x-3 ${
                    active ? "bg-accent" : "bg-transparent"
                  }`}
                />
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center">
          <AccountMenu signingOut={signingOut} onSignOut={signOut} />
        </div>
      </div>

      {signOutError && (
        <div className="mx-auto max-w-6xl px-4 py-3 sm:px-6 lg:px-8">
          <Alert
            variant="error"
            title="Could not sign out"
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={signOut}
                pending={signingOut}
                pendingText="Retrying..."
              >
                Retry
              </Button>
            }
            onDismiss={() => setSignOutError(null)}
          >
            {signOutError} You are still signed in on this device.
          </Alert>
        </div>
      )}
    </header>
  );
}

/**
 * The avatar button and its panel: who is signed in, the type theme picker
 * and Sign out. The email comes from the local session (no network call);
 * until it is known the avatar shows a generic person icon.
 */
function AccountMenu({
  signingOut,
  onSignOut,
}: {
  signingOut: boolean;
  onSignOut: () => void;
}) {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    createClient()
      .auth.getSession()
      .then(({ data }) => {
        if (active) setEmail(data.session?.user.email ?? null);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const initial = email ? (Array.from(email.trim())[0] ?? "").toUpperCase() : "";

  return (
    <Menu
      label="Account"
      panelClassName="w-72"
      triggerClassName="flex h-9 items-center gap-1 rounded-full border border-hairline bg-panel/60 py-1 pl-1 pr-2 text-muted transition-colors hover:border-hairline-strong hover:bg-panel hover:text-text"
      trigger={
        <>
          <span
            aria-hidden="true"
            className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-xs font-semibold text-on-accent"
          >
            {initial || <UserRound className="h-4 w-4" />}
          </span>
          {signingOut ? (
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          )}
        </>
      }
    >
      <div className="px-2.5 pb-2.5 pt-1.5">
        <p className="text-xs text-muted">Signed in as</p>
        <p className="truncate text-sm font-medium text-text" title={email ?? undefined}>
          {email ?? "Your account"}
        </p>
      </div>
      <MenuSeparator />
      <div className="px-2.5 py-2.5">
        <ThemeToggle />
      </div>
      <MenuSeparator />
      <MenuItem onClick={onSignOut} disabled={signingOut} aria-busy={signingOut || undefined}>
        <LogOut className="h-4 w-4 text-muted" aria-hidden="true" />
        Sign out
      </MenuItem>
    </Menu>
  );
}
