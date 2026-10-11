// TIER 2 (moves phase) dex facts: which game's catalog has each move, ability and item the Tier 2 moves-phase entries
// read, with its learner / holder count (moves: species that learn it; abilities: species that can have it), and the
// species the entries name. Read-only use of the app catalogs (data/battle/<game>/catalog.json, data/champions/catalog.json).
// Run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/status2/design/tier2-moves-dex.ts > scripts/.cache/calc-audit/status2/design/tier2-moves-dex.out
import fs from "node:fs";

const GAMES = [
  ["sv", "data/battle/scarlet_violet/catalog.json"],
  ["champions", "data/champions/catalog.json"],
  ["swsh", "data/battle/sword_shield/catalog.json"],
  ["usum", "data/battle/ultra_sun_ultra_moon/catalog.json"],
] as const;

const MOVES: Record<string, string[]> = {
  "semi-invulnerable": ["fly", "dig", "dive", "bounce", "phantomforce", "shadowforce", "gust", "twister", "skyuppercut", "thunder", "hurricane", "smackdown", "thousandarrows",
    "earthquake", "magnitude", "surf", "whirlpool", "toxic", "lockon", "mindreader", "gravity", "highjumpkick", "jumpkick", "axekick", "supercellslam", "helpinghand"],
  "volatile-secondaries": ["coreenforcer", "burningjealousy", "alluringvoice", "spectralthief"],
  "spread contact": ["breakingswipe", "spikyshield", "kingsshield", "obstruct", "silktrap", "banefulbunker", "burningbulwark"],
  "ally-effect": ["quickattack", "aquajet", "pollenpuff", "extremespeed", "bulletpunch", "machpunch", "suckerpunch", "fakeout", "feint", "firstimpression", "jetpunch", "grassyglide"],
  "cotton / veils": ["mortalspin", "barbbarrage", "snarl", "strugglebug", "mysticalfire", "lunge", "trailblaze", "breakingswipe", "skittersmack", "spiritbreak", "chillingwater"],
  "aria / assurance / gale": ["sparklingaria", "assurance", "bravebird", "roost", "tailwind"],
  "darts / items": ["dragondarts", "allyswitch", "trick", "switcheroo"],
  "substitute": ["substitute", "mindblown", "dualwingbeat", "iciclespear", "bulletseed", "rockblast", "scaleshot", "populationbomb", "tripleaxel", "watershuriken", "surgingstrikes", "tachyoncutter", "doublehit", "dragondarts", "drainpunch", "gigadrain", "doubleedge", "flareblitz"],
  "pain split / face / sleep": ["painsplit", "sleeptalk", "uproar", "snore", "rest", "yawn"],
  "safeguard / hh": ["safeguard", "helpinghand", "nuzzle", "inferno", "zapcannon", "mortalspin", "dynamicpunch", "direclaw", "toxicthread"],
  "q13": ["electrify", "iondeluge", "weatherball", "terrainpulse", "judgment", "multiattack", "technoblast", "revelationdance", "naturalgift", "hiddenpower", "aurawheel", "ragingbull", "ivycudgel", "terablast", "terastarstorm", "bodyslam", "hypervoice", "gigaimpact"],
};
const ABILITIES: Record<string, string[]> = {
  "semi-invulnerable": ["noguard", "lightningrod", "stormdrain"],
  "spread": ["spicyspray", "gooey", "tanglinghair", "cottondown", "mummy", "lingeringaroma", "wanderingspirit", "perishbody", "pickpocket", "toxicdebris", "roughskin", "ironbarbs", "flamebody", "static"],
  "ally / unnerve": ["queenlymajesty", "dazzling", "armortail", "psychicsurge", "unnerve", "asoneglastrier", "asonespectrier"],
  "veils / bond": ["flowerveil", "pastelveil", "battlebond", "aftermath", "innardsout", "damp", "receiver", "powerofalchemy", "magicguard"],
  "face / focus": ["disguise", "iceface", "parentalbond", "sturdy", "magician", "galewings", "cheekpouch", "gluttony", "ripen", "berserk", "angershell"],
  "substitute": ["multiscale", "shadowshield", "stamina", "watercompaction", "weakarmor", "seedsower", "sandspit", "infiltrator"],
  "q13": ["pixilate", "aerilate", "refrigerate", "galvanize", "normalize", "liquidvoice", "dragonize", "voltabsorb", "motordrive"],
};
const ITEMS = ["focusband", "focussash", "starfberry", "ganlonberry", "apicotberry", "lansatberry", "salacberry", "liechiberry", "petayaberry", "custapberry",
  "lifeorb", "shellbell", "rockyhelmet", "airballoon", "keeberry", "marangaberry", "jabocaberry", "rowapberry", "stickybarb", "ejectbutton", "redcard", "ejectpack",
  "electricseed", "grassyseed", "mistyseed", "psychicseed", "roomservice", "boosterenergy", "covertcloak", "safetygoggles", "occaberry", "chilanberry", "sitrusberry",
  "normaliumz", "electriumz", "firiumz", "snorliumz", "pikaniumz", "abilityshield", "luminousmoss", "whiteherb", "mirrorherb", "clearamulet"];
const SPECIES = ["greninjabond", "greninjaash", "mimikyu", "mimikyubusted", "eiscue", "eiscuenoice", "scovillainmega", "eldegoss", "passimian", "oricorio", "silvally", "arceus",
  "genesect", "morpeko", "zacian", "toxtricity", "pikachu", "lanturn", "heliolisk", "dragapult", "zygarde", "zygardecomplete", "marshadow", "torkoal", "aerodactyl",
  "farigiraf", "florges", "floetteeternal", "ponytagalar", "rapidashgalar", "drifblim", "pyukumuku", "talonflame", "primarina", "kyurem", "shedinja"];

for (const [game, file] of GAMES) {
  const catalog = JSON.parse(fs.readFileSync(file, "utf8"));
  const moveIds = new Set<string>(catalog.moves.map((m: { id: string }) => m.id));
  const abilityIds = new Set<string>(catalog.abilities.map((a: { id: string }) => a.id));
  const itemIds = new Set<string>(catalog.items.map((i: { id: string }) => i.id));
  const speciesIds = new Set<string>(catalog.species.map((s: { id: string }) => s.id));
  const learners = new Map<string, string[]>();
  const holders = new Map<string, string[]>();
  for (const s of catalog.species as { id: string; moves: string[]; abilities: string[] }[]) {
    for (const m of s.moves) { const list = learners.get(m) ?? []; list.push(s.id); learners.set(m, list); }
    for (const a of s.abilities) { const list = holders.get(a) ?? []; list.push(s.id); holders.set(a, list); }
  }
  console.log(`\n=== ${game} (${catalog.species.length} species, ${catalog.moves.length} moves, ${catalog.abilities.length} abilities, ${catalog.items.length} items)`);
  for (const [group, ids] of Object.entries(MOVES)) {
    console.log(`  moves / ${group}: ${ids.map((id) => moveIds.has(id) ? `${id}(${learners.get(id)?.length ?? 0})` : `-${id}`).join(" ")}`);
  }
  for (const [group, ids] of Object.entries(ABILITIES)) {
    console.log(`  abilities / ${group}: ${ids.map((id) => abilityIds.has(id) ? `${id}(${(holders.get(id) ?? []).slice(0, 4).join("/")}${(holders.get(id)?.length ?? 0) > 4 ? "…" : ""})` : `-${id}`).join(" ")}`);
  }
  console.log(`  items: ${ITEMS.map((id) => itemIds.has(id) ? id : `-${id}`).join(" ")}`);
  console.log(`  species: ${SPECIES.map((id) => speciesIds.has(id) ? id : `-${id}`).join(" ")}`);
  // Learners of the rarer Tier 2 moves, by name.
  for (const id of ["electrify", "iondeluge", "coreenforcer", "burningjealousy", "alluringvoice", "spectralthief", "sparklingaria", "dragondarts", "painsplit", "uproar", "sleeptalk", "shadowforce", "phantomforce", "bounce", "dive", "breakingswipe", "mortalspin"]) {
    if (moveIds.has(id)) console.log(`    learners ${id}: ${(learners.get(id) ?? []).slice(0, 30).join(" ")}${(learners.get(id)?.length ?? 0) > 30 ? " …" : ""}`);
  }
  for (const id of ["cottondown", "flowerveil", "pastelveil", "battlebond", "aftermath", "innardsout", "receiver", "powerofalchemy", "disguise", "iceface", "galewings", "spicyspray", "unnerve"]) {
    if (abilityIds.has(id)) console.log(`    holders ${id}: ${(holders.get(id) ?? []).join(" ")}`);
  }
}
