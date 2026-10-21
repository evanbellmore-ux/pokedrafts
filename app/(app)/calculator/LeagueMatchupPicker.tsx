"use client";

import { useId } from "react";
import { RefreshCw } from "lucide-react";
import PokemonSprite from "@/app/components/PokemonSprite";
import TypeBadge from "@/app/components/TypeBadge";
import { Alert, Button, Field, Select } from "@/app/components/ui";
import { ButtonLink } from "@/app/components/ui/Button";
import type { DoublesSideId, DoublesSlotId } from "@/app/lib/battle/doubles-types";
import { championsRuntime, cosmeticFamily, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { ChampionsSpecies } from "@/app/lib/battle/types";
import { teamNameLabel } from "@/app/lib/league/labels";
import type { CalculatorRosterState } from "./roster-data";
import { getRosterPanel, type BattleSide, type RosterChoice, type RosterPanel, type RosterRole, type RosterSource } from "./roster-prep";

type SourcePickerProps = {
  state: CalculatorRosterState;
  onRefresh: () => void;
  /** Where "Log in again" returns to; defaults to the calculator. */
  loginNext?: string;
  /**
   * Inside a page's own team panel (Training): no card, heading, Refresh teams or roster status (the page states those once
   * for both pickers, with RefreshTeamsButton and SourceFeedback), and "No team chosen." / "No league chosen." as plain text
   * (the page's own status says each once). Defaults to the calculator's card.
   */
  embedded?: boolean;
};

export function RefreshTeamsButton({ state, onRefresh, className = "" }: Pick<SourcePickerProps, "state" | "onRefresh"> & { className?: string }) {
  const loading = state.status === "loading" || state.teamsStatus === "loading";
  const failed = state.status === "error" || state.teamsStatus === "error";
  return (
    <Button variant="secondary" size="sm" className={`min-h-11 ${className}`.trim()} onClick={onRefresh} disabled={loading}>
      <RefreshCw className="h-4 w-4" aria-hidden="true" />{failed ? "Retry teams" : "Refresh teams"}
    </Button>
  );
}

export function SourceFeedback({ state, loginNext = "/calculator", live = true }: {
  state: CalculatorRosterState;
  loginNext?: string;
  /** false: the loading and "No leagues." lines are plain text (the page's own status says them, Training's once per team). */
  live?: boolean;
}) {
  const loading = state.status === "loading" || state.teamsStatus === "loading";
  const failed = state.status === "error" || state.teamsStatus === "error";
  const status = live ? "status" : undefined;
  return (
    <>
      {loading && <p role={status} className="text-sm text-muted">{state.status === "loading" ? "Loading your leagues…" : "Loading current team rosters…"}</p>}
      {failed && (
        <Alert variant="error" title="League teams unavailable">
          {state.message ?? state.teamsMessage ?? "Could not load league teams."}
        </Alert>
      )}
      {state.status === "signed-out" && (
        <Alert variant="info" title="Signed out">
          <p>Your session has ended.</p>
          <ButtonLink href={`/login?next=${encodeURIComponent(loginNext)}`} variant="secondary" size="sm" className="mt-3">Log in again</ButtonLink>
        </Alert>
      )}
      {state.status === "ready" && !state.leagues.length && <p role={status} className="text-sm text-muted">No leagues.</p>}
    </>
  );
}

function LeagueSelector({ state, onLeagueChange, opponent = false }: {
  state: CalculatorRosterState;
  onLeagueChange: (id: string) => void;
  opponent?: boolean;
}) {
  const id = useId();
  const labels = state.leagues.map((entry) => `${teamNameLabel(entry.teamName)} — ${entry.name}`);
  return (
    <Field id={`${id}-league`} label={opponent ? "Opponent league" : "My team"}>
      <Select data-league-selector value={state.selectedLeagueId} disabled={state.status !== "ready" || !state.leagues.length} onChange={(event) => onLeagueChange(event.target.value)}>
        <option value="">{state.status === "loading" ? "Loading leagues…" : "—"}</option>
        {state.leagues.map((entry, index) => {
          const label = labels[index];
          const duplicate = labels.indexOf(label) !== labels.lastIndexOf(label);
          return <option key={entry.id} value={entry.id}>{label}{duplicate ? ` (league ${index + 1})` : ""}</option>;
        })}
      </Select>
    </Field>
  );
}

export function MyTeamPicker({ state, onLeagueChange, onRefresh, loginNext, heading = "My team", embedded = false }: SourcePickerProps & {
  onLeagueChange: (id: string) => void;
  /** The section heading; defaults to the calculator's. */
  heading?: string;
}) {
  const id = useId();
  const ready = state.status === "ready";
  const league = state.leagues.find((entry) => entry.id === state.selectedLeagueId);
  const fields = (
    <>
      {/* Embedded (Training): the League above the select, as the Opponent picker states it, so the two sides line up. */}
      {embedded && league && <dl className="grid gap-3 text-sm sm:grid-cols-2"><LeagueFact name={league.name} /></dl>}
      <LeagueSelector state={state} onLeagueChange={onLeagueChange} />
      {ready && !!state.leagues.length && !league && <p role={embedded ? undefined : "status"} className="text-sm text-muted">No team chosen.</p>}
    </>
  );
  if (embedded) return <div className="min-w-0 space-y-3">{fields}</div>;
  return (
    <section aria-labelledby={`${id}-heading`} className="space-y-4 rounded-xl border border-line bg-panel p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 id={`${id}-heading`} className="text-lg font-semibold text-text">{heading}</h2>
        <RefreshTeamsButton state={state} onRefresh={onRefresh} />
      </div>
      {fields}
      <SourceFeedback state={state} loginNext={loginNext} />
    </section>
  );
}

/** The selected league's name ("League"), as both of Training's team panels state it above their select. */
function LeagueFact({ name }: { name: string }) {
  return <div><dt className="text-muted">League</dt><dd className="wrap-anywhere font-medium text-text">{name}</dd></div>;
}

/**
 * The selected league (your membership in it), whether its teams are loaded, its other coaches by team name, and each one's
 * name as the Opponent select says it (with "(team 2)" when two teams share a name).
 */
function opponentChoices(state: CalculatorRosterState) {
  const league = state.leagues.find((entry) => entry.id === state.selectedLeagueId);
  const teamsReady = state.status === "ready" && !!league && state.teamsStatus === "ready" && state.data?.leagueId === league.id;
  const opponents = teamsReady ? [...(state.data?.members ?? [])].filter((member) => member.id !== league.memberId)
    .sort((a, b) => teamNameLabel(a.team_name).localeCompare(teamNameLabel(b.team_name), "en") || a.id.localeCompare(b.id, "en")) : [];
  const names = new Map(opponents.map((member, index) => {
    const name = teamNameLabel(member.team_name);
    const duplicate = opponents.filter((entry) => teamNameLabel(entry.team_name).toLowerCase() === name.toLowerCase()).length > 1;
    return [member.id, `${name}${duplicate ? ` (team ${index + 1})` : ""}`];
  }));
  return { league, teamsReady, opponents, names };
}

/** A group of one-press opponent picks (Training's "Next match", "Recent"; OpponentQuickPicks): coaches by member id. */
export type OpponentQuickGroup = {
  heading: string;
  /** `fact`: after the team's name ("Round 3"). A coach who is not one of the league's other loaded members is left out. */
  options: readonly { id: string; fact?: string }[];
};

const quickButton = "min-h-11 max-w-full rounded-lg border px-3 py-1.5 text-left text-sm font-semibold wrap-anywhere focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

/**
 * Groups of opponents one press selects, as the Opponent select does (it keeps every coach): each group's heading, then its
 * buttons. Training shows them in the Opponent panel's header row, beside its heading. Nothing when no group has a coach.
 */
export function OpponentQuickPicks({ state, quick, onOpponentChange }: {
  state: CalculatorRosterState;
  quick: readonly OpponentQuickGroup[];
  onOpponentChange: (id: string) => void;
}) {
  const id = useId();
  const { names } = opponentChoices(state);
  const groups = quick.map((group) => ({ heading: group.heading, options: group.options.filter((option) => names.has(option.id)) }))
    .filter((group) => group.options.length > 0);
  if (!groups.length) return null;
  return (
    <div data-opponent-quick className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
      {groups.map((group, groupIndex) => (
        <div key={group.heading} role="group" aria-labelledby={`${id}-quick-${groupIndex}`} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <p id={`${id}-quick-${groupIndex}`} className="text-xs font-medium text-muted">{group.heading}</p>
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {group.options.map((option) => {
              const selected = state.opponentId === option.id;
              return (
                <button key={option.id} type="button" data-opponent-quick-pick={option.id} aria-pressed={selected} onClick={() => onOpponentChange(option.id)}
                  className={`${quickButton} ${selected ? "border-accent-border bg-accent-soft text-accent-text" : "border-line bg-bg text-text hover:bg-panel-hover"}`}>
                  {`${names.get(option.id)}${option.fact ? ` · ${option.fact}` : ""}`}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export function OpponentPicker({ state, onOpponentChange, onRefresh, onLeagueChange, loginNext, embedded = false }: SourcePickerProps & {
  onOpponentChange: (id: string) => void;
  /** Its own league selector (your team is a paste): the opponents are that league's. */
  onLeagueChange?: (id: string) => void;
}) {
  const id = useId();
  const { league, teamsReady, opponents, names } = opponentChoices(state);
  const ready = state.status === "ready";
  // Embedded beside your own league team's picker, whose select already names your team: the League only.
  const ownTeamShown = !embedded || !!onLeagueChange;
  const fields = (
    <>
      {onLeagueChange && <LeagueSelector state={state} onLeagueChange={onLeagueChange} opponent />}
      {league && (
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {ownTeamShown && <div><dt className="text-muted">{onLeagueChange ? "Your league membership" : "Your team"}</dt><dd className="wrap-anywhere font-medium text-text">{teamNameLabel(league.teamName)}</dd></div>}
          <LeagueFact name={league.name} />
        </dl>
      )}
      <Field id={`${id}-opponent`} label="Opponent">
        <Select data-opponent-selector value={opponents.some((member) => member.id === state.opponentId) ? state.opponentId : ""} disabled={!teamsReady || !opponents.length} onChange={(event) => onOpponentChange(event.target.value)}>
          <option value="">—</option>
          {opponents.map((member) => <option key={member.id} value={member.id}>{names.get(member.id)}</option>)}
        </Select>
      </Field>
      {ready && !!state.leagues.length && !league && <p role={embedded ? undefined : "status"} className="text-sm text-muted">{onLeagueChange ? "No league chosen." : "No team chosen."}</p>}
      {teamsReady && !opponents.length && <p role="status" className="text-sm text-muted">There are no other members in this league yet.</p>}
    </>
  );
  if (embedded) return <div className="min-w-0 space-y-3">{fields}</div>;
  return (
    <section aria-labelledby={`${id}-heading`} className="space-y-4 rounded-xl border border-line bg-panel p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 id={`${id}-heading`} className="text-lg font-semibold text-text">Opponent</h2>
        <RefreshTeamsButton state={state} onRefresh={onRefresh} />
      </div>
      {fields}
      <SourceFeedback state={state} loginNext={loginNext} />
    </section>
  );
}

/** A 2v2 rail's slot buttons: one per slot for each choice. */
export type RosterSlot = {
  id: DoublesSlotId;
  /** The full name of the Pokémon in the slot, which a pick replaces ("Garchomp (yours, 1)"). */
  occupant: string;
  /**
   * The slot's card heading as it is seen ("Garchomp (1)": the name and its number, without the side word the rail's team
   * already gives), which names its buttons ("Replace Garchomp (1)").
   */
  card: string;
  activeSource: RosterSource | null;
  onSelect: (choice: RosterChoice) => void;
};

/** The Pokémon a pick replaces (a picker for one Pokémon), or the rail's slots (one button per slot for each choice). */
type RosterTarget =
  | {
    /** The full name of the Pokémon a pick replaces ("Charizard", "Garchomp (yours)"): every label names it. */
    occupant: string;
    slots?: undefined;
  }
  | {
    occupant?: undefined;
    /** 2v2 rail: each choice once, with one button per slot (activeSource and onSelect are then the slots'). */
    slots: readonly RosterSlot[];
  };

export function RosterPicker({ state, panel: providedPanel, role, side, activeSource, onSelect, pickerId, variant = "inline", runtime = championsRuntime, occupant, isDisabled, slots }: RosterTarget & {
  state?: CalculatorRosterState;
  panel?: RosterPanel;
  role: RosterRole;
  /** The data-calculator-roster value: a 1v1 side, or a 2v2 slot or side. */
  side: BattleSide | DoublesSlotId | DoublesSideId;
  activeSource: RosterSource | null;
  onSelect: (choice: RosterChoice) => void;
  pickerId?: string;
  variant?: "inline" | "rail";
  /** The matchup's game: types, sprites and unsupported notes come from its catalog. */
  runtime?: BattleRuntime;
  /** Why a choice cannot be picked here ("Active as Venusaur's ally."), or null. */
  isDisabled?: (choice: RosterChoice) => string | null;
}) {
  const id = useId();
  const panel: RosterPanel = providedPanel ?? (state ? getRosterPanel(state, role, runtime) : { status: "empty", teamName: null, message: "No team chosen.", choices: [] });
  const ownership = role === "own" ? "Your team" : "Opponent's team";
  const rail = variant === "rail";
  if (slots) return <SlotRosterPicker id={id} panel={panel} ownership={ownership} side={side} slots={slots} pickerId={pickerId} rail={rail} runtime={runtime} />;
  return (
    <div id={pickerId} data-calculator-roster={side} aria-labelledby={`${id}-heading`} aria-busy={panel.status === "loading" || undefined} className={`${rail ? "min-w-0" : "mt-4"} rounded-lg border border-line bg-bg p-3`}>
      <div data-roster-row="header" className={rail ? "flex min-w-0 flex-col items-start gap-1" : "flex flex-wrap items-baseline justify-between gap-2"}>
        <h3 id={`${id}-heading`} className={rail ? "wrap-anywhere text-sm font-semibold text-text" : "text-sm font-semibold text-text"}>{ownership}<span className="sr-only"> · {occupant}</span></h3>
        {panel.teamName && <span className={rail ? "max-w-full wrap-anywhere text-xs text-muted" : "wrap-anywhere text-xs text-muted"}>{panel.teamName}</span>}
      </div>
      {panel.message && <p data-roster-row="message" role={panel.status === "loading" ? "status" : undefined} className="mt-2 text-sm text-muted">{panel.message}</p>}
      {panel.status === "ready" && (
        <ul data-roster-row="list" aria-label={`${ownership} roster for ${occupant}`} className={rail ? "mt-3 grid grid-cols-1 gap-2" : "mt-3 grid gap-2 sm:grid-cols-2"}>
          {panel.choices.map((choice, index) => {
            const species = choice.speciesId ? runtime.speciesById.get(choice.speciesId) : null;
            const spriteName = rosterSpriteName(choice, species, runtime);
            const selected = !!choice.source && choice.source.key === activeSource?.key;
            const unavailable = choice.source ? isDisabled?.(choice) ?? null : null;
            const reason = [choiceReason(choice, species), unavailable].filter(Boolean).join(" ") || null;
            const content = (
              <>
                <span className="flex flex-wrap items-baseline justify-between gap-1">
                  <span className="wrap-anywhere font-medium">{choice.name}</span>
                  {selected && <span className={rail ? "shrink-0 rounded border border-accent-border px-1.5 py-0.5 text-xs font-semibold" : "text-xs font-semibold"}>Active</span>}
                </span>
                <ChoiceDetails choice={choice} species={species} />
              </>
            );
            return (
              <li key={choice.key} className="min-w-0">
                <button
                  type="button"
                  data-roster-choice={choice.key}
                  disabled={!choice.source || !!unavailable}
                  aria-pressed={selected}
                  aria-label={selected ? `${choice.name} from ${ownership.toLowerCase()}, active` : `Use ${choice.name} from ${ownership.toLowerCase()} in place of ${occupant}`}
                  aria-describedby={reason ? `${id}-reason-${index}` : undefined}
                  onClick={() => onSelect(choice)}
                  className={`${rail ? "flex items-start gap-3 " : ""}min-h-11 w-full rounded-lg border px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed ${selected ? "border-accent-border bg-accent-soft text-accent-text" : "border-line bg-panel text-text enabled:hover:bg-panel-hover disabled:text-muted"}`}
                >
                  {rail ? (
                    <>
                      {species && spriteName && <span aria-hidden="true" className="shrink-0"><PokemonSprite name={spriteName} size="md" /></span>}
                      <span className="min-w-0 flex-1">{content}</span>
                    </>
                  ) : content}
                </button>
                {reason && <p id={`${id}-reason-${index}`} className="mt-1 wrap-anywhere text-xs text-muted">{reason}</p>}
              </li>
            );
          })}
        </ul>
      )}
      {rail && <RailEnd />}
    </div>
  );
}

/**
 * The rows the two desktop rails share (calculator.module.css .withRosters): the heading with the team's name, a message,
 * one per choice of the longer roster (at least one) and the end.
 */
export function railRows(panels: readonly Pick<RosterPanel, "choices">[]) {
  return 3 + Math.max(1, ...panels.map((panel) => panel.choices.length));
}

/** A rail's last shared row: it holds the rail's bottom padding level on both sides. */
function RailEnd() {
  return <div aria-hidden="true" data-roster-row="end" />;
}

// League rosters store Pool Builder display names, which is what the sprite dex is keyed by.
// A pasted cosmetic form (Florges-White) has no sprite of its own there: use its family's.
// Minior's cores keep their own artwork (the plain Minior sprite is the Meteor Form's; Showdown's plain Minior is the Red Core).
function rosterSpriteName(choice: RosterChoice, species: ChampionsSpecies | null | undefined, runtime: BattleRuntime) {
  return choice.spriteName ?? (species ? (species.baseSpecies === "minior" ? (species.id === "minior" ? "Minior-Red" : undefined)
    : cosmeticFamily(runtime, species.id)?.name) ?? species.name : undefined);
}

function choiceReason(choice: RosterChoice, species: ChampionsSpecies | null | undefined) {
  return choice.reason ?? (species?.unsupported.length ? `Unsupported calculation: ${species.unsupported.join(" ")}` : null);
}

function ChoiceDetails({ choice, species }: { choice: RosterChoice; species: ChampionsSpecies | null | undefined }) {
  return (
    <>
      {!!species?.types.length && <span className="mt-1 flex flex-wrap gap-1">{species.types.map((type) => <TypeBadge key={type} type={type} />)}</span>}
      {!!species?.unsupported.length && !choice.reason && <span className="mt-1 block text-xs">Unsupported · inspect build</span>}
    </>
  );
}

/**
 * The 2v2 roster: each choice's name, types and sprite once, then a button for each of its side's two slots, named by the
 * card it replaces ("Replace Garchomp (1)"), or "Active" on the slot that holds it.
 */
function SlotRosterPicker({ id, panel, ownership, side, slots, pickerId, rail, runtime }: {
  id: string;
  panel: RosterPanel;
  ownership: string;
  side: BattleSide | DoublesSlotId | DoublesSideId;
  slots: readonly RosterSlot[];
  pickerId?: string;
  rail: boolean;
  runtime: BattleRuntime;
}) {
  return (
    <div id={pickerId} data-calculator-roster={side} aria-labelledby={`${id}-heading`} aria-busy={panel.status === "loading" || undefined} className={`${rail ? "min-w-0" : "mt-4"} rounded-lg border border-line bg-bg p-3`}>
      <div data-roster-row="header" className="flex min-w-0 flex-col items-start gap-1">
        <h3 id={`${id}-heading`} className="wrap-anywhere text-sm font-semibold text-text">{ownership}</h3>
        {panel.teamName && <span className="max-w-full wrap-anywhere text-xs text-muted">{panel.teamName}</span>}
      </div>
      {panel.message && <p data-roster-row="message" role={panel.status === "loading" ? "status" : undefined} className="mt-2 text-sm text-muted">{panel.message}</p>}
      {panel.status === "ready" && (
        <ul data-roster-row="list" aria-label={`${ownership} roster`} className={rail ? "mt-3 grid grid-cols-1 gap-2" : "mt-3 grid gap-2 sm:grid-cols-2"}>
          {panel.choices.map((choice, index) => {
            const species = choice.speciesId ? runtime.speciesById.get(choice.speciesId) : null;
            const spriteName = rosterSpriteName(choice, species, runtime);
            // A source active in one slot cannot also stand in the other (doubles-prep selectDoublesRoster).
            const activeIn = slots.find((slot) => !!choice.source && slot.activeSource?.key === choice.source.key);
            const reason = choiceReason(choice, species);
            return (
              <li key={choice.key} className={`min-w-0 rounded-lg border px-3 py-2 text-sm ${activeIn ? "border-accent-border bg-accent-soft" : "border-line bg-panel"}`}>
                <div className="flex min-w-0 items-start gap-3">
                  {species && spriteName && <span aria-hidden="true" className="shrink-0"><PokemonSprite name={spriteName} size="md" /></span>}
                  <div className="min-w-0 flex-1">
                    <span className="block wrap-anywhere font-medium text-text">{choice.name}</span>
                    <ChoiceDetails choice={choice} species={species} />
                  </div>
                </div>
                {/* One button per row: each names the card it replaces, which needs the rail's width. The group is named after its
                    buttons ("Garchomp from your team"), so it never shares a card's name ("Garchomp"). */}
                <div role="group" aria-label={`${choice.name} from ${ownership.toLowerCase()}`} className="mt-2 grid grid-cols-1 gap-1">
                  {slots.map((slot) => {
                    const selected = activeIn === slot;
                    const taken = !!activeIn && !selected;
                    return (
                      <button
                        key={slot.id}
                        type="button"
                        data-roster-choice={choice.key}
                        data-roster-slot={slot.id}
                        disabled={!choice.source || taken}
                        aria-pressed={selected}
                        aria-label={selected ? `Active: ${choice.name} from ${ownership.toLowerCase()}` : `Replace ${slot.card} with ${choice.name} from ${ownership.toLowerCase()}`}
                        aria-describedby={reason ? `${id}-reason-${index}` : undefined}
                        onClick={() => slot.onSelect(choice)}
                        className={`min-h-11 min-w-0 rounded-lg border px-2 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed ${selected ? "border-accent-border bg-accent text-on-accent" : "border-line bg-bg text-text enabled:hover:bg-panel-hover disabled:text-muted"}`}
                      ><span className="wrap-anywhere text-xs font-semibold">{selected ? "Active" : `Replace ${slot.card}`}</span></button>
                    );
                  })}
                </div>
                {reason && <p id={`${id}-reason-${index}`} className="mt-1 wrap-anywhere text-xs text-muted">{reason}</p>}
              </li>
            );
          })}
        </ul>
      )}
      {rail && <RailEnd />}
    </div>
  );
}
