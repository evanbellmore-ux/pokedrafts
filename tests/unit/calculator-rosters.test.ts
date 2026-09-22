import { createElement, type ChangeEvent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MyTeamPicker, OpponentPicker, RosterPicker } from "@/app/(app)/calculator/LeagueMatchupPicker";
import * as pokemonSprite from "@/app/components/PokemonSprite";
import * as selectControl from "@/app/components/ui/Select";
import {
  createMatchup, createSpeciesResolver, getRosterPanel, reconcileRosters, resetMatchup,
  resolveRosterSpecies, rosterChoices, selectMatchupMove, selectRosterPokemon, swapMatchup, updateMatchupBuild, updateMatchupHP,
} from "@/app/(app)/calculator/roster-prep";
import type { CalculatorRosterState } from "@/app/(app)/calculator/roster-data";
import type { TeamRoster } from "@/app/(app)/leagues/[leagueId]/team/roster";
import { movesById, speciesById } from "@/app/lib/battle/catalog";
import { createBuild, createConditions, SHARED_FIELD_EFFECTS, validateBuild } from "@/app/lib/battle/model";

function team(id: string, memberId: string, names: string[]): TeamRoster {
  return {
    id, member_id: memberId, total_points: names.length * 15, team_name: null, role: null,
    pokemon: names.map((name, index) => ({ name, points: 15, tier: 1, pick_number: index + 1, acquired: "draft" })),
  };
}

function loaded(): CalculatorRosterState {
  return {
    status: "ready", userId: "user-account", selectedLeagueId: "league-a", opponentId: "member-other",
    leagues: [
      { id: "league-a", name: "Alpha", memberId: "member-own", teamName: "Home", draftStarted: true, draftCompleted: true },
      { id: "league-b", name: "Beta", memberId: "member-own-b", teamName: "Home B", draftStarted: true, draftCompleted: true },
    ],
    teamsStatus: "ready", message: null, teamsMessage: null,
    data: {
      leagueId: "league-a",
      members: [
        { id: "member-own", role: "coach", team_name: "Home", draft_position: 1 },
        { id: "member-other", role: "coach", team_name: "Away", draft_position: 2 },
        { id: "member-empty", role: "coach", team_name: "No roster yet", draft_position: null },
      ],
      teams: [team("team-own", "member-own", ["Charizard", "Mega Charizard X", "Blastoise"]), team("team-other", "member-other", ["Charizard", "Venusaur"])],
    },
  };
}

function choices(state = loaded()) {
  return { own: getRosterPanel(state, "own").choices, other: getRosterPanel(state, "opponent").choices };
}

function prepared(state = loaded()) {
  const { own, other } = choices(state);
  let matchup = reconcileRosters(createMatchup(), state);
  matchup = selectRosterPokemon(matchup, "attacker", own[0]);
  return selectRosterPokemon(matchup, "defender", other[0]);
}

function assertLabels(html: string) {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  expect(new Set(ids).size).toBe(ids.length);
  for (const [, id] of html.matchAll(/\bfor="([^"]+)"/g)) expect(ids).toContain(id);
  for (const [, references] of html.matchAll(/\baria-(?:describedby|labelledby)="([^"]+)"/g)) {
    for (const id of references.split(" ")) expect(ids).toContain(id);
  }
}

describe("Champions roster names", () => {
  it.each([
    [" Charizard ", "charizard"], ["charizardmegax", "charizardmegax"], ["Mega Charizard X", "charizardmegax"],
    ["CHARIZARD-MEGA-Y", "charizardmegay"], ["Aegislash-Shield", "aegislash"], ["Aegislash Blade", "aegislashblade"],
    ["Meowstic ♀ Mega", "meowsticfmega"], ["Meowstic Female Mega", "meowsticfmega"], ["Meowstic ♂ Mega", "meowsticmmega"],
    ["Mega Meowstic F", "meowsticfmega"], ["Indeedee (Female)", "indeedeef"],
    ["Alolan Raichu", "raichualola"], ["Raichu Alola", "raichualola"], ["Farfetch’d", "farfetchd"],
  ])("resolves only a complete verified alias: %s", (name, speciesId) => {
    expect(resolveRosterSpecies(name)).toEqual({ status: "resolved", speciesId });
  });

  it.each(["", "6", "My ace", "Charizard (my ace)", "Charizard Mega", "Mega Meowstic", "Charizard♀", "Floette", "Floette-Alola", "Raichu Hisui", "Charizard🔥"])("does not guess an unavailable name/form: %s", (name) => {
    expect(resolveRosterSpecies(name).status).toBe("unavailable");
  });

  it("deduplicates aliases for one species but refuses alias collisions", () => {
    const resolver = createSpeciesResolver([
      { id: "one", name: "A-b", calcName: "A b" },
      { id: "two", name: "Ab", calcName: "Other" },
    ]);
    expect(resolver("A b").status).toBe("ambiguous");
    expect(resolver("one")).toEqual({ status: "resolved", speciesId: "one" });
    expect(resolveRosterSpecies("Charizard")).toEqual({ status: "resolved", speciesId: "charizard" });
  });

  it("preserves gender symbols rather than falling back to an unqualified form", () => {
    const resolver = createSpeciesResolver([
      { id: "nidoranf", name: "Nidoran♀", calcName: "Nidoran-F" },
      { id: "nidoranm", name: "Nidoran♂", calcName: "Nidoran-M" },
    ]);
    expect(resolver("Nidoran Female")).toEqual({ status: "resolved", speciesId: "nidoranf" });
    expect(resolver("Nidoran Male")).toEqual({ status: "resolved", speciesId: "nidoranm" });
    expect(resolver("Nidoran").status).toBe("unavailable");
  });

  it("keeps unsupported exact forms visible and selectable", () => {
    const [choice] = rosterChoices("league-a", team("team-own", "member-own", ["Lucario-Mega-Z"]));
    expect(choice.source?.speciesId).toBe("lucariomegaz");
    expect(choice.reason).toBeNull();
    expect(validateBuild(createBuild(choice.speciesId!))).toEqual(expect.arrayContaining([expect.objectContaining({ field: "speciesId" })]));
  });

  it("does not cache duplicate roster names or confuse text aliases with entry identity", () => {
    const duplicates = rosterChoices("league-a", team("team-own", "member-own", ["Charizard", " CHARIZARD "]));
    expect(new Set(duplicates.map((entry) => entry.key)).size).toBe(2);
    expect(duplicates.every((entry) => !entry.source && entry.reason?.includes("Duplicate"))).toBe(true);
    const aliases = rosterChoices("league-a", team("team-own", "member-own", ["Mega Charizard X", "Charizard-Mega-X"]));
    expect(aliases[0].source?.speciesId).toBe(aliases[1].source?.speciesId);
    expect(aliases[0].source?.key).not.toBe(aliases[1].source?.key);
  });
});

describe("calculator prep transitions", () => {
  it("selects exact learned move IDs without changing any other matchup state", () => {
    expect(createMatchup().attack.moveId).toBeNull();
    const current = prepared();
    current.attacker.contexts = { bulletseed: { hits: 4 } };
    const before = structuredClone(current);
    const selected = selectMatchupMove(current, "flamethrower");
    expect(selected).toEqual({ ...current, attack: { ...current.attack, moveId: "flamethrower" } });
    for (const key of ["revision", "notice", "accountId", "selection", "attacker", "defender", "field", "replacement", "replacementSession", "cache"] as const) {
      expect(selected[key]).toBe(current[key]);
    }
    expect(current).toEqual(before);
    expect(selectMatchupMove(selected, "flamethrower")).toBe(selected);
    expect(movesById.has("surf")).toBe(true);
    expect(speciesById.get(current.attacker.build.speciesId)!.moves).not.toContain("surf");
    for (const id of ["", "madeupmove", "Flamethrower", " flamethrower ", "surf"]) {
      expect(selectMatchupMove(selected, id)).toBe(selected);
    }
    for (const id of speciesById.get(current.attacker.build.speciesId)!.moves) {
      expect(selectMatchupMove(current, id).attack.moveId).toBe(id);
    }
    const cleared = selectMatchupMove(selected, null);
    expect(cleared).toEqual(current);
    expect(selectMatchupMove(cleared, null)).toBe(cleared);
    expect(cleared.cache).toBe(selected.cache);
    expect(cleared.attacker.contexts).toBe(selected.attacker.contexts);
  });

  it("validates selection against the current attacker, not a previous or global learnset", () => {
    const selected = selectMatchupMove(createMatchup(), "flamethrower");
    const swapped = swapMatchup(selected);
    expect(swapped.attack.moveId).toBeNull();
    expect(selectMatchupMove(swapped, "flamethrower")).toBe(swapped);
    expect(selectMatchupMove(swapped, "surf").attack.moveId).toBe("surf");
    const unknown = updateMatchupBuild(selected, "attacker", createBuild("madeupmon"));
    expect(selectMatchupMove(unknown, "flamethrower")).toBe(unknown);
  });

  it("never lets initial data overwrite manual prep and does not import draft costs", () => {
    const manual = createMatchup();
    manual.attacker.build.points.spa = 32;
    manual.field.gravity = true;
    const state = loaded();
    const bound = reconcileRosters(manual, state);
    expect(bound.attacker.build).toBe(manual.attacker.build);
    expect(bound.attacker.source).toBeNull();
    const selected = selectRosterPokemon(bound, "attacker", choices(state).own[0]);
    expect(selected.attacker.build).toEqual(createBuild("charizard"));
    expect(selected.attacker.build.points.spa).toBe(0);
    expect(selected.field).toBe(manual.field);
    expect(selected.defender.build).toBe(manual.defender.build);
    expect(selected.defender.moves).toBe(manual.defender.moves);
    expect(selected.defender.moveEpoch).toBeGreaterThan(manual.defender.moveEpoch);
  });

  it.each(["attacker", "defender"] as const)("shares exact %s HP text without resetting battle context or mutating earlier states", (side) => {
    let current = selectMatchupMove(prepared(), "flamethrower");
    current.attacker.contexts = { bulletseed: { hits: 4 } };
    for (const text of ["00100", "abc", "2e1", " ", "", "0", "999", "1.5"]) {
      const before = structuredClone(current);
      const next = updateMatchupHP(current, side, text);
      expect(next[side].hpInput).toBe(text);
      expect(next[side].build.currentHP).toEqual(text === "" ? null : /^\d+$/.test(text) ? Number(text) : Number.NaN);
      expect(next.cache.get(next[side].source!.key)?.hpInput).toBe(text);
      expect(next.cache.get(next[side].source!.key)?.build).toBe(next[side].build);
      expect(next[side].source).toBe(current[side].source);
      expect(next[side].editorRevision).toBe(current[side].editorRevision);
      expect(next.attacker.contexts).toBe(current.attacker.contexts);
      expect(next.field).toBe(current.field);
      expect(next.attack.moveId).toBe("flamethrower");
      expect(next[side === "attacker" ? "defender" : "attacker"]).toBe(current[side === "attacker" ? "defender" : "attacker"]);
      expect(current).toEqual(before);
      current = next;
    }
  });

  it.each(["00100", "abc", "2e1", " ", ""])("keeps HP spelling %j on unrelated build edits and repeated roster activation", (text) => {
    const current = updateMatchupHP(prepared(), "attacker", text);
    const next = updateMatchupBuild(current, "attacker", { ...current.attacker.build, nature: "Timid" });
    expect(next.attacker.hpInput).toBe(text);
    expect(next.attacker.build.currentHP).toEqual(current.attacker.build.currentHP);
    expect(next.cache.get(next.attacker.source!.key)?.hpInput).toBe(text);
    expect(selectRosterPokemon(next, "attacker", choices().own[0])).toBe(next);
  });

  it("restores distinct invalid HP drafts for different roster identities with the same species", () => {
    const state = loaded();
    state.data!.teams[0] = team("team-own", "member-own", ["Mega Charizard X", "Charizard-Mega-X"]);
    const { own } = choices(state);
    let current = selectRosterPokemon(reconcileRosters(createMatchup(), state), "attacker", own[0]);
    current = updateMatchupHP(current, "attacker", "abc");
    current = selectRosterPokemon(current, "attacker", own[1]);
    expect(current.attacker.hpInput).toBe("");
    current = updateMatchupHP(current, "attacker", "2e1");
    const first = selectRosterPokemon(current, "attacker", own[0]);
    expect(first.attacker.hpInput).toBe("abc");
    expect(first.attacker.build.currentHP).toBeNaN();
    const second = selectRosterPokemon(first, "attacker", own[1]);
    expect(second.attacker.hpInput).toBe("2e1");
    expect(second.attacker.build.currentHP).toBeNaN();
    expect(second.attacker.key).toBe(first.attacker.key);
    expect(second.attacker.editorRevision).toBeGreaterThan(first.attacker.editorRevision);
  });

  it("carries each raw HP draft with Swap and restores the correct owner's cache", () => {
    let current = updateMatchupHP(prepared(), "attacker", "abc");
    current = updateMatchupHP(current, "defender", "2e1");
    const swapped = swapMatchup(current);
    expect(swapped.attacker.hpInput).toBe("2e1");
    expect(swapped.defender.hpInput).toBe("abc");
    const switched = selectRosterPokemon(swapped, "defender", choices().own[2]);
    expect(switched.defender.hpInput).toBe("");
    const restored = selectRosterPokemon(switched, "defender", choices().own[0]);
    expect(restored.defender.hpInput).toBe("abc");
    expect(restored.attacker.hpInput).toBe("2e1");
  });

  it("reseeds raw HP after explicit numeric and species replacements without losing outgoing prep", () => {
    const current = updateMatchupHP(prepared(), "attacker", "abc");
    const numeric = updateMatchupBuild(current, "attacker", { ...current.attacker.build, currentHP: 100 });
    expect(numeric.attacker.hpInput).toBe("100");
    const full = updateMatchupBuild(numeric, "attacker", { ...numeric.attacker.build, currentHP: null });
    expect(full.attacker.hpInput).toBe("");
    const manual = updateMatchupBuild(current, "attacker", createBuild("venusaur"));
    expect(manual.attacker.hpInput).toBe("");
    expect(manual.attacker.source).toBeNull();
    expect(selectRosterPokemon(manual, "attacker", choices().own[0]).attacker.hpInput).toBe("abc");
  });

  it("preserves detached HP text but clears drafts and their caches on Reset or account replacement", () => {
    const current = updateMatchupHP(prepared(), "defender", "2e1");
    const detached = reconcileRosters(current, { ...loaded(), opponentId: "" });
    expect(detached.defender.source).toBeNull();
    expect(detached.defender.hpInput).toBe("2e1");
    for (const fresh of [resetMatchup(current), reconcileRosters(current, { ...loaded(), userId: "new-account" })]) {
      expect(fresh.attacker.hpInput).toBe("");
      expect(fresh.defender.hpInput).toBe("");
      expect(fresh.defender.key).not.toBe(current.defender.key);
      expect(fresh.cache.size).toBe(0);
    }
  });

  it("restores edited builds including NaN without mutating prior states", () => {
    const { own } = choices();
    let current = selectMatchupMove(prepared(), "flamethrower");
    const edit = { ...current.attacker.build, currentHP: Number.NaN, points: { ...current.attacker.build.points, spa: 32, hp: null } };
    current = updateMatchupBuild(current, "attacker", edit);
    expect(current.attack.moveId).toBe("flamethrower");
    const before = structuredClone(current);
    const changed = selectRosterPokemon(current, "attacker", own[2]);
    const restored = selectRosterPokemon(changed, "attacker", own[0]);
    expect(restored.attacker.build).toBe(edit);
    expect(restored.attacker.build.currentHP).toBeNaN();
    expect(restored.attacker.build.points.hp).toBeNull();
    expect(changed.attack.moveId).toBeNull();
    expect(restored.attack.moveId).toBeNull();
    expect(current).toEqual(before);
    expect(changed.cache).not.toBe(current.cache);
    expect(restored.cache.get(own[0].source!.key)?.build).toBe(edit);
  });

  it("isolates same-species prep by owner and treats the active entry as a no-op", () => {
    const { own, other } = choices();
    let current = selectMatchupMove(prepared(), "flamethrower");
    current = updateMatchupBuild(current, "attacker", { ...current.attacker.build, nature: "Timid" });
    current.attacker.contexts = { bulletseed: { hits: 4 } };
    expect(selectRosterPokemon(current, "attacker", own[0])).toBe(current);
    expect(selectRosterPokemon(current, "defender", other[0])).toBe(current);
    expect(current.defender.build.nature).toBe("Serious");
    expect(current.attacker.source?.key).not.toBe(current.defender.source?.key);
    expect(selectRosterPokemon(current, "attacker", other[0])).toBe(current);
  });

  it.each(["attacker", "defender"] as const)("clears selection when a different %s roster entry is activated", (side) => {
    const current = selectMatchupMove(prepared(), "flamethrower");
    const choice = side === "attacker" ? choices().own[2] : choices().other[1];
    const next = selectRosterPokemon(current, side, choice);
    expect(next.attack.moveId).toBeNull();
    expect(next.revision).toBe(current.revision);
    expect(next.field).toBe(current.field);
  });

  it("gives a different same-species entry fresh editor identity without resetting result controls", () => {
    const state = loaded();
    state.data!.teams[0] = team("team-own", "member-own", ["Mega Charizard X", "Charizard-Mega-X"]);
    const { own } = choices(state);
    let current = reconcileRosters(createMatchup(3), state);
    current = selectRosterPokemon(current, "attacker", own[0]);
    current = updateMatchupBuild(current, "attacker", { ...current.attacker.build, currentHP: Number.NaN });
    current = selectMatchupMove(current, "flamethrower");
    current.attacker.contexts = { bulletseed: { hits: 4 } };
    const next = selectRosterPokemon(current, "attacker", own[1]);
    expect(next.attacker.build.speciesId).toBe(current.attacker.build.speciesId);
    expect(next.attacker.build.itemId).toBe("charizarditex");
    expect(next.attacker.editorRevision).toBeGreaterThan(current.attacker.editorRevision);
    expect(next.attacker.key).toBe(current.attacker.key);
    expect(next.revision).toBe(3);
    expect(next.attacker.contexts).toEqual({});
    expect(next.attack.moveId).toBeNull();
  });

  it("preserves every shared and side effect across roster activation and Swap", () => {
    let current = selectMatchupMove(prepared(), "flamethrower");
    for (const { key } of SHARED_FIELD_EFFECTS) current.field[key] = true;
    current.field.weather = "Snow";
    current.field.attackerSide.helpingHand = true;
    current.field.defenderSide.auroraVeil = true;
    current.attacker.contexts = { bulletseed: { hits: 4 } };
    current = selectRosterPokemon(current, "attacker", choices().own[1]);
    expect(current.attack.moveId).toBeNull();
    current = selectMatchupMove(current, "flamethrower");
    const swapped = swapMatchup(current);
    expect(swapped.attacker).toEqual({ ...current.defender, contexts: {}, moveEpoch: current.defender.moveEpoch + 1 });
    expect(swapped.defender).toEqual({ ...current.attacker, contexts: {}, moveEpoch: current.attacker.moveEpoch + 1 });
    expect(swapped.attacker.role).toBe("opponent");
    expect(swapped.defender.role).toBe("own");
    expect(swapped.defender.editorRevision).toBe(current.attacker.editorRevision);
    expect(swapped.field).toEqual({ ...current.field, attackerSide: current.field.defenderSide, defenderSide: current.field.attackerSide });
    expect(swapped.attacker.contexts).toEqual({});
    expect(swapped.attack.moveId).toBeNull();
    expect(swapped.cache).toBe(current.cache);
    expect(swapMatchup(swapped).attacker).toEqual({ ...current.attacker, contexts: {}, moveEpoch: current.attacker.moveEpoch + 2 });
  });

  it("changes the opponent-bound slot after Swap rather than assuming the right side", () => {
    const current = selectMatchupMove(swapMatchup(prepared()), "flamethrower");
    const state = { ...loaded(), opponentId: "member-empty" };
    const changed = reconcileRosters(current, state);
    expect(changed.attacker.source).toBeNull();
    expect(changed.attack.moveId).toBeNull();
    expect(changed.attacker.build).toBe(current.attacker.build);
    expect(changed.defender.source).toBe(current.defender.source);
    expect(changed.defender.role).toBe("own");
    expect(changed.field).toBe(current.field);
  });

  it.each(["attacker", "defender"] as const)("detaches a manual %s species change, but retains cached prep and normal edits' context", (side) => {
    let current = selectMatchupMove(prepared(), "flamethrower");
    current.attacker.contexts = { bulletseed: { hits: 3 } };
    const edited = updateMatchupBuild(current, side, { ...current[side].build, nature: "Timid" });
    expect(edited[side].source).toBe(current[side].source);
    expect(edited.attacker.contexts).toBe(current.attacker.contexts);
    expect(edited.attack.moveId).toBe("flamethrower");
    current = updateMatchupBuild(edited, side, createBuild("venusaur"));
    expect(current[side].source).toBeNull();
    expect(current.attacker.contexts).toEqual({});
    expect(current.attack.moveId).toBeNull();
    const choice = side === "attacker" ? choices().own[0] : choices().other[0];
    expect(selectRosterPokemon(current, side, choice)[side].build.nature).toBe("Timid");
  });

  it("preserves prep during refresh/error and invalidates removed entries only after success", () => {
    const current = selectMatchupMove(prepared(), "flamethrower");
    const state = loaded();
    const loading = { ...state, status: "loading" as const, data: null, teamsStatus: "idle" as const };
    expect(reconcileRosters(current, state)).toBe(current);
    expect(reconcileRosters(current, loading)).toBe(current);
    expect(reconcileRosters(current, { ...loading, status: "error", message: "Try again" })).toBe(current);
    expect(reconcileRosters(current, { ...state, teamsStatus: "loading", data: null })).toBe(current);
    expect(reconcileRosters(current, { ...state, teamsStatus: "error", teamsMessage: "Try again" })).toBe(current);
    state.data!.teams[0].pokemon.shift();
    const refreshed = reconcileRosters(current, state);
    expect(refreshed.attacker.build).toBe(current.attacker.build);
    expect(refreshed.attacker.source).toBeNull();
    expect(refreshed.attack.moveId).toBeNull();
    expect(refreshed.cache.has(current.attacker.source!.key)).toBe(false);
    expect(refreshed.defender).toEqual({ ...current.defender, contexts: {}, moveEpoch: current.defender.moveEpoch + 1 });
  });

  it("does not clear a selected move when a refresh only prunes inactive cached prep", () => {
    const { own } = choices();
    let current = selectRosterPokemon(prepared(), "attacker", own[1]);
    current = selectMatchupMove(selectRosterPokemon(current, "attacker", own[0]), "flamethrower");
    const state = loaded();
    state.data!.teams[0].pokemon.splice(1, 1);
    const refreshed = reconcileRosters(current, state);
    expect(refreshed.cache.has(own[1].source!.key)).toBe(false);
    expect(refreshed.attack.moveId).toBe("flamethrower");
    expect(refreshed.attacker.contexts).toBe(current.attacker.contexts);
    expect(refreshed.attacker).toBe(current.attacker);
    expect(refreshed.defender).toBe(current.defender);
    expect(refreshed.revision).toBe(current.revision);
  });

  it("invalidates changed acquisitions, duplicate teams and duplicate entry identities", () => {
    for (const corrupt of ["acquisition", "team", "name"] as const) {
      const current = selectMatchupMove(prepared(), "flamethrower");
      const state = loaded();
      const own = state.data!.teams[0];
      if (corrupt === "acquisition") own.pokemon[0] = { ...own.pokemon[0], acquired: "free_agent", pick_number: null };
      if (corrupt === "team") state.data!.teams.push({ ...own, id: "second-roster" });
      if (corrupt === "name") own.pokemon.push({ ...own.pokemon[0] });
      const refreshed = reconcileRosters(current, state);
      expect(refreshed.attacker.source).toBeNull();
      expect(refreshed.attack.moveId).toBeNull();
      expect(refreshed.cache.has(current.attacker.source!.key)).toBe(false);
    }
  });

  it("keeps cache scoped when switching leagues and prunes revoked memberships", () => {
    const current = selectMatchupMove(prepared(), "flamethrower");
    const state = { ...loaded(), selectedLeagueId: "league-b", opponentId: "", data: null, teamsStatus: "loading" as const };
    const changed = reconcileRosters(current, state);
    expect(changed.attack.moveId).toBeNull();
    expect(changed.attacker.source).toBeNull();
    expect(changed.defender.source).toBeNull();
    expect(changed.attacker.build).toBe(current.attacker.build);
    expect(changed.cache).toBe(current.cache);
    expect(selectRosterPokemon(changed, "attacker", choices().own[0])).toBe(changed);
    const revoked = reconcileRosters(changed, { ...state, leagues: [state.leagues[1]] });
    expect(revoked.cache.size).toBe(0);
  });

  it("clears move selection on navigation even without a roster-bound combatant", () => {
    const current = selectMatchupMove(reconcileRosters(createMatchup(), loaded()), "flamethrower");
    const next = reconcileRosters(current, { ...loaded(), opponentId: "member-empty" });
    expect(next.attack.moveId).toBeNull();
    expect(next.attacker).toEqual({ ...current.attacker, contexts: {}, moveEpoch: current.attacker.moveEpoch + 1 });
    expect(next.defender).toEqual({ ...current.defender, contexts: {}, moveEpoch: current.defender.moveEpoch + 1 });
    expect(next.cache).toBe(current.cache);
    expect(next.revision).toBe(current.revision);
  });

  it("clears private prep and announcements on account replacement or signout, not the first auth lookup", () => {
    const manual = selectMatchupMove(createMatchup(), "flamethrower");
    const firstLookup = reconcileRosters(manual, { ...loaded(), status: "loading", leagues: [], selectedLeagueId: "", opponentId: "", data: null, teamsStatus: "idle" });
    expect(firstLookup.attack.moveId).toBe("flamethrower");
    expect(firstLookup.attacker).toBe(manual.attacker);
    expect(firstLookup.revision).toBe(manual.revision);
    const current = selectMatchupMove(prepared(), "flamethrower");
    expect(current.notice).toContain("Charizard selected as Right Pokémon");
    for (const userId of ["different-account", null]) {
      const next = reconcileRosters(current, { ...loaded(), status: userId ? "loading" : "signed-out", userId, leagues: [], selectedLeagueId: "", opponentId: "", data: null, teamsStatus: "idle" });
      expect(next.cache.size).toBe(0);
      expect(next.attack.moveId).toBeNull();
      expect(next.attacker.contexts).toEqual({});
      expect(next.notice).toBe("");
      expect(next.attacker.source).toBeNull();
      expect(next.defender.source).toBeNull();
      expect(next.attacker.build).toEqual(createBuild("charizard"));
      expect(next.accountId).toBe(userId);
      expect(next.revision).toBeGreaterThan(current.revision);
      expect(reconcileRosters(next, loaded()).notice).toBe("");
    }
  });

  it("keeps announcements atomic with activation, cache restoration, Swap and Reset", () => {
    const { own } = choices();
    const current = prepared();
    const different = selectRosterPokemon(current, "attacker", own[2]);
    expect(different.notice).toContain("Blastoise selected as Left Pokémon");
    expect(different.notice).toContain("Default build loaded");
    const restored = selectRosterPokemon(different, "attacker", own[0]);
    expect(restored.notice).toContain("Your session build edits were restored");
    expect(selectRosterPokemon(restored, "attacker", own[0])).toBe(restored);
    expect(swapMatchup(restored).notice).toContain("Left and Right Pokémon swapped");
    expect(resetMatchup(restored).notice).toContain("Session build edits cleared");
  });

  it("reset clears prep and effects while keeping navigation and restoring own-left orientation", () => {
    const current = selectMatchupMove(swapMatchup(prepared()), "flamethrower");
    current.field.gravity = true;
    current.attacker.contexts = { bulletseed: { hits: 3 } };
    const reset = resetMatchup(current);
    expect(reset.attack.moveId).toBeNull();
    expect(reset.attacker.contexts).toEqual({});
    expect(reset.selection).toBe(current.selection);
    expect(reset.accountId).toBe(current.accountId);
    expect(reset.cache.size).toBe(0);
    expect(reset.attacker.role).toBe("own");
    expect(reset.defender.role).toBe("opponent");
    expect(reset.attacker.source).toBeNull();
    expect(reset.attacker.build).toEqual(createBuild("charizard"));
    expect(reset.defender.build).toEqual(createBuild("blastoise"));
    expect(reset.field).toEqual(createConditions());
    expect(reset.revision).toBe(current.revision + 1);
    expect(reset.attacker.key).not.toBe(current.defender.key);
  });
});

describe("calculator team sources", () => {
  function sourceHtml(pane: "own" | "opponent", state = loaded()) {
    return renderToStaticMarkup(pane === "own"
      ? createElement(MyTeamPicker, { state, onLeagueChange: () => undefined, onRefresh: () => undefined })
      : createElement(OpponentPicker, { state, onOpponentChange: () => undefined, onRefresh: () => undefined }));
  }

  function options(html: string) {
    return [...html.matchAll(/<option\b([^>]*)>([^<]*)<\/option>/g)].map(([, attributes, label]) => ({
      value: attributes.match(/\bvalue="([^"]*)"/)![1], label, selected: attributes.includes('selected=""'),
    }));
  }

  it("associates each pane's one native selector with its own label and help", () => {
    const state = loaded();
    const html = renderToStaticMarkup(createElement("div", null,
      createElement(MyTeamPicker, { state, onLeagueChange: () => undefined, onRefresh: () => undefined }),
      createElement(OpponentPicker, { state, onOpponentChange: () => undefined, onRefresh: () => undefined }),
    ));
    assertLabels(html);
    const labels = [...html.matchAll(/<label\b[^>]*for="([^"]+)"[^>]*>(My team|Opponent)<\/label>/g)];
    expect(labels.map(([, , label]) => label)).toEqual(["My team", "Opponent"]);
    const selects = html.match(/<select\b[^>]*>/g)!;
    expect(selects).toHaveLength(2);
    labels.forEach(([, id], index) => {
      expect(selects[index]).toContain(`id="${id}"`);
      expect(selects[index]).toContain(`aria-describedby="${id}-help"`);
    });
  });

  it("shows own team and league labels while selecting only existing league IDs", () => {
    const state = { ...loaded(), selectedLeagueId: "league-b" };
    const html = sourceHtml("own", state);
    expect(options(html)).toEqual([
      { value: "", label: "Choose your team", selected: false },
      { value: "league-a", label: "Home — Alpha", selected: false },
      { value: "league-b", label: "Home B — Beta", selected: true },
    ]);
    expect(html.match(/<select\b/g)).toHaveLength(1);
    expect(html).not.toContain('value="member-own');
    expect(html).not.toContain('value="team-own');
    expect(html).not.toContain("Choose an opponent");
  });

  it("disambiguates only exactly duplicate full own-team labels, including unnamed teams", () => {
    const state = loaded();
    const entries = [
      ["league-a", "Home", "Alpha"], ["league-copy", " Home ", "Alpha"],
      ["league-b", "Home", "Beta"], ["league-away", "Away", "Alpha"],
      ["league-unnamed", null, "Gamma"], ["league-blank", "  ", "Gamma"],
      ["league-case", "home", "Alpha"],
    ] as const;
    state.leagues = entries.map(([id, teamName, name], index) => ({ ...state.leagues[0], id, memberId: `member-${index}`, teamName, name }));
    state.selectedLeagueId = "league-copy";
    const rendered = options(sourceHtml("own", state));
    expect(rendered.map(({ value }) => value)).toEqual(["", ...entries.map(([id]) => id)]);
    expect(rendered.slice(1).map(({ label }) => label)).toEqual([
      "Home — Alpha (league 1)", "Home — Alpha (league 2)", "Home — Beta", "Away — Alpha",
      "Unnamed team — Gamma (league 5)", "Unnamed team — Gamma (league 6)", "home — Alpha",
    ]);
    expect(rendered.filter(({ selected }) => selected).map(({ value }) => value)).toEqual(["league-copy"]);
  });

  it("keeps both controls controlled and forwards exact IDs and empty choices without selecting on render", () => {
    const state = loaded();
    const onLeagueChange = vi.fn();
    const onOpponentChange = vi.fn();
    const onRefresh = vi.fn();
    const select = vi.spyOn(selectControl, "default");
    try {
      renderToStaticMarkup(createElement(MyTeamPicker, { state, onLeagueChange, onRefresh }));
      renderToStaticMarkup(createElement(OpponentPicker, { state, onOpponentChange, onRefresh }));
      expect(onLeagueChange).not.toHaveBeenCalled();
      expect(onOpponentChange).not.toHaveBeenCalled();
      expect(onRefresh).not.toHaveBeenCalled();
      const [own, opponent] = select.mock.calls.map(([props]) => props);
      expect(own.value).toBe("league-a");
      expect(opponent.value).toBe("member-other");
      for (const value of ["league-b", ""]) own.onChange!({ target: { value } } as ChangeEvent<HTMLSelectElement>);
      for (const value of ["member-empty", ""]) opponent.onChange!({ target: { value } } as ChangeEvent<HTMLSelectElement>);
      expect(onLeagueChange.mock.calls).toEqual([["league-b"], [""]]);
      expect(onOpponentChange.mock.calls).toEqual([["member-empty"], [""]]);
      expect(state.selectedLeagueId).toBe("league-a");
      expect(state.opponentId).toBe("member-other");
    } finally {
      select.mockRestore();
    }
  });

  it("explains an empty own selection without auto-selecting and directs the opponent pane to My team", () => {
    const state = { ...loaded(), selectedLeagueId: "", opponentId: "", teamsStatus: "idle" as const, data: null };
    const own = sourceHtml("own", state);
    expect(options(own).filter(({ selected }) => selected).map(({ value }) => value)).toEqual([""]);
    expect(own).toContain("Choose your team above to load its league roster.");
    expect(own.match(/<select\b[^>]*>/)![0]).not.toContain('disabled=""');
    const opponent = sourceHtml("opponent", state);
    expect(opponent).toContain("Choose your team in the My team tab");
    expect(opponent).not.toContain("There are no other members");
    expect(options(opponent)).toEqual([{ value: "", label: "Choose an opponent", selected: true }]);
    expect(opponent.match(/<select\b[^>]*>/)![0]).toContain('disabled=""');
  });

  it("shows the selected own-team and league context with opponents that lack finalized rosters", () => {
    const html = sourceHtml("opponent");
    expect(html).toMatch(/<dt[^>]*>Your team<\/dt><dd[^>]*>Home<\/dd>/);
    expect(html).toMatch(/<dt[^>]*>League<\/dt><dd[^>]*>Alpha<\/dd>/);
    expect(options(html)).toEqual([
      { value: "", label: "Choose an opponent", selected: false },
      { value: "member-other", label: "Away", selected: true },
      { value: "member-empty", label: "No roster yet", selected: false },
    ]);
    expect(html.match(/<select\b/g)).toHaveLength(1);
    expect(html).not.toContain('value="member-own"');
    expect(html).not.toContain('value="league-a"');
    expect(html).not.toContain('value="team-other"');
  });

  it("preserves sorted opponent names, member-ID tie breaks and duplicate/unnamed labels", () => {
    const state = loaded();
    const member = state.data!.members[1];
    state.leagues[0].teamName = "  ";
    state.leagues[0].draftCompleted = false;
    state.data!.members = [
      { ...state.data!.members[0], team_name: "Alpha" },
      { ...member, id: "member-z", team_name: "Twin" }, { ...member, id: "member-a", team_name: " Twin " },
      { ...member, id: "member-null", team_name: null }, { ...member, id: "member-blank", team_name: " " },
      { ...member, id: "member-alpha", team_name: "Alpha" },
    ];
    state.data!.teams = [];
    state.opponentId = "member-z";
    const html = sourceHtml("opponent", state);
    expect(html).toMatch(/<dt[^>]*>Your team<\/dt><dd[^>]*>Unnamed team<\/dd>/);
    expect(options(html).slice(1)).toEqual([
      { value: "member-alpha", label: "Alpha", selected: false },
      { value: "member-a", label: "Twin (team 2)", selected: false },
      { value: "member-z", label: "Twin (team 3)", selected: true },
      { value: "member-blank", label: "Unnamed team (team 4)", selected: false },
      { value: "member-null", label: "Unnamed team (team 5)", selected: false },
    ]);
    state.data!.members = [state.data!.members[0], { ...member, id: "member-upper", team_name: "AWAY" }, { ...member, id: "member-lower", team_name: "away" }];
    expect(options(sourceHtml("opponent", state)).slice(1).every(({ label }) => /^away \(team [12]\)$/i.test(label))).toBe(true);
  });

  it.each([
    ["no own selection", { selectedLeagueId: "" }],
    ["unknown league", { selectedLeagueId: "league-removed" }],
    ["stale league data", { selectedLeagueId: "league-b" }],
    ["account loading", { status: "loading" }],
    ["account failure", { status: "error" }],
    ["idle rosters", { teamsStatus: "idle" }],
    ["loading rosters", { teamsStatus: "loading" }],
    ["failed rosters", { teamsStatus: "error" }],
    ["missing data", { data: null }],
  ] satisfies [string, Partial<CalculatorRosterState>][])("hides and disables dependent opponents for %s", (_, patch) => {
    const html = sourceHtml("opponent", { ...loaded(), ...patch });
    expect(options(html)).toEqual([{ value: "", label: "Choose an opponent", selected: true }]);
    expect(html.match(/<select\b[^>]*>/)![0]).toContain('disabled=""');
    expect(html).not.toContain("There are no other members");
  });

  it("uses only the current league's member IDs after its roster data is ready", () => {
    const state = loaded();
    state.selectedLeagueId = "league-b";
    state.opponentId = "member-other-b";
    state.data = {
      leagueId: "league-b", teams: [], members: [
        { ...state.data!.members[0], id: "member-own-b", team_name: "Home B" },
        { ...state.data!.members[1], id: "member-other-b", team_name: "Away B" },
      ],
    };
    const html = sourceHtml("opponent", state);
    expect(html).toMatch(/<dt[^>]*>Your team<\/dt><dd[^>]*>Home B<\/dd>/);
    expect(html).toMatch(/<dt[^>]*>League<\/dt><dd[^>]*>Beta<\/dd>/);
    expect(options(html)).toEqual([
      { value: "", label: "Choose an opponent", selected: false },
      { value: "member-other-b", label: "Away B", selected: true },
    ]);
    expect(html.match(/<select\b[^>]*>/)![0]).not.toContain('disabled=""');
  });

  it.each(["", "member-own", "member-removed"])("uses the opponent placeholder rather than an invalid selection: %s", (opponentId) => {
    const html = sourceHtml("opponent", { ...loaded(), opponentId });
    expect(options(html).filter(({ selected }) => selected).map(({ value }) => value)).toEqual([""]);
    expect(html.match(/<select\b[^>]*>/)![0]).not.toContain('disabled=""');
  });

  it("explains when the current league has no other members", () => {
    const state = loaded();
    state.data!.members = [state.data!.members[0]];
    const html = sourceHtml("opponent", state);
    expect(options(html)).toEqual([{ value: "", label: "Choose an opponent", selected: true }]);
    expect(html.match(/<select\b[^>]*>/)![0]).toContain('disabled=""');
    expect(html).toContain("There are no other members in this league yet.");
  });

  it.each(["own", "opponent"] as const)("keeps %s source refresh and selection guards during loading", (pane) => {
    for (const phase of ["account", "rosters"] as const) {
      const state = loaded();
      if (phase === "account") state.status = "loading";
      else state.teamsStatus = "loading";
      const html = sourceHtml(pane, state);
      expect(html).toContain(phase === "account" ? "Loading your leagues…" : "Loading current team rosters…");
      expect(html).toContain("You can still edit the calculator.");
      expect(html.match(/<button\b[^>]*>/)![0]).toContain('disabled=""');
      expect(html.match(/<select\b[^>]*>/)![0].includes('disabled=""')).toBe(pane === "opponent" || phase === "account");
    }
  });

  it.each(["own", "opponent"] as const)("preserves %s source errors and an enabled Retry action", (pane) => {
    for (const patch of [
      { status: "error" as const, message: "Membership lookup failed." },
      { teamsStatus: "error" as const, teamsMessage: "Roster lookup failed." },
      { teamsStatus: "error" as const },
    ]) {
      const html = sourceHtml(pane, { ...loaded(), ...patch });
      expect(html).toContain("League teams unavailable");
      expect(html).toContain(patch.message ?? patch.teamsMessage ?? "Could not load league teams.");
      expect(html).toContain("Retry teams");
      expect(html).toContain("Your manual calculator remains available");
      expect(html.match(/<button\b[^>]*>/)![0]).not.toContain('disabled=""');
      assertLabels(html);
    }
  });

  it.each(["own", "opponent"] as const)("preserves %s source signed-out and no-leagues explanations", (pane) => {
    const state = { ...loaded(), leagues: [], selectedLeagueId: "", opponentId: "", teamsStatus: "idle" as const, data: null };
    const signedOut = sourceHtml(pane, { ...state, status: "signed-out", userId: null });
    expect(signedOut).toContain("Sign in to see your leagues");
    expect(signedOut).toContain('href="/login?next=%2Fcalculator"');
    expect(signedOut).toContain("Log in again");
    expect(signedOut).toContain("You can keep using manual Pokémon selection.");
    expect(signedOut).not.toContain("No leagues yet");
    expect(signedOut.match(/<select\b[^>]*>/)![0]).toContain('disabled=""');
    const noLeagues = sourceHtml(pane, state);
    expect(noLeagues).toContain("No leagues yet. Join or create a league from your dashboard");
    expect(noLeagues.match(/<select\b[^>]*>/)![0]).toContain('disabled=""');
    expect(noLeagues).not.toContain("There are no other members");
    assertLabels(signedOut);
    assertLabels(noLeagues);
  });

  it.each(["own", "opponent"] as const)("keeps %s source caveats and refresh without duplicating roster pickers", (pane) => {
    const html = sourceHtml(pane);
    expect(html).toContain("Refresh teams");
    expect(html).toContain("Rosters provide Pokémon names, not saved sets.");
    expect(html).toContain("New selections use editable default builds");
    expect(html).toContain("draft costs are not Stat Points");
    expect(html).toContain("Build edits stay in this page session only and never change a league roster.");
    expect(html).not.toContain("data-calculator-roster");
    expect(html).not.toContain("data-roster-choice");
    expect(html).not.toContain("in Teams");
  });
});

describe("league matchup UI", () => {
  it.each(["inline", "rail"] as const)("exposes active states, unavailable reasons and unsupported inspection in the %s variant", (variant) => {
    const state = loaded();
    state.data!.teams[0].pokemon.push({ name: "Custom mascot", points: 2, tier: 1 }, { name: "Lucario-Mega-Z", points: 20, tier: 1 });
    const own = choices(state).own;
    const html = renderToStaticMarkup(createElement(RosterPicker, { state, role: "own", side: "attacker", activeSource: own[0].source, onSelect: () => undefined, variant }));
    assertLabels(html);
    expect([...html.matchAll(/aria-pressed="true"/g)]).toHaveLength(1);
    expect(html).toContain("Your team");
    expect(html).toContain("Left Pokémon");
    expect(html).toMatch(/<button\b[^>]*disabled=""[^>]*aria-pressed="false"[^>]*aria-label="Use Custom mascot/);
    const unsupported = html.match(/<button\b[^>]*aria-label="Use Lucario-Mega-Z[^>]*>/)?.[0];
    expect(unsupported).toBeDefined();
    expect(unsupported).not.toContain('disabled=""');
    expect(html).toContain("No exact Champions match");
    expect(html).toContain("Unsupported · inspect build");
  });

  it("defaults to the unchanged compact inline layout without sprites", () => {
    const props = { state: loaded(), role: "own" as const, side: "attacker" as const, activeSource: null, onSelect: () => undefined };
    const html = renderToStaticMarkup(createElement(RosterPicker, props));
    expect(html).toBe(renderToStaticMarkup(createElement(RosterPicker, { ...props, variant: "inline" })));
    expect(html).toContain('class="mt-4 rounded-lg border border-line bg-bg p-3"');
    expect(html).toContain('<ul aria-label="Your team left roster" class="mt-3 grid gap-2 sm:grid-cols-2">');
    expect(html).toMatch(/<button\b[^>]*><span class="flex flex-wrap items-baseline justify-between gap-1">/);
    expect(html).not.toContain("h-10 w-10");
    assertLabels(html);
  });

  it.each(["inline", "rail"] as const)("provides stable focus hooks and unique labelled headings and reasons for %s pickers", (variant) => {
    const state = loaded();
    for (const roster of state.data!.teams) {
      roster.pokemon.push({ name: "Custom mascot", points: 2, tier: 1 }, { name: "Lucario-Mega-Z", points: 20, tier: 1 });
    }
    const { own, other } = choices(state);
    const html = renderToStaticMarkup(createElement("div", null,
      createElement(RosterPicker, { state, role: "own", side: "attacker", activeSource: null, onSelect: () => undefined, pickerId: "attacker-roster", variant }),
      createElement(RosterPicker, { state, role: "opponent", side: "defender", activeSource: null, onSelect: () => undefined, pickerId: "defender-roster", variant }),
    ));
    expect(html).toContain('<div id="attacker-roster" data-calculator-roster="attacker"');
    expect(html).toContain('<div id="defender-roster" data-calculator-roster="defender"');
    expect([...html.matchAll(/data-roster-choice="([^"]+)"/g)].map((match) => match[1]))
      .toEqual([...own, ...other].map((choice) => choice.key.replaceAll('"', "&quot;")));
    expect([...html.matchAll(/aria-labelledby="[^"]+-heading"/g)]).toHaveLength(2);
    const reasonIds = [...html.matchAll(/aria-describedby="([^"]+)"/g)].map((match) => match[1]);
    expect(reasonIds).toHaveLength(4);
    expect(new Set(reasonIds).size).toBe(4);
    for (const id of reasonIds) expect(html).toContain(`<p id="${id}"`);
    assertLabels(html);
  });

  it("stacks full-width rail cards with wrapping labels, team names and at least 44px targets", () => {
    const state = loaded();
    const teamName = "AnExtremelyLongUnbrokenTeamNameThatMustFitTheSidebar";
    const rosterName = "AnExtremelyLongUnresolvedRosterNameThatMustAlsoWrap";
    state.data!.members[0].team_name = teamName;
    state.data!.teams[0].pokemon.push({ name: rosterName, points: 1, tier: 1 });
    const html = renderToStaticMarkup(createElement(RosterPicker, { state, role: "own", side: "attacker", activeSource: choices(state).own[0].source, onSelect: () => undefined, variant: "rail" }));
    expect(html).toContain('class="min-w-0 rounded-lg border border-line bg-bg p-3"');
    expect(html).not.toContain("mt-4");
    expect(html).toContain('<ul aria-label="Your team left roster" class="mt-3 grid grid-cols-1 gap-2">');
    expect(html).not.toContain("sm:grid-cols-2");
    expect(html).toContain(`<span class="max-w-full wrap-anywhere text-xs text-muted">${teamName}</span>`);
    expect(html).toContain(`<span class="wrap-anywhere font-medium">${rosterName}</span>`);
    const buttons = [...html.matchAll(/<button\b[^>]*>/g)];
    expect(buttons).toHaveLength(4);
    for (const [button] of buttons) expect(button).toContain("min-h-11 w-full");
    expect(html).toMatch(/<span class="shrink-0 [^"]+">Active<\/span>/);
    expect(html).toContain("Fire");
    expect(html).toContain("Flying");
  });

  it.each(["inline", "rail"] as const)("keeps %s activation bound to source identity rather than a shared species", (variant) => {
    const state = loaded();
    state.data!.teams[0] = team("team-own", "member-own", ["Mega Charizard X", "Charizard-Mega-X"]);
    const own = choices(state).own;
    const html = renderToStaticMarkup(createElement(RosterPicker, { state, role: "own", side: "attacker", activeSource: own[1].source, onSelect: () => undefined, variant }));
    const buttons = html.match(/<button\b[\s\S]*?<\/button>/g)!;
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toContain('aria-pressed="false"');
    expect(buttons[0]).not.toContain("Active");
    expect(buttons[1]).toContain('aria-pressed="true"');
    expect(buttons[1]).toContain("Active");
    expect(html).not.toContain('disabled=""');
  });

  it("uses decorative 40px sprite fallbacks only for resolved rail species, including unsupported forms", () => {
    const state = loaded();
    state.data!.teams[0] = team("team-own", "member-own", ["Mega Charizard X", "Lucario-Mega-Z", "Custom mascot"]);
    const props = { state, role: "own" as const, side: "attacker" as const, activeSource: null, onSelect: () => undefined };
    const sprite = vi.spyOn(pokemonSprite, "default");
    try {
      renderToStaticMarkup(createElement(RosterPicker, props));
      expect(sprite).not.toHaveBeenCalled();
      const html = renderToStaticMarkup(createElement(RosterPicker, { ...props, variant: "rail" }));
      expect(sprite.mock.calls.map(([props]) => ({ name: props.name, size: props.size }))).toEqual([
        { name: "Charizard-Mega-X", size: "md" },
        { name: "Lucario-Mega-Z", size: "md" },
      ]);
      const buttons = html.match(/<button\b[\s\S]*?<\/button>/g)!;
      for (const button of buttons.slice(0, 2)) {
        expect(button).toMatch(/<span aria-hidden="true" class="shrink-0"><div aria-hidden="true" class="h-10 w-10 [^"]*animate-pulse/);
      }
      expect(buttons[2]).not.toContain("h-10 w-10");
      expect(html).not.toContain("<img");
    } finally {
      sprite.mockRestore();
    }
  });

  it("distinguishes pending, failed, incomplete-draft, missing and empty rosters", () => {
    const state = loaded();
    expect(getRosterPanel({ ...state, status: "loading" }, "own").status).toBe("loading");
    expect(getRosterPanel({ ...state, teamsStatus: "error" }, "own").status).toBe("error");
    expect(getRosterPanel({ ...state, opponentId: "" }, "opponent").message).toContain("Choose a team in Opponent");
    expect(getRosterPanel({ ...state, opponentId: "member-empty" }, "opponent").message).toContain("No finalized roster");
    state.data!.teams[0].pokemon = [];
    expect(getRosterPanel(state, "own").message).toContain("current roster is empty");
    state.leagues[0].draftCompleted = false;
    expect(getRosterPanel(state, "own").message).toContain("draft is not complete");
  });

  it("moves roster ownership labels with damage direction and does not highlight every unresolved name", () => {
    const state = loaded();
    state.data!.teams[1].pokemon.push({ name: "Unknown opponent form", points: 1, tier: 1 });
    const current = swapMatchup(prepared());
    const html = renderToStaticMarkup(createElement(RosterPicker, { state, role: current.attacker.role, side: "attacker", activeSource: null, onSelect: () => undefined }));
    expect(html).toContain("Opponent&#x27;s team");
    expect(html).toContain("Left Pokémon");
    expect(html).not.toContain('aria-pressed="true"');
    assertLabels(html);
  });
});
