"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function LeagueNav({ leagueId }: { leagueId: string }) {
  const pathname = usePathname();

  const links = [
    { href: `/dashboard`, label: "Home" },
    { href: `/leagues/${leagueId}`, label: "Overview" },
    { href: `/leagues/${leagueId}/pool`, label: "Pokemon Pool" },
    { href: `/leagues/${leagueId}/settings`, label: "Settings" },
    { href: `/leagues/${leagueId}/team`, label: "Teams" },
    { href: `/leagues/${leagueId}/matches`, label: "Matches" },
    { href: `/leagues/${leagueId}/draft`, label: "Draft" },
  ];

  return (
    <nav className="mb-6 flex flex-wrap gap-3 border-b border-zinc-800 pb-4">
      {links.map((link) => {
        const active = pathname === link.href;

        return (
          <Link
            key={link.href}
            href={link.href}
            className={`rounded-xl px-4 py-2 text-sm font-semibold ${
              active
                ? "bg-emerald-500 text-zinc-950"
                : "bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}