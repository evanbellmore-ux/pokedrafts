// CENSUS 2 probe: how often each "not estimated" trigger can come up. For every trigger group (moves, abilities, items),
// per game: whether the game's catalog has it and how many species can carry it (learners / ability holders); for Champions
// also the usage-weighted chance that one Pokémon of a team has it (data/champions/training-usage.json, Smogon
// gen9championsvgc2026regmb 2026-08, cutoff 1630: share of species sets × the set share of the move / item / ability) and
// the chance that at least one of the four Pokémon on the field has it. Scarlet/Violet, Sword/Shield and USUM ship no
// usage snapshot; their columns are catalog presence only.
//
// Run from the repo root: npx --no-install tsx scripts/.cache/calc-audit/status2/design/census-usage.ts
// Writes scripts/.cache/calc-audit/status2/design/census-usage.out.json.
import fs from "node:fs";
import path from "node:path";
import { STATUS_MOVE_TABLE } from "@/app/lib/battle/status-table";

type Catalog = { species: { id: string; abilities: string[]; moves: string[] }[]; moves: { id: string; category: string; target: string; ohko?: boolean }[]; abilities: { id: string }[]; items: { id: string }[] };
const GAMES = { champions: "data/champions/catalog.json", sv: "data/battle/scarlet_violet/catalog.json", swsh: "data/battle/sword_shield/catalog.json", usum: "data/battle/ultra_sun_ultra_moon/catalog.json" } as const;
const catalogs = Object.fromEntries(Object.entries(GAMES).map(([game, file]) => [game, JSON.parse(fs.readFileSync(file, "utf8")) as Catalog])) as Record<keyof typeof GAMES, Catalog>;
type Usage = { species: Record<string, { sets: number; moves: { id: string; weight: number }[]; items: { id: string; weight: number }[]; abilities: { id: string; weight: number }[] }> };
const usage = JSON.parse(fs.readFileSync("data/champions/training-usage.json", "utf8")) as Usage;
const totalSets = Object.values(usage.species).reduce((sum, row) => sum + row.sets, 0);

type Group = { id: string; moves?: string[]; abilities?: string[]; items?: string[] };
const L_MOVES = Object.entries(STATUS_MOVE_TABLE).filter(([, entry]) => entry.kind === "L").map(([id]) => id);
const GROUPS: Group[] = [
  // The switch-out family.
  { id: "uturn-voltswitch-flipturn", moves: ["uturn", "voltswitch", "flipturn"] },
  { id: "partingshot", moves: ["partingshot"] },
  { id: "teleport", moves: ["teleport"] },
  { id: "batonpass", moves: ["batonpass"] },
  { id: "shedtail", moves: ["shedtail"] },
  { id: "chillyreception", moves: ["chillyreception"] },
  { id: "roar-whirlwind", moves: ["roar", "whirlwind"] },
  { id: "dragontail-circlethrow", moves: ["dragontail", "circlethrow"] },
  { id: "ejectbutton", items: ["ejectbutton"] },
  { id: "ejectpack", items: ["ejectpack"] },
  { id: "redcard", items: ["redcard"] },
  { id: "emergencyexit-wimpout", abilities: ["emergencyexit", "wimpout"] },
  // The guards the user named.
  { id: "opportunist", abilities: ["opportunist"] },
  { id: "mirrorherb", items: ["mirrorherb"] },
  { id: "harvest", abilities: ["harvest"] },
  { id: "pickup", abilities: ["pickup"] },
  { id: "storedpower-powertrip-punishment", moves: ["storedpower", "powertrip", "punishment"] },
  { id: "accuracy-evasion-raisers", moves: ["doubleteam", "minimize", "acupressure", "coil", "honeclaws"], abilities: ["contrary"] },
  { id: "fling", moves: ["fling"] },
  { id: "ohko", moves: ["fissure", "guillotine", "horndrill", "sheercold"] },
  { id: "spread-drain", moves: ["matchagotcha", "parabolicharge"] },
  { id: "shellbell", items: ["shellbell"] },
  // FINAL.md's open list.
  { id: "berserk-angershell", abilities: ["berserk", "angershell"] },
  { id: "trace", abilities: ["trace"] },
  { id: "curse", moves: ["curse"] },
  { id: "psychicnoise", moves: ["psychicnoise"] },
  { id: "perishsong", moves: ["perishsong"] },
  { id: "starf-ganlon-apicot-lansat", items: ["starfberry", "ganlonberry", "apicotberry", "lansatberry"] },
  // The rest.
  { id: "neutralizinggas", abilities: ["neutralizinggas"] },
  { id: "unnerve-asone", abilities: ["unnerve", "asoneglastrier", "asonespectrier"] },
  { id: "sleeptalk", moves: ["sleeptalk"] },
  { id: "calling", moves: ["assist", "copycat", "mefirst", "metronome", "mirrormove", "naturepower", "instruct"] },
  { id: "presence-moves", moves: ["spotlight", "round", "beakblast", "shelltrap", "beatup", "fusionbolt", "fusionflare", "counter", "mirrorcoat", "metalburst", "comeuppance", "flameburst", "skydrop"] },
  { id: "pledges", moves: ["firepledge", "grasspledge", "waterpledge"] },
  { id: "semi-invulnerable", moves: ["fly", "dig", "dive", "bounce", "phantomforce", "shadowforce"] },
  { id: "smackdown-thousandarrows", moves: ["smackdown", "thousandarrows"] },
  { id: "volatile-secondaries", moves: ["coreenforcer", "burningjealousy", "alluringvoice", "spectralthief"] },
  { id: "burnup-doubleshock", moves: ["burnup", "doubleshock"] },
  { id: "glaiverush", moves: ["glaiverush"] },
  { id: "protean-libero", abilities: ["protean", "libero"] },
  { id: "roost", moves: ["roost"] },
  { id: "ingrain-magnetrise", moves: ["ingrain", "magnetrise"] },
  { id: "disable-encore", moves: ["disable", "encore"] },
  { id: "imprison", moves: ["imprison"] },
  { id: "painsplit", moves: ["painsplit"] },
  { id: "uproar", moves: ["uproar"] },
  { id: "assurance", moves: ["assurance"] },
  { id: "futuresight-doomdesire", moves: ["futuresight", "doomdesire"] },
  { id: "sparklingaria", moves: ["sparklingaria"] },
  { id: "dragondarts", moves: ["dragondarts"] },
  { id: "helpinghand", moves: ["helpinghand"] },
  { id: "safeguard", moves: ["safeguard"] },
  { id: "tailwind-windriders", abilities: ["windrider", "windpower"] },
  { id: "roomservice", items: ["roomservice"] },
  { id: "seeds-boosterenergy", items: ["electricseed", "grassyseed", "psychicseed", "mistyseed", "boosterenergy"] },
  { id: "field-settled-abilities", abilities: ["forecast", "mimicry", "protosynthesis", "quarkdrive", "flowergift", "iceface"] },
  { id: "focusband", items: ["focusband"] },
  { id: "disguise-iceface", abilities: ["disguise", "iceface"] },
  { id: "symbiosis", abilities: ["symbiosis"] },
  { id: "receiver-powerofalchemy", abilities: ["receiver", "powerofalchemy"] },
  { id: "battlebond", abilities: ["battlebond"] },
  { id: "aftermath-innardsout", abilities: ["aftermath", "innardsout"] },
  { id: "dancer", abilities: ["dancer"] },
  { id: "commander", abilities: ["commander"] },
  { id: "cottondown", abilities: ["cottondown"] },
  { id: "flowerveil-pastelveil", abilities: ["flowerveil", "pastelveil"] },
  { id: "ripen", abilities: ["ripen"] },
  { id: "unburden", abilities: ["unburden"] },
  { id: "imposter", abilities: ["imposter"] },
  { id: "poisonpuppeteer", abilities: ["poisonpuppeteer"] },
  { id: "download", abilities: ["download"] },
  { id: "moody", abilities: ["moody"] },
  { id: "cudchew", abilities: ["cudchew"] },
  { id: "form-lines", abilities: ["zenmode", "shieldsdown", "schooling", "powerconstruct"] },
  { id: "custap-quickdraw-mycelium", items: ["custapberry"], abilities: ["quickdraw", "myceliummight"] },
  { id: "mummy-family", abilities: ["mummy", "lingeringaroma", "wanderingspirit"] },
  { id: "liquidooze", abilities: ["liquidooze"] },
  { id: "galewings", abilities: ["galewings"] },
  { id: "priority-shields", abilities: ["queenlymajesty", "dazzling", "armortail"] },
  { id: "redirectors", moves: ["followme", "ragepowder"], abilities: ["lightningrod", "stormdrain"] },
  { id: "parentalbond-magician", abilities: ["parentalbond", "magician"] },
  { id: "substitute", moves: ["substitute"] },
  { id: "hp-status-moves", moves: ["revivalblessing", "purify", "stuffcheeks", "swallow", "teatime"] },
  { id: "bestow-recycle", moves: ["bestow", "recycle"] },
  { id: "teeterdance-swagger", moves: ["teeterdance", "swagger", "flatter"] },
  ...L_MOVES.map((id) => ({ id: `L:${id}`, moves: [id] })),
];

function presence(game: keyof typeof GAMES, group: Group) {
  const c = catalogs[game];
  const moveIds = new Set(c.moves.map((m) => m.id)), abilityIds = new Set(c.abilities.map((a) => a.id)), itemIds = new Set(c.items.map((i) => i.id));
  const moves = (group.moves ?? []).filter((id) => moveIds.has(id));
  const abilities = (group.abilities ?? []).filter((id) => abilityIds.has(id));
  const items = (group.items ?? []).filter((id) => itemIds.has(id));
  const carriers = c.species.filter((s) => moves.some((id) => s.moves.includes(id)) || abilities.some((id) => s.abilities.includes(id))).length;
  return { moves, abilities, items, carriers: moves.length || abilities.length ? carriers : items.length ? c.species.length : 0 };
}

function championsUsage(group: Group) {
  let perMon = 0;
  const top: { species: string; share: number }[] = [];
  for (const [species, row] of Object.entries(usage.species)) {
    const share = row.sets / totalSets;
    const weight = (list: { id: string; weight: number }[], ids: string[] | undefined) => Math.min(1, list.filter((e) => ids?.includes(e.id)).reduce((sum, e) => sum + e.weight, 0));
    // Moves: at most one of a group per set is the usual case (the weights are set shares); abilities and items are exclusive.
    const has = 1 - (1 - weight(row.moves, group.moves)) * (1 - weight(row.abilities, group.abilities)) * (1 - weight(row.items, group.items));
    if (has > 0) { perMon += share * has; top.push({ species, share: share * has }); }
  }
  top.sort((a, b) => b.share - a.share);
  return { perMon, anyOfFour: 1 - (1 - perMon) ** 4, top: top.slice(0, 4).map((t) => `${t.species} ${(t.share * 100).toFixed(2)}%`) };
}

const out = GROUPS.map((group) => ({
  id: group.id,
  games: Object.fromEntries((Object.keys(GAMES) as (keyof typeof GAMES)[]).map((game) => [game, presence(game, group)])),
  champions: championsUsage(group),
}));
fs.writeFileSync(path.resolve("scripts/.cache/calc-audit/status2/design/census-usage.out.json"), JSON.stringify({ totalSets, source: "data/champions/training-usage.json (gen9championsvgc2026regmb 2026-08, cutoff 1630)", groups: out }, null, 1));
for (const row of out) {
  const g = row.games;
  const avail = (Object.keys(g) as (keyof typeof g)[]).map((game) => `${game}:${g[game].moves.length + g[game].abilities.length + g[game].items.length ? g[game].carriers : "-"}`).join(" ");
  console.log(`${row.id.padEnd(34)} ${avail.padEnd(46)} champ/mon ${(row.champions.perMon * 100).toFixed(2).padStart(6)}%  any4 ${(row.champions.anyOfFour * 100).toFixed(1).padStart(5)}%  ${row.champions.top.join(", ")}`);
}
