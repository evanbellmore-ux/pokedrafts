"use client";

import { useId } from "react";
import { RefreshCw } from "lucide-react";
import TypeBadge from "@/app/components/TypeBadge";
import { Alert, Button, Field, Select } from "@/app/components/ui";
import { ButtonLink } from "@/app/components/ui/Button";
import { speciesById } from "@/app/lib/battle/catalog";
import { teamNameLabel } from "@/app/lib/league/labels";
import type { CalculatorRosterState } from "./roster-data";
import { getRosterPanel, type BattleSide, type RosterChoice, type RosterRole, type RosterSource } from "./roster-prep";

type Props = {
  state: CalculatorRosterState;
  onLeagueChange: (id: string) => void;
  onOpponentChange: (id: string) => void;
  onRefresh: () => void;
};

export default function LeagueMatchupPicker({ state, onLeagueChange, onOpponentChange, onRefresh }: Props) {
  const id = useId();
  const league = state.leagues.find((entry) => entry.id === state.selectedLeagueId);
  const ready = state.status === "ready";
  const teamsReady = ready && state.teamsStatus === "ready" && state.data?.leagueId === league?.id;
  const opponents = teamsReady ? [...(state.data?.members ?? [])].filter((member) => member.id !== league?.memberId)
    .sort((a, b) => teamNameLabel(a.team_name).localeCompare(teamNameLabel(b.team_name), "en") || a.id.localeCompare(b.id, "en")) : [];
  const loading = state.status === "loading" || state.teamsStatus === "loading";
  const failed = state.status === "error" || state.teamsStatus === "error";

  return (
    <section aria-labelledby={`${id}-heading`} className="space-y-4 rounded-xl border border-line bg-panel p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={`${id}-heading`} className="text-lg font-semibold text-text">Prepare a league matchup</h2>
          <p className="mt-1 text-sm text-muted">Load your team, choose an opponent, then click a roster Pokémon to make it active.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={onRefresh} disabled={loading}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />{failed ? "Retry teams" : "Refresh teams"}
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${id}-league`} label="League" help="Only leagues your signed-in account belongs to.">
          <Select value={state.selectedLeagueId} disabled={!ready || !state.leagues.length} onChange={(event) => onLeagueChange(event.target.value)}>
            <option value="">{state.status === "loading" ? "Loading leagues…" : "Choose a league"}</option>
            {state.leagues.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </Select>
        </Field>
        <Field id={`${id}-opponent`} label="Opponent" help="Choose another team in this league. No battle build is imported.">
          <Select value={opponents.some((member) => member.id === state.opponentId) ? state.opponentId : ""} disabled={!teamsReady || !opponents.length} onChange={(event) => onOpponentChange(event.target.value)}>
            <option value="">Choose an opponent</option>
            {opponents.map((member, index) => {
              const name = teamNameLabel(member.team_name);
              const duplicate = opponents.filter((entry) => teamNameLabel(entry.team_name).toLowerCase() === name.toLowerCase()).length > 1;
              return <option key={member.id} value={member.id}>{name}{duplicate ? ` (team ${index + 1})` : ""}</option>;
            })}
          </Select>
        </Field>
      </div>
      {loading && <p role="status" className="text-sm text-muted">{state.status === "loading" ? "Loading your leagues…" : "Loading current team rosters…"} You can still edit the calculator.</p>}
      {failed && (
        <Alert variant="error" title="League teams unavailable">
          {state.message ?? state.teamsMessage ?? "Could not load league teams."} Your manual calculator remains available; use Retry teams to try again.
        </Alert>
      )}
      {state.status === "signed-out" && (
        <Alert variant="info" title="Sign in to see your leagues">
          <p>Your session has ended. You can keep using manual Pokémon selection.</p>
          <ButtonLink href="/login?next=%2Fcalculator" variant="secondary" size="sm" className="mt-3">Log in again</ButtonLink>
        </Alert>
      )}
      {ready && !state.leagues.length && <p role="status" className="text-sm text-muted">No leagues yet. Join or create a league from your dashboard, or keep using the manual calculator.</p>}
      {teamsReady && !opponents.length && <p role="status" className="text-sm text-muted">There are no other members in this league yet.</p>}
      <p className="text-xs text-muted">Rosters provide Pokémon names, not saved sets. New selections use editable default builds; draft costs are not Stat Points. Build edits stay in this page session only and never change a league roster.</p>
    </section>
  );
}

export function RosterPicker({ state, role, side, activeSource, onSelect }: {
  state: CalculatorRosterState;
  role: RosterRole;
  side: BattleSide;
  activeSource: RosterSource | null;
  onSelect: (choice: RosterChoice) => void;
}) {
  const id = useId();
  const panel = getRosterPanel(state, role);
  const ownership = role === "own" ? "Your team" : "Opponent's team";
  return (
    <div aria-labelledby={`${id}-heading`} aria-busy={panel.status === "loading" || undefined} className="mt-4 rounded-lg border border-line bg-bg p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={`${id}-heading`} className="text-sm font-semibold text-text">{ownership} <span className="font-normal text-muted">· {side === "attacker" ? "Attacker" : "Defender"}</span></h3>
        {panel.teamName && <span className="wrap-anywhere text-xs text-muted">{panel.teamName}</span>}
      </div>
      {panel.message && <p role={panel.status === "loading" ? "status" : undefined} className="mt-2 text-sm text-muted">{panel.message}</p>}
      {panel.status === "ready" && (
        <ul aria-label={`${ownership} ${side} roster`} className="mt-3 grid gap-2 sm:grid-cols-2">
          {panel.choices.map((choice, index) => {
            const species = choice.speciesId ? speciesById.get(choice.speciesId) : null;
            const selected = !!choice.source && choice.source.key === activeSource?.key;
            const reason = choice.reason ?? (species?.unsupported.length ? `Unsupported calculation: ${species.unsupported.join(" ")}` : null);
            return (
              <li key={choice.key} className="min-w-0">
                <button
                  type="button"
                  disabled={!choice.source}
                  aria-pressed={selected}
                  aria-label={`Use ${choice.name} as ${side} from ${ownership.toLowerCase()}`}
                  aria-describedby={reason ? `${id}-reason-${index}` : undefined}
                  onClick={() => onSelect(choice)}
                  className={`min-h-11 w-full rounded-lg border px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed ${selected ? "border-accent-border bg-accent-soft text-accent-text" : "border-line bg-panel text-text enabled:hover:bg-panel-hover disabled:text-muted"}`}
                >
                  <span className="flex flex-wrap items-baseline justify-between gap-1">
                    <span className="wrap-anywhere font-medium">{choice.name}</span>
                    {selected && <span className="text-xs font-semibold">Active</span>}
                  </span>
                  {!!species?.types.length && <span className="mt-1 flex flex-wrap gap-1">{species.types.map((type) => <TypeBadge key={type} type={type} />)}</span>}
                  {!!species?.unsupported.length && !choice.reason && <span className="mt-1 block text-xs">Unsupported · inspect build</span>}
                </button>
                {reason && <p id={`${id}-reason-${index}`} className="mt-1 wrap-anywhere text-xs text-muted">{reason}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
