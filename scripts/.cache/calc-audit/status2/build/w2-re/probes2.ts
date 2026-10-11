// R-E's second probe batch: the entry's chains and reactions, identity, the leaver's End, the items' rules.
import type { SMon, Spec } from "./oracle";

const lax = (name: string, spe = 0, extra: Partial<SMon> = {}): SMon => ({ name, species: "Snorlax", ability: "Thick Fat", evs: { spe }, ...extra });
const ambi = (extra: Partial<SMon> = {}): SMon => ({ name: "Ambi", species: "Ambipom", ability: "Technician", move: "U-turn", target: "opponent-right", evs: { spe: 252 }, ...extra });

export const PROBES2: Spec[] = [
  // An Intimidate newcomer sets off a foe's Eject Pack at its SwitchIn (−4): the foe switches too; a Defiant foe +2.
  {
    id: "R-INTIM-PACK", game: "sv",
    slots: {
      "own-left": ambi(), "own-right": lax("LaxA", 8),
      "opponent-right": lax("Pack", 16, { item: "Eject Pack" }),
      "opponent-left": { name: "Gambit", species: "Kingambit", ability: "Defiant", move: "Iron Head", target: "own-left" },
    },
    bench: { own: [{ name: "Incin", species: "Incineroar", ability: "Intimidate" }], opponent: [lax("LaxB", 24)] },
  },
  // Sticky Web on a newcomer holding an Eject Pack: it switches out again at its own SwitchIn (B1's chain).
  {
    id: "R-WEB-PACK", game: "sv", hazards: { own: { stickyWeb: true, stealthRock: true } },
    slots: {
      "own-left": ambi(), "own-right": lax("LaxA", 8),
      "opponent-right": lax("LaxB", 16, { move: "Body Slam", target: "own-left" }),
      "opponent-left": lax("LaxD", 24),
    },
    bench: { own: [lax("Pack", 32, { item: "Eject Pack" }), lax("Next", 40)], opponent: [lax("LaxE", 48)] },
  },
  // Heavy-Duty Boots and Levitate: the hazards a newcomer meets (Spikes and Toxic Spikes need the ground; Stealth Rock not).
  ...[{ name: "Boots", species: "Snorlax", ability: "Thick Fat", item: "Heavy-Duty Boots" }, { name: "Lev", species: "Bronzong", ability: "Levitate", evs: { spe: 4 } }, { name: "Guard", species: "Clefable", ability: "Magic Guard" }].map((newcomer): Spec => ({
    id: `R-HZD-${newcomer.name}`, game: "sv", hazards: { own: { stealthRock: true, spikes: 2, toxicSpikes: 1 } },
    slots: { "own-left": ambi(), "own-right": lax("LaxA", 8), "opponent-right": lax("LaxB", 16, { move: "Body Slam", target: "own-left" }), "opponent-left": lax("LaxD", 24) },
    bench: { own: [newcomer as SMon], opponent: [lax("LaxE", 48)] },
  })),
  // Toxic Spikes taken away by a grounded Poison newcomer; the second switch of the side (Eject Button) meets none.
  {
    id: "R-TSPIKES-POISON", game: "sv", hazards: { own: { toxicSpikes: 2 } },
    slots: {
      "own-left": ambi(), "own-right": lax("Button", 8, { item: "Eject Button" }),
      "opponent-right": lax("LaxB", 16),
      "opponent-left": lax("LaxD", 24, { move: "Body Slam", target: "own-right" }),
    },
    bench: { own: [{ name: "Goo", species: "Amoonguss", ability: "Regenerator" }, lax("Next", 40)], opponent: [lax("LaxE", 48)] },
  },
  // The leaver's Unnerve ends: the foe's Sitrus Berry at the Update after the switch (Corviknight U-turns out).
  {
    id: "R-UNNERVE", game: "sv",
    slots: {
      "own-left": { name: "Corv", species: "Corviknight", ability: "Unnerve", move: "U-turn", target: "opponent-right", evs: { spe: 252 } },
      "own-right": lax("LaxA", 8),
      "opponent-right": lax("Sitrus", 16, { item: "Sitrus Berry", hp: 125 }),
      "opponent-left": lax("LaxD", 24),
    },
    bench: { own: [lax("Next", 32)], opponent: [lax("LaxE", 48)] },
  },
  // Leech Seed: the seeder U-turns out; the seeded foe's drain at the end of turn heals the newcomer at the seeder's position.
  {
    id: "R-SEED", game: "sv",
    slots: {
      "own-left": ambi(), "own-right": lax("LaxA", 8),
      "opponent-right": lax("Seeded", 16),
      "opponent-left": lax("LaxD", 24),
    },
    bench: { own: [lax("Hurt", 32, { hp: 100 })], opponent: [lax("LaxE", 48)] },
    seeds: [{ target: "opponent-right", source: "own-left" }],
  },
  // Protosynthesis newcomer in sun (its best stat), and Booster Energy with the field down.
  {
    id: "R-PARADOX", game: "sv", field: { weather: "SunnyDay" },
    slots: {
      "own-left": ambi(), "own-right": lax("LaxA", 8),
      "opponent-right": lax("LaxB", 16), "opponent-left": lax("LaxD", 24, { move: "Body Slam", target: "own-left" }),
    },
    bench: { own: [{ name: "Flutter", species: "Flutter Mane", ability: "Protosynthesis" }], opponent: [lax("LaxE", 48)] },
  },
  {
    id: "R-BOOSTER", game: "sv",
    slots: {
      "own-left": ambi(), "own-right": lax("LaxA", 8),
      "opponent-right": lax("LaxB", 16), "opponent-left": lax("LaxD", 24, { move: "Body Slam", target: "own-left" }),
    },
    bench: { own: [{ name: "Flutter", species: "Flutter Mane", ability: "Protosynthesis", item: "Booster Energy" }], opponent: [lax("LaxE", 48)] },
  },
  // Hospitality newcomer heals its partner; Trace newcomer copies a foe's ability at random.
  {
    id: "R-HOSPITALITY", game: "sv",
    slots: {
      "own-left": ambi(), "own-right": lax("Hurt", 8, { hp: 100 }),
      "opponent-right": lax("LaxB", 16), "opponent-left": lax("LaxD", 24),
    },
    bench: { own: [{ name: "Sini", species: "Sinistcha", ability: "Hospitality" }], opponent: [lax("LaxE", 48)] },
  },
  {
    id: "R-TRACE", game: "sv",
    slots: {
      "own-left": ambi(), "own-right": lax("LaxA", 8),
      "opponent-right": { name: "Chomp", species: "Garchomp", ability: "Rough Skin" }, "opponent-left": { name: "Gambit", species: "Kingambit", ability: "Defiant", move: "Iron Head", target: "own-left" },
    },
    bench: { own: [{ name: "Gard", species: "Gardevoir", ability: "Trace" }], opponent: [lax("LaxE", 48)] },
  },
  // The U-turn user faints to Rough Skin: no switch.
  {
    id: "R-UTURN-FAINT", game: "sv",
    slots: {
      "own-left": ambi({ hp: 10, target: "opponent-right" }), "own-right": lax("LaxA", 8),
      "opponent-right": { name: "Chomp", species: "Garchomp", ability: "Rough Skin" }, "opponent-left": lax("LaxD", 24),
    },
    bench: { own: [lax("Next", 32)], opponent: [lax("LaxE", 48)] },
  },
  // Dragon Tail into Suction Cups (no drag); Red Card on an Ingrain attacker (the card used, no drag).
  {
    id: "R-DTAIL-CUPS", game: "sv",
    slots: {
      "own-left": { name: "Chomp", species: "Garchomp", ability: "Rough Skin", move: "Dragon Tail", target: "opponent-right", evs: { spe: 252 } },
      "own-right": lax("LaxA", 8),
      "opponent-right": { name: "Mabo", species: "Mabosstiff", ability: "Guard Dog" }, "opponent-left": lax("LaxD", 24),
    },
    bench: { own: [lax("Next", 32)], opponent: [lax("LaxE", 48), lax("LaxF", 56)] },
  },
  // Eject Button and Dragon Tail on the same holder: the drag only, the Button kept.
  {
    id: "R-DTAIL-BUTTON", game: "sv",
    slots: {
      "own-left": { name: "Chomp", species: "Garchomp", ability: "Rough Skin", move: "Dragon Tail", target: "opponent-right", evs: { spe: 252 } },
      "own-right": lax("LaxA", 8),
      "opponent-right": lax("Button", 16, { item: "Eject Button" }), "opponent-left": lax("LaxD", 24, { move: "Body Slam", target: "opponent-right" }),
    },
    bench: { own: [lax("Next", 32)], opponent: [lax("LaxE", 48), lax("LaxF", 56)] },
  },
  // Parting Shot into a Clear Body target: nothing fell, no switch; into Mirror Armor: the switch.
  ...[{ name: "Meta", species: "Metagross", ability: "Clear Body" }, { name: "Corv", species: "Corviknight", ability: "Mirror Armor" }].map((target): Spec => ({
    id: `R-PSHOT-${target.name}`, game: "sv",
    slots: {
      "own-left": { name: "Grim", species: "Grimmsnarl", ability: "Frisk", move: "Parting Shot", target: "opponent-right", evs: { spe: 252 } },
      "own-right": lax("LaxA", 8),
      "opponent-right": target as SMon, "opponent-left": lax("LaxD", 24, { move: "Body Slam", target: "own-left" }),
    },
    bench: { own: [lax("Next", 32)], opponent: [lax("LaxE", 48)] },
  })),
  // Emergency Exit chain (Sword/Shield): Stealth Rock takes the newcomer Golisopod from above half to half: it leaves again.
  {
    id: "R-EE-CHAIN", game: "swsh", hazards: { opponent: { stealthRock: true } },
    slots: {
      "own-left": { name: "Liep", species: "Liepard", ability: "Limber", move: "U-turn", target: "opponent-right", evs: { spe: 252 } },
      "own-right": lax("LaxA", 8),
      "opponent-right": { name: "Goli", species: "Golisopod", ability: "Emergency Exit", hp: 80 },
      "opponent-left": lax("LaxD", 24, { move: "Body Slam", target: "own-left" }),
    },
    bench: { own: [lax("Next", 32)], opponent: [{ name: "Goli2", species: "Golisopod", ability: "Emergency Exit", hp: 88 }, lax("LaxE", 48)] },
  },
  // Palafin's Flip Turn: Zero to Hero's form as it leaves (its benched build); a later move meets the newcomer.
  {
    id: "R-HERO", game: "sv",
    slots: {
      "own-left": { name: "Pala", species: "Palafin", ability: "Zero to Hero", move: "Flip Turn", target: "opponent-right", evs: { spe: 252 } },
      "own-right": lax("LaxA", 8),
      "opponent-right": lax("LaxB", 16), "opponent-left": lax("LaxD", 24, { move: "Body Slam", target: "own-left" }),
    },
    bench: { own: [lax("Next", 32)], opponent: [lax("LaxE", 48)] },
  },
  // Baton Pass with a Substitute and confusion from earlier turns, and Leech Seed: the newcomer keeps them.
  {
    id: "R-BPASS-VOL", game: "sv",
    slots: {
      "own-left": { name: "Esp", species: "Espathra", ability: "Speed Boost", move: "Baton Pass", evs: { spe: 252 } },
      "own-right": lax("LaxA", 8),
      "opponent-right": lax("LaxB", 16, { move: "Body Slam", target: "own-left" }), "opponent-left": lax("LaxD", 24),
    },
    bench: { own: [lax("Next", 32)], opponent: [lax("LaxE", 48)] },
    seeds: [{ target: "own-left", source: "opponent-left" }], substitutes: [{ slot: "own-left", hp: 30 }],
  },
  // Volt Switch with the opponent's bench empty side and an Air Balloon newcomer meeting Spikes (Air Balloon floats it).
  {
    id: "R-BALLOON", game: "sv", hazards: { own: { spikes: 3 } },
    slots: {
      "own-left": ambi(), "own-right": lax("LaxA", 8),
      "opponent-right": lax("LaxB", 16), "opponent-left": { name: "Chomp", species: "Garchomp", ability: "Rough Skin", move: "Earthquake" },
    },
    bench: { own: [lax("Balloon", 32, { item: "Air Balloon" })], opponent: [lax("LaxE", 48)] },
  },
];
