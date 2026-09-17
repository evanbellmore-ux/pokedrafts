import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import LeagueMatchupPicker, { RosterPicker } from "@/app/(app)/calculator/LeagueMatchupPicker";
import {
  createMatchup, createSpeciesResolver, getRosterPanel, reconcileRosters, resetMatchup,
  resolveRosterSpecies, rosterChoices, selectRosterPokemon, swapMatchup, updateMatchupBuild,
} from "@/app/(app)/calculator/roster-prep";
import type { CalculatorRosterState } from "@/app/(app)/calculator/roster-data";
import type { TeamRoster } from "@/app/(app)/leagues/[leagueId]/team/roster";
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
    let current = prepared();
    const edit = { ...current.attacker.build, currentHP: Number.NaN, points: { ...current.attacker.build.points, spa: 32, hp: null } };
    current = updateMatchupBuild(current, "attacker", edit);
    const before = structuredClone(current);
    const changed = selectRosterPokemon(current, "attacker", own[2]);
    const restored = selectRosterPokemon(changed, "attacker", own[0]);
    expect(restored.attacker.build).toBe(edit);
    expect(restored.attacker.build.currentHP).toBeNaN();
    expect(restored.attacker.build.points.hp).toBeNull();
    expect(current).toEqual(before);
    expect(changed.cache).not.toBe(current.cache);
    expect(restored.cache.get(own[0].source!.key)?.build).toBe(edit);
  });

  it("isolates same-species prep by owner and treats the active entry as a no-op", () => {
    const { own, other } = choices();
    let current = prepared();
    current = updateMatchupBuild(current, "attacker", { ...current.attacker.build, nature: "Timid" });
    current.contexts = { bulletseed: { hits: 4 } };
    expect(selectRosterPokemon(current, "attacker", own[0])).toBe(current);
    expect(selectRosterPokemon(current, "defender", other[0])).toBe(current);
    expect(current.defender.build.nature).toBe("Serious");
    expect(current.attacker.source?.key).not.toBe(current.defender.source?.key);
    expect(selectRosterPokemon(current, "attacker", other[0])).toBe(current);
  });

  it("gives a different same-species entry fresh editor identity without resetting result controls", () => {
    const state = loaded();
    state.data!.teams[0] = team("team-own", "member-own", ["Mega Charizard X", "Charizard-Mega-X"]);
    const { own } = choices(state);
    let current = reconcileRosters(createMatchup(3), state);
    current = selectRosterPokemon(current, "attacker", own[0]);
    current = updateMatchupBuild(current, "attacker", { ...current.attacker.build, currentHP: Number.NaN });
    current.contexts = { bulletseed: { hits: 4 } };
    const next = selectRosterPokemon(current, "attacker", own[1]);
    expect(next.attacker.build.speciesId).toBe(current.attacker.build.speciesId);
    expect(next.attacker.build.itemId).toBe("charizarditex");
    expect(next.attacker.editorRevision).toBeGreaterThan(current.attacker.editorRevision);
    expect(next.attacker.key).toBe(current.attacker.key);
    expect(next.revision).toBe(3);
    expect(next.contexts).toEqual({});
  });

  it("preserves every shared and side effect across roster activation and Swap", () => {
    let current = prepared();
    for (const { key } of SHARED_FIELD_EFFECTS) current.field[key] = true;
    current.field.weather = "Snow";
    current.field.attackerSide.helpingHand = true;
    current.field.defenderSide.auroraVeil = true;
    current.contexts = { bulletseed: { hits: 4 } };
    current = selectRosterPokemon(current, "attacker", choices().own[1]);
    const swapped = swapMatchup(current);
    expect(swapped.attacker).toBe(current.defender);
    expect(swapped.defender).toBe(current.attacker);
    expect(swapped.attacker.role).toBe("opponent");
    expect(swapped.defender.role).toBe("own");
    expect(swapped.defender.editorRevision).toBe(current.attacker.editorRevision);
    expect(swapped.field).toEqual({ ...current.field, attackerSide: current.field.defenderSide, defenderSide: current.field.attackerSide });
    expect(swapped.contexts).toEqual({});
    expect(swapped.cache).toBe(current.cache);
    expect(swapMatchup(swapped).attacker).toBe(current.attacker);
  });

  it("changes the opponent-bound slot after Swap rather than assuming the right side", () => {
    const current = swapMatchup(prepared());
    const state = { ...loaded(), opponentId: "member-empty" };
    const changed = reconcileRosters(current, state);
    expect(changed.attacker.source).toBeNull();
    expect(changed.attacker.build).toBe(current.attacker.build);
    expect(changed.defender.source).toBe(current.defender.source);
    expect(changed.defender.role).toBe("own");
    expect(changed.field).toBe(current.field);
  });

  it("detaches a manual species change, but retains its cached prep and normal edits' context", () => {
    let current = prepared();
    current.contexts = { bulletseed: { hits: 3 } };
    const edited = updateMatchupBuild(current, "attacker", { ...current.attacker.build, nature: "Timid" });
    expect(edited.attacker.source).toBe(current.attacker.source);
    expect(edited.contexts).toBe(current.contexts);
    current = updateMatchupBuild(edited, "attacker", createBuild("venusaur"));
    expect(current.attacker.source).toBeNull();
    expect(current.contexts).toEqual({});
    expect(selectRosterPokemon(current, "attacker", choices().own[0]).attacker.build.nature).toBe("Timid");
  });

  it("preserves prep during refresh/error and invalidates removed entries only after success", () => {
    const current = prepared();
    const state = loaded();
    const loading = { ...state, status: "loading" as const, data: null, teamsStatus: "idle" as const };
    expect(reconcileRosters(current, loading)).toBe(current);
    expect(reconcileRosters(current, { ...loading, status: "error", message: "Try again" })).toBe(current);
    state.data!.teams[0].pokemon.shift();
    const refreshed = reconcileRosters(current, state);
    expect(refreshed.attacker.build).toBe(current.attacker.build);
    expect(refreshed.attacker.source).toBeNull();
    expect(refreshed.cache.has(current.attacker.source!.key)).toBe(false);
    expect(refreshed.defender).toBe(current.defender);
  });

  it("invalidates changed acquisitions, duplicate teams and duplicate entry identities", () => {
    for (const corrupt of ["acquisition", "team", "name"] as const) {
      const current = prepared();
      const state = loaded();
      const own = state.data!.teams[0];
      if (corrupt === "acquisition") own.pokemon[0] = { ...own.pokemon[0], acquired: "free_agent", pick_number: null };
      if (corrupt === "team") state.data!.teams.push({ ...own, id: "second-roster" });
      if (corrupt === "name") own.pokemon.push({ ...own.pokemon[0] });
      const refreshed = reconcileRosters(current, state);
      expect(refreshed.attacker.source).toBeNull();
      expect(refreshed.cache.has(current.attacker.source!.key)).toBe(false);
    }
  });

  it("keeps cache scoped when switching leagues and prunes revoked memberships", () => {
    const current = prepared();
    const state = { ...loaded(), selectedLeagueId: "league-b", opponentId: "", data: null, teamsStatus: "loading" as const };
    const changed = reconcileRosters(current, state);
    expect(changed.attacker.source).toBeNull();
    expect(changed.defender.source).toBeNull();
    expect(changed.attacker.build).toBe(current.attacker.build);
    expect(changed.cache).toBe(current.cache);
    expect(selectRosterPokemon(changed, "attacker", choices().own[0])).toBe(changed);
    const revoked = reconcileRosters(changed, { ...state, leagues: [state.leagues[1]] });
    expect(revoked.cache.size).toBe(0);
  });

  it("clears private prep and announcements on account replacement or signout, not the first auth lookup", () => {
    const current = prepared();
    expect(current.notice).toContain("Charizard selected as defender");
    for (const userId of ["different-account", null]) {
      const next = reconcileRosters(current, { ...loaded(), status: userId ? "loading" : "signed-out", userId, leagues: [], selectedLeagueId: "", opponentId: "", data: null, teamsStatus: "idle" });
      expect(next.cache.size).toBe(0);
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
    const current = swapMatchup(prepared());
    current.field.gravity = true;
    const reset = resetMatchup(current);
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

  it("exposes active states, unavailable reasons and unsupported inspection without disabling manual controls", () => {
    const state = loaded();
    state.data!.teams[0].pokemon.push({ name: "Custom mascot", points: 2, tier: 1 }, { name: "Lucario-Mega-Z", points: 20, tier: 1 });
    const own = choices(state).own;
    const html = renderToStaticMarkup(createElement(RosterPicker, { state, role: "own", side: "attacker", activeSource: own[0].source, onSelect: () => undefined }));
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
