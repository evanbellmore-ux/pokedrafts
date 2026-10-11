// Step 0b's probes (status2 SPEC2 §3.6, ADDENDUM2 §3.6): each scenario on pinned Showdown c23d2e94 (the runnable copy
// scripts/.cache/calc-audit/showdown, through design/guards-sim.ts) at its lowest and highest rolls, beside the app's
// calculation of the same hit with the Step 0b field set on a synthetic build (calculateTurnMove). Prints one line per probe:
// Showdown's damage (lowest-highest) and the app's (min-max), and OK when they agree.
// Run from the repo root: npx --no-install tsx scripts/.cache/calc-audit/status2/build/step0b-probes.ts [ids...]
import { enumerate, monAt, type Game, type Mon, type Probe } from "../design/guards-sim";
import { calculateTurnMove, turnSpeed } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, createSide, defaultAbilityActive, getBuildStats } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, BattleGame, MoveContext } from "@/app/lib/battle/types";

const GAMES: Record<Game, BattleGame> = { sv: "scarlet_violet", swsh: "sword_shield", usum: "ultra_sun_ultra_moon", champions: "champions" };
const id = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");
const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
type Slot = "p1a" | "p1b" | "p2a" | "p2b";
let laxSpeed = 0;
/** A Snorlax with its own Speed (no speed tie among the probe's Snorlax). */
const lax = (name: string, extra: Partial<Mon> = {}): Mon => ({ species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], name, evs: { spe: 8 * (laxSpeed++ % 31) }, ...extra });

/** The app build of a Showdown set (level 50, 31 IVs, Serious, the set's EVs or Stat Points), with the Step 0b fields. */
function appBuild(m: Mon, runtime: BattleRuntime, extra: Partial<BattleBuild> = {}): BattleBuild {
  const base = createBuild(id(m.species), runtime);
  const abilityId = id(m.ability ?? "");
  const shared = { nature: m.nature ?? "Serious", abilityId, abilityActive: defaultAbilityActive(abilityId), itemId: id(m.item ?? ""), currentHP: null, status: "" as const };
  const trained = base.game === "champions" ? { ...base, ...shared, points: { ...ZERO, ...m.evs } }
    : { ...base, ...shared, native: { level: m.level ?? 50, evs: { ...ZERO, ...m.evs }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31, ...m.ivs } } };
  return { ...trained, ...extra } as BattleBuild;
}

type Case = {
  id: string; title: string; probe: Probe;
  /** The hit measured: its target, the turn (0-based), the attacker and the move. */
  target: Slot; attacker: Slot; move: string; turn?: number;
  app: (runtime: BattleRuntime, probe: Probe) => { attacker?: Partial<BattleBuild>; defender?: Partial<BattleBuild>; field?: (c: BattleConditions) => BattleConditions; context?: MoveContext; attackerMon?: Mon };
};
const IDX: Record<Slot, number> = { p1a: 0, p1b: 1, p2a: 2, p2b: 3 };

const CASES: Case[] = [
  {
    id: "SA13", title: "sv: Snorlax Body Slam into a Minimized Jolteon behind Reflect", target: "p1a", attacker: "p2a", move: "Body Slam",
    probe: { game: "sv", mons: [{ species: "Jolteon", ability: "Volt Absorb", name: "Jolt" }, lax("Ally"), lax("Slam", { moves: ["Body Slam"] }), lax("Foe")],
      turns: [["move 1, move 1", "move 1 1, move 1"]], setup: (b) => { monAt(b, "p1a").addVolatile("minimize"); b.p1.addSideCondition("reflect", monAt(b, "p1a")); } },
    app: () => ({ defender: { takenMods: { minimize: true } }, field: (c) => ({ ...c, multipleTargets: false, defenderSide: { ...c.defenderSide, reflect: true } }) }),
  },
  {
    id: "CR10", title: "sv: Body Slam into a Snorlax with Minimize and Glaive Rush under Reflect (x4)", target: "p1a", attacker: "p2a", move: "Body Slam",
    probe: { game: "sv", mons: [lax("Target"), lax("Ally"), lax("Slam", { moves: ["Body Slam"] }), lax("Foe")],
      turns: [["move 1, move 1", "move 1 1, move 1"]], setup: (b) => { monAt(b, "p1a").addVolatile("minimize"); monAt(b, "p1a").addVolatile("glaiverush"); b.p1.addSideCondition("reflect", monAt(b, "p1a")); } },
    app: () => ({ defender: { takenMods: { minimize: true, glaiveRush: true } }, field: (c) => ({ ...c, multipleTargets: false, defenderSide: { ...c.defenderSide, reflect: true } }) }),
  },
  {
    id: "TV03", title: "sv: Ice Beam into a Swampert with an added Grass type (three types, 2x)", target: "p1a", attacker: "p2a", move: "Ice Beam",
    probe: { game: "sv", mons: [{ species: "Swampert", ability: "Torrent", name: "Swamp" }, lax("Ally"), { species: "Lapras", ability: "Water Absorb", moves: ["Ice Beam"], name: "Beam", evs: { spe: 8 } }, lax("Foe")],
      turns: [["move 1, move 1", "move 1 1, move 1"]], setup: (b) => { monAt(b, "p1a").addType("Grass"); } },
    app: () => ({ defender: { addedType: "Grass" }, field: (c) => ({ ...c, multipleTargets: false }) }),
  },
  {
    id: "TV11", title: "sv: Ember into a Scizor with Tar Shot (8x)", target: "p1a", attacker: "p2a", move: "Ember",
    probe: { game: "sv", mons: [{ species: "Scizor", ability: "Technician", name: "Sciz" }, lax("Ally"), lax("Ember", { moves: ["Ember"] }), lax("Foe")],
      turns: [["move 1, move 1", "move 1 1, move 1"]], setup: (b) => { monAt(b, "p1a").addVolatile("tarshot"); } },
    app: () => ({ defender: { tarShot: true }, field: (c) => ({ ...c, multipleTargets: false }) }),
  },
  {
    id: "TV12", title: "usum: Body Slam into a Gengar with Foresight", target: "p1a", attacker: "p2a", move: "Body Slam",
    probe: { game: "usum", mons: [{ species: "Gengar", ability: "Levitate", name: "Geng" }, lax("Ally"), lax("Slam", { moves: ["Body Slam"] }), lax("Foe")],
      turns: [["move 1, move 1", "move 1 1, move 1"]], setup: (b) => { monAt(b, "p1a").addVolatile("foresight"); } },
    app: () => ({ defender: { revealed: "foresight" }, field: (c) => ({ ...c, multipleTargets: false }) }),
  },
  {
    id: "TV13", title: "usum: Psychic into an Umbreon with Miracle Eye", target: "p1a", attacker: "p2a", move: "Psychic",
    probe: { game: "usum", mons: [{ species: "Umbreon", ability: "Synchronize", name: "Umb" }, lax("Ally"), { species: "Alakazam", ability: "Inner Focus", moves: ["Psychic"], name: "Zam" }, lax("Foe")],
      turns: [["move 1, move 1", "move 1 1, move 1"]], setup: (b) => { monAt(b, "p1a").addVolatile("miracleeye"); } },
    app: () => ({ defender: { revealed: "miracleeye" }, field: (c) => ({ ...c, multipleTargets: false }) }),
  },
  {
    id: "CR07", title: "sv: Earthquake into a Skarmory hit by Smack Down (pinned: 2x)", target: "p1a", attacker: "p2a", move: "Earthquake",
    probe: { game: "sv", mons: [{ species: "Skarmory", ability: "Sturdy", name: "Skarm" }, { species: "Bronzong", ability: "Levitate", name: "Bronz" }, { species: "Garchomp", ability: "Rough Skin", moves: ["Earthquake"], name: "Chomp" }, { species: "Zapdos", ability: "Pressure", name: "Zap" }],
      turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { monAt(b, "p1a").addVolatile("smackdown"); } },
    app: () => ({ defender: { grounding: "pinned" }, field: (c) => ({ ...c, multipleTargets: true }) }),
  },
  {
    id: "CR07f", title: "sv: Earthquake into a Snorlax with Magnet Rise (floating: no effect)", target: "p1a", attacker: "p2a", move: "Earthquake",
    probe: { game: "sv", mons: [lax("Float"), { species: "Bronzong", ability: "Levitate", name: "Bronz" }, { species: "Garchomp", ability: "Rough Skin", moves: ["Earthquake"], name: "Chomp" }, { species: "Zapdos", ability: "Pressure", name: "Zap" }],
      turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { monAt(b, "p1a").addVolatile("magnetrise"); } },
    app: () => ({ defender: { grounding: "floating" }, field: (c) => ({ ...c, multipleTargets: true }) }),
  },
  {
    id: "CR07L", title: "sv: Earthquake into a Levitate Bronzong hit by Smack Down (pinned through Levitate)", target: "p1b", attacker: "p2a", move: "Earthquake",
    probe: { game: "sv", mons: [{ species: "Skarmory", ability: "Sturdy", name: "Skarm" }, { species: "Bronzong", ability: "Levitate", name: "Bronz" }, { species: "Garchomp", ability: "Rough Skin", moves: ["Earthquake"], name: "Chomp" }, { species: "Zapdos", ability: "Pressure", name: "Zap" }],
      turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { monAt(b, "p1b").addVolatile("smackdown"); } },
    app: () => ({ defender: { grounding: "pinned" }, field: (c) => ({ ...c, multipleTargets: true }) }),
  },
  {
    id: "TV15", title: "usum: Earthquake into an Air Balloon Snorlax under Embargo", target: "p1a", attacker: "p2a", move: "Earthquake",
    probe: { game: "usum", mons: [lax("Balloon", { item: "Air Balloon" }), { species: "Bronzong", ability: "Levitate", name: "Bronz" }, { species: "Garchomp", ability: "Rough Skin", moves: ["Earthquake"], name: "Chomp" }, { species: "Zapdos", ability: "Pressure", name: "Zap" }],
      turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { monAt(b, "p1a").addVolatile("embargo"); } },
    app: () => ({ defender: { itemSuppressed: true }, field: (c) => ({ ...c, multipleTargets: true }) }),
  },
  {
    id: "F75", title: "usum: a Galvanize Golem-Alola Body Slam into Lapras under Mud Sport", target: "p1a", attacker: "p2a", move: "Body Slam",
    probe: { game: "usum", mons: [{ species: "Lapras", ability: "Shell Armor", name: "Lap" }, lax("Ally"), { species: "Golem-Alola", ability: "Galvanize", moves: ["Body Slam"], name: "Golem" }, lax("Foe")],
      turns: [["move 1, move 1", "move 1 1, move 1"]], setup: (b) => { b.field.addPseudoWeather("mudsport", monAt(b, "p1a")); } },
    app: () => ({ field: (c) => ({ ...c, multipleTargets: false, mudSport: true }) }),
  },
  {
    id: "F35", title: "usum: Frost Breath (always critical) into a Lucky Chant side", target: "p1a", attacker: "p2a", move: "Frost Breath",
    probe: { game: "usum", mons: [lax("Target"), lax("Ally"), { species: "Lapras", ability: "Water Absorb", moves: ["Frost Breath"], name: "Lap" }, lax("Foe")],
      turns: [["move 1, move 1", "move 1 1, move 1"]], setup: (b) => { b.p1.addSideCondition("luckychant", monAt(b, "p1a")); } },
    app: () => ({ field: (c) => ({ ...c, multipleTargets: false, defenderSide: { ...c.defenderSide, luckyChant: true } }) }),
  },
  {
    id: "SA06", title: "swsh: Lapras Body Slam into a Guard Split Shuckle under Wonder Room", target: "p1a", attacker: "p2a", move: "Body Slam",
    probe: { game: "swsh", mons: [{ species: "Shuckle", ability: "Sturdy", name: "Shuck" }, lax("Ally"), { species: "Lapras", ability: "Water Absorb", moves: ["Body Slam"], name: "Lap" }, lax("Foe")],
      turns: [["move 1, move 1", "move 1 1, move 1"]], setup: (b) => {
        // Jolteon's Guard Split (data/moves.ts guardsplit: the floor of each average): Jolteon's Defense 80, Sp. Def 115.
        const p = monAt(b, "p1a");
        p.storedStats.def = Math.floor((p.storedStats.def + 80) / 2); p.storedStats.spd = Math.floor((p.storedStats.spd + 115) / 2);
        b.field.addPseudoWeather("wonderroom", monAt(b, "p1a"));
      } },
    app: (runtime) => {
      const own = getBuildStats(appBuild({ species: "Shuckle", ability: "Sturdy" }, runtime), runtime)!;
      const jolteon = getBuildStats(appBuild({ species: "Jolteon", ability: "Volt Absorb" }, runtime), runtime)!;
      const stored = { atk: own.atk, def: Math.floor((own.def + jolteon.def) / 2), spa: own.spa, spd: Math.floor((own.spd + jolteon.spd) / 2), spe: own.spe };
      return { defender: { storedStats: stored }, field: (c) => ({ ...c, multipleTargets: false, wonderRoom: true }) };
    },
  },
  {
    id: "SA19c", title: "sv: Low Kick into a Rhyperior at 182.8 kg (weight)", target: "p1a", attacker: "p2a", move: "Low Kick",
    probe: { game: "sv", mons: [{ species: "Rhyperior", ability: "Solid Rock", name: "Rhy" }, lax("Ally"), lax("Kick", { moves: ["Low Kick"] }), lax("Foe")],
      turns: [["move 1, move 1", "move 1 1, move 1"]], setup: (b) => { monAt(b, "p1a").weighthg = 1828; } },
    app: () => ({ defender: { weighthg: 1828 }, field: (c) => ({ ...c, multipleTargets: false }) }),
  },
  {
    id: "SA09", title: "sv: Spit Up with three Stockpile layers into Chansey (300 power)", target: "p1a", attacker: "p2a", move: "Spit Up",
    probe: { game: "sv", mons: [{ species: "Chansey", ability: "Natural Cure", name: "Chan" }, lax("Ally"), lax("Spit", { moves: ["Spit Up"] }), lax("Foe")],
      turns: [["move 1, move 1", "move 1 1, move 1"]], setup: (b) => { const p = monAt(b, "p2a"); p.addVolatile("stockpile"); p.addVolatile("stockpile"); p.addVolatile("stockpile"); } },
    app: () => ({ attacker: { boosts: { atk: 0, def: 3, spa: 0, spd: 3, spe: 0 } }, field: (c) => ({ ...c, multipleTargets: false }), context: { stockpile: 3 } }),
  },
  {
    id: "D", title: "sv: Stored Power from a Pokémon at +2 evasion (60 power)", target: "p1a", attacker: "p2a", move: "Stored Power",
    probe: { game: "sv", mons: [lax("Target"), lax("Ally"), { species: "Espeon", ability: "Synchronize", moves: ["Stored Power"], name: "Esp" }, lax("Foe")],
      turns: [["move 1, move 1", "move 1 1, move 1"]], setup: (b) => { monAt(b, "p2a").boosts.evasion = 2; } },
    app: () => ({ field: (c) => ({ ...c, multipleTargets: false }), context: { hiddenStages: 2 } }),
  },
  {
    id: "K55", title: "swsh: an Electrified Pixilate Sylveon's Hyper Voice into Gyarados (kept 1.2x)", target: "p1a", attacker: "p2a", move: "Hyper Voice",
    probe: { game: "swsh", mons: [{ species: "Gyarados", ability: "Moxie", name: "Gyara" }, lax("Ally"), { species: "Sylveon", ability: "Pixilate", moves: ["Hyper Voice"], name: "Syl" }, lax("Foe")],
      turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { monAt(b, "p2a").addVolatile("electrify"); } },
    app: () => ({ context: { retype: "electrify" } }),
  },
  {
    id: "K55c", title: "swsh: an Electrified Cute Charm Sylveon's Hyper Voice into Gyarados (no boost)", target: "p1a", attacker: "p2a", move: "Hyper Voice",
    probe: { game: "swsh", mons: [{ species: "Gyarados", ability: "Moxie", name: "Gyara" }, lax("Ally"), { species: "Sylveon", ability: "Cute Charm", moves: ["Hyper Voice"], name: "Syl" }, lax("Foe")],
      turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { monAt(b, "p2a").addVolatile("electrify"); } },
    app: () => ({ context: { retype: "electrify" } }),
  },
  {
    id: "TW02", title: "usum: Ion Deluge on a Normalize Delcatty's Body Slam into Gyarados (kept 1.2x)", target: "p1a", attacker: "p2a", move: "Body Slam",
    probe: { game: "usum", mons: [{ species: "Gyarados", ability: "Moxie", name: "Gyara" }, lax("Ally"), { species: "Delcatty", ability: "Normalize", moves: ["Body Slam"], name: "Cat" }, lax("Foe")],
      turns: [["move 1, move 1", "move 1 1, move 1"]], setup: (b) => { b.field.addPseudoWeather("iondeluge", monAt(b, "p1a")); } },
    app: () => ({ field: (c) => ({ ...c, multipleTargets: false, ionDeluge: true }), context: { retype: "iondeluge" } }),
  },
  {
    id: "TW02f", title: "usum: Ion Deluge on a Normalize Delcatty's Flamethrower (Normal by Normalize) into Gyarados", target: "p1a", attacker: "p2a", move: "Flamethrower",
    probe: { game: "usum", mons: [{ species: "Gyarados", ability: "Moxie", name: "Gyara" }, lax("Ally"), { species: "Delcatty", ability: "Normalize", moves: ["Flamethrower"], name: "Cat" }, lax("Foe")],
      turns: [["move 1, move 1", "move 1 1, move 1"]], setup: (b) => { b.field.addPseudoWeather("iondeluge", monAt(b, "p1a")); } },
    app: () => ({ field: (c) => ({ ...c, multipleTargets: false, ionDeluge: true }), context: { retype: "iondeluge" } }),
  },
  {
    id: "T2-SI01", title: "sv: Earthquake into a Garchomp underground (Dig: 2x final)", target: "p1a", attacker: "p2a", move: "Earthquake",
    probe: { game: "sv", mons: [{ species: "Garchomp", ability: "Rough Skin", name: "Chomp" }, { species: "Bronzong", ability: "Levitate", name: "Bronz" }, { species: "Excadrill", ability: "Sand Rush", moves: ["Earthquake"], name: "Drill" }, { species: "Zapdos", ability: "Pressure", name: "Zap" }],
      turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { monAt(b, "p1a").addVolatile("dig"); } },
    app: () => ({ defender: { takenMods: { hidden: "dig" } }, field: (c) => ({ ...c, multipleTargets: true }) }),
  },
  {
    id: "T2-SI03", title: "sv: Gust into a Dragonite in the air (Fly: 2x final)", target: "p1a", attacker: "p2a", move: "Gust",
    probe: { game: "sv", mons: [{ species: "Dragonite", ability: "Inner Focus", name: "Nite" }, lax("Ally"), lax("Gust", { moves: ["Gust"] }), lax("Foe")],
      turns: [["move 1, move 1", "move 1 1, move 1"]], setup: (b) => { monAt(b, "p1a").addVolatile("fly"); } },
    app: () => ({ defender: { takenMods: { hidden: "fly" } }, field: (c) => ({ ...c, multipleTargets: false }) }),
  },
  {
    id: "T2-SI05", title: "swsh: Gust into a Lopunny in the air (Bounce: 2x power)", target: "p1a", attacker: "p2a", move: "Gust",
    probe: { game: "swsh", mons: [{ species: "Lopunny", ability: "Limber", name: "Lop" }, lax("Ally"), lax("Gust", { moves: ["Gust"] }), lax("Foe")],
      turns: [["move 1, move 1", "move 1 1, move 1"]], setup: (b) => { monAt(b, "p1a").addVolatile("bounce"); } },
    app: () => ({ defender: { takenMods: { hidden: "bounce" } }, field: (c) => ({ ...c, multipleTargets: false }) }),
  },
  {
    id: "CQ08b", title: "usum: the lifted Pokémon's partner's Gust into the Sky Drop user (no boost: Sky Drop doubles the pair's own Gust)", target: "p1a", attacker: "p2b", move: "Gust",
    probe: { game: "usum", turns: [["move 1 1, move 1", "move 1 1, move 2 1"]],
      mons: [{ species: "Braviary", ability: "Keen Eye", moves: ["Sky Drop"], name: "Braviary", evs: { spe: 252 } }, lax("Ally"),
        { species: "Clefairy", ability: "Friend Guard", moves: ["Pound"], name: "Lifted", evs: { spe: 4 } }, lax("Partner", { moves: ["Tackle", "Gust"] })] },
    app: () => ({ defender: { takenMods: { hidden: "skydrop" } }, field: (c) => ({ ...c, multipleTargets: false }) }),
  },
  {
    id: "T2-Q01", title: "swsh: a Dynamaxed Pixilate Sylveon's Hyper Voice under Electrify (Max Lightning) into Snorlax", target: "p1a", attacker: "p2a", move: "Hyper Voice",
    probe: { game: "swsh", mons: [lax("Target"), lax("Ally"), { species: "Sylveon", ability: "Pixilate", moves: ["Hyper Voice"], name: "Syl" }, lax("Foe")],
      turns: [["move 1, move 1", "move 1 1 dynamax, move 1"]], setup: (b) => { monAt(b, "p2a").addVolatile("electrify"); } },
    app: () => ({ attacker: { mechanic: "dynamax" }, field: (c) => ({ ...c, multipleTargets: false }), context: { retype: "electrify" } }),
  },
  {
    id: "T2-Q03", title: "swsh: Weather Ball in sun under Electrify into Gyarados", target: "p1a", attacker: "p2a", move: "Weather Ball",
    probe: { game: "swsh", mons: [{ species: "Gyarados", ability: "Moxie", name: "Gyara" }, lax("Ally"), { species: "Altaria", ability: "Natural Cure", moves: ["Weather Ball"], name: "Tales" }, lax("Foe")],
      turns: [["move 1, move 1", "move 1 1, move 1"]], setup: (b) => { b.field.setWeather("sunnyday", monAt(b, "p2a")); monAt(b, "p2a").addVolatile("electrify"); } },
    app: () => ({ field: (c) => ({ ...c, multipleTargets: false, weather: "Sun" }), context: { retype: "electrify" } }),
  },
  {
    id: "T2-Q06", title: "usum: an Electrified Firium Z Flamethrower (Inferno Overdrive) into Snorlax", target: "p1a", attacker: "p2a", move: "Flamethrower",
    probe: { game: "usum", mons: [lax("Target"), lax("Ally"), { species: "Arcanine", ability: "Intimidate", item: "Firium Z", moves: ["Flamethrower"], name: "Arc" }, lax("Foe")],
      turns: [["move 1, move 1", "move 1 1 zmove, move 1"]], setup: (b) => { monAt(b, "p2a").addVolatile("electrify"); } },
    app: () => ({ field: (c) => ({ ...c, multipleTargets: false }), context: { useZ: true, retype: "electrify" } }),
  },
  {
    id: "T2-Q16", title: "champions: an Electrified Tauros-Paldea-Blaze Raging Bull into Snorlax behind Reflect", target: "p1a", attacker: "p2a", move: "Raging Bull",
    probe: { game: "champions", mons: [lax("Target"), lax("Ally"), { species: "Tauros-Paldea-Blaze", ability: "Intimidate", moves: ["Raging Bull"], name: "Bull" }, lax("Foe")],
      turns: [["move 1, move 1", "move 1 1, move 1"]], setup: (b) => { b.p1.addSideCondition("reflect", monAt(b, "p1a")); monAt(b, "p2a").addVolatile("electrify"); } },
    app: () => ({ field: (c) => ({ ...c, multipleTargets: false, defenderSide: { ...c.defenderSide, reflect: true } }), context: { retype: "electrify" } }),
  },
  {
    id: "IN-LF", title: "usum: Body Slam from a Laser Focus Snorlax (critical hit)", target: "p1a", attacker: "p2a", move: "Body Slam",
    probe: { game: "usum", mons: [lax("Target"), lax("Ally"), lax("Slam", { moves: ["Body Slam"] }), lax("Foe")],
      turns: [["move 1, move 1", "move 1 1, move 1"]], setup: (b) => { monAt(b, "p2a").addVolatile("laserfocus"); } },
    app: () => ({ attacker: { laserFocus: true }, field: (c) => ({ ...c, multipleTargets: false }) }),
  },
  {
    id: "IN-LC", title: "usum: Body Slam from a Laser Focus Snorlax into a Lucky Chant side (no critical hit)", target: "p1a", attacker: "p2a", move: "Body Slam",
    probe: { game: "usum", mons: [lax("Target"), lax("Ally"), lax("Slam", { moves: ["Body Slam"] }), lax("Foe")],
      turns: [["move 1, move 1", "move 1 1, move 1"]], setup: (b) => { monAt(b, "p2a").addVolatile("laserfocus"); b.p1.addSideCondition("luckychant", monAt(b, "p1a")); } },
    app: () => ({ attacker: { laserFocus: true }, field: (c) => ({ ...c, multipleTargets: false, defenderSide: { ...c.defenderSide, luckyChant: true } }) }),
  },
  {
    id: "HH2", title: "sv: Body Slam with two Helping Hands (2.25x)", target: "p1a", attacker: "p2a", move: "Body Slam",
    probe: { game: "sv", mons: [lax("Target"), lax("Ally"), lax("Slam", { moves: ["Body Slam"] }), lax("Helper")],
      turns: [["move 1, move 1", "move 1 1, move 1"]], setup: (bb) => { const p = monAt(bb, "p2a"); p.addVolatile("helpinghand", monAt(bb, "p2b")); p.volatiles.helpinghand.multiplier = 2.25; } },
    app: () => ({ field: (c) => ({ ...c, multipleTargets: false }), context: { helpingHands: 2 } }),
  },
  {
    id: "T2-Q04", title: "usum: Ion Deluge on a Normalium Z Body Slam (Breakneck Blitz) into Snorlax", target: "p1a", attacker: "p2a", move: "Body Slam",
    probe: { game: "usum", mons: [lax("Target"), lax("Ally"), lax("Lax", { item: "Normalium Z", moves: ["Body Slam"] }), lax("Foe")],
      turns: [["move 1, move 1", "move 1 1 zmove, move 1"]], setup: (b) => { b.field.addPseudoWeather("iondeluge", monAt(b, "p1a")); } },
    app: () => ({ field: (c) => ({ ...c, multipleTargets: false, ionDeluge: true }), context: { useZ: true, retype: "iondeluge" } }),
  },
  {
    id: "T2-Q05", title: "usum: an Electrified Snorlium Z Giga Impact (Pulverizing Pancake) into Garchomp (immune)", target: "p1a", attacker: "p2a", move: "Giga Impact",
    probe: { game: "usum", mons: [{ species: "Garchomp", ability: "Rough Skin", name: "Chomp" }, lax("Ally"), lax("Lax", { item: "Snorlium Z", moves: ["Giga Impact"] }), lax("Foe")],
      turns: [["move 1, move 1", "move 1 1 zmove, move 1"]], setup: (b) => { monAt(b, "p2a").addVolatile("electrify"); } },
    app: () => ({ field: (c) => ({ ...c, multipleTargets: false }), context: { useZ: true, retype: "electrify" } }),
  },
  {
    id: "T2-Q07", title: "usum: an Electrified Arceus-Fire (Flame Plate) Judgment into Snorlax", target: "p1a", attacker: "p2a", move: "Judgment",
    probe: { game: "usum", mons: [lax("Target"), lax("Ally"), { species: "Arceus-Fire", ability: "Multitype", item: "Flame Plate", moves: ["Judgment"], name: "Arc" }, lax("Foe")],
      turns: [["move 1, move 1", "move 1 1, move 1"]], setup: (b) => { monAt(b, "p2a").addVolatile("electrify"); } },
    app: () => ({ field: (c) => ({ ...c, multipleTargets: false }), context: { retype: "electrify" } }),
  },
  {
    id: "T2-Q09", title: "usum: Ion Deluge on Weather Ball with no weather (Normal, so Electric) into Snorlax", target: "p1a", attacker: "p2a", move: "Weather Ball",
    probe: { game: "usum", mons: [lax("Target"), lax("Ally"), { species: "Altaria", ability: "Natural Cure", moves: ["Weather Ball"], name: "Tales" }, lax("Foe")],
      turns: [["move 1, move 1", "move 1 1, move 1"]], setup: (b) => { b.field.addPseudoWeather("iondeluge", monAt(b, "p1a")); } },
    app: () => ({ field: (c) => ({ ...c, multipleTargets: false, ionDeluge: true }), context: { retype: "iondeluge" } }),
  },
  {
    id: "T2-Q09b", title: "usum: Ion Deluge on Weather Ball in rain (Water, unchanged) into Snorlax", target: "p1a", attacker: "p2a", move: "Weather Ball",
    probe: { game: "usum", mons: [lax("Target"), lax("Ally"), { species: "Altaria", ability: "Natural Cure", moves: ["Weather Ball"], name: "Tales" }, lax("Foe")],
      turns: [["move 1, move 1", "move 1 1, move 1"]], setup: (b) => { b.field.setWeather("raindance", monAt(b, "p2a")); b.field.addPseudoWeather("iondeluge", monAt(b, "p1a")); } },
    app: () => ({ field: (c) => ({ ...c, multipleTargets: false, weather: "Rain", ionDeluge: true }), context: { retype: "iondeluge" } }),
  },
  {
    id: "LV", title: "swsh: an Electrified Liquid Voice Primarina's Hyper Voice (Water, then Electric) into Snorlax", target: "p1a", attacker: "p2a", move: "Hyper Voice",
    probe: { game: "swsh", mons: [lax("Target"), lax("Ally"), { species: "Primarina", ability: "Liquid Voice", moves: ["Hyper Voice"], name: "Prim", evs: { spe: 16 } }, lax("Foe")],
      turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { monAt(b, "p2a").addVolatile("electrify"); } },
    app: () => ({ context: { retype: "electrify" } }),
  },
  {
    id: "GAL", title: "usum: an Electrified Galvanize Golem-Alola's Body Slam (Electric already, boosted) into Snorlax", target: "p1a", attacker: "p2a", move: "Body Slam",
    probe: { game: "usum", mons: [lax("Target"), lax("Ally"), { species: "Golem-Alola", ability: "Galvanize", moves: ["Body Slam"], name: "Golem" }, lax("Foe")],
      turns: [["move 1, move 1", "move 1 1, move 1"]], setup: (b) => { monAt(b, "p2a").addVolatile("electrify"); } },
    app: () => ({ field: (c) => ({ ...c, multipleTargets: false }), context: { retype: "electrify" } }),
  },
  {
    id: "MATBLOCK", title: "usum: a Firium Z Flamethrower (Inferno Overdrive) through Mat Block (1/4)", target: "p1a", attacker: "p2a", move: "Flamethrower",
    probe: { game: "usum", mons: [lax("Target"), lax("Ally"), { species: "Arcanine", ability: "Intimidate", item: "Firium Z", moves: ["Flamethrower"], name: "Arc" }, lax("Foe")],
      turns: [["move 1, move 1", "move 1 1 zmove, move 1"]], setup: (b) => { b.p1.addSideCondition("matblock", monAt(b, "p1a")); } },
    app: () => ({ field: (c) => ({ ...c, multipleTargets: false, defenderSide: { ...c.defenderSide, protect: true, protectName: "Mat Block" } }), context: { useZ: true } }),
  },
  {
    id: "PLEDGE", title: "sv: a faster partner's Grass Pledge waits, then Lapras's Water Pledge (combined: Grass, 150, forced STAB) into Snorlax", target: "p1a", attacker: "p2a", move: "Water Pledge",
    probe: { game: "sv", mons: [lax("Target"), lax("Ally"), { species: "Lapras", ability: "Water Absorb", moves: ["Water Pledge"], name: "Lap", evs: { spe: 24 } }, { species: "Jolteon", ability: "Volt Absorb", moves: ["Grass Pledge"], name: "Jolt" }],
      turns: [["move 1, move 1", "move 1 1, move 1 1"]] },
    app: () => ({ field: (c) => ({ ...c, multipleTargets: false }), context: { basePower: 150, retypeTo: "Grass", forceStab: true } }),
  },
  {
    id: "ROUND", title: "sv: Round after the partner's Round (120 power) into Snorlax", target: "p1b", attacker: "p2b", move: "Round",
    probe: { game: "sv", mons: [lax("Target"), lax("Ally"), { species: "Lapras", ability: "Water Absorb", moves: ["Round"], name: "Lap", evs: { spe: 8 } }, lax("Singer", { moves: ["Round"] })],
      turns: [["move 1, move 1", "move 1 1, move 1 2"]] },
    app: () => ({ field: (c) => ({ ...c, multipleTargets: false }), context: { basePower: 120 } }),
  },
  {
    id: "PURSUIT", title: "usum: Pursuit into a Snorlax that does not switch (40 power)", target: "p1a", attacker: "p2a", move: "Pursuit",
    probe: { game: "usum", mons: [lax("Target"), lax("Ally"), lax("Chaser", { moves: ["Pursuit"] }), lax("Foe")],
      turns: [["move 1, move 1", "move 1 1, move 1"]] },
    app: () => ({ field: (c) => ({ ...c, multipleTargets: false }), context: { switching: false } }),
  },
  {
    id: "CHI", title: "swsh: Body Slam from a Snorlax with three G-Max Chi Strike layers (critical hit)", target: "p1a", attacker: "p2a", move: "Body Slam",
    probe: { game: "swsh", mons: [lax("Target"), lax("Ally"), lax("Slam", { moves: ["Body Slam"] }), lax("Foe")],
      turns: [["move 1, move 1", "move 1 1, move 1"]], setup: (b) => { const p = monAt(b, "p2a"); p.addVolatile("gmaxchistrike"); p.volatiles.gmaxchistrike.layers = 3; } },
    app: () => ({ attacker: { critBoost: 3 }, field: (c) => ({ ...c, multipleTargets: false }) }),
  },
  {
    id: "ALLY-PT", title: "sv: Quick Attack (+1) into the user's own ally on Psychic Terrain (it hits)", target: "p2b", attacker: "p2a", move: "Quick Attack",
    probe: { game: "sv", mons: [lax("Foe1"), lax("Foe2"), lax("Quick", { moves: ["Quick Attack"] }), lax("Mate")],
      turns: [["move 1, move 1", "move 1 -2, move 1"]], setup: (b) => { b.field.setTerrain("psychicterrain", monAt(b, "p1a")); } },
    app: () => ({ field: (c) => ({ ...c, multipleTargets: false, terrain: "Psychic", allyTarget: true }) }),
  },
  {
    id: "ALLY-DZ", title: "usum: Quick Attack (+1) into the user's own Dazzling ally (it hits)", target: "p2b", attacker: "p2a", move: "Quick Attack",
    probe: { game: "usum", mons: [lax("Foe1"), lax("Foe2"), lax("Quick", { moves: ["Quick Attack"] }), { species: "Bruxish", ability: "Dazzling", name: "Brux" }],
      turns: [["move 1, move 1", "move 1 -2, move 1"]] },
    app: () => ({ field: (c) => ({ ...c, multipleTargets: false, allyTarget: true }) }),
  },
  {
    id: "T2-GW01-usum", title: "usum: Talonflame's Brave Bird at +1 frozen at the turn's start, after Fake Out took HP, into a Dazzling Bruxish (blocked)", target: "p2a", attacker: "p1a", move: "Brave Bird",
    probe: { game: "usum", mons: [{ species: "Talonflame", ability: "Gale Wings", moves: ["Brave Bird"], name: "Talon" }, lax("Ally"), { species: "Bruxish", ability: "Dazzling", name: "Brux" }, lax("Faker", { moves: ["Fake Out"] })],
      turns: [["move 1 1, move 1", "move 1, move 1 1"]] },
    app: (runtime) => ({ attacker: { currentHP: (getBuildStats(appBuild({ species: "Talonflame", ability: "Gale Wings" }, runtime), runtime)!.hp) - 20 },
      field: (c) => ({ ...c, multipleTargets: false }), context: { frozenPriority: 1 } }),
  },
];

function hpOf(map: Map<string, Map<number, number>>, slot: Slot): number[] {
  for (const [key, values] of map) if (key.startsWith(`${slot} `)) return [...values.keys()];
  return [];
}

async function main() {
  const want = new Set(process.argv.slice(2));
  let bad = 0;
  for (const c of CASES) {
    if (want.size && !want.has(c.id)) continue;
    const turn = c.turn ?? 0;
    let showdown: { before: number[] | null; after: number[] }[];
    try {
      showdown = (["lowest", "highest"] as const).map((rolls) => {
        const r = enumerate({ ...c.probe, rolls, maxRuns: 5000 });
        const before = turn === 0 ? null : hpOf(r.end[turn - 1], c.target);
        const after = hpOf(r.afterMoves[turn], c.target);
        return { before, after };
      });
    } catch (error) {
      bad++;
      console.log(`FAIL ${c.id}: ${(error as Error).message}`);
      continue;
    }
    const runtime = await loadBattleRuntime(GAMES[c.probe.game]);
    const spec = c.app(runtime, c.probe);
    const attackerMon = spec.attackerMon ?? c.probe.mons[IDX[c.attacker]];
    const defenderMon = c.probe.mons[IDX[c.target]];
    const attacker = appBuild(attackerMon, runtime, spec.attacker);
    const defender = appBuild(defenderMon, runtime, spec.defender);
    const conditions = (spec.field ?? ((x) => x))({ ...createConditions(), attackerSide: createSide(), defenderSide: createSide() });
    const move = runtime.movesById.get(id(c.move))!;
    const row = calculateTurnMove(move, attacker, defender, conditions, spec.context, runtime);
    // Showdown's damage: the target's HP before the turn (its maximum on the first turn) less its HP after the moves.
    const start = enumerateStart(c.probe);
    const low = (showdown[0].before?.[0] ?? start[c.target]) - (showdown[0].after[0] ?? NaN);
    const high = (showdown[1].before?.[0] ?? start[c.target]) - (showdown[1].after[0] ?? NaN);
    const ok = row.min === Math.min(low, high) && row.max === Math.max(low, high);
    if (!ok) bad++;
    console.log(`${ok ? "OK  " : "DIFF"} ${c.id} ${c.title}: Showdown ${Math.min(low, high)}-${Math.max(low, high)} | app ${row.min}-${row.max} (${row.kind}${row.reason ? `: ${row.reason}` : ""}; ${row.effectiveName} ${row.effectiveType})`);
  }
  // The swamp: Speed x0.25 (turnSpeed), against Showdown's getActionSpeed.
  if (!want.size || want.has("SWAMP")) {
    const runtime = await loadBattleRuntime("scarlet_violet");
    const build = appBuild({ species: "Jolteon", ability: "Volt Absorb" }, runtime);
    const conditions = { ...createConditions(), attackerSide: createSide(), defenderSide: createSide() };
    const plain = turnSpeed(build, false, conditions, runtime);
    const swamp = turnSpeed(build, false, { ...conditions, attackerSide: { ...conditions.attackerSide, swamp: true } }, runtime);
    const { start } = await import("../design/guards-sim");
    const b = start({ game: "sv", mons: [{ species: "Jolteon", ability: "Volt Absorb", name: "Jolt" }, lax("Ally"), lax("Foe"), lax("Foe2")], turns: [], setup: (bb) => { bb.p1.addSideCondition("grasspledge", monAt(bb, "p1a")); } });
    const sd = monAt(b, "p1a").getActionSpeed();
    const ok = swamp === sd;
    if (!ok) bad++;
    console.log(`${ok ? "OK  " : "DIFF"} SWAMP sv: Jolteon's Speed in the swamp: Showdown ${sd} | app ${swamp} (plain ${plain})`);
  }
  console.log(bad ? `${bad} probe(s) differ` : "every probe agrees");
}

/** Each slot's HP as the battle starts (its maximum), from the harness's own battle. */
function enumerateStart(probe: Probe): Record<Slot, number> {
  const r = enumerate({ ...probe, rolls: "lowest", turns: [["move 1, move 1", "move 1, move 1"]], setup: undefined, mons: probe.mons.map((m) => ({ ...m, moves: ["Splash"] })) as Probe["mons"] });
  const out = {} as Record<Slot, number>;
  for (const slot of ["p1a", "p1b", "p2a", "p2b"] as Slot[]) out[slot] = hpOf(r.afterMoves[0], slot)[0];
  return out;
}

main().catch((error) => { console.error(error); process.exit(1); });
