// T2 fuzz: random legal Champions battles between teams that use the states Training passes in wave 1b (the stall counter,
// the recharge, Struggle, Fake Out, charged two-turn moves, Lock-On, Destiny Bond, Taunt, Encore, Disable, Uproar, Future
// Sight, Gravity, Magic Room, terrains, Safeguard, Skill Swap / Mummy / Wandering Spirit (the entry order), Supersweet Syrup,
// Cud Chew, an ally's Leech Seed, Follow Me and Lightning Rod). At each of the AI's (p2) turn decisions the belief battle on
// the truth world is compared with the real battle for those states (durations, sources, flags, the ability states' order),
// and the services' engine worlds for a few of the AI's legal cells go to the engine: no issue may come back.
//   npx --no-install tsx scripts/.cache/calc-audit/status2/build/t2-fuzz.ts [battles=40] [seed=1]
import { calculateDoublesOutcomes } from "@/app/lib/battle/doubles-turn";
import { DOUBLES_SLOTS } from "@/app/lib/battle/doubles-types";
import { championsRuntime as runtime } from "@/app/lib/battle/runtime";
import type { CellActions } from "@/app/(app)/training/model/ai-view";
import { buildBeliefBattle } from "@/app/(app)/training/sim/belief-battle";
import { createTurnServices } from "@/app/(app)/training/sim/services";
import { toShowdownTeam } from "@/app/(app)/training/sim/showdown-set";
import { PRNG, State, type ClonedBattle, type Pokemon } from "@/app/(app)/training/sim/sim";
import { memberFromSet, seatBattle } from "../../../../../tests/unit/training-sim-fixtures";

const sp = (hp = 0, atk = 0, def = 0, spa = 0, spd = 0, spe = 0) => ({ hp, atk, def, spa, spd, spe });
const IV = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
type Set = { name: string; species: string; item: string; ability: string; moves: string[]; nature: string; evs: ReturnType<typeof sp>; ivs: typeof IV; level: number; gender: string };
const set = (species: string, item: string, ability: string, moves: string[], gender = "M", evs = sp(20, 12, 10, 12, 10, 2)): Set =>
  ({ name: species, species, item, ability, moves, nature: "Serious", evs, ivs: IV, level: 50, gender });
const TEAMS: Set[][] = [
  [set("Aerodactyl", "Focus Sash", "Pressure", ["Taunt", "Rock Slide", "Protect", "Fly"]), set("Alakazam", "Life Orb", "Inner Focus", ["Encore", "Safeguard", "Psychic", "Skill Swap"]),
    set("Banette", "Leftovers", "Insomnia", ["Disable", "Destiny Bond", "Shadow Claw", "Protect"]), set("Snorlax", "Sitrus Berry", "Thick Fat", ["Uproar", "Hyper Beam", "Protect", "Body Slam"]),
    set("Farigiraf", "Sitrus Berry", "Cud Chew", ["Future Sight", "Gravity", "Psychic", "Protect"]), set("Aggron", "Lum Berry", "Sturdy", ["Solar Beam", "Iron Head", "Protect", "Taunt"])],
  [set("Dragapult", "White Herb", "Infiltrator", ["Lock-On", "Draco Meteor", "Shadow Ball", "Phantom Force"]), set("Hydrapple", "Sitrus Berry", "Supersweet Syrup", ["Draco Meteor", "Giga Drain", "Protect", "Sleep Talk"]),
    set("Incineroar", "Sitrus Berry", "Intimidate", ["Fake Out", "Flare Blitz", "Protect", "Taunt"]), set("Clefable", "Mental Herb", "Magic Guard", ["Follow Me", "Moonblast", "Copycat", "Misty Terrain"], "F"),
    set("Tauros-Paldea-Aqua", "Lum Berry", "Cud Chew", ["Wave Crash", "Close Combat", "Protect", "Raging Bull"]), set("Raichu", "Focus Sash", "Lightning Rod", ["Thunderbolt", "Fake Out", "Protect", "Electric Terrain"])],
  [set("Cofagrigus", "Sitrus Berry", "Mummy", ["Will-O-Wisp", "Shadow Ball", "Protect", "Disable"]), set("Runerigus", "Leftovers", "Wandering Spirit", ["Earthquake", "Shadow Claw", "Protect", "Destiny Bond"]),
    set("Oranguru", "Sitrus Berry", "Inner Focus", ["Instruct", "Psychic", "Protect", "Trick Room"]), set("Venusaur", "Big Root", "Chlorophyll", ["Leech Seed", "Sludge Bomb", "Protect", "Solar Beam"]),
    set("Garchomp", "Life Orb", "Rough Skin", ["Dig", "Dragon Claw", "Protect", "Earthquake"]), set("Gengar", "Focus Sash", "Cursed Body", ["Destiny Bond", "Shadow Ball", "Protect", "Disable"])],
  [set("Espeon", "Light Clay", "Magic Bounce", ["Psychic Terrain", "Psychic", "Protect", "Skill Swap"], "F"), set("Kingambit", "Black Glasses", "Defiant", ["Kowtow Cleave", "Sucker Punch", "Protect", "Swords Dance"]),
    set("Rotom-Wash", "Leftovers", "Levitate", ["Hydro Pump", "Thunderbolt", "Will-O-Wisp", "Protect"], "N"), set("Gyarados", "Sitrus Berry", "Intimidate", ["Waterfall", "Taunt", "Protect", "Hyper Beam"]),
    set("Corviknight", "Leftovers", "Pressure", ["Fly", "Body Press", "Protect", "Roost"]), set("Sinistcha", "Sitrus Berry", "Hospitality", ["Matcha Gotcha", "Rage Powder", "Protect", "Strength Sap"], "N")],
];
const team = (sets: Set[]) => toShowdownTeam(sets.map((each) => {
  const member = memberFromSet(each as never);
  return { ...member, build: { ...member.build, configuration: { ...member.build.configuration, gender: each.gender as "M" } } };
}), runtime);

const battles = Number(process.argv[2] ?? 40);
const seed0 = Number(process.argv[3] ?? 1);
let lcg = seed0 * 2654435761 >>> 0;
const rand = (n: number) => { lcg = (Math.imul(lcg, 1664525) + 1013904223) >>> 0; return lcg % n; };
// The cells sampled for the engine draw from their own stream, so the battles do not depend on the engine.
let cellLcg = (seed0 * 40503 + 17) >>> 0;
const cellRand = (n: number) => { cellLcg = (Math.imul(cellLcg, 1664525) + 1013904223) >>> 0; return cellLcg % n; };

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

const stats = { decisions: 0, compared: 0, mismatches: 0, logsClean: 0, logsSame: 0, cells: 0, engineCells: 0, issues: 0, notEstimated: 0, reasons: {} as Record<string, number>, seen: {} as Record<string, number>, carried: {} as Record<string, number> };
const notes: string[] = [];
let logOf: (() => string[]) | null = null;
const note = (text: string) => {
  stats.mismatches++; if (notes.length < 100000) notes.push(text);
  if (process.env.LOG && logOf && text.startsWith(`#${process.env.LOG} `)) { console.log("LOG", text); console.log(logOf().slice(-80).join(String.fromCharCode(10))); logOf = null; }
};
const seen = (what: string) => { stats.seen[what] = (stats.seen[what] ?? 0) + 1; };

function compare(where: string, real: Pokemon, belief: Pokemon) {
  stats.compared++;
  const same = (what: string, x: unknown, y: unknown) => { if (JSON.stringify(x) !== JSON.stringify(y)) note(`${where} ${real.name} ${what}: real ${JSON.stringify(x)} belief ${JSON.stringify(y)}`); };
  const vol = (mon: Pokemon, id: string) => (mon.volatiles as Record<string, Record<string, unknown> | undefined>)[id];
  for (const id of ["taunt", "encore", "disable", "uproar", "lockon", "destinybond", "mustrecharge", "twoturnmove", "stall", "leechseed"]) {
    const x = vol(real, id), y = vol(belief, id);
    if (x) seen(id);
    same(`volatile ${id}`, !!x, !!y);
    if (!x || !y) continue;
    if (["taunt", "encore", "disable", "uproar", "lockon"].includes(id)) same(`${id} duration`, x.duration, y.duration);
    if (id === "encore" || id === "disable" || id === "twoturnmove") same(`${id} move`, x.move, y.move);
    if (id === "lockon") same("lockon source", (x.source as Pokemon | undefined)?.name, (y.source as Pokemon | undefined)?.name);
    if (id === "stall") same("stall counter", x.counter, y.counter);
    if (id === "leechseed") same("leechseed slot", x.sourceSlot, y.sourceSlot);
  }
  const flags = ["syrupTriggered", "bondTriggered", "swordBoost", "shieldBoost"] as const;
  for (const flag of flags) same(flag, !!(real as unknown as Record<string, unknown>)[flag], !!(belief as unknown as Record<string, unknown>)[flag]);
  if (real.ability === "cudchew" && !real.volatiles.gastroacid) {
    const ra = real.abilityState as unknown as { berry?: { id: string }; counter?: number }, ba = belief.abilityState as unknown as { berry?: { id: string }; counter?: number };
    if (ra.berry) seen("cudchew");
    same("cudchew", [ra.berry?.id ?? null, ra.berry ? ra.counter : null], [ba.berry?.id ?? null, ba.berry ? ba.counter : null]);
  }
  same("activeMoveActions", real.activeMoveActions, belief.activeMoveActions);
  same("hp", real.hp, belief.hp);
  same("boosts", real.boosts, belief.boosts);
  same("item", real.item, belief.item);
  same("ability", real.ability, belief.ability);
  same("storedStats", real.storedStats, belief.storedStats);
  same("status", real.status, belief.status);
  same("pp", real.moveSlots.map((slot) => slot.pp), belief.moveSlots.map((slot) => slot.pp));
}
const order = (battle: ClonedBattle | { p1: { active: (Pokemon | null)[] }; p2: { active: (Pokemon | null)[] } }) =>
  (["p1", "p2"] as const).flatMap((side) => (battle[side].active as (Pokemon | null)[]).map((mon, position) => ({ mon, at: `${side}${"ab"[position]}` })))
    .filter(({ mon }) => mon && !mon.fainted).sort((a, b) => Number(a.mon!.abilityState.effectOrder) - Number(b.mon!.abilityState.effectOrder)).map(({ at }) => at).join(",");

for (let index = 0; index < battles; index++) {
  const a = rand(TEAMS.length), b = (a + 1 + rand(TEAMS.length - 1)) % TEAMS.length;
  const seat = seatBattle([seed0 + index, 2, 3, 4], { own: team(TEAMS[a]), opponent: team(TEAMS[b]) });
  const pick = () => { const picks = [0, 1, 2, 3, 4, 5].sort(() => rand(3) - 1).slice(0, 4).map((i) => i + 1).join(""); return `team ${picks}`; };
  seat.step(pick(), pick());
  logOf = () => seat.battle.log.filter((l) => l && !l.startsWith("|t:|") && !l.startsWith("|split") && !l.startsWith("|uhtml") && !/\/100[gyr]?( |$|\|)/.test(l));
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
        const world = seat.truthWorld((index * 1000 + turn).toString(16).padStart(32, "0"));
        const belief = buildBeliefBattle(inputs, world, runtime);
        for (const side of ["p1", "p2"] as const) {
          for (const real of seat.battle[side].active) {
            if (!real || real.fainted) continue;
            const believed = belief.battle[side].pokemon.find((each) => each.name === real.name);
            if (!believed) { note(`#${index} t${seat.battle.turn} ${real.name}: not in the belief battle`); continue; }
            compare(`#${index} t${seat.battle.turn}`, real, believed);
          }
        }
        const realOrder = order(seat.battle as unknown as ClonedBattle), beliefOrder = order(belief.battle);
        if (realOrder !== beliefOrder) note(`#${index} t${seat.battle.turn} entry order: real ${realOrder} belief ${beliefOrder}`);
        const field = (battle: ClonedBattle) => JSON.stringify([battle.field.terrain, battle.field.terrain ? battle.field.terrainState.duration : null,
          ...Object.entries(battle.field.pseudoWeather).map(([id, state]) => [id, (state as { duration?: number }).duration]),
          ...(["p1", "p2"] as const).map((s) => Object.entries(battle[s].sideConditions).map(([id, state]) => [id, (state as { duration?: number }).duration ?? null]))]);
        if (field(seat.battle as unknown as ClonedBattle) !== field(belief.battle)) note(`#${index} t${seat.battle.turn} field: real ${field(seat.battle as unknown as ClonedBattle)} belief ${field(belief.battle)}`);
        if (Object.keys(seat.battle.field.pseudoWeather).length || seat.battle.field.terrain) seen("field");
        if (((seat.battle as unknown as { lastMove?: { id: string } }).lastMove?.id ?? null) !== (belief.battle.lastMove?.id ?? null)) note(`#${index} t${seat.battle.turn} battle.lastMove differs`);
        // One-turn logs with no hidden counter in play: the belief battle plays the real choices as the real battle does.
        const HIDDEN = new Set(["confusion", "lockedmove", "partiallytrapped", "twoturnmove", "substitute", "yawn", "encore", "taunt", "disable", "slowstart", "throatchop", "uproar", "lockon"]);
        const hidden = Object.values(inputs.public.mons).some((mon) => mon.position !== null && !mon.fainted && (mon.status === "slp" || mon.status === "frz" || !!mon.lock || mon.volatiles.some((v) => HIDDEN.has(v.id))));
        if (!hidden && c1 && c2) {
          const seed = `sodium,${(index * 1000 + turn).toString(16).padStart(32, "0")}`;
          const play = (json: string) => { const battle = State.deserializeBattle(json) as ClonedBattle; battle.restart(() => {}); battle.prng = new PRNG(seed as never); const before = battle.log.length; const ok = battle.choose("p1", c1) && battle.choose("p2", c2); return { ok, lines: battle.log.slice(before).filter((line) => !line.startsWith("|t:|")) }; };
          const realRun = play(JSON.stringify(State.serializeBattle(seat.battle))), rebuilt = play(belief.json);
          stats.logsClean++;
          if (realRun.ok && rebuilt.ok && JSON.stringify(realRun.lines) === JSON.stringify(rebuilt.lines)) stats.logsSame++;
          else { if (process.env.LINES === String(index)) { console.log("REAL", JSON.stringify(realRun.lines)); console.log("BELIEF", JSON.stringify(rebuilt.lines)); }
            const at = realRun.lines.findIndex((line, k) => line !== rebuilt.lines[k]); note(`#${index} t${seat.battle.turn} log: real ${realRun.lines[at]} / belief ${rebuilt.lines[at]} (${c1} | ${c2})`); }
        }
        // The services' engine worlds for a few of the AI's legal cells (its own and the player's options): no engine issue.
        const services = createTurnServices(inputs, [world], { runtime, keys: seat.keys, seedBase: (index * 7919 + turn).toString(16).padStart(32, "0") });
        const { own, opponent } = services.view.legal;
        for (let k = 0; k < 6 && own.length && opponent.length; k++) {
          const cell: CellActions = { own: own[cellRand(own.length)], opponent: opponent[cellRand(opponent.length)] };
          stats.cells++;
          const worlds = services.engineWorlds(cell);
          if (worlds.kind !== "engine") {
            for (const reason of worlds.reasons) { const key = `${worlds.kind}: ${process.env.NAMES ? reason : reason.replace(/^[^:]+: /, "")}`; stats.reasons[key] = (stats.reasons[key] ?? 0) + 1; }
            continue;
          }
          stats.engineCells++;
          for (const engineWorld of worlds.worlds) {
            for (const slot of DOUBLES_SLOTS) for (const key of Object.keys(engineWorld.input.pokemon[slot]?.carried ?? {})) stats.carried[key] = (stats.carried[key] ?? 0) + 1;
            const result = calculateDoublesOutcomes(engineWorld.input);
            if (result.status === "issues") { stats.issues++; note(`#${index} t${seat.battle.turn} engine issues ${JSON.stringify(result.issues)} cell ${JSON.stringify(cell)}`); }
            if (result.status === "not-estimated") { stats.notEstimated++; const key = `engine: ${result.reason}`; stats.reasons[key] = (stats.reasons[key] ?? 0) + 1; }
            if (result.status === "ready" && result.endOfTurn !== "applied") { const key = `end of turn: ${result.endOfTurn.notEstimated}`; stats.reasons[key] = (stats.reasons[key] ?? 0) + 1; }
          }
        }
      } catch (error) { note(`#${index} t${seat.battle.turn} error ${(error as Error).stack?.split("\n").slice(0, 4).join(" ")}`); }
    }
    try { seat.step(c1, c2); } catch (error) { note(`#${index} t${seat.battle.turn} step ${(error as Error).message} (${c1} | ${c2})`); break; }
  }
}
const sorted = (record: Record<string, number>) => Object.fromEntries(Object.entries(record).sort((x, y) => y[1] - x[1]));
console.log(JSON.stringify({ ...stats, reasons: sorted(stats.reasons), carried: sorted(stats.carried) }, null, 1));
console.log(notes.join("\n"));
