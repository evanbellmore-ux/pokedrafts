import { speciesById } from "@/app/lib/battle/catalog";
import { resolveRosterSpecies } from "@/app/lib/battle/species-identity";
import type { ImportedTeam } from "@/app/lib/battle/team-import";
export { createSpeciesResolver, resolveRosterSpecies, type SpeciesResolution } from "@/app/lib/battle/species-identity";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import { createMoveSlots, type MoveSlots } from "@/app/lib/battle/move-defaults";
import { getMegaOptions } from "@/app/lib/battle/mega-forms";
import type { BattleBuild, BattleConditions, MoveContext } from "@/app/lib/battle/types";
import { teamNameLabel } from "@/app/lib/league/labels";
import { pokemonKey, type TeamRoster } from "../leagues/[leagueId]/team/roster";
import type { CalculatorRosterState } from "./roster-data";
import { formatHPInput, parseBuildInput } from "./build-input";

export type BattleSide = "attacker" | "defender";
export type RosterRole = "own" | "opponent";
export type TeamSourceMode = "league" | "paste";
export type TeamSourceOwner = { role: RosterRole; revision: number; epoch: number };
export type PasteImport = { text: string; title: string; url: string | null; team: ImportedTeam };
export type AppliedPaste = PasteImport & { id: string };
export type TeamSelection = { mode: TeamSourceMode; paste: AppliedPaste | null; epoch: number };

type SourceIdentity = { key: string; name: string; speciesId: string };
export type RosterSource = SourceIdentity & (
  | { kind: "league"; leagueId: string; memberId: string; rosterId: string }
  | { kind: "paste"; role: RosterRole; importId: string; index: number }
);

export type RosterChoice = {
  key: string;
  name: string;
  speciesId: string | null;
  source: RosterSource | null;
  reason: string | null;
  owner?: TeamSourceOwner;
};

export function rosterChoices(leagueId: string, team: TeamRoster): RosterChoice[] {
  const counts = new Map<string, number>();
  for (const pokemon of team.pokemon) {
    const key = pokemonKey(pokemon.name);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return team.pokemon.map((pokemon, index) => {
    const resolved = resolveRosterSpecies(pokemon.name);
    const speciesId = resolved.status === "resolved" ? resolved.speciesId : null;
    const duplicate = counts.get(pokemonKey(pokemon.name)) !== 1;
    const identity = [leagueId, team.member_id, team.id, pokemonKey(pokemon.name), pokemon.pick_number, pokemon.acquired ?? null, speciesId];
    const key = JSON.stringify(identity);
    return {
      // Duplicates are display-only; an index must never become a saved build identity.
      key: duplicate ? JSON.stringify([...identity, index]) : key,
      name: pokemon.name,
      speciesId,
      source: !duplicate && speciesId ? { kind: "league", key, leagueId, memberId: team.member_id, rosterId: team.id, name: pokemon.name, speciesId } : null,
      reason: duplicate ? "Duplicate roster name. Choose the Pokémon manually." : resolved.status === "resolved" ? null : resolved.reason,
    };
  });
}

export type RosterPanel = {
  status: "loading" | "empty" | "ready" | "error";
  teamName: string | null;
  message: string | null;
  choices: RosterChoice[];
};

export function getRosterPanel(state: CalculatorRosterState, role: RosterRole): RosterPanel {
  const empty = (message: string, status: RosterPanel["status"] = "empty", teamName: string | null = null): RosterPanel => ({ status, teamName, message, choices: [] });
  if (state.status === "loading") return empty("Loading your leagues…", "loading");
  if (state.status !== "ready") return empty("League rosters are unavailable. Manual Pokémon selection still works.", "error");
  const league = state.leagues.find((entry) => entry.id === state.selectedLeagueId);
  if (!league) return empty(state.leagues.length ? "Choose your team in My team to see its league rosters." : "Join a league to use roster shortcuts, or select Pokémon manually.");
  if (role === "opponent" && !state.opponentId) return empty("Choose a team in Opponent to see their roster.");
  if (state.teamsStatus === "loading") return empty("Loading current team rosters…", "loading");
  if (state.teamsStatus === "error") return empty("Could not load this league's teams. Use Retry teams or select Pokémon manually.", "error");
  if (!state.data || state.data.leagueId !== league.id || state.teamsStatus !== "ready") return empty("Current team rosters are not loaded.");
  const memberId = role === "own" ? league.memberId : state.opponentId;
  const member = state.data.members.find((entry) => entry.id === memberId);
  if (!member) return empty("This team is no longer available. Refresh teams or choose another opponent.");
  const name = teamNameLabel(member.team_name);
  if (!league.draftCompleted) return empty("This league's draft is not complete. Current rosters appear after it finishes.", "empty", name);
  const teams = state.data.teams.filter((team) => team.member_id === memberId);
  if (!teams.length) return empty("No finalized roster is available for this team yet.", "empty", name);
  if (teams.length !== 1) return empty("Multiple rosters were returned for this team. Use manual selection rather than guessing.", "error", name);
  if (!teams[0].pokemon.length) return empty("This team's current roster is empty.", "empty", name);
  return { status: "ready", teamName: name, message: null, choices: rosterChoices(league.id, teams[0]) };
}

/** Every picker uses this same role-aware view, including its stale-action token. */
export function getTeamPanel(current: PreparedMatchup, state: CalculatorRosterState, role: RosterRole): RosterPanel {
  const owner = getTeamSourceOwner(current, role);
  const selection = current.teams[role];
  if (selection.mode === "league") {
    const panel = getRosterPanel(state, role);
    return { ...panel, choices: panel.choices.map((choice) => ({ ...choice, owner })) };
  }
  const paste = selection.paste;
  if (!paste) return { status: "empty", teamName: null, message: "Import a PokéPaste link or team text in the team source panel, or choose Pokémon manually.", choices: [] };
  return {
    status: "ready", teamName: paste.title, message: "Imported sets · click a Pokémon to load its build and moves.",
    choices: paste.team.members.map((member) => {
      const key = JSON.stringify(["paste", role, paste.id, member.index]);
      return {
        key, name: member.name, speciesId: member.speciesId, owner,
        source: member.selectable && member.build && member.speciesId ? {
          kind: "paste", key, role, importId: paste.id, index: member.index, name: member.name, speciesId: member.speciesId,
        } : null,
        reason: member.diagnostics.filter((entry) => entry.severity !== "info").map((entry) => entry.message).join(" ") || null,
      };
    }),
  };
}

type MegaBase = Pick<BattleBuild, "speciesId" | "abilityId" | "abilityActive" | "itemId">;

export type Combatant = {
  key: number;
  editorRevision: number;
  role: RosterRole;
  build: BattleBuild;
  // Shared by both HP editors; parsed NaN cannot retain unfinished input text.
  hpInput: string;
  source: RosterSource | null;
  moves: MoveSlots;
  // Only form-specific choices are restored; shared preparation keeps later edits.
  megaBase: MegaBase | null;
  contexts: Record<string, MoveContext>;
  // Move callbacks expire independently of unfinished Stat Point editor text.
  moveEpoch: number;
};

export type MoveOwner = { key: number; epoch: number };
export type MoveReplacement = { owner: MoveOwner; slotIndex: number; session: number };

type RosterSelection = { leagueId: string; ownMemberId: string; opponentId: string };
export type PreparedMatchup = {
  revision: number;
  notice: string;
  accountId: string | null;
  selection: RosterSelection;
  teams: Record<RosterRole, TeamSelection>;
  importRevision: number;
  attacker: Combatant;
  defender: Combatant;
  field: BattleConditions;
  attack: { owner: MoveOwner; moveId: string | null };
  replacement: MoveReplacement | null;
  replacementSession: number;
  cache: Map<string, { source: RosterSource; build: BattleBuild; hpInput: string; moves: MoveSlots; megaBase: MegaBase | null }>;
};

function cacheCombatant(current: PreparedMatchup, slot: Combatant): PreparedMatchup["cache"] {
  const { source, build, hpInput, moves, megaBase } = slot;
  return source ? new Map(current.cache).set(source.key, { source, build, hpInput, moves, megaBase }) : current.cache;
}

function formSettings({ speciesId, abilityId, abilityActive, itemId }: BattleBuild): MegaBase {
  return { speciesId, abilityId, abilityActive, itemId };
}

export function getMoveOwner(slot: Combatant): MoveOwner {
  return { key: slot.key, epoch: slot.moveEpoch };
}

export function sameMoveOwner(a: MoveOwner, b: MoveOwner): boolean {
  return a.key === b.key && a.epoch === b.epoch;
}

function moveOwnerSide(current: PreparedMatchup, owner: MoveOwner): BattleSide | null {
  if (sameMoveOwner(getMoveOwner(current.attacker), owner)) return "attacker";
  if (sameMoveOwner(getMoveOwner(current.defender), owner)) return "defender";
  return null;
}

/** Cards and stored side conditions stay in physical left/right order. */
export function getAttackView(current: PreparedMatchup) {
  const activeSide = moveOwnerSide(current, current.attack.owner);
  const sourceSide = activeSide ?? "attacker";
  const receiverSide: BattleSide = sourceSide === "attacker" ? "defender" : "attacker";
  const source = current[sourceSide];
  const receiver = current[receiverSide];
  return {
    source, receiver, sourceSide, receiverSide,
    owner: getMoveOwner(source), receiverOwner: getMoveOwner(receiver),
    field: sourceSide === "attacker" ? current.field : {
      ...current.field, attackerSide: current.field.defenderSide, defenderSide: current.field.attackerSide,
    },
    contexts: source.contexts,
    moveId: activeSide ? current.attack.moveId : null,
  };
}

export function createMatchup(revision = 0): PreparedMatchup {
  const field = createConditions();
  const attacker: Combatant = {
    key: revision * 2, editorRevision: 0, role: "own", build: createBuild("charizard"), hpInput: "", source: null,
    moves: createMoveSlots("charizard", field.gameType), megaBase: null, contexts: {}, moveEpoch: 0,
  };
  const defender: Combatant = {
    key: revision * 2 + 1, editorRevision: 0, role: "opponent", build: createBuild("blastoise"), hpInput: "", source: null,
    moves: createMoveSlots("blastoise", field.gameType), megaBase: null, contexts: {}, moveEpoch: 0,
  };
  return {
    revision,
    notice: "",
    accountId: null,
    selection: { leagueId: "", ownMemberId: "", opponentId: "" },
    teams: { own: { mode: "league", paste: null, epoch: 0 }, opponent: { mode: "league", paste: null, epoch: 0 } },
    importRevision: 0,
    attacker, defender, field,
    attack: { owner: getMoveOwner(attacker), moveId: null },
    replacement: null,
    replacementSession: 0,
    cache: new Map(),
  };
}

function clearMoveInteractions(current: PreparedMatchup): PreparedMatchup {
  const attacker = { ...current.attacker, contexts: {}, moveEpoch: current.attacker.moveEpoch + 1 };
  const defender = { ...current.defender, contexts: {}, moveEpoch: current.defender.moveEpoch + 1 };
  return {
    ...current, attacker, defender,
    attack: { owner: getMoveOwner(attacker), moveId: null }, replacement: null,
  };
}

function freshMatchup(current: PreparedMatchup): PreparedMatchup {
  const next = createMatchup(current.revision + 1);
  return clearMoveInteractions({
    ...next,
    attacker: { ...next.attacker, moveEpoch: current.attacker.moveEpoch },
    defender: { ...next.defender, moveEpoch: current.defender.moveEpoch },
    replacementSession: current.replacementSession,
  });
}

function learnsMove(slot: Combatant, moveId: string): boolean {
  return speciesById.get(slot.build.speciesId)?.moves.includes(moveId) ?? false;
}

/** Full-learnset exploration never rewrites a prepared slot. */
export function selectMatchupMove(current: PreparedMatchup, moveId: string | null, owner = current.attack.owner): PreparedMatchup {
  const side = moveOwnerSide(current, owner);
  if (!side || !sameMoveOwner(owner, current.attack.owner)) return current;
  if (moveId !== null && !learnsMove(current[side], moveId)) return current;
  if (current.attack.moveId === moveId) return current;
  return { ...current, attack: { owner: getMoveOwner(current[side]), moveId } };
}

function validMoveSlot(slotIndex: number): boolean {
  return Number.isInteger(slotIndex) && slotIndex >= 0 && slotIndex < 4;
}

export function activateMoveSlot(current: PreparedMatchup, owner: MoveOwner, slotIndex: number): PreparedMatchup {
  const side = moveOwnerSide(current, owner);
  if (!side || !validMoveSlot(slotIndex)) return current;
  const activeOwner = getMoveOwner(current[side]);
  const session = current.replacementSession + 1;
  return {
    ...current,
    attack: { owner: activeOwner, moveId: current[side].moves[slotIndex].moveId },
    replacement: { owner: activeOwner, slotIndex, session }, replacementSession: session,
  };
}

function currentReplacement(current: PreparedMatchup, replacement: MoveReplacement): boolean {
  const active = current.replacement;
  return active !== null && active.session === replacement.session && active.slotIndex === replacement.slotIndex
    && sameMoveOwner(active.owner, replacement.owner);
}

export function replaceMatchupMove(current: PreparedMatchup, replacement: MoveReplacement, moveId: string): PreparedMatchup {
  if (!currentReplacement(current, replacement) || !sameMoveOwner(current.attack.owner, replacement.owner)) return current;
  const side = moveOwnerSide(current, replacement.owner);
  if (!side || !validMoveSlot(replacement.slotIndex)) return current;
  const slot = current[side];
  if (!learnsMove(slot, moveId) || slot.moves.some((move, index) => index !== replacement.slotIndex && move.moveId === moveId)) return current;
  if (slot.moves[replacement.slotIndex].moveId === moveId) return current;
  const moves: MoveSlots = [...slot.moves];
  moves[replacement.slotIndex] = { moveId, origin: "manual", gameType: null };
  const next = { ...slot, moves };
  const session = current.replacementSession + 1;
  return {
    ...current, [side]: next, cache: cacheCombatant(current, next),
    attack: { owner: getMoveOwner(next), moveId },
    replacement: { ...replacement, session }, replacementSession: session,
  };
}

export function dismissMoveReplacement(current: PreparedMatchup, replacement: MoveReplacement): PreparedMatchup {
  if (!currentReplacement(current, replacement)) return current;
  return { ...current, replacement: null };
}

export function updateMatchupMoveContext(current: PreparedMatchup, owner: MoveOwner, moveId: string, context: MoveContext): PreparedMatchup {
  const side = moveOwnerSide(current, owner);
  if (!side || !sameMoveOwner(owner, current.attack.owner) || !learnsMove(current[side], moveId)) return current;
  const slot = current[side];
  return { ...current, [side]: { ...slot, contexts: { ...slot.contexts, [moveId]: { ...context } } } };
}

/** A Mega form is the same Pokémon, not a fresh build or another roster entry. */
export function toggleMatchupMega(current: PreparedMatchup, owner: MoveOwner, formId: string): PreparedMatchup {
  const side = moveOwnerSide(current, owner);
  if (!side) return current;
  const slot = current[side];
  const option = getMegaOptions(slot.build.speciesId).find((entry) => entry.formId === formId);
  if (!option) return current;
  const base = slot.build.speciesId === option.baseSpeciesId ? formSettings(slot.build)
    : slot.megaBase?.speciesId === option.baseSpeciesId ? slot.megaBase : null;
  const reverting = slot.build.speciesId === formId;
  const settings = reverting ? base ?? formSettings(createBuild(option.baseSpeciesId)) : formSettings(createBuild(formId));
  const build = { ...slot.build, ...settings };
  const next = { ...slot, build, megaBase: reverting ? null : base, moveEpoch: slot.moveEpoch + 1 };
  const nextOwner = getMoveOwner(next);
  const editing = current.replacement && sameMoveOwner(current.replacement.owner, owner);
  const session = current.replacementSession + (editing ? 1 : 0);
  return {
    ...current, [side]: next, cache: cacheCombatant(current, next),
    attack: sameMoveOwner(current.attack.owner, owner) ? { ...current.attack, owner: nextOwner } : current.attack,
    replacement: editing ? { ...current.replacement!, owner: nextOwner, session } : current.replacement,
    replacementSession: session,
    notice: `${speciesById.get(build.speciesId)?.name} selected. Current HP, training and prepared moves kept.`,
  };
}

export function swapMatchup(current: PreparedMatchup): PreparedMatchup {
  return clearMoveInteractions({
    ...current,
    attacker: current.defender,
    defender: current.attacker,
    field: { ...current.field, attackerSide: current.field.defenderSide, defenderSide: current.field.attackerSide },
    notice: "Left and Right Pokémon swapped with their roster shortcuts and side conditions. Shared field settings are unchanged; move hit counts cleared.",
  });
}

export function resetMatchup(current: PreparedMatchup): PreparedMatchup {
  return {
    ...freshMatchup(current), accountId: current.accountId, selection: current.selection,
    teams: {
      own: { ...current.teams.own, epoch: current.teams.own.epoch + 1 },
      opponent: { ...current.teams.opponent, epoch: current.teams.opponent.epoch + 1 },
    },
    importRevision: current.importRevision,
    notice: "Reset to Charizard versus Blastoise, full HP, zero Stat Points and stages, and the default Doubles field. Session build edits cleared. League and opponent choices kept; imported teams kept with their original sets. Your team shortcuts are on the left.",
  };
}

export function getTeamSourceOwner(current: PreparedMatchup, role: RosterRole): TeamSourceOwner {
  return { role, revision: current.revision, epoch: current.teams[role].epoch };
}

function currentTeamSource(current: PreparedMatchup, owner: TeamSourceOwner): boolean {
  return owner.revision === current.revision && owner.epoch === current.teams[owner.role].epoch;
}

function setTeamSelection(current: PreparedMatchup, role: RosterRole, selection: TeamSelection): PreparedMatchup {
  const detach = (slot: Combatant) => slot.role === role && slot.source ? { ...slot, source: null } : slot;
  return clearMoveInteractions({
    ...current, teams: { ...current.teams, [role]: selection },
    attacker: detach(current.attacker), defender: detach(current.defender),
  });
}

export function changeTeamSource(current: PreparedMatchup, owner: TeamSourceOwner, mode: TeamSourceMode): PreparedMatchup {
  if (!currentTeamSource(current, owner) || current.teams[owner.role].mode === mode) return current;
  return {
    ...setTeamSelection(current, owner.role, { ...current.teams[owner.role], mode, epoch: owner.epoch + 1 }),
    notice: "Team source changed. Current Pokémon and their preparation kept; choose a team Pokémon to load another set.",
  };
}

function prunePaste(current: PreparedMatchup, role: RosterRole): PreparedMatchup["cache"] {
  return new Map([...current.cache].filter(([, entry]) => entry.source.kind !== "paste" || entry.source.role !== role));
}

export function applyTeamPaste(current: PreparedMatchup, owner: TeamSourceOwner, input: PasteImport): PreparedMatchup {
  if (!currentTeamSource(current, owner) || current.teams[owner.role].mode !== "paste"
    || input.team.diagnostics.some((entry) => entry.severity === "error")
    || !input.team.members.some((member) => member.selectable && member.build && member.speciesId)) return current;
  const importRevision = current.importRevision + 1;
  const paste = { ...structuredClone(input), title: input.title.trim().slice(0, 160) || "Imported team", id: `${current.revision}:${importRevision}` };
  const next = setTeamSelection(current, owner.role, { mode: "paste", paste, epoch: owner.epoch + 1 });
  return {
    ...next, importRevision, cache: prunePaste(current, owner.role),
    notice: `${paste.title} imported for ${owner.role === "own" ? "your team" : "the opponent"}. Current Pokémon kept; click a team Pokémon to load its set.`,
  };
}

export function removeTeamPaste(current: PreparedMatchup, owner: TeamSourceOwner): PreparedMatchup {
  if (!currentTeamSource(current, owner) || !current.teams[owner.role].paste) return current;
  const next = setTeamSelection(current, owner.role, { ...current.teams[owner.role], paste: null, epoch: owner.epoch + 1 });
  return { ...next, cache: prunePaste(current, owner.role), notice: "Imported team removed. Current Pokémon and their preparation kept as manual builds." };
}

function storeBuild(current: PreparedMatchup, side: BattleSide, build: BattleBuild, hpInput: string): PreparedMatchup {
  const slot = current[side];
  const changedSpecies = slot.build.speciesId !== build.speciesId;
  const source = changedSpecies ? null : slot.source;
  const moves = changedSpecies ? createMoveSlots(build.speciesId, current.field.gameType) : slot.moves;
  const nextSlot = {
    ...slot, build, source, hpInput, moves,
    megaBase: changedSpecies ? null : slot.megaBase,
    editorRevision: slot.editorRevision + (changedSpecies ? 1 : 0),
  };
  const next = { ...current, [side]: nextSlot, cache: cacheCombatant(current, nextSlot) };
  return changedSpecies ? clearMoveInteractions(next) : next;
}

export function updateMatchupBuild(current: PreparedMatchup, side: BattleSide, build: BattleBuild): PreparedMatchup {
  const slot = current[side];
  const sameHP = slot.build.speciesId === build.speciesId && Object.is(slot.build.currentHP, build.currentHP);
  return storeBuild(current, side, build, sameHP ? slot.hpInput : formatHPInput(build.currentHP));
}

export function updateMatchupHP(current: PreparedMatchup, side: BattleSide, hpInput: string): PreparedMatchup {
  const build = { ...current[side].build, currentHP: parseBuildInput(hpInput, true) };
  return storeBuild(current, side, build, hpInput);
}

export function selectRosterPokemon(current: PreparedMatchup, side: BattleSide, choice: RosterChoice): PreparedMatchup {
  const source = choice.source;
  const slot = current[side];
  if (!source || !speciesById.has(source.speciesId) || (choice.owner && (choice.owner.role !== slot.role || !currentTeamSource(current, choice.owner)))) return current;
  const selection = current.teams[slot.role];
  const memberId = slot.role === "own" ? current.selection.ownMemberId : current.selection.opponentId;
  const seed = source.kind === "paste" ? selection.paste?.team.members.find((member) => member.index === source.index) : undefined;
  if (source.kind === "league") {
    if (selection.mode !== "league" || source.leagueId !== current.selection.leagueId || source.memberId !== memberId) return current;
  } else if (!choice.owner || selection.mode !== "paste" || source.role !== slot.role || selection.paste?.id !== source.importId
    || !seed?.selectable || !seed.build || seed.speciesId !== source.speciesId
    || source.key !== JSON.stringify(["paste", slot.role, source.importId, source.index])) return current;
  if (slot.source?.key === source.key) return current;
  const cached = current.cache.get(source.key);
  const build = cached?.build ?? (seed?.build ? structuredClone(seed.build) : createBuild(source.speciesId));
  const hpInput = cached?.hpInput ?? formatHPInput(build.currentHP);
  const moves = cached?.moves ?? (seed ? structuredClone(seed.moves) : createMoveSlots(source.speciesId, current.field.gameType));
  const nextSlot = { ...slot, build, source, hpInput, moves, megaBase: cached?.megaBase ?? null, editorRevision: slot.editorRevision + 1 };
  return clearMoveInteractions({
    ...current,
    [side]: nextSlot,
    cache: cacheCombatant(current, nextSlot),
    notice: `${choice.name} selected as ${side === "attacker" ? "Left" : "Right"} Pokémon. ${cached ? "Your session build edits were restored." : seed ? "Imported build and prepared moves loaded." : "Default build loaded; adjust nature, ability, item and Stat Points as needed."} Field settings are unchanged; move hit counts cleared.`,
  });
}

/** Reconcile ownership only. A network response must never activate a combatant. */
export function reconcileRosters(current: PreparedMatchup, state: CalculatorRosterState): PreparedMatchup {
  if (current.accountId !== null && current.accountId !== state.userId) {
    current = { ...freshMatchup(current), accountId: state.userId };
  }
  const league = state.leagues.find((entry) => entry.id === state.selectedLeagueId);
  const selection = { leagueId: state.selectedLeagueId, ownMemberId: league?.memberId ?? "", opponentId: state.opponentId };
  const selectionChanged = Object.keys(selection).some((key) => selection[key as keyof RosterSelection] !== current.selection[key as keyof RosterSelection]);
  const ownChanged = current.teams.own.mode === "league" && (selection.leagueId !== current.selection.leagueId || selection.ownMemberId !== current.selection.ownMemberId);
  const opponentChanged = current.teams.opponent.mode === "league" && (selection.leagueId !== current.selection.leagueId || selection.opponentId !== current.selection.opponentId);
  const navigationChanged = ownChanged || opponentChanged;
  const availableLeagues = new Set(state.leagues.map((entry) => entry.id));
  const checkedTeams = state.status === "ready" && state.teamsStatus === "ready" && state.data?.leagueId === league?.id;
  const validSources = new Map<string, RosterSource>();
  if (checkedTeams && league?.draftCompleted && state.data) {
    const memberIds = new Set(state.data.members.map((member) => member.id));
    const counts = new Map<string, number>();
    for (const team of state.data.teams) counts.set(team.member_id, (counts.get(team.member_id) ?? 0) + 1);
    for (const team of state.data.teams) {
      if (!memberIds.has(team.member_id) || counts.get(team.member_id) !== 1) continue;
      for (const choice of rosterChoices(league.id, team)) {
        if (choice.source) validSources.set(choice.source.key, choice.source);
      }
    }
  }
  let cache = current.cache;
  for (const [key, { source }] of current.cache) {
    if (source.kind !== "league") continue;
    if ((state.status === "ready" && !availableLeagues.has(source.leagueId))
      || (checkedTeams && source.leagueId === selection.leagueId && !validSources.has(key))) {
      if (cache === current.cache) cache = new Map(cache);
      cache.delete(key);
    }
  }
  let detached = false;
  const reconcileSlot = (slot: Combatant): Combatant => {
    if (!slot.source) return slot;
    const team = current.teams[slot.role];
    if (slot.source.kind === "paste") {
      if (team.mode === "paste" && slot.source.role === slot.role && team.paste?.id === slot.source.importId) return slot;
      detached = true;
      return { ...slot, source: null };
    }
    const memberId = slot.role === "own" ? selection.ownMemberId : selection.opponentId;
    if (team.mode !== "league" || slot.source.leagueId !== selection.leagueId || slot.source.memberId !== memberId
      || (checkedTeams && !validSources.has(slot.source.key))) {
      detached = true;
      return { ...slot, source: null };
    }
    const updated = validSources.get(slot.source.key);
    return updated && updated.name !== slot.source.name ? { ...slot, source: updated } : slot;
  };
  const attacker = reconcileSlot(current.attacker);
  const defender = reconcileSlot(current.defender);
  if (!selectionChanged && !detached && attacker === current.attacker && defender === current.defender
    && cache === current.cache && current.accountId === state.userId) return current;
  const teams = navigationChanged ? {
    own: ownChanged ? { ...current.teams.own, epoch: current.teams.own.epoch + 1 } : current.teams.own,
    opponent: opponentChanged ? { ...current.teams.opponent, epoch: current.teams.opponent.epoch + 1 } : current.teams.opponent,
  } : current.teams;
  const next = { ...current, accountId: state.userId, selection, teams, attacker, defender, cache };
  return navigationChanged || detached ? clearMoveInteractions(next) : next;
}
