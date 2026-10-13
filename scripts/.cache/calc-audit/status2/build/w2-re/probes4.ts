// R-E's fourth probe batch (status2 wave 2, the finish): Pursuit by a Technician user at a switching target (80 power:
// no Technician), Red Card against a Life Orb user (forceSwitchFlag: no Life Orb loss), a Sheer Force move into a Red Card
// and an Eject Button holder (afterMoveSecondaryEvent skipped: neither acts), Eject Button against a Life Orb U-turn.
// Run: npx --no-install tsx scripts/.cache/calc-audit/status2/build/w2-re/run-probes4.ts [ids...]
import type { SMon, Spec } from "./oracle";

const lax = (name: string, spe = 0, extra: Partial<SMon> = {}): SMon => ({ name, species: "Snorlax", ability: "Thick Fat", evs: { spe }, ...extra });
const ambi = (extra: Partial<SMon> = {}): SMon => ({ name: "Ambi", species: "Ambipom", ability: "Pickup", move: "U-turn", target: "opponent-right", evs: { spe: 252 }, ...extra });

export const PROBES4: Spec[] = [
  // Pursuit (USUM) by a Technician Scizor at the U-turn user's BeforeSwitchOut: basePowerCallback 80, so Technician (60 or
  // less) does not boost it.
  {
    id: "R4-PURSUIT-TECH", game: "usum",
    slots: {
      "own-left": ambi(), "own-right": lax("LaxA", 8),
      "opponent-right": lax("LaxB", 16), "opponent-left": { name: "Sciz", species: "Scizor", ability: "Technician", move: "Pursuit", target: "own-left" },
    },
    bench: { own: [lax("Next", 32)], opponent: [lax("LaxE", 48)] },
  },
  // Pursuit (USUM) by a Technician Scizor at a target that does not switch: 40 power, Technician ×1.5.
  {
    id: "R4-PURSUIT-TECH-STAY", game: "usum",
    slots: {
      "own-left": lax("Stay", 4), "own-right": lax("LaxA", 8),
      "opponent-right": lax("LaxB", 16), "opponent-left": { name: "Sciz", species: "Scizor", ability: "Technician", move: "Pursuit", target: "own-left" },
    },
    bench: { own: [lax("Next", 32)], opponent: [lax("LaxE", 48)] },
  },
  // Red Card against a Life Orb attacker: the card's forceSwitchFlag comes first (AfterMoveSecondary), so Life Orb
  // (AfterMoveSecondarySelf, !source.forceSwitchFlag) takes nothing; the attacker is dragged out after its move.
  {
    id: "R4-REDCARD-LIFEORB", game: "sv",
    slots: {
      "own-left": { name: "Chomp", species: "Garchomp", ability: "Rough Skin", item: "Life Orb", move: "Dragon Claw", target: "opponent-right", evs: { spe: 252 } },
      "own-right": lax("LaxA", 8),
      "opponent-right": lax("Card", 16, { item: "Red Card" }), "opponent-left": lax("LaxD", 24),
    },
    bench: { own: [lax("Next", 32)], opponent: [lax("LaxE", 48)] },
  },
  // A Sheer Force move with a secondary into a Red Card holder: afterMoveSecondaryEvent does not run, so no drag.
  {
    id: "R4-REDCARD-SHEERFORCE", game: "sv",
    slots: {
      "own-left": { name: "Gator", species: "Feraligatr", ability: "Sheer Force", move: "Ice Beam", target: "opponent-right", evs: { spe: 252 } },
      "own-right": lax("LaxA", 8),
      "opponent-right": lax("Card", 16, { item: "Red Card" }), "opponent-left": lax("LaxD", 24, { move: "Body Slam", target: "own-left" }),
    },
    bench: { own: [lax("Next", 32)], opponent: [lax("LaxE", 48)] },
  },
  // A Sheer Force move with a secondary into an Eject Button holder: no switch; the later Body Slam is the holder's own.
  {
    id: "R4-EJECTBUTTON-SHEERFORCE", game: "sv",
    slots: {
      "own-left": { name: "Gator", species: "Feraligatr", ability: "Sheer Force", move: "Ice Beam", target: "opponent-right", evs: { spe: 252 } },
      "own-right": lax("LaxA", 8),
      "opponent-right": lax("Button", 16, { item: "Eject Button", move: "Body Slam", target: "own-left" }), "opponent-left": lax("LaxD", 24),
    },
    bench: { own: [lax("Next", 32)], opponent: [lax("LaxE", 48)] },
  },
  // A Life Orb U-turn into an Eject Button holder: the holder leaves, the U-turn user stays and takes its Life Orb loss.
  {
    id: "R4-EJECTBUTTON-LIFEORB", game: "sv",
    slots: {
      "own-left": ambi({ item: "Life Orb" }), "own-right": lax("LaxA", 8),
      "opponent-right": lax("Button", 16, { item: "Eject Button" }), "opponent-left": lax("LaxD", 24, { move: "Body Slam", target: "own-left" }),
    },
    bench: { own: [lax("Next", 32)], opponent: [lax("LaxE", 48)] },
  },
  // A U-turn into a Disguise holder with an Eject Button (a face's hit: damage 0 still runs afterMoveSecondaryEvent): the
  // holder leaves (its switchFlag `true`; the U-turn's is the move id, which Eject Button does not wait for), the U-turn user's
  // switch is cancelled (source.switchFlag = false, not in Champions).
  {
    id: "R4-FACE-EJECTBUTTON-UTURN", game: "sv",
    slots: {
      "own-left": ambi(), "own-right": lax("LaxA", 8),
      "opponent-right": { name: "Mimi", species: "Mimikyu", ability: "Disguise", item: "Eject Button" }, "opponent-left": lax("LaxD", 24, { move: "Body Slam", target: "own-left" }),
    },
    bench: { own: [lax("Next", 32)], opponent: [lax("LaxE", 48)] },
  },
  // Pursuit (USUM) at an Eject Button holder that used Destiny Bond earlier this turn: its BeforeSwitchOut removes the Destiny
  // Bond (pokemon.removeVolatile('destinybond')) before the Pursuit, which knocks it out without fainting its user.
  {
    id: "R4-PURSUIT-DESTINYBOND", game: "usum",
    slots: {
      "own-left": { name: "Gen", species: "Gengar", ability: "Cursed Body", item: "Eject Button", move: "Destiny Bond", evs: { spe: 252 } }, "own-right": lax("LaxA", 8),
      "opponent-right": lax("LaxB", 252, { move: "Crunch", target: "own-left" }), "opponent-left": { name: "Tar", species: "Tyranitar", ability: "Unnerve", move: "Pursuit", target: "own-right" },
    },
    bench: { own: [lax("Next", 32)], opponent: [lax("LaxE", 48)] },
  },
  // Leech Seed from earlier turns: the seeder U-turns out; the drain heals whoever stands at its position (sourceSlot): the newcomer.
  {
    id: "R4-SEED-SEEDER-LEAVES", game: "sv",
    slots: {
      "own-left": ambi(), "own-right": lax("LaxA", 8),
      "opponent-right": lax("LaxB", 16), "opponent-left": lax("LaxD", 24),
    },
    bench: { own: [lax("Hurt", 32, { hp: 60 })], opponent: [lax("LaxE", 48)] },
    seeds: [{ target: "opponent-right", source: "own-left" }],
  },
  // The seeded Pokémon U-turns out: its Leech Seed goes with it (a volatile); the newcomer is not drained.
  {
    id: "R4-SEED-SEEDED-LEAVES", game: "sv",
    slots: {
      "own-left": ambi(), "own-right": lax("LaxA", 8),
      "opponent-right": lax("LaxB", 16), "opponent-left": lax("LaxD", 24),
    },
    bench: { own: [lax("Hurt", 32, { hp: 60 })], opponent: [lax("LaxE", 48)] },
    seeds: [{ target: "own-left", source: "opponent-left" }],
  },
  // A foe's pending copy at the newcomer's SwitchIn (onAnySwitchIn −3): Sticky Web's drop sets off the newcomer's Defiant
  // (+2 Attack), which the foe's Mirror Herb copies; its later Body Slam at +2.
  {
    id: "R4-WEB-MIRRORHERB", game: "sv", hazards: { own: { stickyWeb: true } },
    slots: {
      "own-left": ambi(), "own-right": lax("LaxA", 8),
      "opponent-right": lax("LaxB", 16), "opponent-left": lax("LaxD", 24, { item: "Mirror Herb", move: "Body Slam", target: "own-left" }),
    },
    bench: { own: [{ name: "Gambit", species: "Kingambit", ability: "Defiant" }], opponent: [lax("LaxE", 48)] },
  },
  // U-turn into Disguise (0 damage, the face busted): the user switches all the same (moveHit's damage 0 is not a failure).
  {
    id: "R4-FACE-UTURN", game: "sv",
    slots: {
      "own-left": ambi(), "own-right": lax("LaxA", 8),
      "opponent-right": { name: "Mimi", species: "Mimikyu", ability: "Disguise" }, "opponent-left": lax("LaxD", 24, { move: "Body Slam", target: "own-left" }),
    },
    bench: { own: [lax("Next", 32)], opponent: [lax("LaxE", 48)] },
  },
  // A Sheer Force spread move (Rock Slide's flinch removed) into an Eject Button holder: no switch.
  {
    id: "R4-SF-SPREAD-EB", game: "sv",
    slots: {
      "own-left": { name: "Gator", species: "Feraligatr", ability: "Sheer Force", move: "Rock Slide", evs: { spe: 252 } }, "own-right": lax("LaxA", 8),
      "opponent-right": lax("Button", 16, { item: "Eject Button" }), "opponent-left": lax("LaxD", 24),
    },
    bench: { own: [lax("Next", 32)], opponent: [lax("LaxE", 48)] },
  },
];
