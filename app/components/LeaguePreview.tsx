"use client";

import LeagueCard from "@/app/(app)/dashboard/LeagueCard";
import type { DashboardLeague, DashboardMember } from "@/app/(app)/dashboard/dashboard";

/**
 * The landing page's product shot: two real dashboard league cards drawn
 * from sample data. Decorative (`aria-hidden`, `inert`): it links nowhere and
 * takes no focus. Sprites point straight at the public `sprites` bucket
 * (`<dex number>.png`), because signed-out visitors cannot read the dex.
 */

const DEX: Record<string, number> = {
  Garchomp: 445,
  Gengar: 94,
  Dragonite: 149,
  Tyranitar: 248,
  Scizor: 212,
  Gyarados: 130,
  Lucario: 448,
  Togekiss: 468,
  Excadrill: 530,
  Volcarona: 637,
};

const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "") ?? "";

function spriteSrc(name: string): string | undefined {
  const dex = DEX[name];
  return dex && base ? `${base}/storage/v1/object/public/sprites/${dex}.png` : undefined;
}

function members(names: string[]): DashboardMember[] {
  return names.map((teamName, index) => ({
    id: `sample-${index}`,
    teamName,
    draftPosition: index + 1,
  }));
}

const shared = {
  commissioner_id: "sample",
  playoff_format: "top_4",
  champion_member_id: null,
};

const SAMPLES: DashboardLeague[] = [
  {
    league: {
      ...shared,
      id: "sample-live",
      name: "Friday Night Draft",
      max_coaches: 8,
      draft_started: true,
      draft_completed: false,
      current_pick_number: 25,
      picks_per_team: 10,
    },
    memberId: "sample-0",
    teamName: "Thunder Road",
    role: "commissioner",
    phase: "live",
    championTeamName: null,
    members: members([
      "Thunder Road",
      "Lake Effect",
      "Night Shift",
      "Rock Bottom",
      "Iron Will",
      "Sky High",
      "Deep Cuts",
      "Wild Card",
    ]),
    roster: ["Garchomp", "Gengar", "Dragonite"],
  },
  {
    league: {
      ...shared,
      id: "sample-season",
      name: "Office League",
      max_coaches: 6,
      draft_started: true,
      draft_completed: true,
      current_pick_number: 49,
      picks_per_team: 8,
    },
    memberId: "sample-2",
    teamName: "Night Shift",
    role: "coach",
    phase: "complete",
    championTeamName: null,
    members: members(["Lake Effect", "Rock Bottom", "Night Shift", "Iron Will", "Sky High", "Deep Cuts"]),
    roster: ["Tyranitar", "Scizor", "Gyarados", "Lucario", "Togekiss", "Excadrill", "Volcarona", "Gengar"],
  },
];

function noop() {}

export default function LeaguePreview() {
  return (
    <div aria-hidden="true" inert className="pointer-events-none select-none">
      <ul className="flex flex-col gap-3">
        {SAMPLES.map((item) => (
          <LeagueCard
            key={item.league.id}
            item={item}
            canDelete={false}
            onDelete={noop}
            spriteSrc={spriteSrc}
          />
        ))}
      </ul>
    </div>
  );
}
