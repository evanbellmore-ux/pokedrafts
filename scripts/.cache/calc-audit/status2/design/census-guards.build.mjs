// CENSUS 2 builder: census-guards.data.mjs + the probes' outputs → census-guards.json and census-guards.md.
// Run from the repo root (after census-usage.ts and census-sim.ts):
//   node scripts/.cache/calc-audit/status2/design/census-guards.build.mjs
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DIR = path.resolve("scripts/.cache/calc-audit/status2/design");
const { ENTRIES, ENABLERS } = await import(pathToFileURL(path.join(DIR, "census-guards.data.mjs")).href);
const usage = JSON.parse(fs.readFileSync(path.join(DIR, "census-usage.out.json"), "utf8"));
const simOut = JSON.parse(fs.readFileSync(path.join(DIR, "census-sim.out.json"), "utf8"));
const GAMES = ["champions", "sv", "swsh", "usum"];
// The L move names from the four catalogs, for exact "{Move} is not modelled." patterns.
const CATALOGS = ["data/champions/catalog.json", "data/battle/scarlet_violet/catalog.json", "data/battle/sword_shield/catalog.json", "data/battle/ultra_sun_ultra_moon/catalog.json"];
const moveNames = new Map();
for (const file of CATALOGS) for (const m of JSON.parse(fs.readFileSync(path.resolve(file), "utf8")).moves) moveNames.set(m.id, m.name);
const reEsc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const L_NAMES = usage.groups.filter((g) => g.id.startsWith("L:")).map((g) => reEsc(moveNames.get(g.id.slice(2)) ?? g.id.slice(2))).join("|");
const L_LAST = `^(${L_NAMES}) is not modelled\\.$`, L_BEFORE = `^(${L_NAMES}) is not modelled and comes before another move\\.$`;
const groups = new Map(usage.groups.map((g) => [g.id, g]));

// The stored app results of the 1264 oracle cases (their not-estimated reasons).
const RESULTS = path.resolve("scripts/.cache/calc-audit/2v2/verify/app-results");
const cases = [];
for (const file of fs.readdirSync(RESULTS)) {
  if (!file.endsWith(".json")) continue;
  let json; try { json = JSON.parse(fs.readFileSync(path.join(RESULTS, file), "utf8")); } catch { continue; }
  const r = json.result ?? json;
  cases.push({ id: file.slice(0, -5), turn: r.status === "not-estimated" ? r.reason : null, end: r.endOfTurn?.status === "not-estimated" ? r.endOfTurn.reason : null });
}

const pct = (x, digits = 2) => (x > 0 && x * 100 < 10 ** -digits ? `< ${(10 ** -digits).toFixed(digits)} %` : `${(x * 100).toFixed(digits)} %`);
const sentence = (t) => t.replace(/\.+$/, "");
function simShare(summary, regexes) {
  const res = regexes.map((r) => new RegExp(r));
  const hit = (list) => list.filter((e) => res.some((re) => re.test(e.reason))).reduce((n, e) => n + e.n, 0);
  return { turn: hit(summary.turnReasons), end: hit(summary.endReasons), of: summary.turns };
}

const entries = ENTRIES.map((e0) => {
  const e = e0.id === "l-moves" ? { ...e0, sim: [L_BEFORE, L_LAST] } : e0;
  const gs = (e.usage ?? []).map((id) => groups.get(id)).filter(Boolean);
  const present = Object.fromEntries(GAMES.map((game) => [game, gs.reduce((n, g) => n + (g.games[game].moves.length + g.games[game].abilities.length + g.games[game].items.length ? g.games[game].carriers : 0), 0)]));
  const games = e.family === "training" ? ["champions"] : e.games ?? (gs.length ? GAMES.filter((game) => present[game] > 0) : GAMES);
  const perMon = gs.length ? 1 - gs.reduce((p, g) => p * (1 - g.champions.perMon), 1) : null;
  const top = gs.flatMap((g) => g.champions.top).slice(0, 3);
  // Switch-outs: the sampler attributes each to its trigger (census-sim.ts switchTrigger).
  const bySwitch = (summary) => {
    const hit = (e.switchBy ?? []).map((t) => summary.switchBy?.[t] ?? { turn: 0, end: 0 });
    return { turn: hit.reduce((n, h) => n + h.turn, 0), end: hit.reduce((n, h) => n + h.end, 0), of: summary.turns };
  };
  const champ = e.switchBy ? bySwitch(simOut.champions) : e.sim?.length ? simShare(simOut.champions, e.sim) : null;
  const sv = e.switchBy ? bySwitch(simOut.scarletVioletRandomBattle) : e.sim?.length ? simShare(simOut.scarletVioletRandomBattle, e.sim) : null;
  const idRes = (e.oracle ?? []).map((id) => new RegExp(`^${id}$`));
  const reasonRes = (e.sim ?? []).map((r) => new RegExp(r));
  const oracle = cases.filter((c) => idRes.some((re) => re.test(c.id)) || [c.turn, c.end].some((t) => t && reasonRes.some((re) => re.test(t)))).map((c) => c.id).sort();
  return {
    ...e, games,
    frequency: {
      carriers: present,
      championsPerPokemon: perMon, championsAnyOfFour: perMon === null ? null : 1 - (1 - perMon) ** 4, championsTop: top,
      simChampions: champ ? { turn: champ.turn / champ.of, end: champ.end / champ.of, turns: champ.turn, endTurns: champ.end } : null,
      simScarletVioletRandom: sv ? { turn: sv.turn / sv.of, end: sv.end / sv.of, turns: sv.turn, endTurns: sv.end } : null,
      oracleCases: oracle,
    },
  };
});

// Families and totals.
const FAMILY_TITLES = {
  switch: "A. Switch-out with an unknown replacement (REASONS.switchesOut)",
  named: "B. The other guards the user named",
  final: "C. FINAL.md's open list",
  status: "D. Status-move guards (doubles-status.ts)",
  kernel: "E. Damaging-move and third-party guards (doubles-turn.ts)",
  presence: "F. Presence guards, known before the walk",
  "track-e": "G. Positions, items, Substitute (Track E)",
  eot: "H. End of turn only (doubles-eot.ts)",
  settle: "I. The start settle (calculate.ts settleDoublesStart)",
  row: "J. Row and step reasons read from the 1v1 calculation",
  training: "K. Training's rollout reasons (bridge.ts, splits.ts, prelude.ts)",
};
const byFamily = Object.fromEntries(Object.keys(FAMILY_TITLES).map((f) => [f, entries.filter((e) => e.family === f)]));
const sizes = entries.reduce((m, e) => ({ ...m, [e.size]: (m[e.size] ?? 0) + 1 }), {});
const champ = simOut.champions, sv = simOut.scarletVioletRandomBattle;

// Family shares of the Champions sample (each reason counted once, first family that matches).
const FAMILY_SIM = [
  ["Switch-out, replacement unknown", /switches out: the replacement is not known/],
  ["Spread heal (Matcha Gotcha, Parabolic Charge, Shell Bell)", /heals from more than one target/],
  ["Disable / Encore without the last move (calculator input)", /needs .*'s move from the last turn/],
  ["Type change (Protean, Libero, Roost, Burn Up, Double Shock)", /changes .*'s type: later moves/],
  ["L status moves (census 1)", new RegExp(`${L_BEFORE}|${L_LAST}`)],
  ["Trace's random copy (an input the calculator has)", /^Trace copies/],
  ["Spread move's effect on its user (Spicy Spray...)", /from more than one target is not modelled/],
  ["A priority shield or Psychic Terrain against an ally's move", /against an ally's move/],
  ["Semi-invulnerable after a charge turn", /is semi-invulnerable after/],
  ["Imposter", /^Imposter/],
  ["Round, Beat Up, Mirror Coat (presence moves)", /^(Round|Beat Up|Mirror Coat|Counter|Spotlight|Fusion Bolt|Fusion Flare|Flame Burst|Beak Blast|Shell Trap|Sky Drop|Comeuppance|Metal Burst) is not modelled/],
  ["Unnerve and a resist Berry", /^(Unnerve|As One).* is not modelled/],
  ["Imprison without the user's moves (input)", /^Imprison needs/],
  ["Instruct (calling moves)", /^(Instruct|Copycat|Me First|Metronome) is not modelled/],
  ["Fling", /^Fling is not verified/],
  ["One-hit KO moves", /^One-hit KO move/],
];
function familySim(summary) {
  const rows = FAMILY_SIM.map(([label, re]) => ({ label, turn: 0, end: 0 }));
  const other = { label: "Everything else", turn: 0, end: 0 };
  for (const [kind, list] of [["turn", summary.turnReasons], ["end", summary.endReasons]]) {
    for (const e of list) {
      const i = FAMILY_SIM.findIndex(([, re]) => re.test(e.reason));
      (i >= 0 ? rows[i] : other)[kind] += e.n;
    }
  }
  return [...rows, other].filter((r) => r.turn + r.end > 0);
}
const champFamilies = familySim(champ), svFamilies = familySim(sv);

const json = {
  title: "CENSUS 2: every \"not estimated\" path still reachable in 2v2",
  branch: "calc-2v2-status-2 (main 4008ee8)", groundTruth: "pinned Pokémon Showdown c23d2e94",
  sources: {
    usage: usage.source, sim: { file: "census-sim.out.json", seed: simOut.seed, champions: `${champ.turns} usage-weighted turns`, scarletViolet: `${sv.turns} Random Battle Doubles turns (damaging moves only, default ability, no item)` },
    oracle: "scripts/.cache/calc-audit/2v2/verify/app-results (the stored app results of the oracle corpus)", probes: "census-probes.ts / census-probes.out",
  },
  totals: {
    entries: entries.length, byFamily: Object.fromEntries(Object.entries(byFamily).map(([f, list]) => [f, list.length])), bySize: sizes,
    namedByUser: entries.filter((e) => e.named?.by === "user").map((e) => e.id), finalOpen: entries.filter((e) => e.named?.by === "final").map((e) => e.id),
    champions: { turns: champ.turns, notEstimated: champ.notEstimated, endNotEstimated: champ.endNotEstimated, families: champFamilies },
    scarletVioletRandom: { turns: sv.turns, notEstimated: sv.notEstimated, endNotEstimated: sv.endNotEstimated, issues: sv.issues, families: svFamilies },
    trainingRolloutShare: "7.4–10.9 % of evaluated cells in scripts/.cache/training/eval/final (byMethod; per-reason counts are not recorded)",
  },
  enablers: Object.fromEntries(Object.entries(ENABLERS).map(([id, text]) => [id, { text, unlocks: entries.filter((e) => e.enablers?.includes(id)).map((e) => e.id) }])),
  entries,
};
fs.writeFileSync(path.join(DIR, "census-guards.json"), JSON.stringify(json, null, 1));

// ---------------------------------------------------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------------------------------------------------
const esc = (s) => String(s ?? "").replace(/\|/g, "\\|");
const freqText = (e) => {
  const f = e.frequency, out = [];
  if (f.simChampions && (f.simChampions.turns || f.simChampions.endTurns)) out.push(`Champions sample: ${f.simChampions.turns ? `turn ${pct(f.simChampions.turn)}` : ""}${f.simChampions.turns && f.simChampions.endTurns ? ", " : ""}${f.simChampions.endTurns ? `end ${pct(f.simChampions.end)}` : ""}`);
  if (f.simScarletVioletRandom && (f.simScarletVioletRandom.turns || f.simScarletVioletRandom.endTurns)) out.push(`SV proxy: ${f.simScarletVioletRandom.turns ? `turn ${pct(f.simScarletVioletRandom.turn)}` : ""}${f.simScarletVioletRandom.turns && f.simScarletVioletRandom.endTurns ? ", " : ""}${f.simScarletVioletRandom.endTurns ? `end ${pct(f.simScarletVioletRandom.end)}` : ""}`);
  if (f.championsPerPokemon !== null && e.games.includes("champions")) out.push(`Champions usage: ${pct(f.championsPerPokemon)} of team slots carry it (${pct(f.championsAnyOfFour, 1)} of fields)${f.championsTop.length ? `, ${f.championsTop.join(", ")}` : ""}`);
  if (f.oracleCases.length) out.push(`oracle cases: ${f.oracleCases.length} (${f.oracleCases.slice(0, 6).join(", ")}${f.oracleCases.length > 6 ? ", …" : ""})`);
  if (e.freqNote) out.push(e.freqNote);
  return out.length ? out.join("; ") : "not met in the samples or the stored cases";
};
const gamesText = (e) => (e.games.length === 4 ? "all four" : e.games.length ? e.games.join(", ") : "none");
const shortFreq = (e) => (e.freqNote ? `${baseFreq(e)} (${e.freqNote})` : baseFreq(e));
const baseFreq = (e) => {
  const f = e.frequency;
  if (f.simChampions && (f.simChampions.turns || f.simChampions.endTurns)) return `${pct(f.simChampions.turn + f.simChampions.end)} of sampled Champions turns`;
  if (f.simScarletVioletRandom && (f.simScarletVioletRandom.turns || f.simScarletVioletRandom.endTurns)) return `${pct(f.simScarletVioletRandom.turn + f.simScarletVioletRandom.end)} of SV proxy turns`;
  if (!e.games.includes("champions")) return `no usage data for ${e.games.join(", ")}`;
  if (f.championsPerPokemon !== null) return `not sampled; its trigger is on ${f.championsPerPokemon > 0 ? pct(f.championsPerPokemon) : "no"} Champions team slots`;
  return "not sampled";
};
const entryBlock = (e) => [
  `#### ${e.id} (${e.size}${e.named ? `; ${e.named.by === "user" ? "named by the user" : "FINAL.md open"}: ${esc(e.named.as)}` : ""})`,
  "",
  `- Reason: \`${e.reason}\` (${e.key}; ${e.phase})`,
  `- Where: ${e.sites.join("; ")}`,
  `- Fires: ${e.fires}`,
  `- Games: ${gamesText(e)}. How often: ${freqText(e)}.`,
  `- Showdown: ${e.showdown}`,
  `- Modelling: ${e.modelling}${e.enablers?.length ? ` Enablers: ${e.enablers.join(", ")}.` : ""}`,
  ...(e.training ? [`- Training: ${e.training}`] : []),
  ...(e.ui ? [`- UI: ${e.ui}`] : []),
  "",
].join("\n");

const famTable = (rows, turns) => [
  "| Family | Turn not estimated | End of turn only |", "|---|---|---|",
  ...rows.map((r) => `| ${esc(r.label)} | ${r.turn ? `${r.turn} (${pct(r.turn / turns)})` : "-"} | ${r.end ? `${r.end} (${pct(r.end / turns)})` : "-"} |`),
].join("\n");

/** The named tables' cells: what Showdown does and what modelling needs, in a line each (the entries have the detail). */
const BRIEF = {
  "switch-ejectpack": ["A drop marks it; at the move's AfterMove it is used and the holder's player picks a replacement mid-turn (not in Champions).", "Slot replacement (chosen) at the action's end; stage events for the drop."],
  "copies-rise": ["The foe's positive changes are summed and copied at the end of that action (AfterMove), at a switch-in, or at residual 29; Mirror Herb is then used up.", "Stage events with amounts; apply the copy through applyBoosts after the action; Mirror Herb's use."],
  harvest: ["Residual 28.2: in sun, or 1/2 otherwise, a Berry eaten earlier comes back; the final Update can eat it again.", "Item history (last Berry), a 28.2 handler with the 1/2 branch, setItem."],
  pickup: ["Residual 28.2: an item another active Pokémon used up this turn, picked at random among them.", "Item history (used, not taken), a uniform branch, setItem."],
  "hidden-stages": ["Stored Power, Power Trip and Punishment count accuracy and evasion stages; the engine counts Attack to Speed.", "A base-power override from the hidden stages, 2v2 only."],
  fling: ["Power from the item's fling data; the item is gone at the Update; Berries, Herbs, Orbs, Light Ball, King's Rock act on the target.", "A verified 1v1 Fling first; then the item loss (Unburden, Symbiosis) and the target's effect."],
  ohko: ["Fails on a higher level, Dynamax, Sturdy, an Ice type (Sheer Cold) or a type immunity; otherwise deals the target's HP (Endure, Sash, Substitute, Disguise still act).", "A target's-HP hit in 2v2 under the hit rule."],
  "spread-heal": ["Each target's drain heal right after its damage, in hit order; Shell Bell once from the total.", "Follow the attacker through the spread steps (drain per target, Shell Bell from the sum)."],
  "l-moves": ["Census 1.", "Census 1."],
  "berry-locked": ["The lock clears when any move reaches the holder (AfterMoveSecondary) or non-move damage hits it; the Berry is eaten at that action's Update; the lock outlives the turn.", "Leftovers stand-in during later hits, berryDue at the action's Update; DoublesCarried.berryLocked for the next turn."],
  "psychic-noise": ["Heal Block for 2 turns: no drain, Shell Bell, HP Berry, absorbing heal, heal moves.", "Heal Block through every later step (attacker and target side)."],
  "starf-random": ["+2 to a random stat below +6.", "Branch the world from the step's or the start's eaten Starf."],
  "trace-curing-ability": ["The copied ability cures at the turn's first Update.", "Read tracedAbility in ownCuresAtStart and the facts (a correctness fix)."],
  "ghost-curse-ko-chance": ["The user loses half its maximum HP and can faint.", "Record the cost as a loss and the faint as another faint."],
  "perish-projection": ["Perish count 3 after this turn's residual.", "compare.ts projects the count after the moves."],
  "eot-white-herb-lansat-text": ["White Herb restores accuracy and evasion too; Lansat gives the focusenergy volatile.", "Read the hidden stages; settledFocusEnergy."],
  "comatose-order": ["Type immunity before SetStatus.", "Swap the checks (text only)."],
};
const named = entries.filter((e) => e.named?.by === "user");
const finals = entries.filter((e) => e.named?.by === "final");
const sw = byFamily.switch;
const swShare = (e) => { const s = e.frequency.simChampions; return s && (s.turns || s.endTurns) ? `turn ${pct(s.turn)}, end ${pct(s.end)}` : "not met"; };
const md = `# CENSUS 2: every "not estimated" path still reachable in 2v2

Design only. Branch \`calc-2v2-status-2\` (main 4008ee8); no app code, test or doc changed. Ground truth: pinned Pokémon
Showdown c23d2e94; \`PS/...\` is \`node_modules/.cache/champions/pokemon-showdown-c23d2e942c9c0daadb13a7162a385bf78e3c9353/...\`.

Files in \`scripts/.cache/calc-audit/status2/design/\`:
- \`census-guards.json\`: every entry below, machine-readable, with its measured frequencies.
- \`census-guards.data.mjs\` (the entries) and \`census-guards.build.mjs\` (writes the json and this file).
- \`census-usage.ts\` → \`census-usage.out(.json)\`: per trigger, catalog presence in the four games and its Champions usage share.
- \`census-sim.ts\` → \`census-sim.out(.json)\`: ${champ.turns} usage-weighted Champions turns and ${sv.turns} Scarlet/Violet Random Battle Doubles turns run through today's \`calculateDoublesTurn\`, with the histogram of reasons.
- \`census-probes.ts\` → \`census-probes.out\`: pinned-Showdown protocol for the guards the user named (Matcha Gotcha's per-target drain, U-turn's mid-turn request, Opportunist's timing, Eject Pack, Imposter's target, Harvest twice in one turn, Pickup, Stored Power reading evasion, Red Card's random drag).

## 1. Summary

- **${entries.length} entries** in ${Object.keys(FAMILY_TITLES).length} families (${Object.entries(byFamily).map(([f, l]) => `${f} ${l.length}`).join(", ")}); sizes ${Object.entries(sizes).map(([s, n]) => `${s} ${n}`).join(", ")}. Each of the 39 REASONS keys in \`doubles-actions.ts\` has a live call site (127 call sites, notIn2v2 alone 50; ADDENDUM's \`substituteHit\` is gone); the other texts are literals (the start settle, the 1v1 rows, the pairwise step, Training).
- **How often, Champions** (usage-weighted sample, ${champ.turns} turns, every Pokémon with a move of any category, random legal targets): **${pct(champ.notEstimated / champ.turns, 1)} of turns are not estimated** and ${pct(champ.endNotEstimated / champ.turns, 1)} more have the end of turn not estimated: ${pct((champ.notEstimated + champ.endNotEstimated) / champ.turns, 1)} lose something.

${famTable(champFamilies, champ.turns)}

- **Scarlet/Violet proxy** (Random Battle Doubles sets: damaging moves, default abilities, no items; ${sv.issues} turns had input issues): ${pct(sv.notEstimated / sv.turns, 1)} not estimated, ${pct(sv.endNotEstimated / sv.turns, 1)} end of turn. The switch family dominates (U-turn, Volt Switch, Flip Turn are common there); Harvest and Shields Down there are artifacts of the proxy (no item, Minior's Core form at full HP).

${famTable(svFamilies, sv.turns)}

- **Training** (Champions only): ${json.totals.trainingRolloutShare}. Every engine reason sends its cell to a rollout (\`evaluate.ts:271\`); the bridge adds its own (family K).
- **The user's named guards are rare except one**: spread heals (Sinistcha's Matcha Gotcha) are the largest single reason in Champions (${pct(entries.find((e) => e.id === "spread-heal").frequency.simChampions.turn)} of turns). Eject Pack and Mirror Herb do not exist in Champions; Opportunist is Espathra's alone; Harvest, Pickup, Fling, one-hit KO moves and Stored Power after an evasion rise are each under 0.1 %.
- **Biggest wins by frequency**: the switch-out family (${pct(champFamilies[0].turn / champ.turns + champFamilies[0].end / champ.turns, 1)} of Champions turns; XL), spread heals (M), the calculator's missing last-move input for Encore and Disable (S, no mechanics), world types for Protean / Libero / Roost (M).
- **Hardest**: (1) slot replacement (a slot's Pokémon changes mid-turn: entry effects, hazards, Intimidate chains, the bench as input in the calculator and as policy or belief in Training, E2 reporting two Pokémon for one slot); (2) the field-change re-settle (Protosynthesis, Quark Drive, Booster Energy, Forecast, Mimicry, Ice Face, Seeds, common in SV); (3) ability changes mid-turn (Neutralizing Gas ending, Skill Swap family, Receiver, Core Enforcer: each new ability's Start); (4) the 73 L moves (census 1).
- **One correctness gap that is not a guard**: a Trace holder that copied a curing ability is not cured as the turn starts (FINAL.md open item; \`doubles-status.ts\` ownCuresAtStart reads \`abilityId\`, not \`tracedAbility\`). Fix it first.

## 2. The guards the user named

| Guard | Reason (exact) | Games | How often | What Showdown does | Modelling | Size |
|---|---|---|---|---|---|---|
${named.map((e) => `| ${esc(e.named.as)} | \`${esc(e.reason)}\` | ${gamesText(e)} | ${esc(shortFreq(e))} | ${esc(BRIEF[e.id]?.[0] ?? sentence(e.showdown.split("; ")[0]))} | ${esc(BRIEF[e.id]?.[1] ?? sentence(e.modelling.split(". ")[0]))} | ${e.size} |`).join("\n")}

## 3. FINAL.md's open list (status-eot build)

| Item | Kind | How often | Modelling | Size |
|---|---|---|---|---|
${finals.map((e) => `| ${esc(e.named.as)} | ${esc(e.key)} | ${esc(shortFreq(e))} | ${esc(BRIEF[e.id]?.[1] ?? sentence(e.modelling.split(". ")[0]))} | ${e.size} |`).join("\n")}
| Eject Pack mid-turn, Opportunist / Mirror Herb, the spread heal, Fling, one-hit KO, accuracy and evasion stages, Harvest, Pickup | also named by the user | section 2 | section 2 | - |

## 4. The switch-out family ("{Name} switches out: the replacement is not known.")

One reason, ${sw.length} trigger groups, both phases: with a later living action the whole turn is not estimated
(\`doubles-turn.ts\` eventGuards, hitReactions, afterHit; \`doubles-status.ts\` switchOut); with none the moves are
estimated and the end of turn is not (\`World.leaving\` → \`doubles-eot.ts:209\`).

| Trigger | Who picks the replacement | When it happens | What passes to the newcomer | Games | Champions sample |
|---|---|---|---|---|---|
| U-turn, Volt Switch, Flip Turn | the player (switch request mid-turn) | after the action | nothing | all four | ${swShare(sw[0])} |
| Parting Shot | the player | after its drops (none if nothing fell and no Mirror Armor) | nothing | all four | ${swShare(sw[1])} |
| Teleport (gen 8+), Baton Pass, Shed Tail, Chilly Reception | the player | after the action | Baton Pass: stages and passable volatiles; Shed Tail: its Substitute | Baton Pass all four; Teleport SV and SwSh (USUM's fails, modelled); Shed Tail and Chilly Reception SV and Champions | ${swShare(sw[2])} |
| Roar, Whirlwind | random (uniform over the living bench) | end of the action (dragIn) | nothing | all four | ${swShare(sw[3])} |
| Dragon Tail, Circle Throw | random | end of the action | nothing | all four | ${swShare(sw[4])} |
| Eject Button | the holder's player | after the hit (AfterMoveSecondary) | nothing | all four (no Champions usage) | ${swShare(sw[5])} |
| Eject Pack | the holder's player | the action's AfterMove after a drop | nothing | SV, SwSh | ${swShare(sw[6])} |
| Red Card | random (the attacker's side) | end of the action | nothing | all four (no Champions usage) | ${swShare(sw[7])} |
| Emergency Exit, Wimp Out | the holder's player | after the damaging action; after the residual | nothing | Champions, SwSh, USUM (Golisopod, Wimpod) | ${swShare(sw[8])} |

What pinned Showdown does (all of them): the leaver's queued action is cancelled (\`PS/sim/battle-actions.ts:107\`
cancelAction), its ability and item End run, its volatiles clear (Baton Pass and Shed Tail copy first,
\`copyVolatileFrom\`); the newcomer enters at the same position (\`switchIn\`, \`PS/sim/battle-actions.ts:62-160\`), runs
\`runSwitch\` (\`:175-191\`: one \`fieldEvent('SwitchIn')\` with the hazards' onSwitchIn and every switch-in ability and item Start, by handler priority and Speed: Intimidate and its
reactions, weather and terrain setters, Neutralizing Gas, Unnerve, Trace, Imposter, Download, Air Lock, Hospitality,
Costar, Commander, Supersweet Syrup, Zero to Hero's form, Booster Energy, the Seeds, Air Balloon); it has no action this
turn; every later move aimed at that position meets it (\`census-probes.out\` P2, P4, P9); from generation 8 the queue is
re-sorted after the action, so a newcomer's weather or Tailwind changes the order. A chosen replacement is a switch
request mid-turn (\`PS/sim/battle.ts:2876-2914\`); a forced one is \`dragIn\` with \`getRandomSwitchable\` (\`PS/sim/battle.ts:1570-1585\`,
\`:2821-2829\`). The leaver's switch-out effects run (Regenerator's 1/3, Natural Cure, Zero to Hero). No switch happens with no Pokémon to send.

What the engine needs (the replacement enabler):
- **World**: a slot's occupant changes identity: the leaver leaves the factors (its HP kept for the bench outcome), the
  newcomer joins with its own HP factor and state; positions (Ally Switch) and \`occupant()\` stay positional; the
  newcomer has no pending action; budgets grow by the bench size for random drags.
- **Entry pipeline**: hazards (Stealth Rock by type, Spikes layers, Toxic Spikes, Sticky Web with its reactions; Heavy-Duty
  Boots, Levitate, Magic Guard), then the entry abilities and items in Speed order through the existing hooks
  (Intimidate through \`foeDrop\` with Defiant, Competitive, Mirror Armor, Guard Dog, Rattled, Clear Amulet, Eject Pack:
  chains of switches are possible), weather and terrain setters through the field-change re-settle.
- **Switch-out**: Regenerator, Natural Cure, the leaver's Neutralizing Gas or Unnerve ending (exists), Commander.
- **Results**: DoublesTurnResult and the card name both Pokémon of the slot ("{Leaver} switches out; {Newcomer} comes
  in."), the leaver's HP when it left, the newcomer's after the turn; E2 (\`DoublesOutcome\`) reports the slot's new
  occupant and the leaver's bench state, so Training's \`postFromOutcome\` places the leaver on the bench and the newcomer in the slot.

The calculator needs: per side a bench (the team source's other members, or builds entered there; its HP and status),
a replacement choice per switching Pokémon (an input; no default beyond the bench's first, stated as a fact), the
hazards on each side (new field inputs), and for random drags nothing more than the bench (one branch per member).

Training needs: the AI's own bench is exact; the player's is the belief world's bench (no hidden information beyond the
belief). The chosen replacement is a policy: for the AI the same \`ReplacePolicy\` the rollouts use
(\`sim/rollout.ts:15-41\`), for the player the rollouts' healthiest-bench rule (or each option as its own engine world);
random drags branch uniformly over the world's living bench. Hazards come from the battle's public side conditions
(\`bridge.ts\` ignores them today). \`prelude.ts:50\`'s "A replacement is needed before the moves." (an entry Intimidate
setting off Eject Pack) is the same piece.

## 5. Cross-cutting enablers

| Enabler | What it is | Entries it unlocks |
|---|---|---|
${Object.entries(json.enablers).map(([id, v]) => `| ${id} | ${esc(v.text)} | ${v.unlocks.join(", ")} |`).join("\n")}

## 6. Every entry, by family

How-often fields: "Champions sample" is the share of the ${champ.turns} sampled turns whose reason (turn, or end of turn
when the moves were estimated) is this entry's; "Champions usage" is the share of team slots that carry the trigger
(training-usage.json) and of fields where one of the four does; "SV proxy" is the Random Battle sample; oracle cases are
the stored corpus's app results with this reason (the corpus was written to exercise the guards: it is coverage, not
frequency).

${Object.entries(byFamily).map(([f, list]) => `### ${FAMILY_TITLES[f]}\n\n${list.map(entryBlock).join("\n")}`).join("\n")}

## 7. Method and caveats

- The Champions sampler draws four species by their share of the usage sets (no species twice on a side), each with
  an ability, item and spread by weight, and one move by its set share (Protect included), at a random legal target:
  a third of single-target moves go to the user's ally, which inflates the ally-targeting reasons (allyEffect) and
  takes a third of single-target hits off the foes. Weather and terrain come from the slowest setter drawn; Intimidate is not
  pre-applied; no state from earlier turns is set; lastMove is never given (as in the calculator), so Encore and Disable
  show the calculator's gap; moves lists are not given (Imprison's count is the sampler's, the app always gives them).
- The Scarlet/Violet sample uses the catalog's Random Battle Doubles sets: damaging moves only, default abilities, no
  items. It says which damaging-move guards SV meets; it under-counts status moves, items and the field-change guard
  (Protosynthesis and Quark Drive with weather or terrain moves, common in SV play).
- Sword/Shield and USUM ship no usage data; their columns are catalog presence (carrier counts in census-guards.json).
- Training's per-reason rollout counts are not recorded by the eval; only the method shares are.
- Each reason is the first guard a turn meets: a turn can carry more than one.
`;
fs.writeFileSync(path.join(DIR, "census-guards.md"), md);
console.log(`entries ${entries.length}; champions not estimated ${champ.notEstimated}/${champ.turns}, end ${champ.endNotEstimated}; wrote census-guards.json and census-guards.md`);
