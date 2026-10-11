// INPUTS ARCHITECT (status2): how often each earlier-turn input candidate can matter. For every candidate (the state's
// setter moves, abilities, items), per game: whether the catalog has it and how many species carry it; for Champions the
// usage-weighted share of team slots that carry a setter and the chance one of the four Pokémon on the field does
// (data/champions/training-usage.json, as census-usage.ts). Run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/status2/design/inputs-probes-usage.ts > scripts/.cache/calc-audit/status2/design/inputs-probes-usage.out
import fs from "node:fs";

type Catalog = { species: { id: string; abilities: string[]; moves: string[]; types: string[] }[]; moves: { id: string; category: string; target: string; flags?: Record<string, unknown> }[]; abilities: { id: string }[]; items: { id: string }[] };
const GAMES = { champions: "data/champions/catalog.json", sv: "data/battle/scarlet_violet/catalog.json", swsh: "data/battle/sword_shield/catalog.json", usum: "data/battle/ultra_sun_ultra_moon/catalog.json" } as const;
type GameKey = keyof typeof GAMES;
const catalogs = Object.fromEntries(Object.entries(GAMES).map(([game, file]) => [game, JSON.parse(fs.readFileSync(file, "utf8")) as Catalog])) as Record<GameKey, Catalog>;
type Usage = { species: Record<string, { sets: number; moves: { id: string; weight: number }[]; items: { id: string; weight: number }[]; abilities: { id: string; weight: number }[] }> };
const usage = JSON.parse(fs.readFileSync("data/champions/training-usage.json", "utf8")) as Usage;
const totalSets = Object.values(usage.species).reduce((sum, row) => sum + row.sets, 0);

type Group = { id: string; moves?: string[]; abilities?: string[]; items?: string[]; note?: string };
const GROUPS: Group[] = [
  // Q2's controls.
  { id: "stockpile (Stockpile, Swallow, Spit Up)", moves: ["stockpile", "swallow", "spitup"] },
  { id: "last-move readers (Disable, Encore, Conversion 2)", moves: ["disable", "encore", "conversion2"] },
  { id: "last-move readers (Instruct, Mirror Move)", moves: ["instruct", "mirrormove"] },
  { id: "battle last move (Copycat)", moves: ["copycat"] },
  { id: "Destiny Bond (last move, carried volatile)", moves: ["destinybond"] },
  { id: "item used earlier (Recycle, Harvest)", moves: ["recycle"], abilities: ["harvest"] },
  { id: "Cud Chew (Berry eaten last turn)", abilities: ["cudchew"] },
  { id: "type setters (Soak, Magic Powder, Reflect Type, Conversion, Conversion 2, Camouflage)", moves: ["soak", "magicpowder", "reflecttype", "conversion", "conversion2", "camouflage"] },
  { id: "type setters (Protean, Libero, Color Change)", abilities: ["protean", "libero", "colorchange"] },
  { id: "type losers (Burn Up, Double Shock)", moves: ["burnup", "doubleshock"] },
  { id: "added type (Forest's Curse, Trick-or-Treat)", moves: ["forestscurse", "trickortreat"] },
  { id: "infatuation (Attract, Cute Charm, Captivate)", moves: ["attract", "captivate"], abilities: ["cutecharm"] },
  { id: "Heal Block (Heal Block, Psychic Noise)", moves: ["healblock", "psychicnoise"] },
  { id: "accuracy / evasion setters", moves: ["doubleteam", "minimize", "acupressure", "coil", "honeclaws", "sandattack", "smokescreen", "flash", "kinesis", "mudslap", "octazooka", "mudbomb", "mirrorshot", "leaftornado", "nightdaze", "muddywater", "defog", "sweetscent", "tidyup"], abilities: ["contrary"] },
  { id: "accuracy / evasion readers (Stored Power, Power Trip, Punishment)", moves: ["storedpower", "powertrip", "punishment"] },
  { id: "Berserk lock (Berserk, Anger Shell)", abilities: ["berserk", "angershell"] },
  { id: "Mist", moves: ["mist"] },
  { id: "Lucky Chant", moves: ["luckychant"] },
  { id: "Mud Sport, Water Sport", moves: ["mudsport", "watersport"] },
  { id: "Safeguard", moves: ["safeguard"] },
  // The wave-2 controls.
  { id: "switch family (bench, replacement)", moves: ["uturn", "voltswitch", "flipturn", "partingshot", "teleport", "batonpass", "shedtail", "chillyreception", "roar", "whirlwind", "dragontail", "circlethrow"], items: ["ejectbutton", "ejectpack", "redcard"], abilities: ["emergencyexit", "wimpout"] },
  { id: "hazards (Stealth Rock, Spikes, Toxic Spikes, Sticky Web, Ceaseless Edge, Stone Axe)", moves: ["stealthrock", "spikes", "toxicspikes", "stickyweb", "ceaselessedge", "stoneaxe"] },
  // The Tier 2 candidates the orchestrator listed.
  { id: "Future Sight, Doom Desire", moves: ["futuresight", "doomdesire"] },
  { id: "redirect ties: two Lightning Rod / Storm Drain", abilities: ["lightningrod", "stormdrain"] },
  { id: "redirect ties: Follow Me, Rage Powder", moves: ["followme", "ragepowder"] },
  { id: "Dancer (ties by when it got the ability)", abilities: ["dancer"] },
  { id: "Download (entry order)", abilities: ["download"] },
  { id: "Commander", abilities: ["commander"] },
  { id: "Embargo", moves: ["embargo"] },
  { id: "Telekinesis", moves: ["telekinesis"] },
  { id: "Octolock", moves: ["octolock"] },
  { id: "Nightmare", moves: ["nightmare"] },
  { id: "Taunt", moves: ["taunt"] },
  { id: "Encore", moves: ["encore"] },
  { id: "Disable (and Cursed Body)", moves: ["disable"], abilities: ["cursedbody"] },
  { id: "Torment", moves: ["torment"] },
  { id: "Throat Chop", moves: ["throatchop"] },
  { id: "Charge", moves: ["charge"] },
  { id: "Laser Focus", moves: ["laserfocus"] },
  { id: "Glaive Rush", moves: ["glaiverush"] },
  { id: "Minimize", moves: ["minimize"] },
  { id: "Tar Shot", moves: ["tarshot"] },
  { id: "Foresight, Odor Sleuth, Miracle Eye", moves: ["foresight", "odorsleuth", "miracleeye"] },
  { id: "Salt Cure", moves: ["saltcure"] },
  { id: "Syrup Bomb", moves: ["syrupbomb"] },
  { id: "Power Trick, Power Shift", moves: ["powertrick", "powershift"] },
  { id: "No Retreat", moves: ["noretreat"] },
  { id: "Gastro Acid", moves: ["gastroacid"] },
  { id: "two-turn moves (a charge last turn)", moves: ["solarbeam", "solarblade", "meteorbeam", "electroshot", "skullbash", "skyattack", "razorwind", "freezeshock", "iceburn", "geomancy", "fly", "dig", "dive", "bounce", "phantomforce", "shadowforce"] },
  { id: "protecting moves (stall counter)", moves: ["protect", "detect", "kingsshield", "spikyshield", "banefulbunker", "obstruct", "silktrap", "burningbulwark", "endure", "maxguard"] },
  { id: "Ally Switch (SV, Champions counter)", moves: ["allyswitch"] },
  { id: "Uproar (locked 3 turns)", moves: ["uproar"] },
  { id: "rampage locks (Outrage, Petal Dance, Thrash, Raging Fury)", moves: ["outrage", "petaldance", "thrash", "ragingfury"] },
  { id: "Rollout, Ice Ball, Fury Cutter, Echoed Voice (streaks)", moves: ["rollout", "iceball", "furycutter", "echoedvoice"] },
  { id: "Retaliate (ally fainted last turn)", moves: ["retaliate"] },
  { id: "Trump Card (PP left)", moves: ["trumpcard"] },
  { id: "Battle Bond (once a battle)", abilities: ["battlebond"] },
  { id: "Intrepid Sword, Dauntless Shield, Supersweet Syrup (once a battle)", abilities: ["intrepidsword", "dauntlessshield", "supersweetsyrup"] },
  { id: "Truant (alternate turns)", abilities: ["truant"] },
  { id: "Dynamax (turns left)", note: "SwSh: every Pokémon" },
  // Existing carried fields with no calculator control today.
  { id: "Leech Seed", moves: ["leechseed"] },
  { id: "Yawn", moves: ["yawn"] },
  { id: "Perish Song, Perish Body", moves: ["perishsong"], abilities: ["perishbody"] },
  { id: "partial traps", moves: ["whirlpool", "firespin", "sandtomb", "infestation", "bind", "wrap", "clamp", "magmastorm", "snaptrap", "thundercage"] },
  { id: "Aqua Ring, Ingrain", moves: ["aquaring", "ingrain"] },
  { id: "Ghost Curse", moves: ["curse"] },
  { id: "Wish", moves: ["wish"] },
];

function presence(game: GameKey, group: Group) {
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
    const has = 1 - (1 - weight(row.moves, group.moves)) * (1 - weight(row.abilities, group.abilities)) * (1 - weight(row.items, group.items));
    if (has > 0) { perMon += share * has; top.push({ species, share: share * has }); }
  }
  top.sort((a, b) => b.share - a.share);
  return { perMon, anyOfFour: 1 - (1 - perMon) ** 4, top: top.slice(0, 3).map((t) => `${t.species} ${(t.share * 100).toFixed(2)}%`) };
}

console.log(`# inputs-probes-usage: ${totalSets} Champions sets (training-usage.json); per game: carriers (species) or "-" when absent`);
for (const group of GROUPS) {
  const avail = (Object.keys(GAMES) as GameKey[]).map((game) => {
    const p = presence(game, group);
    return `${game}:${p.moves.length + p.abilities.length + p.items.length ? p.carriers : "-"}`;
  }).join(" ");
  const absentMoves = (Object.keys(GAMES) as GameKey[]).map((game) => `${game}[${presence(game, group).moves.join(",")}]`).join(" ");
  const u = championsUsage(group);
  console.log(`${group.id.padEnd(66)} ${avail.padEnd(44)} champ/mon ${(u.perMon * 100).toFixed(2).padStart(6)}%  any4 ${(u.anyOfFour * 100).toFixed(1).padStart(5)}%  ${u.top.join(", ")}${group.note ? `  (${group.note})` : ""}`);
  if (group.moves && group.moves.length > 1) console.log(`    moves present: ${absentMoves}`);
}
