import { describe, expect, it, vi } from "vitest";
import {
  activateDoublesMoveSlot, applyDoublesIntimidate, chooseDoublesMove, createDoubles, dismissDoublesReplacement, doublesIntimidateResult,
  doublesRosterDisabled, equipDoublesRequiredMove, focusDoublesMoves, followShared, getDoublesTurnInput, replaceDoublesMove, resetDoubles,
  selectDoublesRoster, setDoublesCharged, setDoublesField, setDoublesMovesInto, setDoublesTarget, toggleDoublesMechanic, toggleDoublesMega,
  updateDoublesBuild, updateDoublesHP, updateDoublesMoveContext, type CalculatorState,
} from "@/app/(app)/calculator/doubles-prep";
import type { CalculatorRosterState } from "@/app/(app)/calculator/roster-data";
import {
  applyTeamPaste, changeBattleGame, changeTeamSource, createMatchup, getMoveOwner, getTeamPanel, getTeamSourceOwner, reconcileRosters,
  removeTeamPaste, resetMatchup, selectRosterPokemon, swapMatchup, toggleMatchupMega, type PreparedMatchup, type RosterRole,
} from "@/app/(app)/calculator/roster-prep";
import type { TeamRoster } from "@/app/(app)/leagues/[leagueId]/team/roster";
import { champions } from "@/app/lib/battle/catalog";
import { DOUBLES_SLOTS, type DoublesSlotId, type DoublesTargetRule } from "@/app/lib/battle/doubles-types";
import * as intimidate from "@/app/lib/battle/intimidate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, withUsualAbility } from "@/app/lib/battle/model";
import { createMoveSlots, usualAbility } from "@/app/lib/battle/move-defaults";
import { championsRuntime, createBattleRuntime } from "@/app/lib/battle/runtime";
import { parseTeamImport } from "@/app/lib/battle/team-import";
import type { BattleBuild } from "@/app/lib/battle/types";

// The target rules are the engine's (doubles-targets.ts, tested with Showdown's data elsewhere); a fixed table here.
const rules = vi.hoisted(() => ({ table: {} as Record<string, "normal" | "foes" | "spread" | "self" | "ally"> }));
vi.mock("@/app/lib/battle/doubles-targets", async () => {
  const types = await import("@/app/lib/battle/doubles-types");
  return {
    doublesTargetRule: (_input: unknown, slot: DoublesSlotId, moveId: string): DoublesTargetRule => {
      const [left, right] = types.foesOf(slot);
      const ally = types.allyOf(slot);
      switch (rules.table[moveId] ?? "normal") {
        case "foes": return { kind: "choose", options: [left, right] };
        case "spread": return { kind: "auto", hits: [left, right, ally] };
        case "self": return { kind: "none", scope: "self" };
        case "ally": return { kind: "auto", hits: [ally] };
        default: return { kind: "choose", options: [left, right, ally] };
      }
    },
    defaultDoublesTarget: (rule: DoublesTargetRule, current: DoublesSlotId | null, preferred: DoublesSlotId | null) => {
      if (rule.kind !== "choose") return null;
      if (current && rule.options.includes(current)) return current;
      if (preferred && rule.options.includes(preferred)) return preferred;
      return rule.options[0];
    },
  };
});
rules.table = { earthquake: "spread", protect: "self", helpinghand: "ally", airslash: "foes", heatwave: "spread" };

// applyIntimidateToFoes is the engine's (intimidate.ts); the order of the foes and the storage of its result are tested here.
vi.mock("@/app/lib/battle/intimidate", async (original) => {
  const actual = await original<typeof import("@/app/lib/battle/intimidate")>();
  return { ...actual, applyIntimidateToFoes: vi.fn(actual.applyIntimidateToFoes) };
});

function team(id: string, memberId: string, names: string[]): TeamRoster {
  return {
    id, member_id: memberId, total_points: names.length * 15, team_name: null, role: null,
    pokemon: names.map((name, index) => ({ name, points: 15, tier: 1, pick_number: index + 1, acquired: "draft" })),
  };
}

function loaded(overrides: Partial<CalculatorRosterState> = {}): CalculatorRosterState {
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
        { id: "member-third", role: "coach", team_name: "Third", draft_position: 3 },
      ],
      teams: [
        team("team-own", "member-own", ["Garchomp", "Incineroar", "Gardevoir"]),
        team("team-other", "member-other", ["Gyarados", "Venusaur"]),
        team("team-third", "member-third", ["Snorlax"]),
      ],
    },
    ...overrides,
  };
}

/** The 1v1 matchup bound to the rosters, as receiveRosters leaves it, and a fresh 2v2. */
function start(rosters = loaded()): CalculatorState {
  return { matchup: reconcileRosters(createMatchup(), rosters), doubles: createDoubles() };
}

/** A 1v1 update as CalculatorClient's setMatchup wrapper applies it. */
function on1v1(state: CalculatorState, update: (matchup: PreparedMatchup) => PreparedMatchup, rosters?: CalculatorRosterState): CalculatorState {
  const matchup = update(state.matchup);
  return { matchup, doubles: followShared(state.doubles, state.matchup, matchup, rosters) };
}

function choice(state: CalculatorState, role: RosterRole, name: string, rosters = loaded()) {
  return getTeamPanel(state.matchup, rosters, role).choices.find((entry) => entry.name === name)!;
}

const owner = (state: CalculatorState, slot: DoublesSlotId) => getMoveOwner(state.doubles.slots[slot]);
const others = (slot: DoublesSlotId) => DOUBLES_SLOTS.filter((entry) => entry !== slot);

/** The other three slots are the same objects after `next`. */
function expectOthersKept(before: CalculatorState, after: CalculatorState, slot: DoublesSlotId) {
  for (const other of others(slot)) {
    expect(after.doubles.slots[other]).toBe(before.doubles.slots[other]);
    expect(after.doubles.actions[other]).toEqual(before.doubles.actions[other]);
    expect(after.doubles.charged[other]).toBe(before.doubles.charged[other]);
  }
  expect(after.doubles.field).toBe(before.doubles.field);
}

describe("createDoubles", () => {
  it("starts Charizard and Venusaur against Blastoise and Pikachu with no moves chosen", () => {
    const doubles = createDoubles(2);
    expect(DOUBLES_SLOTS.map((slot) => [doubles.slots[slot].key, doubles.slots[slot].role, doubles.slots[slot].build.speciesId])).toEqual([
      [8, "own", "charizard"], [9, "own", "venusaur"], [10, "opponent", "blastoise"], [11, "opponent", "pikachu"],
    ]);
    for (const slot of DOUBLES_SLOTS) {
      const { build, moves, contexts, source, hpInput, moveEpoch } = doubles.slots[slot];
      expect(moves).toEqual(createMoveSlots(build.speciesId, "Doubles"));
      expect(build.abilityId).toBe(withUsualAbility(createBuild(build.speciesId), usualAbility(build.speciesId, "Doubles")).abilityId);
      expect([contexts, source, hpInput, moveEpoch]).toEqual([{}, null, "", 0]);
      expect(doubles.actions[slot]).toEqual({ moveId: null, target: null });
      expect(doubles.charged[slot]).toBe(false);
    }
    expect(doubles.field).toEqual({ ...createConditions(), gameType: "Doubles" });
    expect(doubles.moves).toEqual({ slot: "own-left", into: "opponent-left" });
    expect([doubles.revision, doubles.notice, doubles.replacement, doubles.replacementSession, doubles.intimidate]).toEqual([2, "", null, 0, null]);
    expect(doubles.runtime).toBe(championsRuntime);
  });

  it("falls back to the first supported species for a default the game does not have", () => {
    const runtime = createBattleRuntime({ ...champions, species: champions.species.filter((row) => row.id !== "pikachu") }, "1".repeat(64));
    const fallback = runtime.catalog.species.find((entry) => !entry.battleForm && !entry.unsupported.length)!.id;
    const doubles = createDoubles(0, runtime);
    expect(doubles.slots["opponent-right"].build.speciesId).toBe(fallback);
    expect(doubles.slots["opponent-left"].build.speciesId).toBe("blastoise");
  });
});

describe("moves and targets", () => {
  it("aims a single-target move at the left foe, keeps a chosen target, and clears it for spread moves and No move", () => {
    let state = start();
    const ownLeft = owner(state, "own-left");
    state = chooseDoublesMove(state, ownLeft, "flamethrower");
    expect(state.doubles.actions["own-left"]).toEqual({ moveId: "flamethrower", target: "opponent-left" });
    // The opponent's left foe is your left Pokémon.
    const theirs = chooseDoublesMove(state, owner(state, "opponent-right"), "hydropump");
    expect(theirs).toBe(state);
    state = chooseDoublesMove(state, owner(state, "opponent-right"), "thunderbolt");
    expect(state.doubles.actions["opponent-right"]).toEqual({ moveId: "thunderbolt", target: "own-left" });
    state = setDoublesTarget(state, ownLeft, "opponent-right");
    state = chooseDoublesMove(state, ownLeft, "dragonclaw");
    expect(state.doubles.actions["own-left"]).toEqual({ moveId: "dragonclaw", target: "opponent-right" });
    state = chooseDoublesMove(state, ownLeft, "earthquake");
    expect(state.doubles.actions["own-left"]).toEqual({ moveId: "earthquake", target: null });
    // The Moves pane shows Charizard and followed its last target.
    expect(state.doubles.moves.into).toBe("opponent-right");
    state = chooseDoublesMove(state, ownLeft, "flamethrower");
    expect(state.doubles.actions["own-left"]).toEqual({ moveId: "flamethrower", target: "opponent-right" });
    state = chooseDoublesMove(state, ownLeft, null);
    expect(state.doubles.actions["own-left"]).toEqual({ moveId: null, target: null });
  });

  it("prefers the Moves pane's receiver while the pane shows the slot", () => {
    let state = setDoublesMovesInto(start(), "opponent-right");
    expect(state.doubles.moves).toEqual({ slot: "own-left", into: "opponent-right" });
    state = chooseDoublesMove(state, owner(state, "own-left"), "flamethrower");
    expect(state.doubles.actions["own-left"].target).toBe("opponent-right");
    // Venusaur is not in the pane: its left foe.
    state = chooseDoublesMove(state, owner(state, "own-right"), "sludgebomb");
    expect(state.doubles.actions["own-right"].target).toBe("opponent-left");
  });

  it("accepts only a target the move's rule offers", () => {
    let state = chooseDoublesMove(start(), owner(start(), "own-left"), "flamethrower");
    const ownLeft = owner(state, "own-left");
    expect(setDoublesTarget(state, ownLeft, "own-left")).toBe(state);
    state = setDoublesTarget(state, ownLeft, "own-right");
    expect(state.doubles.actions["own-left"].target).toBe("own-right");
    expect(state.doubles.moves.into).toBe("own-right");
    state = chooseDoublesMove(state, ownLeft, "airslash");
    // Air Slash takes foes only here, so the ally target falls back to the pane's receiver, which followed it.
    expect(state.doubles.actions["own-left"].target).toBe("opponent-left");
    expect(setDoublesTarget(state, ownLeft, "own-right")).toBe(state);
    const spread = chooseDoublesMove(state, ownLeft, "earthquake");
    expect(setDoublesTarget(spread, ownLeft, "opponent-right")).toBe(spread);
    const none = chooseDoublesMove(start(), owner(start(), "own-left"), null);
    expect(setDoublesTarget(none, owner(none, "own-left"), "opponent-left")).toBe(none);
  });

  it("ignores stale owners and moves the Pokémon does not learn", () => {
    const state = start();
    const ownLeft = owner(state, "own-left");
    expect(chooseDoublesMove(state, { ...ownLeft, epoch: ownLeft.epoch + 1 }, "flamethrower")).toBe(state);
    expect(chooseDoublesMove(state, ownLeft, "surf")).toBe(state);
    expect(setDoublesTarget(state, { key: 99, epoch: 0 }, "opponent-left")).toBe(state);
  });

  it("activates a quick move: the action, a new replacement session and the Moves pane on that slot", () => {
    let state = start();
    const venusaur = owner(state, "own-right");
    const moveId = state.doubles.slots["own-right"].moves[0].moveId!;
    const before = state;
    state = activateDoublesMoveSlot(state, venusaur, 0);
    expect(state.doubles.actions["own-right"].moveId).toBe(moveId);
    expect(state.doubles.replacement).toEqual({ owner: venusaur, slotIndex: 0, session: 1 });
    expect(state.doubles.replacementSession).toBe(1);
    expect(state.doubles.moves.slot).toBe("own-right");
    if (state.doubles.actions["own-right"].target) expect(state.doubles.moves.into).toBe(state.doubles.actions["own-right"].target);
    expectOthersKept(before, state, "own-right");
    expect(activateDoublesMoveSlot(state, { ...venusaur, epoch: 7 }, 0)).toBe(state);
    expect(activateDoublesMoveSlot(state, venusaur, 4)).toBe(state);
  });

  it("gives no move for an empty quick slot", () => {
    let state = start();
    const slot = state.doubles.slots["own-left"];
    state = { ...state, doubles: { ...state.doubles, slots: { ...state.doubles.slots, "own-left": { ...slot, moves: [slot.moves[0], slot.moves[1], slot.moves[2], { moveId: null, origin: "empty", gameType: null }] } } } };
    state = chooseDoublesMove(state, owner(state, "own-left"), "flamethrower");
    state = activateDoublesMoveSlot(state, owner(state, "own-left"), 3);
    expect(state.doubles.actions["own-left"]).toEqual({ moveId: null, target: null });
    expect(state.doubles.replacement?.slotIndex).toBe(3);
  });

  it("replaces a quick move in replacement mode and selects it, leaving the other slots", () => {
    let state = start();
    const charizard = owner(state, "own-left");
    state = activateDoublesMoveSlot(state, charizard, 0);
    const before = state;
    const learnable = championsRuntime.speciesById.get("charizard")!.moves.find((id) => id === "heatwave" || id === "flamethrower")!;
    const replaced = state.doubles.slots["own-left"].moves.some((move) => move.moveId === learnable) ? "dragonclaw" : learnable;
    state = replaceDoublesMove(state, state.doubles.replacement!, replaced);
    expect(state.doubles.slots["own-left"].moves[0].moveId).toBe(replaced);
    expect(state.doubles.actions["own-left"].moveId).toBe(replaced);
    expect(state.doubles.replacement?.session).toBe(before.doubles.replacementSession + 1);
    expectOthersKept(before, state, "own-left");
    const done = dismissDoublesReplacement(state, state.doubles.replacement!);
    expect(done.doubles.replacement).toBeNull();
    expect(done.doubles.actions["own-left"].moveId).toBe(replaced);
    // Another slot's Moves pane ends replacement mode.
    const elsewhere = focusDoublesMoves(state, "opponent-left");
    expect(elsewhere.doubles.replacement).toBeNull();
    // Its receiver was its own slot, so it takes its left foe.
    expect(elsewhere.doubles.moves).toEqual({ slot: "opponent-left", into: "own-left" });
  });

  it("points the Moves pane at a slot's target, keeps another receiver, and never at itself", () => {
    let state = start();
    state = chooseDoublesMove(state, owner(state, "opponent-left"), "icebeam");
    expect(state.doubles.actions["opponent-left"].target).toBe("own-left");
    state = setDoublesTarget(state, owner(state, "opponent-left"), "own-right");
    state = focusDoublesMoves(state, "opponent-left");
    expect(state.doubles.moves).toEqual({ slot: "opponent-left", into: "own-right" });
    // No target: the receiver stays when it is another slot, else the left foe.
    state = focusDoublesMoves(state, "own-left");
    expect(state.doubles.moves).toEqual({ slot: "own-left", into: "own-right" });
    state = focusDoublesMoves(state, "own-right");
    expect(state.doubles.moves).toEqual({ slot: "own-right", into: "opponent-left" });
    expect(setDoublesMovesInto(state, "own-right")).toBe(state);
    // The pane's receiver sets the target when the rule offers it.
    state = chooseDoublesMove(state, owner(state, "own-right"), "sludgebomb");
    state = setDoublesMovesInto(state, "opponent-right");
    expect(state.doubles.actions["own-right"]).toEqual({ moveId: "sludgebomb", target: "opponent-right" });
    state = chooseDoublesMove(state, owner(state, "own-right"), "earthquake");
    const before = state.doubles.actions["own-right"];
    state = setDoublesMovesInto(state, "own-left");
    expect(state.doubles.actions["own-right"]).toBe(before);
  });

  it("keeps move contexts per slot and hands them to the turn", () => {
    let state = chooseDoublesMove(start(), owner(start(), "own-left"), "flamethrower");
    const before = state;
    state = updateDoublesMoveContext(state, owner(state, "own-left"), "flamethrower", { doubled: true });
    expect(state.doubles.slots["own-left"].contexts).toEqual({ flamethrower: { doubled: true } });
    expectOthersKept(before, state, "own-left");
    expect(getDoublesTurnInput(state.doubles).pokemon["own-left"]?.contexts).toEqual({ flamethrower: { doubled: true } });
    expect(updateDoublesMoveContext(state, owner(state, "own-left"), "surf", { doubled: true })).toBe(state);
  });
});

describe("builds through the 1v1 transitions", () => {
  it("edits one slot's build and HP and leaves the other three as they were", () => {
    let state = start();
    state = chooseDoublesMove(state, owner(state, "own-right"), "sludgebomb");
    const before = state;
    const build = { ...state.doubles.slots["opponent-left"].build, nature: "Modest" };
    state = updateDoublesBuild(state, state.doubles.slots["opponent-left"].key, build);
    expect(state.doubles.slots["opponent-left"].build.nature).toBe("Modest");
    expectOthersKept(before, state, "opponent-left");
    const hp = updateDoublesHP(state, state.doubles.slots["opponent-left"].key, "100");
    expect(hp.doubles.slots["opponent-left"].build.currentHP).toBe(100);
    expect(hp.doubles.slots["opponent-left"].hpInput).toBe("100");
    expectOthersKept(state, hp, "opponent-left");
    expect(updateDoublesHP(state, 999, "1")).toBe(state);
  });

  it("clears the action, contexts and Charge when the species changes, and names the slot in the notice", async () => {
    const runtime = await loadBattleRuntime("ultra_sun_ultra_moon");
    let state: CalculatorState = { matchup: createMatchup(0, runtime), doubles: createDoubles(0, runtime) };
    const ownRight = owner(state, "own-right");
    const moveId = state.doubles.slots["own-right"].moves.find((move) => move.moveId)!.moveId!;
    state = chooseDoublesMove(state, ownRight, moveId);
    state = setDoublesCharged(state, state.doubles.slots["own-right"].key, true);
    state = updateDoublesMoveContext(state, ownRight, moveId, { doubled: true });
    // Magnezone's quick moves include Hidden Power Ground, so its fresh build gets that type's IVs and a notice.
    const next = updateDoublesBuild(state, state.doubles.slots["own-right"].key, createBuild("magnezone", runtime));
    expect(next.doubles.slots["own-right"].build.speciesId).toBe("magnezone");
    expect(next.doubles.actions["own-right"]).toEqual({ moveId: null, target: null });
    expect(next.doubles.slots["own-right"].contexts).toEqual({});
    expect(next.doubles.slots["own-right"].moveEpoch).toBe(state.doubles.slots["own-right"].moveEpoch + 1);
    expect(next.doubles.charged["own-right"]).toBe(false);
    expect(next.doubles.notice).toBe("Your right Pokémon Magnezone: IVs set for its suggested Hidden Power Ground (30 Sp. Atk, Sp. Def).");
    expectOthersKept(state, next, "own-right");
  });

  it("toggles a Mega form with its action kept under the new owner, and without the Trace-Intimidate store", () => {
    let state = start();
    state = chooseDoublesMove(state, owner(state, "own-left"), "flamethrower");
    state = updateDoublesBuild(state, state.doubles.slots["own-left"].key, { ...state.doubles.slots["own-left"].build, itemId: "charizarditey" });
    const before = state;
    state = toggleDoublesMega(state, owner(state, "own-left"), "charizardmegay");
    expect(state.doubles.slots["own-left"].build.speciesId).toBe("charizardmegay");
    expect(state.doubles.actions["own-left"]).toEqual({ moveId: "flamethrower", target: "opponent-left" });
    expect(state.doubles.slots["own-left"].moveEpoch).toBe(before.doubles.slots["own-left"].moveEpoch + 1);
    expectOthersKept(before, state, "own-left");

    // Gardevoir with Trace facing an Intimidate foe: 1v1 stores the copied drop on Mega Evolution, 2v2 does not.
    let traced = start();
    const gardevoir = { ...withUsualAbility(createBuild("gardevoir"), "trace"), itemId: "gardevoirite" };
    const foe = { ...createBuild("incineroar"), abilityId: "intimidate" };
    traced = updateDoublesBuild(traced, traced.doubles.slots["own-left"].key, gardevoir);
    traced = updateDoublesBuild(traced, traced.doubles.slots["opponent-left"].key, foe);
    traced = updateDoublesBuild(traced, traced.doubles.slots["opponent-right"].key, foe);
    const mega = toggleDoublesMega(traced, owner(traced, "own-left"), "gardevoirmega");
    expect(mega.doubles.slots["own-left"].build.speciesId).toBe("gardevoirmega");
    expect(mega.doubles.slots["own-left"].build.boosts).toEqual(traced.doubles.slots["own-left"].build.boosts);
    expectOthersKept(traced, mega, "own-left");
    let pair = updateMatchupPair(createMatchup(), gardevoir, foe);
    pair = toggleMatchupMega(pair, getMoveOwner(pair.attacker), "gardevoirmega");
    expect(pair.defender.build.boosts.atk).toBe(-1);
  });

  it("toggles Dynamax and Tera through the 1v1 transition", async () => {
    const runtime = await loadBattleRuntime("scarlet_violet");
    let state: CalculatorState = { matchup: createMatchup(0, runtime), doubles: createDoubles(0, runtime) };
    const before = state;
    state = toggleDoublesMechanic(state, owner(state, "opponent-right"), "tera");
    expect(state.doubles.slots["opponent-right"].build.mechanic).toBe("tera");
    expectOthersKept(before, state, "opponent-right");
    expect(toggleDoublesMechanic(state, owner(state, "opponent-right"), "dynamax")).toBe(state);
  });

  it("equips a form's required move into a quick slot and the action follows a replaced move", async () => {
    const runtime = await loadBattleRuntime("scarlet_violet");
    let state: CalculatorState = { matchup: createMatchup(0, runtime), doubles: createDoubles(0, runtime) };
    state = updateDoublesBuild(state, state.doubles.slots["opponent-left"].key, createBuild("keldeoresolute", runtime));
    const slot = state.doubles.slots["opponent-left"];
    const other = runtime.speciesById.get("keldeoresolute")!.moves.find((id) => runtime.movesById.get(id)?.category !== "Status" && !slot.moves.some((move) => move.moveId === id))!;
    state = activateDoublesMoveSlot(state, getMoveOwner(slot), 0);
    state = replaceDoublesMove(state, state.doubles.replacement!, other);
    expect(state.doubles.actions["opponent-left"].moveId).toBe(other);
    const before = state;
    state = equipDoublesRequiredMove(state, slot.key, 0);
    expect(state.doubles.slots["opponent-left"].moves[0]).toMatchObject({ moveId: "secretsword", origin: "required" });
    expect(state.doubles.actions["opponent-left"].moveId).toBe("secretsword");
    expect(state.doubles.notice).toBe(`Secret Sword prepared in quick move 1, replacing ${runtime.movesById.get(other)!.name}.`);
    expectOthersKept(before, state, "opponent-left");
  });
});

/** A 1v1 pair with these builds (for comparing a 1v1 transition). */
function updateMatchupPair(matchup: PreparedMatchup, attacker: BattleBuild, defender: BattleBuild): PreparedMatchup {
  return { ...matchup, attacker: { ...matchup.attacker, build: attacker }, defender: { ...matchup.defender, build: defender } };
}

describe("roster choices", () => {
  it("loads a team Pokémon into one slot, names the slot, and clears its action and Charge", () => {
    let state = start();
    state = chooseDoublesMove(state, owner(state, "own-left"), "flamethrower");
    state = chooseDoublesMove(state, owner(state, "opponent-left"), "icebeam");
    state = setDoublesCharged(state, state.doubles.slots["own-left"].key, true);
    const before = state;
    state = selectDoublesRoster(state, state.doubles.slots["own-left"].key, choice(state, "own", "Garchomp"));
    expect(state.doubles.slots["own-left"].build.speciesId).toBe("garchomp");
    expect(state.doubles.slots["own-left"].source?.name).toBe("Garchomp");
    expect(state.doubles.notice).toBe("Garchomp selected as your left Pokémon. Default build loaded. Field settings are unchanged; move contexts cleared.");
    expect(state.doubles.actions["own-left"]).toEqual({ moveId: null, target: null });
    expect(state.doubles.charged["own-left"]).toBe(false);
    // The opponent's move stays aimed at the slot.
    expect(state.doubles.actions["opponent-left"]).toEqual({ moveId: "icebeam", target: "own-left" });
    expectOthersKept(before, state, "own-left");
    // A roster choice for the other team, or a stale key, does nothing.
    expect(selectDoublesRoster(state, state.doubles.slots["own-right"].key, choice(state, "opponent", "Gyarados"))).toBe(state);
    expect(selectDoublesRoster(state, 999, choice(state, "own", "Incineroar"))).toBe(state);
  });

  it("refuses the roster entry the ally slot shows", () => {
    let state = start();
    const garchomp = choice(state, "own", "Garchomp");
    state = selectDoublesRoster(state, state.doubles.slots["own-left"].key, garchomp);
    expect(doublesRosterDisabled(state.doubles, "own-right", garchomp)).toBe("Active as your left Pokémon.");
    expect(doublesRosterDisabled(state.doubles, "own-left", garchomp)).toBeNull();
    expect(doublesRosterDisabled(state.doubles, "own-right", choice(state, "own", "Incineroar"))).toBeNull();
    expect(selectDoublesRoster(state, state.doubles.slots["own-right"].key, garchomp)).toBe(state);
    const gyarados = choice(state, "opponent", "Gyarados");
    state = selectDoublesRoster(state, state.doubles.slots["opponent-right"].key, gyarados);
    expect(doublesRosterDisabled(state.doubles, "opponent-left", gyarados)).toBe("Active as opponent's right Pokémon.");
  });

  it("shares one session build per roster entry with 1v1", () => {
    let state = start();
    const garchomp = choice(state, "own", "Garchomp");
    state = selectDoublesRoster(state, state.doubles.slots["own-left"].key, garchomp);
    const edited = { ...state.doubles.slots["own-left"].build, nature: "Jolly" };
    state = updateDoublesBuild(state, state.doubles.slots["own-left"].key, edited);
    expect(state.matchup.cache.get(garchomp.source!.key)?.build.nature).toBe("Jolly");
    // 1v1 picks the same entry and gets the 2v2 edit.
    const matchup = selectRosterPokemon(state.matchup, "attacker", garchomp);
    expect(matchup.attacker.build.nature).toBe("Jolly");
    expect(matchup.notice).toContain("Your session build edits were restored.");
    // And the other way: a 1v1 edit, then a 2v2 pick into another slot after a reset of that slot's Pokémon.
    let other = start();
    const tuned = selectRosterPokemon(other.matchup, "attacker", garchomp);
    other = { ...other, matchup: { ...tuned, cache: new Map(tuned.cache).set(garchomp.source!.key, { ...tuned.cache.get(garchomp.source!.key)!, build: { ...tuned.attacker.build, nature: "Adamant" } }) } };
    other = selectDoublesRoster(other, other.doubles.slots["own-right"].key, garchomp);
    expect(other.doubles.slots["own-right"].build.nature).toBe("Adamant");
    expect(other.doubles.notice).toBe("Garchomp selected as your right Pokémon. Your session build edits were restored. Field settings are unchanged; move contexts cleared.");
  });
});

describe("following 1v1 updates", () => {
  it("detaches only the opponent slots that used the old paste, and clears their actions", () => {
    const text = (species: string) => `${species}\nAbility: ${species === "Snorlax" ? "Thick Fat" : "Levitate"}\n- Protect`;
    const paste = (body: string, title: string) => ({ text: body, title, url: null, team: parseTeamImport(body, "champions") });
    let state = start();
    state = on1v1(state, (matchup) => changeTeamSource(matchup, getTeamSourceOwner(matchup, "opponent"), "paste"));
    state = on1v1(state, (matchup) => applyTeamPaste(matchup, getTeamSourceOwner(matchup, "opponent"), paste([text("Snorlax"), text("Bronzong")].join("\n\n"), "First")));
    const snorlax = getTeamPanel(state.matchup, loaded(), "opponent").choices[0];
    const garchomp = choice(state, "own", "Garchomp");
    state = selectDoublesRoster(state, state.doubles.slots["opponent-left"].key, snorlax);
    state = selectDoublesRoster(state, state.doubles.slots["own-left"].key, garchomp);
    state = chooseDoublesMove(state, owner(state, "opponent-left"), "protect");
    state = chooseDoublesMove(state, owner(state, "opponent-right"), "thunderbolt");
    const before = state;
    state = on1v1(state, (matchup) => applyTeamPaste(matchup, getTeamSourceOwner(matchup, "opponent"), paste(text("Snorlax"), "Second")));
    const detached = state.doubles.slots["opponent-left"];
    expect(detached.source).toBeNull();
    expect(detached.build).toBe(before.doubles.slots["opponent-left"].build);
    expect(detached.contexts).toEqual({});
    expect(detached.moveEpoch).toBe(before.doubles.slots["opponent-left"].moveEpoch + 1);
    expect(state.doubles.actions["opponent-left"]).toEqual({ moveId: null, target: null });
    for (const slot of others("opponent-left")) {
      expect(state.doubles.slots[slot]).toBe(before.doubles.slots[slot]);
      expect(state.doubles.actions[slot]).toBe(before.doubles.actions[slot]);
    }
  });

  it("detaches league sources when the opponent changes, and renames renamed entries", () => {
    let state = start();
    state = selectDoublesRoster(state, state.doubles.slots["opponent-left"].key, choice(state, "opponent", "Gyarados"));
    state = selectDoublesRoster(state, state.doubles.slots["own-right"].key, choice(state, "own", "Garchomp"));
    state = chooseDoublesMove(state, owner(state, "opponent-left"), "waterfall");
    const rosters = loaded({ opponentId: "member-third" });
    const next = on1v1(state, (matchup) => reconcileRosters(matchup, rosters), rosters);
    expect(next.doubles.slots["opponent-left"].source).toBeNull();
    expect(next.doubles.actions["opponent-left"]).toEqual({ moveId: null, target: null });
    expect(next.doubles.slots["own-right"]).toBe(state.doubles.slots["own-right"]);
    // A refresh that lists the same entries changes nothing.
    const same = loaded();
    expect(followShared(state.doubles, state.matchup, reconcileRosters(state.matchup, same), same)).toBe(state.doubles);
  });

  it("gives a fresh 2v2 for an account change or a game change", async () => {
    let state = start();
    state = chooseDoublesMove(state, owner(state, "own-left"), "flamethrower");
    const account = loaded({ userId: "another-account" });
    const switched = on1v1(state, (matchup) => reconcileRosters(matchup, account), account);
    expect(switched.doubles.revision).toBe(1);
    expect(switched.doubles.slots["own-left"].key).toBe(4);
    expect(switched.doubles.actions["own-left"]).toEqual({ moveId: null, target: null });
    const runtime = await loadBattleRuntime("scarlet_violet");
    const game = on1v1(state, (matchup) => changeBattleGame(matchup, runtime));
    expect(game.doubles.runtime).toBe(runtime);
    expect(game.doubles.revision).toBe(1);
    expect(game.doubles.slots["own-left"].build.game).toBe("scarlet_violet");
    expect(game.doubles.notice).toBe("Scarlet and Violet selected. Preparation and active mechanics reset; team documents and drafts kept.");
    expect(game.doubles.replacementSession).toBe(state.doubles.replacementSession);
  });

  it("gives 2v2 the 1v1 notice for a team source change, a paste imported or removed, and names the slots it detaches", () => {
    const body = "Snorlax\nAbility: Thick Fat\n- Protect";
    let state = start();
    state = selectDoublesRoster(state, state.doubles.slots["opponent-left"].key, choice(state, "opponent", "Gyarados"));
    state = selectDoublesRoster(state, state.doubles.slots["opponent-right"].key, choice(state, "opponent", "Venusaur"));
    state = on1v1(state, (matchup) => changeTeamSource(matchup, getTeamSourceOwner(matchup, "opponent"), "paste"));
    expect(state.matchup.notice).toBe("Team source changed. Current Pokémon and their preparation kept.");
    expect(state.doubles.notice).toBe("Team source changed. Current Pokémon and their preparation kept. Opponent's left and opponent's right Pokémon detached from their roster entries; their moves and move contexts cleared.");
    state = on1v1(state, (matchup) => applyTeamPaste(matchup, getTeamSourceOwner(matchup, "opponent"), { text: body, title: "First", url: null, team: parseTeamImport(body, "champions") }));
    expect(state.doubles.notice).toBe("First imported for the opponent. Current Pokémon kept.");
    state = selectDoublesRoster(state, state.doubles.slots["opponent-left"].key, getTeamPanel(state.matchup, loaded(), "opponent").choices[0]);
    state = on1v1(state, (matchup) => removeTeamPaste(matchup, getTeamSourceOwner(matchup, "opponent")));
    expect(state.doubles.notice).toBe("Imported team removed. Current Pokémon and their preparation kept as manual builds. Opponent's left Pokémon detached from its roster entry; its move and move contexts cleared.");
    // 1v1 Reset keeps each side's source, so 2v2's notice stays.
    expect(on1v1(state, resetMatchup).doubles).toBe(state.doubles);
  });

  it("names the slots a league or opponent change detaches", () => {
    let state = start();
    state = selectDoublesRoster(state, state.doubles.slots["opponent-left"].key, choice(state, "opponent", "Gyarados"));
    const rosters = loaded({ opponentId: "member-third" });
    const next = on1v1(state, (matchup) => reconcileRosters(matchup, rosters), rosters);
    expect(next.doubles.notice).toBe("Opponent's left Pokémon detached from its roster entry; its move and move contexts cleared.");
  });

  it("changes nothing for 1v1 Reset, Swap and build edits", () => {
    let state = start();
    state = selectDoublesRoster(state, state.doubles.slots["own-left"].key, choice(state, "own", "Garchomp"));
    state = chooseDoublesMove(state, owner(state, "own-left"), "earthquake");
    expect(on1v1(state, resetMatchup).doubles).toBe(state.doubles);
    expect(on1v1(state, resetMatchup).matchup.cache.size).toBe(0);
    expect(on1v1(state, swapMatchup).doubles).toBe(state.doubles);
  });
});

describe("resetDoubles", () => {
  it("starts the defaults under new keys, clears the shared cache and keeps team choices", () => {
    let state = start();
    state = selectDoublesRoster(state, state.doubles.slots["own-left"].key, choice(state, "own", "Garchomp"));
    state = chooseDoublesMove(state, owner(state, "own-left"), "earthquake");
    state = setDoublesField(state, state.doubles.revision, { ...state.doubles.field, trickRoom: true });
    expect(state.matchup.cache.size).toBe(1);
    const reset = resetDoubles(state);
    expect(reset.doubles.revision).toBe(1);
    expect(DOUBLES_SLOTS.map((slot) => reset.doubles.slots[slot].key)).toEqual([4, 5, 6, 7]);
    expect(DOUBLES_SLOTS.map((slot) => reset.doubles.slots[slot].build.speciesId)).toEqual(["charizard", "venusaur", "blastoise", "pikachu"]);
    expect(reset.doubles.field.trickRoom).toBe(false);
    expect(reset.doubles.actions["own-left"]).toEqual({ moveId: null, target: null });
    expect(reset.matchup.cache.size).toBe(0);
    expect({ ...reset.matchup, cache: null }).toEqual({ ...state.matchup, cache: null });
    expect(reset.matchup.teams).toBe(state.matchup.teams);
    expect(reset.doubles.notice).toBe("Reset 2v2 to Charizard and Venusaur versus Blastoise and Pikachu, full HP, zero Stat Points and stages, no moves and the default Doubles field. Session build edits cleared. League and opponent choices kept; imported teams kept with their original sets.");
  });
});

describe("Intimidate on both foes", () => {
  it("lowers each foe in Showdown position order and stores every build", () => {
    const spy = vi.mocked(intimidate.applyIntimidateToFoes);
    spy.mockClear();
    let state = start();
    state = updateDoublesBuild(state, state.doubles.slots["own-right"].key, { ...createBuild("incineroar"), abilityId: "intimidate" });
    state = updateDoublesBuild(state, state.doubles.slots["opponent-right"].key, { ...createBuild("kingambit"), abilityId: "defiant" });
    const before = state;
    state = applyDoublesIntimidate(state, state.doubles.slots["own-right"].key);
    expect(spy).toHaveBeenCalledTimes(1);
    const [, foes, battle] = spy.mock.calls[0];
    // adjacentFoes(): foe position 0 (p2a, the opponent's right) first.
    expect(foes.map((foe) => [foe.build.speciesId, foe.position])).toEqual([["kingambit", "right foe"], ["blastoise", "left foe"]]);
    expect(battle).toMatchObject({ sourcePosition: "your right", gameType: "Doubles", sourceTailwind: false });
    expect(state.doubles.slots["opponent-left"].build.boosts.atk).toBe(-1);
    // Defiant: -1, then +2.
    expect(state.doubles.slots["opponent-right"].build.boosts.atk).toBe(1);
    expect(state.doubles.slots["own-left"]).toBe(before.doubles.slots["own-left"]);
    const result = doublesIntimidateResult(state.doubles, "own-right");
    expect(result).toContain("Blastoise");
    expect(result).toContain("Kingambit");
    expect(doublesIntimidateResult(state.doubles, "own-left")).toBeNull();
    const again = applyDoublesIntimidate(state, state.doubles.slots["own-right"].key);
    expect(doublesIntimidateResult(again.doubles, "own-right")).toMatch(/^Applied 2 times in a row\. /);
    // Any later build edit ends the result.
    const edited = updateDoublesHP(again, again.doubles.slots["opponent-left"].key, "50");
    expect(doublesIntimidateResult(edited.doubles, "own-right")).toBeNull();
    // Theirs: your left (p1a) first.
    const theirs = updateDoublesBuild(start(), start().doubles.slots["opponent-left"].key, { ...createBuild("incineroar"), abilityId: "intimidate" });
    spy.mockClear();
    const lowered = applyDoublesIntimidate(theirs, theirs.doubles.slots["opponent-left"].key);
    expect(lowered.doubles.slots["own-left"].build.boosts.atk).toBe(-1);
    expect(spy.mock.calls[0][1].map((foe) => [foe.build.speciesId, foe.position])).toEqual([["charizard", "left foe"], ["venusaur", "right foe"]]);
    expect(applyDoublesIntimidate(start(), start().doubles.slots["own-left"].key)).toEqual(start());
  });
});

describe("the turn input", () => {
  it("orients the field to your side, and carries Charge, contexts and actions per slot", () => {
    let state = start();
    const field = { ...state.doubles.field, gameType: "Singles" as const, attackerSide: { ...state.doubles.field.attackerSide, reflect: true } };
    expect(setDoublesField(state, state.doubles.revision + 1, field)).toBe(state);
    state = setDoublesField(state, state.doubles.revision, field);
    expect(state.doubles.field.gameType).toBe("Doubles");
    state = setDoublesCharged(state, state.doubles.slots["opponent-right"].key, true);
    expect(setDoublesCharged(state, state.doubles.slots["opponent-right"].key, true)).toBe(state);
    state = chooseDoublesMove(state, owner(state, "opponent-right"), "thunderbolt");
    const input = getDoublesTurnInput(state.doubles);
    expect(input.runtime).toBe(championsRuntime);
    expect(input.field.attackerSide.reflect).toBe(true);
    expect(input.field.defenderSide.reflect).toBe(false);
    expect(input.pokemon["opponent-right"]).toEqual({
      build: state.doubles.slots["opponent-right"].build, contexts: {}, charged: true, action: { moveId: "thunderbolt", target: "own-left" },
    });
    expect(input.pokemon["own-left"]?.charged).toBe(false);
    expect(Object.keys(input.pokemon)).toEqual([...DOUBLES_SLOTS]);
  });
});

