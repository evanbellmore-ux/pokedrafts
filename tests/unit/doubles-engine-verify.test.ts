import { describe, expect, it } from "vitest";
import { REASONS } from "@/app/lib/battle/doubles-actions";
import { calculateDoublesOutcomes, calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import type { DoublesCarried, DoublesPokemonInput, DoublesSlotId, DoublesStep, DoublesTurnInput, DoublesTurnResult } from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, defaultAbilityActive } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, BattleGame, BattleStatus, CombatStat } from "@/app/lib/battle/types";

/**
 * The independent check of the status-eot engine fixes (scripts/.cache/calc-audit/status-eot/build/VERIFY-engine.md): the
 * gaps it found around H1, H2/H8, H5, M1 and ui F1, each as its 2v2 oracle case (status-eot/verify-engine/cases*.ts VE-*).
 * The expected numbers are pinned Showdown c23d2e94's. Level 50, 31 IVs, 0 EVs and a Serious nature unless set.
 */
type Stat = "hp" | "atk" | "def" | "spa" | "spd" | "spe";
type Mon = {
  species: string; ability: string; item?: string; nature?: string; evs?: Partial<Record<Stat, number>>; hp?: number; status?: BattleStatus;
  boosts?: Partial<Record<CombatStat, number>>; carried?: DoublesCarried;
};
type Slot = (Mon & { move: string | null; target?: DoublesSlotId }) | null;
const SLOTS: DoublesSlotId[] = ["own-left", "own-right", "opponent-left", "opponent-right"];
const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const IV31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const OL: DoublesSlotId = "own-left", OR: DoublesSlotId = "own-right", PL: DoublesSlotId = "opponent-left";

const mon = (species: string, ability: string, extra: Partial<Mon> = {}): Mon => ({ species, ability, ...extra });
const act = (m: Mon, move: string | null, target?: DoublesSlotId): Slot => ({ ...m, move, ...(target ? { target } : {}) });
const idle = (m: Mon): Slot => act(m, null);
const lax = (extra: Partial<Mon> = {}) => mon("snorlax", "thickfat", { evs: { spe: 4 }, ...extra });
const saur = (extra: Partial<Mon> = {}) => mon("venusaur", "overgrow", { evs: { spe: 4 }, ...extra });
const toise = (extra: Partial<Mon> = {}) => mon("blastoise", "torrent", extra);
const chomp = (extra: Partial<Mon> = {}) => mon("garchomp", "roughskin", extra);
const jolt = (extra: Partial<Mon> = {}) => mon("jolteon", "voltabsorb", extra);
/** A confused Anger Shell Klawf whose self-hit (12–15) can take it under its Sitrus Berry's line (70). */
const klawf = (extra: Partial<Mon> = {}) => mon("klawf", "angershell", { item: "sitrusberry", hp: 80, carried: { confusion: { attempts: 0 } }, ...extra });

const runtimes: Partial<Record<BattleGame, BattleRuntime>> = { champions: championsRuntime };
const game = async (id: BattleGame) => runtimes[id] ??= await loadBattleRuntime(id);
const SV = "scarlet_violet" as const, USUM = "ultra_sun_ultra_moon" as const;

function buildOf(runtime: BattleRuntime, m: Mon): BattleBuild {
  const base = createBuild(m.species, runtime);
  const shared = {
    nature: m.nature ?? "Serious", abilityId: m.ability, abilityActive: defaultAbilityActive(m.ability), itemId: m.item ?? "",
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...m.boosts }, currentHP: m.hp ?? null, status: m.status ?? "",
  };
  return (base.game === "champions"
    ? { ...base, ...shared, points: { ...ZERO, ...m.evs } }
    : { ...base, ...shared, native: { level: 50, evs: { ...ZERO, ...m.evs }, ivs: IV31 } }) as BattleBuild;
}
function turn(runtime: BattleRuntime, slots: Slot[], field: Partial<BattleConditions> = {}): DoublesTurnInput {
  const pokemon = Object.fromEntries(SLOTS.map((slot, index) => {
    const p = slots[index];
    if (!p) return [slot, null];
    const entry: DoublesPokemonInput = { build: buildOf(runtime, p), contexts: {}, charged: false, action: { moveId: p.move, target: p.target ?? null }, ...(p.carried ? { carried: p.carried } : {}) };
    return [slot, entry];
  })) as Record<DoublesSlotId, DoublesPokemonInput | null>;
  return { runtime, field: { ...createConditions(), gameType: "Doubles", ...field }, pokemon };
}
type Ready = Extract<DoublesTurnResult, { status: "ready" }>;
function ready(input: DoublesTurnInput): Ready {
  const result = calculateDoublesTurn(input);
  expect(result.status, JSON.stringify(result.status === "not-estimated" ? result.reason : result.status === "issues" ? result.issues : "")).toBe("ready");
  return result as Ready;
}
function reason(input: DoublesTurnInput): string {
  const result = calculateDoublesTurn(input);
  expect(result.status, JSON.stringify(result.status === "issues" ? result.issues : "")).toBe("not-estimated");
  return result.status === "not-estimated" ? result.reason : "";
}
const stepOf = (result: Ready, slot: DoublesSlotId): DoublesStep => {
  const step = result.steps.find((each) => each.slot === slot);
  expect(step, `a step for ${slot}`).toBeDefined();
  return step!;
};
const hpOf = (result: Ready, slot: DoublesSlotId) => { const hp = result.hp[slot]!; return [hp.min, hp.max, hp.average]; };
function near(got: number[], want: [number, number, number]) {
  expect(got.slice(0, 2)).toEqual(want.slice(0, 2));
  expect(got[2]).toBeCloseTo(want[2], 3);
}
function items(input: DoublesTurnInput, slot: DoublesSlotId): string[] {
  const outcomes = calculateDoublesOutcomes(input);
  expect(outcomes.status).toBe("ready");
  return outcomes.status === "ready" ? [...new Set(outcomes.outcomes.map((each) => each.mons[slot]!.build.itemId))] : [];
}

describe("the Berserk and Anger Shell lock ends at a later move's AfterMoveSecondary (H1 neighbourhood)", () => {
  // Pinned Showdown (VE-H1-1 to VE-H1-4): after the self-hit the Sitrus Berry stays; a status move that then reaches the holder
  // runs AfterMoveSecondary (checkedAngerShell true), and that action's last Update eats it: 63–80 becomes 80–102.
  it("is not estimated when a status move then reaches the locked holder at its Berry's line", async () => {
    const sv = await game(SV);
    const locked = REASONS.berryLocked("Anger Shell", "Sitrus Berry");
    expect(reason(turn(sv, [idle(klawf()), idle(lax()), act(mon("amoonguss", "regenerator"), "spore", OL), idle(toise())]))).toBe(locked);
    expect(reason(turn(sv, [idle(klawf()), idle(lax()), act(mon("dusknoir", "pressure", { hp: 40 }), "painsplit", OL), idle(toise())]))).toBe(locked);
    expect(reason(turn(sv, [idle(klawf({ item: "" })), idle(lax()), act(mon("hatterene", "magicbounce", { item: "sitrusberry" }), "trick", OL), idle(toise())]))).toBe(locked);
    const usum = await game(USUM);
    const drampa = mon("drampa", "berserk", { item: "sitrusberry", hp: 85, carried: { confusion: { attempts: 0 } } });
    expect(reason(turn(usum, [idle(drampa), idle(lax()), act(mon("ferrothorn", "ironbarbs"), "thunderwave", OL), idle(toise())]))).toBe(REASONS.berryLocked("Berserk", "Sitrus Berry"));
  });

  it("follows a status move that does not reach the holder, or leaves it above the line", async () => {
    const sv = await game(SV);
    // VE-H1-6: Spore into the ally: the Sitrus stays through the moves and the end of turn (Showdown 63–80: no residual
    // damage resets the lock; FINAL: doubles-eot.ts follows it).
    const ally = ready(turn(sv, [idle(klawf()), idle(lax()), act(mon("amoonguss", "regenerator"), "spore", OR), idle(toise())]));
    near(hpOf(ally, OL), [63, 80, 74.988125]);
    expect(ally.endOfTurn.status === "ready" ? [ally.endOfTurn.hp[OL]!.min, ally.endOfTurn.hp[OL]!.max] : ally.endOfTurn).toEqual([63, 80]);
    // VE-H1-7: Life Dew heals 35, to above the line (Showdown 95–112).
    const dew = ready(turn(sv, [idle(klawf({ hp: 76 })), act(mon("primarina", "torrent"), "lifedew"), idle(lax()), idle(toise())]));
    near(hpOf(dew, OL), [95, 112, 106.988125]);
  });
});

describe("accuracy and evasion stages (H2, H8 neighbourhood)", () => {
  it("uses White Herb on an accuracy drop (VE-H2-9, VE-H2-10, VE-H8-5)", async () => {
    const sv = await game(SV);
    expect(items(turn(sv, [act(chomp(), "sandattack", PL), idle(saur()), idle(lax({ item: "whiteherb" })), idle(toise())]), PL)).toEqual([""]);
    expect(items(turn(sv, [act(mon("excadrill", "sandrush"), "mudslap", PL), idle(saur()), idle(lax({ item: "whiteherb" })), idle(toise())]), PL)).toEqual([""]);
    expect(items(turn(sv, [act(mon("excadrill", "sandrush"), "mudslap", PL), idle(saur()), idle(mon("mimikyu", "disguise", { item: "whiteherb" })), idle(toise())]), PL)).toEqual([""]);
    // VE-ST-3: Contrary turns it into a rise: White Herb stays.
    expect(items(turn(sv, [act(chomp(), "sandattack", PL), idle(saur()), idle(mon("malamar", "contrary", { item: "whiteherb" })), idle(toise())]), PL)).toEqual(["whiteherb"]);
    // VE-ST-5: a White Herb received after the drop (sim/pokemon.ts setItem runs its Start) is used at once.
    expect(items(turn(sv, [act(chomp(), "sandattack", PL), act(mon("hatterene", "magicbounce", { item: "whiteherb" }), "trick", PL), idle(lax()), idle(toise())]), PL)).toEqual([""]);
  });

  it("doubles an Unburden holder's Speed once White Herb restores its accuracy (VE-H2-11)", async () => {
    const result = ready(turn(await game(SV), [
      act(mon("excadrill", "sandrush", { evs: { spe: 252 }, nature: "Jolly" }), "mudslap", PL), act(mon("gengar", "cursedbody", { hp: 60 }), "shadowball", PL),
      act(mon("hitmonlee", "unburden", { item: "whiteherb" }), "knockoff", OR), idle(toise()),
    ]));
    // Showdown: Hitmonlee (214 after Unburden) knocks Gengar (130) out before it moves.
    expect(stepOf(result, OR).moves).toBe(0);
    expect(result.hp[OR]!.koChance).toBe(1);
    near(hpOf(result, PL), [116, 118, 117.875]);
  });

  it("does not estimate Stored Power and Punishment reading a positive accuracy or evasion stage", async () => {
    const usum = await game(USUM);
    // VE-H2-12: Showdown's Punishment has 80 power after Double Team (79–94); the calculation would read 60.
    expect(reason(turn(usum, [act(jolt(), "doubleteam"), idle(saur()), act(mon("weavile", "pressure"), "punishment", OL), idle(toise())]))).toBe(REASONS.hiddenStages("Punishment", "Jolteon"));
    const sv = await game(SV);
    expect(reason(turn(sv, [act(chomp(), "sandattack", PL), idle(saur()), act(mon("malamar", "contrary"), "storedpower", OR), idle(toise())]))).toBe(REASONS.hiddenStages("Stored Power", "Malamar"));
    // VE-ST-2: Haze clears it first: ready, Stored Power at 20 (Showdown: Venusaur 160–163).
    const hazed = ready(turn(sv, [act(chomp(), "sandattack", PL), act(mon("milotic", "marvelscale"), "haze"), act(mon("malamar", "contrary"), "storedpower", OR), idle(toise())]));
    near(hpOf(hazed, OR), [160, 163, 161.0625]);
    // VE-ST-4: an ally's evasion is not the user's.
    ready(turn(sv, [act(mon("dragapult", "clearbody"), "doubleteam"), act(mon("espathra", "speedboost"), "storedpower", PL), idle(lax()), idle(toise())]));
  });
});

describe("the target's own Lansat and Starf Berries at a hit's Update (positions-items-sub F1 neighbourhood)", () => {
  it("eats a Lansat Berry after a hit: the holder's later Super Luck Night Slash always crits (VE-L1-1)", async () => {
    const result = ready(turn(await game(SV), [
      act(mon("honchkrow", "superluck", { item: "lansatberry", hp: 60 }), "nightslash", PL), idle(saur()), act(mon("azumarill", "thickfat"), "aquajet", OL), idle(toise()),
    ]));
    // Showdown: Aqua Jet 24–28, Lansat eaten (focusenergy), Night Slash a critical hit for 43–51 into Azumarill.
    near(hpOf(result, PL), [124, 132, 127.8125]);
    expect(result.facts).toContain("Every move hits; critical hits only where certain; added effects below 100% do not happen.");
    const hit = stepOf(result, OL).hits.find((each) => each.slot === PL)!;
    expect(hit.facts.map((fact) => fact.text)).toEqual(["Every hit is a critical hit (critical-hit ratio +4: Night Slash, the Lansat Berry and Super Luck)."]);
  });

  it("eats a Starf Berry after a hit: a random stat +2 for the holder's later move (VE-F1-6)", async () => {
    const result = ready(turn(await game(SV), [act(chomp(), "dragonclaw", PL), idle(saur()), act(lax({ item: "starfberry", hp: 110 }), "bodyslam", OL), idle(toise())]));
    near(hpOf(result, OL), [54, 128, 111.2375]);
  });

  it("keeps it under the attacker's Unnerve (VE-F1-9)", async () => {
    const usum = await game(USUM);
    const input = turn(usum, [act(mon("houndoom", "unnerve"), "crunch", PL), idle(saur()), act(lax({ item: "starfberry", hp: 90 }), "bodyslam", OL), idle(toise())]);
    near(hpOf(ready(input), OL), [44, 60, 52.375]);
    expect(items(input, PL)).toEqual(["starfberry"]);
  });

  it("is not estimated where it would be eaten between two hits of one move (VE-F1-10, VE-F1-13)", async () => {
    const swsh = await game("sword_shield");
    const bullets = (item: string) => turn(swsh, [act(mon("cinccino", "technician"), "bulletseed", PL), idle(saur()), act(lax({ item, hp: 100 }), "bodyslam", OL), idle(toise())]);
    expect(reason(bullets("starfberry"))).toBe(REASONS.berryBetweenHits("Starf Berry", "Bullet Seed"));
    expect(reason(bullets("ganlonberry"))).toBe(REASONS.berryBetweenHits("Ganlon Berry", "Bullet Seed"));
  });
});

describe("Clear Smog's clearBoosts is no drop (M1 neighbourhood)", () => {
  it("leaves an Eject Pack holder in after Clear Smog takes its +1 (VE-M1-1, VE-M1-2)", async () => {
    const sv = await game(SV);
    const later = ready(turn(sv, [act(mon("chandelure", "flashfire"), "clearsmog", PL), idle(saur()), act(lax({ item: "ejectpack", boosts: { atk: 1 } }), "bodyslam", OL), idle(toise())]));
    expect(stepOf(later, PL).moves).toBe(1);
    near(hpOf(later, PL), [206, 211, 208.6875]);
    const last = ready(turn(sv, [act(mon("chandelure", "flashfire"), "clearsmog", PL), idle(saur()), idle(lax({ item: "ejectpack", boosts: { atk: 1 } })), idle(toise())]));
    expect(last.endOfTurn.status).toBe("ready");
  });
});

describe("Sparkling Aria with its user fainting in the move (H5 neighbourhood)", () => {
  it("is not estimated where Life Orb may be what knocked the user out (VE-H5-6: Showdown still cures)", async () => {
    const input = turn(await game(SV), [act(mon("primarina", "torrent", { item: "lifeorb", hp: 5 }), "sparklingaria"), null, act(lax({ status: "brn" }), "bodyslam", OL), idle(toise())]);
    expect(reason(input)).toBe(REASONS.ariaFaint("Primarina"));
  });
});

describe("generation 7's one sort and a status its holder's own ability cures (ui F1 neighbourhood)", () => {
  it("sorts a paralysed Limber Pokémon at its full Speed (VE-UI-1; Showdown's SetStatus never lets the paralysis land)", async () => {
    const result = ready(turn(await game(USUM), [act(mon("hitmonlee", "limber", { status: "par" }), "highjumpkick", PL), idle(lax()), act(saur({ hp: 60 }), "gigadrain", OL), idle(toise())]));
    expect(stepOf(result, OL).order).toEqual([{ position: 1, chance: 1 }]);
    near(hpOf(result, OL), [55, 67, 60.75]);
    near(hpOf(result, PL), [30, 45, 38.25]);
    expect(result.facts).toContain("Limber: Hitmonlee is cured of its paralysis as the turn starts.");
  });

  it("sorts a Lum Berry holder's start paralysis at full Speed too (FX02b: the oracle's Lum Berry eats it as it is set)", async () => {
    const result = ready(turn(await game(USUM), [act(chomp({ status: "par", item: "lumberry" }), "dragonclaw", PL), idle(lax()), act(saur({ hp: 60 }), "gigadrain", OL), idle(toise())]));
    expect(stepOf(result, OL).order).toEqual([{ position: 1, chance: 1 }]);
    expect(stepOf(result, PL).moves).toBe(0);
  });
});
