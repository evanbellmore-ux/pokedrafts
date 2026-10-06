"use client";

import { useId } from "react";
import { Alert, Button } from "@/app/components/ui";
import PokePasteImporter from "@/app/(app)/calculator/PokePasteImporter";
import { MyTeamPicker, OpponentPicker } from "@/app/(app)/calculator/LeagueMatchupPicker";
import type useCalculatorRosters from "@/app/(app)/calculator/useCalculatorRosters";
import type { PasteImport, TeamSourceOwner } from "@/app/(app)/calculator/roster-prep";
import type { DoublesSideId } from "@/app/lib/battle/doubles-types";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import { SHEET_FIELDS, type InfoView } from "../model/info";
import type { MemberEdit, MoveOptionsState, TeamProblems, TeamSourceDraft } from "../model/view-types";
import { takenItems } from "./set-editor";
import { rosterMessage, TEAM_SIZE, toggleChosen, type ResolvedTeam } from "./team-draft";
import { exportTeamText } from "./team-export";
import TeamMemberRow, { hiddenProblems } from "./TeamMemberRow";

export type TeamSourcePanelProps = {
  role: DoublesSideId;
  team: ResolvedTeam;
  source: TeamSourceDraft;
  /** Your side's source mode: the opponent's league picker lists leagues itself when your team is a paste. */
  ownMode: TeamSourceDraft["mode"];
  rosters: ReturnType<typeof useCalculatorRosters>;
  runtime: BattleRuntime;
  /** null: your own team (everything shown); the opponent's rows follow "You see". */
  visibility: InfoView | null;
  problems: TeamProblems | null;
  moveOptions: Readonly<Record<string, MoveOptionsState>>;
  onSource(update: (source: TeamSourceDraft) => TeamSourceDraft): void;
  onRetrySuggest(): void;
  onLoadMoves(speciesId: string): void;
};

/** Training's facts in the calculator's league and paste panels (their defaults name the calculator's own controls). */
export const TRAINING_PICKER_TEXT = {
  ownHeading: "League team",
  ownLeagueHint: "No team chosen.",
  ownTeamHint: "No team chosen.",
  pasteHeading: "PokéPaste",
  removeDescription: "This removes the team and its set edits from Setup.",
} as const;

const sourceButton ="min-h-11 rounded-lg border px-3 py-1.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

export default function TeamSourcePanel({ role, team, source, ownMode, rosters, runtime, visibility, problems, moveOptions, onSource, onRetrySuggest, onLoadMoves }: TeamSourcePanelProps) {
  const id = useId();
  const title = role === "own" ? "Your team" : "Opponent";
  const full = team.chosen.length >= TEAM_SIZE ? `${TEAM_SIZE} chosen` : null;
  const ready = team.members.filter((member) => !!member);
  const allOpen = !visibility || SHEET_FIELDS.every((field) => visibility.open[field]);
  const owner: TeamSourceOwner = { role, revision: 0, epoch: source.epoch };
  const setMode = (mode: TeamSourceDraft["mode"]) => onSource((current) => current.mode === mode ? current : { ...current, mode, epoch: current.epoch + 1, chosen: null });
  const apply = (from: TeamSourceOwner, input: PasteImport) => onSource((current) => from.epoch !== current.epoch ? current
    : { ...current, paste: { ...input, id: `${role}-${current.epoch + 1}` }, epoch: current.epoch + 1, chosen: null, edits: {} });
  const removePaste = (from: TeamSourceOwner) => onSource((current) => from.epoch !== current.epoch ? current
    : { ...current, paste: null, pasteDraft: null, epoch: current.epoch + 1, chosen: null, edits: {} });
  const editAsPaste = () => {
    const members = team.members.filter((member) => !!member);
    if (!members.length) return;
    const text = exportTeamText(members, runtime);
    onSource((current) => ({ ...current, mode: "paste", epoch: current.epoch + 1, pasteDraft: { text, url: "", title: team.label, format: "champions" } }));
  };
  const setEdit = (key: string, edit: MemberEdit) => onSource((current) => ({ ...current, edits: { ...current.edits, [key]: edit } }));
  const dropEdit = (key: string) => onSource((current) => {
    if (!current.edits[key]) return current;
    const edits = { ...current.edits };
    delete edits[key];
    return { ...current, edits };
  });

  return (
    <section data-training-team={role} aria-labelledby={`${id}-heading`} className="min-w-0 space-y-3 rounded-xl border border-line bg-panel p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${id}-heading`} className="text-lg font-semibold text-text">{title}</h2>
        <div role="group" aria-label={`${title} source`} className="flex flex-wrap gap-1.5">
          {(["league", "paste"] as const).map((mode) => (
            <button key={mode} type="button" aria-pressed={source.mode === mode} onClick={() => setMode(mode)}
              className={`${sourceButton} ${source.mode === mode ? "border-accent-border bg-accent-soft text-accent-text" : "border-line bg-bg text-text hover:bg-panel-hover"}`}>
              {mode === "league" ? "League team" : "PokéPaste"}
            </button>
          ))}
        </div>
      </div>

      {source.mode === "league" ? (
        role === "own"
          ? <MyTeamPicker state={rosters.state} onLeagueChange={rosters.selectLeague} onRefresh={rosters.refresh} loginNext="/training"
            heading={TRAINING_PICKER_TEXT.ownHeading} leagueHint={TRAINING_PICKER_TEXT.ownLeagueHint} />
          : <OpponentPicker state={rosters.state} onOpponentChange={rosters.selectOpponent} onRefresh={rosters.refresh} loginNext="/training"
            onLeagueChange={ownMode === "paste" ? rosters.selectLeague : undefined} ownTeamHint={TRAINING_PICKER_TEXT.ownTeamHint} />
      ) : (
        <PokePasteImporter role={role} owner={owner} applied={source.paste} runtime={runtime} onApply={apply} onRemove={removePaste}
          heading={TRAINING_PICKER_TEXT.pasteHeading} removeDescription={TRAINING_PICKER_TEXT.removeDescription}
          draft={source.pasteDraft ?? undefined} onDraftChange={(draft) => onSource((current) => ({ ...current, pasteDraft: draft }))} />
      )}

      {source.mode === "league" && rosters.state.status === "ready" && team.status !== "ready" && team.status !== "loading" && team.message && (
        <p role="status" className="wrap-anywhere text-sm text-muted">{rosterMessage(team.message)}</p>
      )}
      {team.status === "ready" && team.candidates.length > 0 && (
        <fieldset className="min-w-0">
          <legend className="text-sm font-semibold text-text">Choose {TEAM_SIZE} · {team.chosen.length} of {team.candidates.length} chosen</legend>
          {team.label && <p className="wrap-anywhere text-xs text-muted">{team.label}</p>}
          <ul className="mt-2 grid gap-2">
            {team.candidates.map((candidate) => {
              const index = team.chosen.indexOf(candidate.key);
              const member = index >= 0 ? team.members[index] : null;
              return (
                <TeamMemberRow
                  key={candidate.key}
                  candidate={candidate}
                  member={member}
                  chosen={index >= 0}
                  full={full}
                  runtime={runtime}
                  visibility={visibility}
                  problems={problems?.members[candidate.key] ?? []}
                  pending={team.suggestion === "ready" ? null : team.suggestion}
                  edited={!!source.edits[candidate.key]}
                  moveOptions={candidate.speciesId ? moveOptions[candidate.speciesId] : undefined}
                  takenItems={takenItems(team.members, candidate.key)}
                  onToggle={() => onSource((current) => ({ ...current, chosen: toggleChosen(team, candidate.key) }))}
                  onLoadMoves={onLoadMoves}
                  onEdit={(edit) => setEdit(candidate.key, edit)}
                  onReset={() => dropEdit(candidate.key)}
                />
              );
            })}
          </ul>
        </fieldset>
      )}

      {team.suggestion === "error" && (
        <Alert variant="error" title="Suggested sets unavailable" action={<Button variant="secondary" size="sm" className="min-h-11" onClick={onRetrySuggest}>Retry</Button>}>
          {team.suggestError}
        </Alert>
      )}
      {!!problems?.team.length && (allOpen
        ? <ul data-training-problems className="space-y-0.5 text-xs text-danger">{problems.team.map((problem, index) => <li key={index} className="wrap-anywhere">{problem}</li>)}</ul>
        : <p data-training-problems className="text-xs text-danger">{hiddenProblems(problems.team.length)}</p>)}
      {allOpen && ready.length > 0 && (
        <Button variant="secondary" size="sm" className="min-h-11" onClick={editAsPaste}>Edit as PokéPaste</Button>
      )}
    </section>
  );
}
