"use client";

import { Fragment, useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import PokemonSprite from "@/app/components/PokemonSprite";
import { Alert, Button } from "@/app/components/ui";
import PokePasteImporter from "@/app/(app)/calculator/PokePasteImporter";
import { MyTeamPicker, OpponentPicker, type OpponentQuickGroup } from "@/app/(app)/calculator/LeagueMatchupPicker";
import type useCalculatorRosters from "@/app/(app)/calculator/useCalculatorRosters";
import type { PasteImport, TeamSourceOwner } from "@/app/(app)/calculator/roster-prep";
import type { DoublesSideId } from "@/app/lib/battle/doubles-types";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import { SHEET_FIELDS, type InfoView } from "../model/info";
import type { MemberEdit, MoveOptionsState, TeamProblems, TeamSourceDraft } from "../model/view-types";
import { takenItems } from "./set-editor";
import { listNeedsRows, memberLabel, pendingSets, TEAM_SIZE, toggleChosen, withMode, type ResolvedTeam } from "./team-draft";
import { exportTeamText } from "./team-export";
import TeamMemberRow, { hiddenProblems, problemCount, problemsFact } from "./TeamMemberRow";
import styles from "./setup.module.css";

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
  /** The names both teams can choose: their labels carry the team ("Garchomp (yours)"). */
  shared: ReadonlySet<string>;
  /** Bumped by the Start bar's fact for this side: the Choose 6 list opens. */
  reveal: number;
  /** The opponent's league picker: its quick picks ("Next match", "Recent"; next-opponent.ts opponentQuickPicks). */
  quick?: readonly OpponentQuickGroup[];
  onSource(update: (source: TeamSourceDraft) => TeamSourceDraft): void;
  onRetrySuggest(): void;
  onLoadMoves(speciesId: string): void;
};

/** Training's facts in the calculator's paste panel (its default names the calculator's own session). */
export const TRAINING_PICKER_TEXT = {
  removeDescription: "This removes the team and its set edits from Setup.",
} as const;

/** One half of the League team | PokéPaste segmented control (as the calculator's 1v1 | 2v2 switch). */
const sourceButton =
  "min-h-11 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

export default function TeamSourcePanel({ role, team, source, ownMode, rosters, runtime, visibility, problems, moveOptions, shared, reveal, quick, onSource, onRetrySuggest, onLoadMoves }: TeamSourcePanelProps) {
  const id = useId();
  const panel = useRef<HTMLElement>(null);
  /** Edit as PokéPaste and Import team unmount the pressed control: once the source's epoch moves past this one, the keyboard
   * focus goes to the importer's Team text ("paste") or to Choose 6 ("choose"). */
  const focusAfter = useRef<{ epoch: number; target: "paste" | "choose" } | null>(null);
  const title = role === "own" ? "Your team" : "Opponent";
  const full = team.chosen.length >= TEAM_SIZE ? `${TEAM_SIZE} chosen` : null;
  const ready = team.members.filter((member) => !!member);
  const allOpen = !visibility || SHEET_FIELDS.every((field) => visibility.open[field]);
  const owner: TeamSourceOwner = { role, revision: 0, epoch: source.epoch };
  const count = problems ? problemCount(problems) : 0;
  // Below 64rem the Choose 6 list folds to a line of the six names. Whether it starts folded is decided for each list (on
  // mount, a source change, another roster); after that it only opens by itself (never folds under the keyboard focus),
  // and a press of its toggle wins until the next list. While the rosters reload (Refresh teams) the side has no members:
  // the list keeps its state, and the same roster coming back is not a new list.
  const needsRows = listNeedsRows(team, count);
  const listKey = `${source.epoch} ${team.candidates.map((candidate) => candidate.key).join(" ")}`;
  const [list, setList] = useState({ key: listKey, open: needsRows, touched: false, reveal });
  if (team.candidates.length) {
    if (list.key !== listKey) setList({ key: listKey, open: needsRows, touched: false, reveal });
    else if (list.reveal !== reveal) setList({ ...list, open: true, reveal });
    else if (needsRows && !list.open && !list.touched) setList({ ...list, open: true });
  }
  const fold = list.open ? null : "max-lg:hidden";
  const setMode = (mode: TeamSourceDraft["mode"]) => onSource((current) => withMode(current, mode));
  const apply = (from: TeamSourceOwner, input: PasteImport) => {
    focusAfter.current = { epoch: from.epoch, target: "choose" };
    onSource((current) => from.epoch !== current.epoch ? current
      : { ...current, paste: { ...input, id: `${role}-${current.epoch + 1}` }, epoch: current.epoch + 1, chosen: null, edits: {} });
  };
  const removePaste = (from: TeamSourceOwner) => onSource((current) => from.epoch !== current.epoch ? current
    : { ...current, paste: null, pasteDraft: null, epoch: current.epoch + 1, chosen: null, edits: {} });
  const editAsPaste = () => {
    const members = team.members.filter((member) => !!member);
    if (!members.length) return;
    const text = exportTeamText(members, runtime);
    focusAfter.current = { epoch: source.epoch, target: "paste" };
    onSource((current) => ({ ...withMode(current, "paste"), epoch: current.epoch + 1, pasteDraft: { text, url: "", title: team.label, format: "champions" } }));
  };
  const setEdit = (key: string, edit: MemberEdit) => onSource((current) => ({ ...current, edits: { ...current.edits, [key]: edit } }));
  const dropEdit = (key: string) => onSource((current) => {
    if (!current.edits[key]) return current;
    const edits = { ...current.edits };
    delete edits[key];
    return { ...current, edits };
  });
  useEffect(() => {
    const pending = focusAfter.current;
    if (!pending || source.epoch <= pending.epoch) return;
    focusAfter.current = null;
    const target = pending.target === "paste"
      ? panel.current?.querySelector("[data-paste-importer]")?.querySelector("textarea")
      : panel.current?.querySelector<HTMLElement>("[data-training-choose]");
    target?.focus();
  }, [source.epoch]);
  const chooseFact = `Choose ${TEAM_SIZE} · ${team.chosen.length} of ${team.candidates.length} chosen`;
  const chosen = team.candidates.filter((candidate) => team.chosen.includes(candidate.key));

  return (
    <section ref={panel} data-training-team={role} aria-labelledby={`${id}-heading`} className="min-w-0 space-y-3 rounded-xl border border-line bg-panel p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Takes the keyboard focus from the Start bar's fact and after Change teams. */}
        <h2 id={`${id}-heading`} tabIndex={-1} data-training-team-heading={role}
          className={`${styles.sideHeading} rounded text-lg font-semibold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus`}>{title}</h2>
        {/* Below 40rem two equal buttons across the panel (as the calculator's 1v1 | 2v2 switch). */}
        <div role="group" aria-label={`${title} source`} className="grid w-full grid-cols-2 gap-1 rounded-lg border border-line bg-bg/40 p-1 sm:flex sm:w-auto">
          {(["league", "paste"] as const).map((mode) => (
            <button key={mode} type="button" aria-pressed={source.mode === mode} onClick={() => setMode(mode)}
              className={`${sourceButton} ${source.mode === mode ? "bg-panel-hover text-text shadow-sm" : "text-muted hover:text-text"}`}>
              {mode === "league" ? "League team" : "PokéPaste"}
            </button>
          ))}
        </div>
      </div>

      {/* The shared pickers without their own card, heading or roster status: the setup states those once for both teams. */}
      {source.mode === "league" ? (
        role === "own"
          ? <MyTeamPicker embedded state={rosters.state} onLeagueChange={rosters.selectLeague} onRefresh={rosters.refresh} loginNext="/training" />
          : <OpponentPicker embedded state={rosters.state} onOpponentChange={rosters.selectOpponent} onRefresh={rosters.refresh} loginNext="/training"
            onLeagueChange={ownMode === "paste" ? rosters.selectLeague : undefined} quick={quick} />
      ) : (
        <PokePasteImporter embedded role={role} owner={owner} applied={source.paste} runtime={runtime} onApply={apply} onRemove={removePaste}
          removeDescription={TRAINING_PICKER_TEXT.removeDescription}
          draft={source.pasteDraft ?? undefined} onDraftChange={(draft) => onSource((current) => ({ ...current, pasteDraft: draft }))} />
      )}

      {/* Without a chosen league, or with its teams unavailable, the picker ("No team chosen.") or the setup's roster status
          ("No leagues.", "League teams unavailable") already states it. Not a live region: the status beside Start says it. */}
      {source.mode === "league" && rosters.state.status === "ready" && rosters.state.teamsStatus !== "error"
        && rosters.state.leagues.some((league) => league.id === rosters.state.selectedLeagueId)
        && team.status !== "ready" && team.status !== "loading" && team.message && (
        <p className="wrap-anywhere text-sm text-muted">{team.message}</p>
      )}
      {team.status === "ready" && team.candidates.length > 0 && (
        <fieldset aria-labelledby={`${id}-heading ${id}-choose`} className="min-w-0">
          {/* Named "Your team Choose 6 · 6 of 10 chosen". From 64rem the fact; below, the same fact as the list's toggle. */}
          <legend tabIndex={-1} data-training-choose
            className="w-full rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
            <span id={`${id}-choose`} className="block text-sm font-semibold text-text max-lg:hidden">{chooseFact}</span>
            <h3 className="text-sm font-semibold text-text lg:hidden">
              <button type="button" data-training-choose-toggle={role} aria-expanded={list.open} aria-controls={`${id}-list`}
                onClick={() => setList({ ...list, open: !list.open, touched: true })}
                className="flex min-h-11 w-full items-center gap-2 rounded-lg text-left hover:bg-panel-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
                <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-muted motion-safe:transition-transform ${list.open ? "rotate-180" : ""}`} />
                <span className="min-w-0 wrap-anywhere">{chooseFact}<span className="sr-only"> · {title}</span></span>
              </button>
            </h3>
          </legend>
          {team.label && <p className="wrap-anywhere text-xs text-muted">{team.label}</p>}
          {/* Folded (below 64rem only): the six by name, and the side's Showdown count as its rows would state it. */}
          {!list.open && (
            <div data-training-chosen={role} className="mt-1 space-y-1 lg:hidden">
              <div className="text-sm leading-8 text-text">
                {chosen.map((candidate, index) => {
                  const species = candidate.speciesId ? runtime.speciesById.get(candidate.speciesId) : null;
                  return (
                    <Fragment key={candidate.key}>
                      {index > 0 && " · "}
                      <span className="inline-flex max-w-full items-center gap-1 align-middle">
                        {species && <span aria-hidden="true" className="shrink-0"><PokemonSprite name={candidate.spriteName ?? species.name} size="sm" /></span>}
                        <span className="min-w-0 wrap-anywhere">{candidate.name}</span>
                      </span>
                    </Fragment>
                  );
                })}
              </div>
              {count > 0 && <p className="text-xs text-danger">{allOpen ? problemsFact(count) : hiddenProblems(count)}</p>}
            </div>
          )}
          <ul id={`${id}-list`} aria-busy={pendingSets(team) === "loading" || undefined} className={fold ? `mt-2 grid gap-2 ${fold}` : "mt-2 grid gap-2"}>
            {team.candidates.map((candidate) => {
              const index = team.chosen.indexOf(candidate.key);
              const member = index >= 0 ? team.members[index] : null;
              return (
                <TeamMemberRow
                  key={candidate.key}
                  candidate={candidate}
                  label={memberLabel(candidate.name, role, shared)}
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
      {/* At the end of the list: folded with it below 64rem. */}
      {allOpen && ready.length > 0 && (
        <div className={fold ?? undefined}>
          <Button variant="secondary" size="sm" className="min-h-11" onClick={editAsPaste}>Edit as PokéPaste</Button>
        </div>
      )}
    </section>
  );
}
