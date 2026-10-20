"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, MoreHorizontal, Settings, Trash2, Trophy } from "lucide-react";
import PokemonSprite from "@/app/components/PokemonSprite";
import TeamAvatar from "@/app/components/TeamAvatar";
import Menu, { MenuItem, MenuLink, MenuSeparator } from "@/app/components/ui/Menu";
import { pluralize, roleLabel, teamNameLabel } from "@/app/lib/league/labels";
import {
  MAX_COACH_AVATARS,
  draftProgress,
  isSpectating,
  leagueHref,
  leagueStatus,
  rosterSlots,
  type DashboardLeague,
  type LeagueStatus,
} from "./dashboard";

/**
 * One league on the dashboard: a single status line, the league and the
 * caller's team, their roster as sprite slots (empty slots before the
 * draft), and the league's coaches. The whole card is one link (stretched
 * over the card by the title's pseudo-element); the commissioner's options
 * menu sits above it.
 */
export default function LeagueCard({
  item,
  canDelete,
  onDelete,
  spriteSrc,
}: {
  item: DashboardLeague;
  canDelete: boolean;
  onDelete: (item: DashboardLeague) => void;
  /** Known sprite URLs by Pokémon name, for the signed-out landing preview. */
  spriteSrc?: (name: string) => string | undefined;
}) {
  const { league } = item;
  const status = leagueStatus(item);
  const live = status.kind === "drafting";
  const wonTitle = status.kind === "champion" && status.mine;

  return (
    <li
      className={`group relative flex flex-col rounded-xl border bg-panel/60 p-4 transition-colors hover:bg-panel sm:p-5 ${
        live
          ? "border-accent-border"
          : wonTitle
            ? "border-warning/40"
            : "border-hairline hover:border-hairline-strong"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <StatusLine status={status} />
          <h3 className="wrap-anywhere mt-2 text-base font-semibold tracking-tight text-text sm:text-lg">
            {/* Stretched link: the pseudo-element makes the whole card
                clickable and carries the focus ring around the card. */}
            <Link
              href={leagueHref(item)}
              className="after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-focus"
            >
              {league.name}
            </Link>
          </h3>
          <dl className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-sm text-muted">
            <div className="min-w-0">
              <dt className="sr-only">Your team</dt>
              <dd className="wrap-anywhere">{teamNameLabel(item.teamName)}</dd>
            </div>
            <div className="flex items-center gap-1.5 before:text-faint before:content-['·']">
              <dt className="sr-only">Your role</dt>
              <dd>{roleLabel(item.role)}</dd>
            </div>
          </dl>
        </div>
        {canDelete && <LeagueMenu item={item} onDelete={onDelete} />}
      </div>

      {status.kind === "drafting" && (
        <div aria-hidden="true" className="mt-4 h-1 overflow-hidden rounded-full bg-hairline">
          <div
            className="h-full rounded-full bg-accent"
            style={{ width: `${Math.round(draftProgress(status) * 100)}%` }}
          />
        </div>
      )}

      <Roster item={item} spriteSrc={spriteSrc} />

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-hairline pt-3.5">
        <Coaches item={item} />
        <span
          aria-hidden="true"
          className={`inline-flex shrink-0 items-center gap-1 text-sm font-medium transition-colors ${
            live ? "text-accent-text" : "text-faint group-hover:text-text"
          }`}
        >
          {live && "Enter draft room"}
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
        </span>
      </div>
    </li>
  );
}

function Dot({ className }: { className: string }) {
  return <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${className}`} />;
}

const statusClass = "flex min-w-0 items-center gap-2 text-xs font-medium text-text";

function StatusLine({ status }: { status: LeagueStatus }) {
  switch (status.kind) {
    case "drafting":
      return (
        <p className={statusClass}>
          <span aria-hidden="true" className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
          </span>
          Drafting now
          <span className="text-muted">
            Pick {status.pick} of {status.totalPicks}
          </span>
        </p>
      );
    case "season":
      return (
        <p className={statusClass}>
          <Dot className="bg-accent" />
          In season
          {status.playoffTeams > 0 && (
            <span className="text-muted">Top {status.playoffTeams} make the playoffs</span>
          )}
        </p>
      );
    case "champion":
      return (
        <p className={statusClass}>
          <Trophy className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
          {status.mine ? (
            "Your team won the title"
          ) : (
            <span className="wrap-anywhere">
              Champion <span className="text-muted">{status.teamName}</span>
            </span>
          )}
        </p>
      );
    default:
      return (
        <p className={statusClass}>
          <Dot className="bg-faint" />
          Setting up
        </p>
      );
  }
}

/**
 * The caller's Pokémon as slots, one per pick, in pick order. The grid is
 * decorative (names are on the sprites' titles for pointer users); the
 * sentence before it is what assistive technology reads.
 */
function Roster({
  item,
  spriteSrc,
}: {
  item: DashboardLeague;
  spriteSrc?: (name: string) => string | undefined;
}) {
  if (isSpectating(item)) {
    return <p className="mt-4 text-sm text-muted">You are not drafting in this league.</p>;
  }

  const { slots, overflow } = rosterSlots(item.roster, item.league.picks_per_team);
  const open = slots.filter((slot) => slot === null).length + overflow;
  const summary =
    item.roster.length > 0
      ? `Your roster: ${item.roster.join(", ")}.${open > 0 ? ` ${pluralize(open, "open slot")}.` : ""}`
      : `Your roster is empty: ${pluralize(slots.length + overflow, "open slot")}.`;

  return (
    <div className="mt-4">
      <p className="sr-only">{summary}</p>
      <ul
        aria-hidden="true"
        className="grid gap-1.5"
        style={{
          gridTemplateColumns: `repeat(${slots.length + (overflow > 0 ? 1 : 0)}, minmax(0, 2.5rem))`,
        }}
      >
        {slots.map((name, index) =>
          name ? (
            <li
              key={`${index}-${name}`}
              className="flex aspect-square items-center justify-center rounded-full bg-bg/70 ring-1 ring-hairline"
            >
              <PokemonSprite
                name={name}
                size="fill"
                bare
                className="scale-110"
                src={spriteSrc?.(name)}
              />
            </li>
          ) : (
            <li
              key={index}
              className="aspect-square rounded-full border border-dashed border-hairline-strong"
            />
          )
        )}
        {overflow > 0 && (
          <li className="flex aspect-square items-center justify-center rounded-full bg-bg/70 text-xs font-medium text-muted ring-1 ring-hairline">
            +{overflow}
          </li>
        )}
      </ul>
    </div>
  );
}

/** Coach initials (the caller's in the accent), then open seats while recruiting. */
function Coaches({ item }: { item: DashboardLeague }) {
  const { league, members } = item;
  const shown = members.slice(0, MAX_COACH_AVATARS);
  const extra = members.length - shown.length;
  const recruiting = item.phase === "setup";
  const openSeats = recruiting
    ? Math.max(0, Math.min(league.max_coaches - members.length, MAX_COACH_AVATARS - shown.length))
    : 0;
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <div aria-hidden="true" className="flex shrink-0 gap-1">
        {shown.map((member) => (
          <TeamAvatar
            key={member.id}
            name={member.teamName}
            mine={member.id === item.memberId}
            size="sm"
            title={teamNameLabel(member.teamName)}
          />
        ))}
        {extra > 0 && (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-panel-hover text-[10px] font-semibold text-muted">
            +{extra}
          </span>
        )}
        {Array.from({ length: openSeats }, (_, index) => (
          <span
            key={`open-${index}`}
            className="h-6 w-6 shrink-0 rounded-full border border-dashed border-hairline-strong"
          />
        ))}
      </div>
      <dl className="min-w-0 text-sm text-muted">
        <div>
          <dt className="sr-only">Coaches</dt>
          <dd className="truncate tabular-nums">
            {recruiting
              ? `${members.length} of ${pluralize(league.max_coaches, "coach", "coaches")}`
              : pluralize(members.length, "coach", "coaches")}
          </dd>
        </div>
      </dl>
    </div>
  );
}

/** Commissioner-only options: a settings shortcut and the league delete. */
function LeagueMenu({
  item,
  onDelete,
}: {
  item: DashboardLeague;
  onDelete: (item: DashboardLeague) => void;
}) {
  const { league } = item;
  return (
    <Menu
      label={`Options for ${league.name}`}
      className="-mr-1.5 -mt-1.5 shrink-0"
      triggerClassName="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-panel-hover hover:text-text"
      trigger={<MoreHorizontal className="h-4 w-4" aria-hidden="true" />}
      panelClassName="w-52"
    >
      <MenuLink href={`/leagues/${league.id}/settings`}>
        <Settings className="h-4 w-4 text-muted" aria-hidden="true" />
        League settings
      </MenuLink>
      <MenuSeparator />
      <MenuItem
        tone="danger"
        onClick={() => onDelete(item)}
        aria-label={`Delete league: ${league.name}`}
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
        Delete league
      </MenuItem>
    </Menu>
  );
}

/** Placeholder card while the leagues load; mirrors LeagueCard's layout. */
export function LeagueCardSkeleton() {
  const block = "animate-pulse rounded-md bg-panel-hover";
  return (
    <li aria-hidden="true" className="rounded-xl border border-hairline bg-panel/60 p-4 sm:p-5">
      <div className={`${block} h-3 w-24`} />
      <div className={`${block} mt-3 h-5 w-48 max-w-full`} />
      <div className={`${block} mt-2 h-4 w-32`} />
      <div className="mt-4 flex gap-1.5">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="h-9 w-9 animate-pulse rounded-full bg-panel-hover" />
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-hairline pt-3.5">
        <div className={`${block} h-6 w-32`} />
        <div className={`${block} h-4 w-20`} />
      </div>
    </li>
  );
}

/** Shown in place of the list when the caller belongs to no league yet. */
export function NoLeagues({ action }: { action: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-hairline-strong px-6 py-12 text-center">
      <ul aria-hidden="true" className="flex gap-2">
        {["Bulbasaur", "Charmander", "Squirtle"].map((name) => (
          <li
            key={name}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-panel ring-1 ring-hairline"
          >
            <PokemonSprite name={name} size="fill" bare className="scale-110" />
          </li>
        ))}
      </ul>
      <h2 className="mt-5 text-lg font-semibold tracking-tight text-text">Start your first league</h2>
      <p className="mt-1 max-w-sm text-sm text-muted">
        Set up a draft pool, send your friends the invite link and draft live. Got an
        invite code instead? Use it under Join a league.
      </p>
      <div className="mt-6">{action}</div>
    </div>
  );
}
