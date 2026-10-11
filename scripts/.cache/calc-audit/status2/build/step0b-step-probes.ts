// Step 0b's turn-step probes (status2 T2M §2.3–§2.5, T2P §9.4): each scenario on pinned Showdown c23d2e94 (design/guards-sim.ts)
// beside the app's turn step (uses-to-ko.ts turnStep through prepareUses with the UsesEnv field set, as the 2v2 kernel calls it).
// Prints Showdown's HP distributions and the app's outcomes. Run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/status2/build/step0b-step-probes.ts [ids...]
import { enumerate, monAt, type Game, type Mon, type Probe } from "../design/guards-sim";
import { calculateTurnMove, usesHelpers } from "@/app/lib/battle/calculate";
import { hitStep, startHits, type HitLoopInput } from "@/app/lib/battle/hit-loop";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, createSide, defaultAbilityActive, getBuildStats } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, BattleGame, MoveContext } from "@/app/lib/battle/types";
import { createTurnSearch, prepareUses, type CalcTrace, type TurnStepPart, type UsesEnv } from "@/app/lib/battle/uses-to-ko";

const GAMES: Record<Game, BattleGame> = { sv: "scarlet_violet", swsh: "sword_shield", usum: "ultra_sun_ultra_moon", champions: "champions" };
const id = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");
const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
let laxSpeed = 1;
const lax = (name: string, extra: Partial<Mon> = {}): Mon => ({ species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], name, evs: { spe: 8 * (laxSpeed++ % 20) }, ...extra });

function appBuild(m: Mon, runtime: BattleRuntime, extra: Partial<BattleBuild> = {}): BattleBuild {
  const base = createBuild(id(m.species), runtime);
  const abilityId = id(m.ability ?? "");
  const shared = { nature: m.nature ?? "Serious", abilityId, abilityActive: defaultAbilityActive(abilityId), itemId: id(m.item ?? ""), currentHP: null, status: "" as const };
  const trained = base.game === "champions" ? { ...base, ...shared, points: { ...ZERO, ...m.evs } }
    : { ...base, ...shared, native: { level: m.level ?? 50, evs: { ...ZERO, ...m.evs }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31, ...m.ivs } } };
  return { ...trained, ...extra } as BattleBuild;
}

/** The app's turn step: the row, then the step's outcomes (attacker HP, target HP distribution, reported fields). */
export async function appStep(game: Game, attackerMon: Mon, defenderMon: Mon, moveName: string, opts: {
  attacker?: Partial<BattleBuild>; defender?: Partial<BattleBuild>; field?: (c: BattleConditions) => BattleConditions; context?: MoveContext;
  env?: UsesEnv; attackerHP?: number; defenderHP?: number; part?: TurnStepPart; follow?: boolean; mode?: "all" | "lowest" | "highest";
} = {}) {
  const runtime = await loadBattleRuntime(GAMES[game]);
  const attacker = appBuild(attackerMon, runtime, { ...(opts.attackerHP !== undefined ? { currentHP: opts.attackerHP } : {}), ...opts.attacker });
  const defender = appBuild(defenderMon, runtime, { ...(opts.defenderHP !== undefined ? { currentHP: opts.defenderHP } : {}), ...opts.defender });
  const conditions = (opts.field ?? ((x) => ({ ...x, multipleTargets: false })))({ ...createConditions(), attackerSide: createSide(), defenderSide: createSide() });
  const move = runtime.movesById.get(id(moveName))!;
  const trace: CalcTrace = {};
  const row = calculateTurnMove(move, attacker, defender, conditions, opts.context, runtime, trace);
  const m = prepareUses(attacker, defender, conditions, runtime, usesHelpers(runtime), { turn: true, ...opts.env });
  const search = createTurnSearch(m, {
    move, row, trace, context: opts.context,
    rerun: (next) => { const nextTrace: CalcTrace = {}; return { row: calculateTurnMove(move, next.attacker, next.defender, next.conditions, next.context, runtime, nextTrace), trace: nextTrace }; },
  }, opts.follow === false ? false : undefined);
  const follow = opts.follow === false ? false : search.needsAttackerHP();
  const attHP = opts.attackerHP ?? getBuildStats(attacker, runtime)!.hp;
  const defHP = opts.defenderHP ?? getBuildStats(defender, runtime)!.hp;
  const step = search.turnStep([{ attackerHP: attHP, target: new Map([[defHP, 1]]) }], opts.mode ?? "all", follow, opts.part);
  return { row, step, runtime, attacker, defender };
}

function show(title: string, r: Awaited<ReturnType<typeof appStep>>) {
  if ("failed" in r.step) { console.log(`  app ${title}: failed: ${r.step.failed}`); return; }
  for (const o of r.step.outcomes) {
    const dist = [...o.dist].sort((a, b) => a[0] - b[0]).map(([hp, p]) => `${hp}:${+p.toFixed(6)}`).join(" ");
    const extra = Object.fromEntries(Object.entries(o).filter(([k]) => ["rises", "used", "dealt", "starf", "stopAt", "reactions", "lastHit"].includes(k)));
    console.log(`  app ${title}: att ${o.attacker.hp}${o.attackerFainted ? " fainted" : ""} item ${o.attacker.itemId || "-"} | def [${dist}] knocked ${o.knocked} landed ${o.landed} def ${JSON.stringify(o.target.boosts)} item ${o.target.itemId || "-"} ${JSON.stringify(extra)}`);
  }
}
function sd(title: string, probe: Probe) {
  for (const rolls of ["lowest", "highest", "all"] as const) {
    const r = enumerate({ ...probe, rolls, maxRuns: 20000 });
    console.log(`  showdown ${title} (${rolls}, ${r.runs} runs): ${r.afterMoves[0] ? [...r.afterMoves[0]].map(([k, m]) => `${k} [${[...m].sort((a, b) => a[0] - b[0]).map(([hp, p]) => `${hp}:${+p.toFixed(6)}`).join(" ")}]`).join(" | ") : ""}`);
  }
}

const want = new Set(process.argv.slice(2));
const on = (key: string) => !want.size || want.has(key);

(async () => {
  if (on("O1")) {
    console.log("O1 sv: Dragon Claw into a 30 HP Focus Band Snorlax");
    const chomp: Mon = { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], evs: { atk: 252, spe: 252 } };
    sd("O1", { game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { b.p2.active[0].sethp(30); },
      mons: [chomp, lax("A"), { ...lax("Band"), item: "Focus Band" }, lax("B")] });
    show("O1", await appStep("sv", chomp, { ...lax("Band"), item: "Focus Band" }, "Dragon Claw", { defenderHP: 30, env: { focusBand: true } }));
  }
  if (on("O1b")) {
    console.log("O1b sv: Dual Wingbeat into a 20 HP Focus Band Snorlax");
    const nite: Mon = { species: "Dragonite", ability: "Inner Focus", moves: ["Dual Wingbeat"], evs: { atk: 252, spe: 252 } };
    sd("O1b", { game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { b.p2.active[0].sethp(20); },
      mons: [nite, lax("A"), { ...lax("Band"), item: "Focus Band" }, lax("B")] });
    show("O1b", await appStep("sv", nite, { ...lax("Band"), item: "Focus Band" }, "Dual Wingbeat", { defenderHP: 20, env: { focusBand: true } }));
  }
  if (on("BE01")) {
    console.log("BE01 sv: Dual Wingbeat into a Ganlon Berry Snorlax at 70 HP (the stop at hit 1)");
    const nite: Mon = { species: "Dragonite", ability: "Inner Focus", moves: ["Dual Wingbeat"], evs: { spe: 252 } };
    sd("BE01", { game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { b.p2.active[0].sethp(70); },
      mons: [nite, lax("A"), { ...lax("Gan"), item: "Ganlon Berry" }, lax("B")] });
    show("BE01", await appStep("sv", nite, { ...lax("Gan"), item: "Ganlon Berry" }, "Dual Wingbeat", { defenderHP: 70, env: { betweenHits: true } }));
    // The continuation: the Berry eaten (+1 Defense), hit 2 from part { skip: 1 }.
    show("BE01 continuation", await appStep("sv", nite, { ...lax("Gan") }, "Dual Wingbeat", { defenderHP: 55, defender: { boosts: { atk: 0, def: 1, spa: 0, spd: 0, spe: 0 } }, part: { caseIndex: 0, skip: 1 }, mode: "lowest" }));
  }
  if (on("BE01b")) {
    console.log("BE01b sv: Dual Wingbeat into a Ganlon Berry Snorlax at 100 HP: stopped at hit 1, then the continuation at +1 Defense");
    const nite: Mon = { species: "Dragonite", ability: "Inner Focus", moves: ["Dual Wingbeat"], evs: { spe: 252 } };
    sd("BE01b", { game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { b.p2.active[0].sethp(100); },
      mons: [nite, lax("A"), { ...lax("Gan"), item: "Ganlon Berry" }, lax("B")] });
    const first = await appStep("sv", nite, { ...lax("Gan"), item: "Ganlon Berry" }, "Dual Wingbeat", { defenderHP: 100, env: { betweenHits: true } });
    show("BE01b stop", first);
    if (!("failed" in first.step)) {
      const total = new Map<number, number>();
      for (const o of first.step.outcomes) {
        for (const [hp, p] of o.dist) {
          if (!o.stopAt) { total.set(hp, (total.get(hp) ?? 0) + p); continue; }
          const next = await appStep("sv", nite, { ...lax("Gan") }, "Dual Wingbeat", { defenderHP: hp, defender: { boosts: { atk: 0, def: 1, spa: 0, spd: 0, spe: 0 } }, part: { caseIndex: 0, skip: 1 } });
          if ("failed" in next.step) { console.log("  continuation failed", next.step.failed); continue; }
          for (const c of next.step.outcomes) for (const [h2, p2] of c.dist) total.set(h2, (total.get(h2) ?? 0) + p * p2);
        }
      }
      console.log(`  app BE01b combined: [${[...total].sort((a, b) => a[0] - b[0]).map(([hp, p]) => `${hp}:${+p.toFixed(6)}`).join(" ")}]`);
    }
  }
  if (on("SP01b")) {
    console.log("SP01b sv: Dual Wingbeat into a full-HP Multiscale Dragonite behind a 1 HP Substitute: hit 1 breaks it, hit 2 reads Multiscale (fresh)");
    const wing: Mon = { species: "Dragonite", ability: "Inner Focus", moves: ["Dual Wingbeat"], evs: { spe: 252 }, name: "Wing" };
    const scale: Mon = { species: "Dragonite", ability: "Multiscale", name: "Scale" };
    sd("SP01b", { game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]], mons: [wing, lax("A"), scale, lax("B")],
      setup: (b) => { const p = b.p2.active[0]; p.addVolatile("substitute"); p.volatiles.substitute.hp = 1; } });
    show("SP01b fresh", await appStep("sv", wing, scale, "Dual Wingbeat", { part: { caseIndex: 0, skip: 1, fresh: true } }));
  }
  if (on("AF01")) {
    console.log("AF01 sv: hitStep: Garchomp at 110/183 with Sitrus knocks out an Aftermath Drifblim");
    const loop: HitLoopInput = { hp: 110, maxHP: 183, baseMaxHP: 183, attackerAbility: "roughskin", attackerItem: "sitrusberry", targetAbility: "aftermath", targetItem: "",
      attackerShielded: false, targetShielded: false, targetDynamaxed: false, contact: true, category: "Physical", drain: null, takesBerry: false, targetGulping: false, generation: 9,
      koRetaliation: { aftermath: true, innardsOut: 0 } };
    const out = hitStep(loop, startHits(loop), 1, true);
    console.log(`  app AF01: hp ${out.state.hp}, losses ${JSON.stringify(out.losses)}, ate ${out.ate}`);
    sd("AF01", { game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { b.p2.active[0].sethp(1); b.p1.active[0].sethp(110); },
      mons: [{ species: "Garchomp", ability: "Rough Skin", item: "Sitrus Berry", moves: ["Dragon Claw"], evs: { spe: 252 }, name: "Chomp" }, lax("A"), { species: "Drifblim", ability: "Aftermath", name: "Blim" }, lax("B")] });
  }
  if (on("AF03")) {
    console.log("AF03 sv: Flare Blitz knocks out a 30 HP Aftermath Electrode: Aftermath before the recoil");
    const arc: Mon = { species: "Arcanine", ability: "Intimidate", moves: ["Flare Blitz"], evs: { spe: 252 }, name: "Arc" };
    sd("AF03", { game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { b.p2.active[0].sethp(30); },
      mons: [arc, lax("A"), { species: "Electrode", ability: "Aftermath", name: "Bolt" }, lax("B")] });
    show("AF03", await appStep("sv", arc, { species: "Electrode", ability: "Aftermath", name: "Bolt" }, "Flare Blitz", { defenderHP: 30, env: { koRetaliation: { aftermath: true, innardsOut: 0 } } }));
  }
  if (on("IO02")) {
    console.log("IO02 swsh: Dual Wingbeat knocks out a 45 HP Pyukumuku: Innards Out deals 45");
    const nite: Mon = { species: "Dragonite", ability: "Inner Focus", moves: ["Dual Wingbeat"], evs: { spe: 252 }, name: "Nite" };
    sd("IO02", { game: "swsh", turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { b.p2.active[0].sethp(45); },
      mons: [nite, lax("A"), { species: "Pyukumuku", ability: "Innards Out", name: "Pyuk" }, lax("B")] });
    show("IO02", await appStep("swsh", nite, { species: "Pyukumuku", ability: "Innards Out", name: "Pyuk" }, "Dual Wingbeat", { defenderHP: 45, env: { koRetaliation: { aftermath: false, innardsOut: 45 } } }));
  }
  if (on("UN03")) {
    console.log("UN03 sv: a 100 HP Sitrus Arcanine's Flare Blitz knocks out a 5 HP Unnerve Tyranitar (Rocky Helmet)");
    const arc: Mon = { species: "Arcanine", ability: "Intimidate", item: "Sitrus Berry", moves: ["Flare Blitz"], evs: { spe: 252 }, name: "Arc" };
    const tar: Mon = { species: "Tyranitar", ability: "Unnerve", item: "Rocky Helmet", name: "Tar" };
    sd("UN03", { game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { b.p2.active[0].sethp(5); b.p1.active[0].sethp(100); }, mons: [arc, lax("A"), tar, lax("B")] });
    show("UN03", await appStep("sv", arc, tar, "Flare Blitz", { attackerHP: 100, defenderHP: 5, env: { unnerve: { foes: true, target: false, attacker: false, endsOnKO: true } } }));
  }
  if (on("FV01")) {
    console.log("FV01 sv: Snarl into Venusaur beside a Flower Veil Comfey (no drop) and into Comfey (drop)");
    const roar: Mon = { species: "Incineroar", ability: "Blaze", moves: ["Snarl"], evs: { spe: 252 }, name: "Roar" };
    sd("FV01", { game: "sv", turns: [["move 1, move 1", "move 1, move 1"]], mons: [roar, lax("A"), { species: "Comfey", ability: "Flower Veil", name: "Comf" }, { species: "Venusaur", ability: "Overgrow", name: "Saur" }],
      inspect: (b) => `Comf ${JSON.stringify(monAt(b, "p2a").boosts)} Saur ${JSON.stringify(monAt(b, "p2b").boosts)}` });
    show("FV01 Venusaur", await appStep("sv", roar, { species: "Venusaur", ability: "Overgrow" }, "Snarl", { field: (c) => ({ ...c, multipleTargets: true }), follow: false, env: { veil: "flowerveil", spreadUser: true } }));
    show("FV01 Comfey", await appStep("sv", roar, { species: "Comfey", ability: "Flower Veil" }, "Snarl", { field: (c) => ({ ...c, multipleTargets: true }), follow: false, env: { spreadUser: true } }));
  }
  if (on("SE02")) {
    console.log("SE02 champions: Kingambit's Breaking Swipe into a Gooey Goodra: the reaction listed (spreadUser)");
    const king: Mon = { species: "Kingambit", ability: "Defiant", moves: ["Breaking Swipe"], evs: { spe: 32 }, name: "King" };
    show("SE02 Goodra", await appStep("champions", king, { species: "Goodra", ability: "Gooey" }, "Breaking Swipe", { field: (c) => ({ ...c, multipleTargets: true }), follow: false, env: { spreadUser: true } }));
    show("SE02 Goodra (no spreadUser)", await appStep("champions", king, { species: "Goodra", ability: "Gooey" }, "Breaking Swipe", { field: (c) => ({ ...c, multipleTargets: true }), follow: false }));
  }
  if (on("SP01")) {
    console.log("SP01 sv: Dual Wingbeat's second hit after a Substitute broke, into a full-HP Multiscale Dragonite (fresh)");
    const wing: Mon = { species: "Dragonite", ability: "Inner Focus", moves: ["Dual Wingbeat"], evs: { spe: 252 }, name: "Wing" };
    const scale: Mon = { species: "Dragonite", ability: "Multiscale", name: "Scale" };
    sd("SP01c", { game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]], mons: [wing, lax("A"), scale, lax("B")] });
    show("SP01 fresh", await appStep("sv", wing, scale, "Dual Wingbeat", { part: { caseIndex: 0, skip: 1, fresh: true }, mode: "lowest" }));
    show("SP01 not fresh", await appStep("sv", wing, scale, "Dual Wingbeat", { part: { caseIndex: 0, skip: 1 }, mode: "lowest" }));
    show("SP01 whole", await appStep("sv", wing, scale, "Dual Wingbeat", { mode: "lowest" }));
  }
  if (on("LAST")) {
    console.log("LAST sv: report.lastHit of Dual Wingbeat into Snorlax (lowest rolls)");
    const nite: Mon = { species: "Dragonite", ability: "Inner Focus", moves: ["Dual Wingbeat"], evs: { spe: 252 }, name: "Nite" };
    sd("LAST", { game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]], mons: [nite, lax("A"), lax("Target"), lax("B")], lines: /-damage\|p2a/ });
    show("LAST", await appStep("sv", nite, lax("Target"), "Dual Wingbeat", { mode: "lowest", env: { report: { lastHit: true, dealt: true } } }));
    show("LAST highest", await appStep("sv", nite, lax("Target"), "Dual Wingbeat", { mode: "highest", env: { report: { lastHit: true, dealt: true } } }));
  }
})().catch((error) => { console.error(error); process.exit(1); });
