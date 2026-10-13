// Track F (SPEC2 §4.7): the Fling cases the item sweep does not reach, each against the exact oracle (check.ts): the failure
// rules (Klutz, Klutz under the target's Neutralizing Gas, Magic Room, an own Mega Stone, a used Seed), the power rules (Tera's
// 60-power floor, Technician, Sheer Force), the flung status against its immunities (Shield Dust and Mold Breaker, Covert Cloak,
// Corrosion, Misty Terrain, a type, Magic Guard, Poison Heal, a curing Berry), the flung Berry's heal into a target with its own
// HP Berry, Ripen, Cheek Pouch, an Enigma Berry, Focus Sash, a cure, and Dynamaxed attackers (Max Darkness, then Fling).
//   npx --no-install tsx scripts/.cache/calc-audit/status2/build/fling/extras.ts [filter]
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, defaultAbilityActive, getBuildStats } from "@/app/lib/battle/model";
import type { BattleBuild, BattleConditions, BattleGame, BattleStatus } from "@/app/lib/battle/types";
import { checkRow } from "./check";

type Mon = { id: string; ability: string; item?: string; part?: number; hp?: number; status?: BattleStatus; tera?: string; dynamax?: true; boosts?: Partial<BattleBuild["boosts"]> };
type Case = { id: string; game: BattleGame; a: Mon; d: Mon; field?: Partial<BattleConditions> };
const SV: BattleGame = "scarlet_violet", CH: BattleGame = "champions", SW: BattleGame = "sword_shield", US: BattleGame = "ultra_sun_ultra_moon";
const weavile = (item: string, extra: Partial<Mon> = {}): Mon => ({ id: "weavile", ability: "pressure", item, ...extra });
const CASES: Case[] = [
  // Failures.
  { id: "klutz", game: CH, a: { id: "lopunny", ability: "klutz", item: "ironball" }, d: { id: "snorlax", ability: "thickfat" } },
  { id: "klutz-gassed", game: SW, a: { id: "lopunny", ability: "klutz", item: "ironball" }, d: { id: "weezinggalar", ability: "neutralizinggas" } },
  { id: "magicroom", game: SV, a: weavile("ironball"), d: { id: "snorlax", ability: "thickfat" }, field: { magicRoom: true } },
  { id: "own-megastone", game: CH, a: { id: "lopunny", ability: "cutecharm", item: "lopunnite" }, d: { id: "snorlax", ability: "thickfat" } },
  { id: "other-megastone", game: CH, a: weavile("lopunnite"), d: { id: "snorlax", ability: "thickfat" } },
  { id: "used-seed", game: SV, a: weavile("electricseed"), d: { id: "snorlax", ability: "thickfat" }, field: { terrain: "Electric" } },
  { id: "unused-seed", game: SV, a: weavile("electricseed"), d: { id: "snorlax", ability: "thickfat" }, field: { terrain: "Grassy" } },
  { id: "plate-arceus", game: US, a: { id: "arceusdark", ability: "multitype", item: "dreadplate" }, d: { id: "snorlax", ability: "thickfat" } },
  { id: "plate-other", game: SV, a: weavile("dreadplate"), d: { id: "gengar", ability: "cursedbody" } },
  { id: "flowersweet", game: SV, a: weavile("flowersweet"), d: { id: "snorlax", ability: "thickfat" } },
  { id: "protect", game: SV, a: weavile("ironball"), d: { id: "snorlax", ability: "thickfat" }, field: { defenderSide: { ...createConditions().defenderSide, protect: true } } },
  // Power.
  { id: "tera-dark-floor", game: SV, a: weavile("whiteherb", { tera: "Dark" }), d: { id: "snorlax", ability: "thickfat" } },
  { id: "tera-other", game: SV, a: weavile("whiteherb", { tera: "Fire" }), d: { id: "snorlax", ability: "thickfat" } },
  { id: "technician", game: US, a: { id: "ambipom", ability: "technician", item: "kingsrock" }, d: { id: "snorlax", ability: "thickfat" } },
  { id: "sheerforce-flameorb", game: US, a: { id: "nidoking", ability: "sheerforce", item: "flameorb" }, d: { id: "snorlax", ability: "thickfat", part: 0.05 } },
  { id: "lifeorb", game: SW, a: weavile("lifeorb"), d: { id: "snorlax", ability: "thickfat", part: 0.1 } },
  { id: "blackglasses", game: US, a: weavile("blackglasses"), d: { id: "gengar", ability: "cursedbody" } },
  { id: "lightball-pikachu", game: SV, a: { id: "pikachu", ability: "static", item: "lightball" }, d: { id: "snorlax", ability: "thickfat" } },
  { id: "thickclub", game: US, a: { id: "marowak", ability: "rockhead", item: "thickclub" }, d: { id: "gengar", ability: "cursedbody" } },
  // A flung status and its immunities (a low target in sand: its end of turn reads the status).
  { id: "toxic-low-sand", game: SV, a: weavile("toxicorb"), d: { id: "snorlax", ability: "thickfat", part: 0.12 }, field: { weather: "Sand" } },
  { id: "flame-low", game: US, a: weavile("flameorb"), d: { id: "snorlax", ability: "thickfat", part: 0.08 } },
  { id: "poisonbarb-low", game: CH, a: weavile("poisonbarb"), d: { id: "snorlax", ability: "thickfat", part: 0.15 } },
  { id: "flame-shielddust-moldbreaker", game: SV, a: { id: "hawlucha", ability: "moldbreaker", item: "flameorb" }, d: { id: "vivillon", ability: "shielddust", part: 0.1 } },
  { id: "flame-shielddust", game: SV, a: { id: "hawlucha", ability: "limber", item: "flameorb" }, d: { id: "vivillon", ability: "shielddust", part: 0.1 } },
  { id: "flame-covertcloak", game: SV, a: weavile("flameorb"), d: { id: "snorlax", ability: "thickfat", item: "covertcloak", part: 0.08 } },
  { id: "toxic-corrosion-steel", game: SV, a: { id: "salazzle", ability: "corrosion", item: "toxicorb" }, d: { id: "skarmory", ability: "sturdy", part: 0.1 } },
  { id: "toxic-steel", game: SV, a: weavile("toxicorb"), d: { id: "skarmory", ability: "sturdy", part: 0.1 } },
  { id: "toxic-misty", game: SV, a: weavile("toxicorb"), d: { id: "snorlax", ability: "thickfat", part: 0.1 }, field: { terrain: "Misty" } },
  { id: "flame-fire", game: SV, a: weavile("flameorb"), d: { id: "arcanine", ability: "flashfire", part: 0.1 } },
  { id: "toxic-magicguard", game: US, a: weavile("toxicorb"), d: { id: "clefable", ability: "magicguard", part: 0.1 }, field: { weather: "Sand" } },
  { id: "toxic-poisonheal-sand", game: SV, a: weavile("toxicorb"), d: { id: "gliscor", ability: "poisonheal", part: 0.1 }, field: { weather: "Sand" } },
  { id: "flame-rawst", game: SV, a: weavile("flameorb"), d: { id: "snorlax", ability: "thickfat", item: "rawstberry", part: 0.08 } },
  { id: "flame-rawst-unnerve", game: SV, a: { id: "tyranitar", ability: "unnerve", item: "flameorb" }, d: { id: "snorlax", ability: "thickfat", item: "rawstberry", part: 0.08 } },
  { id: "flame-burned", game: SV, a: weavile("flameorb"), d: { id: "snorlax", ability: "thickfat", part: 0.08, status: "brn" } },
  { id: "flame-marvelscale", game: US, a: weavile("flameorb"), d: { id: "milotic", ability: "marvelscale", part: 0.1 } },
  { id: "kingsrock-innerfocus", game: SV, a: weavile("kingsrock"), d: { id: "dragonite", ability: "innerfocus" } },
  { id: "whiteherb-lowered", game: SV, a: weavile("whiteherb"), d: { id: "snorlax", ability: "thickfat", boosts: { def: -2 } } },
  // The same at an HP the hit leaves some sequences within the end of turn's reach of (a KO chance strictly between 0 and 1).
  { id: "partial-toxic-sand", game: SV, a: weavile("toxicorb"), d: { id: "snorlax", ability: "thickfat", hp: 61 }, field: { weather: "Sand" } },
  { id: "partial-flame", game: US, a: weavile("flameorb"), d: { id: "snorlax", ability: "thickfat", hp: 46 } },
  { id: "partial-poisonbarb", game: CH, a: weavile("poisonbarb"), d: { id: "snorlax", ability: "thickfat", hp: 103 } },
  { id: "partial-flame-shielddust-moldbreaker", game: SV, a: { id: "hawlucha", ability: "moldbreaker", item: "flameorb" }, d: { id: "vivillon", ability: "shielddust", hp: 29 } },
  { id: "partial-flame-shielddust", game: SV, a: { id: "hawlucha", ability: "limber", item: "flameorb" }, d: { id: "vivillon", ability: "shielddust", hp: 29 } },
  { id: "partial-flame-covertcloak", game: SV, a: weavile("flameorb"), d: { id: "snorlax", ability: "thickfat", item: "covertcloak", hp: 46 } },
  { id: "partial-toxic-poisonheal-sand", game: US, a: weavile("toxicorb"), d: { id: "breloom", ability: "poisonheal", hp: 40 }, field: { weather: "Sand" } },
  { id: "partial-flame-marvelscale", game: US, a: weavile("flameorb"), d: { id: "milotic", ability: "marvelscale", hp: 36 } },
  { id: "partial-flame-rawst", game: US, a: weavile("flameorb"), d: { id: "snorlax", ability: "thickfat", item: "rawstberry", hp: 46 } },
  { id: "partial-flame-rawst-unnerve", game: US, a: { id: "tyranitar", ability: "unnerve", item: "flameorb" }, d: { id: "snorlax", ability: "thickfat", item: "rawstberry", hp: 52 } },
  { id: "partial-sitrus-sand", game: SV, a: weavile("sitrusberry"), d: { id: "snorlax", ability: "thickfat", hp: 20 }, field: { weather: "Sand" } },
  // The attacker's own item effects after the hit (none: the item is gone by then), with a target its end of turn can finish.
  { id: "attacker-lifeorb-low-sand", game: SV, a: weavile("lifeorb", { hp: 10 }), d: { id: "snorlax", ability: "thickfat", hp: 55 }, field: { weather: "Sand" } },
  { id: "attacker-stickybarb-low-sand", game: SV, a: weavile("stickybarb", { hp: 10 }), d: { id: "snorlax", ability: "thickfat", hp: 100 }, field: { weather: "Sand" } },
  { id: "attacker-shellbell-sand", game: SV, a: weavile("shellbell", { hp: 30 }), d: { id: "snorlax", ability: "thickfat", hp: 40 }, field: { weather: "Sand" } },
  // A flung Berry: the target eats it.
  { id: "sitrus-own-sitrus", game: SV, a: weavile("sitrusberry"), d: { id: "snorlax", ability: "thickfat", item: "sitrusberry", part: 0.6 } },
  { id: "sitrus-low-sand", game: SV, a: weavile("sitrusberry"), d: { id: "snorlax", ability: "thickfat", part: 0.08 }, field: { weather: "Sand" } },
  { id: "sitrus-ripen", game: SV, a: weavile("sitrusberry"), d: { id: "applin", ability: "ripen", part: 0.5 } },
  { id: "figy-gen7", game: US, a: weavile("figyberry"), d: { id: "snorlax", ability: "thickfat", part: 0.3 } },
  { id: "oran-cheekpouch", game: SW, a: weavile("oranberry"), d: { id: "greedent", ability: "cheekpouch", part: 0.3 } },
  { id: "lum-cheekpouch", game: SV, a: weavile("lumberry"), d: { id: "dedenne", ability: "cheekpouch", part: 0.3 } },
  { id: "sitrus-enigma", game: SV, a: weavile("sitrusberry"), d: { id: "gengar", ability: "cursedbody", item: "enigmaberry", part: 0.6 } },
  { id: "sitrus-sash", game: SV, a: { id: "kingambit", ability: "supremeoverlord", item: "sitrusberry", boosts: { atk: 6 } }, d: { id: "gengar", ability: "cursedbody", item: "focussash" } },
  { id: "rawst-cures-burn-sand", game: SV, a: weavile("rawstberry"), d: { id: "snorlax", ability: "thickfat", part: 0.08, status: "brn" }, field: { weather: "Sand" } },
  { id: "pecha-poisonheal", game: SV, a: weavile("pechaberry"), d: { id: "gliscor", ability: "poisonheal", part: 0.1, status: "tox" }, field: { weather: "Sand" } },
  { id: "sitrus-klutz-target", game: SW, a: weavile("sitrusberry"), d: { id: "lopunny", ability: "klutz", part: 0.4 } },
  { id: "liechi", game: SV, a: weavile("liechiberry"), d: { id: "snorlax", ability: "thickfat", part: 0.2 } },
  // Dynamax: Max Darkness while it lasts, then Fling.
  { id: "max-ironball", game: SW, a: weavile("ironball", { dynamax: true }), d: { id: "snorlax", ability: "thickfat" } },
  { id: "max-flameorb", game: SW, a: weavile("flameorb", { dynamax: true }), d: { id: "snorlax", ability: "thickfat" } },
  { id: "max-sitrus", game: SW, a: weavile("sitrusberry", { dynamax: true }), d: { id: "snorlax", ability: "thickfat", part: 0.9 } },
  { id: "max-kingsrock", game: SW, a: weavile("kingsrock", { dynamax: true }), d: { id: "blissey", ability: "naturalcure" } },
];

(async () => {
  const filter = process.argv[2];
  let ok = 0, bad = 0, skipped = 0;
  for (const c of CASES) {
    if (filter && !c.id.includes(filter)) continue;
    const R = await loadBattleRuntime(c.game);
    const make = (m: Mon): BattleBuild => {
      const base = createBuild(m.id, R);
      let b = { ...base, nature: "Serious", abilityId: m.ability, abilityActive: defaultAbilityActive(m.ability), itemId: m.item ?? "", currentHP: null, status: m.status ?? "",
        boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...m.boosts } } as BattleBuild;
      if (m.tera) b = { ...b, mechanic: "tera", configuration: { ...b.configuration, teraType: m.tera } } as BattleBuild;
      if (m.dynamax) b = { ...b, mechanic: "dynamax" } as BattleBuild;
      if (m.part) b = { ...b, currentHP: Math.max(1, Math.floor((getBuildStats(b, R)?.hp ?? 1) * m.part)) };
      if (m.hp) b = { ...b, currentHP: m.hp };
      return b;
    };
    const attacker = make(c.a), defender = make(c.d);
    const field = { ...createConditions(), gameType: "Singles", ...c.field } as BattleConditions;
    const out = calculateMatchup(attacker, defender, field, {}, R);
    const id = `${c.game}|${c.id}`;
    if (Object.values(out.issues).some((list) => list.length)) { skipped++; console.log(`SKIP ${id}: issues ${JSON.stringify(out.issues)}`); continue; }
    const row = out.results.find((r) => r.moveId === "fling");
    if (!row) { skipped++; console.log(`SKIP ${id}: no Fling row`); continue; }
    const check = checkRow(id, c.game as never, attacker, defender, field, R, row);
    if (check.skipped) { skipped++; console.log(`SKIP ${id}: ${check.skipped}`); continue; }
    if (check.ok) ok++; else bad++;
    console.log(`${check.ok ? "OK  " : "DIFF"} ${id}\n     app    ${check.app}\n     oracle ${check.oracle}${check.diffs.map((d) => `\n     ! ${d}`).join("")}`);
  }
  console.log(`extras: ${ok} agree, ${bad} differ, ${skipped} skipped`);
})();
