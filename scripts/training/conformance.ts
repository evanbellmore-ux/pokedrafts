// Training conformance (SPEC §14.3): tracker parity, belief-battle equivalence under Perfect information, default-settings
// robustness, the bridge (stats/HP and E2 containment), split weights, choice strings, and the effect census.
//   npx tsx scripts/training/conformance.ts [--battles 40] [--pools S,V,A] [--seats maxdamage:random] [--containment 2]
// Writes scripts/.cache/training/conformance/<run>.json and .txt; exits 1 when a gated check fails.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { Battle as BattleCtor, PRNG, State, toID, type Battle, type ClonedBattle } from "@pokedrafts/showdown-sim";
import { calculateDoublesOutcomes } from "@/app/lib/battle/doubles-turn";
import { DOUBLES_SLOTS, type DoublesSlotId } from "@/app/lib/battle/doubles-types";
import { getBuildStats } from "@/app/lib/battle/model";
import { championsRuntime as runtime } from "@/app/lib/battle/runtime";
import type { AiInputs, BeliefWorld } from "@/app/(app)/training/model/ai-inputs";
import type { CellActions, TurnServices } from "@/app/(app)/training/model/ai-view";
import { DEFAULT_INFO, PERFECT_INFORMATION, type InfoSettings } from "@/app/(app)/training/model/info";
import type { PublicState } from "@/app/(app)/training/model/public-state";
import { createRandom, seedHex } from "@/app/(app)/training/model/random";
import type { ShowdownRequest, SideID } from "@/app/(app)/training/model/showdown-types";
import { buildBeliefBattle } from "@/app/(app)/training/sim/belief-battle";
import { identName, isFainted, legalJointActions, toChoiceString, type MemberKeys } from "@/app/(app)/training/sim/choices";
import { memberKeys, toShowdownTeam } from "@/app/(app)/training/sim/showdown-set";
import { loadTrainingUsage } from "@/app/(app)/training/usage/training-usage";
import { runMatch } from "./lib/match";
import { createTurnServices } from "@/app/(app)/training/sim/services";
import { compareFacts, oracleFacts, realBattle, trackerFacts } from "./lib/oracle";
import { createSeat, ensureSeats, isSeatName } from "./lib/providers";
import { gateTable, parseArgs, pct, writeJson, writeText, type GateRow } from "./lib/report";
import { parsePools, teamPair } from "./lib/teams";

const HIDDEN_VOLATILES = new Set(["confusion", "lockedmove", "partiallytrapped", "twoturnmove", "substitute"]);
/** SPEC §2.2: a sleep, freeze, confusion, lock, partial trap, charge target or Substitute HP is in play. */
function hiddenInPlay(state: PublicState): boolean {
  return Object.values(state.mons).some((mon) => mon.position !== null && !mon.fainted && (mon.status === "slp" || mon.status === "frz" || !!mon.lock
    || mon.volatiles.some((volatile) => HIDDEN_VOLATILES.has(volatile.id))));
}
const stripTime = (lines: readonly string[]) => lines.filter((line) => !line.startsWith("|t:|"));
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function clone(json: string): ClonedBattle {
  const battle = State.deserializeBattle(json);
  battle.restart(() => {});
  return battle;
}
/** The turn (or replacement) both choices start, on `json` reseeded with `seed`: the log lines it adds. */
function playOnce(json: string, seed: string, choices: Partial<Record<SideID, string>>): { lines: string[]; ok: boolean } {
  const battle = clone(json);
  battle.prng = new PRNG(seed as `sodium,${string}`);
  const before = battle.log.length;
  let ok = true;
  for (const side of ["p1", "p2"] as const) {
    const choice = choices[side];
    if (choice === undefined) continue;
    if (!battle.choose(side, choice)) ok = false;
  }
  return { lines: stripTime(battle.log.slice(before)), ok };
}
/** HP of each engine slot's active when the turn's Residual event starts (before the end of turn). */
function preResidualHP(json: string, seed: string, choices: Record<SideID, string>, aiSide: SideID): { hp: Partial<Record<DoublesSlotId, number>>; dirty: boolean } | null {
  const battle = clone(json);
  battle.prng = new PRNG(seed as `sodium,${string}`);
  let snap: Partial<Record<DoublesSlotId, number>> | null = null;
  const read = () => {
    const out: Partial<Record<DoublesSlotId, number>> = {};
    for (const slot of DOUBLES_SLOTS) {
      const side = slot.startsWith("own") ? (aiSide === "p2" ? "p1" : "p2") : aiSide;
      const position = slot === "own-left" ? 0 : slot === "own-right" ? 1 : slot === "opponent-right" ? 0 : 1;
      const mon = battle[side].active[position];
      if (mon) out[slot] = mon.hp;
    }
    return out;
  };
  const fieldEvent = battle.fieldEvent.bind(battle);
  battle.fieldEvent = (id: string, ...rest: unknown[]) => { if (id === "Residual" && !snap) snap = read(); return fieldEvent(id, ...rest); };
  const before = battle.log.length;
  if (!battle.choose("p1", choices.p1) || !battle.choose("p2", choices.p2)) return null;
  const lines = battle.log.slice(before);
  // A flinch is Fake Out's (100%) only when Fake Out hit that Pokémon (it fails into a Ghost or a protected target); any
  // other flinch is a chance secondary (Iron Head 30%, Rock Slide 30%).
  const fakeOutHit = new Set<string>();
  lines.forEach((line, i) => {
    const parts = line.split("|");
    if (parts[1] !== "move" || parts[3] !== "Fake Out") return;
    const target = (parts[4] ?? "").replace(/^(p[12])[ab]?:/, "$1:").trim();
    for (const next of lines.slice(i + 1)) {
      if (next.startsWith("|move|")) break;
      const fields = next.split("|");
      if (fields[1] === "-damage" && (fields[2] ?? "").replace(/^(p[12])[ab]?:/, "$1:").trim() === target && !next.includes("[from]")) { fakeOutHit.add(target); break; }
    }
  });
  const flinchedByChance = (line: string) => !fakeOutHit.has((line.split("|")[2] ?? "").replace(/^(p[12])[ab]?:/, "$1:").trim());
  // A status from a contact ability (Flame Body, Static, Poison Point: 30%, PS/data/abilities.ts) is a chance effect too.
  // A stat change from a chance secondary (Shadow Ball's 20% Sp. Def drop, Psychic's 10%, Moonblast's 10% Sp. Atk drop) is an
  // added effect below 100%, which the engine does not model (app/lib/battle/doubles-turn.ts turnFacts): not a clean sample.
  // The user's Serene Grace doubles the chance (PS/data/abilities.ts serenegrace): one it doubles to 100% happens, and the
  // engine models it (app/lib/battle/stat-moves.ts SERENE_GRACE_MOVES); the user is read as it stands after the turn.
  // A multiaccuracy move (Triple Axel, Population Bomb) checks accuracy per hit and stops at a miss without a -miss line
  // (pinned sim/battle-actions.ts hitStepMoveHitLoop): fewer hits than its multihit is a miss, also not clean.
  let moveId = "";
  let graced = false;
  const chanceBoost = lines.some((line) => {
    if (line.startsWith("|move|")) {
      const parts = line.split("|");
      moveId = toID(parts[3] ?? "");
      const at = /^(p[12])([ab]): (.*)$/.exec(parts[2] ?? "");
      const user = at ? battle[at[1] as SideID].active[at[2] === "a" ? 0 : 1] : null;
      graced = !!at && user?.name === at[3] && user.ability === "serenegrace";
      return false;
    }
    if (line.startsWith("|-hitcount|") && moveId) {
      const move = battle.dex.moves.get(moveId) as { multihit?: number | number[]; multiaccuracy?: boolean };
      return !!move.multiaccuracy && typeof move.multihit === "number" && Number(line.split("|")[3]) < move.multihit;
    }
    if (!/^\|-(un)?boost\|/.test(line) || line.includes("[from]") || !moveId) return false;
    const move = battle.dex.moves.get(moveId) as { secondaries?: readonly { chance?: number; boosts?: object; self?: { boosts?: object } }[] | null };
    return (move.secondaries ?? []).some((each) => (each.chance ?? 100) * (graced ? 2 : 1) < 100 && (!!each.boosts || !!each.self?.boosts));
  });
  const dirty = chanceBoost || lines.some((line) => line.startsWith("|-crit|") || line.startsWith("|-miss|") || (line.startsWith("|-status|") && (!line.includes("[from]") || line.includes("[from] ability:")))
    || (line.startsWith("|cant|") && line.includes("flinch") && flinchedByChance(line)) || (line.startsWith("|-start|") && line.includes("confusion")) || line.startsWith("|switch|") || line.startsWith("|-mega|"));
  return { hp: snap ?? read(), dirty };
}

type Report = {
  parity: { decisions: number; equal: number; diffs: string[] };
  equivalence: { decisions: number; built: number; requestsP1: number; requestsP2: number; clean: number; cleanSame: number; hidden: number; hiddenSame: number; failures: string[];
    /** By request kind: turn (move requests) and switch (forced and mid-turn replacements). */
    byKind: Record<string, { decisions: number; requests: number; clean: number; cleanSame: number }> };
  robustness: { decisions: number; built: number; played: number; p1ChoiceValid: number; failures: string[] };
  bridge: { mons: number; statMismatch: string[]; hpMismatch: string[]; cells: number; engineCells: number; clean: number; contained: number; outside: string[] };
  choices: { checked: number; accepted: number; unavailable: number; failures: string[] };
  census: Record<string, number>;
  splits: { protect3: number; sleep1: number; freeze: number; samples: number } | null;
  errors: string[];
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const battles = Number(args.battles ?? 40);
  const pools = parsePools(String(args.pools ?? "S,V,A"));
  const [p2Name, p1Name] = String(args.seats ?? "maxdamage:random").split(":");
  if (!isSeatName(p2Name) || !isSeatName(p1Name)) throw new Error(`Unknown --seats ${String(args.seats)}.`);
  await ensureSeats([p2Name, p1Name]);
  const containmentPerBattle = Number(args.containment ?? 2);
  const run = String(args.run ?? `conformance-${pools.join("")}`);
  const usage = loadTrainingUsage();
  const report: Report = {
    parity: { decisions: 0, equal: 0, diffs: [] },
    equivalence: { decisions: 0, built: 0, requestsP1: 0, requestsP2: 0, clean: 0, cleanSame: 0, hidden: 0, hiddenSame: 0, failures: [], byKind: {} },
    robustness: { decisions: 0, built: 0, played: 0, p1ChoiceValid: 0, failures: [] },
    bridge: { mons: 0, statMismatch: [], hpMismatch: [], cells: 0, engineCells: 0, clean: 0, contained: 0, outside: [] },
    choices: { checked: 0, accepted: 0, unavailable: 0, failures: [] },
    census: {},
    splits: null,
    errors: [],
  };
  const note = (list: string[], text: string) => { if (list.length < 40) list.push(text); };

  for (const mode of ["perfect", "open"] as const) {
    // Perfect information (aiKnows): truth worlds, equivalence and the bridge. Open: parity, robustness, choices, census.
    const info: InfoSettings = mode === "perfect" ? { aiKnows: PERFECT_INFORMATION, youSee: DEFAULT_INFO.youSee } : DEFAULT_INFO;
    for (let index = 0; index < battles; index++) {
      const pair = teamPair(run, index, pools, runtime);
      const adapted = { p1: toShowdownTeam(pair.p1.team.members, runtime), p2: toShowdownTeam(pair.p2.team.members, runtime) };
      let pendingInputs: AiInputs | null = null;
      let pendingKind = "";
      let containmentLeft = mode === "perfect" ? containmentPerBattle : 0;
      const random = createRandom(run, mode, index, "conformance");
      const result = await runMatch({
        seats: { p1: createSeat(p1Name, runtime, null), p2: createSeat(p2Name, runtime, null) },
        teams: { p1: pair.p1.team, p2: pair.p2.team }, info, runtime, usage, seedRun: `${run}:${mode}`, index,
        observer: {
          drained(host, trackers, keys) {
            if (mode !== "open") return;
            if (!host.needsChoice("p1") && !host.needsChoice("p2")) return;
            for (const viewer of ["p1", "p2"] as const) {
              report.parity.decisions++;
              const diff = compareFacts(trackerFacts(trackers[viewer].state()), oracleFacts(realBattle(host), viewer, keys));
              if (!diff.length) report.parity.equal++;
              else note(report.parity.diffs, `${pair.p1.id}v${pair.p2.id} #${index} t${realBattle(host).turn} ${viewer}: ${diff.slice(0, 3).join(" | ")}`);
            }
          },
          inputs(side, kind, inputs) { if (side === "p2") { pendingInputs = inputs; pendingKind = kind; } },
          committing(host, made) {
            const inputs = pendingInputs;
            pendingInputs = null;
            if (!inputs || made.p2 === undefined) return;
            const keys = memberKeysOf(adapted);
            const json = host.snapshot();
            const seed = `sodium,${seedHex(run, mode, index, host.requestId, "turn")}`;
            // Choice strings: every legal joint action of both real requests is accepted on a clone (sampled to 60 each).
            if (mode === "open") {
              for (const side of ["p1", "p2"] as const) {
                const request = host.request(side);
                if (!request || "wait" in request || "teamPreview" in request) continue;
                const legal = legalOf(side, request, keys, inputs.public);
                for (let k = 0; k < Math.min(60, legal.length); k++) {
                  const action = legal[legal.length <= 60 ? k : random.int(legal.length)];
                  report.choices.checked++;
                  let text = "";
                  try {
                    text = toChoiceString(side, action, request, keys, side);
                    const errors: string[] = [];
                    const battle = State.deserializeBattle(json);
                    battle.restart((type, data) => { if (type === "sideupdate") errors.push(...String(data).split("\n").filter((line) => line.startsWith("|error|"))); });
                    if (battle.choose(side, text)) report.choices.accepted++;
                    // A trap the request did not show (maybeTrapped) is revealed by Showdown as an unavailable choice and a new
                    // request (pinned sim/side.ts chooseSwitch): the worker's shown-trap retry path, not a string error.
                    else if (errors.some((line) => line.startsWith("|error|[Unavailable choice]"))) report.choices.unavailable++;
                    else note(report.choices.failures, `${side} ${text}: ${errors.join(" ")}`);
                  } catch (error) { note(report.choices.failures, `${side} ${text}: ${(error as Error).message}`); }
                }
              }
            }
            const truth: BeliefWorld | null = mode === "perfect" ? truthWorld(realBattle(host), adapted, keys, run, index, host.requestId) : null;
            if (truth) {
              report.equivalence.decisions++;
              const byKind = report.equivalence.byKind[pendingKind] ??= { decisions: 0, requests: 0, clean: 0, cleanSame: 0 };
              byKind.decisions++;
              try {
                const belief = buildBeliefBattle(inputs, truth, runtime);
                report.equivalence.built++;
                const sameP2 = sameJson(belief.battle.p2.activeRequest, host.request("p2"));
                const sameP1 = sameJson(belief.battle.p1.activeRequest, host.request("p1"));
                if (sameP1 && sameP2) byKind.requests++;
                if (sameP2) report.equivalence.requestsP2++; else note(report.equivalence.failures, `#${index} t${realBattle(host).turn} p2 request: ${textDifference(JSON.stringify(belief.battle.p2.activeRequest), JSON.stringify(host.request("p2")))}`);
                if (sameP1) report.equivalence.requestsP1++; else note(report.equivalence.failures, `#${index} t${realBattle(host).turn} p1 request: ${textDifference(JSON.stringify(belief.battle.p1.activeRequest), JSON.stringify(host.request("p1")))}`);
                const real = playOnce(json, seed, made);
                const rebuilt = playOnce(belief.json, seed, made);
                const same = real.ok && rebuilt.ok && sameJson(real.lines, rebuilt.lines);
                if (hiddenInPlay(inputs.public)) { report.equivalence.hidden++; if (same) report.equivalence.hiddenSame++; }
                else {
                  report.equivalence.clean++;
                  byKind.clean++;
                  if (same) { report.equivalence.cleanSame++; byKind.cleanSame++; }
                  else note(report.equivalence.failures, `#${index} t${realBattle(host).turn} ${pendingKind} log: ${firstDifference(real.lines, rebuilt.lines)}`);
                }
                for (const text of belief.approximations) report.census[text] = (report.census[text] ?? 0) + 1;
                // Bridge (exact HP under Perfect information): services' view builds equal the belief battle's stats and HP.
                if (containmentLeft > 0 && "active" in inputs.request) {
                  containmentLeft--;
                  bridgeCheck(report, inputs, truth, belief.json, keys, run, index, random);
                }
              } catch (error) {
                note(report.equivalence.failures, `#${index} t${realBattle(host).turn} build: ${(error as Error).message}`);
              }
            }
          },
          services(side, inputs, worlds) {
            if (side !== "p2" || mode !== "open" || !worlds.length) return;
            report.robustness.decisions++;
            try {
              const belief = buildBeliefBattle(inputs, worlds[0], runtime);
              report.robustness.built++;
              const request = inputs.request;
              if (!("active" in request)) { report.robustness.played++; return; }
              const battle = clone(belief.json);
              const own = legalOf("p2", belief.battle.p2.activeRequest as ShowdownRequest, memberKeysOf(adapted), inputs.public);
              const other = legalOf("p1", belief.battle.p1.activeRequest as ShowdownRequest, memberKeysOf(adapted), inputs.public);
              const keys = memberKeysOf(adapted);
              const c2 = own[0] ? toChoiceString("p2", own[0], belief.battle.p2.activeRequest as ShowdownRequest, keys, "p2") : "default";
              const c1 = other[0] ? toChoiceString("p1", other[0], belief.battle.p1.activeRequest as ShowdownRequest, keys, "p1") : "default";
              if (battle.choose("p2", c2) && battle.choose("p1", c1)) report.robustness.played++;
              else note(report.robustness.failures, `#${index} t${inputs.public.turn}: ${c2} / ${c1}`);
            } catch (error) {
              note(report.robustness.failures, `#${index} t${inputs.public.turn} build: ${(error as Error).message}`);
            }
          },
        },
      });
      for (const error of result.errors) note(report.errors, `${mode} #${index} ${error.side ?? "-"} ${error.stage}: ${error.message.split("\n")[0]}`);
      for (const decision of result.decisions) for (const text of decision.stats?.approximations ?? []) report.census[text] = (report.census[text] ?? 0) + 1;
    }
  }
  report.splits = splitSamples(Number(args.splitSamples ?? 2000));

  const rows: GateRow[] = [];
  const share = (a: number, b: number) => b ? a / b : Number.NaN;
  rows.push({ gate: "1. Tracker parity", threshold: "100%", result: `${report.parity.equal}/${report.parity.decisions} (${pct(share(report.parity.equal, report.parity.decisions), 2)})`, status: report.parity.equal === report.parity.decisions ? "pass" : "fail" });
  const eq = report.equivalence;
  rows.push({ gate: "2a. Belief battles built (truth)", threshold: "100%", result: `${eq.built}/${eq.decisions}`, status: eq.built === eq.decisions ? "pass" : "fail" });
  rows.push({ gate: "2b. Requests equal (p1 / p2)", threshold: "≥ 99.5%", result: `${pct(share(eq.requestsP1, eq.built), 2)} / ${pct(share(eq.requestsP2, eq.built), 2)} of ${eq.built}`, status: share(eq.requestsP1, eq.built) >= 0.995 && share(eq.requestsP2, eq.built) >= 0.995 ? "pass" : "fail" });
  const kinds = Object.entries(eq.byKind).map(([kind, k]) => `${kind}: requests ${k.requests}/${k.decisions}, logs ${k.cleanSame}/${k.clean}`).join("; ");
  rows.push({ gate: "2c. One-turn logs, no hidden duration", threshold: "≥ 99.5%", result: `${eq.cleanSame}/${eq.clean} (${pct(share(eq.cleanSame, eq.clean), 2)}); with one: ${eq.hiddenSame}/${eq.hidden} (report); ${kinds}`, status: share(eq.cleanSame, eq.clean) >= 0.995 ? "pass" : "fail" });
  const rb = report.robustness;
  rows.push({ gate: "3. Default settings: built / a turn plays", threshold: "100% / ≥ 99.5%", result: `${rb.built}/${rb.decisions}, ${rb.played}/${rb.decisions}`, status: rb.decisions === 0 ? "not-run" : rb.built === rb.decisions && share(rb.played, rb.decisions) >= 0.995 ? "pass" : "fail" });
  const br = report.bridge;
  rows.push({ gate: "4a. Bridge stats/HP mismatches", threshold: "0", result: `${br.statMismatch.length + br.hpMismatch.length} over ${br.mons} Pokémon`, status: br.mons === 0 ? "not-run" : br.statMismatch.length + br.hpMismatch.length === 0 ? "pass" : "fail" });
  rows.push({ gate: "4b. Clean rollouts inside the E2 support", threshold: "≥ 99%", result: `${br.contained}/${br.clean} (${pct(share(br.contained, br.clean), 2)}) over ${br.engineCells}/${br.cells} engine cells`, status: br.clean === 0 ? "not-run" : share(br.contained, br.clean) >= 0.99 ? "pass" : "fail" });
  if (report.splits) {
    const s = report.splits;
    const within = (x: number, target: number) => Math.abs(x - target) <= 0.03;
    rows.push({ gate: "5. Splits (2,000 samples each)", threshold: "Protect k=1 33.3%, sleep d=1 33.3%, freeze 25% (± 3)", result: `${pct(s.protect3)} / ${pct(s.sleep1)} / ${pct(s.freeze)}`, status: within(s.protect3, 1 / 3) && within(s.sleep1, 1 / 3) && within(s.freeze, 0.25) ? "pass" : "fail" });
  }
  rows.push({ gate: "6. Choice strings accepted on clones", threshold: "100% (hidden traps shown as unavailable aside)", result: `${report.choices.accepted}/${report.choices.checked}; unavailable (hidden trap shown) ${report.choices.unavailable}`, status: report.choices.accepted + report.choices.unavailable === report.choices.checked ? "pass" : "fail" });
  // SPEC 9.3: Substitute HP is the one allowed approximation; a charging move's target is redrawn by design (I6, 9.3 twoturnmove).
  const census = Object.entries(report.census).filter(([text]) => text !== "Substitute HP assumed full." && !/^Charging move.s target drawn/.test(text));
  rows.push({ gate: "7. Effect census", threshold: "0 approximations but Substitute HP", result: census.length ? census.map(([text, count]) => `${text} ×${count}`).join("; ") : "0", status: census.length === 0 ? "pass" : "fail" });
  if (!args.skipE2) {
    // Check 8: E2 equals the Showdown-verified 2v2 corpus (tests/unit/doubles-outcomes.test.ts over doubles-turn-showdown cases).
    const e2 = spawnSync(process.execPath, [join(process.cwd(), "node_modules", "vitest", "vitest.mjs"), "run", "--config", "vitest.unit.config.ts", "tests/unit/doubles-outcomes.test.ts", "tests/unit/doubles-turn-showdown.test.ts"], { cwd: process.cwd(), encoding: "utf8" });
    const plain = `${e2.stdout ?? ""}${e2.stderr ?? ""}`.replace(/\x1b\[[0-9;]*m/g, "");
    const summary = plain.split("\n").filter((line) => /Tests\s+\d|Test Files/.test(line)).map((line) => line.trim()).join("; ");
    rows.push({ gate: "8. E2 vs Showdown (doubles-outcomes + doubles-turn-showdown tests)", threshold: "all pass", result: summary || `exit ${e2.status}`, status: e2.status === 0 ? "pass" : "fail" });
  }
  rows.push({ gate: "Runner errors", threshold: "0", result: `${report.errors.length}`, status: report.errors.length === 0 ? "pass" : "fail" });
  const dir = join(process.cwd(), "scripts", ".cache", "training", "conformance");
  writeJson(join(dir, `${run}.json`), report);
  const text = `${gateTable(rows)}\n`;
  writeText(join(dir, `${run}.txt`), text);
  process.stdout.write(text);
  if (rows.some((row) => row.status === "fail")) process.exitCode = 1;
}

function memberKeysOf(adapted: { p1: ReturnType<typeof toShowdownTeam>; p2: ReturnType<typeof toShowdownTeam> }): MemberKeys {
  return memberKeys(adapted.p1, adapted.p2);
}
function legalOf(side: SideID, request: ShowdownRequest, keys: MemberKeys, state: PublicState) {
  if ("teamPreview" in request || "wait" in request) return [];
  const bench = request.side.pokemon.filter((pokemon) => !pokemon.active && !isFainted(pokemon)).map((pokemon) => keys.keyOf(side, identName(pokemon.ident)));
  const firstTurn = request.side.pokemon.slice(0, 2).map((pokemon) => (state.mons[`${side}:${keys.keyOf(side, identName(pokemon.ident))}`]?.actions ?? 0) === 0);
  return legalJointActions({ side, aiSide: side, request, bench, firstTurn, megaUsed: state.sides[side].megaUsed, keys });
}
/** The true world of the player's side (p1): its brought four in side order, its true sets, exact HP (SPEC §14.3 check 2). */
function truthWorld(battle: Battle, adapted: { p1: ReturnType<typeof toShowdownTeam> }, keys: MemberKeys, run: string, index: number, requestId: number): BeliefWorld {
  const brought = battle.p1.pokemon.map((pokemon) => keys.keyOf("p1", pokemon.name));
  const sets = Object.fromEntries(adapted.p1.sets.filter(({ key }) => brought.includes(key)).map(({ key, set }) => [key, set]));
  return { weight: 1, brought, sets, hp: "midpoint", seed: seedHex(run, index, requestId, "truth") };
}
/** Where two JSON texts first differ: belief ≠ real, 50 characters each side. */
function textDifference(a: string, b: string): string {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return `…${a.slice(Math.max(0, i - 50), i + 50)} ≠ …${b.slice(Math.max(0, i - 50), i + 50)}`;
}
function firstDifference(a: readonly string[], b: readonly string[]): string {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return `line ${i}: ${a[i] ?? "∅"} ≠ ${b[i] ?? "∅"}`;
  return "same";
}

/** Check 4: view builds vs the belief battle's stored stats and HP; clean rollouts inside E2's [min, max] for engine cells. */
function bridgeCheck(report: Report, inputs: AiInputs, world: BeliefWorld, json: string, keys: MemberKeys, run: string, index: number, random: { int(n: number): number }): void {
  const services: TurnServices = createTurnServices(inputs, [world], { runtime, keys, seedBase: seedHex(run, index, inputs.requestId, "bridge") });
  const battle = clone(json);
  for (const mon of services.view.mons) {
    if (mon.fainted || mon.slot === null) continue;
    report.bridge.mons++;
    const side = mon.side === "own" ? "p1" : "p2";
    const real = battle[side].pokemon.find((pokemon) => keys.keyOf(side, pokemon.name) === mon.memberKey);
    if (!real) continue;
    const stats = getBuildStats(mon.build, runtime);
    for (const stat of ["atk", "def", "spa", "spd", "spe"] as const) {
      if (stats?.[stat] !== real.storedStats[stat]) report.bridge.statMismatch.push(`#${index} ${mon.key} ${stat} view ${stats?.[stat]} battle ${real.storedStats[stat]}`);
    }
    if (stats?.hp !== real.maxhp) report.bridge.statMismatch.push(`#${index} ${mon.key} maxhp view ${stats?.hp} battle ${real.maxhp}`);
    if (mon.hp !== real.hp) report.bridge.hpMismatch.push(`#${index} ${mon.key} hp view ${mon.hp} battle ${real.hp}`);
  }
  const { opponent, own } = services.view.legal;
  for (let k = 0; k < 30 && opponent.length && own.length; k++) {
    const cell: CellActions = { opponent: opponent[random.int(opponent.length)], own: own[random.int(own.length)] };
    report.bridge.cells++;
    const worlds = services.engineWorlds(cell);
    if (worlds.kind !== "engine") continue;
    report.bridge.engineCells++;
    const range: Partial<Record<string, [number, number]>> = {};
    for (const engineWorld of worlds.worlds) {
      const outcome = calculateDoublesOutcomes(engineWorld.input);
      if (outcome.status !== "ready") continue;
      for (const each of outcome.outcomes) for (const slot of DOUBLES_SLOTS) {
        const key = engineWorld.keys[slot];
        const mon = each.mons[slot];
        if (!key || !mon) continue;
        const low = Math.min(...mon.hp.map((entry) => entry.hp)), high = Math.max(...mon.hp.map((entry) => entry.hp));
        const known = range[key];
        range[key] = known ? [Math.min(known[0], low), Math.max(known[1], high)] : [low, high];
      }
    }
    let choices: Record<SideID, string>;
    try {
      const real = clone(json);
      choices = {
        p1: toChoiceString("p1", cell.own, real.p1.activeRequest as ShowdownRequest, keys, "p2"),
        p2: toChoiceString("p2", cell.opponent, real.p2.activeRequest as ShowdownRequest, keys, "p2"),
      };
    } catch { continue; }
    for (let n = 0; n < 64; n++) {
      const played = preResidualHP(json, `sodium,${seedHex(run, index, "containment", k, n)}`, choices, "p2");
      if (!played || played.dirty) continue;
      report.bridge.clean++;
      let inside = true;
      for (const slot of DOUBLES_SLOTS) {
        const mon = services.view.mons.find((entry) => entry.slot === slot);
        const bounds = mon ? range[mon.key] : undefined;
        const hp = played.hp[slot];
        if (bounds && hp !== undefined && (hp < bounds[0] || hp > bounds[1])) { inside = false; if (report.bridge.outside.length < 20) report.bridge.outside.push(`#${index} ${slot} ${hp} ∉ [${bounds[0]}, ${bounds[1]}] ${choices.p1} / ${choices.p2}`); }
      }
      if (inside) report.bridge.contained++;
    }
  }
}

/**
 * Check 5: pinned Showdown's own rates for the three split cases (SPEC 9.4 splits table), each from one state reseeded
 * `samples` times: Protect after one success (stall counter 3, PS/data/conditions.ts:439-462), sleep after one
 * `cant` (start drawn from [2,3,3], champions/conditions.ts:11-29), freeze at its first attempt (1/4, :31-56).
 */
function splitSamples(samples: number): Report["splits"] {
  const set = (species: string, moves: string[], ability: string) => ({ name: species, species, item: "", ability, moves, nature: "Hardy", gender: "M",
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 50 });
  const team = () => [set("Snorlax", ["Protect", "Rest"], "Thick Fat"), set("Clefable", ["Protect", "Moonblast"], "Magic Guard"), set("Garchomp", ["Earthquake"], "Rough Skin"),
    set("Venusaur", ["Sludge Bomb"], "Chlorophyll"), set("Sneasler", ["Close Combat"], "Unburden"), set("Whimsicott", ["Moonblast"], "Prankster")];
  const fresh = new BattleCtor({ formatid: "gen9championsvgc2026regmc", seed: [1, 2, 3, 4] });
  fresh.setPlayer("p1", { name: "You", team: team() });
  fresh.setPlayer("p2", { name: "Training", team: team() });
  fresh.makeChoices("team 1234", "team 1234");
  const base = JSON.stringify(State.serializeBattle(fresh));
  // p2 acts after both Protects every turn (Rest at full HP fails, Moonblast into p1b), so a Protect never fails for
  // want of a later action (PS/data/moves.ts protect onPrepareHit: this.queue.willAct()).
  const P2 = "move 2, move 2 2";
  type Writable = ClonedBattle & { p1: { active: { setStatus(status: string): boolean }[] } };
  const run = (setup: (battle: Writable) => void, turns: string[], success: (lines: string[]) => boolean) => {
    let hits = 0;
    for (let n = 0; n < samples; n++) {
      const battle = clone(base) as Writable;
      battle.prng = new PRNG(`sodium,${seedHex("splits", turns.join("/"), n)}` as `sodium,${string}`);
      setup(battle);
      let lines: string[] = [];
      for (const choice of turns) {
        const before = battle.log.length;
        battle.choose("p1", choice);
        battle.choose("p2", P2);
        lines = battle.log.slice(before);
      }
      if (success(lines)) hits++;
    }
    return hits / samples;
  };
  // Protect after one success: the second use succeeds with 1/3 (stall counter 3).
  const protect3 = run(() => {}, ["move 1, move 1", "move 1, move 1"], (lines) => lines.some((line) => line.startsWith("|-singleturn|p1a: Snorlax|Protect")));
  // Sleep drawn per sample (start from [2,3,3]); one cant on turn 1 always; turn 2 wakes with 1/3.
  const sleep1 = run((battle) => { battle.p1.active[0].setStatus("slp"); }, ["move 2, move 1", "move 2, move 1"], (lines) => lines.some((line) => line.startsWith("|-curestatus|p1a: Snorlax|slp")));
  // Freeze: the first attempt thaws with 1/4.
  const freeze = run((battle) => { battle.p1.active[0].setStatus("frz"); }, ["move 2, move 1"], (lines) => lines.some((line) => line.startsWith("|-curestatus|p1a: Snorlax|frz")));
  return { protect3, sleep1, freeze, samples };
}

main().catch((error) => { process.stderr.write(`${(error as Error).stack ?? String(error)}\n`); process.exitCode = 1; });
