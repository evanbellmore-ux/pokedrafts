// Track R-T fuzz: random legal Champions battles between teams that switch mid-turn (U-turn, Volt Switch, Flip Turn, Parting
// Shot, Teleport, Baton Pass, Shed Tail, Chilly Reception, Eject Button, Red Card, Emergency Exit, Roar, Whirlwind, Dragon Tail,
// Circle Throw), lay hazards (Stealth Rock, Spikes, Toxic Spikes, Sticky Web) and clear them (Defog, Rapid Spin, Mortal Spin,
// Court Change, Tidy Up), with Future Sight users that switch out and Instruct. At each of the AI's (p2) turn decisions:
//   - the belief battle on the truth world against the real battle (as t2-fuzz.ts: HP, status, lastMoveTargetLoc...);
//   - the bridge's bench, hazards and replacements against the real battle: each side's living bench in party order with its
//     real HP and status; the hazards with their layers; the player's replacement its healthiest bench Pokémon;
//   - one-turn logs with no hidden counter;
//   - the services' engine worlds for a few cells: no engine issue (E2 too), the not-estimated reasons counted; again with a
//     ReplacePolicy for the AI's side (the evaluator passes one); each outcome id a bench id or a slot's start id (a starter
//     that left and came back in, here or at the other slot); the prelude's newcomers (a replacement before the moves) and
//     the outcomes where a side switched out twice (one pick the engine's default: the input names one per slot).
//   npx --no-install tsx scripts/.cache/calc-audit/status2/build/w2-rt/rt-fuzz.ts [battles=40] [seed=1]
import { calculateDoublesOutcomes } from "@/app/lib/battle/doubles-turn";
import { DOUBLES_SLOTS } from "@/app/lib/battle/doubles-types";
import { championsRuntime as runtime } from "@/app/lib/battle/runtime";
import { postFromOutcome } from "@/app/(app)/training/ai/evaluate";
import type { CellActions } from "@/app/(app)/training/model/ai-view";
import { buildBeliefBattle } from "@/app/(app)/training/sim/belief-battle";
import { createTurnServices } from "@/app/(app)/training/sim/services";
import { toShowdownTeam } from "@/app/(app)/training/sim/showdown-set";
import { PRNG, State, type ClonedBattle, type Pokemon } from "@/app/(app)/training/sim/sim";
import { memberFromSet, seatBattle } from "../../../../../../tests/unit/training-sim-fixtures";

const sp = (hp = 0, atk = 0, def = 0, spa = 0, spd = 0, spe = 0) => ({ hp, atk, def, spa, spd, spe });
const IV = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
type Set = { name: string; species: string; item: string; ability: string; moves: string[]; nature: string; evs: ReturnType<typeof sp>; ivs: typeof IV; level: number; gender: string };
const set = (species: string, item: string, ability: string, moves: string[], gender = "M", evs = sp(20, 12, 10, 12, 10, 2)): Set =>
  ({ name: species, species, item, ability, moves, nature: "Serious", evs, ivs: IV, level: 50, gender });
const TEAMS: Set[][] = [
  [set("Incineroar", "Sitrus Berry", "Intimidate", ["Parting Shot", "Fake Out", "Flare Blitz", "Protect"]), set("Garchomp", "Eject Button", "Rough Skin", ["Stealth Rock", "Dragon Claw", "Earthquake", "Protect"]),
    set("Golisopod", "Leftovers", "Emergency Exit", ["First Impression", "Liquidation", "Protect", "Spikes"]), set("Farigiraf", "Sitrus Berry", "Armor Tail", ["Future Sight", "Psychic", "Protect", "Trick Room"]),
    set("Corviknight", "Leftovers", "Pressure", ["Defog", "U-turn", "Body Press", "Roost"]), set("Hippowdon", "Red Card", "Sand Stream", ["Whirlwind", "Stealth Rock", "Earthquake", "Slack Off"])],
  [set("Rotom-Wash", "Sitrus Berry", "Levitate", ["Volt Switch", "Hydro Pump", "Will-O-Wisp", "Protect"], "N"), set("Arcanine", "Sitrus Berry", "Intimidate", ["Roar", "Flare Blitz", "Protect", "Extreme Speed"]),
    set("Glimmora", "Focus Sash", "Toxic Debris", ["Toxic Spikes", "Mortal Spin", "Sludge Bomb", "Power Gem"]), set("Araquanid", "Focus Sash", "Water Bubble", ["Sticky Web", "Liquidation", "Protect", "Leech Life"], "F"),
    set("Dragonite", "Lum Berry", "Multiscale", ["Dragon Tail", "Extreme Speed", "Protect", "Earthquake"]), set("Oranguru", "Sitrus Berry", "Inner Focus", ["Instruct", "Psychic", "Protect", "Trick Room"])],
  [set("Maushold", "Wide Lens", "Technician", ["Tidy Up", "Population Bomb", "Protect", "U-turn"], "N"), set("Primarina", "Sitrus Berry", "Torrent", ["Flip Turn", "Moonblast", "Protect", "Hyper Voice"], "F"),
    set("Orthworm", "Sitrus Berry", "Earth Eater", ["Shed Tail", "Iron Head", "Stealth Rock", "Protect"]), set("Lucario", "Sitrus Berry", "Inner Focus", ["Circle Throw", "Close Combat", "Protect", "Swords Dance"]),
    set("Slowking", "Sitrus Berry", "Regenerator", ["Chilly Reception", "Psychic", "Protect", "Scald"]), set("Kingambit", "Black Glasses", "Defiant", ["Kowtow Cleave", "Sucker Punch", "Protect", "Swords Dance"])],
  [set("Espeon", "Light Clay", "Magic Bounce", ["Psychic", "Protect", "Baton Pass", "Calm Mind"], "F"), set("Cinderace", "Life Orb", "Libero", ["Court Change", "Pyro Ball", "U-turn", "Protect"]),
    set("Gengar", "Focus Sash", "Cursed Body", ["Shadow Ball", "Protect", "Sludge Bomb", "Disable"]), set("Sinistcha", "Sitrus Berry", "Hospitality", ["Matcha Gotcha", "Rage Powder", "Protect", "Strength Sap"], "N"),
    set("Gyarados", "Eject Button", "Intimidate", ["Waterfall", "Taunt", "Protect", "Thunder Wave"]), set("Snorlax", "Leftovers", "Thick Fat", ["Body Slam", "Protect", "Curse", "Rest"])],
];
const team = (sets: Set[]) => {
  const usable = sets.map((each) => ({ ...each, moves: each.moves.filter((move) => runtime.movesById.has(move.toLowerCase().replace(/[^a-z0-9]+/g, ""))) }))
    .filter((each) => runtime.speciesById.has(each.species.toLowerCase().replace(/[^a-z0-9]+/g, "")));
  return toShowdownTeam(usable.map((each) => {
    const member = memberFromSet(each as never);
    return { ...member, build: { ...member.build, configuration: { ...member.build.configuration, gender: each.gender as "M" } } };
  }), runtime);
};

const battles = Number(process.argv[2] ?? 40);
const seed0 = Number(process.argv[3] ?? 1);
let lcg = seed0 * 2654435761 >>> 0;
const rand = (n: number) => { lcg = (Math.imul(lcg, 1664525) + 1013904223) >>> 0; return lcg % n; };
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

const stats = { decisions: 0, compared: 0, mismatches: 0, benchChecked: 0, hazardsChecked: 0, logsClean: 0, logsSame: 0, cells: 0, engineCells: 0, issues: 0, notEstimated: 0, ready: 0,
  withBench: 0, withHazards: 0, withReplacement: 0, replacedOutcomes: 0, preludeCells: 0, preludeNewcomers: 0, secondPick: 0, secondPickOwn: 0, policyCells: 0, policyIssues: 0, policyReady: 0, postChecked: 0, reasons: {} as Record<string, number>, seen: {} as Record<string, number> };
const notes: string[] = [];
const printed = new Set<number>();
const note = (text: string) => { stats.mismatches++; if (notes.length < 80) notes.push(text); };
const seen = (what: string) => { stats.seen[what] = (stats.seen[what] ?? 0) + 1; };
const CHOOSABLE = new Set(["normal", "any", "adjacentAlly", "adjacentAllyOrSelf", "adjacentFoe"]);
const toId = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");

for (let index = 0; index < battles; index++) {
  const a = rand(TEAMS.length), b = (a + 1 + rand(TEAMS.length - 1)) % TEAMS.length;
  const seat = seatBattle([seed0 + index, 2, 3, 4], { own: team(TEAMS[a]), opponent: team(TEAMS[b]) });
  const pick = () => { const picks = [0, 1, 2, 3, 4, 5].sort(() => rand(3) - 1).slice(0, 4).map((i) => i + 1).join(""); return `team ${picks}`; };
  seat.step(pick(), pick());
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
      const where = `#${index} t${seat.battle.turn}`;
      try {
        const inputs = seat.inputs();
        const world = seat.truthWorld((index * 1000 + turn).toString(16).padStart(32, "0"));
        const belief = buildBeliefBattle(inputs, world, runtime);
        for (const side of ["p1", "p2"] as const) {
          for (const real of seat.battle[side].active) {
            if (!real || real.fainted) continue;
            stats.compared++;
            const believed = belief.battle[side].pokemon.find((each) => each.name === real.name);
            if (!believed) { note(`${where} ${real.name}: not in the belief battle`); continue; }
            // lastMoveTargetLoc: the AI's own (p2) after a move chosen at a target (its choice is known; the player's is not public).
            const chosenMove = side === "p2" && !!real.lastMove && CHOOSABLE.has(String((real.lastMove as { target?: string }).target));
            for (const [what, x, y] of [["hp", real.hp, believed.hp], ["status", real.status, believed.status], ...(chosenMove ? [["lastMoveTargetLoc", real.lastMoveTargetLoc, believed.lastMoveTargetLoc] as const] : [])] as const) {
              if (JSON.stringify(x) !== JSON.stringify(y)) note(`${where} ${real.name} ${what}: real ${JSON.stringify(x)} belief ${JSON.stringify(y)}`);
            }
          }
        }
        // One-turn logs with no hidden counter in play.
        const HIDDEN = new Set(["confusion", "lockedmove", "partiallytrapped", "twoturnmove", "substitute", "yawn", "encore", "taunt", "disable", "slowstart", "throatchop", "uproar", "lockon"]);
        const hidden = Object.values(inputs.public.mons).some((mon) => mon.position !== null && !mon.fainted && (mon.status === "slp" || mon.status === "frz" || !!mon.lock || mon.volatiles.some((v) => HIDDEN.has(v.id))));
        if (!hidden && c1 && c2) {
          const seed = `sodium,${(index * 1000 + turn).toString(16).padStart(32, "0")}`;
          const play = (json: string) => { const battle = State.deserializeBattle(json) as ClonedBattle; battle.restart(() => {}); battle.prng = new PRNG(seed as never); const before = battle.log.length; const ok = battle.choose("p1", c1) && battle.choose("p2", c2); return { ok, lines: battle.log.slice(before).filter((line) => !line.startsWith("|t:|")) }; };
          const realRun = play(JSON.stringify(State.serializeBattle(seat.battle))), rebuilt = play(belief.json);
          stats.logsClean++;
          if (realRun.ok && rebuilt.ok && JSON.stringify(realRun.lines) === JSON.stringify(rebuilt.lines)) stats.logsSame++;
          else { const at = realRun.lines.findIndex((line, k) => line !== rebuilt.lines[k]); note(`${where} log: real ${realRun.lines[at]} / belief ${rebuilt.lines[at]} (${c1} | ${c2})`); }
        }
        const services = createTurnServices(inputs, [world], { runtime, keys: seat.keys, seedBase: (index * 7919 + turn).toString(16).padStart(32, "0") });
        const { own, opponent } = services.view.legal;
        // The live cell's input: the bench and the hazards against the real battle.
        const quiet = services.engineWorlds({ own: own[0], opponent: opponent[0] });
        if (quiet.kind === "engine" && quiet.source === "live") {
          const input = quiet.worlds[0].input;
          for (const [engineSide, side] of [["own", "p1"], ["opponent", "p2"]] as const) {
            stats.benchChecked++;
            const real = seat.battle[side].pokemon.filter((each) => !each.fainted && !each.isActive && each.hp > 0);
            const bench = input.bench?.[engineSide] ?? [];
            const shown = JSON.stringify(bench.map((each) => [each.build.speciesId, each.build.currentHP ?? "full", each.build.status]));
            const truth = JSON.stringify(real.map((each) => [each.species.id, each.hp === each.maxhp ? "full" : each.hp, each.status]));
            if (shown !== truth) note(`${where} ${engineSide} bench: real ${truth} bridge ${shown}`);
            const conditions = seat.battle[side].sideConditions as Record<string, { layers?: number } | undefined>;
            const hazards = { stealthRock: !!conditions.stealthrock, spikes: conditions.spikes?.layers ?? 0, toxicSpikes: conditions.toxicspikes?.layers ?? 0, stickyWeb: !!conditions.stickyweb };
            const passed = input.hazards?.[engineSide] ?? {};
            const bridged = { stealthRock: !!passed.stealthRock, spikes: passed.spikes ?? 0, toxicSpikes: passed.toxicSpikes ?? 0, stickyWeb: !!passed.stickyWeb };
            stats.hazardsChecked++;
            if (JSON.stringify(hazards) !== JSON.stringify(bridged)) { note(`${where} ${engineSide} hazards: real ${JSON.stringify(hazards)} bridge ${JSON.stringify(bridged)}`); if (process.env.SIDELOG && !printed.has(index)) { printed.add(index); console.log(`SIDELOG #${index}`, seat.battle.log.filter((line) => /sidestart|sideend|Toxic Debris|Court Change/.test(line)).join(String.fromCharCode(10))); console.log("PUBLIC", JSON.stringify(inputs.public.sides)); } }
            if (Object.values(hazards).some(Boolean)) seen(`hazards.${engineSide}`);
            // Gap fix (Q9 at every switch): the player's side passes replacementOrder "healthiest" and no per-slot replacement.
            if (engineSide === "own" && bench.length && (input.replacementOrder?.own !== "healthiest" || input.replacement?.["own-left"] || input.replacement?.["own-right"])) {
              note(`${where} own replacement order ${JSON.stringify(input.replacementOrder?.own)} replacement ${JSON.stringify(input.replacement)}`);
            }
          }
        }
        for (let k = 0; k < 6 && own.length && opponent.length; k++) {
          const cell: CellActions = { own: own[cellRand(own.length)], opponent: opponent[cellRand(opponent.length)] };
          stats.cells++;
          const worlds = services.engineWorlds(cell);
          if (worlds.kind !== "engine") {
            for (const reason of worlds.reasons) { const key = `${worlds.kind}: ${process.env.NAMES ? reason : reason.replace(/^[^:]+: /, "")}`; stats.reasons[key] = (stats.reasons[key] ?? 0) + 1; }
            continue;
          }
          stats.engineCells++;
          if (worlds.source === "prelude") {
            stats.preludeCells++;
            const input0 = worlds.worlds[0].input;
            for (const slot of DOUBLES_SLOTS) {
              const chosen = (slot.startsWith("own") ? cell.own : cell.opponent)[slot];
              if (input0.pokemon[slot]?.switchedIn && chosen?.kind !== "switch") stats.preludeNewcomers++;
            }
          }
          // With the AI's own ReplacePolicy (as the evaluator passes one): the last option, every cell (no issue, no throw).
          {
            const policy = (_side: unknown, slots: readonly unknown[], options: readonly string[]) => slots.map(() => options[options.length - 1]) as never;
            const withPolicy = services.engineWorlds(cell, policy as never);
            if (withPolicy.kind === "engine") for (const engineWorld of withPolicy.worlds) {
              stats.policyCells++;
              try { const r = calculateDoublesOutcomes(engineWorld.input); if (r.status === "issues") { stats.policyIssues++; note(`${where} policy issues ${JSON.stringify(r.issues).slice(0, 300)}`); } if (r.status === "ready") stats.policyReady++; }
              catch (error) { note(`${where} policy engine threw ${(error as Error).message.slice(0, 120)} cell ${JSON.stringify(cell)}`); }
            }
          }
          for (const engineWorld of worlds.worlds) {
            const input = engineWorld.input;
            if (input.bench && (input.bench.own?.length || input.bench.opponent?.length)) stats.withBench++;
            if (input.hazards) stats.withHazards++;
            if (input.replacement) stats.withReplacement++;
            let result;
            try { result = calculateDoublesOutcomes(input); }
            catch (error) { note(`${where} engine threw ${(error as Error).message.slice(0, 120)} cell ${JSON.stringify(cell)}`); continue; }
            if (result.status === "issues") { stats.issues++; note(`${where} engine issues ${JSON.stringify(result.issues).slice(0, 300)} cell ${JSON.stringify(cell)}`); }
            if (result.status === "not-estimated") { stats.notEstimated++; const key = `engine: ${result.reason.replace(/^[A-Z][^ ]* /, "{Name} ")}`; stats.reasons[key] = (stats.reasons[key] ?? 0) + 1; }
            if (result.status === "ready") {
              stats.ready++;
              if (result.outcomes.some((each) => each.benched && Object.values(each.benched).some((list) => list?.length))) stats.replacedOutcomes++;
              // A side with two leavers in one outcome: one of its picks was the engine's default (two starters out, or a newcomer out again).
              if (result.outcomes.some((each) => Object.values(each.benched ?? {}).some((list) => (list?.length ?? 0) >= 2))) stats.secondPick++;
              if (result.outcomes.some((each) => (each.benched?.own?.length ?? 0) >= 2)) stats.secondPickOwn++;
              // Training's reader of the outcomes (ai/evaluate.ts postFromOutcome): every Pokémon once, under a belief-world key, the slots distinct.
              const base = services.current();
              const known = new Set(base.mons.map((mon) => mon.key));
              for (const each of result.outcomes) {
                stats.postChecked++;
                const post = postFromOutcome({ view: services.view, base, residual: {}, outcome: each, start: result.start, world: engineWorld, cell, endOfTurn: result.endOfTurn });
                const strange = post.mons.filter((mon) => !known.has(mon.key)).map((mon) => mon.key);
                const slots = post.mons.filter((mon) => mon.slot !== null).map((mon) => mon.slot);
                if (strange.length || new Set(post.mons.map((mon) => mon.key)).size !== post.mons.length || new Set(slots).size !== slots.length) note(`${where} post: unknown ${strange.join(",")} keys ${post.mons.map((mon) => `${mon.key}@${mon.slot}`).join(" ")}`);
              }
              for (const each of result.outcomes) for (const slot of DOUBLES_SLOTS) {
                const id = each.mons[slot]?.id;
                // A bench id, or the start id of a slot's starting Pokémon (one that left and came back in, here or at the other slot).
                const startSlot = id?.startsWith("slot:") ? id.slice(5) as keyof typeof input.pokemon : null;
                if (startSlot) { stats.seen.startIdBack = (stats.seen.startIdBack ?? 0) + 1; if (!input.pokemon[startSlot] || startSlot.split("-")[0] !== slot.split("-")[0]) note(`${where} outcome ${slot} id ${id}: no such starter on its side`); }
                else if (id && !(input.bench?.own ?? []).concat(input.bench?.opponent ?? []).some((entry) => entry.id === id)) note(`${where} outcome ${slot} id ${id} not on a bench`);
              }
              if (result.endOfTurn !== "applied") { const key = `end of turn: ${result.endOfTurn.notEstimated.replace(/^[A-Z][^ ]* /, "{Name} ")}`; stats.reasons[key] = (stats.reasons[key] ?? 0) + 1; }
            }
          }
        }
        void toId; void ({} as Pokemon);
      } catch (error) { note(`${where} error ${(error as Error).stack?.split("\n").slice(0, 4).join(" ")}`); }
    }
    try { seat.step(c1, c2); } catch (error) { note(`#${index} t${seat.battle.turn} step ${(error as Error).message} (${c1} | ${c2})`); break; }
  }
}
const sorted = (record: Record<string, number>) => Object.fromEntries(Object.entries(record).sort((x, y) => y[1] - x[1]));
console.log(JSON.stringify({ ...stats, reasons: sorted(stats.reasons) }, null, 1));
console.log(notes.join("\n"));
