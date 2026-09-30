import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import BattleConditions, { describeConditions } from "@/app/(app)/calculator/BattleConditions";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, getBuildStats, withoutSinglesPartners } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions as Conditions, MoveContext, SideConditions } from "@/app/lib/battle/types";

/**
 * Reference results from real pinned Showdown c23d2e94 Doubles lead battles
 * (scripts/.cache/calc-audit/gaps/partner-shields/lib.ts): p1a attacks p2a while p2a's partner p2b has
 * Queenly Majesty (Tsareena), Dazzling (Bruxish) or Armor Tail (Farigiraf), which logs
 * `|cant|p2b|ability: ...` and stops the move (onFoeTryMove, move.priority > 0.1); the damage values
 * are the same battles with a Snorlax partner. Level 50, 0 Stat Points/EVs unless stated, 31 IVs,
 * Serious nature, no crit.
 */
function build(id: string, abilityId: string, runtime: BattleRuntime = championsRuntime, extra: Partial<BattleBuild> = {}): BattleBuild {
  return { ...createBuild(id, runtime), abilityId, abilityActive: false, ...extra } as BattleBuild;
}
const points = (build: BattleBuild, stats: Partial<Record<"atk" | "spa", number>>) =>
  (build.game === "champions" ? { ...build, points: { ...build.points, ...stats } } : { ...build, native: { ...build.native, evs: { ...build.native.evs, ...stats } } }) as BattleBuild;

function field(options: { gameType?: Conditions["gameType"]; spread?: boolean; shield?: boolean; attackerShield?: boolean; terrain?: Conditions["terrain"]; protect?: boolean } = {}): Conditions {
  const base = createConditions();
  return {
    ...base, gameType: options.gameType ?? "Doubles", multipleTargets: !!options.spread, terrain: options.terrain ?? "",
    attackerSide: { ...base.attackerSide, priorityShield: !!options.attackerShield },
    defenderSide: { ...base.defenderSide, priorityShield: options.shield ?? true, protect: !!options.protect },
  };
}

function row(moveId: string, attacker: BattleBuild, defender: BattleBuild, conditions: Conditions, runtime: BattleRuntime = championsRuntime, contexts: Record<string, MoveContext> = {}) {
  const out = calculateMatchup(attacker, defender, conditions, contexts, runtime);
  expect(out.issues).toEqual({ attacker: [], defender: [], field: [] });
  return out.results.find((result) => result.moveId === moveId)!;
}

const blocked = (names: string, move: string, priority: number) => `A partner with ${names} blocks ${move}: it has +${priority} priority.`;
const CHAMPIONS = "Queenly Majesty or Armor Tail";
const SV = "Queenly Majesty, Dazzling or Armor Tail";
const incineroar = build("incineroar", "blaze");

describe("a partner's Queenly Majesty, Dazzling or Armor Tail", () => {
  it("stops priority moves aimed at its side, including Gale Wings, Grassy Glide and spread moves", () => {
    const talonflame = points(build("talonflame", "galewings"), { atk: 32 });
    const braveBird = row("bravebird", talonflame, incineroar, field());
    expect(braveBird).toMatchObject({ kind: "calculated", min: 0, max: 0, ohkoChance: 0, assumptions: [blocked(CHAMPIONS, "Brave Bird", 1)] });
    expect(row("bravebird", talonflame, incineroar, field({ shield: false }))).toMatchObject({ min: 82, max: 97 });
    // Below full HP Gale Wings gives no priority, so nothing is stopped.
    const hurt = { ...talonflame, currentHP: getBuildStats(talonflame)!.hp - 1 };
    expect(row("bravebird", hurt, incineroar, field())).toMatchObject({ min: 82, max: 97 });
    // A spread move stops for both targets (Showdown checks the move once).
    const airCutter = points(build("talonflame", "galewings"), { spa: 32 });
    expect(row("aircutter", airCutter, incineroar, field({ spread: true }))).toMatchObject({ min: 0, max: 0 });
    expect(row("aircutter", airCutter, incineroar, field({ spread: true, shield: false }))).toMatchObject({ min: 30, max: 36 });
    for (const [moveId, attacker, name, priority, min, max] of [
      ["feint", build("hawlucha", "limber"), "Feint", 2, 12, 15],
      ["fakeout", build("tinkaton", "owntempo"), "Fake Out", 3, 14, 17],
      ["suckerpunch", build("kingambit", "defiant"), "Sucker Punch", 1, 28, 33],
      ["extremespeed", build("dragonite", "innerfocus"), "Extreme Speed", 2, 43, 51],
    ] as const) {
      expect(row(moveId, attacker, incineroar, field()), moveId).toMatchObject({ min: 0, max: 0, description: blocked(CHAMPIONS, name, priority) });
      expect(row(moveId, attacker, incineroar, field({ shield: false })), moveId).toMatchObject({ min, max });
    }
    const rillaboom = build("rillaboom", "overgrow");
    expect(row("grassyglide", rillaboom, incineroar, field({ terrain: "Grassy" }))).toMatchObject({ min: 0, max: 0 });
    expect(row("grassyglide", rillaboom, incineroar, field())).toMatchObject({ min: 21, max: 24 });
  });

  it("is ignored by Mold Breaker, which is then listed as applied", () => {
    const basculegion = (abilityId: string) => points(build("basculegion", abilityId), { atk: 32 });
    const moldBreaker = row("aquajet", basculegion("moldbreaker"), incineroar, field());
    expect(moldBreaker).toMatchObject({ kind: "calculated", min: 68, max: 84 });
    expect(moldBreaker.assumptions).toContain(`Mold Breaker ignores the partner's ${CHAMPIONS}.`);
    expect(moldBreaker.description).toContain("Applied: Mold Breaker");
    // Without the partner Mold Breaker changes nothing here, so it is not listed.
    expect(row("aquajet", basculegion("moldbreaker"), incineroar, field({ shield: false })).description).not.toContain("Mold Breaker");
    expect(row("aquajet", basculegion("swiftswim"), incineroar, field())).toMatchObject({ min: 0, max: 0 });
    expect(row("feint", build("hawlucha", "moldbreaker"), incineroar, field())).toMatchObject({ min: 12, max: 15 });
    expect(row("fakeout", build("tinkaton", "moldbreaker"), incineroar, field())).toMatchObject({ min: 14, max: 17 });
  });

  it("protects only the receiving side and needs Doubles", () => {
    const dragonite = build("dragonite", "innerfocus");
    const outgoing = row("extremespeed", dragonite, incineroar, field({ shield: false, attackerShield: true }));
    expect(outgoing).toMatchObject({ min: 43, max: 51 });
    const singles = row("extremespeed", dragonite, incineroar, field({ gameType: "Singles" }));
    expect(singles).toMatchObject({ min: 43, max: 51 });
    expect(singles.assumptions).toContain(`Singles has only the two battling Pokémon, so the ${CHAMPIONS} partner set for Doubles is ignored.`);
    const cleared = withoutSinglesPartners(field({ gameType: "Singles", attackerShield: true }), dragonite, incineroar);
    expect(cleared.ignored).toEqual([`the ${CHAMPIONS} partner`]);
    expect(cleared.field).toMatchObject({ attackerSide: { priorityShield: false }, defenderSide: { priorityShield: false } });
  });

  it("matches Showdown in Scarlet/Violet: Dazzling, Triage, Neutralizing Gas, Tera, Protect and hit counts", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const target = build("incineroar", "blaze", sv);
    expect(row("extremespeed", build("dragonite", "innerfocus", sv), target, field(), sv)).toMatchObject({ min: 0, max: 0, description: blocked(SV, "Extreme Speed", 2) });
    expect(row("drainingkiss", build("comfey", "triage", sv), target, field(), sv)).toMatchObject({ min: 0, max: 0, description: blocked(SV, "Draining Kiss", 3) });
    expect(row("drainingkiss", build("comfey", "naturalcure", sv), target, field(), sv)).toMatchObject({ min: 27, max: 33 });
    // The target's Neutralizing Gas suppresses the partner's ability.
    const azumarill = build("azumarill", "hugepower", sv);
    const intoGas = row("aquajet", azumarill, build("weezing", "neutralizinggas", sv), field(), sv);
    expect(intoGas).toMatchObject({ min: 12, max: 15 });
    expect(intoGas.assumptions).toContain(`Neutralizing Gas suppresses the partner's ${SV}.`);
    expect(row("aquajet", azumarill, build("weezing", "levitate", sv), field(), sv)).toMatchObject({ min: 0, max: 0 });
    expect(row("grassyglide", build("ogerponhearthflame", "moldbreaker", sv, { itemId: "hearthflamemask" }), target, field({ terrain: "Grassy" }), sv)).toMatchObject({ min: 31, max: 37 });
    // Gale Wings raises a Flying move whatever the Tera type.
    const talonflame = (teraType: string) => points(build("talonflame", "galewings", sv, { mechanic: "tera", configuration: { teraType } }), { atk: 252 });
    expect(row("bravebird", talonflame("Fire"), target, field(), sv)).toMatchObject({ min: 0, max: 0 });
    expect(row("bravebird", talonflame("Flying"), target, field(), sv)).toMatchObject({ min: 0, max: 0 });
    expect(row("bravebird", talonflame("Flying"), target, field({ shield: false }), sv)).toMatchObject({ min: 110, max: 130 });
    // It acts before Protect, so a move that gets through Protect is still stopped.
    const hawlucha = build("hawlucha", "limber", sv);
    expect(row("feint", hawlucha, target, field({ protect: true }), sv)).toMatchObject({ min: 0, max: 0, description: blocked(SV, "Feint", 2) });
    expect(row("feint", hawlucha, target, field({ protect: true, shield: false }), sv)).toMatchObject({ min: 12, max: 15 });
    const urshifu = build("urshifurapidstrike", "unseenfist", sv);
    expect(row("aquajet", urshifu, target, field({ protect: true }), sv)).toMatchObject({ min: 0, max: 0 });
    expect(row("aquajet", urshifu, target, field({ protect: true, shield: false }), sv)).toMatchObject({ min: 66, max: 78 });
    expect(row("thunderclap", build("ragingbolt", "protosynthesis", sv), target, field(), sv)).toMatchObject({ min: 0, max: 0 });
    expect(row("upperhand", hawlucha, target, field(), sv)).toMatchObject({ min: 0, max: 0 });
    expect(row("upperhand", hawlucha, target, field({ shield: false }), sv)).toMatchObject({ min: 78, max: 92 });
    // A stopped multi-hit move needs no hit count; one that is not stopped still asks.
    const greninja = build("greninja", "torrent", sv);
    expect(row("watershuriken", greninja, target, field(), sv)).toMatchObject({ kind: "calculated", min: 0, max: 0 });
    expect(row("watershuriken", greninja, target, field({ shield: false }), sv).kind).toBe("needs-context");
    expect(row("watershuriken", greninja, build("weezing", "neutralizinggas", sv), field(), sv).kind).toBe("needs-context");
  });

  it("stops a Z-Move or Max Move only when Gale Wings gives it priority", async () => {
    const swsh = await loadBattleRuntime("sword_shield");
    const swshTarget = build("incineroar", "blaze", swsh);
    const dynamax = { mechanic: "dynamax" } as Partial<BattleBuild>;
    expect(row("bravebird", build("talonflame", "galewings", swsh, dynamax), swshTarget, field(), swsh)).toMatchObject({ effectiveName: "Max Airstream", min: 0, max: 0, description: blocked("Queenly Majesty", "Max Airstream", 1) });
    expect(row("bravebird", build("talonflame", "galewings", swsh, dynamax), swshTarget, field({ protect: true }), swsh)).toMatchObject({ min: 0, max: 0 });
    expect(row("bulletpunch", build("lucario", "innerfocus", swsh, dynamax), swshTarget, field(), swsh)).toMatchObject({ effectiveName: "Max Steelspike", min: 30, max: 36 });
    expect(row("bulletpunch", build("lucario", "innerfocus", swsh), swshTarget, field(), swsh)).toMatchObject({ min: 0, max: 0 });
    const usum = await loadBattleRuntime("ultra_sun_ultra_moon");
    const usumTarget = build("incineroar", "blaze", usum);
    const useZ = { bravebird: { useZ: true }, bulletpunch: { useZ: true } };
    const talonflame = build("talonflame", "galewings", usum, { itemId: "flyiniumz" });
    expect(row("bravebird", talonflame, usumTarget, field(), usum, useZ)).toMatchObject({ effectiveName: "Supersonic Skystrike", min: 0, max: 0, description: blocked("Queenly Majesty or Dazzling", "Supersonic Skystrike", 1) });
    expect(row("bravebird", talonflame, usumTarget, field({ protect: true }), usum, useZ)).toMatchObject({ min: 0, max: 0 });
    expect(row("bravebird", talonflame, usumTarget, field({ protect: true, shield: false }), usum, useZ)).toMatchObject({ min: 25, max: 29 });
    const scizor = build("scizor", "technician", usum, { itemId: "steeliumz" });
    expect(row("bulletpunch", scizor, usumTarget, field(), usum, useZ)).toMatchObject({ effectiveName: "Corkscrew Crash", min: 39, max: 46 });
    expect(row("bulletpunch", { ...scizor, itemId: "" }, usumTarget, field(), usum)).toMatchObject({ min: 0, max: 0 });
    expect(row("quickattack", build("pinsir", "moldbreaker", usum), usumTarget, field(), usum)).toMatchObject({ min: 21, max: 25 });
  });

  it("has a toggle on each side naming the game's abilities, disabled in Singles", async () => {
    const render = (gameType: Conditions["gameType"], runtime?: BattleRuntime) => renderToStaticMarkup(createElement(BattleConditions, { value: field({ gameType }), issues: [], onChange: () => undefined, runtime }));
    const doubles = render("Doubles");
    for (const side of ["attackerSide", "defenderSide"]) {
      const input = doubles.match(new RegExp(`<input\\b[^>]*id="[^"]*-${side}-priorityShield"[^>]*>`))?.[0];
      expect(input).toBeDefined();
      expect(input).not.toContain('disabled=""');
    }
    expect(doubles).toContain(`Partner has ${CHAMPIONS}<`);
    expect(render("Singles").match(/<input\b[^>]*id="[^"]*-defenderSide-priorityShield"[^>]*>/)?.[0]).toContain('disabled=""');
    for (const [game, names] of [["scarlet_violet", SV], ["sword_shield", "Queenly Majesty"], ["ultra_sun_ultra_moon", "Queenly Majesty or Dazzling"]] as const) {
      expect(render("Doubles", await loadBattleRuntime(game)), game).toContain(`Partner has ${names}<`);
    }
    const on = (gameType: Conditions["gameType"]) => ({ ...field({ gameType }), defenderSide: { ...createConditions().defenderSide, priorityShield: true } satisfies SideConditions });
    expect(describeConditions(on("Doubles"))).toContain("1 toggles on");
    expect(describeConditions(on("Singles"))).toContain("0 toggles on");
  });
});

describe("the partner shield acts before Protect and before other questions", () => {
  // Real pinned-Showdown Doubles turns from the review (gaps/review/partner-shields/verify f1.ts, f2.ts):
  // each logs |cant|p2b: <holder>|ability: <X>|<Move> and deals no damage.
  it("stops the move before Rivalry's genders or a Stellar first use are asked", async () => {
    const luxray = build("luxray", "rivalry");
    expect(row("quickattack", luxray, incineroar, field())).toMatchObject({ kind: "calculated", min: 0, max: 0, description: blocked(CHAMPIONS, "Quick Attack", 1) });
    expect(row("quickattack", luxray, incineroar, field({ shield: false })).kind).toBe("needs-context");
    const sv = await loadBattleRuntime("scarlet_violet");
    const target = build("incineroar", "blaze", sv);
    const stellar = { mechanic: "tera", configuration: { teraType: "Stellar" } } as Partial<BattleBuild>;
    expect(row("extremespeed", build("dragonite", "innerfocus", sv, stellar), target, field(), sv)).toMatchObject({ kind: "calculated", min: 0, max: 0, description: blocked(SV, "Extreme Speed", 2) });
    expect(row("bravebird", build("talonflame", "galewings", sv, stellar), target, field(), sv)).toMatchObject({ kind: "calculated", min: 0, max: 0, description: blocked(SV, "Brave Bird", 1) });
    // Asked only when the move gets through: without the partner, or past it with Mold Breaker.
    expect(row("extremespeed", build("dragonite", "innerfocus", sv, stellar), target, field({ shield: false }), sv).kind).toBe("needs-context");
    const haxorus = row("firstimpression", build("haxorus", "moldbreaker", sv, stellar), target, field(), sv);
    expect(haxorus).toMatchObject({ kind: "needs-context", reason: "Stellar Tera needs explicit first-use context for this move's type; its once-per-type boost is not assumed." });
  });

  it("names the partner, not Protect or Max Guard, for a priority move into a Protecting target", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const target = build("incineroar", "blaze", sv);
    expect(row("extremespeed", build("dragonite", "innerfocus", sv), target, field({ protect: true }), sv)).toMatchObject({ min: 0, max: 0, description: blocked(SV, "Extreme Speed", 2) });
    expect(row("suckerpunch", build("kingambit", "defiant", sv), target, field({ protect: true }), sv)).toMatchObject({ min: 0, max: 0, description: blocked(SV, "Sucker Punch", 1) });
    const swsh = await loadBattleRuntime("sword_shield");
    const maxGuard = build("incineroar", "blaze", swsh, { mechanic: "dynamax" } as Partial<BattleBuild>);
    expect(row("bulletpunch", build("lucario", "innerfocus", swsh), maxGuard, field({ protect: true }), swsh)).toMatchObject({ kind: "calculated", min: 0, max: 0, description: blocked("Queenly Majesty", "Bullet Punch", 1) });
    expect(row("bulletpunch", build("lucario", "innerfocus", swsh), maxGuard, field({ protect: true, shield: false }), swsh).kind).toBe("unsupported");
  });
});

describe("the partner shield help", () => {
  it("names only the priority raisers the game has", async () => {
    const help = (runtime: BattleRuntime) => {
      const html = renderToStaticMarkup(createElement(BattleConditions, { value: field(), issues: [], onChange: () => undefined, runtime }));
      return /stops the other side’s priority moves aimed at either of them([^;]*);/.exec(html)?.[1];
    };
    expect(help(championsRuntime)).toBe(", including priority from Gale Wings or Grassy Glide on Grassy Terrain");
    expect(help(await loadBattleRuntime("scarlet_violet"))).toBe(", including priority from Gale Wings, Triage or Grassy Glide on Grassy Terrain");
    expect(help(await loadBattleRuntime("ultra_sun_ultra_moon"))).toBe(", including priority from Gale Wings or Triage");
  });
});

describe("the partner shield, second review", () => {
  // Real pinned-Showdown Doubles turns from gaps/review2/shield-order-crowned (b1.ts, s1.ts).
  it("never stops Bide, which targets its user", async () => {
    const usum = await loadBattleRuntime("ultra_sun_ultra_moon");
    expect(row("bide", build("chansey", "naturalcure", usum), build("machamp", "noguard", usum), field(), usum)).toMatchObject({ kind: "needs-context", reason: "Needs the damage stored over earlier turns." });
  });

  it("gives a Neutralizing Gas target's attacker no Gale Wings priority, so no shield note", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const braveBird = row("bravebird", build("talonflame", "galewings", sv), build("weezinggalar", "neutralizinggas", sv), field(), sv);
    expect(braveBird).toMatchObject({ min: 51, max: 60 });
    expect(braveBird.assumptions.join(" ")).not.toContain("partner's");
  });
});
