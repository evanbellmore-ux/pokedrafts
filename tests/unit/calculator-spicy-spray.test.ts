import { describe, expect, it } from "vitest";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import { championsRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, MoveContext } from "@/app/lib/battle/types";

/**
 * Spicy Spray (Scovillain-Mega) burns the attacker after the first hit: pinned Showdown c23d2e94's
 * real useMove pipeline, per-hit rolls with the target kept alive. Level 50, 0 Stat Points, Serious
 * nature, Singles, no crit.
 */
function build(id: string, abilityId: string, extra: Partial<BattleBuild> = {}): BattleBuild {
  return { ...createBuild(id), abilityId, ...extra } as BattleBuild;
}
const scovillain = build("scovillainmega", "spicyspray");
const NOTE = "Spicy Spray: the attacker is burned from the second hit on (assumes no Safeguard).";

function hits(moveId: string, attacker: BattleBuild, context?: MoveContext, field: Partial<BattleConditions> = {}, defender = scovillain) {
  const out = calculateMatchup(attacker, defender, { ...createConditions(), gameType: "Singles", ...field }, context ? { [moveId]: context } : {}, championsRuntime);
  expect(out.issues).toEqual({ attacker: [], defender: [], field: [] });
  const row = out.results.find((result) => result.moveId === moveId)!;
  return { row, hits: (row.rolls as number[][]).map((hit) => `${hit[0]}-${hit[15]}`) };
}

describe("Spicy Spray", () => {
  it("halves the later physical hits of multi-hit moves", () => {
    const darts = hits("dragondarts", build("dragapult", "clearbody"));
    expect(darts.hits).toEqual(["39-46", "19-23"]);
    expect(darts.row.assumptions).toContain(NOTE);
    expect(hits("scaleshot", build("garchomp", "roughskin"), { hits: 5 }).hits).toEqual(["21-25", "10-12", "10-12", "10-12", "10-12"]);
    expect(hits("tripleaxel", build("weavile", "pressure")).hits).toEqual(["16-19", "15-18", "23-27"]);
    expect(hits("populationbomb", build("mausholdfour", "technician")).hits).toEqual(["16-19", ...Array(9).fill("8-9")]);
  });

  it("burns before Parental Bond's second strike and Beat Up's later hits", () => {
    const kangaskhan = build("kangaskhanmega", "parentalbond");
    expect(hits("doubleedge", kangaskhan).hits).toEqual(["93-111", "11-13"]);
    // Facade's second strike doubles instead, and a special move is unaffected.
    expect(hits("facade", kangaskhan).hits).toEqual(["55-66", "27-33"]);
    const shadowBall = hits("shadowball", kangaskhan);
    expect(shadowBall.hits).toEqual(["23-28", "5-7"]);
    expect(shadowBall.row.assumptions).not.toContain(NOTE);
    expect(hits("beatup", build("mausholdfour", "technician"), { party: ["garchomp", "incineroar"] }).hits).toEqual(["7-9", "5-6", "4-5"]);
  });

  it("lets Guts boost the later hits", () => {
    const guts = hits("rockblast", build("conkeldurr", "guts"), { hits: 5 });
    expect(guts.hits).toEqual(["30-36", ...Array(4).fill("44-54")]);
    expect(guts.row.description).toContain("Applied: Guts.");
  });

  it("burns again after a Lum or Rawst Berry cures the first burn", () => {
    const berry = (itemId: string) => build("garchomp", "roughskin", { itemId });
    const lum = hits("scaleshot", berry("lumberry"), { hits: 5 });
    expect(lum.hits).toEqual(["21-25", "21-25", "10-12", "10-12", "10-12"]);
    expect(lum.row.assumptions).toContain("Spicy Spray: the attacker is burned from the third hit on (its Lum Berry cured the first burn; assumes no Safeguard).");
    expect(hits("scaleshot", berry("rawstberry"), { hits: 3 }).hits).toEqual(["21-25", "21-25", "10-12"]);
    expect(hits("tripleaxel", build("weavile", "pressure", { itemId: "lumberry" })).hits).toEqual(["16-19", "31-37", "23-27"]);
    expect(hits("beatup", build("weavile", "pressure", { itemId: "lumberry" }), { party: ["garchomp", "incineroar"] }).hits).toEqual(["13-16", "15-18", "6-8"]);
    // Magic Room stops the berry, so the second hit is burned.
    expect(hits("scaleshot", berry("lumberry"), { hits: 3 }, { magicRoom: true }).hits).toEqual(["21-25", "10-12", "10-12"]);
  });

  it("does nothing when the burn cannot land", () => {
    const none = (label: string, result: ReturnType<typeof hits>, expected: string[]) => {
      expect(result.hits, label).toEqual(expected);
      expect(result.row.assumptions, label).not.toContain(NOTE);
    };
    none("Fire type", hits("dualwingbeat", build("talonflame", "galewings")), ["44-54", "44-54"]);
    none("already burned", hits("scaleshot", build("garchomp", "roughskin", { status: "brn" }), { hits: 5 }), Array(5).fill("10-12"));
    none("Lum Berry", hits("dragondarts", build("dragapult", "clearbody", { itemId: "lumberry" })), ["39-46", "39-46"]);
    none("Rawst Berry", hits("dragondarts", build("dragapult", "clearbody", { itemId: "rawstberry" })), ["39-46", "39-46"]);
    none("Misty Terrain", hits("scaleshot", build("garchomp", "roughskin"), { hits: 5 }, { terrain: "Misty" }), Array(5).fill("10-13"));
    none("Leaf Guard in sun", hits("tripleaxel", build("tsareena", "leafguard"), undefined, { weather: "Sun" }), ["11-13", "21-25", "31-37"]);
    none("Thermal Exchange", hits("iciclespear", build("baxcalibur", "thermalexchange"), { hits: 5 }), Array(5).fill("24-28"));
    none("Purifying Salt", hits("rockblast", build("garganacl", "purifyingsalt"), { hits: 5 }), Array(5).fill("32-42"));
    // Misty Terrain protects only a grounded attacker.
    const airborne = hits("dualwingbeat", build("noivern", "infiltrator"), undefined, { terrain: "Misty" });
    expect(airborne.hits).toEqual(["42-50", "21-25"]);
    expect(airborne.row.assumptions).toContain(NOTE);
    none("non-Mega Scovillain", hits("dragondarts", build("dragapult", "clearbody"), undefined, {}, build("scovillain", "chlorophyll")), ["48-57", "48-57"]);
  });
});
