// R-E's third probe batch: Pursuit, Beat Up and Assist over the bench, the gas newcomer, Imposter, the weather setter, the
// leaver's Regenerator and Natural Cure, two switchers of a side, the residual's Eject Pack, a Ground target, Steelsurge, a
// drag into hazards and a Wish landing on the newcomer.
import type { SMon, Spec } from "./oracle";

const lax = (name: string, spe = 0, extra: Partial<SMon> = {}): SMon => ({ name, species: "Snorlax", ability: "Thick Fat", evs: { spe }, ...extra });
const ambi = (extra: Partial<SMon> = {}): SMon => ({ name: "Ambi", species: "Ambipom", ability: "Technician", move: "U-turn", target: "opponent-right", evs: { spe: 252 }, ...extra });

export const PROBES3: Spec[] = [
  // Pursuit (USUM) aimed at the other foe meets the U-turn user at its BeforeSwitchOut, at 80 power.
  {
    id: "R-PURSUIT", game: "usum",
    slots: {
      "own-left": ambi(), "own-right": lax("LaxA", 8),
      "opponent-right": lax("LaxB", 16), "opponent-left": { name: "Tar", species: "Tyranitar", ability: "Unnerve", move: "Pursuit", target: "own-right" },
    },
    bench: { own: [lax("Next", 32)], opponent: [lax("LaxE", 48)] },
  },
  // Beat Up over the bench: the user, its partner and the healthy bench member hit; the paralysed one does not.
  {
    id: "R-BEATUP", game: "sv",
    slots: {
      "own-left": { name: "Ambi", species: "Ambipom", ability: "Pickup", move: "Beat Up", target: "opponent-right", evs: { spe: 252 } },
      "own-right": lax("LaxA", 8),
      "opponent-right": lax("LaxB", 16), "opponent-left": lax("LaxD", 24),
    },
    bench: { own: [{ name: "Chomp", species: "Garchomp", ability: "Rough Skin" }, lax("Para", 32, { status: "par" })], opponent: [lax("LaxE", 48)] },
  },
  // A newcomer under the foe's Neutralizing Gas: no Intimidate; the later Body Slam at its full Attack.
  {
    id: "R-GAS-NEWCOMER", game: "sv",
    slots: {
      "own-left": ambi(), "own-right": lax("LaxA", 8),
      "opponent-right": { name: "Weez", species: "Weezing-Galar", ability: "Neutralizing Gas" },
      "opponent-left": lax("LaxD", 24, { move: "Body Slam", target: "own-left" }),
    },
    bench: { own: [{ name: "Incin", species: "Incineroar", ability: "Intimidate" }], opponent: [lax("LaxE", 48)] },
  },
  // An Imposter newcomer transforms into the foe across and takes its super-effective Dragon Claw.
  {
    id: "R-IMPOSTER", game: "sv",
    slots: {
      "own-left": ambi(), "own-right": lax("LaxA", 8),
      "opponent-right": lax("LaxB", 16), "opponent-left": { name: "Chomp", species: "Garchomp", ability: "Rough Skin", move: "Dragon Claw", target: "own-left" },
    },
    bench: { own: [{ name: "Ditto", species: "Ditto", ability: "Imposter" }], opponent: [lax("LaxE", 48)] },
  },
  // A Drizzle newcomer weakens the later Flamethrower.
  {
    id: "R-DRIZZLE", game: "sv",
    slots: {
      "own-left": ambi(), "own-right": lax("LaxA", 8),
      "opponent-right": lax("LaxB", 16), "opponent-left": { name: "Zard", species: "Charizard", ability: "Blaze", move: "Flamethrower", target: "own-right" },
    },
    bench: { own: [{ name: "Peli", species: "Pelipper", ability: "Drizzle" }], opponent: [lax("LaxE", 48)] },
  },
  // Chilly Reception after a hit: the snow, then Regenerator as the leaver goes.
  {
    id: "R-CHILLY", game: "sv",
    slots: {
      "own-left": { name: "King", species: "Slowking-Galar", ability: "Regenerator", move: "Chilly Reception", evs: { spe: 4 } },
      "own-right": lax("LaxA", 8),
      "opponent-right": lax("LaxB", 16, { move: "Body Slam", target: "own-left" }), "opponent-left": lax("LaxD", 24),
    },
    bench: { own: [lax("Next", 0)], opponent: [lax("LaxE", 48)] },
  },
  // Both Pokémon of a side U-turn: the second gets the next bench Pokémon; Natural Cure on the paralysed leaver (full paralysis 1/4).
  {
    id: "R-BOTH", game: "sv",
    slots: {
      "own-left": ambi(), "own-right": { name: "Comfey", species: "Comfey", ability: "Natural Cure", move: "U-turn", target: "opponent-left", status: "par" },
      "opponent-right": lax("LaxB", 16), "opponent-left": lax("LaxD", 24),
    },
    bench: { own: [lax("Next", 32), lax("Next2", 40)], opponent: [lax("LaxE", 48)] },
  },
  // Syrup Bomb's Speed drop at the end of turn uses the Eject Pack after the residual: the switch after the turn, into Stealth Rock.
  {
    id: "R-SYRUP-PACK", game: "sv", hazards: { own: { stealthRock: true } },
    slots: {
      "own-left": lax("Pack", 4, { item: "Eject Pack" }), "own-right": lax("LaxA", 8),
      "opponent-right": { name: "Dip", species: "Dipplin", ability: "Gluttony", move: "Syrup Bomb", target: "own-left" }, "opponent-left": lax("LaxD", 24),
    },
    bench: { own: [lax("Next", 32)], opponent: [lax("LaxE", 48)] },
  },
  // Volt Switch into a Ground type: no switch; the later Body Slam meets the Volt Switch user.
  {
    id: "R-VOLT-GROUND", game: "sv",
    slots: {
      "own-left": { name: "Jolt", species: "Jolteon", ability: "Volt Absorb", move: "Volt Switch", target: "opponent-right", evs: { spe: 252 } },
      "own-right": lax("LaxA", 8),
      "opponent-right": { name: "Chomp", species: "Garchomp", ability: "Rough Skin" }, "opponent-left": lax("LaxD", 24, { move: "Body Slam", target: "own-left" }),
    },
    bench: { own: [lax("Next", 32)], opponent: [lax("LaxE", 48)] },
  },
  // G-Max Steelsurge and a layer of Spikes (Sword/Shield) on a Fairy-type newcomer.
  {
    id: "R-STEELSURGE", game: "swsh", hazards: { own: { steelsurge: true, spikes: 1 } },
    slots: {
      "own-left": { name: "Liep", species: "Liepard", ability: "Limber", move: "U-turn", target: "opponent-right", evs: { spe: 252 } },
      "own-right": lax("LaxA", 8),
      "opponent-right": lax("LaxB", 16), "opponent-left": lax("LaxD", 24),
    },
    bench: { own: [{ name: "Clef", species: "Clefable", ability: "Cute Charm" }], opponent: [lax("LaxE", 48)] },
  },
  // Roar drags into Stealth Rock: Charizard or Snorlax at 1/2 each.
  {
    id: "R-ROAR-ROCKS", game: "sv", hazards: { opponent: { stealthRock: true } },
    slots: {
      "own-left": { name: "Arca", species: "Arcanine", ability: "Intimidate", move: "Roar", target: "opponent-right" },
      "own-right": lax("LaxA", 8),
      "opponent-right": lax("LaxB", 16), "opponent-left": lax("LaxD", 24),
    },
    bench: { own: [lax("Next", 32)], opponent: [{ name: "Zard", species: "Charizard", ability: "Blaze" }, lax("LaxE", 48)] },
  },
  // A Wish from the last turn lands on the U-turn user's position: the newcomer takes it.
  {
    id: "R-WISH", game: "sv",
    slots: {
      "own-left": ambi(), "own-right": lax("LaxA", 8),
      "opponent-right": lax("LaxB", 16), "opponent-left": lax("LaxD", 24),
    },
    bench: { own: [lax("Hurt", 32, { hp: 60 })], opponent: [lax("LaxE", 48)] },
    wishes: [{ slot: "own-left", source: "own-right" }],
  },
];
