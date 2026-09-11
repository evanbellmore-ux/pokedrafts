"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Hammer, LayoutDashboard, LoaderCircle, LogOut } from "lucide-react";
import ThemeToggle from "@/app/components/ThemeToggle";
import Alert from "@/app/components/ui/Alert";
import Button from "@/app/components/ui/Button";
import { signOutLocally } from "@/app/lib/auth/sign-out";
import { friendlyError } from "@/app/lib/errors";
import { createClient } from "@/app/lib/supabase/client";

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
};

const items: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/builder", label: "Pool Builder", icon: Hammer },
];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

const linkBase =
  "inline-flex h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus sm:px-4";

export default function AppNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  /**
   * Navigates only after the session is really gone. When auth-js reports
   * an error the local session is still valid (see app/lib/auth/sign-out.ts),
   * and going to /login would only bounce back through the proxy, so the
   * failure is shown here instead. The pending state is kept on success so
   * the button does not flicker while the router swaps in /login.
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
    <header className="sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-on-accent"
      >
        Skip to content
      </a>
      {/*
        Width budget below `sm` (docs section 8.5): brand ~92px + 8px gap +
        four 40-42px icon controls with 6px gaps (~182px) = ~282px, inside
        the 288px available at a 320px viewport, so nothing overflows.
      */}
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3 sm:gap-3 sm:px-6 lg:px-8">
        <Link
          href="/dashboard"
          className="shrink-0 text-sm font-bold uppercase tracking-wide text-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          PokeDrafts
        </Link>

        <nav aria-label="Primary" className="flex items-center gap-1.5 sm:gap-2">
          {items.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                aria-label={item.label}
                title={item.label}
                className={`${linkBase} ${
                  active
                    ? "bg-accent text-on-accent"
                    : "border border-line bg-panel text-text hover:border-line-strong hover:bg-panel-hover"
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">{item.label}</span>
              </Link>
            );
          })}

          <ThemeToggle />

          <button
            type="button"
            onClick={signOut}
            disabled={signingOut}
            aria-busy={signingOut || undefined}
            aria-label="Sign out"
            title="Sign out"
            className={`${linkBase} border border-line text-muted hover:border-line-strong hover:text-text disabled:opacity-60`}
          >
            {signingOut ? (
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <LogOut className="h-4 w-4" aria-hidden="true" />
            )}
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </nav>
      </div>

      {signOutError && (
        <div className="mx-auto max-w-6xl px-4 pb-3 sm:px-6 lg:px-8">
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
