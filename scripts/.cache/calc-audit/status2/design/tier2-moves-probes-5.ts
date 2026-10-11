// TIER 2 (moves phase) probes, part 5 (Q13): Electrify and Ion Deluge on a move whose type is set as it is used (Weather
// Ball, Terrain Pulse, Judgment, Multi-Attack, Techno Blast, Revelation Dance, Natural Gift, Hidden Power, Aura Wheel,
// Raging Bull), on Z-Moves (generic and signature) and on Max Moves (G-Max included). Every electrified move here hits a
// Gyarados (Electric 4x) or a Garchomp (Electric immune), so the type shows in the damage. Pinned Showdown c23d2e94
// through guards-sim.ts. Run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/status2/design/tier2-moves-probes-5.ts [ID ...] > scripts/.cache/calc-audit/status2/design/tier2-moves-probes-5.out
import { showTrace, type Game, type Mon, type Probe } from "./guards-sim";

const only = process.argv.slice(2);
const want = (id: string) => !only.length || only.includes(id);
const LINES = /^\|(move|cant|-damage|-immune|-supereffective|-resisted|-enditem|-fieldstart|-weather|-status|-activate|-zpower|-singleturn|detailschange|turn)\|/;
const lax = (n: number, name = `Lax${n}`): Mon => ({ species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], evs: { spe: n * 8 }, name });
const gyara: Mon = { species: "Gyarados", ability: "Moxie", moves: ["Splash"], name: "Gyara" };
const chomp: Mon = { species: "Garchomp", ability: "Rough Skin", moves: ["Splash"], name: "Chomp" };
const zapper = (game: Game, ion = false): Mon => ion ? { species: "Lanturn", ability: "Volt Absorb", moves: ["Ion Deluge"], evs: { spe: 252 }, name: "Ion" }
  : { species: "Heliolisk", ability: "Dry Skin", moves: ["Electrify"], evs: { spe: 252 }, name: "Zap" };
type Q = { id: string; game: Game; title: string; user: Mon; choice?: string; target?: Mon; ion?: boolean; control?: boolean; setup?: Probe["setup"] };
const cases: Q[] = [
  { id: "T2-Q01", game: "swsh", title: "a Dynamaxed Pixilate Sylveon's Hyper Voice (Max Starfall without Electrify) becomes Max Lightning (Electric Terrain)", user: { species: "Sylveon", ability: "Pixilate", moves: ["Hyper Voice"], name: "Syl" }, choice: "move 1 1 dynamax" },
  { id: "T2-Q02", game: "swsh", title: "a Gigantamax Pikachu's Body Slam becomes G-Max Volt Crash (Electric G-Max), not Max Lightning", user: { species: "Pikachu", ability: "Static", moves: ["Body Slam"], name: "Pika" }, choice: "move 1 1 dynamax",
    setup: (b) => { const p = b.p2.active[0]; p.canGigantamax = "G-Max Volt Crash"; p.gigantamax = true; } },
  { id: "T2-Q03", game: "swsh", title: "Weather Ball in sun (Fire 100) becomes Electric with its doubled power", user: { species: "Ninetales", ability: "Flash Fire", moves: ["Weather Ball"], name: "Tales" },
    setup: (b) => { b.field.setWeather("sunnyday", b.p1.active[1]); } },
  { id: "T2-Q03c", game: "swsh", title: "control: the same Weather Ball in sun without Electrify", control: true, user: { species: "Ninetales", ability: "Flash Fire", moves: ["Weather Ball"], name: "Tales" },
    setup: (b) => { b.field.setWeather("sunnyday", b.p1.active[1]); } },
  { id: "T2-Q04", game: "usum", title: "Ion Deluge: a Z-Body Slam (Breakneck Blitz, Normal) becomes Electric", ion: true, user: { species: "Snorlax", ability: "Thick Fat", item: "Normalium Z", moves: ["Body Slam"], name: "Lax" }, choice: "move 1 1 zmove" },
  { id: "T2-Q05", game: "usum", title: "Electrify: a Snorlium Z Giga Impact (Pulverizing Pancake) into Garchomp", user: { species: "Snorlax", ability: "Thick Fat", item: "Snorlium Z", moves: ["Giga Impact"], name: "Lax" }, choice: "move 1 1 zmove", target: chomp },
  { id: "T2-Q06", game: "usum", title: "Electrify: a Firium Z Flamethrower (Inferno Overdrive) into Gyarados", user: { species: "Arcanine", ability: "Intimidate", item: "Firium Z", moves: ["Flamethrower"], name: "Arc" }, choice: "move 1 1 zmove" },
  { id: "T2-Q06c", game: "usum", title: "control: the same Inferno Overdrive without Electrify", control: true, user: { species: "Arcanine", ability: "Intimidate", item: "Firium Z", moves: ["Flamethrower"], name: "Arc" }, choice: "move 1 1 zmove" },
  { id: "T2-Q07", game: "usum", title: "Electrify: Arceus-Fire (Flame Plate) Judgment becomes Electric", user: { species: "Arceus-Fire", ability: "Multitype", item: "Flame Plate", moves: ["Judgment"], name: "Arc" } },
  { id: "T2-Q08", game: "usum", title: "Electrify: Hidden Power (Fire IVs) becomes Electric", user: { species: "Magnezone", ability: "Sturdy", moves: ["Hidden Power Fire"], name: "Zone", ivs: { atk: 30, spa: 30, spe: 30 } } as Mon },
  { id: "T2-Q09", game: "usum", title: "Ion Deluge: Weather Ball with no weather (Normal) becomes Electric", ion: true, user: { species: "Castform", ability: "Forecast", moves: ["Weather Ball"], name: "Cast" } },
  { id: "T2-Q09b", game: "usum", title: "Ion Deluge: Weather Ball in rain (Water) stays Water", ion: true, user: { species: "Castform", ability: "Forecast", moves: ["Weather Ball"], name: "Cast" },
    setup: (b) => { b.field.setWeather("raindance", b.p1.active[1]); } },
  { id: "T2-Q10", game: "swsh", title: "Electrify: Terrain Pulse on Psychic Terrain (Psychic 100, grounded user) becomes Electric 100", user: { species: "Indeedee", ability: "Inner Focus", moves: ["Terrain Pulse"], name: "Dee" },
    setup: (b) => { b.field.setTerrain("psychicterrain", b.p1.active[1]); } },
  { id: "T2-Q11", game: "usum", title: "Electrify: Silvally-Fire (Fire Memory) Multi-Attack becomes Electric", user: { species: "Silvally-Fire", ability: "RKS System", item: "Fire Memory", moves: ["Multi-Attack"], name: "Sil" } },
  { id: "T2-Q12", game: "swsh", title: "Electrify: Hangry Morpeko's Aura Wheel (Dark) becomes Electric", user: { species: "Morpeko-Hangry", ability: "Hunger Switch", moves: ["Aura Wheel"], name: "Peko" } },
  { id: "T2-Q13", game: "usum", title: "Electrify: Natural Gift with a Sitrus Berry (Psychic) becomes Electric; the Berry is used up", user: { species: "Snorlax", ability: "Thick Fat", item: "Sitrus Berry", moves: ["Natural Gift"], name: "Gift" } },
  { id: "T2-Q14", game: "usum", title: "Electrify: Genesect's Techno Blast with a Burn Drive (Fire) becomes Electric", user: { species: "Genesect", ability: "Download", item: "Burn Drive", moves: ["Techno Blast"], name: "Gen" } },
  { id: "T2-Q15", game: "usum", title: "Electrify: Oricorio (Baile, Fire) Revelation Dance becomes Electric", user: { species: "Oricorio", ability: "Dancer", moves: ["Revelation Dance"], name: "Ori" } },
  { id: "T2-Q16", game: "champions", title: "Electrify: Tauros-Paldea-Blaze's Raging Bull (Fire) becomes Electric; Reflect still broken", user: { species: "Tauros-Paldea-Blaze", ability: "Intimidate", moves: ["Raging Bull"], name: "Bull" },
    setup: (b) => { b.p1.addSideCondition("reflect", b.p1.active[1]); } },
];
for (const q of cases) {
  if (!want(q.id)) continue;
  // p1a: the Gyarados (or Garchomp) target; p1b: a Snorlax; p2a: the electrified user; p2b: Heliolisk (Electrify) or Lanturn (Ion Deluge), fastest.
  const target = q.target ?? gyara;
  const zap = q.control ? { ...zapper(q.game, q.ion), moves: ["Splash"] } : zapper(q.game, q.ion);
  const zapChoice = q.control ? "move 1" : q.ion ? "move 1" : "move 1 -1";
  showTrace(`${q.id} ${q.game}: ${q.title}`, {
    game: q.game, turns: [["move 1, move 1", `${q.choice ?? "move 1 1"}, ${zapChoice}`]],
    mons: [{ ...target, evs: { hp: 252, def: 252, spd: 252 } }, lax(1), { ...q.user, evs: { ...(q.user.evs ?? {}), spe: 0 } }, zap],
    setup: q.setup,
  }, LINES);
}
