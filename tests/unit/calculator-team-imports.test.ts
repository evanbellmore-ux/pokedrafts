import assert from "node:assert/strict";
import { createElement, isValidElement, type ChangeEvent, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PokePasteImporter from "@/app/(app)/calculator/PokePasteImporter";
import MatchupSummary from "@/app/(app)/calculator/MatchupSummary";
import * as pokemonChooser from "@/app/(app)/calculator/PokemonChooser";
import { MyTeamPicker, OpponentPicker, RosterPicker } from "@/app/(app)/calculator/LeagueMatchupPicker";
import * as selectControl from "@/app/components/ui/Select";
import {
  activateMoveSlot, applyTeamPaste, changeTeamSource, createMatchup, getAttackView,
  getMoveOwner, getRosterPanel, getTeamPanel, getTeamSourceOwner, reconcileRosters,
  removeTeamPaste, replaceMatchupMove, resetMatchup, selectRosterPokemon, swapMatchup,
  toggleMatchupMega, updateMatchupBuild, updateMatchupHP, updateMatchupMoveContext,
  type BattleSide, type Combatant, type PasteImport, type PreparedMatchup, type RosterRole,
  type TeamSourceMode,
} from "@/app/(app)/calculator/roster-prep";
import { createRosterState, type CalculatorRosterState } from "@/app/(app)/calculator/roster-data";
import type { TeamRoster } from "@/app/(app)/leagues/[leagueId]/team/roster";
import { speciesById } from "@/app/lib/battle/catalog";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import { parseTeamImport } from "@/app/lib/battle/team-import";

const RAICHU = [
  "Raichu @ Raichunite X", "Ability: Lightning Rod", "EVs: 2 HP / 32 SpA / 32 Spe",
  "Timid Nature", "- Protect", "- Thunderbolt",
].join("\n");
const SECOND_RAICHU = [
  "Raichu @ Raichunite Y", "Ability: Static", "EVs: 32 HP / 32 SpA",
  "Modest Nature", "- Thunderbolt", "- Protect",
].join("\n");
const CHARIZARD = [
  "Charizard @ Charizardite Y", "Ability: Blaze", "EVs: 6 HP / 28 SpA / 32 Spe",
  "Modest Nature", "- Flamethrower", "- Protect",
].join("\n");
const TEAM_TEXT = [RAICHU, SECOND_RAICHU, CHARIZARD].join("\n\n");
const PASTE_URL = "https://pokepast.es/0123456789abcdef";
const roles: RosterRole[] = ["own", "opponent"];
const network = vi.fn(() => { throw new Error("Team import unit tests must not access the network"); });

function team(id: string, memberId: string, names: string[]): TeamRoster {
  return {
    id, member_id: memberId, team_name: null, role: null, total_points: names.length * 15,
    pokemon: names.map((name, index) => ({ name, points: 15, tier: 1, pick_number: index + 1, acquired: "draft" })),
  };
}

function loaded(): CalculatorRosterState {
  return {
    status: "ready", userId: "account-a", selectedLeagueId: "league-a", opponentId: "member-away",
    leagues: [
      { id: "league-a", name: "Alpha", memberId: "member-home", teamName: "Home", draftStarted: true, draftCompleted: true },
      { id: "league-b", name: "Beta", memberId: "member-home-b", teamName: "Home B", draftStarted: true, draftCompleted: true },
    ],
    teamsStatus: "ready", message: null, teamsMessage: null,
    data: {
      leagueId: "league-a",
      members: [
        { id: "member-home", role: "coach", team_name: "Home", draft_position: 1 },
        { id: "member-away", role: "coach", team_name: "Away", draft_position: 2 },
      ],
      teams: [team("roster-home", "member-home", ["Charizard", "Blastoise"]), team("roster-away", "member-away", ["Charizard", "Venusaur"])],
    },
  };
}

function imported(text = TEAM_TEXT, title = "Practice team"): PasteImport {
  return { text, title, url: PASTE_URL, team: parseTeamImport(text, "champions") };
}

function bind(state = loaded()) {
  return reconcileRosters(createMatchup(), state);
}

function install(current: PreparedMatchup, role: RosterRole, input = imported()) {
  const ready = changeTeamSource(current, getTeamSourceOwner(current, role), "paste");
  return applyTeamPaste(ready, getTeamSourceOwner(ready, role), input);
}

function sideFor(current: PreparedMatchup, role: RosterRole): BattleSide {
  return current.attacker.role === role ? "attacker" : "defender";
}

function choose(current: PreparedMatchup, role: RosterRole, index = 0, state = loaded()) {
  return selectRosterPokemon(current, sideFor(current, role), getTeamPanel(current, state, role).choices[index]);
}

function bothPastes(current = bind()) {
  current = install(current, "own", imported(TEAM_TEXT, "Home paste"));
  return install(current, "opponent", imported(TEAM_TEXT, "Away paste"));
}

function activePastes(current = bothPastes()) {
  return choose(choose(current, "own"), "opponent");
}

function expectPrepKept(next: Combatant, previous: Combatant) {
  for (const key of ["key", "role", "build", "hpInput", "moves", "megaBase", "editorRevision"] as const) {
    expect(next[key], key).toBe(previous[key]);
  }
}

function immutable(current: PreparedMatchup, transition: (state: PreparedMatchup) => PreparedMatchup) {
  const before = structuredClone(current);
  const next = transition(current);
  expect(current).toEqual(before);
  return next;
}

function summaryProps(current: PreparedMatchup): ComponentProps<typeof MatchupSummary> {
  return {
    attacker: current.attacker, defender: current.defender,
    attack: current.attack, replacement: current.replacement,
    issues: { attacker: [], defender: [] }, selectedRow: undefined,
    rollMode: "average", movesControl: "team-import-test-moves",
    onRollModeChange: vi.fn(), onActivateMove: vi.fn(), onShowMove: vi.fn(),
    onBuildChange: vi.fn(), onHPChange: vi.fn(), onRosterSelect: vi.fn(), onToggleMega: vi.fn(),
  };
}

function assertLabels(html: string) {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  expect(new Set(ids).size).toBe(ids.length);
  for (const [, id] of html.matchAll(/\bfor="([^"]+)"/g)) expect(ids).toContain(id);
  for (const [, references] of html.matchAll(/\baria-(?:describedby|labelledby)="([^"]+)"/g)) {
    for (const id of references.split(" ")) expect(ids).toContain(id);
  }
}

beforeEach(() => {
  network.mockClear();
  vi.stubGlobal("fetch", network);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  expect(network).not.toHaveBeenCalled();
});

describe("team import state: source ownership and activation", () => {
  it("defaults both sources to league and adds owners without changing the legacy league panel API", () => {
    const state = loaded();
    const current = bind(state);
    for (const role of roles) {
      expect(current.teams[role]).toMatchObject({ mode: "league", paste: null });
      const raw = getRosterPanel(state, role);
      const panel = getTeamPanel(current, state, role);
      expect(panel).toEqual({ ...raw, choices: raw.choices.map((choice) => ({ ...choice, owner: getTeamSourceOwner(current, role) })) });
      expect(raw.choices.every((choice) => choice.source?.kind === "league" && choice.owner === undefined)).toBe(true);
      const selected = selectRosterPokemon(current, sideFor(current, role), raw.choices[0]);
      expect(selected[sideFor(selected, role)].source?.kind).toBe("league");
    }
  });

  it.each([
    ["league", "league"], ["league", "paste"], ["paste", "league"], ["paste", "paste"],
  ] satisfies [TeamSourceMode, TeamSourceMode][])("supports own=%s and opponent=%s without merging their data sources", (ownMode, opponentMode) => {
    const state = loaded();
    let current = bind(state);
    for (const [role, mode] of [["own", ownMode], ["opponent", opponentMode]] as const) {
      if (mode === "paste") current = install(current, role, imported(RAICHU, `${role} paste`));
    }
    for (const [role, mode] of [["own", ownMode], ["opponent", opponentMode]] as const) {
      const panel = getTeamPanel(current, state, role);
      expect(panel.status).toBe("ready");
      expect(panel.teamName).toBe(mode === "paste" ? `${role} paste` : role === "own" ? "Home" : "Away");
      expect(panel.choices[0].owner).toEqual(getTeamSourceOwner(current, role));
      const before = current;
      current = immutable(current, (value) => choose(value, role, 0, state));
      const side = sideFor(current, role);
      expect(current[side].source?.kind).toBe(mode);
      expect(current[side].build).toMatchObject(mode === "paste"
        ? { speciesId: "raichu", nature: "Timid", abilityId: "lightningrod", itemId: "raichunitex", points: { hp: 2, spa: 32, spe: 32 } }
        : createBuild("charizard"));
      expectPrepKept(current[side === "attacker" ? "defender" : "attacker"], before[side === "attacker" ? "defender" : "attacker"]);
    }
  });

  it("does not fall back to league choices when paste mode has no import, even during league errors", () => {
    const current = changeTeamSource(bind(), getTeamSourceOwner(bind(), "own"), "paste");
    for (const state of [loaded(), { ...loaded(), status: "error" as const }, createRosterState()]) {
      expect(getTeamPanel(current, state, "own")).toMatchObject({ status: "empty", teamName: null, choices: [] });
      expect(getTeamPanel(current, state, "own").message).toMatch(/Import a PokéPaste link or team text/);
    }
    expect(getRosterPanel(loaded(), "own").choices).toHaveLength(2);
  });

  it("imports only on apply and loads a build only on an explicit entry selection", () => {
    let current = updateMatchupHP(bind(), "attacker", "00100");
    current = updateMatchupBuild(current, "attacker", { ...current.attacker.build, nature: "Bold", status: "par" });
    current = { ...current, field: { ...current.field, weather: "Rain", gravity: true } };
    const input = imported();
    expect(input.team.members.every((member) => member.selectable)).toBe(true);
    const before = current;
    const switched = immutable(current, (value) => changeTeamSource(value, getTeamSourceOwner(value, "own"), "paste"));
    const applied = immutable(switched, (value) => applyTeamPaste(value, getTeamSourceOwner(value, "own"), input));
    for (const next of [switched, applied]) {
      expectPrepKept(next.attacker, before.attacker);
      expectPrepKept(next.defender, before.defender);
      expect(next.attacker.source).toBeNull();
      expect(next.defender.source).toBeNull();
      expect(next.field).toBe(before.field);
      expect(next.cache.size).toBe(0);
    }
    expect(applied.teams.own.paste).toMatchObject({ title: input.title, text: input.text, url: input.url });
    const selected = immutable(applied, (value) => choose(value, "own"));
    expect(selected.attacker.build).toEqual(input.team.members[0].build);
    expect(selected.attacker.moves).toEqual(input.team.members[0].moves);
    expect(selected.attacker.hpInput).toBe("");
    expect(selected.attacker.source).toMatchObject({ kind: "paste", role: "own", index: 0 });
    expect(selected.field).toBe(before.field);
  });

  it("refuses applying into league mode, globally invalid imports, and imports without a selectable member", () => {
    const current = bind();
    expect(applyTeamPaste(current, getTeamSourceOwner(current, "own"), imported())).toBe(current);
    const ready = changeTeamSource(current, getTeamSourceOwner(current, "own"), "paste");
    const fatal = imported();
    fatal.team.diagnostics.push({ line: 1, severity: "error", message: "Team is too large" });
    for (const input of [fatal, imported(""), imported("Unknown mascot\n- Thunderbolt")]) {
      expect(applyTeamPaste(ready, getTeamSourceOwner(ready, "own"), input)).toBe(ready);
    }
  });

  it("deep-copies parsed seeds on apply and keeps editable builds and moves separate from those seeds", () => {
    const input = imported();
    const snapshot = structuredClone(input);
    let current = install(bind(), "own", input);
    const applied = current.teams.own.paste!;
    expect(applied.team).toEqual(input.team);
    expect(applied.team).not.toBe(input.team);
    expect(applied.team.members[0].build).not.toBe(input.team.members[0].build);
    current = choose(current, "own");
    expect(current.attacker.build).not.toBe(applied.team.members[0].build);
    expect(current.attacker.build.points).not.toBe(applied.team.members[0].build!.points);
    expect(current.attacker.moves).not.toBe(applied.team.members[0].moves);
    const edited = immutable(current, (value) => {
      assert(value.attacker.build.game === "champions");
      return updateMatchupBuild(value, "attacker", {
        ...value.attacker.build, nature: "Calm", points: { ...value.attacker.build.points, hp: null },
      });
    });
    expect(edited.teams.own.paste).toBe(applied);
    expect(applied.team).toEqual(snapshot.team);
    expect(input).toEqual(snapshot);
    assert(input.team.members[0].build?.game === "champions");
    input.team.members[0].build!.points.spa = 0;
    input.team.members[0].moves[0].moveId = "thunderbolt";
    expect(applied.team).toEqual(snapshot.team);
    expect(edited.attacker.moves[0].moveId).toBe("protect");
  });

  it("uses entry index rather than species or name to isolate duplicate-species set edits", () => {
    let current = install(bind(), "own");
    const panel = getTeamPanel(current, loaded(), "own");
    expect(panel.choices.slice(0, 2).map((choice) => choice.name)).toEqual(["Raichu", "Raichu"]);
    expect(panel.choices.slice(0, 2).every((choice) => choice.source !== null)).toBe(true);
    expect(panel.choices[0].key).not.toBe(panel.choices[1].key);
    current = choose(current, "own", 0);
    current = updateMatchupHP(current, "attacker", "2e1");
    current = updateMatchupBuild(current, "attacker", { ...current.attacker.build, nature: "Bold" });
    const first = current.attacker;
    current = immutable(current, (value) => choose(value, "own", 1));
    expect(current.attacker.build).toMatchObject({ nature: "Modest", abilityId: "static", itemId: "raichunitey", points: { hp: 32, spe: 0 } });
    expect(current.attacker.hpInput).toBe("");
    current = updateMatchupHP(current, "attacker", "00100");
    const second = current.attacker;
    const restoredFirst = choose(current, "own", 0);
    expect(restoredFirst.attacker.build).toBe(first.build);
    expect(restoredFirst.attacker.hpInput).toBe("2e1");
    expect(restoredFirst.attacker.build.currentHP).toBeNaN();
    const restoredSecond = choose(restoredFirst, "own", 1);
    expect(restoredSecond.attacker.build).toBe(second.build);
    expect(restoredSecond.attacker.hpInput).toBe("00100");
    expect(restoredSecond.cache.size).toBe(2);
  });

  it("isolates the same paste imported into both roles and rejects cross-role shortcuts", () => {
    const input = imported();
    let current = install(install(bind(), "own", input), "opponent", input);
    current = activePastes(current);
    const own = getTeamPanel(current, loaded(), "own").choices[0];
    const other = getTeamPanel(current, loaded(), "opponent").choices[0];
    expect(current.teams.own.paste!.id).not.toBe(current.teams.opponent.paste!.id);
    expect(own.key).not.toBe(other.key);
    expect(current.attacker.build).toEqual(current.defender.build);
    expect(current.attacker.build).not.toBe(current.defender.build);
    const opponentCache = current.cache.get(other.key);
    const edited = updateMatchupBuild(current, "attacker", { ...current.attacker.build, nature: "Bold" });
    expect(edited.defender).toBe(current.defender);
    expect(edited.cache.get(other.key)).toBe(opponentCache);
    expect(selectRosterPokemon(edited, "attacker", other)).toBe(edited);
    expect(selectRosterPokemon(edited, "defender", own)).toBe(edited);
    expect(choose(choose(edited, "own", 1), "own", 0).attacker.build.nature).toBe("Bold");
    expect(edited.teams.opponent.paste!.team.members[0].build!.nature).toBe("Timid");
  });

  it("preserves imported Status moves, their order and empty slots instead of filling them from usage", () => {
    let current = choose(install(bind(), "own", imported(RAICHU)), "own");
    expect(current.attacker.moves).toEqual([
      { moveId: "protect", origin: "imported", gameType: null },
      { moveId: "thunderbolt", origin: "imported", gameType: null },
      { moveId: null, origin: "empty", gameType: null },
      { moveId: null, origin: "empty", gameType: null },
    ]);
    current = activateMoveSlot(current, getMoveOwner(current.attacker), 0);
    expect(current.attack.moveId).toBe("protect");
    current = activateMoveSlot(current, getMoveOwner(current.attacker), 2);
    expect(current.attack.moveId).toBeNull();
    const manualMove = speciesById.get("raichu")!.moves.find((id) => id !== "protect" && id !== "thunderbolt")!;
    current = replaceMatchupMove(current, current.replacement!, manualMove);
    expect(current.attacker.moves[2]).toEqual({ moveId: manualMove, origin: "manual", gameType: null });
    expect(current.attacker.moves[3]).toEqual({ moveId: null, origin: "empty", gameType: null });
    expect(current.teams.own.paste!.team.members[0].moves[2].moveId).toBeNull();
  });

  it("keeps unavailable members visible but never activates or caches them", () => {
    const current = install(bind(), "own", imported(`${RAICHU}\n\nUnknown mascot\n- Thunderbolt`));
    const panel = getTeamPanel(current, loaded(), "own");
    expect(panel.choices).toHaveLength(2);
    expect(panel.choices[0].source).not.toBeNull();
    expect(panel.choices[1]).toMatchObject({ source: null, speciesId: null, reason: expect.stringMatching(/exact Champions match/) });
    expect(selectRosterPokemon(current, "attacker", panel.choices[1])).toBe(current);
    expect(current.cache.size).toBe(0);
  });
});

describe("team import state: cache, Mega and source changes", () => {
  it.each(roles)("restores %s imported base ability/item after Mega toggles and preserves later cached edits", (role) => {
    let current = choose(install(bind(), role), role);
    const side = sideFor(current, role);
    const original = current[side];
    const sourceKey = original.source!.key;
    current = immutable(current, (value) => toggleMatchupMega(value, getMoveOwner(value[side]), "raichumegax"));
    expect(current[side].build).toMatchObject({ speciesId: "raichumegax", abilityId: "electricsurge", itemId: "raichunitex" });
    expect(current[side].megaBase).toEqual({ speciesId: "raichu", abilityId: "lightningrod", abilityActive: original.build.abilityActive, itemId: "raichunitex" });
    const build = current[side].build;
    assert(build.game === "champions");
    current = updateMatchupBuild(current, side, {
      ...build, nature: "Calm", points: { ...build.points, hp: null },
      boosts: { ...build.boosts, spa: 2 }, status: "par",
    });
    current = updateMatchupHP(current, side, "2e1");
    current = activateMoveSlot(current, getMoveOwner(current[side]), 2);
    const manualMove = speciesById.get("raichu")!.moves.find((id) => id !== "protect" && id !== "thunderbolt")!;
    current = replaceMatchupMove(current, current.replacement!, manualMove);
    current = toggleMatchupMega(current, getMoveOwner(current[side]), "raichumegay");
    const mega = current[side];
    const stored = current.cache.get(sourceKey)!;
    expect(stored).toMatchObject({ build: mega.build, hpInput: "2e1", moves: mega.moves, megaBase: mega.megaBase });
    const away = choose(current, role, 2);
    const restored = immutable(away, (value) => choose(value, role));
    for (const key of ["build", "moves", "megaBase"] as const) expect(restored[side][key]).toBe(mega[key]);
    expect(restored[side].source?.key).toBe(sourceKey);
    const off = immutable(restored, (value) => toggleMatchupMega(value, getMoveOwner(value[side]), "raichumegay"));
    expect(off[side].build).toMatchObject({
      speciesId: "raichu", abilityId: "lightningrod", itemId: "raichunitex", nature: "Calm",
      points: { hp: null }, boosts: { spa: 2 }, status: "par", currentHP: Number.NaN,
    });
    expect(off[side].hpInput).toBe("2e1");
    expect(off[side].moves).toBe(mega.moves);
    expect(off[side].megaBase).toBeNull();
    expect(off.teams[role].paste!.team.members[0].build).toEqual(original.build);
    expect(off.cache.get(sourceKey)!.build).toBe(off[side].build);
  });

  it("round-trips league and paste modes with separate caches and no automatic set activation", () => {
    let current = choose(bind(), "own");
    current = updateMatchupBuild(current, "attacker", { ...current.attacker.build, nature: "Bold" });
    const league = current.attacker;
    current = choose(install(current, "own"), "own");
    current = updateMatchupHP(current, "attacker", "00100");
    const paste = current.attacker;
    const cache = current.cache;
    const leagueMode = immutable(current, (value) => changeTeamSource(value, getTeamSourceOwner(value, "own"), "league"));
    expectPrepKept(leagueMode.attacker, paste);
    expect(leagueMode.attacker.source).toBeNull();
    expect(leagueMode.cache).toBe(cache);
    expect(leagueMode.teams.own.paste).toBe(current.teams.own.paste);
    const leagueRestored = choose(leagueMode, "own");
    expect(leagueRestored.attacker.build).toBe(league.build);
    const pasteMode = changeTeamSource(leagueRestored, getTeamSourceOwner(leagueRestored, "own"), "paste");
    expectPrepKept(pasteMode.attacker, leagueRestored.attacker);
    expect(pasteMode.attacker.source).toBeNull();
    const pasteRestored = choose(pasteMode, "own");
    expect(pasteRestored.attacker.build).toBe(paste.build);
    expect(pasteRestored.attacker.moves).toBe(paste.moves);
    expect(pasteRestored.attacker.hpInput).toBe("00100");
    expect(pasteRestored.cache.size).toBe(2);
  });

  it("treats the current entry and source mode as exact no-ops even with an active move and unfinished edits", () => {
    let current = activePastes();
    current = updateMatchupHP(current, "attacker", "2e1");
    current = activateMoveSlot(current, getMoveOwner(current.attacker), 1);
    current = updateMatchupMoveContext(current, getMoveOwner(current.attacker), "thunderbolt", { hits: 3 });
    const snapshot = structuredClone(current);
    expect(choose(current, "own")).toBe(current);
    expect(choose(current, "opponent")).toBe(current);
    for (const role of roles) expect(changeTeamSource(current, getTeamSourceOwner(current, role), "paste")).toBe(current);
    expect(current).toEqual(snapshot);
    const empty = changeTeamSource(bind(), getTeamSourceOwner(bind(), "own"), "paste");
    expect(removeTeamPaste(empty, getTeamSourceOwner(empty, "own"))).toBe(empty);
  });

  it.each([
    ["own", "replace"], ["opponent", "replace"], ["own", "remove"], ["opponent", "remove"],
  ] as const)("%s %s prunes only that role's imported cache and keeps both active preparations", (role, action) => {
    let current = choose(choose(bind(), "own"), "opponent");
    current = activePastes(bothPastes(current));
    current = choose(current, role, 1);
    const side = sideFor(current, role);
    const otherSide = side === "attacker" ? "defender" : "attacker";
    const otherRole = role === "own" ? "opponent" : "own";
    current = updateMatchupHP(current, side, "2e1");
    current = toggleMatchupMega(current, getMoveOwner(current[side]), "raichumegay");
    const owner = getTeamSourceOwner(current, role);
    const staleChoice = getTeamPanel(current, loaded(), role).choices[1];
    const remaining = [...current.cache].filter(([, entry]) => entry.source.kind !== "paste" || entry.source.role !== role);
    expect(current.cache.size).toBe(5);
    const next = immutable(current, (value) => action === "replace"
      ? applyTeamPaste(value, owner, imported(CHARIZARD, "Replacement"))
      : removeTeamPaste(value, owner));
    expect([...next.cache]).toEqual(remaining);
    for (const [key, entry] of remaining) expect(next.cache.get(key)).toBe(entry);
    expect(next[side].source).toBeNull();
    expectPrepKept(next[side], current[side]);
    expectPrepKept(next[otherSide], current[otherSide]);
    expect(next[otherSide].source).toBe(current[otherSide].source);
    expect(next.teams[otherRole]).toBe(current.teams[otherRole]);
    expect(next.field).toBe(current.field);
    expect(applyTeamPaste(next, owner, imported())).toBe(next);
    expect(removeTeamPaste(next, owner)).toBe(next);
    expect(selectRosterPokemon(next, side, staleChoice)).toBe(next);
    if (action === "replace") {
      expect(next.teams[role].paste!.id).not.toBe(current.teams[role].paste!.id);
      const selected = choose(next, role);
      expect(selected[side].build).toEqual(parseTeamImport(CHARIZARD, "champions").members[0].build);
      expect(selected[side].hpInput).toBe("");
      expect(selected[side].megaBase).toBeNull();
    } else {
      expect(next.teams[role].mode).toBe("paste");
      expect(next.teams[role].paste).toBeNull();
      expect(getTeamPanel(next, loaded(), role).choices).toEqual([]);
    }
  });

  it("re-importing identical text creates a fresh import identity instead of reviving prior edits", () => {
    const input = imported();
    let current = choose(install(bind(), "own", input), "own");
    current = updateMatchupBuild(current, "attacker", { ...current.attacker.build, nature: "Bold" });
    const oldKey = current.attacker.source!.key;
    const replaced = applyTeamPaste(current, getTeamSourceOwner(current, "own"), input);
    expect(replaced.cache.has(oldKey)).toBe(false);
    const selected = choose(replaced, "own");
    expect(selected.attacker.source!.key).not.toBe(oldKey);
    expect(selected.attacker.build.nature).toBe("Timid");
    expect(selected.attacker.build).toEqual(input.team.members[0].build);
  });
});

describe("team import state: stale actions, reconciliation, Swap and Reset", () => {
  const invalidations: [string, (current: PreparedMatchup) => PreparedMatchup][] = [
    ["paste–league–paste", (current) => {
      const away = changeTeamSource(current, getTeamSourceOwner(current, "own"), "league");
      return changeTeamSource(away, getTeamSourceOwner(away, "own"), "paste");
    }],
    ["replacement", (current) => applyTeamPaste(current, getTeamSourceOwner(current, "own"), imported())],
    ["removal and re-import", (current) => install(removeTeamPaste(current, getTeamSourceOwner(current, "own")), "own")],
    ["Reset", resetMatchup],
    ["account replacement", (current) => reconcileRosters(current, { ...loaded(), userId: "account-b" })],
    ["sign-out", (current) => reconcileRosters(current, { ...createRosterState(), status: "signed-out" })],
  ];

  it.each(invalidations)("rejects stale apply/remove/source/select callbacks after %s", (_name, invalidate) => {
    const current = activePastes();
    const owner = getTeamSourceOwner(current, "own");
    const choice = getTeamPanel(current, loaded(), "own").choices[0];
    const input = imported();
    const next = immutable(current, invalidate);
    expect(applyTeamPaste(next, owner, input)).toBe(next);
    expect(removeTeamPaste(next, owner)).toBe(next);
    expect(changeTeamSource(next, owner, next.teams.own.mode === "paste" ? "league" : "paste")).toBe(next);
    expect(selectRosterPokemon(next, "attacker", choice)).toBe(next);
    expect(getTeamSourceOwner(next, "own")).not.toEqual(owner);
  });

  it("also expires wrapped league choices across league–paste–league source changes", () => {
    const current = bind();
    const old = getTeamPanel(current, loaded(), "own").choices[0];
    const paste = changeTeamSource(current, getTeamSourceOwner(current, "own"), "paste");
    const back = changeTeamSource(paste, getTeamSourceOwner(paste, "own"), "league");
    expect(selectRosterPokemon(back, "attacker", old)).toBe(back);
    expect(choose(back, "own").attacker.source?.kind).toBe("league");
  });

  it("keeps imports, their caches and active calculation through the first account lookup", () => {
    let current = activePastes(bothPastes(createMatchup()));
    current = activateMoveSlot(current, getMoveOwner(current.attacker), 1);
    current = updateMatchupMoveContext(current, getMoveOwner(current.attacker), "thunderbolt", { hits: 3 });
    expect(current.accountId).toBeNull();
    const loading = reconcileRosters(current, { ...createRosterState(), userId: "account-a" });
    const ready = immutable(loading, (value) => reconcileRosters(value, loaded()));
    for (const next of [loading, ready]) {
      expect(next.teams).toBe(current.teams);
      expect(next.cache).toBe(current.cache);
      expect(next.attacker).toBe(current.attacker);
      expect(next.defender).toBe(current.defender);
      expect(next.attack).toBe(current.attack);
      expect(next.replacement).toBe(current.replacement);
      expect(next.revision).toBe(current.revision);
      expect(next.accountId).toBe("account-a");
    }
  });

  it.each(["account-b", null])("clears private imported teams and preparation when an established account changes to %s", (userId) => {
    const current = activePastes();
    const next = immutable(current, (value) => reconcileRosters(value, {
      ...createRosterState(), status: userId === null ? "signed-out" : "loading", userId,
    }));
    for (const role of roles) expect(next.teams[role]).toMatchObject({ mode: "league", paste: null });
    expect(next.cache.size).toBe(0);
    expect(next.importRevision).toBe(0);
    expect(next.attacker.source).toBeNull();
    expect(next.defender.source).toBeNull();
    expect(next.attacker.build).toEqual(createBuild("charizard"));
    expect(next.defender.build).toEqual(createBuild("blastoise"));
    expect(next.notice).toBe("");
    expect(next.revision).toBeGreaterThan(current.revision);
  });

  it.each([
    ["account loading", { status: "loading", teamsStatus: "idle", data: null }],
    ["account error", { status: "error", message: "Membership error", data: null }],
    ["roster loading", { teamsStatus: "loading", data: null }],
    ["roster error", { teamsStatus: "error", teamsMessage: "Roster error", data: null }],
    ["successful empty refresh", { data: { leagueId: "league-a", members: [], teams: [] } }],
    ["league removal", { leagues: [], selectedLeagueId: "", opponentId: "", data: null, teamsStatus: "idle" }],
  ] satisfies [string, Partial<CalculatorRosterState>][])("does not prune/detach either paste or clear its calculation on %s", (_name, patch) => {
    let current = activePastes();
    current = activateMoveSlot(current, getMoveOwner(current.defender), 1);
    current = updateMatchupMoveContext(current, getMoveOwner(current.defender), "thunderbolt", { hits: 4 });
    const state = { ...loaded(), ...patch };
    const next = immutable(current, (value) => reconcileRosters(value, state));
    expect(next.attacker).toBe(current.attacker);
    expect(next.defender).toBe(current.defender);
    expect(next.teams).toBe(current.teams);
    expect(next.cache).toBe(current.cache);
    expect(next.attack).toBe(current.attack);
    expect(next.replacement).toBe(current.replacement);
    expect(next.field).toBe(current.field);
    for (const role of roles) expect(getTeamPanel(next, state, role).choices.map((choice) => choice.key)).toEqual(getTeamPanel(current, loaded(), role).choices.map((choice) => choice.key));
  });

  it("prunes and detaches a revoked league source without pruning or detaching the other role's paste", () => {
    let current = choose(bind(), "opponent");
    current = choose(install(current, "own"), "own");
    const ownKey = current.attacker.source!.key;
    const opponentKey = current.defender.source!.key;
    const state = { ...loaded(), leagues: [], selectedLeagueId: "", opponentId: "", teamsStatus: "idle" as const, data: null };
    const next = immutable(current, (value) => reconcileRosters(value, state));
    expect(next.attacker.source).toBe(current.attacker.source);
    expectPrepKept(next.attacker, current.attacker);
    expect(next.defender.source).toBeNull();
    expectPrepKept(next.defender, current.defender);
    expect(next.cache.get(ownKey)).toBe(current.cache.get(ownKey));
    expect(next.cache.has(opponentKey)).toBe(false);
    expect(next.teams.own).toBe(current.teams.own);
    expect(getTeamPanel(next, state, "own").status).toBe("ready");
  });

  it("does not reset active calculation or epochs when navigating leagues while both sources are pastes", () => {
    let current = activePastes();
    current = { ...current, field: { ...current.field, weather: "Rain", gravity: true } };
    current = activateMoveSlot(current, getMoveOwner(current.defender), 1);
    current = updateMatchupMoveContext(current, getMoveOwner(current.defender), "thunderbolt", { hits: 3 });
    const before = getAttackView(current);
    const next = immutable(current, (value) => reconcileRosters(value, {
      ...loaded(), selectedLeagueId: "league-b", opponentId: "", teamsStatus: "loading", data: null,
    }));
    expect(next.selection).toMatchObject({ leagueId: "league-b", ownMemberId: "member-home-b", opponentId: "" });
    expect(next.teams).toBe(current.teams);
    expect(next.attacker).toBe(current.attacker);
    expect(next.defender).toBe(current.defender);
    expect(next.attack).toBe(current.attack);
    expect(next.replacement).toBe(current.replacement);
    expect(getAttackView(next)).toEqual(before);
    expect(next.field).toBe(current.field);
  });

  it("moves paste role, cache and preparation with Swap, and applies later own-team changes to the right role", () => {
    let current = activePastes();
    current = updateMatchupHP(current, "attacker", "00100");
    current = updateMatchupHP(current, "defender", "2e1");
    current = { ...current, field: { ...current.field, attackerSide: { ...current.field.attackerSide, helpingHand: true } } };
    const owner = getTeamSourceOwner(current, "own");
    const ownChoice = getTeamPanel(current, loaded(), "own").choices[1];
    const swapped = immutable(current, swapMatchup);
    expect(swapped.attacker.role).toBe("opponent");
    expect(swapped.defender.role).toBe("own");
    expectPrepKept(swapped.attacker, current.defender);
    expectPrepKept(swapped.defender, current.attacker);
    expect(swapped.attacker.source).toBe(current.defender.source);
    expect(swapped.defender.source).toBe(current.attacker.source);
    expect(swapped.teams).toBe(current.teams);
    expect(swapped.cache).toBe(current.cache);
    expect(swapped.field.defenderSide).toBe(current.field.attackerSide);
    expect(selectRosterPokemon(swapped, "attacker", ownChoice)).toBe(swapped);
    const chosen = selectRosterPokemon(swapped, "defender", ownChoice);
    expect(chosen.defender.source).toMatchObject({ role: "own", kind: "paste", index: 1 });
    expect(chosen.attacker.build).toBe(swapped.attacker.build);
    const replaced = applyTeamPaste(chosen, owner, imported(CHARIZARD, "New home paste"));
    expect(replaced.teams.own.paste!.title).toBe("New home paste");
    expect(replaced.defender.source).toBeNull();
    expect(replaced.attacker.source).toBe(chosen.attacker.source);
    expectPrepKept(replaced.defender, chosen.defender);
  });

  it("Reset retains imports/modes but clears all edits and cache, then reloads the original seeds on click", () => {
    let current = activePastes();
    current = updateMatchupBuild(current, "attacker", { ...current.attacker.build, nature: "Bold" });
    current = toggleMatchupMega(current, getMoveOwner(current.attacker), "raichumegax");
    current = updateMatchupHP(current, "attacker", "2e1");
    current = changeTeamSource(current, getTeamSourceOwner(current, "opponent"), "league");
    current = swapMatchup(current);
    const reset = immutable(current, resetMatchup);
    expect(reset.accountId).toBe(current.accountId);
    expect(reset.selection).toBe(current.selection);
    expect(reset.importRevision).toBe(current.importRevision);
    expect(reset.teams.own.mode).toBe("paste");
    expect(reset.teams.opponent.mode).toBe("league");
    for (const role of roles) {
      expect(reset.teams[role].paste).toBe(current.teams[role].paste);
      expect(reset.teams[role].epoch).toBeGreaterThan(current.teams[role].epoch);
    }
    expect(reset.attacker.role).toBe("own");
    expect(reset.defender.role).toBe("opponent");
    expect(reset.attacker.source).toBeNull();
    expect(reset.defender.source).toBeNull();
    expect(reset.attacker.build).toEqual(createBuild("charizard"));
    expect(reset.defender.build).toEqual(createBuild("blastoise"));
    expect(reset.cache.size).toBe(0);
    expect(reset.field).toEqual(createConditions());
    const restored = choose(reset, "own");
    expect(restored.attacker.build).toEqual(reset.teams.own.paste!.team.members[0].build);
    expect(restored.attacker.build).not.toBe(reset.teams.own.paste!.team.members[0].build);
    expect(restored.attacker.moves).toEqual(reset.teams.own.paste!.team.members[0].moves);
    expect(restored.attacker.hpInput).toBe("");
    expect(restored.attacker.megaBase).toBeNull();
    const otherPaste = changeTeamSource(restored, getTeamSourceOwner(restored, "opponent"), "paste");
    expect(choose(otherPaste, "opponent").defender.build).toEqual(reset.teams.opponent.paste!.team.members[0].build);
  });
});

describe("team import SSR: initial importer", () => {
  it("renders both labelled, session-only forms without fetching, applying, removing or showing an unreviewed preview", () => {
    const current = bothPastes();
    const onApply = vi.fn();
    const onRemove = vi.fn();
    const html = renderToStaticMarkup(createElement("div", null, ...roles.map((role) => createElement(PokePasteImporter, {
      key: role, role, owner: getTeamSourceOwner(current, role), applied: null, onApply, onRemove,
    }))));
    assertLabels(html);
    expect(html).toContain('data-paste-importer="own"');
    expect(html).toContain('data-paste-importer="opponent"');
    expect(html).toContain("My team · PokéPaste");
    expect(html).toContain("Opponent · PokéPaste");
    expect(html).toContain("Session only; nothing is saved to your account or a league.");
    expect(html).toContain("Champions Stat Points");
    expect(html).toContain("Traditional EVs/IVs");
    expect(html).toContain("Only https://pokepast.es links are fetched.");
    const actions = html.match(/<button\b[\s\S]*?<\/button>/g) ?? [];
    for (const label of ["Load link and preview", "Preview team text"]) {
      const buttons = actions.filter((button) => button.includes(label));
      expect(buttons).toHaveLength(2);
      for (const button of buttons) expect(button).toContain('disabled=""');
    }
    expect(html).not.toContain("data-paste-preview");
    expect(onApply).not.toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();
  });

  it("renders applied title/text as escaped editable content and removal remains an explicit action", () => {
    const input = imported(RAICHU, '<script>alert("title")</script>');
    input.text += "\n<script>alert(\"text\")</script>";
    const current = install(bind(), "own", input);
    const onApply = vi.fn();
    const onRemove = vi.fn();
    const html = renderToStaticMarkup(createElement(PokePasteImporter, {
      role: "own", owner: getTeamSourceOwner(current, "own"), applied: current.teams.own.paste,
      onApply, onRemove,
    }));
    assertLabels(html);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain(PASTE_URL);
    expect(html).toContain("1 selectable / 1 imported");
    expect(html).toContain("Remove imported team");
    expect(html).toContain("keeps the active Pokémon as manual preparation");
    expect(html).not.toContain("data-paste-preview");
    expect(onApply).not.toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();
  });
});

describe("team import SSR: shared source panels and league context", () => {
  it("keeps the default league-only source selectors controlled, without adding opponent league controls", () => {
    const state = loaded();
    const onLeagueChange = vi.fn();
    const onOpponentChange = vi.fn();
    const onRefresh = vi.fn();
    const select = vi.spyOn(selectControl, "default");
    const html = renderToStaticMarkup(createElement("div", null,
      createElement(MyTeamPicker, { state, onLeagueChange, onRefresh }),
      createElement(OpponentPicker, { state, onOpponentChange, onRefresh }),
    ));
    assertLabels(html);
    expect(html.match(/<select\b/g)).toHaveLength(2);
    expect(html).not.toContain("Opponent league");
    expect(html).toContain("Your team</dt>");
    expect(html).toContain("Rosters provide Pokémon names, not saved sets.");
    const [own, opponent] = select.mock.calls.map(([props]) => props);
    expect(own.value).toBe("league-a");
    expect(opponent.value).toBe("member-away");
    expect(onLeagueChange).not.toHaveBeenCalled();
    expect(onOpponentChange).not.toHaveBeenCalled();
    expect(onRefresh).not.toHaveBeenCalled();
    own.onChange!({ target: { value: "league-b" } } as ChangeEvent<HTMLSelectElement>);
    opponent.onChange!({ target: { value: "" } } as ChangeEvent<HTMLSelectElement>);
    expect(onLeagueChange.mock.calls).toEqual([["league-b"]]);
    expect(onOpponentChange.mock.calls).toEqual([[""]]);
  });

  it("exposes an independent opponent league selector when My team uses a paste, with exact callback IDs", () => {
    const state = loaded();
    const onLeagueChange = vi.fn();
    const onOpponentChange = vi.fn();
    const onRefresh = vi.fn();
    const select = vi.spyOn(selectControl, "default");
    const html = renderToStaticMarkup(createElement(OpponentPicker, { state, onLeagueChange, onOpponentChange, onRefresh }));
    assertLabels(html);
    expect(html.match(/<select\b/g)).toHaveLength(2);
    expect(html).toContain("Opponent league");
    expect(html).toContain("Your league membership</dt>");
    expect(html).toContain("Your imported team stays unchanged.");
    expect(html).not.toContain('value="member-home"');
    expect(onLeagueChange).not.toHaveBeenCalled();
    expect(onOpponentChange).not.toHaveBeenCalled();
    const [league, opponent] = select.mock.calls.map(([props]) => props);
    expect(league.value).toBe("league-a");
    expect(opponent.value).toBe("member-away");
    for (const value of ["league-b", ""]) league.onChange!({ target: { value } } as ChangeEvent<HTMLSelectElement>);
    for (const value of ["member-away", ""]) opponent.onChange!({ target: { value } } as ChangeEvent<HTMLSelectElement>);
    expect(onLeagueChange.mock.calls).toEqual([["league-b"], [""]]);
    expect(onOpponentChange.mock.calls).toEqual([["member-away"], [""]]);
    expect(state.selectedLeagueId).toBe("league-a");
    expect(state.opponentId).toBe("member-away");
  });

  it("directs paste-owned users to the opponent's own league selector when no league is selected", () => {
    const html = renderToStaticMarkup(createElement(OpponentPicker, {
      state: { ...loaded(), selectedLeagueId: "", opponentId: "", data: null, teamsStatus: "idle" },
      onLeagueChange: vi.fn(), onOpponentChange: vi.fn(), onRefresh: vi.fn(),
    }));
    expect(html).toContain("Choose a league above to see its opponents.");
    expect(html).not.toContain("Choose your team in the My team tab");
    const controls = html.match(/<select\b[^>]*>/g)!;
    expect(controls[0]).not.toContain('disabled=""');
    expect(controls[1]).toContain('disabled=""');
    assertLabels(html);
  });

  it.each(["inline", "rail"] as const)("uses the supplied paste panel in the %s picker despite stale league data and highlights only one duplicate", (variant) => {
    const text = `${RAICHU}\n\n${SECOND_RAICHU}\n\nUnknown mascot\n- Thunderbolt`;
    let current = install(bind(), "own", imported(text, "<b>Imported team</b>"));
    current = choose(current, "own", 1);
    const panel = getTeamPanel(current, loaded(), "own");
    const onSelect = vi.fn();
    const html = renderToStaticMarkup(createElement(RosterPicker, {
      state: { ...loaded(), teamsStatus: "error", data: null }, panel,
      role: "own", side: "attacker", activeSource: current.attacker.source, onSelect, variant,
    }));
    const buttons = html.match(/<button\b[\s\S]*?<\/button>/g)!;
    expect(buttons).toHaveLength(3);
    expect(buttons[0]).toContain('aria-pressed="false"');
    expect(buttons[1]).toContain('aria-pressed="true"');
    expect(buttons[1]).toContain("Active");
    expect(buttons[2]).toContain('disabled=""');
    expect(buttons[2]).toContain('aria-describedby="');
    expect(html).toContain("No exact Champions match");
    expect(html).toContain("&lt;b&gt;Imported team&lt;/b&gt;");
    expect(html).not.toContain("Could not load this league");
    expect(html).not.toContain("Blastoise");
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(onSelect).not.toHaveBeenCalled();
    assertLabels(html);
  });

  it("does not fall back to a loaded league when an explicitly empty paste panel is supplied", () => {
    const before = bind();
    const current = changeTeamSource(before, getTeamSourceOwner(before, "own"), "paste");
    const html = renderToStaticMarkup(createElement(RosterPicker, {
      state: loaded(), panel: getTeamPanel(current, loaded(), "own"), role: "own", side: "attacker",
      activeSource: null, onSelect: vi.fn(),
    }));
    expect(html).toContain("Import a PokéPaste link or team text");
    expect(html).not.toContain("data-roster-choice");
    expect(html).not.toContain("Charizard");
    assertLabels(html);
  });

  it("passes role-aware paste panels and exact callback ownership into both summary choosers after Swap", () => {
    const current = swapMatchup(activePastes());
    const state = { ...loaded(), status: "error" as const, teamsStatus: "error" as const, data: null };
    const panels = { own: getTeamPanel(current, state, "own"), opponent: getTeamPanel(current, state, "opponent") };
    const props = summaryProps(current);
    const chooser = vi.spyOn(pokemonChooser, "default");
    const html = renderToStaticMarkup(createElement(MatchupSummary, { ...props, rosterState: state, rosterPanels: panels }));
    expect(props.onRosterSelect).not.toHaveBeenCalled();
    expect(chooser).toHaveBeenCalledTimes(2);
    for (const [chooserProps] of chooser.mock.calls) {
      const side = chooserProps.side;
      const slot = current[side];
      const roster = chooserProps.roster;
      expect(isValidElement(roster)).toBe(true);
      if (!isValidElement<ComponentProps<typeof RosterPicker>>(roster)) throw new Error("Expected a summary roster element");
      expect(roster.type).toBe(RosterPicker);
      expect(roster.props.panel).toBe(panels[slot.role]);
      expect(roster.props.role).toBe(slot.role);
      expect(roster.props.side).toBe(side);
      expect(roster.props.activeSource).toBe(slot.source);
      const choice = panels[slot.role].choices[1];
      roster.props.onSelect(choice);
      expect(props.onRosterSelect).toHaveBeenCalledWith(slot.key, choice);
    }
    expect(html.match(/>Team Pokémon<\/button>/g)).toHaveLength(2);
    expect(html.match(/Imported from team paste/g)).toHaveLength(4);
    for (const position of ["left", "right"]) {
      expect(html).toContain(`aria-label="Raichu ${position} move 1: Protect"`);
      expect(html).toContain(`aria-label="Raichu ${position} move 2: Thunderbolt"`);
      expect(html).toContain(`aria-label="Raichu ${position} move 3: Choose move"`);
      expect(html).toContain(`aria-label="Raichu ${position} move 4: Choose move"`);
    }
    expect(html).not.toContain("data-roster-choice"); // Closed choosers do not duplicate the inline/rail entries.
    assertLabels(html);
  });

  it("respects empty shared paste panels in the summary instead of exposing unrelated league shortcuts", () => {
    let current = bind();
    for (const role of roles) current = changeTeamSource(current, getTeamSourceOwner(current, role), "paste");
    const state = loaded();
    const panels = { own: getTeamPanel(current, state, "own"), opponent: getTeamPanel(current, state, "opponent") };
    const html = renderToStaticMarkup(createElement(MatchupSummary, { ...summaryProps(current), rosterState: state, rosterPanels: panels }));
    expect(html).not.toContain(">Team Pokémon</button>");
    expect(html).toContain("Find left Pokémon");
    expect(html).toContain("Find right Pokémon");
    assertLabels(html);
  });

  it.each([false, true])("retains legacy summary availability without panels (all-disabled league entries=%s)", (disabled) => {
    const state = loaded();
    if (disabled) state.data!.teams = [team("roster-home", "member-home", ["Unknown home mascot"]), team("roster-away", "member-away", ["Unknown away mascot"])];
    const html = renderToStaticMarkup(createElement(MatchupSummary, { ...summaryProps(bind(state)), rosterState: state }));
    expect(html.includes(">Team Pokémon</button>")).toBe(!disabled);
    expect(html).toContain("Find left Pokémon");
    expect(html).toContain("Find right Pokémon");
  });
});
