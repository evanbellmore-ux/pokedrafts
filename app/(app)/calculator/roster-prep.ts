import { champions, speciesById } from "@/app/lib/battle/catalog";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import { createMoveSlots, type MoveSlots } from "@/app/lib/battle/move-defaults";
import type { BattleBuild, BattleConditions, ChampionsSpecies, MoveContext } from "@/app/lib/battle/types";
import { teamNameLabel } from "@/app/lib/league/labels";
import { pokemonKey, type TeamRoster } from "../leagues/[leagueId]/team/roster";
import type { CalculatorRosterState } from "./roster-data";
import { formatHPInput, parseBuildInput } from "./build-input";

export type BattleSide = "attacker" | "defender";
export type RosterRole = "own" | "opponent";
export type SpeciesResolution =
  | { status: "resolved"; speciesId: string }
  | { status: "unavailable" | "ambiguous"; reason: string };

function normalizeAlias(name: string) {
  return name.normalize("NFKD").toLowerCase()
    .replace(/[̀-ͯ]/g, "")
    .replace(/♀/g, "f").replace(/♂/g, "m")
    .replace(/\bfemale\b/g, "f").replace(/\bmale\b/g, "m")
    .replace(/[\s._'’‘:()[\]-]/g, "");
}

/** Only complete, catalog-backed aliases; search tokens are not species identities. */
export function createSpeciesResolver(species: readonly Pick<ChampionsSpecies, "id" | "name" | "calcName">[]) {
  const aliases = new Map<string, Set<string>>();
  for (const entry of species) {
    const names = [entry.id, entry.name, entry.calcName];
    const mega = entry.name.match(/^(.+)-Mega(?:-(X|Y|Z))?$/);
    if (mega) names.push(`Mega ${mega[1]} ${mega[2] ?? ""}`);
    const regional = entry.name.match(/^(.+)-(Alola|Galar|Hisui|Paldea)(.*)$/);
    if (regional) {
      const adjectives: Record<string, string> = { Alola: "Alolan", Galar: "Galarian", Hisui: "Hisuian", Paldea: "Paldean" };
      names.push(`${adjectives[regional[2]]} ${regional[1]}${regional[3]}`);
    }
    for (const name of names) {
      const alias = normalizeAlias(name);
      const ids = aliases.get(alias) ?? new Set<string>();
      ids.add(entry.id);
      aliases.set(alias, ids);
    }
  }
  return (name: string): SpeciesResolution => {
    const ids = aliases.get(normalizeAlias(name));
    if (!ids?.size) return { status: "unavailable", reason: "No exact Champions match. Use the manual Pokémon selector." };
    if (ids.size !== 1) return { status: "ambiguous", reason: "This name matches multiple Champions forms. Choose the form manually." };
    return { status: "resolved", speciesId: [...ids][0] };
  };
}

export const resolveRosterSpecies = createSpeciesResolver(champions.species);

export type RosterSource = {
  key: string;
  leagueId: string;
  memberId: string;
  rosterId: string;
  name: string;
  speciesId: string;
};

export type RosterChoice = {
  key: string;
  name: string;
  speciesId: string | null;
  source: RosterSource | null;
  reason: string | null;
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
      source: !duplicate && speciesId ? { key, leagueId, memberId: team.member_id, rosterId: team.id, name: pokemon.name, speciesId } : null,
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

export type Combatant = {
  key: number;
  editorRevision: number;
  role: RosterRole;
  build: BattleBuild;
  // Shared by both HP editors; parsed NaN cannot retain unfinished input text.
  hpInput: string;
  source: RosterSource | null;
  moves: MoveSlots;
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
  attacker: Combatant;
  defender: Combatant;
  field: BattleConditions;
  attack: { owner: MoveOwner; moveId: string | null };
  replacement: MoveReplacement | null;
  replacementSession: number;
  cache: Map<string, { source: RosterSource; build: BattleBuild; hpInput: string; moves: MoveSlots }>;
};

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
    moves: createMoveSlots("charizard", field.gameType), contexts: {}, moveEpoch: 0,
  };
  const defender: Combatant = {
    key: revision * 2 + 1, editorRevision: 0, role: "opponent", build: createBuild("blastoise"), hpInput: "", source: null,
    moves: createMoveSlots("blastoise", field.gameType), contexts: {}, moveEpoch: 0,
  };
  return {
    revision,
    notice: "",
    accountId: null,
    selection: { leagueId: "", ownMemberId: "", opponentId: "" },
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
  const { source, build, hpInput } = slot;
  const cache = source ? new Map(current.cache).set(source.key, { source, build, hpInput, moves }) : current.cache;
  return {
    ...current, [side]: { ...slot, moves }, cache,
    attack: { owner: getMoveOwner(slot), moveId: null }, replacement: null,
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
    notice: "Reset to Charizard versus Blastoise, full HP, zero Stat Points and stages, and the default Doubles field. Session build edits cleared. League and opponent choices kept; your team shortcuts are on the left.",
  };
}

function storeBuild(current: PreparedMatchup, side: BattleSide, build: BattleBuild, hpInput: string): PreparedMatchup {
  const slot = current[side];
  const changedSpecies = slot.build.speciesId !== build.speciesId;
  const source = changedSpecies ? null : slot.source;
  const moves = changedSpecies ? createMoveSlots(build.speciesId, current.field.gameType) : slot.moves;
  const cache = source ? new Map(current.cache).set(source.key, { source, build, hpInput, moves }) : current.cache;
  const next = { ...current, [side]: { ...slot, build, source, hpInput, moves }, cache };
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
  const memberId = slot.role === "own" ? current.selection.ownMemberId : current.selection.opponentId;
  if (!source || source.leagueId !== current.selection.leagueId || source.memberId !== memberId || !speciesById.has(source.speciesId)) return current;
  if (slot.source?.key === source.key) return current;
  const cached = current.cache.get(source.key);
  const build = cached?.build ?? createBuild(source.speciesId);
  const hpInput = cached?.hpInput ?? formatHPInput(build.currentHP);
  const moves = cached?.moves ?? createMoveSlots(source.speciesId, current.field.gameType);
  return clearMoveInteractions({
    ...current,
    [side]: { ...slot, build, source, hpInput, moves, editorRevision: slot.editorRevision + 1 },
    cache: new Map(current.cache).set(source.key, { source, build, hpInput, moves }),
    notice: `${choice.name} selected as ${side === "attacker" ? "Left" : "Right"} Pokémon. ${cached ? "Your session build edits were restored." : "Default build loaded; adjust nature, ability, item and Stat Points as needed."} Field settings are unchanged; move hit counts cleared.`,
  });
}

/** Reconcile ownership only. A network response must never activate a combatant. */
export function reconcileRosters(current: PreparedMatchup, state: CalculatorRosterState): PreparedMatchup {
  if (current.accountId !== null && current.accountId !== state.userId) {
    current = { ...freshMatchup(current), accountId: state.userId };
  }
  const league = state.leagues.find((entry) => entry.id === state.selectedLeagueId);
  const selection = { leagueId: state.selectedLeagueId, ownMemberId: league?.memberId ?? "", opponentId: state.opponentId };
  const navigationChanged = Object.keys(selection).some((key) => selection[key as keyof RosterSelection] !== current.selection[key as keyof RosterSelection]);
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
    if ((state.status === "ready" && !availableLeagues.has(source.leagueId))
      || (checkedTeams && source.leagueId === selection.leagueId && !validSources.has(key))) {
      if (cache === current.cache) cache = new Map(cache);
      cache.delete(key);
    }
  }
  let detached = false;
  const reconcileSlot = (slot: Combatant): Combatant => {
    if (!slot.source) return slot;
    const memberId = slot.role === "own" ? selection.ownMemberId : selection.opponentId;
    if (slot.source.leagueId !== selection.leagueId || slot.source.memberId !== memberId
      || (checkedTeams && !validSources.has(slot.source.key))) {
      detached = true;
      return { ...slot, source: null };
    }
    const updated = validSources.get(slot.source.key);
    return updated && updated.name !== slot.source.name ? { ...slot, source: updated } : slot;
  };
  const attacker = reconcileSlot(current.attacker);
  const defender = reconcileSlot(current.defender);
  if (!navigationChanged && !detached && attacker === current.attacker && defender === current.defender
    && cache === current.cache && current.accountId === state.userId) return current;
  const next = { ...current, accountId: state.userId, selection, attacker, defender, cache };
  return navigationChanged || detached ? clearMoveInteractions(next) : next;
}
