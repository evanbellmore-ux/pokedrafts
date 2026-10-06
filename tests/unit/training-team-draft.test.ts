import { describe, expect, it } from "vitest";
import { parseTeamImport } from "@/app/lib/battle/team-import";
import type { BattleBuild } from "@/app/lib/battle/types";
import type { SuggestionState, TeamSourceDraft } from "@/app/(app)/training/model/view-types";
import {
  createSetupDraft, emptySource, pasteKey, resolveSetup, resolveTeam, setupKey, teamBlockers, toggleChosen,
} from "@/app/(app)/training/setup/team-draft";
import { exportTeamText } from "@/app/(app)/training/setup/team-export";
import { OPPONENT_ROSTER, OWN_MEMBERS, OWN_ROSTER, PASTE_TEXT, rosterState, runtime, suggestedSet } from "../fixtures/training";

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
