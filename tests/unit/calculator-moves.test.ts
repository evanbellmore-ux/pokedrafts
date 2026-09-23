import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import {
  activateMoveSlot, createMatchup, dismissMoveReplacement, getAttackView, getMoveOwner, getRosterPanel,
  reconcileRosters, replaceMatchupMove, resetMatchup, sameMoveOwner, selectMatchupMove, selectRosterPokemon,
  swapMatchup, updateMatchupBuild, updateMatchupHP, updateMatchupMoveContext,
  type BattleSide, type MoveOwner, type PreparedMatchup,
} from "@/app/(app)/calculator/roster-prep";
import type { CalculatorRosterState } from "@/app/(app)/calculator/roster-data";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { movesById, speciesById } from "@/app/lib/battle/catalog";
import { createBuild, createConditions, SHARED_FIELD_EFFECTS } from "@/app/lib/battle/model";
import { createMoveSlots } from "@/app/lib/battle/move-defaults";

function rosterState(): CalculatorRosterState {
  const team = (id: string, memberId: string, names: string[]) => ({
    id, member_id: memberId, total_points: 0, team_name: null, role: null,
    pokemon: names.map((name, index) => ({ name, points: 0, tier: 1, pick_number: index + 1, acquired: "draft" as const })),
  });
  return {
    status: "ready", userId: "account", selectedLeagueId: "league", opponentId: "other", teamsStatus: "ready",
    message: null, teamsMessage: null,
    leagues: [{ id: "league", name: "League", memberId: "own", teamName: "Home", draftStarted: true, draftCompleted: true }],
    data: {
      leagueId: "league",
      members: [
        { id: "own", role: "coach", team_name: "Home", draft_position: 1 },
        { id: "other", role: "coach", team_name: "Away", draft_position: 2 },
      ],
      teams: [
        team("own-team", "own", ["Charizard", "Blastoise", "Mega Charizard X", "Charizard-Mega-X"]),
        team("other-team", "other", ["Charizard", "Venusaur"]),
      ],
    },
  };
}

function prepared(state = rosterState()) {
  const own = getRosterPanel(state, "own").choices;
  const other = getRosterPanel(state, "opponent").choices;
  let current = reconcileRosters(createMatchup(), state);
  current = selectRosterPokemon(current, "attacker", own[0]);
  current = selectRosterPokemon(current, "defender", other[0]);
  return { current, state, own, other };
}

function activate(current: PreparedMatchup, side: BattleSide = "attacker", slotIndex = 0) {
  return activateMoveSlot(current, getMoveOwner(current[side]), slotIndex);
}

function unpreparedMove(current: PreparedMatchup, side: BattleSide = "attacker", except: string[] = []) {
  const slot = current[side];
  const id = speciesById.get(slot.build.speciesId)!.moves.find((id) => !except.includes(id) && !slot.moves.some((entry) => entry.moveId === id));
  expect(id).toBeDefined();
  return id!;
}

function withBothContexts(current: PreparedMatchup) {
  current = activate(current, "attacker");
  current = updateMatchupMoveContext(current, getMoveOwner(current.attacker), "flamethrower", { hits: 2 });
  current = activate(current, "defender");
  return updateMatchupMoveContext(current, getMoveOwner(current.defender), "flamethrower", { hits: 5 });
}

function expectCleared(current: PreparedMatchup) {
  expect(current.attacker.contexts).toEqual({});
  expect(current.defender.contexts).toEqual({});
  expect(current.attack).toEqual({ owner: getMoveOwner(current.attacker), moveId: null });
  expect(current.replacement).toBeNull();
}

function expectRejectedOwner(current: PreparedMatchup, owner: MoveOwner) {
  expect(activateMoveSlot(current, owner, 0)).toBe(current);
  expect(selectMatchupMove(current, "flamethrower", owner)).toBe(current);
  expect(selectMatchupMove(current, null, owner)).toBe(current);
  expect(updateMatchupMoveContext(current, owner, "flamethrower", { hits: 3 })).toBe(current);
}

describe("prepared quick moves", () => {
  it("initializes independent Doubles defaults without choosing an attack or changing HP", () => {
    const current = createMatchup(4);
    expect(current.field.gameType).toBe("Doubles");
    for (const side of ["attacker", "defender"] as const) {
      const slot = current[side];
      expect(slot.moves).toEqual(createMoveSlots(slot.build.speciesId, "Doubles"));
      expect(slot.moves).toHaveLength(4);
      expect(slot.build.currentHP).toBeNull();
      expect(slot.hpInput).toBe("");
      expect(slot.moveEpoch).toBe(0);
      expect(slot.moves).not.toBe(createMatchup(4)[side].moves);
    }
    expect(current.attacker.contexts).not.toBe(current.defender.contexts);
    expect(current.replacementSession).toBe(0);
    expect(current).not.toHaveProperty("selectedMoveId");
    expect(current).not.toHaveProperty("contexts");
    expectCleared(current);
  });

  it.each(["attacker", "defender"] as const)("activates a %s slot atomically without moving cards or editing any preparation", (side) => {
    const { current } = prepared();
    const before = structuredClone(current);
    const owner = getMoveOwner(current[side]);
    const next = activateMoveSlot(current, owner, 2);
    expect(next.attack).toEqual({ owner, moveId: current[side].moves[2].moveId });
    expect(next.replacement).toEqual({ owner, slotIndex: 2, session: 1 });
    expect(next.replacementSession).toBe(1);
    for (const key of ["attacker", "defender", "field", "cache", "selection"] as const) expect(next[key]).toBe(current[key]);
    expect(current).toEqual(before);
    const reopened = activateMoveSlot(next, owner, 2);
    expect(reopened.replacement!.session).toBe(2);
    expect(reopened.attack).toEqual(next.attack);
  });

  it("activates an empty slot without applying or preserving a previous attack", () => {
    let current = updateMatchupBuild(createMatchup(), "defender", createBuild("ditto"));
    current = selectMatchupMove(current, "flamethrower");
    expect(current.defender.moves.every((slot) => slot.moveId === null)).toBe(true);
    const next = activate(current, "defender", 3);
    expect(next.attack).toEqual({ owner: getMoveOwner(current.defender), moveId: null });
    expect(next.replacement!.slotIndex).toBe(3);
    expect(getAttackView(next).source).toBe(current.defender);
    expect(next.attacker.build.currentHP).toBeNull();
    expect(next.defender.build.currentHP).toBeNull();
    const chosen = replaceMatchupMove(next, next.replacement!, "transform");
    expect(chosen.defender.moves[3]).toEqual({ moveId: "transform", origin: "manual", gameType: null });
    expect(chosen.attack).toEqual({ owner: getMoveOwner(chosen.defender), moveId: "transform" });
    expect(chosen.replacement).toEqual({ ...next.replacement, session: next.replacementSession + 1 });
    expect(chosen.replacementSession).toBe(next.replacementSession + 1);
    expect(getAttackView(chosen).sourceSide).toBe("defender");
  });

  it.each(["attacker", "defender"] as const)("allows full-learnset %s exploration without rewriting the four slots", (side) => {
    let current = activate(prepared().current, side);
    current = dismissMoveReplacement(current, current.replacement!);
    const before = structuredClone(current);
    const owner = getMoveOwner(current[side]);
    expect(current[side].moves.some((slot) => slot.moveId === "protect")).toBe(false);
    const next = selectMatchupMove(current, "protect", owner);
    expect(next.attack).toEqual({ owner, moveId: "protect" });
    expect(next[side]).toBe(current[side]);
    expect(next.cache).toBe(current.cache);
    expect(next.replacement).toBeNull();
    expect(selectMatchupMove(next, "protect", owner)).toBe(next);
    for (const id of speciesById.get(current[side].build.speciesId)!.moves) {
      expect(selectMatchupMove(current, id, owner).attack.moveId).toBe(id);
    }
    expect(current).toEqual(before);
  });

  it("preserves moves, contexts, selection and replacement through ordinary build, HP and format edits", () => {
    let current = withBothContexts(prepared().current);
    const before = structuredClone(current);
    const hp = updateMatchupHP(current, "attacker", "2e1");
    assert(hp.defender.build.game === "champions");
    assert(before.defender.build.game === "champions");
    const build = updateMatchupBuild(hp, "defender", { ...hp.defender.build, nature: "Timid", points: { ...hp.defender.build.points, spa: null } });
    current = { ...build, field: { ...build.field, gameType: "Singles", gravity: true } };
    expect(current.attack).toBe(hp.attack);
    expect(current.replacement).toBe(hp.replacement);
    for (const side of ["attacker", "defender"] as const) {
      expect(current[side].moves).toBe(hp[side].moves);
      expect(current[side].contexts).toBe(hp[side].contexts);
      expect(current[side].moveEpoch).toBe(hp[side].moveEpoch);
      expect(current.cache.get(current[side].source!.key)!.moves).toBe(current[side].moves);
    }
    expect(hp.defender.build.points.spa).toBe(before.defender.build.points.spa);
    expect(current.attacker.hpInput).toBe("2e1");
    const manual = updateMatchupBuild(current, "defender", createBuild("venusaur"));
    expect(manual.defender.moves).toEqual(createMoveSlots("venusaur", "Singles"));
    expect(manual.attacker.moves).toBe(current.attacker.moves);
    expectCleared(manual);
  });
});

describe("owned replacement sessions", () => {
  it("replaces exactly one slot, selects it and renews the active editing token without disturbing preparation", () => {
    let current = withBothContexts(prepared().current);
    current = updateMatchupHP(current, "defender", "abc");
    const before = structuredClone(current);
    const replacement = current.replacement!;
    const next = replaceMatchupMove(current, { ...replacement, owner: { ...replacement.owner } }, "protect");
    expect(next.defender.moves[replacement.slotIndex]).toEqual({ moveId: "protect", origin: "manual", gameType: null });
    current.defender.moves.forEach((slot, index) => {
      if (index !== replacement.slotIndex) expect(next.defender.moves[index]).toBe(slot);
    });
    expect(next.attack).toEqual({ owner: getMoveOwner(current.defender), moveId: "protect" });
    expect(next.replacement).toEqual({ ...replacement, session: current.replacementSession + 1 });
    expect(next.replacement).not.toBe(replacement);
    expect(getAttackView(next).sourceSide).toBe("defender");
    expect(next.replacementSession).toBe(current.replacementSession + 1);
    expect(next.attacker).toBe(current.attacker);
    expect(next.defender.contexts).toBe(current.defender.contexts);
    expect(next.defender.build).toBe(current.defender.build);
    expect(next.defender.hpInput).toBe("abc");
    expect(next.defender.moveEpoch).toBe(current.defender.moveEpoch);
    expect(next.field).toBe(current.field);
    const cached = next.cache.get(current.defender.source!.key)!;
    expect(Object.keys(cached).sort()).toEqual(["build", "hpInput", "megaBase", "moves", "source"]);
    expect(cached.megaBase).toBe(current.defender.megaBase);
    expect(cached.moves).toBe(next.defender.moves);
    expect(cached.build).toBe(current.defender.build);
    expect(cached.hpInput).toBe("abc");
    expect(next.cache.get(current.attacker.source!.key)).toBe(current.cache.get(current.attacker.source!.key));
    expect(current).toEqual(before);
    expect(replaceMatchupMove(next, replacement, unpreparedMove(next, "defender"))).toBe(next);
    expect(dismissMoveReplacement(next, replacement)).toBe(next);
    const reopened = activate(next, "defender", replacement.slotIndex);
    expect(reopened.attack.moveId).toBe("protect");
    expect(reopened.replacement!.session).toBeGreaterThan(replacement.session);
    expect(replaceMatchupMove(reopened, replacement, unpreparedMove(reopened, "defender"))).toBe(reopened);
    const dismissed = dismissMoveReplacement(reopened, reopened.replacement!);
    expect(dismissed.replacement).toBeNull();
    expect(dismissed.attack).toBe(reopened.attack);
    expect(dismissed.defender.moves).toBe(reopened.defender.moves);
    expect(dismissMoveReplacement(dismissed, reopened.replacement!)).toBe(dismissed);
  });

  it.each(["attacker", "defender"] as const)("continues replacing the same %s slot, allowing its now-unassigned previous move again", (side) => {
    let current = activate(withBothContexts(prepared().current), side, 2);
    current = updateMatchupHP(current, side, "00100");
    const original = current;
    const replacedOut = current[side].moves[2].moveId!;
    const firstToken = current.replacement!;
    const first = replaceMatchupMove(current, firstToken, "protect");
    expect(first.attack.moveId).toBe("protect");
    expect(first.replacement).toEqual({ ...firstToken, session: firstToken.session + 1 });
    expect(first[side].moves.some((slot) => slot.moveId === replacedOut)).toBe(false);
    const secondToken = first.replacement!;
    const second = replaceMatchupMove(first, secondToken, replacedOut);
    expect(second.attack.moveId).toBe(replacedOut);
    expect(second[side].moves[2]).toEqual({ moveId: replacedOut, origin: "manual", gameType: null });
    expect(second.replacement).toEqual({ ...secondToken, session: secondToken.session + 1 });
    for (const old of [firstToken, secondToken]) {
      expect(replaceMatchupMove(second, old, "protect")).toBe(second);
      expect(dismissMoveReplacement(second, old)).toBe(second);
    }
    for (const next of [first, second]) {
      for (const key of ["revision", "accountId", "selection", "field"] as const) expect(next[key]).toBe(original[key]);
      expect(next[side].build).toBe(original[side].build);
      expect(next[side].contexts).toBe(original[side].contexts);
      expect(next[side].hpInput).toBe("00100");
      expect(next[side].moveEpoch).toBe(original[side].moveEpoch);
      expect(next[side].source).toBe(original[side].source);
      expect(next[side].editorRevision).toBe(original[side].editorRevision);
      expect(next[side === "attacker" ? "defender" : "attacker"]).toBe(original[side === "attacker" ? "defender" : "attacker"]);
      expect(getAttackView(next).sourceSide).toBe(side);
      expect(next.cache.get(next[side].source!.key)!.moves).toBe(next[side].moves);
    }
    const done = dismissMoveReplacement(second, second.replacement!);
    expect(done).toEqual({ ...second, replacement: null });
    expect(done.attack).toBe(second.attack);
    expect(done.cache).toBe(second.cache);
  });

  it("keeps current-slot actions as exact no-ops without changing usage provenance", () => {
    const current = activate(prepared().current);
    const id = current.attacker.moves[0].moveId!;
    expect(id).not.toBeNull();
    expect(replaceMatchupMove(current, current.replacement!, id)).toBe(current);
  });

  it("permits the other Pokémon to prepare the same move without sharing a moveset", () => {
    let current = activate(prepared().current);
    current = replaceMatchupMove(current, current.replacement!, "protect");
    current = activate(current, "defender");
    const next = replaceMatchupMove(current, current.replacement!, "protect");
    expect(next.attacker.moves[0].moveId).toBe("protect");
    expect(next.defender.moves[0].moveId).toBe("protect");
    expect(next.attacker.moves).not.toBe(next.defender.moves);
    expect(next.attacker.moves[0]).not.toBe(next.defender.moves[0]);
  });

  it.each(["protect", "bulletseed", "ragefist", "nightshade", "growth"])("allows legal status, contextual, zero-power or unsupported candidate %s", (moveId) => {
    const species = [...speciesById.values()].find((entry) => entry.moves.includes(moveId))!;
    expect(species).toBeDefined();
    let current = updateMatchupBuild(createMatchup(), "attacker", createBuild(species.id));
    const index = Math.max(0, current.attacker.moves.findIndex((slot) => slot.moveId === moveId));
    current = activate(current, "attacker", index);
    // If it was a default, first clear this particular position with another legal pick.
    if (current.attacker.moves[index].moveId === moveId) {
      current = replaceMatchupMove(current, current.replacement!, unpreparedMove(current));
      current = activate(current, "attacker", index);
    }
    const next = replaceMatchupMove(current, current.replacement!, moveId);
    expect(next.attacker.moves[index]).toEqual({ moveId, origin: "manual", gameType: null });
    expect(next.attack).toEqual({ owner: getMoveOwner(current.attacker), moveId });
    expect(next.replacement).toEqual({ ...current.replacement, session: current.replacementSession + 1 });
    expect(next.replacementSession).toBe(current.replacementSession + 1);
  });

  it("rejects duplicate, unknown, differently spelled and unlearned IDs on the exact source", () => {
    const current = activate(prepared().current);
    const duplicate = current.attacker.moves[1].moveId!;
    expect(movesById.has("surf")).toBe(true);
    expect(speciesById.get("charizard")!.moves).not.toContain("surf");
    for (const id of [duplicate, "", "madeupmove", "Protect", " protect ", "surf"]) {
      expect(replaceMatchupMove(current, current.replacement!, id)).toBe(current);
    }
    for (const id of ["", "madeupmove", "Protect", " protect ", "surf"]) {
      expect(selectMatchupMove(current, id)).toBe(current);
      expect(updateMatchupMoveContext(current, current.attack.owner, id, { hits: 2 })).toBe(current);
    }
  });

  it.each([-1, 4, 0.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid slot index %s", (slotIndex) => {
    const current = activate(prepared().current);
    expect(activateMoveSlot(current, getMoveOwner(current.attacker), slotIndex)).toBe(current);
    const replacement = { ...current.replacement!, slotIndex };
    expect(replaceMatchupMove(current, replacement, "protect")).toBe(current);
    expect(dismissMoveReplacement(current, replacement)).toBe(current);
    const malformed = { ...current, replacement };
    expect(replaceMatchupMove(malformed, replacement, "protect")).toBe(malformed);
  });

  it("requires matching session, owner, slot and active direction even for otherwise legal moves", () => {
    const current = activate(prepared().current);
    const replacement = current.replacement!;
    for (const stale of [
      { ...replacement, session: replacement.session + 1 },
      { ...replacement, session: Number.NaN },
      { ...replacement, slotIndex: 1 },
      { ...replacement, owner: getMoveOwner(current.defender) },
      { ...replacement, owner: { ...replacement.owner, epoch: replacement.owner.epoch + 1 } },
      { ...replacement, owner: { ...replacement.owner, key: 999 } },
    ]) {
      expect(replaceMatchupMove(current, stale, "protect")).toBe(current);
      expect(dismissMoveReplacement(current, stale)).toBe(current);
    }
    const differentSource = { ...current, attack: { owner: getMoveOwner(current.defender), moveId: null } };
    expect(replaceMatchupMove(differentSource, replacement, "protect")).toBe(differentSource);
    const expired = { ...current, attacker: { ...current.attacker, moveEpoch: current.attacker.moveEpoch + 1 } };
    expect(replaceMatchupMove(expired, replacement, "protect")).toBe(expired);
  });

  it("rejects callbacks after dismissal, reopening the same slot, another slot, or returning to the same direction", () => {
    const original = activate(prepared().current);
    const replacement = original.replacement!;
    const dismissed = dismissMoveReplacement(original, replacement);
    const sameSlot = activate(dismissed);
    const differentSlot = activate(original, "attacker", 1);
    const otherDirection = activate(original, "defender");
    const backAgain = activate(otherDirection);
    for (const next of [dismissed, sameSlot, differentSlot, otherDirection, backAgain]) {
      expect(replaceMatchupMove(next, replacement, "protect")).toBe(next);
      expect(dismissMoveReplacement(next, replacement)).toBe(next);
    }
    expect(sameSlot.replacement!.session).toBeGreaterThan(replacement.session);
    expect(backAgain.replacement!.session).toBeGreaterThan(otherDirection.replacement!.session);
    expect(backAgain.attack.owner).toEqual(original.attack.owner);
  });
});

describe("move ownership and transient contexts", () => {
  it("compares both logical key and uncached epoch", () => {
    const current = createMatchup();
    const owner = getMoveOwner(current.attacker);
    expect(owner).toEqual({ key: current.attacker.key, epoch: current.attacker.moveEpoch });
    expect(sameMoveOwner(owner, { ...owner })).toBe(true);
    expect(sameMoveOwner(owner, { ...owner, epoch: owner.epoch + 1 })).toBe(false);
    expect(sameMoveOwner(owner, getMoveOwner(current.defender))).toBe(false);
    expect(sameMoveOwner(owner, { ...owner, key: 100 })).toBe(false);
  });

  it("rejects stale and inactive-source list/context callbacks", () => {
    const current = activate(prepared().current);
    for (const owner of [
      { ...current.attack.owner, epoch: current.attack.owner.epoch - 1 },
      { ...current.attack.owner, epoch: Number.NaN },
      { ...current.attack.owner, key: 999 },
    ]) expectRejectedOwner(current, owner);
    const inactive = getMoveOwner(current.defender);
    expect(selectMatchupMove(current, "flamethrower", inactive)).toBe(current);
    expect(selectMatchupMove(current, null, inactive)).toBe(current);
    expect(updateMatchupMoveContext(current, inactive, "flamethrower", { hits: 5 })).toBe(current);
    const reverse = activateMoveSlot(current, inactive, 0);
    expect(selectMatchupMove(reverse, "flamethrower", current.attack.owner)).toBe(reverse);
    expect(updateMatchupMoveContext(reverse, current.attack.owner, "flamethrower", { hits: 2 })).toBe(reverse);
  });

  it("validates the exact active learnset rather than the physical left or global catalog", () => {
    const current = activate(createMatchup(), "defender");
    const owner = getMoveOwner(current.defender);
    expect(selectMatchupMove(current, "surf", owner).attack.moveId).toBe("surf");
    expect(selectMatchupMove(current, "flamethrower", owner)).toBe(current);
    expect(updateMatchupMoveContext(current, owner, "flamethrower", { hits: 2 })).toBe(current);
    expect(updateMatchupMoveContext(current, owner, "surf", { hits: 2 }).defender.contexts).toEqual({ surf: { hits: 2 } });
    expect(replaceMatchupMove(current, current.replacement!, "flamethrower")).toBe(current);
  });

  it("updates only the active Pokémon's context immutably, without putting transient state in cache", () => {
    const current = activate(prepared().current, "defender");
    const before = structuredClone(current);
    const context = { hits: 4 };
    const next = updateMatchupMoveContext(current, getMoveOwner(current.defender), "flamethrower", context);
    expect(next.defender.contexts).toEqual({ flamethrower: { hits: 4 } });
    expect(next.defender.contexts.flamethrower).not.toBe(context);
    expect(next.attacker).toBe(current.attacker);
    expect(next.defender.moves).toBe(current.defender.moves);
    expect(next.defender.build).toBe(current.defender.build);
    expect(next.cache).toBe(current.cache);
    expect(next.attack).toBe(current.attack);
    expect(next.replacement).toBe(current.replacement);
    expect(current).toEqual(before);
    const cleared = updateMatchupMoveContext(next, getMoveOwner(next.defender), "flamethrower", {});
    expect(cleared.defender.contexts.flamethrower).toEqual({});
    expect(next.defender.contexts.flamethrower.hits).toBe(4);
  });

  it("isolates identical move hit counts and preserves each context when direction changes", () => {
    let current = updateMatchupBuild(createMatchup(), "attacker", { ...createBuild("chesnaught"), abilityId: "overgrow" });
    current = updateMatchupBuild(current, "defender", { ...createBuild("chesnaught"), abilityId: "overgrow" });
    current = updateMatchupMoveContext(current, getMoveOwner(current.attacker), "bulletseed", { hits: 2 });
    current = selectMatchupMove(current, "bulletseed");
    const left = getAttackView(current);
    const two = calculateMatchup(left.source.build, left.receiver.build, left.field, left.contexts).results.find((entry) => entry.moveId === "bulletseed")!;
    current = activate(current, "defender");
    current = updateMatchupMoveContext(current, getMoveOwner(current.defender), "bulletseed", { hits: 5 });
    current = selectMatchupMove(current, "bulletseed");
    const right = getAttackView(current);
    const five = calculateMatchup(right.source.build, right.receiver.build, right.field, right.contexts).results.find((entry) => entry.moveId === "bulletseed")!;
    expect(two).toMatchObject({ kind: "calculated", hits: 2 });
    expect(five).toMatchObject({ kind: "calculated", hits: 5 });
    expect(five.min).toBeGreaterThan(two.max!);
    expect(right.contexts).toBe(current.defender.contexts);
    expect(left.contexts).not.toBe(right.contexts);
    const backAgain = activate(current);
    expect(backAgain.attacker.contexts).toEqual({ bulletseed: { hits: 2 } });
    expect(backAgain.defender.contexts).toEqual({ bulletseed: { hits: 5 } });
    expect(backAgain.attacker.moveEpoch).toBe(current.attacker.moveEpoch);
    expect(backAgain.defender.moveEpoch).toBe(current.defender.moveEpoch);
    expect(getAttackView(backAgain).contexts).toBe(left.contexts);
  });
});

describe("move lifecycle and roster caching", () => {
  it("restores exact moves and provenance across format changes rather than reseeding cached entries", () => {
    const { own } = prepared();
    let current = activate(prepared().current);
    current = replaceMatchupMove(current, current.replacement!, "protect");
    current = updateMatchupMoveContext(current, current.attack.owner, "flamethrower", { hits: 4 });
    const saved = current.attacker.moves;
    current = { ...current, field: { ...current.field, gameType: "Singles" } };
    const different = selectRosterPokemon(current, "attacker", own[1]);
    expect(different.attacker.moves).toEqual(createMoveSlots("blastoise", "Singles"));
    const restored = selectRosterPokemon(different, "attacker", own[0]);
    expect(restored.attacker.moves).toBe(saved);
    expect(restored.attacker.moves[0]).toEqual({ moveId: "protect", origin: "manual", gameType: null });
    expect(restored.attacker.moves.slice(1)).toEqual(createMoveSlots("charizard", "Doubles").slice(1));
    expect(restored.attacker.moveEpoch).toBeGreaterThan(current.attacker.moveEpoch);
    expect(restored.attacker.editorRevision).toBeGreaterThan(current.attacker.editorRevision);
    expect(restored.cache.get(own[0].source!.key)!.moves).toBe(saved);
    expectCleared(restored);
    expect(selectRosterPokemon(current, "attacker", own[0])).toBe(current);
  });

  it("keeps distinct same-species roster identities independent and preserves outgoing cache after manual selection", () => {
    const { own } = prepared();
    let current = selectRosterPokemon(prepared().current, "attacker", own[2]);
    current = activate(current);
    current = replaceMatchupMove(current, current.replacement!, "protect");
    const first = current.attacker.moves;
    current = selectRosterPokemon(current, "attacker", own[3]);
    expect(current.attacker.moves).toEqual(createMoveSlots("charizardmegax", "Doubles"));
    expect(current.attacker.moves).not.toBe(first);
    current = activate(current);
    current = replaceMatchupMove(current, current.replacement!, unpreparedMove(current, "attacker", ["protect"]));
    const second = current.attacker.moves;
    const manual = updateMatchupBuild(current, "attacker", createBuild("venusaur"));
    expect(manual.attacker.source).toBeNull();
    expect(manual.attacker.moves).toEqual(createMoveSlots("venusaur", "Doubles"));
    expect(manual.cache.get(own[3].source!.key)!.moves).toBe(second);
    const firstRestored = selectRosterPokemon(manual, "attacker", own[2]);
    expect(firstRestored.attacker.moves).toBe(first);
    const secondRestored = selectRosterPokemon(firstRestored, "attacker", own[3]);
    expect(secondRestored.attacker.moves).toBe(second);
    expect(secondRestored.attacker.key).toBe(firstRestored.attacker.key);
    expect(secondRestored.attacker.moveEpoch).toBeGreaterThan(firstRestored.attacker.moveEpoch);
  });

  it("carries slots, ownership and unfinished editors with Swap but invalidates both move owners", () => {
    let current = withBothContexts(prepared().current);
    current = replaceMatchupMove(current, current.replacement!, "protect");
    current = updateMatchupHP(current, "attacker", "abc");
    current = updateMatchupHP(current, "defender", "2e1");
    const before = structuredClone(current);
    const next = swapMatchup(current);
    for (const [side, previous] of [["attacker", "defender"], ["defender", "attacker"]] as const) {
      expect(next[side]).toEqual({ ...current[previous], contexts: {}, moveEpoch: current[previous].moveEpoch + 1 });
      expect(next[side].moves).toBe(current[previous].moves);
      expect(next[side].build).toBe(current[previous].build);
      expect(next[side].editorRevision).toBe(current[previous].editorRevision);
      expectRejectedOwner(next, getMoveOwner(current[previous]));
    }
    expect(next.cache).toBe(current.cache);
    expect(next.field).toEqual({ ...current.field, attackerSide: current.field.defenderSide, defenderSide: current.field.attackerSide });
    expect(next.replacementSession).toBe(current.replacementSession);
    expectCleared(next);
    expect(current).toEqual(before);
  });

  it("keeps detached active slots, prunes removed cached slots, and preserves unaffected private prep", () => {
    const { own, state } = prepared();
    let current = selectRosterPokemon(prepared().current, "attacker", own[1]);
    current = activate(current);
    current = replaceMatchupMove(current, current.replacement!, "protect");
    const saved = current.attacker.moves;
    current = selectRosterPokemon(current, "attacker", own[0]);
    current = withBothContexts(current);
    const navigation = reconcileRosters(current, { ...state, opponentId: "" });
    expect(navigation.defender.source).toBeNull();
    expect(navigation.defender.moves).toBe(current.defender.moves);
    expect(navigation.cache).toBe(current.cache);
    expectCleared(navigation);
    state.data!.teams[0].pokemon.splice(1, 1);
    const pruned = reconcileRosters(current, state);
    expect(pruned.cache.has(own[1].source!.key)).toBe(false);
    expect(current.cache.get(own[1].source!.key)!.moves).toBe(saved);
    expect(pruned.attacker).toBe(current.attacker);
    expect(pruned.defender).toBe(current.defender);
    expect(pruned.attack).toBe(current.attack);
    expect(pruned.replacement).toBe(current.replacement);
    state.data!.teams[1].pokemon.shift();
    const detached = reconcileRosters(pruned, state);
    expect(detached.defender.source).toBeNull();
    expect(detached.defender.moves).toBe(current.defender.moves);
    expect(detached.cache.has(current.defender.source!.key)).toBe(false);
    expect(detached.cache.get(current.attacker.source!.key)!.moves).toBe(current.attacker.moves);
    expectCleared(detached);
  });

  it("clears private moves/cache on Reset and account replacement while advancing keys, epochs and sessions", () => {
    let current = withBothContexts(prepared().current);
    current = replaceMatchupMove(current, current.replacement!, "protect");
    current = { ...current, field: { ...current.field, gameType: "Singles" } };
    for (const next of [resetMatchup(current), reconcileRosters(current, { ...rosterState(), userId: "next-account" })]) {
      expect(next.attacker.moves).toEqual(createMoveSlots("charizard", "Doubles"));
      expect(next.defender.moves).toEqual(createMoveSlots("blastoise", "Doubles"));
      expect(next.cache.size).toBe(0);
      expect(next.field).toEqual(createConditions());
      expect(next.attacker.key).not.toBe(current.attacker.key);
      expect(next.defender.key).not.toBe(current.defender.key);
      expect(next.attacker.moveEpoch).toBeGreaterThan(current.attacker.moveEpoch);
      expect(next.defender.moveEpoch).toBeGreaterThan(current.defender.moveEpoch);
      expect(next.replacementSession).toBe(current.replacementSession);
      expect(activate(next).replacement!.session).toBeGreaterThan(current.replacementSession);
      expectCleared(next);
      expectRejectedOwner(next, getMoveOwner(current.attacker));
      expectRejectedOwner(next, getMoveOwner(current.defender));
    }
  });

  it.each([
    "manual-left", "manual-right", "roster-left", "roster-right", "swap-twice", "navigation", "detach-and-restore",
  ] as const)("invalidates A→B→A callbacks at the %s boundary even when keys/species return", (boundary) => {
    const { own, other, state } = prepared();
    const current = withBothContexts(prepared().current);
    const owners = [getMoveOwner(current.attacker), getMoveOwner(current.defender)];
    const replacement = current.replacement!;
    let next = current;
    if (boundary === "manual-left" || boundary === "manual-right") {
      const side = boundary === "manual-left" ? "attacker" : "defender";
      next = updateMatchupBuild(next, side, createBuild("venusaur"));
      next = updateMatchupBuild(next, side, createBuild("charizard"));
    } else if (boundary === "roster-left" || boundary === "roster-right") {
      const side = boundary === "roster-left" ? "attacker" : "defender";
      const choices = side === "attacker" ? own : other;
      next = selectRosterPokemon(next, side, choices[1]);
      next = selectRosterPokemon(next, side, choices[0]);
    } else if (boundary === "swap-twice") {
      next = swapMatchup(swapMatchup(next));
    } else if (boundary === "navigation") {
      next = reconcileRosters(next, { ...state, opponentId: "" });
      next = reconcileRosters(next, state);
    } else {
      const removed = structuredClone(state);
      removed.data!.teams[1].pokemon.shift();
      next = reconcileRosters(next, removed);
      next = reconcileRosters(next, state);
      next = selectRosterPokemon(next, "defender", other[0]);
    }
    expectCleared(next);
    expect(next.attacker.key).toBe(current.attacker.key);
    expect(next.defender.key).toBe(current.defender.key);
    for (const owner of owners) expectRejectedOwner(next, owner);
    next = activate(next, "defender");
    expect(replaceMatchupMove(next, replacement, "protect")).toBe(next);
    expect(dismissMoveReplacement(next, replacement)).toBe(next);
    expect(next.replacement!.session).toBeGreaterThan(replacement.session);
  });
});

describe("directional attack view", () => {
  it("uses physical sides and reverses only derived side conditions, retaining all shared settings", () => {
    let current = createMatchup();
    for (const { key } of SHARED_FIELD_EFFECTS) current.field[key] = true;
    current.field = {
      ...current.field, gameType: "Singles", weather: "Snow", terrain: "Grassy", critical: true, multipleTargets: false,
      attackerSide: { reflect: true, lightScreen: false, auroraVeil: true, helpingHand: false },
      defenderSide: { reflect: false, lightScreen: true, auroraVeil: false, helpingHand: true },
    };
    const before = structuredClone(current);
    const forward = getAttackView(current);
    expect(forward).toEqual({
      source: current.attacker, receiver: current.defender, sourceSide: "attacker", receiverSide: "defender",
      owner: getMoveOwner(current.attacker), receiverOwner: getMoveOwner(current.defender),
      field: current.field, contexts: current.attacker.contexts, moveId: null,
    });
    expect(forward.field).toBe(current.field);
    current = selectMatchupMove(activate(current, "defender"), "surf");
    const reverse = getAttackView(current);
    expect(reverse.source).toBe(current.defender);
    expect(reverse.receiver).toBe(current.attacker);
    expect(reverse.sourceSide).toBe("defender");
    expect(reverse.receiverSide).toBe("attacker");
    expect(reverse.owner).toEqual(getMoveOwner(current.defender));
    expect(reverse.receiverOwner).toEqual(getMoveOwner(current.attacker));
    expect(reverse.contexts).toBe(current.defender.contexts);
    expect(reverse.moveId).toBe("surf");
    expect(reverse.field).toEqual({ ...current.field, attackerSide: current.field.defenderSide, defenderSide: current.field.attackerSide });
    expect(reverse.field.attackerSide).toBe(current.field.defenderSide);
    expect(reverse.field.defenderSide).toBe(current.field.attackerSide);
    expect(current.attacker).toBe(forward.source);
    expect(current.defender).toBe(forward.receiver);
    expect(current.field).toEqual(before.field);
  });

  it.each(["key", "epoch"] as const)("defensively falls back to physical left and no selected move for a stale %s", (part) => {
    const current = selectMatchupMove(activate(createMatchup(), "defender"), "surf");
    const stale = { ...current, attack: { ...current.attack, owner: { ...current.attack.owner, [part]: 999 } } };
    const view = getAttackView(stale);
    expect(view.source).toBe(current.attacker);
    expect(view.receiver).toBe(current.defender);
    expect(view.owner).toEqual(getMoveOwner(current.attacker));
    expect(view.receiverOwner).toEqual(getMoveOwner(current.defender));
    expect(view.field).toBe(current.field);
    expect(view.contexts).toBe(current.attacker.contexts);
    expect(view.moveId).toBeNull();
  });

  it.each([
    ["attacker", "lightScreen"], ["defender", "lightScreen"],
    ["attacker", "helpingHand"], ["defender", "helpingHand"],
  ] as const)("calculates reverse attacks with the physical %s's asymmetric %s", (side, effect) => {
    let current = createMatchup();
    current.field[side === "attacker" ? "attackerSide" : "defenderSide"][effect] = true;
    current = selectMatchupMove(activate(current, "defender"), "surf");
    const before = structuredClone(current);
    const view = getAttackView(current);
    const actual = calculateMatchup(view.source.build, view.receiver.build, view.field, view.contexts);
    const expected = calculateMatchup(current.defender.build, current.attacker.build, {
      ...current.field, attackerSide: current.field.defenderSide, defenderSide: current.field.attackerSide,
    }, current.defender.contexts);
    expect(actual).toEqual(expected);
    expect(actual.issues).toEqual({ attacker: [], defender: [], field: [] });
    const surf = actual.results.find((entry) => entry.moveId === "surf")!;
    const wrongField = calculateMatchup(current.defender.build, current.attacker.build, current.field).results.find((entry) => entry.moveId === "surf")!;
    expect(surf.kind).toBe("calculated");
    expect(surf.rolls).not.toEqual(wrongField.rolls);
    expect(current).toEqual(before);
  });

  it("calculates against the reverse receiver's HP without altering either actual HP value", () => {
    let current = updateMatchupHP(createMatchup(), "attacker", "1");
    current = selectMatchupMove(activate(current, "defender"), "surf");
    const view = getAttackView(current);
    const result = calculateMatchup(view.source.build, view.receiver.build, view.field, view.contexts).results.find((entry) => entry.moveId === "surf")!;
    expect(result).toMatchObject({ kind: "calculated", ohkoChance: 1 });
    expect(view.receiver.build.currentHP).toBe(1);
    expect(current.attacker.build.currentHP).toBe(1);
    expect(current.defender.build.currentHP).toBeNull();
    expect(current.attacker.hpInput).toBe("1");
    expect(current.defender.hpInput).toBe("");
  });
});
