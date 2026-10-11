// Writes tests/unit/doubles-turn-showdown.test.ts from cases.ts and the oracle's results/<id>.json (SPEC §8.1: unit tests
// hard-code the harness outputs, each citing its case id). A results/<id>.all.json (an exhaustive "all" walk of a case that runs
// as a Monte Carlo by default) replaces that case's sampled values.
//
// status-eot (SPEC §7 step 6, ADDENDUM §7.1 step 5): the cases are the base ones (gen-tests-base-ids.json, the file's cases
// before status-eot) and the status-eot ones (cases-se.ts), each only when it agrees with the app in results/compare.json
// (--all: every case with results). Each case also states its end of turn (the after-turn HP and the residuals, or the
// end-of-turn reason), its effect facts (statuses, stages, skipped moves, self-hits, volatiles started), its hits into a
// Substitute, the Ally Switch positions, and for an `outcomes` case the E2 mixtures (items, Substitutes, volatiles, perish
// counts, hazards, positions).
//
// Run from the repo root: npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/gen-tests.ts [--all]
import fs from "node:fs";
import path from "node:path";
import { GAME_RUNTIME, SLOTS, toID, type Case, type OracleResult, type SlotId, type SlotResult, type WalkResult } from "./case-types";
import { CASES } from "./cases";
import { STATUS_EOT_CASES, STATUS_EOT_REEXPECT } from "./cases-se";

const RESULTS = path.resolve("scripts/.cache/calc-audit/2v2/verify/results");
// --out=<file>: write there instead (Track V1's checks of the generator; the test file stays as it is).
const OUT = path.resolve(process.argv.find((a) => a.startsWith("--out="))?.slice("--out=".length) ?? "tests/unit/doubles-turn-showdown.test.ts");
const BASE = new Set<string>(JSON.parse(fs.readFileSync(path.resolve("scripts/.cache/calc-audit/2v2/verify/gen-tests-base-ids.json"), "utf8")));
const SE = new Set<string>([...STATUS_EOT_CASES.map((c) => c.id), ...Object.keys(STATUS_EOT_REEXPECT)]);
const all = process.argv.includes("--all");
// status2 (Track V1): --compare=<file> reads that compare report (v1/run.ts --compare-out) instead of results/compare.json;
// --keep=<file> (one id per line: the ids the test file has now) keeps those cases whether they agree or not, so a case
// the file asserted never leaves it (a regression fails the test instead of dropping out).
const argOf = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const compareFile = argOf("compare") ? path.resolve(argOf("compare")!) : path.join(RESULTS, "compare.json");
const KEEP = new Set<string>(argOf("keep") ? fs.readFileSync(path.resolve(argOf("keep")!), "utf8").split(/\r?\n/).filter(Boolean) : []);
type Report = { id: string; status: string; mismatches: { where: string; field: string }[] };
/** A base case's rows assert the turn after the moves only: a mismatch elsewhere (the end of turn, E2, facts) does not drop it. */
const assertedByBase = (m: Report["mismatches"][number]) => !/^(endOfTurn|E2)/.test(m.where) && m.field !== "facts" && !/^(effect|confusion self-hit|hit.change|losses|heals)/.test(m.field);
const agreeing = fs.existsSync(compareFile)
  ? new Set((JSON.parse(fs.readFileSync(compareFile, "utf8")) as Report[])
    .filter((r) => r.status !== "error" && (SE.has(r.id) ? !r.mismatches.length : !r.mismatches.some(assertedByBase))).map((r) => r.id))
  : null;
const num = (x: number) => Number(x.toPrecision(15));
const js = (value: unknown) => JSON.stringify(value).replace(/"([a-zA-Z_][a-zA-Z0-9_]*)":/g, "$1:");
const STATUS_GIVEN: Record<string, string> = { slp: "Falls asleep.", par: "Is paralysed.", brn: "Is burned.", psn: "Is poisoned.", tox: "Is badly poisoned.", frz: "Is frozen." };
const STAGE_NAMES: Record<string, string> = { atk: "Attack", def: "Defense", spa: "Sp. Atk", spd: "Sp. Def", spe: "Speed", accuracy: "accuracy", evasion: "evasion" };
const signed = (n: number) => (n < 0 ? `−${-n}` : `+${n}`);
const L_MOVES = new Set(`acupressure aromatherapy attract autotomize bestow camouflage captivate conversion conversion2 corrosivegas courtchange
craftyshield defog doodle electrify embargo entrainment flowershield foresight forestscurse gastroacid gearup geomancy guardsplit guardswap
healbell healblock heartswap iondeluge luckychant magiccoat magicpowder magicroom magneticflux matblock minimize miracleeye mist mudsport
nightmare noretreat octolock odorsleuth powder powershift powersplit powerswap powertrick psychoshift psychup purify recycle reflecttype
roleplay rototiller simplebeam skillswap snatch soak speedswap stockpile stuffcheeks swallow tarshot teatime telekinesis tidyup topsyturvy
transform trickortreat watersport wonderroom worryseed`.split(/\s+/));
const CANT: Record<string, string> = { slp: "^Asleep\\.", frz: "^Frozen\\.", taunt: "^Taunt: ", disable: "^Disable: ", imprison: "^Imprison: " };

type Row = {
  id: string; game: Case["game"]; title: string; checks: string; field?: Case["field"]; exact: boolean;
  slots: Record<SlotId, unknown>; hp: Record<SlotId, unknown>; steps: Record<string, unknown>;
  weatherTurns?: number; canSwitch?: Case["canSwitch"]; end?: unknown; effects?: unknown[]; swapped?: unknown; outcomes?: unknown;
  entryOrder?: Case["entryOrder"]; fieldTurns?: Case["fieldTurns"];
  // status2 wave 1b (Track V2): the battle's history inputs and the copied uses.
  battleLastMove?: Case["battleLastMove"]; faintedLastTurn?: Case["faintedLastTurn"]; echoedVoice?: Case["echoedVoice"];
  copies?: { slot: SlotId; copied: "Dancer" | "Instruct"; moveId: string; picked: number; moves: number; source: number }[];
  // status2 wave 2 (Track R-V): the bench, the replacement, and the switch-outs (verify/compare.ts compareBench).
  bench?: Case["bench"]; replacement?: Case["replacement"]; r?: unknown;
};
const catalogs = Object.fromEntries(Object.entries(GAME_RUNTIME).map(([game, id]) => {
  const file = id === "champions" ? "data/champions/catalog.json" : `data/battle/${id}/catalog.json`;
  return [game, new Map((JSON.parse(fs.readFileSync(file, "utf8")).moves as { id: string; category: string }[]).map((m) => [m.id, m.category]))];
})) as Record<Case["game"], Map<string, string>>;
/**
 * status2 integration 1b: whether a step's move as used is a status move: its own, or every move an Encore rewrite made it use
 * (the oracle's |effective|<name> lines; verify/compare.ts compares an Encore rewrite as the move used).
 */
function usedStatus(c: Case, s: { moveId: string; lines: Record<string, number> }): boolean {
  if (catalogs[c.game].get(s.moveId) === "Status") return true;
  const used = Object.keys(s.lines).map((line) => /^\|effective\|(.+)$/.exec(line)?.[1]).filter((name): name is string => !!name)
    .map((name) => name.toLowerCase().replace(/[^a-z0-9]+/g, ""));
  return used.length > 0 && used.every((id) => catalogs[c.game].get(id) === "Status");
}
/** status2's E2 volatiles (compare.ts STATUS2_VOLATILES). */
const STATUS2_VOLATILES = ["stockpile", "powertrick", "powershift", "noretreat", "minimize", "gastroacid", "transform", "trapped", "twoturnmove",
  "attract", "octolock", "tarshot", "foresight", "miracleeye", "telekinesis", "embargo", "nightmare", "glaiverush", "healblock", "lockon"];
const TURNS = ["healblock", "embargo", "telekinesis", "taunt", "encore", "disable"] as const;
const mix = (x: Record<string, number> | undefined, key: (k: string) => string = (k) => k) => {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(x ?? {})) out[key(k)] = num((out[key(k)] ?? 0) + v);
  return out;
};
/** The status2 E2 state of one oracle slot (compare.ts compareOutcomeState2's expectations). */
function state2(o: SlotResult) {
  const turnsLeft: Record<string, Record<string, number>> = {};
  for (const v of TURNS) {
    const want: Record<string, number> = {};
    for (const [k, p] of Object.entries(o.durations ?? {}) as [string, number][]) if (k.startsWith(`${v}:`)) want[k.split(":")[1]] = num(p);
    turnsLeft[v] = want;
  }
  return {
    ability: mix(o.ability, toID), species: mix(o.forme, toID), types: mix(o.types), stockpile: mix(o.stockpile), stored: mix(o.stored),
    lastItem: mix(o.lastItem), turnsLeft, pendingCopy: mix(o.pendingCopy), berryLocked: num(o.berryLocked ?? 0),
    volatiles: Object.fromEntries(STATUS2_VOLATILES.map((v) => [v, num(o.volatiles?.[v] ?? 0)])),
    stages: Object.fromEntries(Object.entries(o.boosts ?? {}).filter(([k]) => /^(accuracy|evasion):/.test(k) && !k.endsWith(":0")).map(([k, v]) => [k, num(v)])),
  };
}
/** status2 wave 2: an Expected as the generated test's HP check (low, high, min, max, average, KO chance; start and maximum). */
const hpRow = (e: { start: number; maximum: number; low: number; high: number; min: number; max: number; average: number; koChance: number }) =>
  ({ start: e.start, maximum: e.maximum, low: e.low, high: e.high, min: e.min, max: e.max, average: num(e.average), koChance: num(e.koChance) });
/** status2 wave 2 (verify/compare.ts compareBench, compareEnteredHits, compareOutcomeNewcomers): a bench case's expectations. */
function benchRow(c: Case, r: OracleResult, walk: WalkResult) {
  type Rep = NonNullable<OracleResult["expectedReplaced"]>;
  type Ent = NonNullable<OracleResult["expectedEntered"]>;
  const rep = (x: Rep | null | undefined) => Object.fromEntries(Object.entries(x ?? {}).map(([slot, v]) => [slot, {
    left: v!.left.map((l) => ({ id: l.id, chance: num(l.chance), ...hpRow(l) })), entered: v!.entered.map((e) => ({ id: e.id, chance: num(e.chance) })),
  }]));
  const ent = (x: Ent | null | undefined) => Object.fromEntries(Object.entries(x ?? {}).map(([slot, byId]) => [slot, Object.fromEntries(Object.entries(byId ?? {}).map(([id, e]) => [id, hpRow(e)]))]));
  const hits = Object.fromEntries(Object.entries(walk.steps).filter(([, s]) => s?.hitsEntered && !usedStatus(c, s)).map(([slot, s]) => [slot, Object.entries(s!.hitsEntered!).flatMap(([target, byId]) =>
    Object.entries(byId ?? {}).filter(([, h]) => h.reached > 0).map(([id, h]) => ({
      slot: target, id, reached: num(h.reached), koChance: num(h.ko),
      ...(h.landed > 0 && h.dmgMax !== null && h.dmgMax > 0 && !h.sub ? ((h.truncated ?? 0) > 0 ? { kind: "calculated" } : { min: h.dmgMin, max: h.dmgMax }) : h.landed === 0 ? { kind: "blocked" } : {}),
    })))]));
  // The default replacement's facts: each slot whose player's switch-out happened without Case.replacement.
  const chosen = new Set<string>();
  for (const table of [walk.replaced, walk.afterTurn?.replaced]) {
    for (const [slot, x] of Object.entries(table ?? {})) if (x!.entered.some((e) => (e.chosen ?? 0) > 1e-12) && !c.replacement?.[slot as SlotId]) chosen.add(slot);
  }
  const after = !c.endNotEstimated && r.afterTurn;
  const e2 = (after ? walk.afterTurn?.entered : walk.entered) ?? {};
  const newcomers = Object.fromEntries(Object.entries(e2).map(([slot, byId]) => [slot, Object.fromEntries(Object.entries(byId ?? {}).map(([id, e]) => [id, {
    chance: num(e.chance), hp: e.dist.map(([h, p]) => [h, num(p * e.chance)]), item: mix(e.item),
    ...(e.koChance === 0 ? { status: mix(e.status), stages: mix(e.boosts), volatiles: mix(Object.fromEntries(Object.entries(e.volatiles ?? {}).filter(([v]) => NEWCOMER_VOLATILES.includes(v)))) } : {}),
  }]))]));
  return {
    replaced: rep(r.expectedReplaced), hpEntered: ent(r.expectedEntered),
    ...(after ? { endReplaced: rep(r.afterTurnReplaced), endHpEntered: ent(r.afterTurnEntered) } : {}),
    hits, defaultFacts: chosen.size, ...(c.outcomes ? { newcomers } : {}),
  };
}
const NEWCOMER_VOLATILES = ["confusion", "taunt", "encore", "yawn", "leechseed", "perishsong", "substitute", "curse", "saltcure", "aquaring", "ingrain", "partiallytrapped", "focusenergy", "magnetrise"];
const rows: Row[] = [];
let skipped = 0;
for (const c of CASES) {
  if (c.notEstimated) continue;
  if (!BASE.has(c.id) && !SE.has(c.id)) continue;
  if (!all && agreeing && !agreeing.has(c.id) && !KEEP.has(c.id)) { skipped++; continue; }
  const file = path.join(RESULTS, `${c.id}.json`);
  if (!fs.existsSync(file)) { console.log(`skip ${c.id}: no results`); continue; }
  const r = JSON.parse(fs.readFileSync(file, "utf8")) as OracleResult;
  const exhaustive = path.join(RESULTS, `${c.id}.all.json`);
  const allWalk: WalkResult = fs.existsSync(exhaustive) ? JSON.parse(fs.readFileSync(exhaustive, "utf8")) : r.walks.all;
  const slots = Object.fromEntries(SLOTS.map((slot) => {
    const m = c.slots[slot];
    const { action, ...mon } = m;
    return [slot, { ...mon, move: action.move, ...(action.target ? { target: action.target } : {}), ...(action.context ? { context: action.context } : {}), ...(action.switchIn ? { switchIn: true } : {}) }];
  })) as Record<SlotId, unknown>;
  const hpOf = (walk: Record<SlotId, { start: number; maximum: number; min: number; max: number; average: number; koChance: number }>, lowest: Record<SlotId, { modeTieUp: number }>, highest: Record<SlotId, { modeTieDown: number }>, slot: SlotId) => {
    const a = walk[slot];
    return { low: lowest[slot].modeTieUp, high: highest[slot].modeTieDown, min: a.min, max: a.max, average: num(a.average), koChance: num(a.koChance) };
  };
  const hp = Object.fromEntries(SLOTS.map((slot) => {
    if (c.slots[slot].absent) return [slot, null];
    const a = allWalk.slots[slot];
    const fbm = allWalk.steps[slot]?.faintedAtPick ?? 0;
    return [slot, {
      start: a.start, maximum: a.maximum, ...hpOf(allWalk.slots, r.walks.lowest.slots, r.walks.highest.slots, slot), ...(fbm > 0 ? { faintsBeforeMoving: num(fbm) } : {}),
    }];
  })) as Record<SlotId, unknown>;
  const steps = Object.fromEntries(Object.entries(allWalk.steps).map(([slot, s]) => [slot, {
    moveId: s!.moveId, moves: num(s!.moved),
    order: Object.entries(s!.orderAll).map(([pos, p]) => [Number(pos), num(p)]),
    // A status move's targets are not damage hits (DoublesStep.hits lists the Pokémon a damaging move reaches); status2
    // integration 1b: an Encore rewrite into a status move (the oracle's |effective| line, verify/compare.ts) likewise.
    hits: Object.entries(s!.hits).filter(([, h]) => h!.reached > 0 && !usedStatus(c, s!)).map(([target, h]) => {
      const immune = s!.effects ? Object.keys(s!.effects[target as SlotId] ?? {}).some((k) => k.startsWith("immune"))
        : Object.keys(s!.lines).some((l) => l.startsWith(`|-immune|${{ "own-left": "p1a", "own-right": "p1b", "opponent-left": "p2b", "opponent-right": "p2a" }[target as SlotId]}: `));
      const sub = h!.sub && h!.sub.mass > 0 ? { substitute: { chance: num(h!.sub.mass), min: h!.sub.takenMin, max: h!.sub.takenMax, breaks: num(h!.sub.breaks) } } : {};
      // A hit into a Substitute: its damage fields are the hits that reached the Pokémon, so only the Substitute is fixed.
      if (sub.substitute) return { slot: target, reached: num(h!.reached), koChance: num(h!.ko), ...sub };
      // A multi-hit move whose hits stopped at this target's knockout (truncated): Showdown's sum covers the hits dealt, the
      // app's hit is the move's calculation (verify/compare.ts), so only its kind is fixed.
      const dealt = h!.landed > 0 && h!.dmgMax !== null && h!.dmgMax > 0;
      // status2 (integration 1a): a Berry the target ate between two hits (W's continuation): the kind only, as truncated.
      const ident = { "own-left": "p1a", "own-right": "p1b", "opponent-left": "p2b", "opponent-right": "p2a" }[target as SlotId];
      const between = Object.keys(s!.lines).some((l) => l.startsWith(`|-enditem|${ident}: `) && /\|(Ganlon|Apicot|Starf|Lansat) Berry\|\[eat\]$/.test(l));
      return { slot: target, reached: num(h!.reached), koChance: num(h!.ko), ...(dealt && ((h!.truncated ?? 0) > 0 || between) ? { kind: "calculated" } : dealt ? { min: h!.dmgMin, max: h!.dmgMax } : h!.landed === 0 ? { kind: immune ? "no-damage" : "blocked" } : {}) };
    }),
  }]));
  const row: Row = { id: c.id, game: c.game, title: c.title, checks: c.checks, ...(c.field ? { field: c.field } : {}), exact: allWalk.exact, slots, hp, steps };
  if (SE.has(c.id)) {
    if (c.weatherTurns !== undefined) row.weatherTurns = c.weatherTurns;
    if (c.canSwitch) row.canSwitch = c.canSwitch;
    // status2 wave 1a: the entry order and the field effects' turns left.
    if (c.entryOrder) row.entryOrder = c.entryOrder;
    if (c.fieldTurns) row.fieldTurns = c.fieldTurns;
    // status2 wave 1b.
    if (c.battleLastMove !== undefined) row.battleLastMove = c.battleLastMove;
    if (c.faintedLastTurn) row.faintedLastTurn = c.faintedLastTurn;
    if (c.echoedVoice !== undefined) row.echoedVoice = c.echoedVoice;
    // The copied uses (a Dancer's copy, an instructed move), in turn order: the source's mean position.
    const copies = Object.values(allWalk.copies ?? {});
    if (copies.length) {
      const meanPos = (slot?: SlotId) => {
        const st = slot ? allWalk.steps[slot] : undefined;
        const total = st ? Object.values(st.orderAll).reduce((a, x) => a + x, 0) : 0;
        return st && total ? Object.entries(st.orderAll).reduce((a, [pos, x]) => a + Number(pos) * x, 0) / total : 0;
      };
      row.copies = copies.map((x) => ({ slot: x.slot, copied: x.copied, moveId: x.moveId, picked: num(x.picked), moves: num(x.moved), source: num(meanPos(x.source)) })).sort((a, b) => a.source - b.source);
    }
    // status2 wave 2 (Track R-V): a case with a bench: its bench and replacement, and verify/compare.ts compareBench's
    // expectations (the leavers and newcomers after the moves and the turn, the newcomers' hits and E2 state, the default
    // replacement's facts).
    if (c.bench && Object.values(c.bench).some((b) => b?.members !== undefined)) {
      row.bench = c.bench;
      if (c.replacement) row.replacement = c.replacement;
      row.r = benchRow(c, r, allWalk);
    }
    // The end of turn.
    if (c.endNotEstimated) row.end = { reason: c.endNotEstimated };
    else if (r.afterTurn && r.walks.all.afterTurn && r.walks.lowest.afterTurn && r.walks.highest.afterTurn) {
      row.end = {
        hp: Object.fromEntries(SLOTS.map((slot) => [slot, c.slots[slot].absent ? null : hpOf(r.walks.all.afterTurn!.slots, r.walks.lowest.afterTurn!.slots, r.walks.highest.afterTurn!.slots, slot)])),
        residuals: (r.residuals ?? []).filter((x) => x.min !== null).map((x) => ({ slot: x.slot, ...(x.id ? { id: x.id } : {}), chance: num(x.chance), min: x.min, max: x.max, koChance: num(x.koChance) })),
      };
    }
    // Effect facts: statuses, stages, skipped moves (BeforeMove), the confusion self-hit, volatiles started.
    const effects: unknown[] = [];
    for (const [slot, s] of Object.entries(allWalk.steps) as [SlotId, NonNullable<WalkResult["steps"][SlotId]>][]) {
      const status = catalogs[c.game].get(s.moveId) === "Status";
      for (const [key, mass] of Object.entries(s.effects?.[slot] ?? {})) {
        const cant = /^cant:(\w+)$/.exec(key)?.[1];
        if (cant && CANT[cant] && !(cant === "slp" && ["snore", "sleeptalk"].includes(s.moveId))) effects.push({ slot, on: "skipped", match: CANT[cant], chance: num(mass) });
      }
      // status2 (integration 1a): the share Disguise took (activate:disguise with damage:confusion:0) has its own fact, no range.
      const own = s.effects?.[slot] ?? {};
      const disguised = own["activate:disguise"] ? own["damage:confusion:0"] ?? 0 : 0;
      if (s.selfHit && s.selfHit.mass - disguised > 1e-9) effects.push({ slot, on: "skipped", match: `hurts itself in confusion: ${s.selfHit.min === s.selfHit.max ? s.selfHit.min : `${s.selfHit.min}–${s.selfHit.max}`} HP`, chance: num(s.selfHit.mass - disguised), flags: "i" });
      if (disguised > 0) effects.push({ slot, on: "skipped", match: "hurts itself in confusion; disguise takes the hit", chance: num(disguised), flags: "i" });
      if (!status || L_MOVES.has(s.moveId)) continue;
      for (const [target, keys] of Object.entries(s.effects ?? {}) as [SlotId, Record<string, number>][]) {
        for (const [key, mass] of Object.entries(keys)) {
          const st = /^status:(\w+)$/.exec(key);
          const bo = /^boost:(\w+):(-?\d+)$/.exec(key);
          const text = st && STATUS_GIVEN[st[1]] ? STATUS_GIVEN[st[1]] : bo && STAGE_NAMES[bo[1]] && Number(bo[2]) !== 0 ? `${signed(Number(bo[2]))} ${STAGE_NAMES[bo[1]]}.` : null;
          // A status given is "Is paralysed." on a hit and "{Name} is paralysed." in a step fact (Synchronize): case-insensitive.
          // A stage in a list ("copies +2 Attack, +2 Speed.", status2's copy facts) ends with a comma.
          const match = text?.replace(/[.+]/g, (ch) => `\\${ch}`).replace(/\\\.$/, bo ? "[.,]" : "\\.");
          if (text) effects.push({ slot, target, on: "facts", match, flags: st ? "i" : "", chance: num(mass) });
        }
      }
    }
    if (effects.length) row.effects = effects;
    if (allWalk.swapped) row.swapped = Object.fromEntries(Object.entries(allWalk.swapped).map(([k, v]) => [k, num(v!)]));
    if (c.outcomes) {
      const after = r.walks.all.afterTurn && r.walks.all.afterTurn.noResidual === 0 ? r.walks.all.afterTurn.slots : null;
      // An end of turn the app does not estimate (endNotEstimated): E2 is after the moves, so the oracle's state after the moves.
      const applied = !!after && !c.endNotEstimated;
      const source = applied ? after! : r.walks.all.slots;
      row.outcomes = {
        applied,
        mons: Object.fromEntries(SLOTS.filter((slot) => !c.slots[slot].absent).map((slot) => {
          const o = source[slot];
          return [slot, {
            item: Object.fromEntries(Object.entries(o.item ?? {}).map(([k, v]) => [k, num(v)])),
            substitute: (o.sub ?? []).map(([h, p]) => [h, num(p)]),
            // After the moves E2 lists what the next turn reads (doubles-eot.ts outcomeMon): a carried Yawn resolves at this turn's end (compare.ts).
            volatiles: Object.fromEntries(["confusion", "taunt", "encore", "yawn", "leechseed", "perishsong", "substitute", "curse", "saltcure", "aquaring", "ingrain", "partiallytrapped"].map((v) => [v, !applied && v === "yawn" && c.slots[slot].carried?.yawn ? 0 : num(o.volatiles?.[v] ?? 0)])),
            perish: Object.fromEntries(Object.entries(o.perish ?? {}).map(([k, v]) => [k, num(v)])),
            stages: Object.fromEntries(Object.entries(o.boosts ?? {}).filter(([k]) => ["atk", "def", "spa", "spd", "spe"].includes(k.split(":")[0])).map(([k, v]) => [k, num(v)])),
            swapped: num(o.swapped ?? 0),
            // The status of a Pokémon that never faints (compare.ts: the oracle's mixture is not split by HP otherwise).
            ...(o.status && o.koChance === 0 ? { status: Object.fromEntries(Object.entries(o.status).map(([k, v]) => [k, num(v)])) } : {}),
            // status2 wave 1a (compare.ts compareOutcomeState2): only from a result this harness wrote (types recorded) and a
            // Pokémon that never faints.
            ...(o.types && o.koChance === 0 ? { s2: state2(o) } : {}),
          }];
        })),
        hazards: Object.fromEntries((["own", "opponent"] as const).map((side) => [side, Object.fromEntries(["stealthrock", "spikes", "toxicspikes", "stickyweb"].map((h) => [h, num(r.walks.all.sideConditions?.[side]?.[h] ?? 0)]))])),
      };
    }
  }
  rows.push(row);
}

const header = `import { describe, expect, it } from "vitest";
import { calculateDoublesOutcomes, calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import { doublesTargetRule } from "@/app/lib/battle/doubles-targets";
import type { DoublesBenchPokemon, DoublesCarried, DoublesFact, DoublesHazards, DoublesHP, DoublesOutcome, DoublesOutcomeMon, DoublesPokemonInput, DoublesReplaced, DoublesSlotId, DoublesTurnInput, DoublesTurnResult } from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { buildTypes } from "@/app/lib/battle/mechanics";
import { createBuild, createConditions, createSide, defaultAbilityActive } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, BattleGame, MoveContext, SideConditions } from "@/app/lib/battle/types";

/**
 * The whole turn against pinned Showdown c23d2e94 (SPEC §8.2; status-eot SPEC §7). Each case's values are the exact oracle of
 * scripts/.cache/calc-audit/2v2/verify/sim-dfs.ts: one real doubles turn per case with every damage roll, speed tie, Quick Claw,
 * Quick Draw, full paralysis, sleep and confusion length, Healer, Shed Skin, random target and hit count enumerated with its
 * weight, every move hitting, no critical hit unless certain or the field's, added effects below 100% failing. HP is read
 * when the residual is picked (after the moves) and once the turn has ended (after the residual, the final Update and
 * Emergency Exit). low and high are the most likely HP when every roll is the lowest (ties to the higher HP) or the highest
 * (ties to the lower HP), every other branch kept. Damage min and max are the action's getDamage values into that slot (all
 * its hits), uncapped. A hidden sleep or confusion counter consistent with the public count is mixed by its prior weight.
 * Level 50, 31 IVs, Serious nature and 0 EVs / Stat Points unless set; Champions sets give Stat Points. Generated by
 * verify/gen-tests.ts from verify/results, from the cases that agree with the app (verify/compare.ts).
 */
type Stat = "hp" | "atk" | "def" | "spa" | "spd" | "spe";
type Carried = Omit<DoublesCarried, "trap" | "futureMove" | "cudChew" | "ppLeft"> & {
  trap?: { source: DoublesSlotId; bindingBand: boolean; move?: string }; cudChew?: true | string; ppLeft?: Record<string, number>;
  // status2 wave 1b: a landing from a Pokémon of the turn, or from one not in battle (its set: the input's build).
  futureMove?: string | { move: "futuresight" | "doomdesire"; source: DoublesSlotId } | { move: "futuresight" | "doomdesire"; bench: Omit<Mon, "move">; benchSide: "own" | "opponent"; fainted?: true; terastallized?: string }
    | { move: "futuresight" | "doomdesire"; benchId: string; benchSide: "own" | "opponent" };
};
type Mon = {
  species: string; appSpecies?: string; ability: string; item?: string; nature?: string; evs?: Partial<Record<Stat, number>>;
  ivs?: Partial<Record<Stat, number>>; level?: number; hp?: number; status?: BattleBuild["status"];
  boosts?: Partial<Record<Exclude<Stat, "hp">, number>>; teraType?: string; choice?: "mega" | "terastallize" | "dynamax" | "zmove";
  charged?: boolean; appBuild?: Record<string, unknown>; absent?: boolean; gender?: string; gigantamax?: boolean;
  carried?: Carried; substitute?: number; moves?: string[]; lastMove?: string | null;
  move: string | null; target?: DoublesSlotId; context?: MoveContext;
  // status2 Step 1: what happened earlier this turn (#11), a switch-in (#14) with the stages after its entry (appBoosts), a
  // status the oracle sets silently (#9: the app reads the status as given).
  earlierThisTurn?: { statsRaised?: true; statsLowered?: true; usedItem?: true }; switchIn?: true;
  appBoosts?: Partial<Record<Exclude<Stat, "hp">, number>>; silentStatus?: true;
  // status2 wave 1a: types and the added type from an earlier turn, the last item, not its first turn.
  types?: string[]; addedType?: "Grass" | "Ghost"; lastItem?: string | null; firstTurn?: boolean;
  // status2 wave 1b: the target of its last move (Instruct); the oracle's move slots exactly its moves (Sleep Talk).
  lastMoveTarget?: DoublesSlotId | null; exactMoves?: true;
};
/**
 * hazards (status2 Step 1 #7): on the side before the turn; status2 wave 2: also the input's (DoublesTurnInput.hazards, with
 * Spikes and Toxic Spikes layers). The app reports E2 sides.hazardsFrom.
 */
type Side = { tailwind?: boolean; reflect?: boolean; lightScreen?: boolean; auroraVeil?: boolean; hazards?: string[]; layers?: { spikes?: 1 | 2 | 3; toxicSpikes?: 1 | 2 }; safeguard?: boolean; mist?: boolean; luckyChant?: boolean; gmaxResidual?: SideConditions["gmaxResidual"] };
type Field = Partial<Pick<BattleConditions, "weather" | "terrain" | "trickRoom" | "gravity" | "wonderRoom" | "magicRoom" | "critical" | "mudSport" | "waterSport">> & { own?: Side; opponent?: Side };
type Range = { low: number; high: number; min: number; max: number; average: number; koChance: number };
type HP = Range & { start: number; maximum: number; faintsBeforeMoving?: number };
type Hit = { slot: DoublesSlotId; reached: number; koChance: number; min?: number; max?: number; kind?: "blocked" | "no-damage" | "calculated"; substitute?: { chance: number; min: number; max: number; breaks: number } };
type Step = { moveId: string; moves: number; order: [number, number][]; hits: Hit[] };
type Residual = { slot: DoublesSlotId; id?: string; chance: number; min: number; max: number; koChance: number };
/** status2 wave 2: a bench member (DoublesBenchPokemon), its replacement table, and a bench case's expectations (verify/compare.ts compareBench). */
type Member = Omit<Mon, "move"> & { id: string };
type Bench = Partial<Record<"own" | "opponent", { status?: string; ability?: string; members?: Member[] }>>;
type HPRow = Range & { start: number; maximum: number };
type Replaced = Partial<Record<DoublesSlotId, { left: (HPRow & { id: string; chance: number })[]; entered: { id: string; chance: number }[] }>>;
type Entered = Partial<Record<DoublesSlotId, Record<string, HPRow>>>;
type EnteredHit = { slot: DoublesSlotId; id: string; reached: number; koChance: number; min?: number; max?: number; kind?: "blocked" | "calculated" };
type Newcomer = { chance: number; hp: [number, number][]; item: Record<string, number>; status?: Record<string, number>; stages?: Record<string, number>; volatiles?: Record<string, number> };
type BenchRow = {
  replaced: Replaced; hpEntered: Entered; endReplaced?: Replaced; endHpEntered?: Entered; hits: Partial<Record<DoublesSlotId, EnteredHit[]>>; defaultFacts: number;
  newcomers?: Partial<Record<DoublesSlotId, Record<string, Newcomer>>>;
};
type End = { reason: string } | { hp: Record<DoublesSlotId, Range | null>; residuals: Residual[] };
type Effect = { slot: DoublesSlotId; target?: DoublesSlotId; on: "skipped" | "facts"; text?: string; match?: string; flags?: string; chance: number };
/** status2 wave 1a: E2's new state (verify/compare.ts compareOutcomeState2), from the oracle results this harness writes. */
type State2 = {
  ability: Record<string, number>; species: Record<string, number>; types: Record<string, number>; stockpile: Record<string, number>; stored: Record<string, number>;
  lastItem: Record<string, number>; turnsLeft: Record<string, Record<string, number>>; pendingCopy: Record<string, number>; berryLocked: number;
  volatiles: Record<string, number>; stages: Record<string, number>;
};
type OutcomeMon = { item: Record<string, number>; substitute: [number, number][]; volatiles: Record<string, number>; perish: Record<string, number>; stages: Record<string, number>; swapped: number; status?: Record<string, number>; s2?: State2 };
type Outcomes = { applied: boolean; mons: Partial<Record<DoublesSlotId, OutcomeMon>>; hazards: Record<"own" | "opponent", Record<string, number>> };
type Case = {
  id: string; game: "sv" | "swsh" | "usum" | "champions"; title: string; checks: string; field?: Field; exact: boolean;
  slots: Record<DoublesSlotId, Mon>; hp: Record<DoublesSlotId, HP | null>; steps: Partial<Record<DoublesSlotId, Step>>;
  weatherTurns?: number; canSwitch?: Partial<Record<"own" | "opponent", boolean>>; end?: End; effects?: Effect[];
  swapped?: Partial<Record<"own" | "opponent", number>>; outcomes?: Outcomes;
  entryOrder?: DoublesTurnInput["entryOrder"]; fieldTurns?: DoublesTurnInput["fieldTurns"];
  battleLastMove?: string | null; faintedLastTurn?: DoublesTurnInput["faintedLastTurn"]; echoedVoice?: DoublesTurnInput["echoedVoice"];
  copies?: { slot: DoublesSlotId; copied: "Dancer" | "Instruct"; moveId: string; picked: number; moves: number; source: number }[];
  bench?: Bench; replacement?: Partial<Record<DoublesSlotId, string>>; r?: BenchRow;
};

const GAMES: Record<Case["game"], BattleGame> = { sv: "scarlet_violet", swsh: "sword_shield", usum: "ultra_sun_ultra_moon", champions: "champions" };
const SLOTS: DoublesSlotId[] = ["own-left", "own-right", "opponent-left", "opponent-right"];
const id = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");
const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

/** The app build for an oracle set: Showdown names as ids, EVs (native) or Stat Points (Champions), the start state. */
function build(m: Mon, runtime: BattleRuntime): BattleBuild {
  const base = createBuild(m.appSpecies ?? id(m.species), runtime);
  const abilityId = id(m.ability);
  const shared = {
    nature: m.nature ?? "Serious", abilityId, abilityActive: defaultAbilityActive(abilityId), itemId: id(m.item ?? ""),
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...(m.appBoosts ?? m.boosts) }, currentHP: m.hp ?? null, status: m.status ?? "",
  };
  const configuration = { ...base.configuration, ...(m.teraType ? { teraType: m.teraType } : {}), ...(m.gender === "M" || m.gender === "F" ? { gender: m.gender } : {}) };
  const mechanic = m.choice === "terastallize" ? { mechanic: "tera" as const } : m.choice === "dynamax" ? { mechanic: "dynamax" as const } : {};
  const trained = base.game === "champions"
    ? { ...base, ...shared, points: { ...ZERO, ...m.evs } }
    : { ...base, ...shared, native: { level: m.level ?? 50, evs: { ...ZERO, ...m.evs }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31, ...m.ivs } } };
  const typed = { ...(m.types ? { types: [...m.types] } : {}), ...(m.addedType ? { addedType: m.addedType } : {}) };
  // status2 wave 1b: an appBuild configuration (G-Max's dynamaxLevel, gigantamax) adds to the set's gender and Tera type.
  const merged = { ...configuration, ...((m.appBuild?.configuration ?? {}) as Record<string, unknown>) };
  return { ...trained, ...mechanic, ...typed, ...m.appBuild, ...(Object.keys(merged).length ? { configuration: merged } : {}) } as BattleBuild;
}
/** status2 wave 1b: a landing's user (verify/app-turn.ts caseCarried): a slot, or the build of one not in battle. */
function landing(fm: NonNullable<Carried["futureMove"]>, runtime: BattleRuntime, c?: Case): DoublesCarried["futureMove"] {
  if (typeof fm === "string") return id(fm);
  if ("source" in fm) return { move: fm.move, source: fm.source };
  // status2 wave 2: its user is a bench member (its build as it is on the bench).
  if ("benchId" in fm) {
    const member = c?.bench?.[fm.benchSide]?.members?.find((x) => x.id === fm.benchId);
    if (!member) throw new Error(\`no bench member \${fm.benchId}\`);
    return { move: fm.move, build: build({ ...member, move: null }, runtime) };
  }
  const bench: Mon = { ...fm.bench, move: null };
  return { move: fm.move, build: build(fm.terastallized ? { ...bench, teraType: fm.terastallized, choice: "terastallize" } : bench, runtime) };
}
/** The state from earlier turns (verify/app-turn.ts caseCarried). */
function carried(m: Mon, runtime: BattleRuntime, c?: Case): DoublesCarried | undefined {
  const { trap, futureMove, charging, encore, disable, cudChew, ppLeft, ...rest } = m.carried ?? {};
  const out: DoublesCarried = {
    ...rest, ...(trap ? { trap: { source: trap.source, bindingBand: trap.bindingBand, move: id(trap.move ?? "Fire Spin") } } : {}), ...(futureMove ? { futureMove: landing(futureMove, runtime, c) } : {}),
    ...(cudChew ? { cudChew: cudChew === true ? true : id(cudChew) } : {}), ...(ppLeft ? { ppLeft: Object.fromEntries(Object.entries(ppLeft).map(([k, v]) => [id(k), v])) } : {}),
    ...(charging ? { charging: id(charging) } : {}), ...(encore ? { encore: { move: id(encore.move), turns: encore.turns } } : {}), ...(disable ? { disable: { move: id(disable.move), turns: disable.turns } } : {}),
    ...(m.substitute !== undefined ? { substitute: m.substitute } : {}),
  };
  return Object.keys(out).length ? out : undefined;
}
function side(s: Side | undefined) {
  return {
    ...createSide(), tailwind: !!s?.tailwind, reflect: !!s?.reflect, lightScreen: !!s?.lightScreen, auroraVeil: !!s?.auroraVeil,
    ...(s?.safeguard ? { safeguard: true } : {}), ...(s?.mist ? { mist: true } : {}), ...(s?.luckyChant ? { luckyChant: true } : {}),
    ...(s?.gmaxResidual?.length ? { gmaxResidual: [...s.gmaxResidual] } : {}),
  };
}
async function input(c: Case): Promise<DoublesTurnInput> {
  const runtime = await loadBattleRuntime(GAMES[c.game]);
  const f = c.field ?? {};
  const field: BattleConditions = {
    ...createConditions(), gameType: "Doubles", weather: f.weather ?? "", terrain: f.terrain ?? "", critical: !!f.critical,
    trickRoom: !!f.trickRoom, gravity: !!f.gravity, wonderRoom: !!f.wonderRoom, magicRoom: !!f.magicRoom,
    attackerSide: side(f.own), defenderSide: side(f.opponent),
    ...(f.mudSport ? { mudSport: true } : {}), ...(f.waterSport ? { waterSport: true } : {}),
  };
  const pokemon = Object.fromEntries(SLOTS.map((slot) => {
    const m = c.slots[slot];
    if (m.absent) return [slot, null];
    const moveId = m.move === null ? null : id(m.move);
    const context: MoveContext = { ...(m.choice === "zmove" ? { useZ: true } : {}), ...m.context };
    const state = carried(m, runtime, c);
    const entry: DoublesPokemonInput = {
      build: build(m, runtime), contexts: moveId && Object.keys(context).length ? { [moveId]: context } : {}, charged: !!m.charged,
      action: { moveId, target: m.target ?? null },
      ...(state ? { carried: state } : {}),
      ...(m.lastMove !== undefined ? { lastMove: m.lastMove === null ? null : id(m.lastMove) } : {}),
      ...(m.moves ? { moves: [...new Set([...(moveId ? [moveId] : []), ...m.moves.map(id)])] } : {}),
      ...(m.switchIn ? { switchedIn: true as const } : {}),
      ...(m.earlierThisTurn && Object.keys(m.earlierThisTurn).length ? { earlierThisTurn: { ...m.earlierThisTurn } } : {}),
      ...(m.lastItem !== undefined ? { lastItem: m.lastItem === null ? null : id(m.lastItem) } : {}),
      ...(m.firstTurn !== undefined ? { firstTurn: m.firstTurn } : {}),
      ...(m.lastMoveTarget !== undefined ? { lastMoveTarget: m.lastMoveTarget } : {}),
    };
    return [slot, entry];
  })) as Record<DoublesSlotId, DoublesPokemonInput | null>;
  const turn: DoublesTurnInput = {
    runtime, field, pokemon, ...(c.weatherTurns !== undefined ? { weatherTurns: c.weatherTurns } : {}),
    canSwitch: { own: c.canSwitch?.own ?? true, opponent: c.canSwitch?.opponent ?? true },
    ...(c.entryOrder ? { entryOrder: { ...c.entryOrder } } : {}), ...(c.fieldTurns ? { fieldTurns: { ...c.fieldTurns } } : {}),
    ...(c.battleLastMove !== undefined ? { battleLastMove: c.battleLastMove === null ? null : id(c.battleLastMove) } : {}),
    ...(c.faintedLastTurn ? { faintedLastTurn: { ...c.faintedLastTurn } } : {}), ...(c.echoedVoice !== undefined ? { echoedVoice: c.echoedVoice } : {}),
    // status2 wave 2: the bench (a side with members), the replacement and the hazards (verify/app-turn.ts caseBenchInput).
    ...benchInput(c, runtime),
  };
  // A move the app takes no chosen target for (self, ally-only, spread, random) gets none, whatever Showdown's choice aims at.
  for (const slot of SLOTS) {
    const entry = pokemon[slot];
    if (entry?.action.moveId && entry.action.target && doublesTargetRule(turn, slot, entry.action.moveId).kind !== "choose") entry.action = { ...entry.action, target: null };
  }
  return turn;
}
const chanceOf = (facts: DoublesFact[], test: (text: string) => boolean) => facts.filter((f) => test(f.text)).reduce((s, f) => s + f.chance, 0);
const HAZARD_KEYS: Record<string, keyof DoublesHazards> = { stealthrock: "stealthRock", spikes: "spikes", toxicspikes: "toxicSpikes", stickyweb: "stickyWeb", gmaxsteelsurge: "steelsurge" };
/** status2 wave 2 (verify/app-turn.ts caseBenchInput): the bench members, the replacement and the hazards with their layers. */
function benchInput(c: Case, runtime: BattleRuntime): Pick<DoublesTurnInput, "bench" | "replacement" | "hazards"> {
  const bench: Partial<Record<"own" | "opponent", DoublesBenchPokemon[]>> = {};
  for (const sideId of ["own", "opponent"] as const) {
    const members = c.bench?.[sideId]?.members;
    if (!members) continue;
    bench[sideId] = members.map((m) => {
      const state = carried({ ...m, move: null }, runtime);
      const kept = { ...(state?.sleep ? { sleep: state.sleep } : {}), ...(state?.freeze ? { freeze: state.freeze } : {}), ...(state?.onceUsed ? { onceUsed: state.onceUsed } : {}) };
      return { id: m.id, build: build({ ...m, move: null }, runtime), ...(Object.keys(kept).length ? { carried: kept } : {}), ...(m.moves?.length ? { moves: [...new Set(m.moves.map(id))] } : {}) };
    });
  }
  const hazards: Partial<Record<"own" | "opponent", DoublesHazards>> = {};
  for (const sideId of ["own", "opponent"] as const) {
    const s = c.field?.[sideId];
    const out: DoublesHazards = {};
    for (const h of s?.hazards ?? []) {
      const key = HAZARD_KEYS[h];
      if (key === "spikes") out.spikes = s?.layers?.spikes ?? 1;
      else if (key === "toxicSpikes") out.toxicSpikes = s?.layers?.toxicSpikes ?? 1;
      else if (key) out[key] = true;
    }
    if (Object.keys(out).length) hazards[sideId] = out;
  }
  return {
    ...(Object.keys(bench).length ? { bench } : {}), ...(c.replacement && Object.keys(c.replacement).length ? { replacement: { ...c.replacement } } : {}),
    ...(Object.keys(hazards).length ? { hazards } : {}),
  };
}
/**
 * status2 wave 2 (verify/compare.ts compareBench, compareEnteredHits, compareOutcomeNewcomers): a bench case's switch-outs and
 * newcomers (DoublesTurnResult.replaced, hpEntered, the end of turn's), the hits on a newcomer (DoublesHit.id), the default
 * replacement's facts, and E2's newcomers (mons[slot].id, benched).
 */
function checkBench(c: Case, result: Extract<DoublesTurnResult, { status: "ready" }>, close: (got: number, want: number, label: string) => void) {
  const r = c.r!;
  const hp = (got: DoublesHP | undefined, want: HPRow, label: string) => {
    expect(got, label).toBeDefined();
    expect({ start: got!.start, maximum: got!.maximum, low: got!.low, high: got!.high }, label).toEqual({ start: want.start, maximum: want.maximum, low: want.low, high: want.high });
    if (c.exact) expect({ min: got!.min, max: got!.max }, label).toEqual({ min: want.min, max: want.max });
    expect(got!.average, \`\${label} average\`).toBeCloseTo(want.average, c.exact ? 9 : 0);
    close(got!.koChance, want.koChance, \`\${label} KO chance\`);
  };
  const replaced = (got: Partial<Record<DoublesSlotId, DoublesReplaced>> | undefined, want: Replaced, label: string) => {
    expect(Object.keys(got ?? {}).sort(), \`\${c.id} \${label} slots\`).toEqual(Object.keys(want).sort());
    for (const [slot, w] of Object.entries(want) as [DoublesSlotId, NonNullable<Replaced[DoublesSlotId]>][]) {
      const g = got![slot]!;
      expect(g.left.map((l) => l.id).sort(), \`\${c.id} \${label} \${slot} left\`).toEqual(w.left.map((l) => l.id).sort());
      for (const l of w.left) {
        const a = g.left.find((x) => x.id === l.id)!;
        close(a.chance, l.chance, \`\${c.id} \${label} \${slot} left \${l.id} chance\`);
        hp(a.hp, l, \`\${c.id} \${label} \${slot} left \${l.id}\`);
      }
      expect(g.entered.map((e) => e.id).sort(), \`\${c.id} \${label} \${slot} entered\`).toEqual(w.entered.map((e) => e.id).sort());
      for (const e of w.entered) close(g.entered.find((x) => x.id === e.id)!.chance, e.chance, \`\${c.id} \${label} \${slot} entered \${e.id}\`);
    }
  };
  const entered = (got: Partial<Record<DoublesSlotId, Record<string, DoublesHP>>> | undefined, want: Entered, label: string) => {
    expect(Object.entries(got ?? {}).flatMap(([slot, byId]) => Object.keys(byId ?? {}).map((id) => \`\${slot}|\${id}\`)).sort(), \`\${c.id} \${label}\`)
      .toEqual(Object.entries(want).flatMap(([slot, byId]) => Object.keys(byId ?? {}).map((id) => \`\${slot}|\${id}\`)).sort());
    for (const [slot, byId] of Object.entries(want) as [DoublesSlotId, Record<string, HPRow>][]) for (const [id, w] of Object.entries(byId)) hp(got![slot]![id], w, \`\${c.id} \${label} \${slot}|\${id}\`);
  };
  replaced(result.replaced, r.replaced, "replaced");
  entered(result.hpEntered, r.hpEntered, "hpEntered");
  if (r.endReplaced && result.endOfTurn.status === "ready") {
    replaced(result.endOfTurn.replaced, r.endReplaced, "endOfTurn.replaced");
    entered(result.endOfTurn.hpEntered, r.endHpEntered ?? {}, "endOfTurn.hpEntered");
  }
  for (const [slot, hits] of Object.entries(r.hits) as [DoublesSlotId, EnteredHit[]][]) {
    const step = result.steps.find((s) => s.slot === slot && !s.copied)!;
    for (const hit of hits) {
      const got = step.hits.find((h) => h.slot === hit.slot && h.id === hit.id);
      const label = \`\${c.id} \${slot} → \${hit.slot}|\${hit.id}\`;
      expect(got, label).toBeDefined();
      close(got!.reached, hit.reached, \`\${label} reached\`);
      close(got!.koChance, hit.koChance, \`\${label} KO chance\`);
      if (hit.kind) expect(got!.kind === hit.kind || (hit.kind === "blocked" && got!.kind === "no-damage"), \`\${label} \${got!.kind}\`).toBe(true);
      if (hit.min !== undefined) expect({ kind: got!.kind, min: got!.min, max: got!.max }, label).toEqual({ kind: "calculated", min: hit.min, max: hit.max });
    }
  }
  expect(result.facts.filter((f) => /^Assumes .+ comes in for .+\\.$/.test(f)).length, \`\${c.id} the default replacement's facts\`).toBe(r.defaultFacts);
}
/** status2 wave 2: the outcomes with each slot's entry its starting Pokémon (the leaver of DoublesOutcome.benched where it left). */
function identity(outcomes: DoublesOutcome[]): DoublesOutcome[] {
  return outcomes.map((o) => ({
    ...o, mons: Object.fromEntries(SLOTS.flatMap((slot) => {
      const m = o.mons[slot];
      if (!m?.id) return m ? [[slot, m]] : [];
      const left = o.benched?.[slot.startsWith("own") ? "own" : "opponent"]?.find((b) => b.id === \`slot:\${slot}\`);
      return left ? [[slot, left]] : [];
    })),
  }));
}
/** status2 wave 2: each newcomer's E2 state (its occupant entry with its id, or benched again). */
function checkNewcomers(c: Case, outcomes: DoublesOutcome[], close: (got: number, want: number, label: string) => void) {
  for (const [slot, byId] of Object.entries(c.r?.newcomers ?? {}) as [DoublesSlotId, Record<string, Newcomer>][]) {
    for (const [who, want] of Object.entries(byId)) {
      const monOf = (o: DoublesOutcome): DoublesOutcomeMon | undefined => o.mons[slot]?.id === who ? o.mons[slot] : o.benched?.[slot.startsWith("own") ? "own" : "opponent"]?.find((b) => b.id === who && b.slot === slot);
      const mass = (f: (m: DoublesOutcomeMon) => number) => outcomes.reduce((s, o) => { const m = monOf(o); return s + (m ? o.chance * f(m) : 0); }, 0);
      const label = \`\${c.id} E2 \${slot}|\${who}\`;
      close(mass(() => 1), want.chance, \`\${label} came in\`);
      for (const [h, p] of want.hp) close(mass((m) => m.hp.find((x) => x.hp === h)?.chance ?? 0), p, \`\${label} hp \${h}\`);
      for (const [item, p] of Object.entries(want.item)) close(mass((m) => ((m.build.itemId ?? "") === item ? 1 : 0)), p, \`\${label} item \${item || "(none)"}\`);
      for (const [status, p] of Object.entries(want.status ?? {})) close(mass((m) => ((m.build.status ?? "") === status ? 1 : 0)), p, \`\${label} status \${status || "(none)"}\`);
      for (const [key, p] of Object.entries(want.stages ?? {})) {
        const [stat, n] = key.split(":");
        close(mass((m) => ((stat === "accuracy" || stat === "evasion" ? m.stages?.[stat] : (m.build.boosts as Record<string, number | undefined>)[stat]) === Number(n) ? 1 : 0)), p, \`\${label} stage \${key}\`);
      }
      for (const [v, p] of Object.entries(want.volatiles ?? {})) close(mass((m) => (m.volatiles?.includes(v) ? 1 : 0)), p, \`\${label} volatile \${v}\`);
    }
  }
}

/**
 * status2 E2 (verify/compare.ts compareOutcomeState2), each mixture both ways: ability, species, types, Stockpile, stored
 * stats, the last item (where reported), turns left, a pending copy, the Berserk lock, the status2 volatiles, the accuracy and
 * evasion stages.
 */
function checkState2(c: Case, slot: DoublesSlotId, want: State2, outcomes: DoublesOutcome[], runtime: BattleRuntime, close: (got: number, want: number, label: string) => void) {
  const mixture = (f: (m: DoublesOutcomeMon) => string | null) => {
    const out = new Map<string, number>();
    for (const o of outcomes) {
      const m = o.mons[slot];
      const k = m ? f(m) : null;
      if (k !== null) out.set(k, (out.get(k) ?? 0) + o.chance);
    }
    return out;
  };
  const both = (label: string, wanted: Record<string, number>, got: Map<string, number>) => {
    for (const k of new Set([...Object.keys(wanted), ...got.keys()])) close(got.get(k) ?? 0, wanted[k] ?? 0, \`\${c.id} \${slot} \${label} \${k || "(none)"}\`);
  };
  const mass = (f: (m: DoublesOutcomeMon) => boolean) => outcomes.reduce((s, o) => s + (o.mons[slot] && f(o.mons[slot]!) ? o.chance : 0), 0);
  const reported = (f: (m: DoublesOutcomeMon) => unknown) => outcomes.some((o) => o.mons[slot] && f(o.mons[slot]!) !== undefined);
  both("ability", want.ability, mixture((m) => m.build.abilityId ?? ""));
  both("species", want.species, mixture((m) => id(m.build.speciesId)));
  both("types", want.types, mixture((m) => buildTypes(m.build, runtime).join("/")));
  if (Object.keys(want.stockpile).length) both("stockpile", want.stockpile, mixture((m) => (m.stockpile ? \`\${m.stockpile.layers}:\${m.stockpile.def}:\${m.stockpile.spd}\` : null)));
  else expect(reported((m) => m.stockpile), \`\${c.id} \${slot} no Stockpile\`).toBe(false);
  const stored = Object.keys(want.stored);
  if (stored.length === 1 && reported((m) => m.build.storedStats)) {
    both("storedStats", want.stored, mixture((m) => (m.build.storedStats ? ["atk", "def", "spa", "spd", "spe"].map((k) => (m.build.storedStats as Record<string, number>)[k]).join("/") : stored[0])));
  }
  if (reported((m) => m.lastItem)) both("lastItem", want.lastItem, mixture((m) => m.lastItem ?? ""));
  for (const [v, wanted] of Object.entries(want.turnsLeft)) {
    const got = mixture((m) => { const n = m.turnsLeft?.[v as keyof NonNullable<DoublesOutcomeMon["turnsLeft"]>]; return n !== undefined ? String(n) : null; });
    if (Object.keys(wanted).length || got.size) both(\`turnsLeft.\${v}\`, wanted, got);
  }
  if (Object.keys(want.pendingCopy).length || reported((m) => m.pendingCopy)) {
    both("pendingCopy", want.pendingCopy, mixture((m) => {
      const parts = Object.entries(m.pendingCopy ?? {}).filter(([, v]) => v).map(([k, v]) => \`\${k}:\${v}\`).sort();
      return parts.length ? parts.join(",") : null;
    }));
  }
  close(mass((m) => !!m.berryLocked), want.berryLocked, \`\${c.id} \${slot} berryLocked\`);
  for (const [v, p] of Object.entries(want.volatiles)) close(mass((m) => !!m.volatiles?.includes(v)), p, \`\${c.id} \${slot} volatile \${v}\`);
  for (const stat of ["accuracy", "evasion"] as const) {
    const values = new Set<number>([0]);
    for (const k of Object.keys(want.stages)) if (k.split(":")[0] === stat) values.add(Number(k.split(":")[1]));
    for (const o of outcomes) if (o.mons[slot]) values.add(o.mons[slot]!.stages?.[stat] ?? 0);
    for (const n of values) if (n !== 0) close(mass((m) => (m.stages?.[stat] ?? 0) === n), want.stages[\`\${stat}:\${n}\`] ?? 0, \`\${c.id} \${slot} stage \${stat}:\${n}\`);
  }
}

`;

const body = `
describe("the 2v2 turn against pinned Showdown", () => {
  for (const c of CASES) {
    it(\`\${c.id}: \${c.title}\`, async () => {
      const turn = await input(c);
      const result = calculateDoublesTurn(turn);
      expect(result.status, c.checks).toBe("ready");
      if (result.status !== "ready") return;
      // Exhaustive cases are exact to 1e-9; a sampled one (exact: false) to 0.015 in its chances and 0.5 HP in its average.
      const digits = c.exact ? 9 : 1;
      const close = (got: number, want: number, label: string) => expect(Math.abs(got - want), label).toBeLessThanOrEqual(c.exact ? 1e-9 : 0.015);
      for (const slot of SLOTS) {
        const want = c.hp[slot], got = result.hp[slot];
        if (!want) { expect(got, slot).toBeNull(); continue; }
        expect(got, slot).not.toBeNull();
        expect({ start: got!.start, maximum: got!.maximum, low: got!.low, high: got!.high }, \`\${c.id} \${slot}\`).toEqual({ start: want.start, maximum: want.maximum, low: want.low, high: want.high });
        if (c.exact) expect({ min: got!.min, max: got!.max }, \`\${c.id} \${slot}\`).toEqual({ min: want.min, max: want.max });
        else expect(got!.min <= want.min && got!.max >= want.max, \`\${c.id} \${slot} range\`).toBe(true);
        expect(got!.average, \`\${c.id} \${slot} average\`).toBeCloseTo(want.average, c.exact ? 9 : 0);
        close(got!.koChance, want.koChance, \`\${c.id} \${slot} KO chance\`);
        expect(got!.faintsBeforeMoving ?? 0, \`\${c.id} \${slot} faints before moving\`).toBeCloseTo(want.faintsBeforeMoving ?? 0, digits);
      }
      // status2 wave 1b: a copied step (a Dancer's copy, an instructed move) is checked with the copies below.
      const own = result.steps.filter((step) => !step.copied);
      expect(own.map((step) => step.slot).sort()).toEqual(Object.keys(c.steps).sort());
      const copies = result.steps.filter((step) => step.copied);
      expect(copies.length, \`\${c.id} copies\`).toBe((c.copies ?? []).filter((x) => x.picked > 0).length);
      for (const want of c.copies ?? []) {
        const got = copies.find((step) => step.slot === want.slot && step.copied === want.copied && step.moveId === want.moveId);
        if (want.picked > 0) expect(got, \`\${c.id} \${want.slot} \${want.copied} copy\`).toBeDefined();
        if (got) { expect(got.moves, \`\${c.id} \${want.slot} copy moves\`).toBeCloseTo(want.moves, digits); copies.splice(copies.indexOf(got), 1); }
      }
      for (const step of own) {
        const want = c.steps[step.slot as DoublesSlotId]!;
        expect(step.moveId).toBe(want.moveId);
        expect(step.moves, \`\${c.id} \${step.slot} moves\`).toBeCloseTo(want.moves, digits);
        const order = new Map(step.order.map((entry) => [entry.position, entry.chance]));
        for (const [position, chance] of want.order) expect(order.get(position) ?? 0, \`\${c.id} \${step.slot} order \${position}\`).toBeCloseTo(chance, digits);
        expect([...order.keys()].every((position) => want.order.some(([p]) => p === position))).toBe(true);
        for (const hit of want.hits) {
          const got = step.hits.find((h) => h.slot === hit.slot);
          expect(got, \`\${c.id} \${step.slot} → \${hit.slot}\`).toBeDefined();
          expect(got!.reached, \`\${c.id} \${step.slot} → \${hit.slot} reached\`).toBeCloseTo(hit.reached, digits);
          expect(got!.koChance, \`\${c.id} \${step.slot} → \${hit.slot} KO chance\`).toBeCloseTo(hit.koChance, digits);
          if (hit.kind) expect(got!.kind === hit.kind || (hit.kind === "blocked" && got!.kind === "no-damage"), \`\${c.id} \${step.slot} → \${hit.slot} \${got!.kind}\`).toBe(true);
          if (hit.min !== undefined) expect({ kind: got!.kind, min: got!.min, max: got!.max }, \`\${c.id} \${step.slot} → \${hit.slot}\`).toEqual({ kind: "calculated", min: hit.min, max: hit.max });
          if (hit.substitute) {
            const sub = got!.substitute;
            expect(sub, \`\${c.id} \${step.slot} → \${hit.slot} Substitute\`).toBeDefined();
            expect({ min: sub!.min, max: sub!.max }, \`\${c.id} \${step.slot} → \${hit.slot} Substitute HP lost\`).toEqual({ min: hit.substitute.min, max: hit.substitute.max });
            close(sub!.chance, hit.substitute.chance, \`\${c.id} \${step.slot} → \${hit.slot} Substitute chance\`);
            close(sub!.breaks, hit.substitute.breaks, \`\${c.id} \${step.slot} → \${hit.slot} Substitute breaks\`);
          }
        }
      }
      // status-eot: the effect facts.
      for (const e of c.effects ?? []) {
        const step = result.steps.find((s) => s.slot === e.slot);
        expect(step, \`\${c.id} \${e.slot} step\`).toBeDefined();
        // status2: a copy of a rise ("Opportunist: {Name} copies +2 Attack.") counts for its copier (verify/compare.ts compareEffects).
        const copied = (t: string, target: DoublesSlotId) => {
          const name = / copies [+−]/.test(t) ? /: (.+?) copies [+−]/.exec(t)?.[1] : undefined;
          const side = name ? /\\((yours|opponent's)/.exec(name)?.[1] : undefined;
          return !!name && name.split(" (")[0] === c.slots[target].species && (!side || (side === "yours") === target.startsWith("own"));
        };
        // status2 (V2, integration 1b): a step fact about another Pokémon counts for the Pokémon it names: "{Effect}: {Name} ±n
        // {Stat}." (Wind Rider, Room Service, a Seed, Order Up, Battle Bond), or doubles-use.ts aboutSlot's forms ("{Name}'s …",
        // "{Name} is …", "{Name}: …") where that Pokémon has no hit entry in the step (verify/compare.ts compareEffects).
        const sameMon = (name: string | undefined, target: DoublesSlotId) => {
          const side = name ? /\\((yours|opponent's)/.exec(name)?.[1] : undefined;
          return !!name && name.split(" (")[0] === c.slots[target].species && (!side || (side === "yours") === target.startsWith("own"));
        };
        const named = (t: string, target: DoublesSlotId) => target !== e.slot && !/ copies [+−]/.test(t)
          && (sameMon(/^[^:]+: (.+?) [+−]\\d/.exec(t)?.[1], target) || (!step!.hits.some((h) => h.slot === target) && sameMon(/^(.+?)(?:'s | is |: )/.exec(t)?.[1], target)));
        const facts = e.on === "skipped" ? step!.skipped : [
          ...(step!.hits.find((h) => h.slot === e.target)?.facts ?? []), ...(e.target === e.slot ? step!.facts.filter((f) => !/ copies [+−]/.test(f.text)) : []),
          ...(e.target ? step!.facts.filter((f) => copied(f.text, e.target!)) : []),
          ...(e.target ? step!.facts.filter((f) => named(f.text, e.target!)) : []),
        ];
        const pattern = e.match !== undefined ? new RegExp(e.match, e.flags) : null;
        close(chanceOf(facts, (t) => (pattern ? pattern.test(t) : t.includes(e.text!))), e.chance, \`\${c.id} \${e.slot}\${e.target ? \` → \${e.target}\` : ""} \${e.text ?? e.match}\`);
      }
      for (const sideId of ["own", "opponent"] as const) close(result.swapped?.[sideId] ?? 0, c.swapped?.[sideId] ?? 0, \`\${c.id} swapped \${sideId}\`);
      // status2 wave 2: a case with a bench.
      if (c.r) checkBench(c, result, close);
      // status-eot: the end of turn.
      if (c.end) {
        const end = result.endOfTurn;
        if ("reason" in c.end) {
          expect(end.status, \`\${c.id} end of turn\`).toBe("not-estimated");
          if (end.status === "not-estimated") expect(end.reason).toBe(c.end.reason);
        } else {
          expect(end.status, \`\${c.id} end of turn\`).toBe("ready");
          if (end.status !== "ready") return;
          for (const slot of SLOTS) {
            const want = c.end.hp[slot], got = end.hp[slot];
            if (!want) continue;
            expect(got, \`\${c.id} end of turn \${slot}\`).not.toBeNull();
            expect({ low: got!.low, high: got!.high }, \`\${c.id} end of turn \${slot}\`).toEqual({ low: want.low, high: want.high });
            if (c.exact) expect({ min: got!.min, max: got!.max }, \`\${c.id} end of turn \${slot}\`).toEqual({ min: want.min, max: want.max });
            expect(got!.average, \`\${c.id} end of turn \${slot} average\`).toBeCloseTo(want.average, c.exact ? 9 : 0);
            close(got!.koChance, want.koChance, \`\${c.id} end of turn \${slot} KO chance\`);
          }
          for (const r of c.end.residuals) {
            const got = end.residuals.find((a) => a.slot === r.slot && (a.id ?? null) === (r.id ?? null) && a.min === r.min && a.max === r.max && Math.abs(a.chance - r.chance) <= (c.exact ? 1e-9 : 0.015));
            expect(got, \`\${c.id} residual on \${r.slot} \${r.min}..\${r.max} (\${r.chance})\`).toBeDefined();
            close(got!.koChance, r.koChance, \`\${c.id} residual on \${r.slot} KO chance\`);
          }
        }
      }
      // status-eot E2: the outcomes' mixtures.
      if (c.outcomes) {
        const turnInput = await input(c);
        const out = calculateDoublesOutcomes(turnInput);
        expect(out.status, \`\${c.id} outcomes\`).toBe("ready");
        if (out.status !== "ready") return;
        expect(out.endOfTurn === "applied", \`\${c.id} outcomes after the turn\`).toBe(c.outcomes.applied);
        // status2 wave 2: with a bench, each slot is its starting Pokémon (identity), the newcomers apart.
        const outcomes = c.r ? identity(out.outcomes) : out.outcomes;
        if (c.r) checkNewcomers(c, out.outcomes, close);
        for (const [slot, want] of Object.entries(c.outcomes.mons) as [DoublesSlotId, OutcomeMon][]) {
          const mass = (f: (m: DoublesOutcomeMon) => number) => outcomes.reduce((s, o) => s + (o.mons[slot] ? o.chance * f(o.mons[slot]!) : 0), 0);
          for (const [item, p] of Object.entries(want.item)) close(mass((m) => ((m.build.itemId ?? "") === item ? 1 : 0)), p, \`\${c.id} \${slot} item \${item || "(none)"}\`);
          for (const [hp, p] of want.substitute) close(mass((m) => m.substitute?.find((s) => s.hp === hp)?.chance ?? 0), p, \`\${c.id} \${slot} Substitute \${hp}\`);
          for (const [v, p] of Object.entries(want.volatiles)) close(mass((m) => (m.volatiles?.includes(v) ? 1 : 0)), p, \`\${c.id} \${slot} volatile \${v}\`);
          for (const [count, p] of Object.entries(want.perish)) close(mass((m) => (String(m.perishCount) === count ? 1 : 0)), p, \`\${c.id} \${slot} perish \${count}\`);
          // status2 (integration 1a): Showdown clears a fainted Pokémon's stages, so an outcome's fainted share has stage 0.
          const living = (m: DoublesOutcomeMon) => m.hp.reduce((x, h) => x + (h.hp > 0 ? h.chance : 0), 0);
          for (const [key, p] of Object.entries(want.stages)) { const [stat, n] = key.split(":"); close(mass((m) => ((m.build.boosts as Record<string, number | undefined>)[stat] === Number(n) ? living(m) : 0) + (Number(n) === 0 ? 1 - living(m) : 0)), p, \`\${c.id} \${slot} stage \${key}\`); }
          for (const [status, p] of Object.entries(want.status ?? {})) close(mass((m) => ((m.build.status ?? "") === status ? 1 : 0)), p, \`\${c.id} \${slot} status \${status || "(none)"}\`);
          if (want.s2) checkState2(c, slot, want.s2, outcomes, turnInput.runtime, close);
          const sideId = slot.startsWith("own") ? "own" : "opponent";
          close(outcomes.reduce((s, o) => s + (o.positions[sideId] === "swapped" && o.mons[slot] ? o.chance : 0), 0), want.swapped, \`\${c.id} \${slot} swapped\`);
        }
        // A hazard standing after the turn: one that landed this turn, or one from before it where the side's hazardsFrom is not null.
        const before = (sideId: "own" | "opponent") => c.field?.[sideId]?.hazards ?? [];
        const standing = (o: DoublesOutcome, sideId: "own" | "opponent", hazard: string) => {
          if (o.sides[sideId].hazards?.includes(hazard)) return true;
          const from = o.sides[sideId].hazardsFrom === undefined ? sideId : o.sides[sideId].hazardsFrom;
          return from !== null && before(from).includes(hazard);
        };
        for (const sideId of ["own", "opponent"] as const) {
          for (const [hazard, p] of Object.entries(c.outcomes.hazards[sideId])) close(out.outcomes.reduce((s, o) => s + (standing(o, sideId, hazard) ? o.chance : 0), 0), p, \`\${c.id} \${sideId} \${hazard}\`);
        }
      }
    });
  }
});
`;

// status2 (Track V1): the table in parts of at most 400 rows (one array literal of 1,400 object types is a union too complex
// for tsc: TS2590).
const PART = 400;
const parts = Array.from({ length: Math.ceil(rows.length / PART) }, (_, i) => rows.slice(i * PART, (i + 1) * PART));
const table = `/** The oracle's cases (verify/cases.ts) with their expected values (verify/results/<id>.json), in parts of ${PART}. */
${parts.map((part, i) => `const CASES_${i + 1}: Case[] = [
${part.map((r) => `  ${js(r)},`).join("\n")}
];
`).join("")}const CASES: Case[] = [${parts.map((_, i) => `...CASES_${i + 1}`).join(", ")}];
`;
fs.writeFileSync(OUT, header + table + body);
console.log(`wrote ${rows.length} cases to ${OUT}${agreeing && !all ? ` (${skipped} cases that do not agree with the app left out)` : ""}`);
