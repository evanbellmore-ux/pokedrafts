// T1 fuzz: random legal Champions battles between teams that use the status2 states Training now carries (Stockpile,
// Power Trick, the splits, Minimize, Gastro Acid, Octolock, Attract, Psychic Noise, Glaive Rush, No Retreat, Mean Look,
// Berserk with a Sheer Force foe, Ripen, Teatime, Recycle, Fling, Protean, Soak, Forest's Curse, Reflect Type, Skill
// Swap, Imposter, Opportunist). At each of the AI's (p2) turn decisions the belief battle on the truth world (perfect
// information) is compared field by field with the real battle, the bridge is run on a few cells (no engine issue may
// come back) and, with no hidden counter in play, both battles play the same choices on the same seed: the logs must match.
//   npx --no-install tsx scripts/.cache/calc-audit/status2/build/t1-fuzz.ts [battles=40] [seed=1]
import { calculateDoublesOutcomes } from "@/app/lib/battle/doubles-turn";
import { championsRuntime as runtime } from "@/app/lib/battle/runtime";
import type { CellActions } from "@/app/(app)/training/model/ai-view";
import { buildBeliefBattle } from "@/app/(app)/training/sim/belief-battle";
import { bridgeTurn } from "@/app/(app)/training/sim/bridge";
import { toShowdownTeam } from "@/app/(app)/training/sim/showdown-set";
import { PRNG, State, type ClonedBattle, type Pokemon } from "@/app/(app)/training/sim/sim";
import { memberFromSet, seatBattle } from "../../../../../tests/unit/training-sim-fixtures";

const sp = (hp = 0, atk = 0, def = 0, spa = 0, spd = 0, spe = 0) => ({ hp, atk, def, spa, spd, spe });
const IV = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
type Set = { name: string; species: string; item: string; ability: string; moves: string[]; nature: string; evs: ReturnType<typeof sp>; ivs: typeof IV; level: number; gender: string };
const set = (species: string, item: string, ability: string, moves: string[], gender = "M", evs = sp(20, 12, 10, 12, 10, 2)): Set =>
  ({ name: species, species, item, ability, moves, nature: "Serious", evs, ivs: IV, level: 50, gender });
const TEAMS: Set[][] = [
  [set("Swalot", "Sitrus Berry", "Gluttony", ["Stockpile", "Swallow", "Spit Up", "Gastro Acid"]), set("Medicham", "Focus Sash", "Pure Power", ["Power Trick", "Close Combat", "Zen Headbutt", "Protect"]),
    set("Chandelure", "Occa Berry", "Flash Fire", ["Minimize", "Power Split", "Shadow Ball", "Heat Wave"], "F"), set("Grapploct", "Leftovers", "Limber", ["Octolock", "Soak", "Drain Punch", "Protect"]),
    set("Espeon", "Life Orb", "Synchronize", ["Psychic Noise", "Attract", "Skill Swap", "Protect"], "F"), set("Ditto", "Choice Scarf", "Imposter", ["Transform"], "N")],
  [set("Baxcalibur", "Sitrus Berry", "Thermal Exchange", ["Glaive Rush", "Icicle Crash", "Protect", "Earthquake"]), set("Falinks", "Leftovers", "Defiant", ["No Retreat", "Close Combat", "Protect", "Rock Slide"], "N"),
    set("Drampa", "Sitrus Berry", "Berserk", ["Dragon Pulse", "Hyper Voice", "Protect", "Flamethrower"]), set("Appletun", "Occa Berry", "Ripen", ["Apple Acid", "Draco Meteor", "Protect", "Recycle"]),
    set("Polteageist", "Lum Berry", "Weak Armor", ["Teatime", "Shadow Ball", "Protect", "Recycle"]), set("Conkeldurr", "Air Balloon", "Sheer Force", ["Rock Slide", "Drain Punch", "Protect", "Ice Punch"])],
  [set("Greninja", "Focus Sash", "Protean", ["Ice Beam", "Dark Pulse", "Protect", "Gunk Shot"]), set("Trevenant", "Sitrus Berry", "Harvest", ["Forest's Curse", "Wood Hammer", "Protect", "Shadow Claw"]),
    set("Gengar", "Leftovers", "Cursed Body", ["Reflect Type", "Shadow Ball", "Protect", "Sludge Bomb"]), set("Espathra", "Leftovers", "Opportunist", ["Lumina Crash", "Protect", "Dazzling Gleam", "Calm Mind"], "F"),
    set("Alakazam", "Focus Sash", "Inner Focus", ["Speed Swap", "Guard Split", "Psychic", "Protect"]), set("Absol", "Normal Gem", "Super Luck", ["Mean Look", "Body Slam", "Sucker Punch", "Protect"])],
  [set("Clefable", "Sitrus Berry", "Magic Guard", ["Fling", "Moonblast", "Protect", "Follow Me"], "F"), set("Garbodor", "Sitrus Berry", "Aftermath", ["Recycle", "Gunk Shot", "Protect", "Stockpile"]),
    set("Incineroar", "Sitrus Berry", "Intimidate", ["Fake Out", "Flare Blitz", "Parting Shot", "Protect"]), set("Kingambit", "Black Glasses", "Defiant", ["Kowtow Cleave", "Sucker Punch", "Protect", "Swords Dance"]),
    set("Rotom-Wash", "Leftovers", "Levitate", ["Hydro Pump", "Thunderbolt", "Will-O-Wisp", "Protect"], "N"), set("Garchomp", "Life Orb", "Rough Skin", ["Earthquake", "Dragon Claw", "Rock Slide", "Protect"])],
];
const team = (sets: Set[]) => toShowdownTeam(sets.map((each) => {
  const member = memberFromSet(each as never);
  return { ...member, build: { ...member.build, configuration: { ...member.build.configuration, gender: each.gender as "M" } } };
}), runtime);

const battles = Number(process.argv[2] ?? 40);
const seed0 = Number(process.argv[3] ?? 1);
let lcg = seed0 * 2654435761 >>> 0;
const rand = (n: number) => { lcg = (Math.imul(lcg, 1664525) + 1013904223) >>> 0; return lcg % n; };

type Request = { active?: { moves: { id: string; disabled?: boolean | string; target?: string }[] }[]; forceSwitch?: boolean[]; side: { pokemon: { condition: string; active: boolean }[] }; wait?: boolean; teamPreview?: boolean };
function choiceFor(request: Request | null): string {
  if (!request || request.wait) return "";
  if (request.forceSwitch) {
    const bench = request.side.pokemon.map((each, i) => ({ each, i })).filter(({ each }) => !each.active && !each.condition.endsWith(" fnt")).map(({ i }) => i + 1);
    const used = new Set<number>();
    return request.forceSwitch.map((flag) => {
      if (!flag) return "pass";
      const options = bench.filter((i) => !used.has(i));
      if (!options.length) return "pass";
      const pick = options[rand(options.length)]; used.add(pick); return `switch ${pick}`;
    }).join(", ");
  }
  return (request.active ?? []).map((active, position) => {
    if (request.side.pokemon[position]?.condition.endsWith(" fnt")) return "pass";
    const moves = active.moves.map((move, i) => ({ move, i })).filter(({ move }) => !move.disabled);
    if (!moves.length) return "move 1";
    const { move, i } = moves[rand(moves.length)];
    const needs = ["normal", "any", "adjacentFoe", "adjacentAlly", "adjacentAllyOrSelf"].includes(move.target ?? "");
    const target = move.target === "adjacentAlly" ? (position === 0 ? -2 : -1) : move.target === "adjacentAllyOrSelf" ? -(position + 1) : 1 + rand(2);
    return needs ? `move ${i + 1} ${target}` : `move ${i + 1}`;
  }).join(", ");
}

const HIDDEN = new Set(["confusion", "lockedmove", "partiallytrapped", "twoturnmove", "substitute", "yawn", "encore", "taunt", "disable", "slowstart", "throatchop", "uproar"]);
const VOLATILES = ["stockpile", "powertrick", "powershift", "minimize", "gastroacid", "attract", "octolock", "healblock", "glaiverush", "trapped", "noretreat", "focusenergy"];
const stats = { decisions: 0, compared: 0, mismatches: 0, logsClean: 0, logsSame: 0, bridged: 0, engine: 0, issues: 0, notEstimated: 0, reasons: {} as Record<string, number>, seen: {} as Record<string, number> };
const notes: string[] = [];
let current: { index: number; log: () => string[] } | null = null;
const printed = new Set<number>();
const note = (text: string) => {
  stats.mismatches++; if (notes.length < 40) notes.push(text);
  if (current && process.env.LOG === String(current.index) && !printed.has(current.index)) { printed.add(current.index); console.log("LOG", text, JSON.stringify(current.log())); }
};

function compare(where: string, real: Pokemon, belief: Pokemon) {
  stats.compared++;
  const r = real as unknown as Record<string, unknown>, b = belief as unknown as Record<string, unknown>;
  const same = (what: string, x: unknown, y: unknown) => { if (JSON.stringify(x) !== JSON.stringify(y)) note(`${where} ${real.name} ${what}: real ${JSON.stringify(x)} belief ${JSON.stringify(y)}`); };
  same("species", real.species.id, belief.species.id);
  same("transformed", real.transformed, belief.transformed);
  same("ability", real.ability, belief.ability);
  same("storedStats", real.storedStats, belief.storedStats);
  same("types", real.types, belief.types);
  same("addedType", r.addedType, b.addedType);
  same("boosts", real.boosts, belief.boosts);
  same("lastItem", real.lastItem, belief.lastItem);
  same("weighthg", r.weighthg, b.weighthg);
  for (const id of VOLATILES) {
    const x = real.volatiles[id] as unknown as Record<string, unknown> | undefined, y = belief.volatiles[id] as unknown as Record<string, unknown> | undefined;
    if (x) stats.seen[id] = (stats.seen[id] ?? 0) + 1;
    same(`volatile ${id}`, !!x, !!y);
    if (!x || !y) continue;
    if (id === "healblock") same("healblock duration", x.duration, y.duration);
    if (id === "stockpile") same("stockpile", [x.layers, x.def, x.spd], [y.layers, y.def, y.spd]);
    if (id === "attract" || id === "octolock") same(`${id} source`, (x.source as Pokemon | undefined)?.name, (y.source as Pokemon | undefined)?.name);
  }
  const ra = real.abilityState as unknown as Record<string, unknown>, ba = belief.abilityState as unknown as Record<string, unknown>;
  // Under Gastro Acid the ability's handlers do not run: its state is not read (not compared).
  const suppressed = !!real.volatiles.gastroacid;
  for (const flag of suppressed ? [] : ["checkedBerserk", "checkedAngerShell"]) {
    if (ra[flag] === false) stats.seen[flag] = (stats.seen[flag] ?? 0) + 1;
    same(flag, ra[flag] === false, ba[flag] === false);
  }
  if (ra.berryWeaken === true) stats.seen.berryWeaken = (stats.seen.berryWeaken ?? 0) + 1;
  if (!suppressed) same("berryWeaken", ra.berryWeaken === true, ba.berryWeaken === true);
  if (real.ability === "opportunist" && !suppressed) { if (ra.boosts) stats.seen.copy = (stats.seen.copy ?? 0) + 1; same("opportunist boosts", ra.boosts ?? null, ba.boosts ?? null); }
  if (real.ability === "protean" || real.ability === "libero") same("protean flag", !!ra[real.ability], !!ba[real.ability]);
  if (real.transformed) stats.seen.transformed = (stats.seen.transformed ?? 0) + 1;
  if (JSON.stringify(real.types) !== JSON.stringify(real.species.types)) stats.seen.types = (stats.seen.types ?? 0) + 1;
  if (r.addedType) stats.seen.addedType = (stats.seen.addedType ?? 0) + 1;
  if (real.lastItem) stats.seen.lastItem = (stats.seen.lastItem ?? 0) + 1;
}

function playOnce(json: string, seed: string, p1: string, p2: string): { lines: string[]; ok: boolean } {
  const battle = State.deserializeBattle(json) as ClonedBattle;
  battle.restart(() => {});
  battle.prng = new PRNG(seed as never);
  const before = battle.log.length;
  const ok = battle.choose("p1", p1) && battle.choose("p2", p2);
  return { lines: battle.log.slice(before).filter((line) => !line.startsWith("|t:|")), ok };
}

for (let index = 0; index < battles; index++) {
  const a = rand(TEAMS.length), b = (a + 1 + rand(TEAMS.length - 1)) % TEAMS.length;
  const seat = seatBattle([seed0 + index, 2, 3, 4], { own: team(TEAMS[a]), opponent: team(TEAMS[b]) });
  const order = () => { const picks = [0, 1, 2, 3, 4, 5].sort(() => rand(3) - 1).slice(0, 4).map((i) => i + 1).join(""); return `team ${picks}`; };
  seat.step(order(), order());
  current = { index, log: () => seat.battle.log.filter((l) => l && !l.startsWith("|t:|") && !l.startsWith("|split") && !l.startsWith("|uhtml") && !/\/100[gyr]?( |$|\|)/.test(l)) };
  for (let turn = 0; turn < 30 && !seat.battle.ended; turn++) {
    const r1 = seat.battle.p1.activeRequest as unknown as Request | null, r2 = seat.battle.p2.activeRequest as unknown as Request | null;
    const isTurn = !!r2?.active && !r2.forceSwitch && !r2.wait;
    let c1 = "", c2 = "";
    for (let attempt = 0; attempt < 20; attempt++) {
      c1 = choiceFor(r1); c2 = choiceFor(r2);
      const probe = State.deserializeBattle(JSON.stringify(State.serializeBattle(seat.battle))) as ClonedBattle;
      probe.restart(() => {});
      if ((!c1 || probe.p1.choose(c1)) && (!c2 || probe.p2.choose(c2))) break;
    }
    if (isTurn) {
      stats.decisions++;
      try {
        const inputs = seat.inputs();
        const belief = buildBeliefBattle(inputs, seat.truthWorld(), runtime);
        for (const side of ["p1", "p2"] as const) {
          seat.battle[side].pokemon.forEach((real, i) => {
            const believed = belief.battle[side].pokemon.find((each) => each.name === real.name);
            if (!believed) return note(`#${index} t${seat.battle.turn} ${real.name}: not in the belief battle`);
            if (process.env.DUMP && real.isActive && (real.transformed !== believed.transformed || real.ability !== believed.ability)) console.log("DUMP", index, seat.battle.turn, real.name, real.ability, believed.ability, real.transformed, believed.transformed, real.species.id, believed.species.id, JSON.stringify(seat.battle.log.filter((l) => /Ditto|Skill Swap|transform|Imposter|turn/.test(l)).slice(-30)));
            if (real.isActive && !real.fainted) compare(`#${index} t${seat.battle.turn}`, real, believed);
            else if (real.lastItem !== believed.lastItem) note(`#${index} t${seat.battle.turn} ${real.name} (bench) lastItem: real ${real.lastItem} belief ${believed.lastItem}`);
            void i;
          });
        }
        // The bridge on the real choice's cell when it maps (Protect cells otherwise): no engine issue.
        const publicOf = (key: string) => inputs.public.mons[`${key.startsWith("own:") ? "p1" : "p2"}:${key.slice(key.indexOf(":") + 1)}`] ?? null;
        const quiet: CellActions = { own: { "own-left": { kind: "move", moveId: "protect", target: null }, "own-right": { kind: "move", moveId: "protect", target: null } }, opponent: { "opponent-right": { kind: "move", moveId: "protect", target: null }, "opponent-left": { kind: "move", moveId: "protect", target: null } } };
        const bridged = bridgeTurn(belief.battle, quiet, { runtime, keys: belief.keys, aiSide: "p2", switched: new Set(), publicOf });
        stats.bridged++;
        if (bridged.kind === "engine") {
          stats.engine++;
          const result = calculateDoublesOutcomes(bridged.input);
          if (result.status === "issues") { stats.issues++; note(`#${index} t${seat.battle.turn} engine issues ${JSON.stringify(result.issues)}`); }
          if (result.status === "not-estimated") { stats.notEstimated++; stats.reasons[result.reason] = (stats.reasons[result.reason] ?? 0) + 1; }
        } else for (const reason of bridged.reasons) stats.reasons[`rollout: ${reason.replace(/^[^:]+: /, "")}`] = (stats.reasons[`rollout: ${reason.replace(/^[^:]+: /, "")}`] ?? 0) + 1;
        // One-turn logs with no hidden counter in play.
        const hidden = Object.values(inputs.public.mons).some((mon) => mon.position !== null && !mon.fainted && (mon.status === "slp" || mon.status === "frz" || !!mon.lock || mon.volatiles.some((v) => HIDDEN.has(v.id))));
        if (!hidden && c1 && c2) {
          const seed = `sodium,${(index * 1000 + turn).toString(16).padStart(32, "0")}`;
          const real = playOnce(JSON.stringify(State.serializeBattle(seat.battle)), seed, c1, c2);
          const rebuilt = playOnce(belief.json, seed, c1, c2);
          stats.logsClean++;
          if (real.ok && rebuilt.ok && JSON.stringify(real.lines) === JSON.stringify(rebuilt.lines)) stats.logsSame++;
          else {
            const at = real.lines.findIndex((line, k) => line !== rebuilt.lines[k]);
            note(`#${index} t${seat.battle.turn} log: real ${real.lines[at]} / belief ${rebuilt.lines[at]} (${c1} | ${c2})`);
          }
        }
      } catch (error) { note(`#${index} t${seat.battle.turn} error ${(error as Error).stack?.split("\n").slice(0, 3).join(" ")}`); }
    }
    try { seat.step(c1, c2); } catch (error) { note(`#${index} t${seat.battle.turn} step ${(error as Error).message} (${c1} | ${c2})`); break; }
  }
}
console.log(JSON.stringify(stats, null, 1));
console.log(notes.join("\n"));
