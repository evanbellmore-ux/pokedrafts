import { describe, expect, it } from "vitest";
import { playerCandidates } from "@/app/(app)/training/ai/candidates";
import { actionOfKey, capHabits, createHabitModel, DECAY, emptyHabits, HABITS_CAP, jointFromSlots, parseHabits } from "@/app/(app)/training/ai/habits";
import { megaOutlook } from "@/app/(app)/training/ai/mega";
import { damageRows, worthOf } from "@/app/(app)/training/ai/rows";
import type { PlayerQuestion, TurnRecord } from "@/app/(app)/training/model/decision";
import { jointActionKey, slotActionKey } from "@/app/(app)/training/model/view-types";
import { makeView, runtime, type MonSpec } from "../fixtures/training-ai";

/** SPEC 10.9 the habit model, with addendum A1.5 Mega timing. Observed actions only (I8). */
const whimsicott: MonSpec = { side: "opponent", species: "whimsicott", slot: "opponent-left", moves: ["tailwind", "moonblast", "encore", "protect"], ability: "prankster", item: "focussash", nature: "Timid", points: { hp: 2, spa: 32, spe: 32 } };
const gyarados: MonSpec = { side: "opponent", species: "gyarados", slot: "opponent-right", moves: ["waterfall", "crunch", "dragondance", "protect"], ability: "intimidate", item: "gyaradosite", nature: "Adamant", points: { hp: 2, atk: 32, spe: 32 } };
const garchomp: MonSpec = { side: "own", species: "garchomp", slot: "own-left", moves: ["earthquake", "dragonclaw", "rockslide", "protect"], ability: "roughskin", item: "lifeorb", nature: "Jolly", points: { hp: 2, atk: 32, spe: 32 } };
const charizard: MonSpec = { side: "own", species: "charizard", slot: "own-right", moves: ["heatwave", "airslash", "solarbeam", "protect"], ability: "blaze", item: "charizarditey", nature: "Modest", points: { hp: 2, spa: 32, spe: 32 }, canMega: true };

function question(specs: MonSpec[] = [whimsicott, gyarados, garchomp, charizard], turn = 1) {
  const view = makeView(specs, { turn });
  const rows = damageRows(view, runtime);
  const worth = worthOf(view, rows, runtime);
  const player = playerCandidates(view, rows, worth, null, runtime, { mega: megaOutlook(view, rows, runtime) });
  const q: Extract<PlayerQuestion, { kind: "turn" }> = { kind: "turn", turn, options: player.kept.map((c) => ({ id: c.id, action: c.action, label: c.label })), slots: player.slots };
  return { view, q };
}
const record = (q: Extract<PlayerQuestion, { kind: "turn" }>, observed: TurnRecord["observed"], observedMega: TurnRecord["observedMega"] = null): TurnRecord => ({ turn: q.turn, question: q, observed, observedMega, opponent: {} });
const targetSlot = (key: string) => key === "p2:whimsicott" ? "opponent-left" as const : key === "p2:gyarados" ? "opponent-right" as const : null;

describe("habit model", () => {
  it("learns only shown actions: a cant slot counts nothing, a move counts its class, target class and species move", () => {
    const { q } = question();
    const model = createHabitModel(null);
    model.observeTurn(record(q, {
      "own-left": { kind: "move", moveId: "dragonclaw", targetKey: "p2:gyarados", spread: false },
      "own-right": { kind: "none", reason: "cant" },
    }), { targetSlot });
    const data = model.data();
    const expected = q.slots["own-left"]!.classes[slotActionKey({ kind: "move", moveId: "dragonclaw", target: "opponent-right" })];
    expect(data.classes["*"]).toEqual({ [expected.cls]: 1 });
    expect(data.moves.garchomp).toEqual({ dragonclaw: 1 });
    expect(data.moves.charizard).toBeUndefined();
    if (expected.target) expect(data.targets[expected.cls]).toEqual({ [expected.target]: 1 });
    expect(model.record().turns).toBe(1);
  });

  it("raises the chance of a class it keeps seeing in the same situation, with backoff to the global counts", () => {
    const { q } = question();
    const model = createHabitModel(null);
    const before = model.slotPrediction(q.slots);
    const protect = jointActionKey({ "own-left": { kind: "move", moveId: "protect", target: null } });
    for (let i = 0; i < 6; i++) model.observeTurn(record(q, { "own-left": { kind: "move", moveId: "protect", targetKey: null, spread: false } }));
    const after = model.slotPrediction(q.slots);
    expect(after[protect]).toBeGreaterThan(before[protect] + 0.2);
    // Every slot's chances sum to 1.
    for (const slot of ["own-left", "own-right"] as const) {
      const total = Object.entries(after).filter(([key]) => key.startsWith(`${slot}=`)).reduce((sum, [, p]) => sum + p, 0);
      expect(total).toBeCloseTo(1, 9);
    }
    // The joint prediction over the question's options sums to 1 and favours options with Protect on the left.
    return model.predict(q, new AbortController().signal).then((prediction) => {
      const values = Object.values(prediction!.probabilities);
      expect(values.reduce((sum, p) => sum + p, 0)).toBeCloseTo(1, 9);
      const withProtect = q.options.filter((option) => option.action["own-left"]?.kind === "move" && option.action["own-left"].moveId === "protect");
      if (withProtect.length) expect(Math.max(...withProtect.map((option) => prediction!.probabilities[option.id]))).toBeGreaterThan(1 / q.options.length);
    });
  });

  it("learns your Mega timing from -mega reveals (A1.5): Mega options gain chance at the first chance", () => {
    const { q } = question();
    expect(q.slots["own-right"]!.canMega).toBe(true);
    const model = createHabitModel(null);
    const megaKey = Object.keys(q.slots["own-right"]!.classes).find((key) => key.endsWith(":megay") || key.endsWith(":mega"))!;
    const id = jointActionKey({ "own-right": actionOfKey(megaKey) });
    const prior = model.slotPrediction(q.slots)[id];
    for (let i = 0; i < 4; i++) {
      model.startBattle();
      model.observeTurn(record(q, { "own-right": { kind: "move", moveId: "heatwave", targetKey: null, spread: true } }, "own-right"));
    }
    model.startBattle();
    expect(model.slotPrediction(q.slots)[id]).toBeGreaterThan(prior);
    expect(model.data().mega["*"].yes).toBeGreaterThan(0);
    expect(model.data().mega["*"].no).toBe(0);
    // A side that keeps it: "no" counts.
    model.observeTurn(record(q, { "own-right": { kind: "move", moveId: "airslash", targetKey: "p2:whimsicott", spread: false } }));
    expect(model.data().mega["*"].no).toBe(1);
  });

  it("decays every count by 0.9 at each battle start and counts battles; observeBattle counts leads and brings by species", () => {
    const { q } = question();
    const model = createHabitModel(null);
    model.observeTurn(record(q, { "own-left": { kind: "switch", toKey: "incineroar" } }));
    model.observeBattle({ leads: ["chomp", "zard"], revealed: ["chomp", "zard", "ina"] }, { speciesOf: (key) => ({ chomp: "garchomp", zard: "charizard", ina: "incineroar" } as Record<string, string>)[key] });
    model.startBattle();
    const data = model.data();
    expect(data.battles).toBe(1);
    expect(data.classes["*"].switch).toBeCloseTo(DECAY, 12);
    expect(data.leads["charizard+garchomp"]).toBeCloseTo(DECAY, 12);
    expect(data.brings.incineroar).toBeCloseTo(DECAY, 12);
    expect(model.record().turns).toBeCloseTo(DECAY, 12);
    // The record round-trips through the page's storage.
    const restored = createHabitModel(JSON.parse(JSON.stringify(model.record())));
    expect(restored.data()).toEqual(data);
    expect(restored.record().turns).toBeCloseTo(DECAY, 12);
  });

  it("parses corrupt or foreign data as empty and caps the record at 64 KB, dropping the smallest move counts first", () => {
    for (const bad of [null, 3, "x", { v: 2 }, { v: 1, battles: -1 }, { ...emptyHabits(), classes: { "*": { protect: "a" } } }, { ...emptyHabits(), classes: { "*": { dance: 1 } } }]) {
      expect(parseHabits(bad)).toEqual(emptyHabits());
    }
    const big = emptyHabits();
    for (let s = 0; s < 400; s++) big.moves[`species${s}`] = Object.fromEntries(Array.from({ length: 24 }, (_, m) => [`move${m}`, s + m / 100]));
    big.classes["*"] = { protect: 5 };
    const capped = capHabits(big);
    expect(JSON.stringify(capped).length).toBeLessThanOrEqual(HABITS_CAP);
    expect(capped.moves.species399).toBeDefined();
    expect(capped.moves.species0).toBeUndefined();
    expect(capped.classes["*"]).toEqual({ protect: 5 });
    expect(parseHabits(capped)).toEqual(capped);
  });

  it("multiplies per-slot chances for a joint option", () => {
    const { q } = question();
    const model = createHabitModel(null);
    const slots = model.slotPrediction(q.slots);
    const option = q.options[0];
    const expected = ["own-left", "own-right"].reduce((p, slot) => p * (slots[jointActionKey({ [slot]: option.action[slot as "own-left"] })] ?? 1), 1);
    expect(jointFromSlots(slots, option.action)).toBeCloseTo(expected, 12);
  });
});
