import { beforeAll, describe, expect, it } from "vitest";
import {
  activateMoveSlot, applyTeamPaste, changeBattleGame, changeTeamSource, createMatchup,
  getMoveOwner, getTeamPanel, getTeamSourceOwner, reconcileRosters, replaceMatchupMove,
  resetMatchup, rosterChoices, selectRosterPokemon, swapMatchup, toggleMatchupMechanic,
  toggleMatchupMega, updateImportDraft, updateMatchupBuild, updateMatchupHP, updateMatchupMoveContext,
  type PreparedMatchup, type RosterRole,
} from "@/app/(app)/calculator/roster-prep";
import { createRosterState } from "@/app/(app)/calculator/roster-data";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, validateBuild } from "@/app/lib/battle/model";
import { createMoveSlots } from "@/app/lib/battle/move-defaults";
import { BATTLE_GAMES } from "@/app/lib/battle/profiles";
import { championsRuntime, resolveRuntimeSpecies, type BattleRuntime } from "@/app/lib/battle/runtime";
import { parseTeamImport } from "@/app/lib/battle/team-import";
import type { BattleGame } from "@/app/lib/battle/types";

const nativeText = [
  "Charizard @ Life Orb", "Ability: Blaze", "Level: 50", "EVs: 4 HP / 252 SpA / 252 Spe", "Modest Nature",
  "Tera Type: Fighting", "Gigantamax: Yes", "Dynamax Level: 0", "- Flamethrower", "- Protect",
].join("\n");
const state = createRosterState();
const runtimes = {} as Record<BattleGame, BattleRuntime>;
beforeAll(async () => {
  for (const game of BATTLE_GAMES) runtimes[game] = await loadBattleRuntime(game);
});

function install(current: PreparedMatchup, role: RosterRole, text = nativeText) {
  current = changeTeamSource(current, getTeamSourceOwner(current, role), "paste");
  const team = parseTeamImport(text, "traditional", current.runtime);
  expect(team.members[0].selectable, JSON.stringify(team.members[0].diagnostics)).toBe(true);
  return applyTeamPaste(current, getTeamSourceOwner(current, role), { text, title: `${role} team`, url: null, team });
}
function choose(current: PreparedMatchup, role: RosterRole, index = 0) {
  const side = current.attacker.role === role ? "attacker" : "defender";
  return selectRosterPokemon(current, side, getTeamPanel(current, state, role).choices[index]);
}

describe("game-aware runtime and preparation", () => {
  it.each(BATTLE_GAMES)("creates native defaults only from the %s profile", (game) => {
    const runtime = runtimes[game];
    const current = createMatchup(0, runtime);
    expect(current.runtime).toBe(runtime);
    for (const side of ["attacker", "defender"] as const) {
      expect(current[side].build.game).toBe(game);
      expect(validateBuild(current[side].build, runtime)).toEqual([]);
      expect(runtime.speciesById.has(current[side].build.speciesId)).toBe(true);
      if (game !== "champions") {
        expect(current[side].moves.every((slot) => slot.origin === "suggested" || slot.origin === "empty")).toBe(true);
        expect(current[side].build).toMatchObject({ native: { level: 50, ivs: { hp: 31 }, evs: { hp: 0 } } });
        expect(current[side].build.points).toBeUndefined();
      }
    }
  });

  it.each(BATTLE_GAMES)("keeps the %s runtime cloneable without executable state", (game) => {
    const current = createMatchup(0, runtimes[game]);
    const snapshot = structuredClone(current);
    expect(snapshot).toEqual(current);
    expect(resolveRuntimeSpecies(snapshot.runtime, "Charizard")).toEqual({ status: "resolved", speciesId: "charizard" });
    const next = updateMatchupHP(current, "attacker", "00087");
    expect(current).toEqual(snapshot);
    expect(next.attacker.hpInput).toBe("00087");
  });

  it("does not reset when the same catalog/profile identity is requested", () => {
    const current = updateMatchupHP(createMatchup(), "attacker", "00087");
    expect(changeBattleGame(current, championsRuntime)).toBe(current);
  });

  it("retains both team documents and drafts but clears active preparation on game change", () => {
    let current = choose(install(install(createMatchup(), "own"), "opponent"), "own");
    current = choose(current, "opponent");
    const draft = { text: "unfinished team\nEVs: -", title: "Unsent", url: "https://pokepast.es/0123456789abcdef", format: "champions" as const };
    current = updateImportDraft(current, getTeamSourceOwner(current, "own"), draft);
    current = updateMatchupHP(current, "attacker", "00087");
    const snapshot = structuredClone(current);
    const next = changeBattleGame(current, runtimes.scarlet_violet);
    expect(current).toEqual(snapshot);
    expect(next.cache.size).toBe(0);
    expect(next.attacker.source).toBeNull();
    expect(next.defender.source).toBeNull();
    expect(next.attacker.hpInput).toBe("");
    expect(next.drafts.own).toEqual(draft);
    expect(next.teams.own.mode).toBe("paste");
    expect(next.teams.opponent.mode).toBe("paste");
    for (const role of ["own", "opponent"] as const) {
      expect(next.teams[role].paste?.text).toBe(nativeText);
      expect(next.teams[role].paste?.id).toBe(current.teams[role].paste?.id);
      expect(next.teams[role].paste?.team.runtimeIdentity).toBe(runtimes.scarlet_violet.identity);
      expect(next.teams[role].paste?.team.members[0].build).toMatchObject({ game: "scarlet_violet", native: { evs: { spa: 252 } }, configuration: { teraType: "Fighting" } });
      expect(next.teams[role].paste?.team.members[0].build?.mechanic).toBeUndefined();
    }
    const selected = choose(next, "own");
    expect(selected.attacker.build).toMatchObject({ game: "scarlet_violet", native: { level: 50 }, configuration: { teraType: "Fighting" } });
    expect(selected.attacker.source?.kind).toBe("paste");
    expect(selected.attacker.build.preparedMoves).toEqual(["flamethrower", "protect"]);
  });

  it("namespaces import/roster keys and rejects old game owners and builds", () => {
    const old = install(createMatchup(), "own");
    const owner = getTeamSourceOwner(old, "own");
    const oldChoice = getTeamPanel(old, state, "own").choices[0];
    const current = changeBattleGame(old, runtimes.sword_shield);
    const newChoice = getTeamPanel(current, state, "own").choices[0];
    expect(newChoice.key).not.toBe(oldChoice.key);
    expect(newChoice.source?.runtimeIdentity).toBe(runtimes.sword_shield.identity);
    expect(selectRosterPokemon(current, "attacker", oldChoice)).toBe(current);
    expect(updateMatchupBuild(current, "attacker", createBuild("charizard"))).toBe(current);
    expect(applyTeamPaste(current, owner, old.teams.own.paste!)).toBe(current);
    expect(updateImportDraft(current, owner, { text: "stale", url: "", title: "", format: "traditional" })).toBe(current);
    expect(toggleMatchupMechanic(current, getMoveOwner(old.attacker), "dynamax")).toBe(current);
    const roster = { id: "roster", member_id: "member", total_points: 10, team_name: null, role: null,
      pokemon: [{ name: "Charizard", points: 10, tier: 1, pick_number: 1, acquired: "draft" as const }] };
    expect(rosterChoices("league", roster)[0].key).not.toBe(rosterChoices("league", roster, runtimes.sword_shield)[0].key);
  });

  it("rejects a current-owner paste materialized for a different game", () => {
    const current = changeTeamSource(createMatchup(0, runtimes.sword_shield), getTeamSourceOwner(createMatchup(0, runtimes.sword_shield), "own"), "paste");
    const team = parseTeamImport(nativeText, "traditional", runtimes.scarlet_violet);
    expect(applyTeamPaste(current, getTeamSourceOwner(current, "own"), { text: nativeText, title: "wrong game", url: null, team })).toBe(current);
  });

  it("retains incompatible original source encoding instead of guessing native EVs", () => {
    const text = "Charizard\nAbility: Blaze\nSPs: 32 SpA / 32 Spe\n- Flamethrower";
    let old = changeTeamSource(createMatchup(), getTeamSourceOwner(createMatchup(), "own"), "paste");
    old = applyTeamPaste(old, getTeamSourceOwner(old, "own"), { text, title: "Points", url: null, team: parseTeamImport(text, "champions") });
    const next = changeBattleGame(old, runtimes.scarlet_violet);
    expect(next.teams.own.paste?.text).toBe(text);
    expect(next.teams.own.paste?.team.format).toBe("champions");
    expect(getTeamPanel(next, state, "own").choices[0].source).toBeNull();
    const restored = changeBattleGame(next, championsRuntime);
    expect(getTeamPanel(restored, state, "own").choices[0].source).not.toBeNull();
    expect(restored.cache.size).toBe(0);
  });

  it.each(["own", "opponent"] as const)("keeps %s configuration, raw HP and logical ownership through Max toggles and Swap", (role) => {
    let current = choose(install(createMatchup(0, runtimes.sword_shield), role), role);
    const side = role === "own" ? "attacker" : "defender";
    current = updateMatchupHP(current, side, "00087");
    const moves = current[side].moves;
    const source = current[side].source;
    const active = toggleMatchupMechanic(current, getMoveOwner(current[side]), "gigantamax");
    expect(active[side].build.mechanic).toBe("gigantamax");
    expect(active[side].hpInput).toBe("00087");
    expect(active[side].build.currentHP).toBe(87);
    expect(active[side].moves).toBe(moves);
    const swapped = swapMatchup(active);
    const newSide = side === "attacker" ? "defender" : "attacker";
    expect(swapped[newSide].role).toBe(role);
    expect(swapped[newSide].source).toBe(source);
    expect(swapped[newSide].build.mechanic).toBe("gigantamax");
    const inactive = toggleMatchupMechanic(swapped, getMoveOwner(swapped[newSide]), "gigantamax");
    expect(inactive[newSide].build.mechanic).toBeUndefined();
    expect(inactive[newSide].build.configuration).toEqual(active[side].build.configuration);
    expect(inactive[newSide].hpInput).toBe("00087");
    expect(inactive[newSide].build.currentHP).toBe(87);
  });

  it("invalidates stale attack contexts on transformation and preserves assigned moves", () => {
    let current = choose(install(createMatchup(0, runtimes.ultra_sun_ultra_moon), "own"), "own");
    current = activateMoveSlot(current, getMoveOwner(current.attacker), 0);
    const owner = getMoveOwner(current.attacker);
    current = updateMatchupMoveContext(current, owner, "flamethrower", { useZ: true });
    const next = toggleMatchupMega(current, owner, "charizardmegay");
    expect(next.attacker.build.speciesId).toBe("charizardmegay");
    expect(next.attacker.build.preparedMoves).toEqual(["flamethrower", "protect"]);
    expect(next.attacker.contexts).toEqual({});
    expect(updateMatchupMoveContext(next, owner, "flamethrower", { useZ: false })).toBe(next);
  });

  it("synchronizes native form prerequisite proof when an assigned move changes", () => {
    let current = choose(install(createMatchup(0, runtimes.ultra_sun_ultra_moon), "own"), "own");
    current = activateMoveSlot(current, getMoveOwner(current.attacker), 1);
    const next = replaceMatchupMove(current, current.replacement!, "dragonclaw");
    expect(next.attacker.build.preparedMoves).toEqual(["flamethrower", "dragonclaw"]);
    expect(next.attacker.moves[1].moveId).toBe("dragonclaw");
  });

  it("requires equipped Dragon Ascent and rejects a held Z-Crystal before Rayquaza Mega Evolution", () => {
    const runtime = runtimes.ultra_sun_ultra_moon;
    const missing = "Rayquaza @ Life Orb\nAbility: Air Lock\n- Dragon Claw";
    let current = choose(install(createMatchup(0, runtime), "own", missing), "own");
    const refused = toggleMatchupMega(current, getMoveOwner(current.attacker), "rayquazamega");
    expect(refused.attacker).toBe(current.attacker);
    expect(refused.notice).toContain("Dragon Ascent");
    current = choose(install(current, "own", missing.replace("Dragon Claw", "Dragon Ascent")), "own");
    const active = toggleMatchupMega(current, getMoveOwner(current.attacker), "rayquazamega");
    expect(active.attacker.build).toMatchObject({ speciesId: "rayquazamega", itemId: "lifeorb", abilityId: "deltastream" });
    expect(validateBuild(active.attacker.build, runtime)).toEqual([]);
    const restored = toggleMatchupMega(active, getMoveOwner(active.attacker), "rayquazamega");
    expect(restored.attacker.build).toMatchObject({ speciesId: "rayquaza", itemId: "lifeorb", abilityId: "airlock" });
    const crystal = updateMatchupBuild(current, "attacker", { ...current.attacker.build, itemId: "flyiniumz" });
    const denied = toggleMatchupMega(crystal, getMoveOwner(crystal.attacker), "rayquazamega");
    expect(denied.attacker).toBe(crystal.attacker);
    expect(denied.notice).toContain("Z-Crystal");
  });

  it.each([
    ["Kyogre", "Drizzle", "Surf", "kyogre", "kyogreprimal", "blueorb", "primordialsea"],
    ["Groudon", "Drought", "Earthquake", "groudon", "groudonprimal", "redorb", "desolateland"],
    ["Necrozma-Dusk-Mane", "Prism Armor", "Photon Geyser", "necrozmaduskmane", "necrozmaultra", "ultranecroziumz", "neuroforce"],
    ["Necrozma-Dawn-Wings", "Prism Armor", "Photon Geyser", "necrozmadawnwings", "necrozmaultra", "ultranecroziumz", "neuroforce"],
  ])("restores the exact %s entry after native Primal or Ultra transformation", (name, ability, move, base, form, itemId, abilityId) => {
    const runtime = runtimes.ultra_sun_ultra_moon;
    const text = `${name} @ Leftovers\nAbility: ${ability}\nLevel: 50\n- ${move}`;
    let current = choose(install(createMatchup(0, runtime), "own", text), "own");
    current = updateMatchupHP(current, "attacker", "00087");
    const active = toggleMatchupMega(current, getMoveOwner(current.attacker), form);
    expect(active.attacker.build).toMatchObject({ speciesId: form, itemId, abilityId, currentHP: 87 });
    expect(active.attacker.hpInput).toBe("00087");
    expect(validateBuild(active.attacker.build, runtime)).toEqual([]);
    const restored = toggleMatchupMega(active, getMoveOwner(active.attacker), form);
    expect(restored.attacker.build).toMatchObject({ speciesId: base, itemId: "leftovers", currentHP: 87 });
    expect(restored.attacker.build.abilityId).toBe(current.attacker.build.abilityId);
    expect(restored.attacker.moves).toBe(current.attacker.moves);
    expect(restored.attacker.build.native).toBe(current.attacker.build.native);
    expect(restored.attacker.hpInput).toBe("00087");
  });

  it("keeps two native duplicate-slot preparations independent and restores their own active mechanics", () => {
    const runtime = runtimes.scarlet_violet;
    const text = `${nativeText}\n\n${nativeText.replace("Tera Type: Fighting", "Tera Type: Water")}`;
    let current = choose(install(createMatchup(0, runtime), "own", text), "own", 0);
    const seed = structuredClone(current.teams.own.paste);
    current = toggleMatchupMechanic(current, getMoveOwner(current.attacker), "tera");
    current = updateMatchupHP(current, "attacker", "00087");
    const firstSource = current.attacker.source;
    current = choose(current, "own", 1);
    expect(current.attacker.source?.key).not.toBe(firstSource?.key);
    expect(current.attacker.build.configuration?.teraType).toBe("Water");
    expect(current.attacker.build.mechanic).toBeUndefined();
    current = updateMatchupHP(current, "attacker", "00101");
    current = choose(current, "own", 0);
    expect(current.attacker.build.configuration?.teraType).toBe("Fighting");
    expect(current.attacker.build.mechanic).toBe("tera");
    expect(current.attacker.hpInput).toBe("00087");
    expect(current.teams.own.paste).toEqual(seed);
    const reset = choose(resetMatchup(current), "own", 0);
    expect(reset.attacker.build.mechanic).toBeUndefined();
    expect(reset.attacker.build.currentHP).toBeNull();
  });

  it("gates unsupported mechanic toggles even with valid current ownership", () => {
    const current = createMatchup();
    for (const mechanic of ["tera", "dynamax", "gigantamax"] as const) {
      expect(toggleMatchupMechanic(current, getMoveOwner(current.attacker), mechanic)).toBe(current);
    }
    const sv = createMatchup(0, runtimes.scarlet_violet);
    expect(toggleMatchupMechanic(sv, getMoveOwner(sv.attacker), "dynamax")).toBe(sv);
    expect(toggleMatchupMega(sv, getMoveOwner(sv.attacker), "charizardmegax")).toBe(sv);
  });

  it("Reset keeps game and immutable imported seeds while clearing active preparation", () => {
    let current = choose(install(createMatchup(0, runtimes.scarlet_violet), "own"), "own");
    current = toggleMatchupMechanic(current, getMoveOwner(current.attacker), "tera");
    current = updateMatchupHP(current, "attacker", "87");
    const next = resetMatchup(current);
    expect(next.runtime).toBe(runtimes.scarlet_violet);
    expect(next.teams.own.paste).toBe(current.teams.own.paste);
    expect(next.cache.size).toBe(0);
    expect(next.attacker.build.mechanic).toBeUndefined();
    expect(next.attacker.build.currentHP).toBeNull();
    const selected = choose(next, "own");
    expect(selected.attacker.build.mechanic).toBeUndefined();
    expect(selected.attacker.build.configuration?.teraType).toBe("Fighting");
    expect(selected.attacker.build.currentHP).toBeNull();
  });

  it("clears personal game state on settled anonymous/account transitions, not loading", () => {
    const anonymous = { ...createRosterState(), status: "signed-out" as const };
    let current = reconcileRosters(createMatchup(0, runtimes.sword_shield), anonymous);
    current = choose(install(current, "own"), "own");
    current = updateImportDraft(current, getTeamSourceOwner(current, "own"), { text: "private draft", title: "", url: "", format: "traditional" });
    const loading = reconcileRosters(current, createRosterState());
    expect(loading.runtime).toBe(current.runtime);
    expect(loading.teams.own.paste).toBe(current.teams.own.paste);
    const signedIn = reconcileRosters(loading, { ...createRosterState(), status: "ready", userId: "account-a" });
    expect(signedIn.runtime).toBe(championsRuntime);
    expect(signedIn.teams.own.paste).toBeNull();
    expect(signedIn.drafts).toEqual({});
    expect(signedIn.cache.size).toBe(0);
    expect(signedIn.accountId).toBe("account-a");
    const pending = reconcileRosters(signedIn, createRosterState());
    expect(pending.accountId).toBe("account-a");
    const signedOut = reconcileRosters(pending, anonymous);
    expect(signedOut.accountId).toBeNull();
    expect(signedOut.revision).toBeGreaterThan(pending.revision);
  });

  it("does not borrow per-species Champions usage for the same native species", () => {
    const native = createMoveSlots("charizard", "Doubles", runtimes.scarlet_violet);
    expect(native.some((slot) => slot.origin === "usage")).toBe(false);
    expect(native.filter((slot) => slot.moveId).every((slot) => runtimes.scarlet_violet.speciesById.get("charizard")!.moves.includes(slot.moveId!))).toBe(true);
  });
});
