"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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

export default function LeagueNav({
  leagueId,
  leagueName,
}: {
  leagueId: string;
  leagueName?: string;
}) {
  const pathname = usePathname();
  const links = leagueNavLinks(leagueId);

  return (
    <div className="mb-6 border-b border-line pb-4">
      {leagueName && (
        <p className="mb-3 truncate text-xs font-semibold uppercase tracking-wide text-accent-text">
          {leagueName}
        </p>
      )}
      <nav
        aria-label="League sections"
        className="-mx-4 overflow-x-auto px-4 [scrollbar-width:thin] sm:mx-0 sm:px-0"
      >
        <ul className="flex w-max gap-2 sm:w-auto sm:flex-wrap">
          {links.map((link) => {
            const active = link.exact
              ? pathname === link.href
              : pathname === link.href || pathname.startsWith(`${link.href}/`);

            return (
              <li key={link.href} className="shrink-0">
                <Link
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={`inline-flex items-center rounded-xl px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                    active
                      ? "bg-accent text-on-accent"
                      : "border border-line bg-panel text-muted hover:border-line-strong hover:bg-panel-hover hover:text-text"
                  }`}
                >
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
