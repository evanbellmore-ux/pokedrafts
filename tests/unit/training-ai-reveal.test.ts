import { describe, expect, it } from "vitest";
import { readNames } from "@/app/(app)/training/ai/engine-provider";
import { megaOutlook } from "@/app/(app)/training/ai/mega";
import { megaFact, readReason } from "@/app/(app)/training/ai/reveal";
import { damageRows } from "@/app/(app)/training/ai/rows";
import type { DoublesSlotId } from "@/app/lib/battle/doubles-types";
import type { DecisionOption, JointAction, SlotAction } from "@/app/(app)/training/model/view-types";
import { makeView, runtime, type MonSpec } from "../fixtures/training-ai";

/** SPEC 10.12 the read's sentence, and addendum A1.5's Mega fact. */
const gyarados: MonSpec = { side: "opponent", species: "gyarados", slot: "opponent-left", moves: ["waterfall", "crunch", "protect", "icefang"], ability: "intimidate", item: "sitrusberry", nature: "Adamant", points: { hp: 2, atk: 32, spe: 32 } };
const charizard: MonSpec = { side: "opponent", species: "charizard", slot: "opponent-right", moves: ["heatwave", "airslash", "solarbeam", "protect"], ability: "blaze", item: "charizarditey", nature: "Modest", points: { hp: 2, spa: 32, spe: 32 }, canMega: true };
const garchompAI: MonSpec = { side: "opponent", member: "garchomp", species: "garchomp", slot: null, moves: ["earthquake", "dragonclaw", "rockslide", "protect"], ability: "roughskin", item: "lifeorb", nature: "Jolly", points: { hp: 2, atk: 32, spe: 32 } };
const rotom: MonSpec = { side: "own", species: "rotomwash", slot: "own-left", moves: ["hydropump", "thunderbolt", "willowisp", "protect"], ability: "levitate", item: "sitrusberry", nature: "Modest", points: { hp: 32, spa: 32 } };
const incineroar: MonSpec = { side: "own", species: "incineroar", slot: "own-right", moves: ["fakeout", "flareblitz", "knockoff", "protect"], ability: "intimidate", item: "sitrusberry", nature: "Careful", points: { hp: 32, spd: 32 } };

const move = (moveId: string, target: DoublesSlotId | null = null): Extract<SlotAction, { kind: "move" }> => ({ kind: "move", moveId, target });
function read(specs: MonSpec[], q: DecisionOption[], chosen: JointAction) {
  const view = makeView(specs);
  const rows = damageRows(view, runtime);
  return { view, rows, text: readReason({ view, rows, q, chosen, names: readNames(view, runtime), runtime }) };
}

describe("readReason", () => {
  const thunderbolt: JointAction = { "own-left": move("thunderbolt", "opponent-left"), "own-right": move("flareblitz", "opponent-right") };
  it("1. a switch out of a predicted hit", () => {
    const { text } = read([gyarados, charizard, garchompAI, rotom, incineroar], [{ action: thunderbolt, chance: 0.75 }, { action: { "own-left": move("protect"), "own-right": move("protect") }, chance: 0.25 }],
      { "opponent-left": { kind: "switch", to: "garchomp" }, "opponent-right": move("heatwave") });
    expect(text).toBe("Predicted Thunderbolt into Gyarados (75%), so it switched to Garchomp.");
  });
  it("2. a Protect where the expected damage was at least half its HP", () => {
    const { text } = read([gyarados, charizard, garchompAI, rotom, { ...incineroar, moves: ["fakeout", "flareblitz", "knockoff", "protect"] }],
      [{ action: { "own-left": move("thunderbolt", "opponent-left"), "own-right": move("knockoff", "opponent-left") }, chance: 0.6 }, { action: thunderbolt, chance: 0.4 }],
      { "opponent-left": move("protect"), "opponent-right": move("heatwave") });
    expect(text).toBe("Predicted Thunderbolt into Gyarados (100%), so Gyarados protected.");
  });
  it("3. no Protect predicted from the target", () => {
    const { text } = read([gyarados, charizard, garchompAI, rotom, incineroar], [{ action: thunderbolt, chance: 0.9 }, { action: { "own-left": move("protect"), "own-right": move("flareblitz", "opponent-right") }, chance: 0.1 }],
      { "opponent-left": move("waterfall", "own-right"), "opponent-right": move("airslash", "own-left") });
    expect(text).toBe("Predicted no Protect from Incineroar (100%).");
  });
  it("4. the top prediction, with switches and moves without a target", () => {
    const noProtect: MonSpec = { ...incineroar, moves: ["fakeout", "flareblitz", "knockoff", "uturn"] };
    const { text } = read([gyarados, charizard, garchompAI, rotom, noProtect], [{ action: { "own-left": move("protect"), "own-right": { kind: "switch", to: "garchomp" } }, chance: 0.6 }, { action: thunderbolt, chance: 0.4 }],
      { "opponent-left": move("waterfall", "own-right"), "opponent-right": move("heatwave") });
    expect(text).toBe("Predicted Protect and Incineroar to an unseen Pokémon (60%).");
  });
  it("5. otherwise nothing", () => {
    const { text } = read([gyarados, charizard, garchompAI, rotom, incineroar], [{ action: thunderbolt, chance: 0.2 }, { action: { "own-left": move("protect"), "own-right": move("protect") }, chance: 0.2 }],
      { "opponent-left": move("crunch", "own-left"), "opponent-right": move("heatwave") });
    // Rotom can Protect and is predicted to 20%: rule 3 does not apply; no prediction reaches 25%.
    expect(text).toBeNull();
  });
});

describe("megaFact (A1.5)", () => {
  function fact(specs: MonSpec[], q: DecisionOption[], chosen: JointAction) {
    const view = makeView(specs);
    const rows = damageRows(view, runtime);
    return megaFact({ view, rows, q, chosen, names: readNames(view, runtime), runtime, mega: megaOutlook(view, rows, runtime) });
  }
  const venusaur: MonSpec = { side: "own", species: "venusaur", slot: "own-left", moves: ["gigadrain", "sludgebomb", "sleeppowder", "protect"], ability: "chlorophyll", item: "", nature: "Modest", points: { hp: 32, spa: 32 } };
  it("states the Mega form's weather before the move it powers", () => {
    const value = fact([gyarados, charizard, garchompAI, venusaur, incineroar], [{ action: { "own-left": move("protect"), "own-right": move("fakeout", "opponent-right") }, chance: 1 }],
      { "opponent-left": move("waterfall", "own-right"), "opponent-right": { ...move("heatwave"), mega: "megay" } });
    expect(value).toEqual({ memberKey: "charizard", evolved: true, moves: ["heatwave"], text: "Mega Evolved Charizard: Drought before Heat Wave." });
  });
  it("states a kept Mega whose ability would weaken the partner's move", () => {
    const value = fact([{ ...gyarados, moves: ["waterfall", "crunch", "protect", "icefang"] }, charizard, garchompAI, venusaur, incineroar],
      [{ action: { "own-left": move("protect"), "own-right": move("protect") }, chance: 1 }],
      { "opponent-left": move("waterfall", "own-left"), "opponent-right": move("protect") });
    expect(value).toEqual({ memberKey: "charizard", evolved: false, moves: ["waterfall"], text: "Kept Mega Evolution: Drought would weaken Gyarados's Waterfall." });
  });
  it("states a kept Mega whose types would take the predicted move super-effectively", () => {
    const zardX: MonSpec = { ...charizard, item: "charizarditex", moves: ["flareblitz", "dragonclaw", "protect", "airslash"], nature: "Adamant", points: { hp: 2, atk: 32, spe: 32 } };
    const chomp: MonSpec = { side: "own", species: "garchomp", slot: "own-left", moves: ["earthquake", "rockslide", "protect", "stoneedge"], ability: "roughskin", item: "lifeorb", nature: "Jolly", points: { hp: 2, atk: 32, spe: 32 } };
    const value = fact([gyarados, zardX, chomp, incineroar], [{ action: { "own-left": move("earthquake"), "own-right": move("protect") }, chance: 1 }],
      { "opponent-left": move("waterfall", "own-left"), "opponent-right": move("flareblitz", "own-right") });
    expect(value?.text).toBe("Kept Mega Evolution: Charizard-Mega-X would take Earthquake super-effectively.");
    expect(value?.evolved).toBe(false);
  });
  it("is null without a Mega Evolution available", () => {
    expect(fact([gyarados, { ...charizard, item: "", canMega: false }, garchompAI, venusaur, incineroar], [], { "opponent-left": move("protect"), "opponent-right": move("protect") })).toBeNull();
  });
});
