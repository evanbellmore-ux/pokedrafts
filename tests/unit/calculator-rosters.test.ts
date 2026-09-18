import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import LeagueMatchupPicker, { RosterPicker } from "@/app/(app)/calculator/LeagueMatchupPicker";
import * as pokemonSprite from "@/app/components/PokemonSprite";
import {
  createMatchup, createSpeciesResolver, getRosterPanel, reconcileRosters, resetMatchup,
  resolveRosterSpecies, rosterChoices, selectMatchupMove, selectRosterPokemon, swapMatchup, updateMatchupBuild,
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
    expect(createMatchup().selectedMoveId).toBeNull();
    const current = prepared();
    current.contexts = { bulletseed: { hits: 4 } };
    const before = structuredClone(current);
    const selected = selectMatchupMove(current, "flamethrower");
    expect(selected).toEqual({ ...current, selectedMoveId: "flamethrower" });
    for (const key of ["revision", "notice", "accountId", "selection", "attacker", "defender", "field", "contexts", "cache"] as const) {
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
      expect(selectMatchupMove(current, id).selectedMoveId).toBe(id);
    }
    const cleared = selectMatchupMove(selected, null);
    expect(cleared).toEqual(current);
    expect(selectMatchupMove(cleared, null)).toBe(cleared);
    expect(cleared.cache).toBe(selected.cache);
    expect(cleared.contexts).toBe(selected.contexts);
  });

  it("validates selection against the current attacker, not a previous or global learnset", () => {
    const selected = selectMatchupMove(createMatchup(), "flamethrower");
    const swapped = swapMatchup(selected);
    expect(swapped.selectedMoveId).toBeNull();
    expect(selectMatchupMove(swapped, "flamethrower")).toBe(swapped);
    expect(selectMatchupMove(swapped, "surf").selectedMoveId).toBe("surf");
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
    expect(selected.defender).toBe(manual.defender);
  });

  it("restores edited builds including NaN without mutating prior states", () => {
    const { own } = choices();
    let current = selectMatchupMove(prepared(), "flamethrower");
    const edit = { ...current.attacker.build, currentHP: Number.NaN, points: { ...current.attacker.build.points, spa: 32, hp: null } };
    current = updateMatchupBuild(current, "attacker", edit);
    expect(current.selectedMoveId).toBe("flamethrower");
    const before = structuredClone(current);
    const changed = selectRosterPokemon(current, "attacker", own[2]);
    const restored = selectRosterPokemon(changed, "attacker", own[0]);
    expect(restored.attacker.build).toBe(edit);
    expect(restored.attacker.build.currentHP).toBeNaN();
    expect(restored.attacker.build.points.hp).toBeNull();
    expect(changed.selectedMoveId).toBeNull();
    expect(restored.selectedMoveId).toBeNull();
    expect(current).toEqual(before);
    expect(changed.cache).not.toBe(current.cache);
    expect(restored.cache.get(own[0].source!.key)?.build).toBe(edit);
  });

  it("isolates same-species prep by owner and treats the active entry as a no-op", () => {
    const { own, other } = choices();
    let current = selectMatchupMove(prepared(), "flamethrower");
    current = updateMatchupBuild(current, "attacker", { ...current.attacker.build, nature: "Timid" });
    current.contexts = { bulletseed: { hits: 4 } };
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
    expect(next.selectedMoveId).toBeNull();
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
    current.contexts = { bulletseed: { hits: 4 } };
    const next = selectRosterPokemon(current, "attacker", own[1]);
    expect(next.attacker.build.speciesId).toBe(current.attacker.build.speciesId);
    expect(next.attacker.build.itemId).toBe("charizarditex");
    expect(next.attacker.editorRevision).toBeGreaterThan(current.attacker.editorRevision);
    expect(next.attacker.key).toBe(current.attacker.key);
    expect(next.revision).toBe(3);
    expect(next.contexts).toEqual({});
    expect(next.selectedMoveId).toBeNull();
  });

  it("preserves every shared and side effect across roster activation and Swap", () => {
    let current = selectMatchupMove(prepared(), "flamethrower");
    for (const { key } of SHARED_FIELD_EFFECTS) current.field[key] = true;
    current.field.weather = "Snow";
    current.field.attackerSide.helpingHand = true;
    current.field.defenderSide.auroraVeil = true;
    current.contexts = { bulletseed: { hits: 4 } };
    current = selectRosterPokemon(current, "attacker", choices().own[1]);
    expect(current.selectedMoveId).toBeNull();
    current = selectMatchupMove(current, "flamethrower");
    const swapped = swapMatchup(current);
    expect(swapped.attacker).toBe(current.defender);
    expect(swapped.defender).toBe(current.attacker);
    expect(swapped.attacker.role).toBe("opponent");
    expect(swapped.defender.role).toBe("own");
    expect(swapped.defender.editorRevision).toBe(current.attacker.editorRevision);
    expect(swapped.field).toEqual({ ...current.field, attackerSide: current.field.defenderSide, defenderSide: current.field.attackerSide });
    expect(swapped.contexts).toEqual({});
    expect(swapped.selectedMoveId).toBeNull();
    expect(swapped.cache).toBe(current.cache);
    expect(swapMatchup(swapped).attacker).toBe(current.attacker);
  });

  it("changes the opponent-bound slot after Swap rather than assuming the right side", () => {
    const current = selectMatchupMove(swapMatchup(prepared()), "flamethrower");
    const state = { ...loaded(), opponentId: "member-empty" };
    const changed = reconcileRosters(current, state);
    expect(changed.attacker.source).toBeNull();
    expect(changed.selectedMoveId).toBeNull();
    expect(changed.attacker.build).toBe(current.attacker.build);
    expect(changed.defender.source).toBe(current.defender.source);
    expect(changed.defender.role).toBe("own");
    expect(changed.field).toBe(current.field);
  });

  it.each(["attacker", "defender"] as const)("detaches a manual %s species change, but retains cached prep and normal edits' context", (side) => {
    let current = selectMatchupMove(prepared(), "flamethrower");
    current.contexts = { bulletseed: { hits: 3 } };
    const edited = updateMatchupBuild(current, side, { ...current[side].build, nature: "Timid" });
    expect(edited[side].source).toBe(current[side].source);
    expect(edited.contexts).toBe(current.contexts);
    expect(edited.selectedMoveId).toBe("flamethrower");
    current = updateMatchupBuild(edited, side, createBuild("venusaur"));
    expect(current[side].source).toBeNull();
    expect(current.contexts).toEqual({});
    expect(current.selectedMoveId).toBeNull();
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
    expect(refreshed.selectedMoveId).toBeNull();
    expect(refreshed.cache.has(current.attacker.source!.key)).toBe(false);
    expect(refreshed.defender).toBe(current.defender);
  });

  it("does not clear a selected move when a refresh only prunes inactive cached prep", () => {
    const { own } = choices();
    let current = selectRosterPokemon(prepared(), "attacker", own[1]);
    current = selectMatchupMove(selectRosterPokemon(current, "attacker", own[0]), "flamethrower");
    const state = loaded();
    state.data!.teams[0].pokemon.splice(1, 1);
    const refreshed = reconcileRosters(current, state);
    expect(refreshed.cache.has(own[1].source!.key)).toBe(false);
    expect(refreshed.selectedMoveId).toBe("flamethrower");
    expect(refreshed.contexts).toBe(current.contexts);
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
      expect(refreshed.selectedMoveId).toBeNull();
      expect(refreshed.cache.has(current.attacker.source!.key)).toBe(false);
    }
  });

  it("keeps cache scoped when switching leagues and prunes revoked memberships", () => {
    const current = selectMatchupMove(prepared(), "flamethrower");
    const state = { ...loaded(), selectedLeagueId: "league-b", opponentId: "", data: null, teamsStatus: "loading" as const };
    const changed = reconcileRosters(current, state);
    expect(changed.selectedMoveId).toBeNull();
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
    expect(next.selectedMoveId).toBeNull();
    expect(next.attacker).toBe(current.attacker);
    expect(next.defender).toBe(current.defender);
    expect(next.cache).toBe(current.cache);
    expect(next.revision).toBe(current.revision);
  });

  it("clears private prep and announcements on account replacement or signout, not the first auth lookup", () => {
    const manual = selectMatchupMove(createMatchup(), "flamethrower");
    const firstLookup = reconcileRosters(manual, { ...loaded(), status: "loading", leagues: [], selectedLeagueId: "", opponentId: "", data: null, teamsStatus: "idle" });
    expect(firstLookup.selectedMoveId).toBe("flamethrower");
    expect(firstLookup.attacker).toBe(manual.attacker);
    expect(firstLookup.revision).toBe(manual.revision);
    const current = selectMatchupMove(prepared(), "flamethrower");
    expect(current.notice).toContain("Charizard selected as defender");
    for (const userId of ["different-account", null]) {
      const next = reconcileRosters(current, { ...loaded(), status: userId ? "loading" : "signed-out", userId, leagues: [], selectedLeagueId: "", opponentId: "", data: null, teamsStatus: "idle" });
      expect(next.cache.size).toBe(0);
      expect(next.selectedMoveId).toBeNull();
      expect(next.contexts).toEqual({});
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
    expect(different.notice).toContain("Blastoise selected as attacker");
    expect(different.notice).toContain("Default build loaded");
    const restored = selectRosterPokemon(different, "attacker", own[0]);
    expect(restored.notice).toContain("Your session build edits were restored");
    expect(selectRosterPokemon(restored, "attacker", own[0])).toBe(restored);
    expect(swapMatchup(restored).notice).toContain("Attacker and defender swapped");
    expect(resetMatchup(restored).notice).toContain("Session build edits cleared");
  });

  it("reset clears prep and effects while keeping navigation and restoring own-left orientation", () => {
    const current = selectMatchupMove(swapMatchup(prepared()), "flamethrower");
    current.field.gravity = true;
    current.contexts = { bulletseed: { hits: 3 } };
    const reset = resetMatchup(current);
    expect(reset.selectedMoveId).toBeNull();
    expect(reset.contexts).toEqual({});
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

describe("league matchup UI", () => {
  it("labels selectors and includes opponents without finalized rosters, excluding the account", () => {
    const html = renderToStaticMarkup(createElement(LeagueMatchupPicker, { state: loaded(), onLeagueChange: () => undefined, onOpponentChange: () => undefined, onRefresh: () => undefined }));
    assertLabels(html);
    expect(html).toContain('value="member-empty"');
    expect(html).not.toContain('value="member-own"');
    expect(html).toContain("Refresh teams");
    expect(html).toContain("draft costs are not Stat Points");
    expect(html).toContain("Build edits stay in this page session only");
  });

  it.each(["inline", "rail"] as const)("exposes active states, unavailable reasons and unsupported inspection in the %s variant", (variant) => {
    const state = loaded();
    state.data!.teams[0].pokemon.push({ name: "Custom mascot", points: 2, tier: 1 }, { name: "Lucario-Mega-Z", points: 20, tier: 1 });
    const own = choices(state).own;
    const html = renderToStaticMarkup(createElement(RosterPicker, { state, role: "own", side: "attacker", activeSource: own[0].source, onSelect: () => undefined, variant }));
    assertLabels(html);
    expect([...html.matchAll(/aria-pressed="true"/g)]).toHaveLength(1);
    expect(html).toContain("Your team");
    expect(html).toContain("Attacker");
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
    expect(html).toContain('<ul aria-label="Your team attacker roster" class="mt-3 grid gap-2 sm:grid-cols-2">');
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
    expect(html).toContain('<ul aria-label="Your team attacker roster" class="mt-3 grid grid-cols-1 gap-2">');
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
    expect(getRosterPanel({ ...state, opponentId: "" }, "opponent").message).toContain("Choose an opponent");
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
    expect(html).toContain("Attacker");
    expect(html).not.toContain('aria-pressed="true"');
    assertLabels(html);
  });
});
