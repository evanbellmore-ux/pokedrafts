// R-E's probe specs (oracle.ts): the switch family against pinned Showdown, guards.md §5.4's G4-SWX-01…11 and B1–B13 shapes.
import type { SMon, Spec } from "./oracle";

const lax = (name: string, spe = 0, extra: Partial<SMon> = {}): SMon => ({ name, species: "Snorlax", ability: "Thick Fat", evs: { spe }, ...extra });

export const PROBES: Spec[] = [
  // G4-SWX-01 / B2: U-turn into an Intimidate replacement; a later foe move meets the newcomer.
  {
    id: "SWX-01", game: "sv",
    slots: {
      "own-left": { name: "Rilla", species: "Rillaboom", ability: "Overgrow", move: "U-turn", target: "opponent-right", evs: { spe: 252 } },
      "own-right": lax("LaxA", 8),
      "opponent-right": { name: "Chomp", species: "Garchomp", ability: "Rough Skin", move: "Dragon Claw", target: "own-left" },
      "opponent-left": lax("LaxB", 16),
    },
    bench: { own: [{ name: "Incin", species: "Incineroar", ability: "Intimidate" }], opponent: [lax("LaxC", 24)] },
  },
  // G4-SWX-03 / B3: Stealth Rock on the replacement mid-turn.
  {
    id: "SWX-03", game: "sv", hazards: { own: { stealthRock: true } },
    slots: {
      "own-left": { name: "Rilla", species: "Rillaboom", ability: "Overgrow", move: "U-turn", target: "opponent-right", evs: { spe: 252 } },
      "own-right": lax("LaxA", 8),
      "opponent-right": lax("LaxB", 16, { move: "Body Slam", target: "own-left" }),
      "opponent-left": { name: "Tork", species: "Torkoal", ability: "Shell Armor" },
    },
    bench: { own: [{ name: "Zard", species: "Charizard", ability: "Blaze" }], opponent: [lax("LaxC", 24)] },
  },
  // Spikes, Toxic Spikes (2) and Sticky Web on a grounded newcomer.
  {
    id: "R-HZD-1", game: "sv", hazards: { own: { spikes: 3, toxicSpikes: 2, stickyWeb: true } },
    slots: {
      "own-left": { name: "Rilla", species: "Rillaboom", ability: "Overgrow", move: "U-turn", target: "opponent-right", evs: { spe: 252 } },
      "own-right": lax("LaxA", 8),
      "opponent-right": lax("LaxB", 16, { move: "Body Slam", target: "own-left" }),
      "opponent-left": { name: "Tork", species: "Torkoal", ability: "Shell Armor" },
    },
    bench: { own: [{ name: "Dozo", species: "Dondozo", ability: "Unaware" }], opponent: [lax("LaxC", 24)] },
  },
  // G4-SWX-04 / B5 (Sword/Shield): Roar with two bench Pokémon (uniform), a later move into the dragged slot.
  {
    id: "SWX-04", game: "swsh",
    slots: {
      "own-left": { name: "Arca", species: "Arcanine", ability: "Justified", move: "Roar", target: "opponent-left", evs: { spe: 252 } },
      "own-right": lax("LaxA", 8, { move: "Body Slam", target: "opponent-left" }),
      "opponent-right": lax("LaxB", 16),
      "opponent-left": { name: "Tork", species: "Torkoal", ability: "Shell Armor" },
    },
    bench: { own: [lax("LaxC", 24)], opponent: [lax("BenchA", 32), { name: "BenchB", species: "Blissey", ability: "Natural Cure" }] },
  },
  // G4-SWX-07 / B6: Regenerator on the leaver (U-turn at 80 HP), a full paralysis branch.
  {
    id: "SWX-07", game: "sv",
    slots: {
      "own-left": { name: "Torn", species: "Tornadus-Therian", ability: "Regenerator", move: "U-turn", target: "opponent-right", evs: { spe: 252 }, hp: 80, status: "par" },
      "own-right": lax("LaxA", 8),
      "opponent-right": lax("LaxB", 16),
      "opponent-left": { name: "Tork", species: "Torkoal", ability: "Shell Armor" },
    },
    bench: { own: [lax("Bench", 24)], opponent: [lax("LaxC", 32)] },
  },
  // G4-SWX-08 / B8 (Champions): U-turn into an Eject Button holder: the holder switches, the U-turn user stays.
  {
    id: "SWX-08", game: "champions",
    slots: {
      "own-left": { name: "Rilla", species: "Rillaboom", ability: "Overgrow", move: "U-turn", target: "opponent-right", evs: { spe: 32 } },
      "own-right": lax("LaxA", 1),
      "opponent-right": lax("Holder", 2, { item: "Eject Button" }),
      "opponent-left": { name: "Tork", species: "Torkoal", ability: "Shell Armor", move: "Body Slam", target: "own-left" },
    },
    bench: { own: [lax("LaxC", 3)], opponent: [lax("Bench", 4)] },
  },
  // G4-SWX-11 / B9: Red Card drags the attacker's side's bench at random; a later move meets the dragged-in Pokémon.
  {
    id: "SWX-11", game: "sv",
    slots: {
      "own-left": { name: "Chomp", species: "Garchomp", ability: "Rough Skin", move: "Dragon Claw", target: "opponent-right", evs: { spe: 252 } },
      "own-right": lax("LaxA", 8),
      "opponent-right": lax("Holder", 16, { item: "Red Card" }),
      "opponent-left": { name: "Tork", species: "Torkoal", ability: "Shell Armor", move: "Body Slam", target: "own-left" },
    },
    bench: { own: [lax("BenchA", 24), { name: "BenchB", species: "Blissey", ability: "Natural Cure" }], opponent: [lax("LaxC", 32)] },
  },
  // G4-SWX-10 (Champions): Golisopod's Emergency Exit with a later action into its slot.
  {
    id: "SWX-10", game: "champions",
    slots: {
      "own-left": { name: "Chomp", species: "Garchomp", ability: "Rough Skin", move: "Dragon Claw", target: "opponent-right", evs: { atk: 32, spe: 32 } },
      "own-right": lax("LaxA", 1, { move: "Body Slam", target: "opponent-right" }),
      "opponent-right": { name: "Goli", species: "Golisopod", ability: "Emergency Exit", hp: 80 },
      "opponent-left": { name: "Tork", species: "Torkoal", ability: "Shell Armor" },
    },
    bench: { own: [lax("LaxC", 3)], opponent: [lax("Bench", 4)] },
  },
  // G4-SWX-02 (Champions): Parting Shot with a chosen replacement and a later foe move into it.
  {
    id: "SWX-02", game: "champions", replacement: { "own-left": "Second" },
    slots: {
      "own-left": { name: "Incin", species: "Incineroar", ability: "Blaze", move: "Parting Shot", target: "opponent-right", evs: { spe: 32 } },
      "own-right": lax("LaxA", 1),
      "opponent-right": { name: "Chomp", species: "Garchomp", ability: "Rough Skin", move: "Dragon Claw", target: "own-left" },
      "opponent-left": lax("LaxB", 2),
    },
    bench: { own: [lax("First", 3), { name: "Second", species: "Corviknight", ability: "Pressure" }], opponent: [lax("LaxC", 4)] },
  },
  // G4-SWX-05 / B1: one Icy Wind drops two Eject Pack holders: the first switches, the second at the newcomer's SwitchIn.
  {
    id: "SWX-05", game: "sv",
    slots: {
      "own-left": { name: "Glalie", species: "Glalie", ability: "Inner Focus", move: "Icy Wind", evs: { spe: 252 } },
      "own-right": { name: "Saur", species: "Venusaur", ability: "Overgrow", move: "Tackle", target: "opponent-right" },
      "opponent-right": lax("PackA", 0, { item: "Eject Pack" }),
      "opponent-left": { name: "PackB", species: "Torkoal", ability: "Shell Armor", item: "Eject Pack" },
    },
    bench: { own: [lax("LaxC", 40)], opponent: [lax("BenchA", 8), lax("BenchB", 16)] },
  },
  // G4-SWX-06 / B7: U-turn into Drought: Chlorophyll's later order (gen 8+ re-sorts; USUM keeps the order).
  ...(["sv", "usum"] as const).map((game): Spec => ({
    id: `SWX-06-${game}`, game,
    slots: {
      "own-left": { name: "Jolt", species: "Jolteon", ability: "Volt Absorb", move: "Volt Switch", target: "opponent-left", evs: { spe: 252 } },
      "own-right": { name: "Saur", species: "Venusaur", ability: "Chlorophyll", move: "Tackle", target: "opponent-right", hp: 20 },
      "opponent-right": { name: "Chomp", species: "Garchomp", ability: "Rough Skin", move: "Dragon Claw", target: "own-right" },
      "opponent-left": lax("LaxB", 8),
    },
    bench: { own: [{ name: "Drought", species: "Torkoal", ability: "Drought" }], opponent: [lax("LaxC", 16)] },
  })),
  // G4-SWX-09 / B4a: Baton Pass with +2 Attack (the stages passed), a later hit into the newcomer.
  {
    id: "SWX-09", game: "sv",
    slots: {
      "own-left": { name: "Esp", species: "Espathra", ability: "Speed Boost", move: "Baton Pass", evs: { spe: 252 }, boosts: { atk: 2, def: -1 } },
      "own-right": lax("LaxA", 8),
      "opponent-right": lax("LaxB", 16),
      "opponent-left": { name: "Tork", species: "Torkoal", ability: "Shell Armor", move: "Body Slam", target: "own-left" },
    },
    bench: { own: [lax("Bench", 24)], opponent: [lax("LaxC", 32)] },
  },
  // B4b: Shed Tail passes its Substitute; a later Tackle meets it.
  {
    id: "R-SHED", game: "sv",
    slots: {
      "own-left": { name: "Cycl", species: "Cyclizar", ability: "Regenerator", move: "Shed Tail", evs: { spe: 252 } },
      "own-right": lax("LaxA", 4),
      "opponent-right": lax("LaxB", 12),
      "opponent-left": { name: "Tork", species: "Torkoal", ability: "Shell Armor", move: "Body Slam", target: "own-left" },
    },
    bench: { own: [lax("Bench", 24)], opponent: [lax("LaxC", 32)] },
  },
  // Dragon Tail drags at random (two bench Pokémon); a later move meets the dragged-in one.
  {
    id: "R-DTAIL", game: "sv",
    slots: {
      "own-left": { name: "Chomp", species: "Garchomp", ability: "Rough Skin", move: "Dragon Tail", target: "opponent-right", evs: { spe: 252 } },
      "own-right": lax("LaxA", 8, { move: "Body Slam", target: "opponent-right" }),
      "opponent-right": lax("Target", 16),
      "opponent-left": { name: "Tork", species: "Torkoal", ability: "Shell Armor" },
    },
    bench: { own: [lax("LaxC", 24)], opponent: [lax("BenchA", 32, { hp: 150 }), { name: "BenchB", species: "Blissey", ability: "Natural Cure" }] },
  },
  // Teleport last (gen 8+): the newcomer's end of turn (its poison, Leftovers), hazards on the way in.
  {
    id: "R-TELE", game: "sv", hazards: { own: { stealthRock: true } },
    slots: {
      "own-left": { name: "Gard", species: "Gardevoir", ability: "Synchronize", move: "Teleport", evs: { spe: 252 } },
      "own-right": lax("LaxA", 8),
      "opponent-right": lax("LaxB", 16),
      "opponent-left": { name: "Tork", species: "Torkoal", ability: "Shell Armor" },
    },
    bench: { own: [lax("Bench", 24, { status: "psn", item: "Leftovers", hp: 150 })], opponent: [lax("LaxC", 32)] },
  },
  // Emergency Exit after the residual (burn to half): the switch after the turn with Stealth Rock on its newcomer.
  {
    id: "R-EE-RES", game: "swsh", hazards: { opponent: { stealthRock: true } },
    slots: {
      "own-left": lax("LaxA", 8),
      "own-right": lax("LaxD", 16),
      "opponent-right": { name: "Goli", species: "Golisopod", ability: "Emergency Exit", hp: 78, status: "brn" },
      "opponent-left": { name: "Tork", species: "Torkoal", ability: "Shell Armor" },
    },
    bench: { own: [lax("LaxC", 24)], opponent: [{ name: "Zard", species: "Charizard", ability: "Blaze" }] },
  },
  // Assist (USUM): the party's moves (the partner's and the bench's) at random, noassist ones left out.
  {
    id: "R-ASSIST", game: "usum",
    slots: {
      "own-left": { name: "Liep", species: "Liepard", ability: "Limber", move: "Assist", evs: { spe: 252 } },
      "own-right": lax("LaxA", 8, { move: "Body Slam", target: "opponent-left" }),
      "opponent-right": lax("LaxB", 16),
      "opponent-left": lax("LaxD", 24),
    },
    bench: { own: [{ name: "Arca", species: "Arcanine", ability: "Justified", moves: ["Flamethrower", "Protect", "Roar"] }, lax("LaxC", 32, { moves: ["Ice Beam"] })], opponent: [lax("LaxE", 40)] },
  },
];
