import assert from "node:assert/strict";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  activateMoveSlot, createMatchup, dismissMoveReplacement, getAttackView, getMoveOwner,
  replaceMatchupMove, selectMatchupMove, toggleMatchupMega, updateMatchupBuild, updateMatchupHP,
  updateMatchupMoveContext, type BattleSide, type Combatant, type PreparedMatchup,
} from "@/app/(app)/calculator/roster-prep";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { champions, itemsById, speciesById } from "@/app/lib/battle/catalog";
import { getMegaOptions, type MegaOption } from "@/app/lib/battle/mega-forms";
import { createBuild, getBuildStats, SHARED_FIELD_EFFECTS, validateBuild } from "@/app/lib/battle/model";
import type { BattleBuild } from "@/app/lib/battle/types";

type BaseSnapshot = Pick<BattleBuild, "speciesId" | "abilityId" | "abilityActive" | "itemId">;

function baseFields({ speciesId, abilityId, abilityActive, itemId }: BattleBuild): BaseSnapshot {
  return { speciesId, abilityId, abilityActive, itemId };
}

function toggle(current: PreparedMatchup, formId: string, side: BattleSide = "attacker") {
  return toggleMatchupMega(current, getMoveOwner(current[side]), formId);
}

function expectSharedPrep(next: PreparedMatchup, previous: PreparedMatchup, side: BattleSide = "attacker") {
  const other = side === "attacker" ? "defender" : "attacker";
  for (const key of ["key", "role", "source", "editorRevision", "hpInput", "moves", "contexts"] as const) {
    expect(next[side][key]).toBe(previous[side][key]);
  }
  for (const key of ["nature", "points", "boosts", "status", "currentHP"] as const) {
    expect(next[side].build[key]).toBe(previous[side].build[key]);
  }
  for (const key of ["revision", "accountId", "selection", "field"] as const) expect(next[key]).toBe(previous[key]);
  expect(next[other]).toBe(previous[other]);
  expect(next[side].moveEpoch).toBe(previous[side].moveEpoch + 1);
}

describe("authoritative Champions Mega families", () => {
  it("exports readonly options and requires an explicitly nullable, four-field base snapshot", () => {
    expectTypeOf(getMegaOptions).returns.toEqualTypeOf<readonly MegaOption[]>();
    expectTypeOf<Combatant["megaBase"]>().toEqualTypeOf<BaseSnapshot | null>();
    const current = createMatchup();
    expect(current.attacker.megaBase).toBeNull();
    expect(current.defender.megaBase).toBeNull();
  });

  it("covers exactly all 82 targets, 81 stones and 77 entry forms, with complete consistently ordered families", () => {
    const pairs = champions.items.flatMap((item) => item.megaTargets.map((target) => ({ ...target, itemId: item.id })));
    expect(pairs).toHaveLength(82);
    expect(new Set(pairs.map(({ itemId }) => itemId)).size).toBe(81);
    expect(new Set(pairs.map(({ baseSpeciesId }) => baseSpeciesId)).size).toBe(77);
    expect(new Set(pairs.map(({ formId }) => formId)).size).toBe(82);
    const order = ["Mega", "Mega X", "Mega Y", "Mega Z"];
    for (const { baseSpeciesId, formId, itemId } of pairs) {
      const base = speciesById.get(baseSpeciesId)!;
      const form = speciesById.get(formId)!;
      expect(base, baseSpeciesId).toBeDefined();
      expect(form, formId).toBeDefined();
      expect(form.requiredItem, formId).toBe(itemId);
      expect(form.baseStats.hp, formId).toBe(base.baseStats.hp);
      expect(form.moves, formId).toEqual(base.moves);
      const expected = pairs.filter((pair) => pair.baseSpeciesId === baseSpeciesId).map((pair) => {
        const suffix = pair.formId.match(/mega([xyz])$/)?.[1].toUpperCase();
        return { ...pair, label: suffix ? `Mega ${suffix}` : "Mega" };
      }).sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
      expect(getMegaOptions(baseSpeciesId), baseSpeciesId).toEqual(expected);
      expect(getMegaOptions(formId), formId).toEqual(expected);
    }
    const members = new Set(pairs.flatMap(({ baseSpeciesId, formId }) => [baseSpeciesId, formId]));
    for (const species of champions.species) {
      if (!members.has(species.id)) expect(getMegaOptions(species.id), species.id).toEqual([]);
    }
  });

  it.each([
    ["banette", [["banettemega", "banettite", "Mega"]]],
    ["charizard", [["charizardmegax", "charizarditex", "Mega X"], ["charizardmegay", "charizarditey", "Mega Y"]]],
    ["raichu", [["raichumegax", "raichunitex", "Mega X"], ["raichumegay", "raichunitey", "Mega Y"]]],
    ["absol", [["absolmega", "absolite", "Mega"], ["absolmegaz", "absolitez", "Mega Z"]]],
    ["garchomp", [["garchompmega", "garchompite", "Mega"], ["garchompmegaz", "garchompitez", "Mega Z"]]],
    ["lucario", [["lucariomega", "lucarionite", "Mega"], ["lucariomegaz", "lucarionitez", "Mega Z"]]],
    ["floetteeternal", [["floettemega", "floettite", "Mega"]]],
    ["meowstic", [["meowsticmmega", "meowsticite", "Mega"]]],
    ["meowsticf", [["meowsticfmega", "meowsticite", "Mega"]]],
  ] as const)("uses the exact entry and stones for %s, including non-scalar gender mappings", (baseSpeciesId, options) => {
    const expected = options.map(([formId, itemId, label]) => ({ baseSpeciesId, formId, itemId, label }));
    for (const member of [baseSpeciesId, ...options.map(([id]) => id)]) expect(getMegaOptions(member)).toEqual(expected);
    expect(itemsById.get("meowsticite")).toMatchObject({ megaStone: null, megaEvolves: null });
  });

  it.each(["raichualola", "slowbrogalar", "floette", "ditto", "madeupmon", "", "Charizard", " charizard "])("never infers a family for %j from spelling or shared baseSpecies", (id) => {
    expect(getMegaOptions(id)).toEqual([]);
  });

  it("ignores scalar-only stones, missing catalog entries and mismatched required items", async () => {
    const charizardX = itemsById.get("charizarditex")!;
    const charizardY = itemsById.get("charizarditey")!;
    const catalog = {
      ...champions,
      items: [
        { ...charizardX, megaTargets: [] }, // Scalar megaStone/megaEvolves alone cannot authorize a form.
        { ...charizardY, megaTargets: [{ baseSpeciesId: "charizard", formId: "charizardmegax" }] }, // Wrong required stone.
        { ...itemsById.get("banettite")!, megaTargets: [
          { baseSpeciesId: "missing-entry", formId: "banettemega" },
          { baseSpeciesId: "banette", formId: "missing-form" },
        ] },
        itemsById.get("meowsticite")!, // Valid multi-target entry with deliberately null scalar fields.
      ],
    };
    vi.resetModules();
    vi.doMock("@/app/lib/battle/catalog", () => ({
      champions: catalog,
      speciesById: new Map(catalog.species.map((species) => [species.id, species])),
      itemsById: new Map(catalog.items.map((item) => [item.id, item])),
      movesById: new Map(catalog.moves.map((move) => [move.id, move])),
      abilitiesById: new Map(catalog.abilities.map((ability) => [ability.id, ability])),
    }));
    try {
      const { getMegaOptions: options } = await import("@/app/lib/battle/mega-forms");
      for (const id of ["charizard", "charizardmegax", "charizardmegay", "banette", "banettemega", "missing-entry", "missing-form"]) {
        expect(options(id), id).toEqual([]);
      }
      expect(options("meowstic")).toEqual([{ baseSpeciesId: "meowstic", formId: "meowsticmmega", itemId: "meowsticite", label: "Mega" }]);
      expect(options("meowsticf")).toEqual([{ baseSpeciesId: "meowsticf", formId: "meowsticfmega", itemId: "meowsticite", label: "Mega" }]);
    } finally {
      vi.doUnmock("@/app/lib/battle/catalog");
      vi.resetModules();
    }
  });
});

describe("owned Mega preparation", () => {
  it.each(["00100", "abc", "2e1", " ", "", "0", "999", "1.5"])("preserves current shared prep and raw HP %j while switching X/Y and restoring only four base fields", (text) => {
    let current = createMatchup(3);
    assert(current.attacker.build.game === "champions");
    current = updateMatchupBuild(current, "attacker", {
      ...current.attacker.build, nature: "Modest", abilityId: "solarpower", abilityActive: true, itemId: "lifeorb",
      points: { hp: 5, atk: 0, def: 0, spa: 29, spd: null, spe: 32 },
      boosts: { atk: 2, def: -1, spa: 3, spd: null, spe: 0 }, status: "tox",
    });
    current = updateMatchupHP(current, "attacker", text);
    current.attacker.contexts = { flamethrower: { hits: 3 } };
    current = activateMoveSlot(current, getMoveOwner(current.attacker), 1);
    current = replaceMatchupMove(current, current.replacement!, "protect");
    for (const { key } of SHARED_FIELD_EFFECTS) current.field[key] = true;
    current.field.weather = "Snow";
    current.field.defenderSide.lightScreen = true;
    const before = structuredClone(current);
    const x = toggle(current, "charizardmegax");
    expect(x.attacker.build).toEqual({ ...current.attacker.build, ...baseFields(createBuild("charizardmegax")) });
    expect(x.attacker.megaBase).toEqual(baseFields(current.attacker.build));
    expect(Object.keys(x.attacker.megaBase!).sort()).toEqual(["abilityActive", "abilityId", "itemId", "speciesId"]);
    expectSharedPrep(x, current);
    expect(x.cache).toBe(current.cache);
    expect(current).toEqual(before);
    assert(x.attacker.build.game === "champions");
    const edited = updateMatchupBuild(x, "attacker", {
      ...x.attacker.build, nature: "Timid", status: "par", points: { ...x.attacker.build.points, hp: 9 },
      boosts: { ...x.attacker.build.boosts, atk: -3 },
    });
    const y = toggle(edited, "charizardmegay");
    expect(y.attacker.build).toEqual({ ...edited.attacker.build, ...baseFields(createBuild("charizardmegay")) });
    expect(y.attacker.megaBase).toBe(x.attacker.megaBase);
    expectSharedPrep(y, edited);
    const off = toggle(y, "charizardmegay");
    expect(off.attacker.build).toEqual({ ...y.attacker.build, ...baseFields(current.attacker.build) });
    expect(off.attacker.megaBase).toBeNull();
    expectSharedPrep(off, y);
    expect(off.attacker.build.points).not.toBe(current.attacker.build.points);
    expect(off.attacker.hpInput).toBe(text);
    expect(off.attack.moveId).toBe("protect");
    expect(off.replacement!.slotIndex).toBe(1);
  });

  it("preserves HP edits made after transforming instead of restoring a stale full build", () => {
    const original = updateMatchupHP(createMatchup(), "attacker", "00100");
    const mega = toggle(original, "charizardmegax");
    const edited = updateMatchupHP(mega, "attacker", "2e1");
    const off = toggle(edited, "charizardmegax");
    expect(off.attacker.hpInput).toBe("2e1");
    expect(off.attacker.build.currentHP).toBeNaN();
    expect(original.attacker.build.currentHP).toBe(100);
    expect(original.attacker.hpInput).toBe("00100");
    expectSharedPrep(off, edited);
  });

  it.each([
    ["charizardmegax", "charizardmegay", "charizard"],
    ["floettemega", "floettemega", "floetteeternal"],
    ["meowsticfmega", "meowsticfmega", "meowsticf"],
    ["meowsticmmega", "meowsticmmega", "meowstic"],
  ])("uses entry defaults when directly selected %s has no snapshot, even across variants", (formId, alternate, baseSpeciesId) => {
    let current = updateMatchupBuild(createMatchup(), "attacker", {
      ...createBuild(formId), nature: "Jolly", abilityActive: true, currentHP: 50,
      points: { hp: 4, atk: 30, def: 0, spa: 0, spd: 0, spe: 32 }, status: "psn",
    });
    expect(current.attacker.megaBase).toBeNull();
    if (alternate !== formId) {
      current = toggle(current, alternate);
      expect(current.attacker.megaBase).toBeNull();
    }
    const next = toggle(current, alternate);
    expect(next.attacker.build).toEqual({ ...current.attacker.build, ...baseFields(createBuild(baseSpeciesId)) });
    expect(next.attacker.megaBase).toBeNull();
    expectSharedPrep(next, current);
  });

  it.each([
    ["attacker", "attacker"], ["attacker", "defender"], ["defender", "attacker"], ["defender", "defender"],
  ] as const)("migrates only transformed %s ownership while the attack and editor belong to %s", (side, sourceSide) => {
    let current = updateMatchupBuild(createMatchup(), "defender", createBuild("charizard"));
    current.attacker.contexts = { flamethrower: { hits: 2 } };
    current.defender.contexts = { flamethrower: { hits: 5 } };
    current = activateMoveSlot(current, getMoveOwner(current[sourceSide]), 2);
    current.field.attackerSide.helpingHand = true;
    current.field.defenderSide.lightScreen = true;
    const owner = getMoveOwner(current[side]);
    const replacement = current.replacement!;
    const before = structuredClone(current);
    const next = toggleMatchupMega(current, { ...owner }, "charizardmegax");
    expectSharedPrep(next, current, side);
    expect(getAttackView(next).sourceSide).toBe(sourceSide);
    expect(getAttackView(next).receiverSide).toBe(sourceSide === "attacker" ? "defender" : "attacker");
    expect(getAttackView(next).contexts).toBe(current[sourceSide].contexts);
    expect(next.attack.moveId).toBe(current.attack.moveId);
    if (side === sourceSide) {
      expect(next.attack.owner).toEqual(getMoveOwner(next[side]));
      expect(next.replacement).toEqual({ owner: getMoveOwner(next[side]), slotIndex: 2, session: current.replacementSession + 1 });
      expect(next.replacementSession).toBe(current.replacementSession + 1);
      expect(replaceMatchupMove(next, replacement, "protect")).toBe(next);
      expect(dismissMoveReplacement(next, replacement)).toBe(next);
      const replacementEdit = replaceMatchupMove(next, next.replacement!, "protect");
      expect(replacementEdit[sourceSide].moves[2].moveId).toBe("protect");
      expect(replacementEdit.attack.moveId).toBe("protect");
    } else {
      expect(next.attack).toBe(current.attack);
      expect(next.replacement).toBe(replacement);
      expect(next.replacementSession).toBe(current.replacementSession);
      expect(replaceMatchupMove(next, replacement, "protect")[sourceSide].moves[2].moveId).toBe("protect");
    }
    expect(activateMoveSlot(next, owner, 0)).toBe(next);
    expect(selectMatchupMove(next, "flamethrower", owner)).toBe(next);
    expect(updateMatchupMoveContext(next, owner, "flamethrower", { hits: 3 })).toBe(next);
    expect(toggleMatchupMega(next, owner, "charizardmegay")).toBe(next);
    const off = toggle(next, "charizardmegax", side);
    expect(off[side].build.speciesId).toBe("charizard");
    expect(toggleMatchupMega(off, owner, "charizardmegax")).toBe(off);
    expect(activateMoveSlot(off, owner, 0)).toBe(off);
    expect(current).toEqual(before);
  });

  it("keeps a selected exploration move and no editor through the whole Mega round trip", () => {
    const current = selectMatchupMove(createMatchup(), "protect");
    expect(current.attacker.moves.some((move) => move.moveId === "protect")).toBe(false);
    const on = toggle(current, "charizardmegax");
    const off = toggle(on, "charizardmegax");
    for (const next of [on, off]) {
      expect(next.attack).toEqual({ owner: getMoveOwner(next.attacker), moveId: "protect" });
      expect(next.replacement).toBeNull();
      expect(next.replacementSession).toBe(current.replacementSession);
    }
    const unselected = toggle(createMatchup(), "charizardmegax");
    expect(unselected.attack).toEqual({ owner: getMoveOwner(unselected.attacker), moveId: null });
  });

  it("requires a current owner and an exact target in that combatant's authoritative family", () => {
    const current = createMatchup();
    const owner = getMoveOwner(current.attacker);
    for (const stale of [{ ...owner, key: 999 }, { ...owner, epoch: owner.epoch - 1 }, { ...owner, epoch: Number.NaN }]) {
      expect(toggleMatchupMega(current, stale, "charizardmegax")).toBe(current);
    }
    for (const id of ["", "charizard", "Charizard-Mega-X", " charizardmegax ", "blastoisemega", "raichumegax", "banettemega", "madeupmon"]) {
      expect(toggleMatchupMega(current, owner, id)).toBe(current);
    }
    for (const [speciesId, formId] of [["raichualola", "raichumegax"], ["slowbrogalar", "slowbromega"], ["meowsticf", "meowsticmmega"], ["meowstic", "meowsticfmega"], ["madeupmon", "charizardmegax"]]) {
      const unrelated = updateMatchupBuild(current, "attacker", createBuild(speciesId));
      expect(toggle(unrelated, formId)).toBe(unrelated);
    }
  });
});

describe("Mega calculations and honest unsupported states", () => {
  it.each([
    ["raichumegax", "raichunitex", "electricsurge"],
    ["raichumegay", "raichunitey", "noguard"],
  ])("applies the exact supported %s ability and stone without damaging HP or changing the field", (formId, itemId, abilityId) => {
    const base = updateMatchupBuild(createMatchup(), "attacker", createBuild("raichu"));
    const next = toggle(base, formId);
    expect(next.attacker.build).toMatchObject({ speciesId: formId, itemId, abilityId });
    expect(validateBuild(next.attacker.build)).toEqual([]);
    expect(next.field).toBe(base.field);
    expect(next.field.terrain).toBe("");
    expect(getBuildStats(next.attacker.build)!.hp).toBe(getBuildStats(base.attacker.build)!.hp);
    const before = calculateMatchup(base.attacker.build, base.defender.build, base.field);
    const after = calculateMatchup(next.attacker.build, next.defender.build, next.field);
    expect(after.issues).toEqual({ attacker: [], defender: [], field: [] });
    const moveId = formId === "raichumegax" ? "thunderpunch" : "thunderbolt";
    const damage = after.results.find((row) => row.moveId === moveId)!;
    expect(damage.kind).toBe("calculated");
    expect(damage.min).toBeGreaterThan(0);
    expect(damage.rolls).not.toEqual(before.results.find((row) => row.moveId === moveId)!.rolls);
    expect(next.attacker.build.currentHP).toBeNull();
    expect(next.defender.build.currentHP).toBeNull();
  });

  it("updates real damage for X and Y, and restores the original base calculation on toggle off", () => {
    let base = updateMatchupBuild(createMatchup(), "attacker", { ...createBuild("charizard"), abilityId: "solarpower", itemId: "lifeorb" });
    base = updateMatchupHP(base, "defender", "00100");
    base = selectMatchupMove(base, "flamethrower");
    const x = toggle(base, "charizardmegax");
    const y = toggle(x, "charizardmegay");
    const off = toggle(y, "charizardmegay");
    const results = [base, x, y, off].map((state) => {
      const view = getAttackView(state);
      const result = calculateMatchup(view.source.build, view.receiver.build, view.field, view.contexts);
      expect(result.issues).toEqual({ attacker: [], defender: [], field: [] });
      return result.results.find((row) => row.moveId === "flamethrower")!;
    });
    for (const result of results) expect(result.kind).toBe("calculated");
    expect(x.attacker.build.abilityId).toBe("toughclaws");
    expect(y.attacker.build.abilityId).toBe("drought");
    expect(results[1].rolls).not.toEqual(results[0].rolls);
    expect(results[2].rolls).not.toEqual(results[1].rolls);
    expect(results[3]).toEqual(results[0]);
    expect(y.field.weather).toBe("");
    expect(off.defender.hpInput).toBe("00100");
    expect(off.defender.build.currentHP).toBe(100);
    for (const state of [x, y]) {
      for (const itemId of ["", "lifeorb", state === x ? "charizarditey" : "charizarditex"]) {
        const illegal = { ...state.attacker.build, itemId };
        expect(validateBuild(illegal)).toEqual(expect.arrayContaining([expect.objectContaining({ field: "itemId", message: expect.stringContaining("requires") })]));
        const blocked = calculateMatchup(illegal, state.defender.build, state.field);
        expect(blocked.results).toEqual([]);
        expect(blocked.issues.attacker.some((issue) => issue.field === "itemId")).toBe(true);
      }
    }
  });

  it("keeps Lucario Z selectable but exposes unsupported Aura Guard and never fabricates damage", () => {
    let base = updateMatchupBuild(createMatchup(), "attacker", createBuild("lucario"));
    base = selectMatchupMove(base, "aurasphere");
    const mega = toggle(base, "lucariomegaz");
    expect(mega.attacker.build).toMatchObject({ speciesId: "lucariomegaz", itemId: "lucarionitez", abilityId: "auraguard" });
    expect(mega.attack.moveId).toBe("aurasphere");
    const issues = validateBuild(mega.attacker.build);
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "speciesId", message: expect.stringMatching(/Aura Guard|auraguard/i) }),
      expect.objectContaining({ field: "abilityId" }),
    ]));
    const result = calculateMatchup(mega.attacker.build, mega.defender.build, mega.field);
    expect(result.issues.attacker).toEqual(issues);
    expect(result.results).toEqual([]);
    const normalMega = toggle(mega, "lucariomega");
    expect(normalMega.attacker.megaBase).toBe(mega.attacker.megaBase);
    expect(validateBuild(normalMega.attacker.build)).toEqual([]);
    expect(calculateMatchup(normalMega.attacker.build, normalMega.defender.build, normalMega.field).results.find((row) => row.moveId === "aurasphere")!.kind).toBe("calculated");
  });
});
