import { getRosterPanel, type RosterChoice, type RosterPanel } from "@/app/(app)/calculator/roster-prep";
import type { CalculatorRosterState } from "@/app/(app)/calculator/roster-data";
import type { DoublesSideId } from "@/app/lib/battle/doubles-types";
import { megaEntries } from "@/app/lib/battle/mega-forms";
import { createBuild, defaultAbilityActive } from "@/app/lib/battle/model";
import { usualAbility, type MoveSlot, type MoveSlots } from "@/app/lib/battle/move-defaults";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild } from "@/app/lib/battle/types";
import { DEFAULT_INFO, type InfoSettings } from "../model/info";
import { showdownNature } from "../model/sets";
import type { SuggestedSet, SuggestMember } from "../model/usage";
import { pointsIssues } from "./set-editor";
import type { MemberEdit, SetupDraft, SuggestionState, TeamSourceDraft, TrainingMember, TrainingSetup, TrainingTeam } from "../model/view-types";

// Setup's teams: league rosters (sets suggested by the worker from the training usage data, addendum A1.2) or a PokéPaste,
// "Choose 6", set editor results (A1.3), and the local blockers (count, Species Clause, Item Clause = 1; pinned
// data/mods/champions/rulesets.ts:28-32). Showdown's validator in the worker is authoritative.

export const TEAM_SIZE = 6;

export type Candidate = {
  /** TrainingMember.key: RosterSource.key (league) or the paste choice key; the roster choice key when ineligible. */
  key: string;
  name: string;
  speciesId: string | null;
  spriteName?: string;
  eligible: boolean;
  reason: string | null;
  /** League members: what the worker suggests a set for. */
  suggest: SuggestMember | null;
  /** Paste members: the imported set. */
  imported: { build: BattleBuild; moves: MoveSlots } | null;
};

export type ResolvedTeam = {
  role: DoublesSideId;
  mode: TeamSourceDraft["mode"];
  label: string;
  status: RosterPanel["status"];
  message: string | null;
  candidates: Candidate[];
  /** Chosen keys in candidate order. */
  chosen: string[];
  /** One per chosen key: its set, or null while its suggested set is loading or unavailable. */
  members: (TrainingMember | null)[];
  /** League mode: the chosen members the worker suggests sets for, in team order (Item Clause takes items in that order). */
  suggestMembers: SuggestMember[];
  suggestKey: string | null;
  suggestion: "ready" | "loading" | "error" | null;
  suggestError: string | null;
  blockers: string[];
  team: TrainingTeam | null;
};

export type ResolvedSetup = { own: ResolvedTeam; opponent: ResolvedTeam; setup: TrainingSetup | null; key: string | null };

export function emptySource(): TeamSourceDraft {
  return { mode: "league", paste: null, pasteDraft: null, epoch: 0, chosen: null, edits: {} };
}

/** Both teams from league rosters, Plays safe, the read shown, and the information settings (default: open team sheets). */
export function createSetupDraft(info: InfoSettings = DEFAULT_INFO): SetupDraft {
  return { own: emptySource(), opponent: emptySource(), difficulty: "safe", showRead: true, info };
}

export function pasteKey(runtime: BattleRuntime, role: DoublesSideId, pasteId: string, index: number) {
  return JSON.stringify(["paste", runtime.identity, role, pasteId, index]);
}

function speciesName(runtime: BattleRuntime, speciesId: string | null, fallback: string) {
  return (speciesId && runtime.speciesById.get(speciesId)?.name) || fallback;
}

/**
 * A Mega form battles as its base species holding its stone (the worker sends it so: sim/showdown-set.ts sentAs; the stone
 * decides, PS/data/mods/champions/scripts.ts:183-195), so Setup, the preview and the log name the base form, and its
 * abilities are the base's until it Mega Evolves.
 */
export function megaBase(speciesId: string | null, runtime: BattleRuntime): { speciesId: string; stone: string } | null {
  if (!speciesId) return null;
  const mega = megaEntries(speciesId, runtime).find((entry) => entry.formId === speciesId);
  return mega ? { speciesId: mega.baseSpeciesId, stone: mega.itemId } : null;
}
/** A build of a Mega form as its base species holding the stone, with a base ability (its own when the base has it). */
export function asBaseForm(build: BattleBuild, runtime: BattleRuntime): BattleBuild {
  const mega = megaBase(build.speciesId, runtime);
  if (!mega) return build;
  const abilities = runtime.speciesById.get(mega.speciesId)?.abilities ?? [];
  const abilityId = abilities.includes(build.abilityId) ? build.abilityId : usualAbility(mega.speciesId, "Doubles", runtime) ?? abilities[0] ?? build.abilityId;
  return { ...build, speciesId: mega.speciesId, itemId: mega.stone, abilityId, abilityActive: defaultAbilityActive(abilityId) };
}

function leagueCandidate(choice: RosterChoice, runtime: BattleRuntime): Candidate {
  const source = choice.source;
  const eligible = !!source && source.kind === "league" && runtime.speciesById.has(source.speciesId);
  const mega = eligible && source?.kind === "league" ? megaBase(source.speciesId, runtime) : null;
  const speciesId = mega?.speciesId ?? choice.speciesId;
  return {
    key: source?.key ?? choice.key,
    name: speciesName(runtime, speciesId, choice.name),
    speciesId,
    // The roster's sprite is the Mega form's: the base form's sprite instead (from speciesId).
    ...(choice.spriteName && !mega ? { spriteName: choice.spriteName } : {}),
    eligible,
    reason: eligible ? null : choice.reason ?? "This roster name does not resolve to one Champions Pokémon.",
    suggest: eligible && source?.kind === "league"
      ? { key: source.key, speciesId: mega?.speciesId ?? source.speciesId, abilityId: source.abilityId ?? null, ...(mega ? { itemId: mega.stone } : {}) }
      : null,
    imported: null,
  };
}

/** The roster or paste members a side can choose from, with the panel's status. */
export function teamCandidates(source: TeamSourceDraft, rosters: CalculatorRosterState, role: DoublesSideId, runtime: BattleRuntime) {
  if (source.mode === "league") {
    const panel = getRosterPanel(rosters, role, runtime);
    return { label: panel.teamName ?? (role === "own" ? "Your team" : "Opponent"), status: panel.status, message: panel.message, candidates: panel.choices.map((choice) => leagueCandidate(choice, runtime)) };
  }
  const paste = source.paste;
  if (!paste) return { label: role === "own" ? "Your team" : "Opponent", status: "empty" as const, message: null, candidates: [] };
  return {
    label: paste.title, status: "ready" as const, message: null,
    candidates: paste.team.members.map((member): Candidate => {
      const eligible = member.selectable && !!member.build && !!member.speciesId;
      const speciesId = megaBase(member.speciesId, runtime)?.speciesId ?? member.speciesId;
      return {
        key: pasteKey(runtime, role, paste.id, member.index),
        name: speciesName(runtime, speciesId, member.name),
        speciesId,
        eligible,
        reason: eligible ? null : member.diagnostics.filter((entry) => entry.severity !== "info").map((entry) => entry.message).join(" ") || "This set cannot be used.",
        suggest: null,
        imported: eligible && member.build ? { build: asBaseForm(member.build, runtime), moves: member.moves } : null,
      };
    }),
  };
}

function moveSlots(moves: readonly string[], origin: MoveSlot["origin"]): MoveSlots {
  const slots = [0, 1, 2, 3].map((index): MoveSlot => moves[index]
    ? { moveId: moves[index], origin, gameType: "Doubles" }
    : { moveId: null, origin: "empty", gameType: null });
  return slots as MoveSlots;
}

/** A suggested set as the member the battle uses (Champions build: nature, item, ability, Stat Points; SPEC C15 Hardy). */
export function memberFromSuggestion(set: SuggestedSet, candidate: Pick<Candidate, "key" | "name" | "spriteName">, runtime: BattleRuntime): TrainingMember {
  const base = createBuild(set.speciesId, runtime);
  const build: BattleBuild = base.game === "champions"
    ? { ...base, nature: set.nature, itemId: set.itemId, abilityId: set.abilityId, abilityActive: defaultAbilityActive(set.abilityId), points: { ...set.points } }
    : { ...base, nature: set.nature, itemId: set.itemId, abilityId: set.abilityId, abilityActive: defaultAbilityActive(set.abilityId) };
  return {
    key: candidate.key, name: candidate.name, speciesId: set.speciesId,
    build: showdownNature(build), moves: moveSlots(set.moves, "suggested"),
    origin: "suggested", suggestion: { source: set.source, protectAdded: set.protectAdded },
    ...(candidate.spriteName ? { spriteName: candidate.spriteName } : {}),
  };
}

function memberFromEdit(edit: MemberEdit, candidate: Candidate): TrainingMember {
  return {
    key: candidate.key, name: candidate.name, speciesId: edit.build.speciesId,
    build: showdownNature(structuredClone(edit.build)), moves: structuredClone(edit.moves), origin: "edited",
    ...(candidate.spriteName ? { spriteName: candidate.spriteName } : {}),
  };
}

function memberFromPaste(candidate: Candidate): TrainingMember | null {
  if (!candidate.imported) return null;
  return {
    key: candidate.key, name: candidate.name, speciesId: candidate.imported.build.speciesId,
    build: showdownNature(structuredClone(candidate.imported.build)), moves: structuredClone(candidate.imported.moves), origin: "imported",
    ...(candidate.spriteName ? { spriteName: candidate.spriteName } : {}),
  };
}

/** Facts for what stops a team before Showdown's validator: "Choose 6 (5 chosen).", Species Clause, Item Clause = 1. */
export function teamBlockers(members: readonly TrainingMember[], chosen: number, runtime: BattleRuntime): string[] {
  const blockers: string[] = [];
  if (chosen !== TEAM_SIZE) blockers.push(`Choose ${TEAM_SIZE} (${chosen} chosen).`);
  const bySpecies = new Map<string, number>();
  for (const member of members) {
    const species = runtime.speciesById.get(member.speciesId);
    const base = species?.baseSpecies ?? member.speciesId;
    bySpecies.set(base, (bySpecies.get(base) ?? 0) + 1);
  }
  for (const [base, count] of bySpecies) {
    if (count > 1) blockers.push(`Species Clause: ${runtime.speciesById.get(base)?.name ?? base} ${count === 2 ? "twice" : `${count} times`}.`);
  }
  for (const member of members) {
    if (member.build.game === "champions") for (const issue of pointsIssues(member.build.points)) blockers.push(`${member.name}: ${issue}`);
  }
  const byItem = new Map<string, string[]>();
  for (const member of members) {
    if (!member.build.itemId) continue;
    byItem.set(member.build.itemId, [...(byItem.get(member.build.itemId) ?? []), member.name]);
  }
  for (const [itemId, names] of byItem) {
    if (names.length > 1) blockers.push(`Item Clause: ${runtime.itemsById.get(itemId)?.name ?? itemId} on ${names.length === 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`}.`);
  }
  return blockers;
}

export function resolveTeam(source: TeamSourceDraft, rosters: CalculatorRosterState, role: DoublesSideId, suggestions: SuggestionState, runtime: BattleRuntime): ResolvedTeam {
  const { label, status, message, candidates } = teamCandidates(source, rosters, role, runtime);
  const eligible = candidates.filter((candidate) => candidate.eligible);
  const fallback = eligible.slice(0, TEAM_SIZE).map((candidate) => candidate.key);
  // A choice made on another roster (another opponent or league) names none of these members: start from the first six.
  const stale = !!source.chosen?.length && !source.chosen.some((key) => eligible.some((candidate) => candidate.key === key));
  const chosenSet = new Set(source.chosen && !stale ? source.chosen : fallback);
  const chosenCandidates = eligible.filter((candidate) => chosenSet.has(candidate.key));
  const chosen = chosenCandidates.map((candidate) => candidate.key);
  const suggestMembers = source.mode === "league" ? chosenCandidates.flatMap((candidate) => candidate.suggest ? [candidate.suggest] : []) : [];
  const suggestKey = suggestMembers.length ? JSON.stringify(suggestMembers.map((member) => [member.key, member.speciesId, member.abilityId, member.itemId ?? null])) : null;
  const current = suggestKey !== null && suggestions.status !== "idle" && suggestions.key === suggestKey ? suggestions : null;
  const suggestion = suggestKey === null ? null : current?.status === "ready" ? "ready" : current?.status === "error" ? "error" : "loading";
  const members = chosenCandidates.map((candidate) => {
    const edit = source.edits[candidate.key];
    if (edit && edit.build.speciesId === candidate.speciesId) return memberFromEdit(edit, candidate);
    if (source.mode === "paste") return memberFromPaste(candidate);
    const set = current?.status === "ready" ? current.sets[candidate.key] : undefined;
    return set ? memberFromSuggestion(set, candidate, runtime) : null;
  });
  const ready = members.filter((member): member is TrainingMember => !!member);
  const blockers = teamBlockers(ready, chosen.length, runtime);
  const team = chosen.length === TEAM_SIZE && ready.length === TEAM_SIZE ? { label, members: ready } : null;
  return {
    role, mode: source.mode, label, status, message, candidates, chosen, members, suggestMembers, suggestKey, suggestion,
    suggestError: current?.status === "error" ? current.message : null, blockers, team,
  };
}

/** The validation cache key: both teams' members, sets and order. */
export function setupKey(own: TrainingTeam, opponent: TrainingTeam) {
  const part = (team: TrainingTeam) => team.members.map((member) => [member.key, member.speciesId, member.build, member.moves.map((slot) => slot.moveId)]);
  return JSON.stringify([part(own), part(opponent)]);
}

export function resolveSetup(draft: SetupDraft, rosters: CalculatorRosterState, suggestions: Record<DoublesSideId, SuggestionState>, runtime: BattleRuntime): ResolvedSetup {
  const own = resolveTeam(draft.own, rosters, "own", suggestions.own, runtime);
  const opponent = resolveTeam(draft.opponent, rosters, "opponent", suggestions.opponent, runtime);
  const setup = own.team && opponent.team && !own.blockers.length && !opponent.blockers.length
    ? { own: own.team, opponent: opponent.team, difficulty: draft.difficulty, showRead: draft.showRead, info: draft.info }
    : null;
  return { own, opponent, setup, key: setup ? setupKey(setup.own, setup.opponent) : null };
}

/** Choose 6: adds or removes a key (at most six), kept in candidate order. */
export function toggleChosen(team: Pick<ResolvedTeam, "candidates" | "chosen">, key: string): string[] {
  const next = new Set(team.chosen);
  if (next.has(key)) next.delete(key);
  else if (next.size < TEAM_SIZE && team.candidates.some((candidate) => candidate.key === key && candidate.eligible)) next.add(key);
  return team.candidates.filter((candidate) => next.has(candidate.key)).map((candidate) => candidate.key);
}
