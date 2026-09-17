import { champions, speciesById } from "@/app/lib/battle/catalog";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import type { BattleBuild, BattleConditions, ChampionsSpecies, MoveContext } from "@/app/lib/battle/types";
import { teamNameLabel } from "@/app/lib/league/labels";
import { pokemonKey, type TeamRoster } from "../leagues/[leagueId]/team/roster";
import type { CalculatorRosterState } from "./roster-data";

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
    if (!ids?.size) return { status: "unavailable", reason: "No exact Champions match. Use the manual Pokémon selector below." };
    if (ids.size !== 1) return { status: "ambiguous", reason: "This name matches multiple Champions forms. Choose the form manually below." };
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
      reason: duplicate ? "Duplicate roster name. Choose the Pokémon manually below." : resolved.status === "resolved" ? null : resolved.reason,
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
  if (!league) return empty(state.leagues.length ? "Choose a league above to see its team rosters." : "Join a league to use roster shortcuts, or select Pokémon manually.");
  if (role === "opponent" && !state.opponentId) return empty("Choose an opponent above to see their team.");
  if (state.teamsStatus === "loading") return empty("Loading current team rosters…", "loading");
  if (state.teamsStatus === "error") return empty("Could not load this league's teams. Retry above or select Pokémon manually.", "error");
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

type Combatant = {
  key: number;
  editorRevision: number;
  role: RosterRole;
  build: BattleBuild;
  source: RosterSource | null;
};

type RosterSelection = { leagueId: string; ownMemberId: string; opponentId: string };
export type PreparedMatchup = {
  revision: number;
  notice: string;
  accountId: string | null;
  selection: RosterSelection;
  attacker: Combatant;
  defender: Combatant;
  field: BattleConditions;
  contexts: Record<string, MoveContext>;
  cache: Map<string, { source: RosterSource; build: BattleBuild }>;
};

export function createMatchup(revision = 0): PreparedMatchup {
  return {
    revision,
    notice: "",
    accountId: null,
    selection: { leagueId: "", ownMemberId: "", opponentId: "" },
    attacker: { key: revision * 2, editorRevision: 0, role: "own", build: createBuild("charizard"), source: null },
    defender: { key: revision * 2 + 1, editorRevision: 0, role: "opponent", build: createBuild("blastoise"), source: null },
    field: createConditions(),
    contexts: {},
    cache: new Map(),
  };
}

export function swapMatchup(current: PreparedMatchup): PreparedMatchup {
  return {
    ...current,
    attacker: current.defender,
    defender: current.attacker,
    field: { ...current.field, attackerSide: current.field.defenderSide, defenderSide: current.field.attackerSide },
    contexts: {},
    notice: "Attacker and defender swapped with their roster shortcuts and side conditions. Shared field settings are unchanged; move hit counts cleared.",
  };
}

export function resetMatchup(current: PreparedMatchup): PreparedMatchup {
  return {
    ...createMatchup(current.revision + 1), accountId: current.accountId, selection: current.selection,
    notice: "Reset to Charizard versus Blastoise, full HP, zero Stat Points and stages, and the default Doubles field. Session build edits cleared. League and opponent choices kept; your team shortcuts are on the left.",
  };
}

export function updateMatchupBuild(current: PreparedMatchup, side: BattleSide, build: BattleBuild): PreparedMatchup {
  const slot = current[side];
  const changedSpecies = slot.build.speciesId !== build.speciesId;
  const source = changedSpecies ? null : slot.source;
  const cache = source ? new Map(current.cache).set(source.key, { source, build }) : current.cache;
  return { ...current, [side]: { ...slot, build, source }, cache, contexts: changedSpecies ? {} : current.contexts };
}

export function selectRosterPokemon(current: PreparedMatchup, side: BattleSide, choice: RosterChoice): PreparedMatchup {
  const source = choice.source;
  const slot = current[side];
  const memberId = slot.role === "own" ? current.selection.ownMemberId : current.selection.opponentId;
  if (!source || source.leagueId !== current.selection.leagueId || source.memberId !== memberId || !speciesById.has(source.speciesId)) return current;
  if (slot.source?.key === source.key) return current;
  const cached = current.cache.get(source.key);
  const build = cached?.build ?? createBuild(source.speciesId);
  return {
    ...current,
    [side]: { ...slot, build, source, editorRevision: slot.editorRevision + 1 },
    cache: new Map(current.cache).set(source.key, { source, build }),
    contexts: {},
    notice: `${choice.name} selected as ${side}. ${cached ? "Your session build edits were restored." : "Default build loaded; adjust nature, ability, item and Stat Points as needed."} Field settings are unchanged; move hit counts cleared.`,
  };
}

/** Reconcile ownership only. A network response must never activate a combatant. */
export function reconcileRosters(current: PreparedMatchup, state: CalculatorRosterState): PreparedMatchup {
  if (current.accountId !== null && current.accountId !== state.userId) {
    current = { ...createMatchup(current.revision + 1), accountId: state.userId };
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
  return {
    ...current, accountId: state.userId, selection, attacker, defender, cache,
    contexts: navigationChanged || detached ? {} : current.contexts,
  };
}
