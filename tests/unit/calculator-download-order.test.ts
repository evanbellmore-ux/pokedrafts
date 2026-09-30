import { beforeAll, describe, expect, it } from "vitest";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { applyIntimidate } from "@/app/lib/battle/intimidate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import { parseTeamImport } from "@/app/lib/battle/team-import";
import type { BattleBuild, BattleConditions, StatTable } from "@/app/lib/battle/types";

/**
 * Download against the foe's entry boosts at a shared lead. Pinned Showdown c23d2e94 runs switch-in
 * effects by priority, then Speed (stat and item only at the lead): Download and Dauntless Shield share
 * priority 0, so the faster acts first (a tie is random); a terrain Seed (-1) comes after, and Embody
 * Aspect only when Ogerpon Terastallizes during the turn. Level 50, 31 IVs, Singles; every range is from
 * real pinned-Showdown battles (audit gaps/download-order r1.ts to r5.ts): both lead, Porygon-Z attacks.
 */
let sv: BattleRuntime;
let swsh: BattleRuntime;
beforeAll(async () => {
  sv = await loadBattleRuntime("scarlet_violet");
  swsh = await loadBattleRuntime("sword_shield");
});
type Spec = { ability?: string; item?: string; nature?: string; evs?: Partial<StatTable<number>>; ivs?: Partial<StatTable<number>>; tera?: string };
function build(runtime: BattleRuntime, id: string, spec: Spec = {}): BattleBuild {
  const base = createBuild(id, runtime);
  const zero = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  return {
    ...base,
    ...(spec.ability ? { abilityId: spec.ability } : {}),
    ...(spec.item !== undefined ? { itemId: spec.item } : {}),
    ...(spec.nature ? { nature: spec.nature } : {}),
    ...(spec.tera ? { mechanic: "tera", configuration: { ...base.configuration, teraType: spec.tera } } : {}),
    native: { ...base.native!, evs: { ...zero, ...spec.evs }, ivs: { ...base.native!.ivs, ...spec.ivs } },
  } as BattleBuild;
}
function row(runtime: BattleRuntime, moveId: string, attacker: BattleBuild, defender: BattleBuild, field: Partial<BattleConditions> = {}) {
  const out = calculateMatchup(attacker, defender, { ...createConditions(), gameType: "Singles", ...field }, {}, runtime);
  expect(out.issues).toEqual({ attacker: [], defender: [], field: [] });
  return out.results.find((result) => result.moveId === moveId)!;
}
const range = (result: { min: number | null; max: number | null }) => `${result.min}-${result.max}`;
const download = (result: { assumptions: string[] }) => result.assumptions.filter((line) => line.includes("Download")).join(" ");
// 4 HP / 252 SpA; Timid 252 Spe = 156 Speed, Modest 0 Spe = 110.
const porygonz = (runtime: BattleRuntime, nature: "Timid" | "Modest", spe: number, item = "") =>
  build(runtime, "porygonz", { ability: "download", nature, item, evs: { hp: 4, spa: 252, spe } });
// Sassy 252 HP / 252 SpD: Def 135, SpD 183, 142 Speed; Dauntless Shield's +1 Def (202) turns Download from Attack to Sp. Atk.
const zamazenta = (runtime: BattleRuntime, spec: Spec = {}) => build(runtime, "zamazenta", { ability: "dauntlessshield", nature: "Sassy", evs: { hp: 252, spd: 252 }, ...spec });
const crowned = (runtime: BattleRuntime, spec: Spec = {}) => build(runtime, "zamazentacrowned", { ability: "dauntlessshield", item: "rustedshield", nature: "Sassy", evs: { hp: 252, spd: 252 }, ...spec });

describe("Download against Dauntless Shield at a shared lead", () => {
  it("reads a slower holder before its boost, and counts a faster one's", () => {
    const first = row(sv, "triattack", porygonz(sv, "Timid", 252), zamazenta(sv));
    expect(range(first)).toBe("46-55");
    expect(first.assumptions).toContain("The attacker Porygon-Z's Download read Zamazenta's Defense and Sp. Def before its Dauntless Shield raised its Defense, raising its Attack. This assumes both led together, where Porygon-Z acts first (156 Speed on entry against 142); if it entered later or Dauntless Shield acted first (as when both are sent in together under Trick Room), Download raised its Sp. Atk.");
    const second = row(sv, "triattack", porygonz(sv, "Modest", 0), zamazenta(sv));
    expect(range(second)).toBe("76-91");
    expect(second.assumptions).toContain("The attacker Porygon-Z's Download counted Zamazenta's Dauntless Shield rise, raising its Sp. Atk. This assumes both led together, where Zamazenta acts first (142 Speed on entry against 110); if Download acted first (as when both are sent in together under Trick Room), it raised its Attack.");
  });

  it("orders them by Speed with the held item, before any Trick Room", () => {
    // Choice Scarf: 110 -> 165; Iron Ball: 156 -> 78.
    expect(range(row(sv, "triattack", porygonz(sv, "Modest", 0, "choicescarf"), zamazenta(sv)))).toBe("51-61");
    expect(range(row(sv, "triattack", porygonz(sv, "Timid", 252, "ironball"), zamazenta(sv)))).toBe("69-82");
    // Trick Room set on turn 1 came after the lead's entry order.
    expect(range(row(sv, "triattack", porygonz(sv, "Timid", 252), zamazenta(sv), { trickRoom: true }))).toBe("46-55");
    expect(range(row(sv, "triattack", porygonz(sv, "Modest", 0), zamazenta(sv), { trickRoom: true }))).toBe("76-91");
  });

  it("uses Zamazenta-Crowned's own Speed, and Porygon2's", () => {
    // Modest 196 Spe Porygon-Z (135) outspeeds Crowned (133) but not Hero (142).
    expect(range(row(sv, "triattack", porygonz(sv, "Modest", 196), crowned(sv)))).toBe("22-27");
    expect(range(row(sv, "triattack", porygonz(sv, "Modest", 196), zamazenta(sv)))).toBe("76-91");
    expect(range(row(sv, "triattack", porygonz(sv, "Timid", 252), crowned(sv)))).toBe("21-24");
    const porygon2 = build(sv, "porygon2", { ability: "download", item: "eviolite", nature: "Timid", evs: { spa: 252, spe: 252 } });
    expect(range(row(sv, "triattack", porygon2, crowned(sv, { ivs: { spe: 0 } })))).toBe("17-21");
    expect(range(row(sv, "triattack", porygon2, crowned(sv)))).toBe("25-30");
  });

  it("keeps the engine's order on a Speed tie, which Showdown settles at random", () => {
    const tie = row(sv, "triattack", porygonz(sv, "Modest", 252), zamazenta(sv));
    expect(range(tie)).toBe("76-91");
    expect(tie.assumptions).toContain("The attacker Porygon-Z's Download counted Zamazenta's Dauntless Shield rise, raising its Sp. Atk. This assumes both led together and Dauntless Shield acted first: both have 142 Speed on entry, so Showdown picks the order at random; if Download acted first, it raised its Attack.");
  });

  it("applies to a Trace holder that copied Download, and to the target's Download", () => {
    const trace = { ...build(sv, "porygon2", { ability: "trace", item: "choicescarf", nature: "Timid", evs: { spa: 252, spe: 252 } }), tracedAbility: "download" } as BattleBuild;
    expect(range(row(sv, "triattack", trace, zamazenta(sv)))).toBe("40-48");
    expect(download(row(sv, "closecombat", zamazenta(sv), porygonz(sv, "Timid", 252)))).toContain("The target Porygon-Z's Download read Zamazenta's Defense and Sp. Def before its Dauntless Shield raised its Defense, raising its Attack.");
  });

  it("follows the same order in Sword/Shield, where Dauntless Shield acts on every entry", () => {
    expect(range(row(swsh, "triattack", porygonz(swsh, "Timid", 252), zamazenta(swsh)))).toBe("46-55");
    expect(range(row(swsh, "triattack", porygonz(swsh, "Modest", 0), zamazenta(swsh)))).toBe("76-91");
    expect(range(row(swsh, "triattack", porygonz(swsh, "Timid", 252), crowned(swsh)))).toBe("20-24");
  });

  it("counts neither a Seed nor a slower Shield, with a Seed on Zamazenta", () => {
    const psychic = zamazenta(sv, { item: "psychicseed" });
    const first = row(sv, "triattack", porygonz(sv, "Timid", 252), psychic, { terrain: "Psychic" });
    expect(range(first)).toBe("33-39");
    expect(first.assumptions).toContain("The attacker Porygon-Z's Download read Zamazenta's Defense and Sp. Def before its Psychic Seed was used and its Dauntless Shield raised its Defense, raising its Attack. This assumes both led together, where Porygon-Z acts first (156 Speed on entry against 142); if Dauntless Shield acted first (as when both are sent in together under Trick Room), Download raised its Sp. Atk.");
    const second = row(sv, "triattack", porygonz(sv, "Modest", 0), psychic, { terrain: "Psychic" });
    expect(range(second)).toBe("51-61");
    expect(second.assumptions).toContain("The attacker Porygon-Z's Download counted Zamazenta's Dauntless Shield rise but read its Defense and Sp. Def before its Psychic Seed was used, raising its Sp. Atk. This assumes both led together, where Zamazenta acts first (142 Speed on entry against 110); if it entered later or Download acted first (as when both are sent in together under Trick Room), Download raised its Attack.");
    expect(range(row(sv, "triattack", porygonz(sv, "Timid", 252), zamazenta(sv, { item: "grassyseed" }), { terrain: "Grassy" }))).toBe("46-55");
  });
});

describe("Download against a Terastallized Ogerpon at a shared lead", () => {
  it("reads it before Embody Aspect, whatever the Speed", () => {
    // Cornerstone: Def 104 < SpD 116 (Embody +1 Def: 156).
    const cornerstone = build(sv, "ogerponcornerstone", { ability: "sturdy", item: "cornerstonemask", tera: "Rock" });
    const hit = row(sv, "triattack", porygonz(sv, "Timid", 252), cornerstone);
    expect(range(hit)).toBe("36-43");
    expect(hit.assumptions).toContain("The attacker Porygon-Z's Download read Ogerpon-Cornerstone's Defense and Sp. Def before its Embody Aspect (Cornerstone) raised its Defense, raising its Attack. This assumes both led together, so Ogerpon-Cornerstone Terastallized after Download acted; if it entered after that, Download raised its Sp. Atk.");
    expect(range(row(sv, "triattack", porygonz(sv, "Modest", 0), cornerstone))).toBe("40-48");
    // Wellspring, Impish 252 Def: Def 149 >= SpD 116 (Embody +1 SpD: 174).
    const wellspring = build(sv, "ogerponwellspring", { ability: "waterabsorb", item: "wellspringmask", nature: "Impish", evs: { def: 252 }, tera: "Water" });
    expect(range(row(sv, "triattack", porygonz(sv, "Timid", 252), wellspring))).toBe("73-87");
    expect(range(row(sv, "triattack", porygonz(sv, "Modest", 0), wellspring))).toBe("81-96");
  });
});

describe("Download in Intimidate's stage bookkeeping", () => {
  it("reads the Intimidate user before its Seed, so White Herb stays", () => {
    // Gyarados Def 99 < SpD 120 (Grassy Seed +1 Def: 148). Real: Download +1 Attack, Intimidate -1, White Herb kept.
    const gyarados = build(sv, "gyarados", { ability: "intimidate", item: "grassyseed", evs: { hp: 252 } });
    const pz = build(sv, "porygonz", { ability: "download", item: "whiteherb", nature: "Adamant", evs: { atk: 252 } });
    const result = applyIntimidate(gyarados, pz, { magicRoom: false, wonderRoom: false, terrain: "Grassy", gameType: "Singles", tailwind: { source: false, target: false } }, sv);
    expect(result.target.itemId).toBe("whiteherb");
    expect(range(row(sv, "doubleedge", result.target, result.source, { terrain: "Grassy" }))).toBe("67-79");
  });
});

describe("Download reads the foe as it led", () => {
  // Real pinned-Showdown battles from the review (gaps/review/download-order/verify f1.ts, f2.ts, f3.ts,
  // f3b.ts, f67.ts): both lead, then the form change, then Porygon-Z's Tri Attack.
  it("in its form before Mega Evolution, Primal Reversion, Schooling or Relic Song", async () => {
    const us = await loadBattleRuntime("ultra_sun_ultra_moon");
    const timid = porygonz(us, "Timid", 252);
    const mega = row(us, "triattack", timid, build(us, "charizardmegax", { ability: "toughclaws", item: "charizarditex" }));
    expect(range(mega)).toBe("81-96");
    expect(download(mega)).toBe("The attacker Porygon-Z's Download read Charizard's Defense and Sp. Def before it Mega Evolved, raising its Attack. This assumes both led together; if it entered after Charizard Mega Evolved, Download raised its Sp. Atk.");
    expect(range(row(us, "triattack", timid, build(us, "altariamega", { ability: "pixilate", item: "altarianite" })))).toBe("67-81");
    const primal = row(us, "triattack", timid, build(us, "groudonprimal", { ability: "desolateland", item: "redorb", nature: "Gentle", evs: { spd: 252 } }));
    expect(range(primal)).toBe("55-66");
    expect(download(primal)).toContain("read Groudon's Defense and Sp. Def before it underwent Primal Reversion");
    expect(range(row(us, "triattack", timid, { ...build(us, "wishiwashi", { ability: "schooling", nature: "Impish" }), abilityActive: false }))).toBe("55-66");
    const pirouette = row(sv, "triattack", porygonz(sv, "Modest", 252), { ...build(sv, "meloettapirouette", { ability: "serenegrace" }), preparedMoves: ["relicsong"] });
    expect(range(pirouette)).toBe("96-114");
    // Necrozma-Ultra led as Dusk Mane or Dawn Wings, which is not known: the engine's read, and each lead read named.
    const ultra = row(us, "triattack", timid, { ...build(us, "necrozmaultra", { ability: "neuroforce", item: "ultranecroziumz" }), preparedMoves: ["photongeyser"] });
    expect(range(ultra)).toBe("109-129");
    expect(download(ultra)).toBe("The attacker Porygon-Z's Download read Necrozma-Ultra as it is now, raising its Sp. Atk: this assumes it entered after Necrozma used Ultra Burst. If both led together, Download read its entry form instead and raised its Attack against Necrozma-Dawn-Wings or its Sp. Atk too against Necrozma-Dusk-Mane.");
  });

  it("with no room up yet, naming Wonder Room when it changes the pick", () => {
    const sassy = row(sv, "triattack", porygonz(sv, "Modest", 0), zamazenta(sv), { wonderRoom: true });
    expect(range(sassy)).toBe("103-123");
    expect(download(sassy)).toBe("The attacker Porygon-Z's Download counted Zamazenta's Dauntless Shield rise but read its Defense and Sp. Def before Wonder Room was set, raising its Sp. Atk. This assumes both led together, where Zamazenta acts first (142 Speed on entry against 110); if it entered later (under Wonder Room) or Download acted first (as when both are sent in together under Trick Room), Download raised its Attack.");
    const impish = zamazenta(sv, { nature: "Impish", evs: { hp: 252, def: 252 } });
    expect(range(row(sv, "triattack", porygonz(sv, "Modest", 0), impish, { wonderRoom: true }))).toBe("76-91");
    expect(range(row(sv, "triattack", porygonz(sv, "Timid", 252), impish, { wonderRoom: true }))).toBe("69-82");
  });

  it("names Ogerpon by the form it led with, and a Contrary holder's Seed drop", () => {
    const timid = porygonz(sv, "Timid", 252);
    const teal = row(sv, "triattack", timid, build(sv, "ogerpon", { ability: "defiant", item: "grassyseed", tera: "Grass" }), { terrain: "Grassy" });
    expect(range(teal)).toBe("73-87");
    expect(download(teal)).toBe("The attacker Porygon-Z's Download read Ogerpon's Defense and Sp. Def before its Grassy Seed was used, raising its Attack. This assumes both entered together; if it entered later, Download counted the Seed's rise.");
    const cornerstone = row(sv, "triattack", timid, build(sv, "ogerponcornerstonetera", { ability: "embodyaspectcornerstone", item: "cornerstonemask", tera: "Rock" }));
    expect(range(cornerstone)).toBe("36-43");
    expect(download(cornerstone)).toContain("read Ogerpon-Cornerstone's Defense and Sp. Def before its Embody Aspect (Cornerstone) raised its Defense");
    const serperior = row(sv, "triattack", timid, build(sv, "serperior", { ability: "contrary", item: "grassyseed" }), { terrain: "Grassy" });
    expect(range(serperior)).toBe("109-130");
    expect(download(serperior)).toContain("if it entered later, Download counted the Seed's drop.");
  });
});

describe("Zacian and Zamazenta holding their Rusted item", () => {
  it("battle as the Crowned form: flagged when picked, converted on import, and Iron Head becomes Behemoth Bash", () => {
    const hero = zamazenta(sv, { item: "rustedshield" });
    expect(calculateMatchup(porygonz(sv, "Modest", 196), hero, { ...createConditions(), gameType: "Singles" }, {}, sv).issues.defender)
      .toEqual([{ field: "itemId", message: "Zamazenta holding Rusted Shield battles as Zamazenta-Crowned: pinned Showdown changes its form when the battle starts. Choose Zamazenta-Crowned instead." }]);
    // The Crowned form: 133 Speed at entry, against Modest 196 Spe Porygon-Z's 135 (real battle 22-27).
    expect(range(row(sv, "triattack", porygonz(sv, "Modest", 196), crowned(sv)))).toBe("22-27");
    const member = parseTeamImport("Zamazenta @ Rusted Shield\nAbility: Dauntless Shield\nLevel: 50\n- Iron Head\n- Close Combat", "traditional", sv).members[0];
    expect(member).toMatchObject({ speciesId: "zamazentacrowned", build: { speciesId: "zamazentacrowned", itemId: "rustedshield", preparedMoves: ["behemothbash", "closecombat"] } });
    expect(member.moves.map((slot) => slot.moveId)).toEqual(["behemothbash", "closecombat", null, null]);
    expect(member.diagnostics).toContainEqual(expect.objectContaining({ severity: "info", message: "Zamazenta holding Rusted Shield battles as Zamazenta-Crowned, and its Iron Head becomes Behemoth Bash, as pinned Showdown does when the battle starts." }));
    const ironHead = row(sv, "ironhead", crowned(sv), build(sv, "snorlax"));
    expect(ironHead).toMatchObject({ kind: "unsupported", reason: "Zamazenta-Crowned's Iron Head becomes Behemoth Bash when the battle starts (pinned Showdown), so it is never used: choose Behemoth Bash." });
  });
});

describe("Download's lead read, second review", () => {
  // Real pinned-Showdown battles from gaps/review2/download-lead t2.ts and t3.ts; Modest 4 HP / 252 SpA / 252 Spe Porygon-Z.
  it("reads the lead before Stance Change, Zen Mode or Zero to Hero, and names both reads of Zygarde-Complete", async () => {
    const us = await loadBattleRuntime("ultra_sun_ultra_moon");
    expect(range(row(swsh, "darkpulse", porygonz(swsh, "Modest", 252), build(swsh, "aegislashblade", { ability: "stancechange", nature: "Relaxed", evs: { spd: 100 } })))).toBe("224-264");
    expect(range(row(us, "darkpulse", porygonz(us, "Modest", 252), build(us, "aegislashblade", { ability: "stancechange", nature: "Relaxed", evs: { spd: 100 } })))).toBe("224-264");
    const zen = row(swsh, "triattack", porygonz(swsh, "Modest", 252), build(swsh, "darmanitanzen", { ability: "zenmode", nature: "Relaxed", evs: { spd: 64 } }));
    expect(range(zen)).toBe("70-84");
    expect(download(zen)).toContain("read Darmanitan's Defense and Sp. Def before it entered Zen Mode, raising its Attack");
    expect(range(row(sv, "triattack", porygonz(sv, "Modest", 252), build(sv, "palafinhero", { ability: "zerotohero", nature: "Impish", evs: { spd: 160 } })))).toBe("73-87");
    // Zygarde-Complete led as Zygarde (the same Def/SpD, 120-142) or Zygarde-10% (81-96): the as-is read, with both named.
    const complete = row(us, "triattack", porygonz(us, "Modest", 252), build(us, "zygardecomplete", { ability: "powerconstruct" }));
    expect(range(complete)).toBe("120-142");
    expect(download(complete)).toContain("this assumes it entered after Zygarde became Zygarde-Complete. If both led together, Download read its entry form instead and raised");
    expect(download(complete)).toContain("its Attack against Zygarde-10%");
  });

  it("gives the foe no Defense or Sp. Def stages at the lead", async () => {
    const us = await loadBattleRuntime("ultra_sun_ultra_moon");
    const kyogre = { ...build(us, "kyogreprimal", { ability: "primordialsea", item: "blueorb" }), boosts: { atk: 0, def: 0, spa: 0, spd: -1, spe: 0 } };
    expect(range(row(us, "triattack", porygonz(us, "Modest", 252), kyogre))).toBe("78-93");
    const slowbro = { ...build(sv, "slowbro", { ability: "oblivious" }), boosts: { atk: 0, def: 0, spa: 1, spd: 1, spe: 0 } };
    expect(range(row(sv, "triattack", porygonz(sv, "Modest", 252), slowbro, { wonderRoom: true }))).toBe("72-85");
  });
});

describe("Crowned forms, second review", () => {
  it("never suggests or copies Iron Head, and imports a Crowned set's Iron Head as its Behemoth move", async () => {
    const { createMoveSlots } = await import("@/app/lib/battle/move-defaults");
    for (const gameType of ["Singles", "Doubles"] as const) {
      expect(createMoveSlots("zaciancrowned", gameType, sv).map((slot) => slot.moveId)).not.toContain("ironhead");
    }
    // Transform copies the Behemoth Blade slot (gaps/review2/shield-order-crowned c3.ts: Showdown's copy has no Iron Head).
    const ditto = row(sv, "ironhead", build(sv, "ditto", { ability: "imposter" }), build(sv, "zaciancrowned", { ability: "intrepidsword", item: "rustedsword" }));
    expect(ditto).toMatchObject({ kind: "unsupported", reason: "The transformed Zacian-Crowned copied Behemoth Blade, which replaces its Iron Head when the battle starts (pinned Showdown), so Iron Head is never used: choose Behemoth Blade." });
    const paste = (text: string) => parseTeamImport(text, "traditional", sv).members[0];
    const crownedSet = paste("Zacian-Crowned @ Rusted Sword\nAbility: Intrepid Sword\nLevel: 50\n- Iron Head\n- Play Rough");
    expect(crownedSet.moves.map((slot) => slot.moveId)).toEqual(["behemothblade", "playrough", null, null]);
    expect(crownedSet.diagnostics).toContainEqual(expect.objectContaining({ severity: "info", message: "Zacian-Crowned's Iron Head becomes Behemoth Blade, as pinned Showdown does when the battle starts." }));
    // Showdown's validator rejects a Hero set that names Behemoth Blade; the conversion never makes a duplicate.
    expect(paste("Zacian @ Rusted Sword\nAbility: Intrepid Sword\nLevel: 50\n- Behemoth Blade\n- Play Rough").diagnostics)
      .toContainEqual(expect.objectContaining({ severity: "error", message: "Zacian cannot learn Behemoth Blade in Scarlet and Violet." }));
    expect(paste("Zacian-Crowned @ Rusted Sword\nAbility: Intrepid Sword\nLevel: 50\n- Iron Head\n- Behemoth Blade").diagnostics)
      .toContainEqual(expect.objectContaining({ severity: "error", message: "Duplicate move \"Behemoth Blade\": Iron Head becomes Behemoth Blade when the battle starts." }));
  });
});
