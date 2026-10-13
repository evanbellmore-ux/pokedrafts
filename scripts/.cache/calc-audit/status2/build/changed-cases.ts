// status2 changed-cases.ts (SPEC2 §7.1, ADDENDUM2 §7.1; Track V1, wave 1a): the stored oracle cases whose result this build
// changes, and the gate that every one of them is listed and agrees with pinned Showdown.
//
// "Stored" = the oracle set before wave 1a (CASES without cases-wave1a.ts's files). A stored case changes when:
//   1. its expected reason (notEstimated / endNotEstimated) is one a track removes (REMOVED below: the texts of SPEC2 §2.4
//      and ADDENDUM2 §2.4, each with its owner and wave): it becomes estimated, so it needs a fresh oracle run;
//   2. its turn has a crash move into a protected, immune, absorbed or missed target (Step 1 #10; H keeps it);
//   3. the harness's new random events (sim-dfs.ts CHANCE_EFFECTS gains focusband, stall, harvest, attract) reach its turn,
//      so its stored oracle result is re-run;
//   4. C19: its Showdown turn had an entry event setting a per-turn flag a move of the turn reads (asserted none);
//   5. the app's new output reaches it (its numbers unchanged, compared again in diff mode): A1's turn facts "Assumes {Name}
//      has not used Minimize." (a minimize-flag move) and "Assumes {Name} did not charge {Move} last turn." (a charge move, H
//      and A1; E2 charging), E2's new fields (A3's sides.clock and fieldSet, the item history's lastItem, the turns left, the
//      accuracy and evasion stages and the status2 volatiles once A1's and A2's outcomeMon are wired), A2's Protean and
//      Libero type change in the world (the row's assumption), E1's stage residuals (Syrup Bomb) in endOfTurn.residuals;
//      integration 1a: A2's card condition "Type: …" (P4) and E2's berryLocked (D, outcomeOf).
//
// Modes (run from the repo root):
//   npx --no-install tsx scripts/.cache/calc-audit/status2/build/changed-cases.ts [list] [--wave=1a|1b|all] [--c19]
//       every stored case of 1–4 with its key, owner and wave (the C19 scan only with --c19: it prepares every case);
//   npx --no-install tsx scripts/.cache/calc-audit/status2/build/changed-cases.ts diff <base app-results> <new app-results> [--wave=1a]
//       every case whose app result changed or is new (ms removed): a stored change must be on the list for the waves given
//       (or Step 1's, status2/build/step1-changed.ts), and each listed stored case is compared with its oracle result (a
//       case on the list as estimated now: its reason dropped, its fresh results/<id>.json required). Exit 1 on a failure.
//   npx --no-install tsx scripts/.cache/calc-audit/status2/build/changed-cases.ts oracle-ids [--wave=1a]
//       the ids whose oracle the build re-runs (1 and 3), for v1/run.ts --oracle.
//
// Wave 2 (Track R-V): with --wave=2 (or 1a,1b,2 / all) the cases before wave 2 are "stored" (STORED_2), and the rows for 2
// are listChanged2's: the stored cases whose app input changes (app-turn.ts now passes CaseSide.hazards as
// DoublesTurnInput.hazards, which R-E's hazardFails and the Court Change / Defog / Tidy Up / G-Max Wind Rage counts read). No
// stored case has a bench, so the switch family keeps its reason (status2-removed.ts: switchesOut kept without a bench), and
// no stored oracle result changes (the harness's wave 2 additions act only with a bench: v3/ab.ts, byte-equal).
// Wave 1b (Track V2): with --wave=1b (or 1a,1b / all) the cases before wave 1b are "stored" (wave 1a's included: FS08e,
// G4-WHR-01 and the 11 cases integration 1a left open), and the rows for 1b are: 1 (REMOVED's wave 1b texts and REEXPECT_TO),
// 3 (the harness's 1b random events: Magnitude's bands, G-Max Replenish's 1/2) and 5 (newOutput1b: the 1b tracks' turn facts
// of ADDENDUM2 §2.5, E2's charging, onceUsed, chiStrike, cudChew, Uproar's turns left, sides.pledge and sides.gmax, the
// 1b volatiles, Moody's residual facts, the start variants and Download's lead order, the field ends).
import fs from "node:fs";
import path from "node:path";
import { CASES } from "../../2v2/verify/cases";
import { WAVE1A_CASES } from "../../2v2/verify/cases-wave1a";
import { WAVE1B_CASES } from "../../2v2/verify/cases-wave1b";
import { WAVE2_CASES } from "../../2v2/verify/cases-wave2";
import { SLOTS, toID, type Case, type SlotId } from "../../2v2/verify/case-types";
import { runtimeFor } from "../../2v2/verify/app-turn";
import { compareCase, loadRuntimes, readOracle } from "../../2v2/verify/compare";
import { hiddenCases, pokemonAt, prepare } from "../../2v2/verify/sim-dfs";

import { REEXPECT_TO, REMOVED, removalOf, type Wave } from "../../2v2/verify/status2-removed";
void REMOVED;

const CRASH_MOVES = new Set(["highjumpkick", "jumpkick", "axekick", "supercellslam"]);
const PROTECTS = new Set(["protect", "detect", "kingsshield", "spikyshield", "banefulbunker", "obstruct", "silktrap", "burningbulwark", "wideguard", "quickguard", "matblock"]);
const wave1a = new Set(WAVE1A_CASES.map((c) => c.id));
const wave1b = new Set(WAVE1B_CASES.map((c) => c.id));
const wave2 = new Set(WAVE2_CASES.map((c) => c.id));
export const STORED = CASES.filter((c) => !wave1a.has(c.id) && !wave1b.has(c.id) && !wave2.has(c.id));
/** Wave 1b's stored set: every case before wave 1b (the stored and wave 1a's). */
export const STORED_1B = CASES.filter((c) => !wave1b.has(c.id) && !wave2.has(c.id));
/** Wave 2's stored set: every case before wave 2. */
export const STORED_2 = CASES.filter((c) => !wave2.has(c.id));
/**
 * status2 wave 2 (Track R-V): the stored cases wave 2 changes: a pre-turn hazard on a side reaches the app input
 * (DoublesTurnInput.hazards) and R-E's readers (hazardFails; the hazards Court Change moves and Defog, Tidy Up and G-Max Wind
 * Rage clear: their facts). Numbers are expected unchanged (the same hazards stood in the oracle before), so no oracle re-run.
 */
export function listChanged2(): Listed[] {
  const out: Listed[] = [];
  for (const c of STORED_2) {
    const sides = (["own", "opponent"] as const).filter((side) => c.field?.[side]?.hazards?.length);
    if (!sides.length) continue;
    out.push({ id: c.id, why: `the input's pre-turn hazards (${sides.map((s) => `${s}: ${c.field![s]!.hazards!.join(", ")}`).join("; ")}) now reach the app (hazardFails, the hazard facts)`, owner: "R-E / integrator", wave: "2", reexpect: false, oracle: false });
  }
  return out;
}
type Listed = { id: string; why: string; owner: string; wave: Wave; reexpect: boolean; oracle: boolean };
/**
 * Review 2 (round 1, pass D; REVIEW2-FIX-1.md): the stored cases a fix's new output reaches, numbers unchanged (diff mode
 * compares them again). R6-3: the turn fact "Assumes no protecting move was used last turn." for a Sleep Talk user with a
 * protecting move or Endure among its moves, or an Instruct target whose last move is one, with no stall given
 * (doubles-turn.ts calledStall; compare.ts's fact rule).
 */
function listChangedReview2(): Listed[] {
  const out: Listed[] = [];
  const stalls = new Set(["protect", "detect", "kingsshield", "spikyshield", "banefulbunker", "obstruct", "silktrap", "burningbulwark", "endure"]);
  for (const c of STORED_2) {
    const called = SLOTS.filter((slot) => {
      const m = c.slots[slot];
      if (m.absent || m.carried?.stall) return false;
      if (toID(m.action.move ?? "") === "sleeptalk" && (m.moves ?? []).some((each) => stalls.has(toID(each)))) return true;
      return stalls.has(toID(m.lastMove ?? "")) && SLOTS.some((other) => other !== slot && !c.slots[other].absent && toID(c.slots[other].action.move ?? "") === "instruct"
        && (c.slots[other].action.target === slot || c.slots[other].action.target === undefined));
    });
    if (called.length) out.push({ id: c.id, why: `review 2 R6-3: "Assumes no protecting move was used last turn." for ${called.join(", ")} (a called or instructed protecting move)`, owner: "review2 fixer", wave: "2", reexpect: false, oracle: false });
  }
  return out;
}

// 5 (the app's new output): the moves and states that reach it, as the tracks' code reads them.
/** doubles-abilities.ts MINIMIZE_MOVES (pinned flags.minimize): A1's "Assumes {Name} has not used Minimize." */
const MINIMIZE_MOVES = new Set(["bodyslam", "dragonrush", "flyingpress", "heatcrash", "heavyslam", "maliciousmoonsault", "steamroller", "stomp", "supercellslam"]);
/** The pinned flags.charge moves: doubles-hidden.ts chargeHidden and A1's Geomancy, "Assumes {Name} did not charge {Move} last turn." */
const CHARGE_MOVES = new Set(["bounce", "dig", "dive", "fly", "phantomforce", "shadowforce", "skydrop", "solarbeam", "solarblade", "razorwind", "skullbash", "skyattack", "freezeshock", "iceburn", "geomancy", "meteorbeam", "electroshot"]);
/** SideClockFlag's moves (doubles-field.ts setClock: DoublesOutcome.sides.clock "set"). */
const CLOCK_MOVES = new Set(["reflect", "lightscreen", "auroraveil", "tailwind", "safeguard", "mist", "luckychant", "courtchange"]);
/** World.fieldSet's moves (doubles-field.ts). */
const FIELD_SET_MOVES = new Set(["trickroom", "gravity", "magicroom", "wonderroom", "mudsport", "watersport"]);
/** DoublesOutcomeMon.turnsLeft's sources (doubles-turn.ts status2Mon). */
const TURNS_MOVES = new Set(["psychicnoise", "healblock", "embargo", "telekinesis", "taunt", "encore", "disable", "uproar"]);
const STATUS2_VOLATILES = ["stockpile", "powertrick", "powershift", "noretreat", "minimize", "gastroacid", "transform", "trapped", "twoturnmove",
  "attract", "octolock", "tarshot", "foresight", "miracleeye", "telekinesis", "embargo", "nightmare", "glaiverush", "healblock", "lockon"];
/** Whose outcomeMon reports each (doubles-abilities.ts, doubles-typing.ts outcomeVolatiles, doubles-eot.ts, D's Glaive Rush). */
const VOLATILE_OWNER: Record<string, string> = Object.fromEntries([
  ...["stockpile", "powertrick", "powershift", "noretreat", "minimize", "gastroacid", "transform", "trapped", "twoturnmove"].map((v) => [v, "A1"]),
  ...["attract", "octolock", "tarshot", "foresight", "miracleeye", "telekinesis", "embargo", "nightmare"].map((v) => [v, "A2"]),
  ["healblock", "E1"], ["glaiverush", "D"], ["lockon", "D"],
]);
const ORACLE_DIR = path.resolve("scripts/.cache/calc-audit/2v2/verify/results");
/** The moves that set a type the card's conditions name (A2: doubles-typing.ts conditions). */
const TYPE_CHANGERS: ReadonlySet<string> = new Set(["roost", "burnup", "doubleshock", "soak", "magicpowder", "forestscurse", "trickortreat", "reflecttype",
  "conversion", "conversion2", "camouflage"]);
/** [owner, why] for each new output of the app that reaches stored case `c` (header 5). */
function newOutput(c: Case): [string, string][] {
  const out: [string, string][] = [];
  const present = SLOTS.filter((s) => !c.slots[s].absent);
  const moveOf = (s: SlotId) => toID(c.slots[s].action.move ?? "");
  const moves = present.map(moveOf);
  const minimize = present.filter((s) => MINIMIZE_MOVES.has(moveOf(s)));
  if (minimize.length) out.push(["A1", `"Assumes {Name} has not used Minimize." (${minimize.map((s) => `${s}'s ${c.slots[s].action.move}`).join(", ")})`]);
  const charge = present.filter((s) => CHARGE_MOVES.has(moveOf(s)) && !c.slots[s].carried?.charging);
  if (charge.length) out.push(["H / A1", `"Assumes {Name} did not charge {Move} last turn."${c.outcomes ? " and E2 charging" : ""} (${charge.map((s) => `${s}'s ${c.slots[s].action.move}`).join(", ")})`]);
  const protean = present.filter((s) => ["protean", "libero"].includes(toID(c.slots[s].ability)) && moveOf(s));
  if (protean.length) out.push(["A2", `Protean or Libero changes the type in the world (the row's Protean assumption, ${protean.join(", ")})`]);
  if (present.some((s) => c.slots[s].carried?.syrupBomb) || moves.includes("syrupbomb")) out.push(["E1", "Syrup Bomb's Speed drop is an end-of-turn residual (endOfTurn.residuals)"]);
  // Integration 1a: A2's card conditions (P4: doubles-typing.ts conditions) say a type the turn gave ("Type: Steel.").
  const typing = present.filter((s) => TYPE_CHANGERS.has(moveOf(s)) || ["colorchange", "protean", "libero", "mimicry"].includes(toID(c.slots[s].ability)));
  if (typing.length) out.push(["A2 (P4)", `the card condition "Type: …" (doubles-typing.ts conditions; ${typing.join(", ")})`]);
  if (!c.outcomes) return out;
  // Integration 1a: E2 berryLocked (doubles-turn.ts status2Mon) for a Berserk or Anger Shell holder of a healing Berry.
  if (present.some((s) => ["berserk", "angershell"].includes(toID(c.slots[s].ability)) && /berry$/.test(toID(c.slots[s].item ?? "")))) out.push(["D (outcomeOf)", "E2 berryLocked: a Berserk or Anger Shell lock left after the turn"]);
  if (moves.some((m) => CLOCK_MOVES.has(m))) out.push(["A3", "E2 sides.clock: a side condition set this turn"]);
  if (moves.some((m) => FIELD_SET_MOVES.has(m))) out.push(["A3", "E2 fieldSet: a room, Gravity or a Sport set this turn"]);
  const items = present.some((s) => ["harvest", "pickup", "symbiosis", "cudchew"].includes(toID(c.slots[s].ability))) || moves.includes("recycle") || moves.includes("fling")
    || present.some((s) => c.slots[s].choice === "dynamax" && c.slots[s].gigantamax && toID(c.slots[s].species).startsWith("snorlax"));
  if (items) out.push(["E1 / D", "E2 lastItem: the turn keeps item history (doubles-guards.ts tracksItems)"]);
  if (moves.some((m) => TURNS_MOVES.has(m)) || present.some((s) => c.slots[s].carried?.taunt || c.slots[s].carried?.encore || c.slots[s].carried?.disable)) out.push(["E1 / D", "E2 turnsLeft"]);
  // The accuracy and evasion stages and the status2 volatiles of the stored oracle's E2 (A1's and A2's outcomeMon).
  const file = path.join(ORACLE_DIR, `${c.id}.json`);
  if (fs.existsSync(file)) {
    const r = JSON.parse(fs.readFileSync(file, "utf8"));
    const after = r.walks?.all?.afterTurn?.slots ?? r.walks?.all?.slots ?? {};
    for (const s of present) {
      const o = after[s];
      if (!o) continue;
      const stages = Object.keys(o.boosts ?? {}).filter((k) => /^(accuracy|evasion):/.test(k) && !k.endsWith(":0"));
      const vols = STATUS2_VOLATILES.filter((v) => (o.volatiles?.[v] ?? 0) > 0);
      const owners = new Set([...(stages.length ? ["A1"] : []), ...vols.map((v) => VOLATILE_OWNER[v] ?? "kernel")]);
      if (stages.length || vols.length) out.push([`${[...owners].join(" / ")} (outcomeMon)`, `E2 ${s}: ${[...stages, ...vols].join(", ")} (accuracy and evasion stages, status2 volatiles)`]);
    }
  }
  return out;
}

/** status2 wave 1b (Track V2): [owner, why] for each output of a 1b track that reaches case `c` (header 5, wave 1b). */
const BOND_ABILITIES: Record<string, string> = { battlebond: "battlebond", intrepidsword: "intrepidsword", dauntlessshield: "dauntlessshield", supersweetsyrup: "supersweetsyrup" };
const GMAX_SIDE: Record<string, string> = { charizard: "G-Max Wildfire", venusaur: "G-Max Vine Lash", blastoise: "G-Max Cannonade", coalossal: "G-Max Volcalith" };
const PLEDGES = new Set(["firepledge", "grasspledge", "waterpledge"]);
const HIDDEN = new Set(["fly", "bounce", "dig", "dive", "phantomforce", "shadowforce", "skydrop"]);
const FIELD_SETTLED = new Set(["protosynthesis", "quarkdrive", "mimicry", "forecast", "flowergift", "iceface"]);
const SEEDS = new Set(["electricseed", "grassyseed", "mistyseed", "psychicseed", "boosterenergy", "roomservice"]);
const FIELD_MOVES = new Set(["sunnyday", "raindance", "sandstorm", "snowscape", "hail", "electricterrain", "grassyterrain", "mistyterrain", "psychicterrain", "defog", "icespinner", "steelroller", "tailwind", "trickroom", "gravity", "magicroom", "wonderroom", "splinteredstormshards"]);
function newOutput1b(c: Case): [string, string][] {
  const out: [string, string][] = [];
  const present = SLOTS.filter((s) => !c.slots[s].absent);
  const moveOf = (s: SlotId) => toID(c.slots[s].action.move ?? "");
  const ability = (s: SlotId) => toID(c.slots[s].ability);
  const moves = present.map(moveOf);
  // ADDENDUM2 §2.5's 1b turn facts.
  if (c.game === "sv" && present.some((s) => toID(c.slots[s].species) === "greninjabond" && !c.slots[s].carried?.onceUsed?.includes("battlebond"))) out.push(["K", "\"Assumes {Name} has not had Battle Bond act before in this battle.\""]);
  if (present.some((s) => moveOf(s) === "uproar" && !c.slots[s].carried?.uproar)) out.push(["CL", "\"Assumes {Name} did not use Uproar last turn.\" and Uproar modelled"]);
  if (moves.includes("instruct")) out.push(["CL", "\"Assumes {Name}'s {Move} has PP left.\" (Instruct)"]);
  if (c.game === "usum" && present.some((s) => moveOf(s) === "bide" && !c.slots[s].carried?.bide)) out.push(["PR", "\"Assumes {Name} did not use Bide on an earlier turn.\""]);
  if (c.game === "sv" && present.some((s) => ability(s) === "commander")) out.push(["PR", "\"Assumes {Tatsugiri} went inside {Dondozo} as they came in.\" (Commander derived)"]);
  if (present.some((s) => ability(s) === "cudchew" && !c.slots[s].carried?.cudChew)) out.push(["E2", "\"Assumes {Name} ate no Berry last turn.\" or Cud Chew's counter (Cud Chew modelled)"]);
  if (present.some((s) => ability(s) === "moody")) out.push(["E2", "Moody's residual facts (the turn fact \"Moody raises one stat and lowers another.\" goes)"]);
  if (present.some((s) => ability(s) === "trace" && !c.slots[s].appBuild?.tracedAbility)) out.push(["ST", "Trace's start variants and the fact \"Assumes {Name}'s Trace copied as it came in…\""]);
  if (present.some((s) => ability(s) === "download")) out.push(["ST", "Download's lead order (start rows)"]);
  if (present.some((s) => toID(c.slots[s].item ?? "") === "custapberry" && ["quickdraw", "myceliummight"].includes(ability(s)))) out.push(["ST", "Custap Berry with Quick Draw or Mycelium Might (start variants)"]);
  if (present.some((s) => FIELD_SETTLED.has(ability(s)) || SEEDS.has(toID(c.slots[s].item ?? ""))) && (moves.some((m) => FIELD_MOVES.has(m)) || c.weatherTurns === 1 || c.fieldTurns)) out.push(["FC", "a field-settled holder re-settled on a field change (fieldchange.changed)"]);
  if (present.some((s) => ["windrider", "windpower"].includes(ability(s))) && moves.includes("tailwind")) out.push(["FC", "Wind Rider / Wind Power on Tailwind"]);
  if (c.fieldTurns) out.push(["E2", "the field effects from before the turn ending (fieldTurns: 27.2, 27.6, 27.7)"]);
  if (present.some((s) => c.slots[s].carried?.futureMove)) out.push(["E2", "the landing (Future Sight, Doom Desire)"]);
  if (c.game === "swsh" && present.some((s) => c.slots[s].gigantamax && GMAX_SIDE[toID(c.slots[s].species)])) out.push(["E2 / M", "G-Max damage over time or effects"]);
  if (moves.some((m) => PLEDGES.has(m))) out.push(["PR", "the Pledges (the wait, the combined move, sides.pledge)"]);
  // Integration 1b's own lines (status2/build/INTEGRATION-1B.md): U2's Minimize hit fact (W1B-U2.md), Symbiosis after a Fling and
  // Fling's per-use item (D's ask 2), a drag or selfSwitch with no Pokémon to come in, Smack Down into Fly, Echoed Voice and Room Service.
  const MINIMIZE = ["bodyslam", "dragonrush", "flyingpress", "heatcrash", "heavyslam", "maliciousmoonsault", "steamroller", "stomp", "supercellslam"];
  if (moves.some((m) => MINIMIZE.includes(m)) && (moves.includes("minimize") || present.some((s) => c.slots[s].carried?.minimize))) out.push(["U2 (integrator line)", "the hit fact \"Minimize: double damage.\""]);
  if (moves.includes("fling") && (present.some((s) => ability(s) === "symbiosis") || present.some((s) => moveOf(s) === "fling" && ["lifeorb", "shellbell"].includes(toID(c.slots[s].item ?? ""))))) out.push(["integrator", "Symbiosis after a Fling; Fling's per-use item (no Life Orb, Shell Bell)"]);
  if (moves.some((m) => ["dragontail", "circlethrow", "uturn", "voltswitch", "flipturn"].includes(m)) && (c.canSwitch?.own === false || c.canSwitch?.opponent === false)) out.push(["integrator", "a drag or selfSwitch with no Pokémon to come in"]);
  if (moves.some((m) => m === "smackdown" || m === "thousandarrows") && present.some((s) => ["fly", "bounce"].includes(toID(c.slots[s].carried?.charging ?? "")) || ["fly", "bounce"].includes(moveOf(s)))) out.push(["integrator", "Smack Down landing a Fly user already on the ground"]);
  if (moves.includes("echoedvoice") && present.some((s) => toID(c.slots[s].item ?? "") === "roomservice")) out.push(["integrator", "Echoed Voice's pseudo-weather and Room Service"]);
  if (!c.outcomes) return out;
  // E2's 1b fields (ADDENDUM2 §3.1).
  if (present.some((s) => HIDDEN.has(moveOf(s)) || c.slots[s].carried?.charging)) out.push(["H / E2", "E2 charging and the hidden move's volatile"]);
  if (["sv", "champions"].includes(c.game) && present.some((s) => BOND_ABILITIES[ability(s)])) out.push(["K / E2", "E2 onceUsed"]);
  if (present.some((s) => c.slots[s].carried?.taunt || c.slots[s].carried?.encore || c.slots[s].carried?.disable || c.slots[s].carried?.uproar) || moves.some((m) => ["taunt", "encore", "disable", "uproar"].includes(m))) out.push(["E2", "E2 turnsLeft taunt, encore, disable, uproar"]);
  if (present.some((s) => ability(s) === "cudchew")) out.push(["E2", "E2 cudChew"]);
  if (present.some((s) => c.slots[s].gigantamax && toID(c.slots[s].species) === "machamp")) out.push(["M", "E2 chiStrike"]);
  return out;
}
/** The 11 wave 1a cases integration 1a left open (INTEGRATION-1A.md §2), each its 1b owner's: they change as it lands. */
const OPEN_1A: Record<string, string> = {
  "CR-08a-sv": "ST", "CR-08b-sv": "ST", "CR-08c-sv": "ST", "G4-OPP-07-sv": "ST", "SAT-IMP-1-sv": "ST", "SAT-IMP-1-swsh": "ST", "G4-STF-02-usum": "ST",
  "G4-LMV-01-champions": "E2", "G4-LMV-02-sv": "E2", "G4-ENC-01-sv": "E2", "G4-FLG-09-sv": "integrator (Symbiosis)",
};
/** status2 wave 1b: the 1b rows over STORED_1B (header 1, 3 and 5 for wave 1b). */
function listChanged1b(): Listed[] {
  const out: Listed[] = [];
  for (const [id, owner] of Object.entries(OPEN_1A)) out.push({ id, why: "a case integration 1a left open (INTEGRATION-1A.md §2)", owner, wave: "1b", reexpect: false, oracle: false });
  for (const c of STORED_1B) {
    for (const [kind, text] of [["notEstimated", c.notEstimated], ["endNotEstimated", c.endNotEstimated]] as const) {
      if (!text) continue;
      const r = removalOf(text);
      if (!r || r.wave !== "1b") continue;
      out.push({ id: c.id, why: `${kind} "${text}" → ${r.key}${REEXPECT_TO[c.id]?.[kind] ? ` (now "${REEXPECT_TO[c.id][kind]}")` : ""}`, owner: r.owner, wave: "1b", reexpect: true, oracle: !REEXPECT_TO[c.id]?.[kind] });
    }
    const moves = SLOTS.filter((s) => !c.slots[s].absent).map((s) => toID(c.slots[s].action.move ?? ""));
    const events = [moves.includes("magnitude") && "magnitude", SLOTS.some((s) => c.slots[s].gigantamax && toID(c.slots[s].species) === "snorlax") && "gmaxreplenish"].filter(Boolean);
    if (events.length) out.push({ id: c.id, why: `the oracle's 1b random events reach it: ${events.join(", ")} (sim-dfs.ts)`, owner: "V2", wave: "1b", reexpect: false, oracle: true });
    for (const [owner, why] of newOutput1b(c)) out.push({ id: c.id, why, owner, wave: "1b", reexpect: false, oracle: false });
  }
  return out;
}

/** Everything the build changes among the stored cases (1–3 of the header; 4 with c19; wave 1b's rows with wave1b). */
export function listChanged(opts: { c19?: boolean; wave1b?: boolean; wave2?: boolean } = {}): Listed[] {
  const out: Listed[] = [...(opts.wave1b ? listChanged1b() : []), ...(opts.wave2 ? [...listChanged2(), ...listChangedReview2()] : [])];
  for (const c of STORED) {
    for (const [kind, text] of [["notEstimated", c.notEstimated], ["endNotEstimated", c.endNotEstimated]] as const) {
      if (!text) continue;
      const r = removalOf(text);
      if (!r || r.wave === "kept" || r.wave === "2") continue;
      out.push({ id: c.id, why: `${kind} "${text}" → ${r.key}`, owner: r.owner, wave: r.wave, reexpect: true, oracle: true });
    }
    // 2: a crash move into a target that protects, is immune, absorbs or is out of reach (Step 1 #10).
    for (const slot of SLOTS) {
      const move = c.slots[slot].action.move;
      if (!move || !CRASH_MOVES.has(toID(move))) continue;
      const target = c.slots[slot].action.target as SlotId | undefined;
      const t = target ? c.slots[target] : null;
      const blocked = t && (PROTECTS.has(toID(t.action.move ?? "")) || ["voltabsorb", "lightningrod", "motordrive"].includes(toID(t.ability)) || ["Gengar", "Mimikyu", "Dragapult", "Aegislash"].includes(t.species));
      if (blocked) out.push({ id: c.id, why: `a crash move (${move}) into ${target}'s ${t!.action.move ?? t!.ability} (Step 1 #10)`, owner: "Step 1 / H", wave: "1a", reexpect: false, oracle: false });
    }
    // 3: the harness's new random events.
    const items = SLOTS.map((s) => toID(c.slots[s].item ?? "")), abilities = SLOTS.map((s) => toID(c.slots[s].ability));
    const moves = SLOTS.map((s) => toID(c.slots[s].action.move ?? ""));
    const events = [
      items.includes("focusband") && "focusband",
      abilities.includes("harvest") && "harvest",
      // Cute Charm's 30% stays a failed added effect, so only Attract itself or a carried infatuation reaches the 1/2.
      (moves.includes("attract") || SLOTS.some((s) => c.slots[s].carried?.attract)) && "attract",
      SLOTS.some((s) => (c.slots[s].carried?.stall ?? 1) > 1) && "stall",
    ].filter(Boolean);
    if (events.length) out.push({ id: c.id, why: `the oracle's new chance events reach it: ${events.join(", ")} (sim-dfs.ts CHANCE_EFFECTS)`, owner: "V1", wave: "1a", reexpect: false, oracle: true });
    // 5: the app's new output (no reason goes, no oracle re-run: diff mode compares the case again).
    for (const [owner, why] of newOutput(c)) out.push({ id: c.id, why, owner, wave: "1a", reexpect: false, oracle: false });
  }
  if (opts.wave1b) {
    // The 1a loop above lists the stored cases' 1b reasons too: one row each.
    const seen = new Set<string>();
    for (let i = out.length - 1; i >= 0; i--) {
      const key = `${out[i].id}|${out[i].why.split(" (now")[0]}`;
      if (seen.has(key)) out.splice(i, 1);
      else seen.add(key);
    }
  }
  if (opts.c19) {
    // 4: C19 (status2/build/step1-c19-scan.ts's scan): a flag the leads' entry set, read by a move of the turn.
    const side = (slot: SlotId) => (slot.startsWith("own") ? "own" : "opponent");
    for (const c of STORED) {
      if (SLOTS.some((slot) => c.slots[slot].action.switchIn)) continue;
      let b: any;
      try { ({ b } = prepare(c, hiddenCases(c)[0].hidden, { keepEntryFlags: true })); } catch { continue; }
      const moves = Object.fromEntries(SLOTS.map((slot) => [slot, c.slots[slot].absent || c.slots[slot].action.move === null ? null : toID(c.slots[slot].action.move!)])) as Record<SlotId, string | null>;
      for (const slot of SLOTS) {
        if (c.slots[slot].absent) continue;
        const p = pokemonAt(b, slot);
        const readers: string[] = [];
        // A flag the case gives the app as well (CaseMon.earlierThisTurn, status2 Step 1 #11: CQ-ETT-01, 02) is read on both sides.
        const given = c.slots[slot].earlierThisTurn ?? {};
        if (p.statsLoweredThisTurn && !given.statsLowered && moves[slot] === "lashout") readers.push("Lash Out");
        if (p.statsRaisedThisTurn && !given.statsRaised) for (const user of SLOTS) if ((moves[user] === "burningjealousy" && side(user) !== side(slot)) || (moves[user] === "alluringvoice" && c.slots[user].action.target === slot)) readers.push(moves[user]!);
        if (p.usedItemThisTurn && !given.usedItem) for (const holder of SLOTS) if (!c.slots[holder].absent && holder !== slot && toID(c.slots[holder].ability) === "pickup") readers.push("Pickup");
        if (readers.length) out.push({ id: c.id, why: `C19: ${slot}'s entry flag read by ${readers.join(", ")} (asserted none)`, owner: "V1", wave: "1a", reexpect: false, oracle: true });
      }
    }
  }
  return out;
}

const STEP1_IDS = new Set(["ER20", "S26d", "VE-F4-2", "VE-M1-3", "FE-FX02b"]);
function paths(x: unknown, y: unknown, at: string, out: string[]) {
  if (JSON.stringify(x) === JSON.stringify(y)) return;
  if (x && y && typeof x === "object" && typeof y === "object" && Array.isArray(x) === Array.isArray(y)) {
    for (const key of new Set([...Object.keys(x as object), ...Object.keys(y as object)])) paths((x as Record<string, unknown>)[key], (y as Record<string, unknown>)[key], `${at}.${key}`, out);
    return;
  }
  out.push(at);
}
const readApp = (dir: string, id: string) => {
  const file = path.join(dir, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  delete json.ms;
  return json;
};

if (process.argv[1]?.replace(/\\/g, "/").endsWith("build/changed-cases.ts")) {
  const args = process.argv.slice(2);
  const mode = args.find((a) => !a.startsWith("--")) ?? "list";
  const waves = (args.find((a) => a.startsWith("--wave="))?.split("=")[1] ?? "1a").split(",");
  const inWave = (w: Wave) => waves.includes("all") || waves.includes(w);
  const with1b = inWave("1b"), with2 = inWave("2");
  const listed = listChanged({ c19: args.includes("--c19"), wave1b: with1b, wave2: with2 });
  // The stored set of the waves given: from 1b's view every case before wave 1b.
  const isNewCase = (id: string) => (with2 ? wave2.has(id) : with1b ? wave1b.has(id) || wave2.has(id) : wave1a.has(id) || wave1b.has(id) || wave2.has(id));
  if (mode === "list") {
    for (const l of listed) console.log(`${l.id} [${l.owner}, wave ${l.wave}]: ${l.why}`);
    const c19 = listed.filter((l) => l.why.startsWith("C19"));
    console.log(`\n${with2 ? STORED_2.length : with1b ? STORED_1B.length : STORED.length} stored cases: ${new Set(listed.map((l) => l.id)).size} listed (${listed.filter((l) => l.wave === "1a").length} rows for wave 1a, ${listed.filter((l) => l.wave === "1b").length} for 1b, ${listed.filter((l) => l.wave === "2").length} for 2)${args.includes("--c19") ? `; C19 readers: ${c19.length} (asserted 0)` : ""}`);
    if (c19.length) process.exitCode = 1;
  } else if (mode === "oracle-ids") {
    console.log([...new Set(listed.filter((l) => l.oracle && inWave(l.wave)).map((l) => l.id))].join(" "));
  } else if (mode === "diff") {
    const [baseDir, newDir] = args.filter((a) => !a.startsWith("--")).slice(1).map((d) => path.resolve(d));
    if (!baseDir || !newDir) throw new Error("usage: changed-cases.ts diff <base app-results> <new app-results>");
    (async () => {
      await loadRuntimes();
      const byId = new Map<string, Listed[]>();
      for (const l of listed) if (inWave(l.wave)) (byId.get(l.id) ?? byId.set(l.id, []).get(l.id)!).push(l);
      let same = 0, bad = 0, changedStored = 0;
      for (const c of CASES) {
        const before = readApp(baseDir, c.id), after = readApp(newDir, c.id);
        if (!after) { if (!c.notEstimated || before) { console.log(`${c.id}: MISSING in ${newDir}`); bad++; } continue; }
        const isNew = !before;
        let what = "new case";
        if (before) {
          const changed: string[] = [];
          paths(before, after, "", changed);
          if (!changed.length) { same++; continue; }
          const tops = [...new Set(changed.map((p) => p.split(".").slice(1, 4).join(".")))];
          what = `${changed.length} paths changed (${tops.slice(0, 6).join(", ")}${tops.length > 6 ? ", …" : ""})`;
        }
        const stored = !isNewCase(c.id);
        const reasons = byId.get(c.id) ?? [];
        if (stored && !isNew) changedStored++;
        const explained = !stored || isNew || reasons.length > 0 || STEP1_IDS.has(c.id);
        // A listed stored case whose reason goes is compared as estimated (its fresh oracle result).
        const reexpect = reasons.some((r) => r.reexpect) && after.result?.status === "ready";
        const to = REEXPECT_TO[c.id];
        const asCase: Case = to ? { ...c, ...to } : reexpect ? { ...c, notEstimated: undefined, endNotEstimated: reasons.some((r) => r.why.startsWith("endNotEstimated")) ? undefined : c.endNotEstimated } : c;
        const runtime = await runtimeFor(c);
        const mismatches = compareCase(asCase, readOracle(c.id), after.result, (moveId) => runtime.movesById.get(moveId)?.category === "Status", after.outcomes);
        const verdict = asCase.notEstimated ? (after.result?.reason === asCase.notEstimated ? "not estimated as listed" : `NOT ESTIMATED REASON DIFFERS (${after.result?.status}: ${after.result?.reason ?? ""})`) : mismatches.length ? `${mismatches.length} MISMATCHES` : "matches the oracle";
        const fails = !explained || verdict.startsWith("NOT") || verdict.endsWith("MISMATCHES");
        if (fails) bad++;
        if (stored || fails) console.log(`${c.id}: ${stored ? (reasons.length ? reasons.map((r) => `${r.owner}: ${r.why}`).join("; ") : STEP1_IDS.has(c.id) ? "Step 1 (step1-changed.ts)" : "NOT LISTED") : wave2.has(c.id) ? "wave 2 case" : wave1b.has(c.id) ? "wave 1b case" : "wave 1a case"}: ${what}; ${verdict}`);
      }
      console.log(`\n${CASES.length} cases: ${same} unchanged, ${changedStored} stored cases changed, ${bad} failing the gate.`);
      if (bad) process.exitCode = 1;
    })();
  } else throw new Error(`unknown mode ${mode}`);
}
