// Track F: golden-1v1.ts's corpus, copied verbatim (its file runs on import), so the Fling sweep can rebuild each case.
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, getBuildStats, NATURES, validateBuild } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, BattleGame, MoveContext } from "@/app/lib/battle/types";

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

export type Case = { id: string; game: BattleGame; attacker: BattleBuild; defender: BattleBuild; field: BattleConditions; contexts: Record<string, MoveContext> };

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

export async function corpus(): Promise<Case[]> {
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

