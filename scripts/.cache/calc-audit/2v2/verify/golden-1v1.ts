// Golden 1v1 corpus (SPEC §7 Phase 0 step 2): calculateMatchup output over a fixed corpus of pairs in the four games,
// Singles and Doubles, every move of the attacker's learnset, as deterministic JSON. Run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/golden-1v1.ts          (writes golden-1v1.json + golden-1v1.full.json.gz)
//   npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/golden-1v1.ts --check  (compares the working tree against them)
// --check prints "golden-1v1: N cases byte-equal" or each differing case with its first differing rows, and exits 1 on a difference.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, getBuildStats, NATURES, validateBuild } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, BattleGame, MoveContext } from "@/app/lib/battle/types";

const here = dirname(fileURLToPath(import.meta.url));
const SUMMARY = join(here, "golden-1v1.json");
const FULL = join(here, "golden-1v1.full.json.gz");
const check = process.argv.includes("--check");

/** mulberry32: a fixed, seeded sequence, so the corpus is the same on every run. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ITEMS = [
  "", "", "", "sitrusberry", "starfberry", "salacberry", "liechiberry", "petayaberry", "ganlonberry", "apicotberry", "figyberry", "custapberry", "lansatberry",
  "mirrorherb", "focussash", "lifeorb", "choiceband", "choicespecs", "choicescarf", "assaultvest", "rockyhelmet", "leftovers", "weaknesspolicy", "airballoon",
  "boosterenergy", "expertbelt", "shellbell", "lumberry", "whiteherb", "metronome", "loadeddice", "throatspray", "occaberry", "yacheberry", "chopleberry",
  "electricseed", "grassyseed", "psychicseed", "mistyseed", "blacksludge", "flameorb", "toxicorb", "ironball", "laggingtail", "quickclaw", "protectivepads",
  "punchingglove", "clearamulet", "covertcloak", "abilityshield", "utilityumbrella", "roomservice", "keeberry", "marangaberry", "jabocaberry", "rowapberry",
  "enigmaberry", "oranberry", "berryjuice", "normalgem", "focusband", "kingsrock", "widelens", "scopelens", "brightpowder", "eviolite", "souldew",
];
const STATUSES = ["", "", "", "", "", "brn", "par", "psn", "tox", "slp", "frz"] as const;
/** Targeted abilities and items for the paths calculateMatchup's row loop takes (Starf outcomes, copies, settled HP, Trace, Imposter, Download). */
const TARGETED: { attacker: [string, string, string, number?]; defender: [string, string, string, number?] }[] = [
  { attacker: ["espathra", "opportunist", ""], defender: ["garchomp", "", "starfberry", 0.25] },
  { attacker: ["garchomp", "", "starfberry", 0.25], defender: ["espathra", "opportunist", ""] },
  { attacker: ["garchomp", "", "mirrorherb"], defender: ["dragonite", "", "salacberry", 0.2] },
  { attacker: ["dragonite", "multiscale", "liechiberry", 0.2], defender: ["incineroar", "", "mirrorherb"] },
  { attacker: ["garchomp", "", "starfberry", 0.2], defender: ["dragonite", "", "starfberry", 0.2] },
  { attacker: ["incineroar", "intimidate", ""], defender: ["garchomp", "", "sitrusberry", 0.4] },
  { attacker: ["ditto", "imposter", "choicescarf"], defender: ["garchomp", "", ""] },
  { attacker: ["garchomp", "", ""], defender: ["ditto", "imposter", ""] },
  { attacker: ["porygon2", "trace", "eviolite"], defender: ["gyarados", "intimidate", ""] },
  { attacker: ["porygonz", "download", ""], defender: ["dragonite", "", ""] },
  { attacker: ["farigiraf", "cudchew", "sitrusberry", 0.4], defender: ["garchomp", "", ""] },
  { attacker: ["garchomp", "roughskin", ""], defender: ["farigiraf", "cudchew", "sitrusberry", 0.4] },
  { attacker: ["exeggutor", "harvest", "sitrusberry", 0.4], defender: ["garchomp", "", ""] },
  { attacker: ["kingambit", "supremeoverlord", "custapberry", 0.2], defender: ["dragonite", "multiscale", ""] },
  { attacker: ["talonflame", "galewings", "lansatberry", 0.2], defender: ["garchomp", "", "figyberry", 0.2] },
  { attacker: ["whimsicott", "prankster", ""], defender: ["clefable", "magicguard", "figyberry", 0.2] },
];

type Case = { id: string; game: BattleGame; attacker: BattleBuild; defender: BattleBuild; field: BattleConditions; contexts: Record<string, MoveContext> };

function supported(runtime: BattleRuntime) {
  return runtime.catalog.species.filter((species) => !species.unsupported.length && !validateBuild(createBuild(species.id, runtime), runtime).length);
}

function trained(runtime: BattleRuntime, build: BattleBuild, random: () => number): BattleBuild {
  const pick = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)];
  const nature = pick(NATURES).name;
  if (build.game === "champions") {
    const stats = ["hp", "atk", "def", "spa", "spd", "spe"] as const;
    const points = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
    let left = 66;
    for (const stat of [...stats].sort(() => random() - 0.5)) { const value = Math.min(32, left, Math.floor(random() * 33)); points[stat] = value; left -= value; }
    return { ...build, nature, points };
  }
  const evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  const stats = ["hp", "atk", "def", "spa", "spd", "spe"] as const;
  let left = 508;
  for (const stat of [...stats].sort(() => random() - 0.5)) { const value = Math.min(252, left, Math.floor(random() * 64) * 4); evs[stat] = value; left -= value; }
  return { ...build, nature, native: { ...build.native!, level: random() < 0.8 ? 50 : 100, evs } };
}

function randomBuild(runtime: BattleRuntime, speciesId: string, random: () => number): BattleBuild {
  const pick = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)];
  const species = runtime.speciesById.get(speciesId)!;
  let build = trained(runtime, createBuild(speciesId, runtime), random);
  const abilities = species.abilities.filter((id) => !runtime.abilitiesById.get(id)?.unsupported.length);
  const abilityId = abilities.length ? pick(abilities) : build.abilityId;
  build = { ...build, abilityId, abilityActive: random() < 0.3 ? !build.abilityActive : build.abilityActive };
  if (!species.requiredItem && !species.requiredItems?.length) {
    const item = pick(ITEMS);
    if (!item || (runtime.itemsById.has(item) && !runtime.itemsById.get(item)!.unsupported.length)) build = { ...build, itemId: item };
  }
  if (random() < 0.3) build = { ...build, boosts: { atk: Math.floor(random() * 5) - 2, def: Math.floor(random() * 5) - 2, spa: Math.floor(random() * 5) - 2, spd: Math.floor(random() * 5) - 2, spe: Math.floor(random() * 5) - 2 } };
  if (random() < 0.4) {
    const max = getBuildStats(build, runtime)?.hp ?? 1;
    build = { ...build, currentHP: Math.max(1, Math.floor(max * pick([0.15, 0.24, 0.3, 0.45, 0.5, 0.7, 0.99]))) };
  }
  build = { ...build, status: pick(STATUSES) };
  if (runtime.profile.tera && random() < 0.2) build = { ...build, mechanic: "tera", configuration: { ...build.configuration, teraType: pick(["Fire", "Water", "Grass", "Stellar", "Fairy", "Steel"]) } };
  if (runtime.profile.dynamax && random() < 0.15 && !species.cannotDynamax) build = { ...build, mechanic: "dynamax" };
  // A build the catalog rejects falls back to its plain form, so every case is calculated.
  if (validateBuild(build, runtime).length) build = { ...build, itemId: species.requiredItem ?? species.requiredItems?.[0] ?? "", mechanic: undefined, abilityActive: createBuild(speciesId, runtime).abilityActive };
  if (validateBuild(build, runtime).length) build = trained(runtime, createBuild(speciesId, runtime), random);
  return build;
}

function randomField(runtime: BattleRuntime, random: () => number, gameType: BattleConditions["gameType"]): BattleConditions {
  const pick = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)];
  const field = createConditions();
  const side = () => ({ ...field.attackerSide, reflect: random() < 0.1, lightScreen: random() < 0.1, auroraVeil: random() < 0.05, helpingHand: random() < 0.1,
    friendGuard: random() < 0.1, priorityShield: random() < 0.05, protect: random() < 0.05, tailwind: random() < 0.1, charge: random() < 0.05 });
  return {
    ...field, gameType, weather: random() < 0.6 ? "" : pick(runtime.profile.weather), terrain: random() < 0.6 ? "" : pick(["Electric", "Grassy", "Misty", "Psychic"] as const),
    critical: random() < 0.08, multipleTargets: random() < 0.7, gravity: random() < 0.05, trickRoom: random() < 0.1, wonderRoom: random() < 0.04,
    magicRoom: random() < 0.04, fairyAura: random() < 0.04, attackerSide: side(), defenderSide: side(),
  };
}

async function corpus(): Promise<Case[]> {
  const cases: Case[] = [];
  const games: BattleGame[] = ["champions", "ultra_sun_ultra_moon", "sword_shield", "scarlet_violet"];
  for (const [gameIndex, game] of games.entries()) {
    const runtime = await loadBattleRuntime(game);
    const random = prng(1000 + gameIndex);
    const pool = supported(runtime);
    const pick = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)];
    for (let index = 0; index < 22; index++) {
      const attacker = randomBuild(runtime, pick(pool).id, random), defender = randomBuild(runtime, pick(pool).id, random);
      for (const gameType of ["Singles", "Doubles"] as const) {
        cases.push({ id: `${game}:random:${index}:${gameType}`, game, attacker, defender, field: randomField(runtime, random, gameType), contexts: {} });
      }
    }
    for (const [index, entry] of TARGETED.entries()) {
      const make = ([speciesId, abilityId, itemId, part]: [string, string, string, number?]): BattleBuild | null => {
        const species = runtime.speciesById.get(speciesId);
        if (!species) return null;
        let build = createBuild(speciesId, runtime);
        if (abilityId) {
          if (!species.abilities.includes(abilityId)) return null;
          build = { ...build, abilityId };
        }
        if (itemId) {
          if (!runtime.itemsById.has(itemId)) return null;
          build = { ...build, itemId };
        }
        if (part) build = { ...build, currentHP: Math.max(1, Math.floor((getBuildStats(build, runtime)?.hp ?? 1) * part)) };
        return validateBuild(build, runtime).length ? null : build;
      };
      const attacker = make(entry.attacker), defender = make(entry.defender);
      if (!attacker || !defender) continue;
      for (const gameType of ["Singles", "Doubles"] as const) {
        cases.push({ id: `${game}:targeted:${index}:${gameType}`, game, attacker, defender, field: { ...createConditions(), gameType }, contexts: {} });
      }
    }
  }
  return cases;
}

(async () => {
  const cases = await corpus();
  const runtimes = new Map<BattleGame, BattleRuntime>();
  const full: Record<string, string> = {};
  const summary: { id: string; rows: number; hash: string }[] = [];
  const started = Date.now();
  for (const entry of cases) {
    const runtime = runtimes.get(entry.game) ?? await loadBattleRuntime(entry.game);
    runtimes.set(entry.game, runtime);
    const result = calculateMatchup(entry.attacker, entry.defender, entry.field, entry.contexts, runtime);
    const json = JSON.stringify(result);
    full[entry.id] = json;
    summary.push({ id: entry.id, rows: result.results.length, hash: createHash("sha256").update(json).digest("hex") });
  }
  const elapsed = Date.now() - started;
  if (!check) {
    mkdirSync(here, { recursive: true });
    writeFileSync(SUMMARY, JSON.stringify({ version: 1, cases: summary }, null, 1) + "\n");
    writeFileSync(FULL, gzipSync(JSON.stringify(full)));
    console.log(`golden-1v1: wrote ${summary.length} cases (${summary.reduce((sum, row) => sum + row.rows, 0)} rows) in ${elapsed} ms`);
    return;
  }
  if (!existsSync(SUMMARY) || !existsSync(FULL)) { console.log("golden-1v1: no golden files; run without --check first"); process.exit(1); }
  const golden = JSON.parse(readFileSync(SUMMARY, "utf8")) as { cases: { id: string; rows: number; hash: string }[] };
  const goldenFull = JSON.parse(gunzipSync(readFileSync(FULL)).toString("utf8")) as Record<string, string>;
  const byId = new Map(summary.map((row) => [row.id, row]));
  const differing: string[] = [];
  for (const row of golden.cases) {
    const now = byId.get(row.id);
    if (!now) { differing.push(`${row.id}: missing from the current corpus`); continue; }
    if (now.hash === row.hash) continue;
    const before = JSON.parse(goldenFull[row.id]) as { results: { moveId: string }[] }, after = JSON.parse(full[row.id]) as { results: { moveId: string }[] };
    const lines = [`${row.id}: differs`];
    const beforeRest = { ...before, results: undefined }, afterRest = { ...after, results: undefined };
    if (JSON.stringify(beforeRest) !== JSON.stringify(afterRest)) lines.push(`  matchup: ${JSON.stringify(beforeRest).slice(0, 400)} -> ${JSON.stringify(afterRest).slice(0, 400)}`);
    for (let index = 0, shown = 0; index < Math.max(before.results.length, after.results.length) && shown < 3; index++) {
      const a = JSON.stringify(before.results[index]), b = JSON.stringify(after.results[index]);
      if (a === b) continue;
      shown++;
      lines.push(`  row ${index} (${before.results[index]?.moveId ?? after.results[index]?.moveId}):\n    before ${a?.slice(0, 600)}\n    after  ${b?.slice(0, 600)}`);
    }
    differing.push(lines.join("\n"));
  }
  if (summary.length !== golden.cases.length) differing.push(`case count ${golden.cases.length} -> ${summary.length}`);
  if (differing.length) {
    console.log(`golden-1v1: ${differing.length} of ${golden.cases.length} cases differ\n${differing.join("\n")}`);
    process.exit(1);
  }
  console.log(`golden-1v1: ${golden.cases.length} cases byte-equal (${elapsed} ms)`);
})();
