// CENSUS 1 generator (status2 design): merges census-moves-data.ts (the hand-written census of the 73 kind-L status moves)
// with the generated facts and writes census-moves.json and the per-move part of census-moves.md:
//  - games and dex fields: app/lib/battle/status-table.ts (STATUS_MOVE_TABLE);
//  - learners per game and the mods' handler prints: census-moves-dex.out (census-moves-dex.ts);
//  - the pinned source: each move's block in PS/data/moves.ts and the mods, with its handlers' line ranges.
// Run from the repo root (after census-moves-dex.ts):
//   npx --no-install tsx scripts/.cache/calc-audit/status2/design/census-moves-build.ts [--check]
// --check prints each record's own-move citations beside the handler ranges and writes nothing.
import { readFileSync, writeFileSync } from "node:fs";
import { STATUS_MOVE_TABLE } from "../../../../../app/lib/battle/status-table";
import { RECORDS, type CensusRecord, type Family, type Risk } from "./census-moves-data";

const DIR = "scripts/.cache/calc-audit/status2/design";
const PS = "node_modules/.cache/champions/pokemon-showdown-c23d2e942c9c0daadb13a7162a385bf78e3c9353";
const FILES = { base: "data/moves.ts", champions: "data/mods/champions/moves.ts", gen8: "data/mods/gen8/moves.ts", gen7: "data/mods/gen7/moves.ts" } as const;
const GAME_KEYS = { scarlet_violet: "sv", champions: "champions", sword_shield: "swsh", ultra_sun_ultra_moon: "usum" } as const;
type GameKey = (typeof GAME_KEYS)[keyof typeof GAME_KEYS];
const GAME_NAMES: Record<GameKey, string> = { sv: "Scarlet/Violet", champions: "Champions", swsh: "Sword/Shield", usum: "Ultra Sun/Ultra Moon" };

type Block = { from: number; to: number; handlers: { name: string; from: number; to: number }[] };
function blocks(file: string): Map<string, Block> {
  const text = readFileSync(`${PS}/${file}`, "utf8").split(/\r?\n/);
  const out = new Map<string, Block>();
  for (let i = 0; i < text.length; i++) {
    const m = /^\t([a-z0-9]+): \{\s*$/.exec(text[i]);
    if (!m) continue;
    let j = i + 1;
    const handlers: Block["handlers"] = [];
    while (j < text.length && text[j] !== "\t}," && text[j] !== "\t}") {
      const h = /^\t\t(on[A-Za-z]+|condition|self|durationCallback|boosts)\b/.exec(text[j]);
      if (h) {
        let k = j;
        // A one-line member ends on its own line; a block ends at the next "\t\t}," / "\t\t}".
        if (!/[{(]\s*$/.test(text[j]) || /\}\s*,?\s*$/.test(text[j])) k = j;
        else while (k < text.length && !/^\t\t\}/.test(text[k])) k++;
        handlers.push({ name: h[1], from: j + 1, to: k + 1 });
        j = k;
      }
      j++;
    }
    out.set(m[1], { from: i + 1, to: j + 1, handlers });
    i = j;
  }
  return out;
}
const parsed = Object.fromEntries(Object.entries(FILES).map(([key, file]) => [key, blocks(file)])) as Record<keyof typeof FILES, Map<string, Block>>;
const source = (id: string) => (Object.keys(FILES) as (keyof typeof FILES)[]).flatMap((key) => {
  const block = parsed[key].get(id);
  if (!block) return [];
  const handlers = block.handlers.filter((h) => h.name !== "boosts").map((h) => `${h.name} ${h.from}${h.to > h.from ? `-${h.to}` : ""}`).join(", ");
  return [`PS/${FILES[key]}:${block.from}-${block.to}${handlers ? ` (${handlers})` : ""}`];
});

const dex = JSON.parse(readFileSync(`${DIR}/census-moves-dex.out`, "utf8")) as {
  learners: Record<GameKey, Record<string, number>>;
  handlers: Record<string, Partial<Record<GameKey, { sig: string; prints: string; pp: number }>>>;
};

const L = Object.entries(STATUS_MOVE_TABLE).filter(([, e]) => e.kind === "L").map(([id]) => id);
const byId = new Map(RECORDS.map((r) => [r.id, r]));
const missing = L.filter((id) => !byId.has(id)), extra = RECORDS.filter((r) => !L.includes(r.id)).map((r) => r.id);
if (missing.length || extra.length || RECORDS.length !== L.length) throw new Error(`census records: missing ${missing.join(",") || "-"}, extra ${extra.join(",") || "-"}, ${RECORDS.length} for ${L.length}`);

if (process.argv.includes("--check")) {
  for (const record of RECORDS) {
    const text = Object.values(record).filter((v) => typeof v === "string").join(" ");
    const own = [...text.matchAll(/PS\/data\/moves\.ts:(\d+)(?:-(\d+))?/g)].map((m) => m[0]).filter((cite) => {
      const n = Number(cite.split(":")[1].split("-")[0]); const b = parsed.base.get(record.id)!; return n >= b.from && n <= b.to;
    });
    console.log(`${record.id}: ${own.join(" ") || "-"}  ||  ${source(record.id)[0]}`);
  }
  process.exit(0);
}

/**
 * A record's own-move citations in its behaviour text, set to the exact lines of the handlers they point into: the union of
 * the handlers of the move's block that overlap the cited range (±3 lines), else the whole block.
 */
function exactCites(record: CensusRecord): string {
  const block = parsed.base.get(record.id)!;
  return record.behaviour.replace(/PS\/data\/moves\.ts:(\d+)(?:-(\d+))?/g, (cite, a, b) => {
    const from = Number(a), to = Number(b ?? a);
    if (from < block.from || from > block.to) return cite;
    const hit = block.handlers.filter((h) => h.from <= to + 3 && h.to >= from - 3);
    const lo = hit.length ? Math.min(...hit.map((h) => h.from)) : block.from, hi = hit.length ? Math.max(...hit.map((h) => h.to)) : block.to;
    return `PS/data/moves.ts:${lo}-${hi}`;
  });
}

// ---- The JSON -----------------------------------------------------------------------------------------------------------
const TODAY_PRESENCE = new Set(["purify", "stuffcheeks", "swallow", "teatime"]);
/** Moves that add a random branch of their own (beyond the existing ones they ride: ties, wake/thaw, full paralysis, Berries). */
const NEW_BRANCHES = new Set(["acupressure", "conversion2", "attract", "skillswap", "transform"]);
/** Moves whose random events are existing branches (Speed ties, a Berry's own, a moved or cured status's). */
const EXISTING_BRANCHES = new Set(["speedswap", "worryseed", "recycle", "stuffcheeks", "teatime", "aromatherapy", "healbell", "psychoshift", "nightmare", "snatch", "octolock"]);
/** Moves the calculator cannot model even for their own use this turn without an input (the rest need one only for state from earlier turns). */
const OWN_USE_INPUT: Record<string, string> = {
  attract: "genders", captivate: "genders", conversion: "the first move slot", conversion2: "the target's last move (unless it moved earlier this turn)",
  swallow: "Stockpile layers and counters", recycle: "the item used before the turn (unless one was used this turn)", matblock: "its first turn out",
  geomancy: "a charge on the last turn (else the charge turn)", noretreat: "an earlier No Retreat (default none, a fact)", stockpile: "earlier layers (default 0, a fact)",
  powertrick: "an earlier Power Trick (default none, a fact)",
};
const GAS = new Set(["gastroacid", "worryseed", "simplebeam", "entrainment", "skillswap", "roleplay", "doodle", "transform", "bestow", "corrosivegas", "embargo", "magicroom"]);
function today(id: string): string {
  const parts = ["a later living action: whole turn not estimated (REASONS.notModelledBefore, doubles-status.ts statusMove); as the last action only the end of turn (w.endGuard = REASONS.notModelled)"];
  if (TODAY_PRESENCE.has(id)) parts.unshift("presence guard wherever it comes (HP_STATUS_MOVES, doubles-status.ts presenceGuards: REASONS.notModelled)");
  if (id === "bestow") parts.push("also the whole turn when its item would be used at the receiver's Update (bestowActs)");
  if (id === "recycle") parts.push("also the whole turn when the user holds no item (the item it used before is not known)");
  if (GAS.has(id)) parts.push("with Neutralizing Gas from the turn's start: REASONS.withGas whatever follows (GAS_CHANGING_MOVES)");
  return parts.join("; ");
}
const entries = RECORDS.map((record) => {
  const entry = STATUS_MOVE_TABLE[record.id];
  const games = Object.keys(entry.games).map((g) => GAME_KEYS[g as keyof typeof GAME_KEYS]);
  const learners = Object.fromEntries(games.map((g) => [g, dex.learners[g]?.[record.id] ?? 0]));
  const prints = dex.handlers[record.id] ?? {};
  const distinct = new Set(Object.values(prints).map((p) => `${p!.sig}|${p!.prints}`));
  return {
    id: record.id,
    name: STATUS_MOVE_TABLE[record.id] ? nameOf(record.id) : record.id,
    family: record.family,
    games,
    learners,
    dex: { target: entry.target, priority: entry.priority, type: entry.type, flags: Object.keys(entry.flags), ...(entry.boosts ? { boosts: entry.boosts } : {}), ...(entry.volatile ? { volatile: entry.volatile } : {}), ...(entry.side ? { side: entry.side } : {}) },
    showdown: { source: source(record.id), handlersDifferAcrossGames: distinct.size > 1, perGame: record.perGame },
    today: today(record.id),
    behaviour: exactCites(record),
    changes: record.changes,
    readsLaterThisTurn: record.sameTurn,
    readsAtEndOfTurn: record.endOfTurn,
    leavesForNextTurn: record.carried,
    engineReuse: record.reuse,
    engineNeeds: record.needs,
    inputs: record.inputs,
    randomness: record.random,
    branches: NEW_BRANCHES.has(record.id) ? "new" : EXISTING_BRANCHES.has(record.id) ? "existing" : "none",
    inputForItsOwnUse: OWN_USE_INPUT[record.id] ?? "",
    risk: record.risk,
    riskWhy: record.riskWhy,
    probes: record.probes,
  };
});
function nameOf(id: string): string {
  const text = readFileSync(`${PS}/data/moves.ts`, "utf8").split(/\r?\n/);
  const b = parsed.base.get(id)!;
  for (let i = b.from; i < b.to; i++) { const m = /^\t\tname: "(.+)",/.exec(text[i]); if (m) return m[1]; }
  return id;
}

const count = <K extends string>(key: (e: (typeof entries)[number]) => K | K[]) => {
  const out: Record<string, number> = {};
  for (const e of entries) for (const k of ([] as K[]).concat(key(e))) out[k] = (out[k] ?? 0) + 1;
  return out;
};
const summary = {
  moves: entries.length,
  byGame: count((e) => e.games as string[]),
  byFamily: count((e) => e.family),
  byRisk: count((e) => e.risk),
  newBranches: entries.filter((e) => e.branches === "new").map((e) => e.id),
  existingBranches: entries.filter((e) => e.branches === "existing").map((e) => e.id),
  inputForItsOwnUse: entries.filter((e) => e.inputForItsOwnUse).map((e) => `${e.id}: ${e.inputForItsOwnUse}`),
  presenceToday: entries.filter((e) => TODAY_PRESENCE.has(e.id)).map((e) => e.id),
  inputsForEarlierTurns: entries.filter((e) => e.inputs).map((e) => e.id),
  championsMoves: entries.filter((e) => e.games.includes("champions")).map((e) => e.id),
  championsLearnable: entries.filter((e) => (e.learners as Record<string, number>).champions > 0).map((e) => e.id),
};
writeFileSync(`${DIR}/census-moves.json`, JSON.stringify({
  generated: "scripts/.cache/calc-audit/status2/design/census-moves-build.ts from census-moves-data.ts, app/lib/battle/status-table.ts, census-moves-dex.out and pinned Showdown c23d2e94",
  showdown: PS, probes: `${DIR}/census-moves-probes.out`, summary, moves: entries,
}, null, 1) + "\n");

// ---- The per-move part of the Markdown ----------------------------------------------------------------------------------
const FAMILY_TITLE: Record<Family, string> = {
  stages: "Stat stages", "stored-stats": "Stored stats", types: "Types", abilities: "Abilities", items: "Items", cures: "Status cures, transfers and heals",
  "next-move": "Volatiles that act on later moves or the end of turn", "move-type": "Move type changes", side: "Side conditions", field: "Field conditions", copy: "Copying moves (Transform, Snatch)",
};
const RISK_ORDER: Risk[] = ["high", "medium", "low"];
const md: string[] = [];
md.push("## Per-move census", "");
md.push("Generated by `census-moves-build.ts` (games from `status-table.ts`, learners from `census-moves-dex.out`, source ranges from the pinned dex; the rest from `census-moves-data.ts`). Probe ids are `census-moves-probes.out` unless prefixed.", "");
md.push("| Move | Family | Games (learners) | Risk | Branches | Input for its own use |", "|---|---|---|---|---|---|");
for (const e of [...entries].sort((a, b) => RISK_ORDER.indexOf(a.risk) - RISK_ORDER.indexOf(b.risk) || a.family.localeCompare(b.family) || a.id.localeCompare(b.id))) {
  const games = e.games.map((g) => `${g}:${(e.learners as Record<string, number>)[g]}`).join(" ");
  md.push(`| ${e.name} | ${e.family} | ${games} | ${e.risk} | ${e.branches === "none" ? "—" : e.branches} | ${e.inputForItsOwnUse || "—"} |`);
}
md.push("");
for (const family of Object.keys(FAMILY_TITLE) as Family[]) {
  const list = entries.filter((e) => e.family === family);
  if (!list.length) continue;
  md.push(`### ${FAMILY_TITLE[family]} (${list.length})`, "");
  for (const e of list) {
    const games = e.games.map((g) => `${GAME_NAMES[g]} ${(e.learners as Record<string, number>)[g]}`).join(", ");
    md.push(`#### ${e.name} (\`${e.id}\`): ${e.risk} risk`, "");
    md.push(`- **Games (learners):** ${games}. **Dex:** target ${e.dex.target}, priority ${e.dex.priority}, ${e.dex.type}, flags ${e.dex.flags.join(", ") || "none"}.`);
    md.push(`- **Source:** ${e.showdown.source.join("; ")}.`);
    md.push(`- **Showdown:** ${e.behaviour}`);
    md.push(`- **Per game:** ${e.showdown.perGame}`);
    md.push(`- **Changes:** ${e.changes.join("; ")}.`);
    md.push(`- **Read later this turn:** ${e.readsLaterThisTurn}`);
    md.push(`- **Read at the end of turn:** ${e.readsAtEndOfTurn}`);
    md.push(`- **Left for the next turn:** ${e.leavesForNextTurn}`);
    md.push(`- **Today:** ${e.today}.`);
    md.push(`- **Engine reuse:** ${e.engineReuse}`);
    md.push(`- **Engine needs:** ${e.engineNeeds}`);
    if (e.inputs) md.push(`- **Inputs:** ${e.inputs}`);
    md.push(`- **Randomness:** ${e.randomness}`);
    md.push(`- **Risk:** ${e.risk}: ${e.riskWhy}${e.probes.length ? ` Probes: ${e.probes.join(", ")}.` : ""}`);
    md.push("");
  }
}
const head = readFileSync(`${DIR}/census-moves-head.md`, "utf8").trimEnd();
writeFileSync(`${DIR}/census-moves.md`, `${head}\n\n${md.join("\n")}`);
console.log(JSON.stringify(summary, null, 1));
