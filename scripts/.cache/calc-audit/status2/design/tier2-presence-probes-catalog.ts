// TIER 2 (presence, calling moves, start settle, rows): which triggers exist in each game's app catalog, and who learns them.
// Run from the repo root: npx --no-install tsx scripts/.cache/calc-audit/status2/design/tier2-presence-probes-catalog.ts > scripts/.cache/calc-audit/status2/design/tier2-presence-probes-catalog.out
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";

const GAMES = { sv: "scarlet_violet", champions: "champions", swsh: "sword_shield", usum: "ultra_sun_ultra_moon" } as const;
const MOVES = ["spotlight", "round", "beakblast", "shelltrap", "beatup", "fusionbolt", "fusionflare", "counter", "mirrorcoat", "metalburst", "comeuppance",
  "flameburst", "skydrop", "assist", "copycat", "mefirst", "metronome", "mirrormove", "naturepower", "sleeptalk", "instruct", "firepledge", "grasspledge",
  "waterpledge", "orderup", "snore", "followme", "ragepowder", "tailwind", "trickroom", "aquastep", "clangoroussoul", "dragondance", "featherdance",
  "fierydance", "lunardance", "petaldance", "quiverdance", "revelationdance", "swordsdance", "teeterdance", "victorydance", "fakeout", "uproar",
  "pursuit", "retaliate", "furycutter", "rollout", "iceball", "echoedvoice", "spitup", "trumpcard", "present", "magnitude", "bide", "imprison",
  "electricterrain", "grassyterrain", "mistyterrain", "psychicterrain", "sunnyday", "raindance", "sandstorm", "snowscape", "hail", "toxic", "poisongas", "toxicthread",
  "mortalspin", "banefulbunker", "malignantchain", "acidspray", "poisonpowder"];
const ABILITIES = ["commander", "dancer", "poisonpuppeteer", "quickdraw", "myceliummight", "trace", "download", "unburden", "windrider", "windpower",
  "lightningrod", "stormdrain", "comatose", "neutralizinggas", "protosynthesis", "quarkdrive", "forecast", "mimicry", "flowergift", "iceface", "intimidate", "imposter"];
const ITEMS = ["custapberry", "roomservice", "electricseed", "grassyseed", "psychicseed", "mistyseed", "boosterenergy", "abilityshield", "quickclaw"];

async function main() {
for (const [game, id] of Object.entries(GAMES)) {
  const rt = await loadBattleRuntime(id);
  console.log(`\n## ${game} (${rt.speciesById.size} species, ${rt.movesById.size} moves)`);
  const learners = (move: string) => [...rt.speciesById.values()].filter((s) => s.moves.includes(move)).map((s) => s.id);
  for (const move of MOVES) {
    const m = rt.movesById.get(move);
    if (!m) { console.log(`move ${move}: -`); continue; }
    const who = learners(move);
    console.log(`move ${move}: ${m.category} ${m.type} bp ${m.power} prio ${m.priority} target ${m.target}; ${who.length} learners${who.length <= 12 ? `: ${who.join(", ")}` : `: ${who.slice(0, 12).join(", ")}, ...`}`);
  }
  for (const ability of ABILITIES) {
    const a = rt.abilitiesById.get(ability);
    const who = [...rt.speciesById.values()].filter((s) => (s as any).abilities?.includes?.(ability)).map((s) => s.id);
    console.log(`ability ${ability}: ${a ? "yes" : "-"}${who.length ? `; ${who.length} species${who.length <= 12 ? `: ${who.join(", ")}` : ""}` : ""}`);
  }
  for (const item of ITEMS) console.log(`item ${item}: ${rt.itemsById.has(item) ? "yes" : "-"}`);
}
}
main();
