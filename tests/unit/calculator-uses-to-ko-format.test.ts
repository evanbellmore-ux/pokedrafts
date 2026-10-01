import { describe, expect, it } from "vitest";
import { chanceText } from "@/app/(app)/calculator/result-format";
import { bestRollsText, faintsFirstText, speakKO, usesToKOText } from "@/app/(app)/calculator/uses-format";
import { rankResults } from "@/app/lib/battle/model";
import type { MoveDamageResult, UsesToKO } from "@/app/lib/battle/types";

/** Hand-set Uses to KO values, so the wording does not depend on the calculation. */
type Counted = Extract<UsesToKO, { kind: "uses" }>;
const counted = (fields: Partial<Counted> = {}): Counted => ({ kind: "uses", guaranteed: 5, fewest: 5, limit: 16, limitReason: "pp", carried: [], notes: [], ...fields });
function row(moveId: string, usesToKO: UsesToKO | undefined, extra: Partial<MoveDamageResult> = {}): MoveDamageResult {
  return { moveId, kind: "calculated", min: 34, max: 41, minPercent: 20, maxPercent: 24.12, rolls: 34, ohkoChance: 0, description: "", assumptions: [], reason: null, hits: 1, usesToKO, ...extra };
}
/** The cell's lines; `ohkoChance` is the One-use KO column beside it (null: Not estimated). */
const cell = (value: UsesToKO | undefined, lines?: number, ohkoChance: number | null = 0) => {
  const text = usesToKOText(row("thunderfang", value, { ohkoChance }), lines);
  return [text.label, ...text.details].join(" / ");
};

describe("Uses to KO wording", () => {
  it("leads with the guaranteed count and adds the chance of one use fewer", () => {
    expect(cell(counted({ guaranteed: 1, fewest: 1 }), 2, 1)).toBe("Guaranteed OHKO");
    // The user's example: 34–41 into 170 HP is 20% a use with the lowest roll.
    expect(cell(counted())).toBe("Guaranteed 5HKO");
    // 160 HP: the 4-use chance is exact, each use rolling its own damage (@smogon/calc agrees).
    expect(cell(counted({ fewest: 4, fasterChance: 0.0053253173828125 }))).toBe("Guaranteed 5HKO / 0.53% chance to 4HKO");
    // A 2HKO's one use is the One-use KO chance beside it, unless the two differ.
    expect(cell(counted({ guaranteed: 2, fewest: 1, fasterChance: 0.375 }), 2, 0.375)).toBe("Guaranteed 2HKO");
    expect(cell(counted({ guaranteed: 2, fewest: 1, fasterChance: 0.375 }), 2, 0)).toBe("Guaranteed 2HKO / 37.5% chance to OHKO");
    expect(cell(counted({ guaranteed: 3, fewest: 2, fasterChance: 1e-6 }))).toBe("Guaranteed 3HKO / <0.01% chance to 2HKO");
    expect(cell(counted({ guaranteed: 3, fewest: 2, fasterChance: 0.999999 }))).toBe("Guaranteed 3HKO / >99.99% chance to 2HKO");
  });

  it("names a Focus Sash or Sturdy that stops the first use's KO", () => {
    expect(cell(counted({ guaranteed: 2, fewest: 2, survival: "Focus Sash" }))).toBe("Guaranteed 2HKO / Focus Sash stops the OHKO");
    expect(cell(counted({ guaranteed: 2, fewest: 2, survival: "Sturdy" }))).toBe("Guaranteed 2HKO / Sturdy stops the OHKO");
  });

  it("says on which roll path the user faints, before anything else", () => {
    expect(cell(counted({ guaranteed: 4, fewest: 4, attackerFaints: { highest: 3 } }))).toBe("Guaranteed 4HKO / High rolls: user faints after use 3");
    expect(cell(counted({ guaranteed: 9, fewest: 9, attackerFaints: { lowest: 8 } }))).toBe("Guaranteed 9HKO / Low rolls: user faints after use 8");
    expect(cell(counted({ guaranteed: 2, fewest: 2, attackerFaints: { lowest: 2, highest: 2 } }))).toBe("Guaranteed 2HKO / The user faints after use 2");
    const both = counted({ guaranteed: 6, fewest: 4, fasterChance: 0.25, attackerFaints: { lowest: 5, highest: 3 } });
    expect(cell(both)).toBe("Guaranteed 6HKO / Low rolls: user faints after use 5 / High rolls: user faints after use 3");
    // The move details list every line.
    expect(cell(both, Infinity)).toBe("Guaranteed 6HKO / Low rolls: user faints after use 5 / High rolls: user faints after use 3 / 25% chance to 5HKO");
  });

  it("notes turns that are not uses", () => {
    expect(cell(counted({ guaranteed: 7, fewest: 6, fasterChance: 0.004, turns: "Recharges after each use" }))).toBe("Guaranteed 7HKO / 0.4% chance to 6HKO / Recharges after each use");
    expect(cell(counted({ turns: "Truant: one use every other turn" }))).toBe("Guaranteed 5HKO / Truant: one use every other turn");
  });

  it("explains a count the move's PP, Pressure, its HP cost or the cap stops", () => {
    expect(cell(counted({ guaranteed: null, fewest: null, limit: 8, needed: 14 }))).toBe("Runs out of PP / Needs 14 uses, has 8 PP");
    expect(cell(counted({ guaranteed: null, fewest: null, limit: 8 }))).toBe("Runs out of PP / Needs more than 8 uses");
    expect(cell(counted({ guaranteed: null, fewest: 7, limit: 8, needed: 9 }))).toBe("Runs out of PP / Possible 7HKO with the best rolls / Needs 9 uses, has 8 PP");
    expect(cell(counted({ guaranteed: null, fewest: null, limit: 28, limitReason: "pressure", needed: 1428 }))).toBe("Runs out of PP / Needs 1,428 uses; Pressure allows 28");
    expect(cell(counted({ guaranteed: null, fewest: null, limit: 4, limitReason: "pressure" }))).toBe("Runs out of PP / Pressure allows only 4 uses");
    expect(cell(counted({ guaranteed: null, fewest: 2, limit: 2, limitReason: "self-cost" }))).toBe("2 uses at most / Possible 2HKO with the best rolls / Each use costs half its max HP");
    expect(cell(counted({ guaranteed: null, fewest: 1, limit: 1, limitReason: "self-cost" }), 2, 0.5)).toBe("1 use at most / Each use costs half its max HP");
    // One use that knocks out only with its end-of-turn damage, which the One-use KO column (0%) leaves out.
    expect(cell(counted({ guaranteed: null, fewest: 1, limit: 1, limitReason: "self-cost" }), Infinity, 0)).toBe("1 use at most / Possible OHKO with the best rolls / Each use costs half its max HP");
    expect(cell(counted({ guaranteed: null, fewest: null, limit: 64, limitReason: "cap" }))).toBe("More than 64 uses");
    expect(cell(counted({ guaranteed: null, fewest: null, limit: 64, limitReason: "cap", needed: 70 }))).toBe("More than 64 uses / Needs 70 uses");
    // A count within the limit reads as usual.
    expect(cell(counted({ guaranteed: 2, fewest: 2, limit: 2, limitReason: "self-cost", attackerFaints: { lowest: 2, highest: 2 } }))).toBe("Guaranteed 2HKO / The user faints after use 2");
  });

  it("gives the chance within the uses counted in place of the best rolls' count, under the same label", () => {
    expect(cell(counted({ guaranteed: null, fewest: 7, chance: 0.3125, limit: 8, needed: 9 }))).toBe("Runs out of PP / 31.25% chance within 8 uses / Needs 9 uses, has 8 PP");
    expect(cell(counted({ guaranteed: null, fewest: 7, chance: 0.3125, limit: 8 }))).toBe("Runs out of PP / 31.25% chance within 8 uses / Needs more than 8 uses");
    expect(cell(counted({ guaranteed: null, fewest: 3, chance: 1e-6, limit: 4, limitReason: "pressure" }))).toBe("Runs out of PP / <0.01% chance within 4 uses / Pressure allows only 4 uses");
    expect(cell(counted({ guaranteed: null, fewest: 20, chance: 0.5, limit: 28, limitReason: "pressure", needed: 30 }))).toBe("Runs out of PP / 50% chance within 28 uses / Needs 30 uses; Pressure allows 28");
    expect(cell(counted({ guaranteed: null, fewest: 2, chance: 0.5, limit: 2, limitReason: "self-cost" }))).toBe("2 uses at most / 50% chance within 2 uses / Each use costs half its max HP");
    expect(cell(counted({ guaranteed: null, fewest: 1, chance: 0.375, limit: 1, limitReason: "self-cost" }))).toBe("1 use at most / 37.5% chance within 1 use / Each use costs half its max HP");
    expect(cell(counted({ guaranteed: null, fewest: 60, chance: 0.999999, limit: 64, limitReason: "cap" }))).toBe("More than 64 uses / >99.99% chance within 64 uses");
    expect(cell(counted({ guaranteed: null, fewest: 60, chance: 0.0053253173828125, limit: 64, limitReason: "cap", needed: 70 }))).toBe("More than 64 uses / 0.53% chance within 64 uses / Needs 70 uses");
    // A chance over several uses is shown even when the best rolls need only one.
    expect(cell(counted({ guaranteed: null, fewest: 1, chance: 0.9, limit: 8, needed: 9 }))).toBe("Runs out of PP / 90% chance within 8 uses / Needs 9 uses, has 8 PP");
    // A faint on the knockout use still leads.
    expect(cell(counted({ guaranteed: null, fewest: 7, chance: 0.25, limit: 8, needed: 9, attackerFaints: { highest: 7 } }), Infinity)).toBe("Runs out of PP / High rolls: user faints after use 7 / 25% chance within 8 uses / Needs 9 uses, has 8 PP");
    expect(usesToKOText(row("dracometeor", counted({ guaranteed: null, fewest: 7, chance: 0.3125, limit: 8, needed: 9 }))).spoken).toBe("Runs out of PP. 31.25% chance within 8 uses. Needs 9 uses, has 8 PP");
  });

  it("says no KO is guaranteed when the user can faint first, with the chance before it does and then when it faints", () => {
    expect(cell(counted({ guaranteed: null, fewest: 3, chance: 0.4, faintsFirst: true, attackerFaints: { highest: 3 } }))).toBe("No guaranteed KO / 40% chance before the user faints / High rolls: user faints after use 3");
    expect(cell(counted({ guaranteed: null, fewest: 2, chance: 0.999999, faintsFirst: true, attackerFaints: { lowest: 2, highest: 2 } }))).toBe("No guaranteed KO / >99.99% chance before the user faints / The user faints after use 2");
    // Life Orb Brave Bird into Eviolite Chansey: the highest rolls faint Talonflame after use 3 with Chansey in, the lowest only to
    // the fourth use's recoil after the KO. The table, card and summary keep the chance and the earlier faint; the move details list both.
    const both = counted({ guaranteed: null, fewest: 4, chance: 0.87109375, faintsFirst: true, limit: 24, attackerFaints: { lowest: 4, highest: 3 } });
    expect(cell(both)).toBe("No guaranteed KO / 87.11% chance before the user faints / High rolls: user faints after use 3");
    expect(cell(both, Infinity)).toBe("No guaranteed KO / 87.11% chance before the user faints / High rolls: user faints after use 3 / Low rolls: user faints after use 4");
    expect(cell(counted({ guaranteed: null, fewest: 3, chance: 0.0053253173828125, faintsFirst: true, attackerFaints: { lowest: 3, highest: 5 } }), Infinity))
      .toBe("No guaranteed KO / 0.53% chance before the user faints / Low rolls: user faints after use 3 / High rolls: user faints after use 5");
    // Too many roll sequences for a chance: the best rolls' count instead (none for one use, the One-use KO chance beside it).
    expect(cell(counted({ guaranteed: null, fewest: 4, faintsFirst: true, attackerFaints: { highest: 3 } }))).toBe("No guaranteed KO / Possible 4HKO with the best rolls / High rolls: user faints after use 3");
    expect(cell(counted({ guaranteed: null, fewest: 1, faintsFirst: true, attackerFaints: { lowest: 1 } }), 2, 0.25)).toBe("No guaranteed KO / Low rolls: user faints after use 1");
    // No roll sequence knocks out before the user faints: no KO at all, not just no guarantee.
    expect(cell(counted({ guaranteed: null, fewest: null, faintsFirst: true, attackerFaints: { lowest: 2, highest: 2 } }))).toBe("No KO before user faints / The user faints after use 2");
    // The limit is named only when the lowest rolls run past it too.
    expect(cell(counted({ guaranteed: null, fewest: 6, chance: 0.25, faintsFirst: true, attackerFaints: { highest: 5 }, limit: 8, needed: 9 }), Infinity)).toBe("No guaranteed KO / 25% chance before the user faints / High rolls: user faints after use 5 / Needs 9 uses, has 8 PP");
    expect(cell(counted({ guaranteed: null, fewest: 2, chance: 0.5, faintsFirst: true, attackerFaints: { lowest: 2 }, limit: 2, limitReason: "self-cost" }), Infinity)).toBe("No guaranteed KO / 50% chance before the user faints / Low rolls: user faints after use 2");
    expect(cell(counted({ guaranteed: null, fewest: 7, chance: 0.1, faintsFirst: true, attackerFaints: { highest: 6 }, turns: "Recharges after each use" }), Infinity)).toBe("No guaranteed KO / 10% chance before the user faints / High rolls: user faints after use 6 / Recharges after each use");
    expect(usesToKOText(row("flareblitz", counted({ guaranteed: null, fewest: 3, chance: 0.4, faintsFirst: true, attackerFaints: { highest: 3 } }))).spoken).toBe("No guaranteed KO. 40% chance before the user faints. High rolls: user faints after use 3");
    expect(usesToKOText(row("flareblitz", counted({ guaranteed: null, fewest: 4, faintsFirst: true, attackerFaints: { highest: 3 } }))).spoken).toBe("No guaranteed KO. Possible KO in 4 uses with the best rolls. High rolls: user faints after use 3");
  });

  it("words one-use moves, moves that never KO, no damage and the rest", () => {
    // A one-use move's chance is shown, beside the reason; it matches the One-use KO column here.
    expect(cell({ kind: "single-use", reason: "The user faints", koChance: 0.625 }, Infinity, 0.625)).toBe("One use only / The user faints / 62.5% chance to OHKO");
    expect(cell({ kind: "single-use", reason: "Works only on its first turn out.", koChance: 0 })).toBe("One use only / Works only on its first turn out");
    expect(cell({ kind: "single-use", reason: "The user faints", koChance: 1 }, 2, 1)).toBe("Guaranteed OHKO");
    expect(cell({ kind: "single-use", reason: "Works only on its first turn out", koChance: 0.999999 }, 2, 0.999999)).toBe("One use only / Works only on its first turn out / >99.99% chance to OHKO");
    expect(cell({ kind: "never", reason: "False Swipe leaves at least 1 HP" })).toBe("Never KOs / False Swipe leaves at least 1 HP");
    expect(cell({ kind: "never", reason: "Can't lower HP below the user's." })).toBe("Never KOs / Can't lower HP below the user's");
    expect(cell({ kind: "no-damage" })).toBe("No damage");
    expect(cell({ kind: "not-estimated", reason: "The target is protecting" })).toBe("Not estimated / The target is protecting");
    expect(cell(undefined)).toBe("Not estimated");
    expect(usesToKOText(undefined)).toEqual({ label: "Not estimated", details: [], spoken: "Not estimated" });
    // Only calculated rows carry a count.
    expect(usesToKOText({ ...row("protect", counted()), kind: "status" }).label).toBe("Not estimated");
  });

  // The counts below are the calculation's for these matchups; the HP traces are pinned Showdown c23d2e94 battles, every roll at 85 and at 100
  // (scripts/.cache/calc-audit/nhko/review/ui-docs/verify/f1-sash.ts, f2-2hko.ts, f3-eot.ts, f4-float.ts and f7-9-misc.ts; perf-robust/sd-axel.ts, sd-hundred.ts).
  it("gives a 2HKO the chance that one use knocks out when the One-use KO column does not show it", () => {
    // SV: Jolly 252 Atk Dragapult's Dragon Darts into 4 HP Garchomp (184 HP), 84–102 a dart. Showdown 85: 84+84 => 16, 84 => 0; 100: 102+102 => 0.
    // One-use KO is Not estimated for the two darts; two independent rolls reach 184 in 137 of 256 cases.
    const darts = counted({ guaranteed: 2, fewest: 1, fasterChance: 137 / 256 });
    expect(cell(darts, 2, null)).toBe("Guaranteed 2HKO / 53.52% chance to OHKO");
    expect(bestRollsText(darts)).toBeNull();
    // SV, Sand: Jolly 252 Atk Garchomp's Stomping Tantrum (103–123) into 4 HP Flutter Mane (131 HP, sand 8). Showdown 85: 103 => 28 (sand 20), 103 => 0;
    // 100: 123 => 8, sand => 0. Only the highest roll knocks out on the first turn, so 1 in 16, though One-use KO is 0%.
    expect(cell(counted({ guaranteed: 2, fewest: 1, fasterChance: 0.0625, endOfTurn: true }), Infinity, 0)).toBe("Guaranteed 2HKO / 6.25% chance to OHKO / Counts end-of-turn damage");
    expect(usesToKOText(row("stompingtantrum", counted({ guaranteed: 2, fewest: 1, fasterChance: 0.0625, endOfTurn: true }))).spoken)
      .toBe("Guaranteed KO in 2 uses. 6.25% chance to KO in 1 use. Counts end-of-turn damage");
  });

  it("says when end-of-turn damage does a KO the One-use KO column leaves out", () => {
    // SV, Sand: Garchomp's Shadow Claw (128–152) into Flutter Mane: One-use KO 87.5%. Showdown 85: 128 => 3, sand => 0; 100: 152 => 0.
    expect(cell(counted({ guaranteed: 1, fewest: 1, limit: 24, endOfTurn: true }), 2, 0.875)).toBe("Guaranteed OHKO / Counts end-of-turn damage");
    // Without the calculation's flag, a Guaranteed OHKO beside a One-use KO below 100% says it too.
    expect(cell(counted({ guaranteed: 1, fewest: 1, limit: 24 }), 2, 0.875)).toBe("Guaranteed OHKO / Counts end-of-turn damage");
    // Champions, Sand: Garchomp's Dig (168–198) into Incineroar (202 HP): One-use KO 0%. Showdown 85: Dig charges (sand 190), hits 168 => 22 (sand 10),
    // and the sand knocks it out as the next Dig charges; 100: 198 => 0 on the second turn.
    expect(cell(counted({ guaranteed: 1, fewest: 1, limit: 12, endOfTurn: true, turns: "Charges for a turn before each use" }), Infinity, 0))
      .toBe("Guaranteed OHKO / Counts end-of-turn damage / Charges for a turn before each use");
    // A count of several uses that end-of-turn damage brings down says it too.
    expect(cell(counted({ guaranteed: 4, fewest: 4, endOfTurn: true }), 2, 0)).toBe("Guaranteed 4HKO / Counts end-of-turn damage");
    // A move the One-use KO column cannot estimate (several hits) does not blame end-of-turn damage.
    expect(cell(counted({ guaranteed: 1, fewest: 1 }), 2, null)).toBe("Guaranteed OHKO");
  });

  it("drops the Focus Sash or Sturdy line when end-of-turn damage still knocks out on the first use", () => {
    // SV, Sand: Adamant 252 Atk Garchomp's Earthquake into a full-HP Focus Sash Smeargle (130 HP). Showdown 85: 205 => 1, sand => 0; 100: 243 => 1, sand => 0.
    expect(cell(counted({ guaranteed: 1, fewest: 1, survival: "Focus Sash", endOfTurn: true }), 2, 0)).toBe("Guaranteed OHKO / Counts end-of-turn damage");
    // USUM, Hail: the same Earthquake into Sturdy Golem (155 HP). Showdown 85: 152 => 3, hail => 0; 100: 180 => 1 (Sturdy), hail => 0.
    expect(cell(counted({ guaranteed: 1, fewest: 1, survival: "Sturdy" }), 2, 0)).toBe("Guaranteed OHKO / Counts end-of-turn damage");
    // A roll sequence that needs one use: the Sash does not stop every first-use KO.
    expect(cell(counted({ guaranteed: 2, fewest: 1, fasterChance: 0.0625, survival: "Focus Sash", endOfTurn: true }), Infinity, 0))
      .toBe("Guaranteed 2HKO / 6.25% chance to OHKO / Counts end-of-turn damage");
    // No field: 205 => 1, then 205 => 0 (Showdown agrees), so the Sash line stays.
    expect(cell(counted({ guaranteed: 2, fewest: 2, survival: "Focus Sash" }), 2, 0)).toBe("Guaranteed 2HKO / Focus Sash stops the OHKO");
  });

  it("shows a one-use move's own KO chance, with end-of-turn damage", () => {
    // Champions, Sand: Gourgeist's Explosion (115–136) into Castform (145 HP, sand 9): One-use KO 0%. Showdown 85: 115 => 30, sand => 21; 100: 136 => 9, sand => 0.
    const explosion: UsesToKO = { kind: "single-use", reason: "The user faints", koChance: 0.0625 };
    expect(cell(explosion, 2, 0)).toBe("One use only / The user faints / 6.25% chance to OHKO");
    expect(cell(explosion, Infinity, 0)).toBe("One use only / The user faints / 6.25% chance to OHKO / Counts end-of-turn damage");
    expect(cell({ kind: "single-use", reason: "The user faints", koChance: 1 }, 2, 0.9)).toBe("Guaranteed OHKO / Counts end-of-turn damage");
  });

  it("never shows a chance that is not certain as 100%", () => {
    // SV defaults: Teddiursa's Low Kick (7–9) into Slowking-Galar (170 HP); the sum overshoots to 1.0000000000000004. Showdown 85: 7 a use, 2 HP left
    // after use 24, 0 after use 25, so 24 uses are not certain.
    expect(cell(counted({ guaranteed: 25, fewest: 19, fasterChance: 1.0000000000000004, limit: 32 }))).toBe("Guaranteed 25HKO / >99.99% chance to 24HKO");
    // Champions defaults: Ninetales-Alola's Triple Axel into Scizor, rounded to exactly 1. Showdown with every hit landing: 4+8+12 a use on the lowest
    // rolls, 145 => 1 after 6 uses, KO on use 7 (exactly 729 / 16^18 of the sequences are still in after 6).
    expect(cell(counted({ guaranteed: 7, fewest: 5, fasterChance: 1 }))).toBe("Guaranteed 7HKO / >99.99% chance to 6HKO");
    // USUM defaults: Dragonair's Icy Wind (8–10) into Aurorus (198 HP), 24 PP. Showdown 85: 6 HP left after the 24th Icy Wind; only Struggle knocks it out.
    expect(cell(counted({ guaranteed: null, fewest: 20, chance: 1.0000000000000002, limit: 24, needed: 25 }))).toBe("Runs out of PP / >99.99% chance within 24 uses / Needs 25 uses, has 24 PP");
    // SwSh defaults: Poipole's Peck into Magneton, 56 PP. Showdown 85: 13 HP left after all 56.
    expect(cell(counted({ guaranteed: null, fewest: 36, chance: 1, limit: 56, needed: 63 }))).toBe("Runs out of PP / >99.99% chance within 56 uses / Needs 63 uses, has 56 PP");
    expect(cell(counted({ guaranteed: null, fewest: 3, chance: 1, faintsFirst: true, attackerFaints: { highest: 3 } }))).toBe("No guaranteed KO / >99.99% chance before the user faints / High rolls: user faints after use 3");
  });

  it("gives the best rolls' count when there are too many roll sequences for a chance", () => {
    // Champions: Bastiodon's Hard Press into Vanilluxe at 60 of 146 HP, counted on the lowest and highest rolls. Showdown 100: 42 => 18, 14 => 4, 6 => 0
    // (KO in 3); 85: 32 => 28, 14 => 14, 8 => 6, 6 => 0 (KO in 4).
    const hardPress = counted({ guaranteed: 4, fewest: 3, limit: 12 });
    expect(cell(hardPress)).toBe("Guaranteed 4HKO / Possible 3HKO with the best rolls");
    expect(bestRollsText(hardPress)).toBeNull();
    expect(cell(counted({ guaranteed: 6, fewest: 3 }))).toBe("Guaranteed 6HKO / Possible 3HKO with the best rolls");
    // A 2HKO's one use is the One-use KO chance when that shows one.
    expect(cell(counted({ guaranteed: 2, fewest: 1 }), 2, 0.5)).toBe("Guaranteed 2HKO");
    expect(cell(counted({ guaranteed: 2, fewest: 1 }), 2, null)).toBe("Guaranteed 2HKO / Possible OHKO with the best rolls");
  });

  it("says there is no KO when the user faints before any roll sequence knocks out", () => {
    // Champions: Alcremie's Facade (21–25) into Rocky Helmet Stunfisk (184 HP). Showdown 85: 163 … 37 and Alcremie faints after use 7; 100: 159 … 9, faints after use 7.
    const facade = counted({ guaranteed: null, fewest: null, faintsFirst: true, limit: 20, attackerFaints: { lowest: 7, highest: 7 } });
    expect(cell(facade, Infinity)).toBe("No KO before user faints / The user faints after use 7");
    expect(usesToKOText(row("facade", facade)).spoken).toBe("No KO before user faints. The user faints after use 7");
    expect(faintsFirstText(facade)).toBeNull();
    expect(bestRollsText(facade)).toBeNull();
    // The limit is still named when it stops the lowest rolls.
    expect(cell(counted({ guaranteed: null, fewest: null, faintsFirst: true, limit: 8, needed: 30, attackerFaints: { highest: 5 } }), Infinity))
      .toBe("No KO before user faints / High rolls: user faints after use 5 / Needs 30 uses, has 8 PP");
  });

  it("speaks the KO tokens as words", () => {
    expect(usesToKOText(row("thunderfang", counted({ fewest: 4, fasterChance: 0.0053253173828125 }))).spoken).toBe("Guaranteed KO in 5 uses. 0.53% chance to KO in 4 uses");
    expect(usesToKOText(row("stoneedge", counted({ guaranteed: 2, fewest: 2, survival: "Focus Sash" }))).spoken).toBe("Guaranteed KO in 2 uses. Focus Sash stops a KO in 1 use");
    expect(usesToKOText(row("closecombat", counted({ guaranteed: 1, fewest: 1 }), { ohkoChance: 1 })).spoken).toBe("Guaranteed KO in 1 use");
    expect(usesToKOText(row("closecombat", counted({ guaranteed: 2, fewest: 1, fasterChance: 0.375 }))).spoken).toBe("Guaranteed KO in 2 uses. 37.5% chance to KO in 1 use");
    expect(speakKO("Possible 12HKO with the best rolls")).toBe("Possible KO in 12 uses with the best rolls");
    expect(speakKO("Runs out of PP")).toBe("Runs out of PP");
  });

  it("keeps every line it writes to 38 characters, which keeps the 375px card's Details button beside it", () => {
    const values: UsesToKO[] = [];
    for (const n of [1, 2, 3, 9, 10, 20, 64]) {
      for (const chance of [1e-6, 0.0053253173828125, 0.123456, 0.999999]) {
        values.push(counted({ guaranteed: n, fewest: Math.max(1, n - 1), fasterChance: chance, survival: "Focus Sash", attackerFaints: { lowest: n, highest: Math.max(1, n - 1) } }));
      }
      for (const limitReason of ["pp", "pressure", "self-cost", "cap"] as const) {
        for (const needed of [undefined, n + 1, 1428, 99_999]) {
          values.push(counted({ guaranteed: null, fewest: n, limit: n, limitReason, needed, attackerFaints: { highest: n } }));
          for (const chance of [1e-6, 0.123456, 0.999999]) {
            values.push(counted({ guaranteed: null, fewest: n, chance, limit: n, limitReason, needed, attackerFaints: { highest: n } }));
            values.push(counted({ guaranteed: null, fewest: n, chance, faintsFirst: true, limit: n, limitReason, needed, attackerFaints: { lowest: n, highest: n - 1 }, turns: "Truant: one use every other turn" }));
          }
          values.push(counted({ guaranteed: null, fewest: n, faintsFirst: true, limit: n, limitReason, needed, attackerFaints: { lowest: n, highest: n - 1 } }));
        }
      }
    }
    for (const n of [1, 2, 64]) {
      for (const fewest of [null, 1, n]) {
        values.push(counted({ guaranteed: n, fewest: fewest ?? n, endOfTurn: true, survival: "Sturdy", turns: "Charges for a turn before each use" }));
        values.push(counted({ guaranteed: null, fewest, faintsFirst: true, endOfTurn: true, limit: 64, limitReason: "cap", needed: 99_999, attackerFaints: { lowest: n, highest: n } }));
      }
      values.push(counted({ guaranteed: n + 1, fewest: n, fasterChance: 1.0000000000000004, endOfTurn: true }));
    }
    for (const koChance of [0, 1e-6, 0.0625, 0.999999, 1]) values.push({ kind: "single-use", reason: "Works only on its first turn out", koChance });
    for (const value of values) {
      for (const ohkoChance of [0, 0.5, null]) {
        const { label, details } = usesToKOText(row("thunderfang", value, { ohkoChance }), Infinity);
        for (const text of [label, ...details]) expect(text.length, text).toBeLessThanOrEqual(38);
        // The card and the summary put the label after "Uses to KO: ".
        expect(`Uses to KO: ${label}`.length, label).toBeLessThanOrEqual(38);
      }
    }
  });

  it("gives the best rolls' count when it is lower than the one-fewer chance says", () => {
    expect(bestRollsText(counted({ fewest: 3, fasterChance: 0.2 }))).toBe("The best rolls KO in 3 uses.");
    expect(bestRollsText(counted({ guaranteed: 3, fewest: 1, fasterChance: 0.1 }))).toBe("The best rolls KO in 1 use.");
    expect(bestRollsText(counted({ fewest: 4, fasterChance: 0.2 }))).toBeNull();
    // A 2HKO's chance to OHKO says one use, in its line or the One-use KO column.
    expect(bestRollsText(counted({ guaranteed: 2, fewest: 1, fasterChance: 0.375 }))).toBeNull();
    // Too many roll sequences for a chance: the Possible line says it.
    expect(bestRollsText(counted({ guaranteed: 4, fewest: 3 }))).toBeNull();
    // With no guarantee the Possible line says it, unless a chance took its place.
    expect(bestRollsText(counted({ guaranteed: null, fewest: 3 }))).toBeNull();
    expect(bestRollsText(counted({ guaranteed: null, fewest: 7, chance: 0.3125, limit: 8 }))).toBe("The best rolls KO in 7 uses.");
    expect(bestRollsText(counted({ guaranteed: null, fewest: 1, chance: 0.9, limit: 8 }))).toBe("The best rolls KO in 1 use.");
    expect(bestRollsText(counted({ guaranteed: null, fewest: 3, chance: 0.4, faintsFirst: true }))).toBe("The best rolls KO in 3 uses.");
    expect(bestRollsText(counted({ guaranteed: null, fewest: null, faintsFirst: true }))).toBeNull();
    expect(bestRollsText({ kind: "no-damage" })).toBeNull();
  });

  it("explains, for the move details, why the user fainting first leaves no guarantee", () => {
    expect(faintsFirstText(counted({ guaranteed: null, fewest: 3, chance: 0.4, faintsFirst: true, limit: 16 })))
      .toBe("A roll sequence where the user faints first never knocks out, so no count is guaranteed. The chance is that the target is out within 16 uses, before the user faints.");
    expect(faintsFirstText(counted({ guaranteed: null, fewest: 4, faintsFirst: true }))).toBe("A roll sequence where the user faints first never knocks out, so no count is guaranteed.");
    // No sequence knocks out before the user faints: the label says so.
    expect(faintsFirstText(counted({ guaranteed: null, fewest: null, faintsFirst: true }))).toBeNull();
    expect(faintsFirstText(counted({ guaranteed: null, fewest: 7, chance: 0.3125, limit: 8 }))).toBeNull();
    expect(faintsFirstText(counted({ guaranteed: 4, fewest: 4, attackerFaints: { highest: 3 } }))).toBeNull();
    expect(faintsFirstText({ kind: "single-use", reason: "The user faints", koChance: 0.5 })).toBeNull();
  });

  it("formats chances like the One-use KO column", () => {
    expect([0, 1e-6, 0.0053253173828125, 0.375, 0.999999, 1].map(chanceText)).toEqual(["0%", "<0.01%", "0.53%", "37.5%", ">99.99%", "100%"]);
  });
});

describe("Uses to KO sort", () => {
  const status = (moveId: string, kind: MoveDamageResult["kind"]): MoveDamageResult => ({
    ...row(moveId, undefined), kind, min: null, max: null, minPercent: null, maxPercent: null, rolls: null, ohkoChance: null, hits: null,
  });
  const rows: MoveDamageResult[] = [
    row("closecombat", counted({ guaranteed: 1, fewest: 1 }), { min: 180, ohkoChance: 1 }),
    row("fakeout", { kind: "single-use", reason: "Works only on its first turn out", koChance: 1 }, { min: 170, ohkoChance: 1 }),
    // A 2HKO by the calculation's chance to OHKO: Dragon Darts' 137/256 (One-use KO Not estimated) beats Dragon Rush's 50%
    // (ui-docs/verify/f2-2hko.ts: the calculation's old order put Dragon Rush first, by the One-use KO chance).
    row("dragondarts", counted({ guaranteed: 2, fewest: 1, fasterChance: 137 / 256 }), { min: 168, max: 204, ohkoChance: null }),
    row("dragonrush", counted({ guaranteed: 2, fewest: 1, fasterChance: 0.5 }), { min: 168, max: 200, ohkoChance: 0.5 }),
    row("earthquake", counted({ guaranteed: 2, fewest: 1, fasterChance: 0.375 }), { min: 138, ohkoChance: 0.375 }),
    // A higher minimum does not beat the higher chance of one use fewer.
    row("stoneedge", counted({ guaranteed: 2, fewest: 2, survival: "Focus Sash" }), { min: 252 }),
    row("thunderpunch", counted({ fewest: 4, fasterChance: 0.0053253173828125 }), { min: 34 }),
    // Too many roll sequences for a chance: the best rolls' count breaks the tie.
    row("hardpress", counted({ fewest: 3 }), { min: 32 }),
    row("thunderfang", counted(), { min: 36 }),
    row("icefang", counted(), { min: 36 }),
    row("superfang", counted({ guaranteed: 10, fewest: 10 }), { min: 85 }),
    // Possible KOs, the higher chance first: a one-use move's KO chance against the chance within the uses counted.
    row("gigaimpact", counted({ guaranteed: null, fewest: 3, chance: 0.9, limit: 8, needed: 9 }), { min: 50 }),
    row("explosion", { kind: "single-use", reason: "The user faints", koChance: 0.625 }, { min: 160, ohkoChance: 0.625 }),
    row("headsmash", counted({ guaranteed: null, fewest: 2, chance: 0.6, faintsFirst: true, attackerFaints: { highest: 2 } }), { min: 120 }),
    // A one-use move by its own chance with end-of-turn damage, though One-use KO is 0%.
    row("mistyexplosion", { kind: "single-use", reason: "The user faints", koChance: 0.0625 }, { min: 115, ohkoChance: 0 }),
    row("steelbeam", counted({ guaranteed: null, fewest: 2, limit: 2, limitReason: "self-cost" }), { min: 90 }),
    row("dracometeor", counted({ guaranteed: null, fewest: 7, limit: 8, needed: 9 }), { min: 58 }),
    row("fireblast", counted({ guaranteed: null, fewest: null, limit: 8, needed: 14 }), { min: 12 }),
    row("firstimpression", { kind: "single-use", reason: "Works only on its first turn out", koChance: 0 }, { min: 20 }),
    // The user faints before any roll sequence knocks out: no KO, as for a count past the limit.
    row("flareblitz", counted({ guaranteed: null, fewest: null, faintsFirst: true, attackerFaints: { lowest: 1, highest: 1 } }), { min: 15 }),
    row("falseswipe", { kind: "never", reason: "False Swipe leaves at least 1 HP" }, { min: 39 }),
    row("earthpower", { kind: "no-damage" }, { min: 0, max: 0 }),
    row("knockoff", { kind: "not-estimated", reason: "The target is protecting" }, { min: 35 }),
    row("tackle", undefined, { min: 10 }),
    status("protect", "status"),
    status("bulletseed", "needs-context"),
  ];
  const order = ["closecombat", "fakeout", "dragondarts", "dragonrush", "earthquake", "stoneedge", "thunderpunch", "hardpress", "icefang", "thunderfang", "superfang",
    "gigaimpact", "explosion", "headsmash", "mistyexplosion", "steelbeam", "dracometeor", "firstimpression", "flareblitz", "fireblast", "falseswipe", "earthpower", "knockoff",
    "tackle", "bulletseed", "protect"];

  it("ranks guaranteed counts, then possible KOs (the higher chance first), then no KO, never, no damage, not estimated and uncalculated rows", () => {
    expect(rankResults(rows, "uses").map((result) => result.moveId)).toEqual(order);
    expect(rankResults([...rows].reverse(), "uses").map((result) => result.moveId)).toEqual(order);
  });

  it("leaves the minimum damage sort as it was", () => {
    // Explosion's 160 outranks Earthquake's 138 there, though it is One use only.
    expect(rankResults(rows).map((result) => result.moveId).slice(0, 7)).toEqual(["stoneedge", "closecombat", "fakeout", "dragondarts", "dragonrush", "explosion", "earthquake"]);
  });
});
