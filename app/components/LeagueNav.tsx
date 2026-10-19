"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { ChevronRight } from "lucide-react";

type LeagueLink = {
  href: string;
  label: string;
  exact?: boolean;
};

export function leagueNavLinks(leagueId: string): LeagueLink[] {
  const base = `/leagues/${leagueId}`;
  return [
    { href: base, label: "Overview", exact: true },
    { href: `${base}/draft`, label: "Draft" },
    { href: `${base}/team`, label: "My Team" },
    { href: `${base}/matches`, label: "Matches" },
    { href: `${base}/standings`, label: "Standings" },
    { href: `${base}/free-agents`, label: "Free Agents" },
    { href: `${base}/pool`, label: "Pool" },
    { href: `${base}/settings`, label: "Settings" },
  ];
}

/**
 * League shell: a breadcrumb back to the dashboard with the league's name,
 * then the section tabs, underlined in the accent like AppNav. The tab row
 * scrolls sideways on phones instead of wrapping.
 */
export default function LeagueNav({
  leagueId,
  leagueName,
}: {
  leagueId: string;
  leagueName?: string;
}) {
  const pathname = usePathname();
  const links = leagueNavLinks(leagueId);
  const tabsRef = useRef<HTMLElement>(null);

  // On phones the strip scrolls; bring the current tab into view so a later
  // section (Standings, Settings) is not cut off at the edge.
  useEffect(() => {
    const strip = tabsRef.current;
    const active = strip?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!strip || !active || strip.scrollWidth <= strip.clientWidth) return;
    const offset =
      active.getBoundingClientRect().left - strip.getBoundingClientRect().left;
    strip.scrollLeft += offset - (strip.clientWidth - active.offsetWidth) / 2;
  }, [pathname]);

  return (
    <div className="mb-6 sm:mb-8">
      {leagueName && (
        <nav aria-label="Breadcrumb">
          <ol className="flex min-w-0 items-center gap-1.5 text-sm">
            <li className="shrink-0">
              <Link
                href="/dashboard"
                className="rounded text-muted transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                Leagues
              </Link>
            </li>
            <li aria-hidden="true" className="shrink-0 text-faint">
              <ChevronRight className="h-3.5 w-3.5" />
            </li>
            <li className="min-w-0 truncate font-medium text-text" aria-current="page">
              {leagueName}
            </li>
          </ol>
        </nav>
      )}
      <nav
        ref={tabsRef}
        aria-label="League sections"
        className="-mx-4 mt-3 overflow-x-auto border-b border-line px-4 [scrollbar-width:none] sm:mx-0 sm:px-0"
      >
        <ul className="flex w-max gap-1 sm:w-auto">
          {links.map((link) => {
            const active = link.exact
              ? pathname === link.href
              : pathname === link.href || pathname.startsWith(`${link.href}/`);

            return (
              <li key={link.href} className="shrink-0">
                <Link
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={`relative inline-flex h-10 items-center whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus ${
                    active ? "text-text" : "text-muted hover:text-text"
                  }`}
                >
                  {link.label}
                  <span
                    aria-hidden="true"
                    className={`absolute inset-x-3 bottom-0 h-0.5 rounded-full ${
                      active ? "bg-accent" : "bg-transparent"
                    }`}
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
