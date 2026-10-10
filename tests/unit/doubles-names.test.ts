import { beforeAll, describe, expect, it } from "vitest";
import { settleDoublesStart } from "@/app/lib/battle/calculate";
import { calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import {
  DOUBLES_SLOTS, doublesNameParts, doublesNames, duplicateNameParts, nameText,
  type DoublesPokemonInput, type DoublesSlotId, type DoublesTurnInput, type NameParts,
} from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { validateMechanic } from "@/app/lib/battle/mechanics";
import { createBuild, createConditions, defaultAbilityActive } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleStatus } from "@/app/lib/battle/types";
import { positionalIn } from "../fixtures/naming";

/**
 * The naming pass (scripts/.cache/naming/RULES.md §1.2-1.4, §3.1): 2v2 text names each Pokémon by its species name, with
 * its team ("yours" / "opponent's") when the other side shows the same name and a number (left slot 1) when its partner
 * does. The names are the turn's, read from its input, so an Ally Switch does not move them.
 */
type P = { id: string; ability?: string; item?: string; status?: BattleStatus; move?: string | null; target?: DoublesSlotId | null };
let sv: BattleRuntime;
beforeAll(async () => {
  sv = await loadBattleRuntime("scarlet_violet");
});

function input(slots: Partial<Record<DoublesSlotId, P>>): DoublesTurnInput {
  const pokemon = Object.fromEntries(DOUBLES_SLOTS.map((slot) => {
    const p = slots[slot];
    if (!p) return [slot, null];
    const base = createBuild(p.id, sv);
    const abilityId = p.ability ?? base.abilityId;
    const build = { ...base, nature: "Serious", abilityId, abilityActive: defaultAbilityActive(abilityId), itemId: p.item ?? "", status: p.status ?? "" } as BattleBuild;
    const entry: DoublesPokemonInput = { build, contexts: {}, charged: false, action: { moveId: p.move ?? null, target: p.target ?? null } };
    return [slot, entry];
  })) as Record<DoublesSlotId, DoublesPokemonInput | null>;
  return { runtime: sv, field: { ...createConditions(), gameType: "Doubles" }, pokemon };
}
const four = (ownLeft: string, ownRight: string, opponentLeft: string, opponentRight: string) =>
  ({ "own-left": ownLeft, "own-right": ownRight, "opponent-left": opponentLeft, "opponent-right": opponentRight });
const texts = (base: Record<DoublesSlotId, string>) => DOUBLES_SLOTS.map((slot) => nameText(duplicateNameParts(base)[slot]));
const startLines = (turn: DoublesTurnInput, slot: DoublesSlotId) => {
  const settled = settleDoublesStart(turn);
  expect(settled.reason).toBeNull();
  return settled.slots[slot]!.lines;
};

describe("nameText (§1.4)", () => {
  const parts = (side: NameParts["side"], number: NameParts["number"], base = "Garchomp"): NameParts => ({ base, side, number });
  it("writes each case", () => {
    expect(nameText(parts(null, null))).toBe("Garchomp");
    expect(nameText(parts("yours", null))).toBe("Garchomp (yours)");
    expect(nameText(parts("opponent's", null))).toBe("Garchomp (opponent's)");
    expect(nameText(parts(null, 1))).toBe("Garchomp (1)");
    expect(nameText(parts(null, 2))).toBe("Garchomp (2)");
    expect(nameText(parts("yours", 1))).toBe("Garchomp (yours, 1)");
    expect(nameText(parts("opponent's", 2))).toBe("Garchomp (opponent's, 2)");
    expect(nameText(parts(null, null, ""))).toBe("");
  });
});

describe("duplicateNameParts and doublesNames (§1.2-1.3)", () => {
  it("leaves four different names as they are", () => {
    expect(texts(four("Charizard", "Venusaur", "Blastoise", "Pikachu"))).toEqual(["Charizard", "Venusaur", "Blastoise", "Pikachu"]);
  });

  it("gives a name on both sides each side's word", () => {
    expect(texts(four("Garchomp", "Venusaur", "Blastoise", "Garchomp"))).toEqual(["Garchomp (yours)", "Venusaur", "Blastoise", "Garchomp (opponent's)"]);
    expect(texts(four("Venusaur", "Garchomp", "Garchomp", "Pikachu"))).toEqual(["Venusaur", "Garchomp (yours)", "Garchomp (opponent's)", "Pikachu"]);
  });

  it("numbers a name twice on one side in slot order, the left slot 1", () => {
    expect(texts(four("Garchomp", "Garchomp", "Blastoise", "Pikachu"))).toEqual(["Garchomp (1)", "Garchomp (2)", "Blastoise", "Pikachu"]);
    expect(texts(four("Charizard", "Venusaur", "Kommo-o", "Kommo-o"))).toEqual(["Charizard", "Venusaur", "Kommo-o (1)", "Kommo-o (2)"]);
  });

  it("gives three or four of one name both", () => {
    expect(texts(four("Garchomp", "Garchomp", "Garchomp", "Pikachu"))).toEqual(["Garchomp (yours, 1)", "Garchomp (yours, 2)", "Garchomp (opponent's)", "Pikachu"]);
    expect(texts(four("Garchomp", "Pikachu", "Garchomp", "Garchomp"))).toEqual(["Garchomp (yours)", "Pikachu", "Garchomp (opponent's, 1)", "Garchomp (opponent's, 2)"]);
    expect(texts(four("Garchomp", "Garchomp", "Garchomp", "Garchomp"))).toEqual(["Garchomp (yours, 1)", "Garchomp (yours, 2)", "Garchomp (opponent's, 1)", "Garchomp (opponent's, 2)"]);
  });

  it("names an empty slot \"\" and never counts it", () => {
    const parts = duplicateNameParts(four("", "Garchomp", "", "Garchomp"));
    expect(parts["own-left"]).toEqual({ base: "", side: null, number: null });
    expect(texts(four("", "Garchomp", "", "Garchomp"))).toEqual(["", "Garchomp (yours)", "", "Garchomp (opponent's)"]);
    expect(texts(four("", "", "Blastoise", ""))).toEqual(["", "", "Blastoise", ""]);
  });

  it("reads the builds' species names, and an empty slot as \"\"", () => {
    const turn = input({ "own-left": { id: "garchomp" }, "own-right": { id: "garchomp" }, "opponent-left": { id: "garchomp" } });
    expect(doublesNameParts(turn.pokemon, sv)["own-right"]).toEqual({ base: "Garchomp", side: "yours", number: 2 });
    expect(doublesNames(turn.pokemon, sv)).toEqual({
      "own-left": "Garchomp (yours, 1)", "own-right": "Garchomp (yours, 2)", "opponent-left": "Garchomp (opponent's)", "opponent-right": "",
    });
  });

  it("keeps the turn's names after an Ally Switch", () => {
    // Reuniclus (2) uses Ally Switch first; Aqua Jet aimed at Reuniclus (1)'s place hits it, and both keep their numbers.
    const turn = input({
      "own-left": { id: "reuniclus" }, "own-right": { id: "reuniclus", move: "allyswitch" },
      "opponent-left": { id: "torkoal" }, "opponent-right": { id: "azumarill", move: "aquajet", target: "own-left" },
    });
    const result = calculateDoublesTurn(turn);
    if (result.status !== "ready") throw new Error(result.status);
    const facts = (slot: DoublesSlotId) => result.steps.find((step) => step.slot === slot)!.facts.map((fact) => fact.text);
    expect(facts("own-right")).toEqual(["Ally Switch: Reuniclus (2) and Reuniclus (1) swap places."]);
    expect(facts("opponent-right")).toEqual(["Ally Switch: Aqua Jet hits Reuniclus (2) in Reuniclus (1)'s place."]);
    expect(result.hp["own-right"]!.conditions).toEqual([{ text: "Swapped places with Reuniclus (1).", chance: 1 }]);
    expect(result.facts).toContain("Assumes Reuniclus (2) did not use Ally Switch last turn.");
  });
});

describe("the start of the turn names Pokémon, never positions (§3.1 calculate.ts)", () => {
  it("Trace: the holder and the foe it copied from", () => {
    const foes = { "opponent-left": { id: "snorlax", ability: "thickfat" }, "opponent-right": { id: "mimikyu", ability: "disguise" } };
    expect(startLines(input({ "own-left": { id: "porygon2", ability: "trace" }, "own-right": { id: "venusaur" }, ...foes }), "own-left"))
      .toContain("Trace: Porygon2 copied Thick Fat from Snorlax.");
    expect(startLines(input({ "own-left": { id: "porygon2", ability: "trace" }, "own-right": { id: "snorlax" }, ...foes }), "own-left"))
      .toContain("Trace: Porygon2 copied Thick Fat from Snorlax (opponent's).");
  });

  it("Tera Shift", () => {
    const rest = { "own-right": { id: "snorlax" }, "opponent-left": { id: "venusaur" } };
    expect(startLines(input({ "own-left": { id: "terapagos", ability: "terashift" }, ...rest, "opponent-right": { id: "blastoise" } }), "own-left"))
      .toEqual(["Tera Shift: Terapagos is Terapagos-Terastal, with Tera Shell."]);
    expect(startLines(input({ "own-left": { id: "terapagos", ability: "terashift" }, ...rest, "opponent-right": { id: "terapagos", ability: "terashift" } }), "opponent-right"))
      .toEqual(["Tera Shift: Terapagos (opponent's) is Terapagos-Terastal, with Tera Shell."]);
  });

  it("Download", () => {
    const rest = { "own-right": { id: "snorlax" }, "opponent-left": { id: "blastoise" }, "opponent-right": { id: "venusaur" } };
    const [line] = startLines(input({ "own-left": { id: "porygonz", ability: "download" }, ...rest }), "own-left");
    expect(line).toMatch(/^Porygon-Z's Download raised its (?:Attack|Sp\. Atk)\.$/);
    const twins = input({ "own-left": { id: "porygonz", ability: "download" }, "own-right": { id: "porygonz", ability: "download" }, "opponent-left": { id: "blastoise" }, "opponent-right": { id: "venusaur" } });
    expect(startLines(twins, "own-right")[0]).toMatch(/^Porygon-Z \(2\)'s Download raised its (?:Attack|Sp\. Atk)\.$/);
  });

  it("Lum Berry", () => {
    const zard = { id: "charizard", item: "lumberry", status: "par" as const };
    const rest = { "own-right": { id: "venusaur" }, "opponent-left": { id: "blastoise" } };
    expect(startLines(input({ "own-left": zard, ...rest, "opponent-right": { id: "pikachu" } }), "own-left"))
      .toEqual(["Charizard's Lum Berry cured its paralysis (used up)."]);
    expect(startLines(input({ "own-left": zard, ...rest, "opponent-right": { id: "charizard" } }), "own-left"))
      .toEqual(["Charizard (yours)'s Lum Berry cured its paralysis (used up)."]);
  });
});

describe("the positional guard (tests/fixtures/naming.ts)", () => {
  it("finds position words in text, attributes and screen-reader text, and nothing else", () => {
    expect(positionalIn("<h4>Charizard<span class=\"sr-only\"> (your left)</span></h4>")).toEqual(["your left"]);
    expect(positionalIn("<div aria-label=\"Pikachu opponent&#x27;s right current HP\"></div>")).toEqual(["opponent's right"]);
    expect(positionalIn("<span>Left foe</span><span>Lead · right</span><button>Right</button>")).toEqual(["Left foe", "Lead · right", ">Right<"]);
    expect(positionalIn("<ul aria-label=\"Your team left roster\"></ul><p>Garchomp (left)</p>")).toEqual(["left roster", "(left)"]);
    for (const fine of [
      "<p>You: 3 left · AI: 4 left</p>", "<div data-slot=\"own-left\" class=\"left-0\"></div>", "<p>Charizard (yours) and Garchomp (opponent&#x27;s, 2)</p>",
      "<p>No Pokémon left</p>", "<p>Protect right after a Protect</p>", "<p>Left out of the count</p>",
    ]) expect(positionalIn(fine), fine).toEqual([]);
  });
});

describe("the Tera fact (§2)", () => {
  it("states that no Tera type is set", () => {
    const build = { ...createBuild("garchomp", sv), mechanic: "tera" as const, configuration: {} };
    expect(validateMechanic(build, sv)).toContainEqual({ field: "configuration.teraType", message: "No Tera type." });
  });
});
