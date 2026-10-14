import { describe, expect, it } from "vitest";
import { parseTeamImport } from "@/app/lib/battle/team-import";
import type { BattleBuild } from "@/app/lib/battle/types";
import type { SuggestionState, TeamSourceDraft } from "@/app/(app)/training/model/view-types";
import {
  createSetupDraft, emptySource, listNeedsRows, memberLabel, pasteKey, pendingSets, resolveSetup, resolveTeam, setupKey, sharedNames, teamBlockers,
  toggleChosen, withMode,
} from "@/app/(app)/training/setup/team-draft";
import { exportTeamText } from "@/app/(app)/training/setup/team-export";
import { MIRROR_ROSTER, OPPONENT_ROSTER, OWN_MEMBERS, OWN_ROSTER, PASTE_TEXT, rosterState, runtime, suggestedSet } from "../fixtures/training";

const IDLE: SuggestionState = { status: "idle" };

function ready(team: ReturnType<typeof resolveTeam>, extra: Record<string, Partial<Parameters<typeof suggestedSet>[3]>> = {}): Extract<SuggestionState, { status: "ready" }> {
  return {
    status: "ready", key: team.suggestKey!,
    sets: Object.fromEntries(team.suggestMembers.map((member) => [member.key, suggestedSet(member.key, member.speciesId, ["protect", "earthquake"], { abilityId: runtime.speciesById.get(member.speciesId)!.abilities[0], ...extra[member.speciesId] })])),
  };
}

function pasteSource(): TeamSourceDraft {
  return { ...emptySource(), mode: "paste", paste: { id: "own-1", title: "Sand team", url: null, text: PASTE_TEXT, team: parseTeamImport(PASTE_TEXT, "champions", runtime) } };
}

describe("training setup teams", () => {
  it("asks the worker for the first six eligible league members' sets, in roster order", () => {
    const state = rosterState([...OWN_ROSTER, "Not A Pokemon"], OPPONENT_ROSTER);
    const team = resolveTeam(emptySource(), state, "own", IDLE, runtime);
    expect(team.candidates).toHaveLength(8);
    expect(team.candidates.at(-1)).toMatchObject({ eligible: false });
    expect(team.candidates.at(-1)!.reason).toBeTruthy();
    expect(team.chosen).toHaveLength(6);
    expect(team.suggestMembers.map((member) => member.speciesId)).toEqual(["garchomp", "gyarados", "incineroar", "aerodactyl", "aegislash", "aggron"]);
    expect(team.suggestMembers[0]).toMatchObject({ abilityId: null });
    expect(team.suggestion).toBe("loading");
    expect(team.members.every((member) => member === null)).toBe(true);
    expect(team.team).toBeNull();
  });

  it("builds members from the suggested sets (usage label, Protect added, Hardy for an uninvested Serious)", () => {
    const state = rosterState(OWN_ROSTER, OPPONENT_ROSTER);
    const loading = resolveTeam(emptySource(), state, "own", IDLE, runtime);
    const suggestions = ready(loading, { garchomp: { itemId: "lifeorb", nature: "Jolly", points: { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 }, protectAdded: true }, gyarados: { nature: "Serious" } });
    const team = resolveTeam(emptySource(), state, "own", suggestions, runtime);
    expect(team.suggestion).toBe("ready");
    const [garchomp, gyarados] = team.members;
    expect(garchomp).toMatchObject({ origin: "suggested", speciesId: "garchomp", suggestion: { source: "usage", protectAdded: true } });
    expect(garchomp!.build).toMatchObject({ game: "champions", itemId: "lifeorb", nature: "Jolly", points: { hp: 2, atk: 32, spe: 32 } });
    expect(garchomp!.moves.map((slot) => slot.moveId)).toEqual(["protect", "earthquake", null, null]);
    expect(gyarados!.build.nature).toBe("Hardy");
    expect(team.team?.members).toHaveLength(6);
    expect(resolveTeam(emptySource(), state, "own", { ...suggestions, key: "other" }, runtime).members[0]).toBeNull();
  });

  it("lets a set editor result replace a member's set", () => {
    const state = rosterState(OWN_ROSTER, OPPONENT_ROSTER);
    const loading = resolveTeam(emptySource(), state, "own", IDLE, runtime);
    const suggestions = ready(loading);
    const key = loading.chosen[0];
    const edited = { ...OWN_MEMBERS[0].build, itemId: "choicescarf", nature: "Serious", points: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } } as BattleBuild;
    const source: TeamSourceDraft = { ...emptySource(), edits: { [key]: { build: edited, moves: OWN_MEMBERS[0].moves } } };
    const team = resolveTeam(source, state, "own", suggestions, runtime);
    expect(team.members[0]).toMatchObject({ origin: "edited", build: { itemId: "choicescarf", nature: "Hardy" } });
    expect(team.members[0]!.suggestion).toBeUndefined();
  });

  it("clones a paste's sets, so editing the result never touches the paste", () => {
    const source = pasteSource();
    const team = resolveTeam(source, rosterState([], []), "own", IDLE, runtime);
    expect(team.label).toBe("Sand team");
    expect(team.chosen[0]).toBe(pasteKey(runtime, "own", "own-1", 0));
    expect(team.members.map((member) => member?.origin)).toEqual(Array(6).fill("imported"));
    team.members[0]!.build.itemId = "leftovers";
    expect(source.paste!.team.members[0].build!.itemId).toBe("lifeorb");
  });

  it("states a side's missing piece instead of a count when it has nothing to choose from", () => {
    const state = rosterState(OWN_ROSTER, OPPONENT_ROSTER);
    const noOpponent = resolveTeam(emptySource(), { ...state, opponentId: "" }, "opponent", IDLE, runtime);
    expect(noOpponent).toMatchObject({ fact: "No opponent chosen.", blockers: [], candidates: [], team: null });
    const noPaste = resolveTeam({ ...emptySource(), mode: "paste" }, state, "own", IDLE, runtime);
    expect(noPaste).toMatchObject({ fact: "No team imported.", blockers: [], team: null });
    const loadingRosters = resolveTeam(emptySource(), { ...state, teamsStatus: "loading", data: null }, "own", IDLE, runtime);
    expect(loadingRosters).toMatchObject({ fact: "Loading current team rosters…", blockers: [] });
    // No league chosen: your team a paste, the opponent's picker chooses the league ("No league chosen."); else no team.
    const leagueless = { ...state, selectedLeagueId: "", opponentId: "", data: null, teamsStatus: "idle" as const };
    expect(resolveTeam(emptySource(), leagueless, "opponent", IDLE, runtime, "paste")).toMatchObject({ fact: "No league chosen.", message: "No league chosen.", blockers: [] });
    expect(resolveTeam(emptySource(), leagueless, "opponent", IDLE, runtime).fact).toBe("No team chosen.");
    expect(resolveTeam(emptySource(), leagueless, "own", IDLE, runtime, "paste").fact).toBe("No team chosen.");
    expect(resolveTeam(emptySource(), { ...leagueless, leagues: [] }, "opponent", IDLE, runtime, "paste").fact).toBe("No leagues.");
    const ownPaste = createSetupDraft();
    expect(resolveSetup({ ...ownPaste, own: { ...ownPaste.own, mode: "paste" } }, leagueless, { own: IDLE, opponent: IDLE }, runtime).opponent.fact).toBe("No league chosen.");
    // Members that cannot be chosen are still members: the count is the fact.
    const unusable = resolveTeam(emptySource(), rosterState(["Not A Pokemon"], OPPONENT_ROSTER), "own", IDLE, runtime);
    expect(unusable).toMatchObject({ fact: null, blockers: ["Choose 6 (0 chosen)."] });
    expect(resolveTeam(emptySource(), state, "own", IDLE, runtime).fact).toBeNull();
  });

  it("says a side's sets are pending only while a chosen member has none", () => {
    const state = rosterState(OWN_ROSTER, OPPONENT_ROSTER);
    const loading = resolveTeam(emptySource(), state, "own", IDLE, runtime);
    expect(pendingSets(loading)).toBe("loading");
    expect(pendingSets(resolveTeam(emptySource(), state, "own", { status: "error", key: loading.suggestKey!, message: "x" }, runtime))).toBe("error");
    expect(pendingSets(resolveTeam(emptySource(), state, "own", ready(loading), runtime))).toBeNull();
    // Every chosen member edited: nothing waits on the suggestion.
    const edits = Object.fromEntries(loading.chosen.map((key, index) => [key, { build: { ...OWN_MEMBERS[index].build }, moves: OWN_MEMBERS[index].moves }]));
    const edited = resolveTeam({ ...emptySource(), edits }, state, "own", IDLE, runtime);
    expect(edited.suggestion).toBe("loading");
    expect(pendingSets(edited)).toBeNull();
    expect(pendingSets(resolveTeam(pasteSource(), state, "own", IDLE, runtime))).toBeNull();
  });

  it("keeps each source mode's Choose 6 picks across a switch; the same mode is no change", () => {
    const picks = ["a", "b", "c", "d", "e", "f"];
    const league: TeamSourceDraft = { ...emptySource(), chosen: picks };
    expect(withMode(league, "league")).toBe(league);
    const paste = withMode(league, "paste");
    expect(paste).toMatchObject({ mode: "paste", epoch: 1, chosen: null, otherChosen: picks });
    const pastePicks = ["p1", "p2"];
    const back = withMode({ ...paste, chosen: pastePicks }, "league");
    expect(back).toMatchObject({ mode: "league", epoch: 2, chosen: picks, otherChosen: pastePicks });
    expect(withMode(back, "paste")).toMatchObject({ chosen: pastePicks, otherChosen: picks });
    // Back on its roster, the kept picks are the side's six again.
    const state = rosterState(OWN_ROSTER, OPPONENT_ROSTER);
    const first = resolveTeam(emptySource(), state, "own", IDLE, runtime);
    const swapped = [...first.chosen.slice(0, 5), first.candidates[6].key];
    const kept = withMode(withMode({ ...emptySource(), chosen: swapped }, "paste"), "league");
    expect(resolveTeam(kept, state, "own", IDLE, runtime).chosen).toEqual(swapped);
  });

  it("names a mirror's members by team, and only those", () => {
    const state = rosterState(OWN_ROSTER, MIRROR_ROSTER);
    const own = resolveTeam(emptySource(), state, "own", IDLE, runtime);
    const opponent = resolveTeam(emptySource(), state, "opponent", IDLE, runtime);
    const shared = sharedNames(own, opponent);
    expect([...shared]).toEqual(["Garchomp"]);
    expect(memberLabel("Garchomp", "own", shared)).toBe("Garchomp (yours)");
    expect(memberLabel("Garchomp", "opponent", shared)).toBe("Garchomp (opponent's)");
    expect(memberLabel("Gyarados", "own", shared)).toBe("Gyarados");
    expect(sharedNames(own, resolveTeam(emptySource(), rosterState(OWN_ROSTER, OPPONENT_ROSTER), "opponent", IDLE, runtime)).size).toBe(0);
  });

  it("opens a Choose 6 list for what needs its rows, not for sets still loading", () => {
    const state = rosterState(OWN_ROSTER, OPPONENT_ROSTER);
    const loading = resolveTeam(emptySource(), state, "own", IDLE, runtime);
    expect(pendingSets(loading)).toBe("loading");
    expect(listNeedsRows(loading, 0)).toBe(false);
    const team = resolveTeam(emptySource(), state, "own", ready(loading), runtime);
    expect(listNeedsRows(team, 0)).toBe(false);
    expect(listNeedsRows(team, 1)).toBe(true);
    expect(listNeedsRows({ ...team, chosen: team.chosen.slice(0, 5) }, 0)).toBe(true);
    expect(listNeedsRows({ ...team, blockers: ["Item Clause: Life Orb on Garchomp and Gyarados."] }, 0)).toBe(true);
    const failed = resolveTeam(emptySource(), state, "own", { status: "error", key: loading.suggestKey!, message: "No usage data." }, runtime);
    expect(listNeedsRows(failed, 0)).toBe(true);
  });

  it("caps Choose 6 at six and keeps roster order", () => {
    const state = rosterState(OWN_ROSTER, OPPONENT_ROSTER);
    const team = resolveTeam(emptySource(), state, "own", IDLE, runtime);
    const seventh = team.candidates[6].key;
    expect(toggleChosen(team, seventh)).toEqual(team.chosen);
    const fewer = toggleChosen(team, team.chosen[1]);
    expect(fewer).toHaveLength(5);
    expect(toggleChosen({ ...team, chosen: fewer }, seventh)).toEqual([...fewer, seventh]);
    expect(toggleChosen({ ...team, chosen: fewer }, team.chosen[1])).toEqual(team.chosen);
  });

  it("words count, Species Clause, Item Clause and Stat Point blockers as facts", () => {
    const [garchomp, gyarados, incineroar] = OWN_MEMBERS;
    const mega = { ...garchomp, key: "mega", name: "Garchomp-Mega", speciesId: "garchompmega", build: { ...garchomp.build, speciesId: "garchompmega", itemId: "garchompite" } };
    const sameItem = { ...incineroar, build: { ...incineroar.build, itemId: "sitrusberry" } };
    const tooMany = { ...gyarados, build: gyarados.build.game === "champions" ? { ...gyarados.build, points: { hp: 32, atk: 32, def: 32, spa: 0, spd: 0, spe: 0 } } : gyarados.build };
    expect(teamBlockers([garchomp, mega, gyarados, sameItem], 4, runtime)).toEqual([
      "Choose 6 (4 chosen).", "Species Clause: Garchomp twice.", "Item Clause: Sitrus Berry on Gyarados and Incineroar.",
    ]);
    expect(teamBlockers([tooMany], 6, runtime)).toEqual(["Gyarados: At most 66 Stat Points in total (96)."]);
  });

  it("makes a setup once both teams are complete; its key follows every build", () => {
    const state = rosterState(OWN_ROSTER, OPPONENT_ROSTER);
    const draft = createSetupDraft();
    const loading = resolveSetup(draft, state, { own: IDLE, opponent: IDLE }, runtime);
    expect(loading.setup).toBeNull();
    const suggestions = { own: ready(loading.own), opponent: ready(loading.opponent) };
    const resolved = resolveSetup(draft, state, suggestions, runtime);
    expect(resolved.setup?.own.members).toHaveLength(6);
    expect(resolved.setup?.opponent.label).toBe("Away");
    expect(resolved.setup?.info).toBe(draft.info);
    const changed = { ...resolved.setup!.own, members: resolved.setup!.own.members.map((member, index) => index ? member : { ...member, build: { ...member.build, itemId: "leftovers" } }) };
    expect(setupKey(changed, resolved.setup!.opponent)).not.toBe(resolved.key);
  });

  it("exports the six as Champions text that parseTeamImport reads back", () => {
    const text = exportTeamText(OWN_MEMBERS, runtime);
    expect(text.split("\n\n")[0]).toBe("Garchomp @ Life Orb\nAbility: Rough Skin\nLevel: 50\nSPs: 2 HP / 32 Atk / 32 Spe\nJolly Nature\n- Earthquake\n- Dragon Claw\n- Rock Slide\n- Protect");
    const parsed = parseTeamImport(text, "champions", runtime);
    expect(parsed.members.every((member) => member.selectable)).toBe(true);
    parsed.members.forEach((member, index) => {
      const source = OWN_MEMBERS[index];
      expect(member.speciesId).toBe(source.speciesId);
      expect(member.build).toMatchObject({ itemId: source.build.itemId, abilityId: source.build.abilityId, nature: source.build.nature });
      expect(member.build?.game === "champions" && member.build.points).toEqual(source.build.game === "champions" ? { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...Object.fromEntries(Object.entries(source.build.points).filter(([, value]) => value)) } : null);
      expect(member.moves.map((slot) => slot.moveId)).toEqual(source.moves.map((slot) => slot.moveId));
    });
  });
});
