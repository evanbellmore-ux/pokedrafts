import { beforeAll, describe, expect, it } from "vitest";
import { createMoveSlots, describeMoveSlot, nativeFillCandidate } from "@/app/lib/battle/move-defaults";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import type { BattleRuntime } from "@/app/lib/battle/runtime";

/**
 * Native quick-move defaults: pinned Showdown c23d2e94 Random Battle sets ranked at build time
 * (scripts/lib/battle-data/random-battle.ts, catalog randomBattle), then a same-type and coverage fill.
 * The expected rows match the audit prototype and the generator's own pick rates (audit
 * oos/native-quick-moves v2/samples.out, port-check.ts).
 */
let us: BattleRuntime;
let ss: BattleRuntime;
let sv: BattleRuntime;
beforeAll(async () => {
  [us, ss, sv] = await Promise.all([loadBattleRuntime("ultra_sun_ultra_moon"), loadBattleRuntime("sword_shield"), loadBattleRuntime("scarlet_violet")]);
});
const slots = (runtime: BattleRuntime, id: string, gameType: "Singles" | "Doubles" = "Singles") => createMoveSlots(id, gameType, runtime);
const labelled = (runtime: BattleRuntime, id: string, gameType: "Singles" | "Doubles" = "Singles") =>
  slots(runtime, id, gameType).map((slot) => `${slot.moveId}${slot.origin === "suggested" ? "*" : slot.origin === "required" ? " (req)" : ""}`);

describe("native quick-move defaults", () => {
  it("start from the game's Random Battle row, not alphabetical order", () => {
    expect(labelled(us, "garchomp")).toEqual(["earthquake", "outrage", "stoneedge", "firefang"]);
    expect(labelled(ss, "garchomp")).toEqual(["earthquake", "outrage", "scaleshot", "dragontail"]);
    expect(labelled(sv, "garchomp")).toEqual(["earthquake", "scaleshot", "outrage", "dragontail"]);
    expect(slots(sv, "garchomp").every((slot) => slot.origin === "randomBattle")).toBe(true);
    expect(labelled(us, "tapukoko")).toEqual(["dazzlinggleam", "wildcharge", "thunderbolt", "bravebird"]);
    // Moves the generator always adds: a gen 7 set's preferred type (Nidoking's Ice Beam).
    expect(labelled(us, "nidoking")).toContain("icebeam");
  });

  it("read Scarlet/Violet's Doubles sets in Doubles, and Singles sets where a game has no Doubles file", () => {
    expect(labelled(sv, "garchomp", "Doubles")).toEqual(["earthquake", "scaleshot", "rockslide*", "doubleedge*"]);
    expect(labelled(sv, "fluttermane", "Doubles")).toEqual(["moonblast", "dazzlinggleam", "shadowball", "icywind"]);
    expect(labelled(us, "garchomp", "Doubles")).toEqual(labelled(us, "garchomp"));
    // The source is named by the file it came from.
    expect(describeMoveSlot(slots(sv, "garchomp", "Doubles")[0])).toBe("From Showdown's Random Doubles Battle sets");
    expect(describeMoveSlot(slots(us, "garchomp", "Doubles")[0])).toBe("From Showdown's Random Battle sets (Singles)");
    expect(describeMoveSlot(slots(sv, "garchomp", "Doubles")[2])).toBe("Suggested, per-species usage unavailable for this move");
  });

  it("keep a form's required move first and cover battle-only and cosmetic forms", () => {
    expect(labelled(sv, "keldeoresolute", "Doubles")).toEqual(["secretsword (req)", "vacuumwave", "hydropump", "muddywater"]);
    expect(labelled(us, "meloettapirouette")).toEqual(["relicsong (req)", "closecombat", "return", "knockoff"]);
    expect(labelled(us, "mimikyubusted")).toEqual(["playrough", "shadowsneak", "drainpunch", "shadowclaw"]);
    expect(labelled(ss, "alcremierubycream")).toEqual(["dazzlinggleam", "mysticalfire", "psychic*", "psyshock*"]);
  });

  it("fill forms without a row by same-type power and coverage, never with recharge, self-KO or history moves", () => {
    expect(labelled(sv, "sprigatito")).toEqual(["petalblizzard*", "uturn*", "suckerpunch*", "playrough*"]);
    expect(labelled(us, "charmander")).toEqual(["overheat*", "fireblast*", "dragonpulse*", "ancientpower*"]);
    expect(labelled(sv, "blissey")).toEqual(["seismictoss", "hypervoice*", "thunderbolt*", "fireblast*"]);
    expect(["hyperbeam", "gigaimpact", "explosion", "selfdestruct", "solarbeam", "counter", "furycutter", "terablast", "hiddenpower", "snore"]
      .some((id) => nativeFillCandidate(sv.movesById.get(id) ?? us.movesById.get(id)!))).toBe(false);
    for (const runtime of [us, ss, sv]) {
      for (const species of runtime.catalog.species) {
        const made = createMoveSlots(species.id, "Singles", runtime);
        const chosen = new Set(made.map((slot) => slot.moveId));
        const candidates = species.moves.filter((id) => { const move = runtime.movesById.get(id); return move && move.category !== "Status" && nativeFillCandidate(move); });
        for (const slot of made) {
          // A suggested move outside the fill's candidates comes only from the last-resort ID order, once
          // every candidate the form knows is already in its slots.
          if (slot.origin === "suggested" && slot.moveId && !nativeFillCandidate(runtime.movesById.get(slot.moveId)!)) {
            expect(candidates.every((id) => chosen.has(id)), `${runtime.profile.id} ${species.id} ${slot.moveId}`).toBe(true);
          }
        }
      }
    }
  });
});
