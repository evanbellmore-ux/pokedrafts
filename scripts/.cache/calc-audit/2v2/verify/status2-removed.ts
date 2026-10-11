// status2 (Track V1): the "not estimated" reasons this build removes (SPEC2 §2.4 Removed, ADDENDUM2 §2.4 Removed), each with
// its owner and wave, and the ones that stay. status2/build/changed-cases.ts lists the stored cases they reach; cases.ts
// drops a stored case's reason for the waves in the STATUS2_REEXPECT environment variable ("1a", "1a,1b"), which the
// integrator sets at that integration (compare.ts, gen-tests.ts), so the case is compared with its fresh oracle result.
export type Wave = "1a" | "1b" | "2" | "kept";
export type Removal = { re: RegExp; key: string; owner: string; wave: Wave };
const MOVES_A1 = "Skill Swap|Role Play|Entrainment|Simple Beam|Worry Seed|Gastro Acid|Doodle|Transform|Acupressure|Psych Up|Heart Swap|Guard Swap|Power Swap|Speed Swap|Guard Split|Power Split|Power Trick|Power Shift|Topsy-Turvy|Stockpile|Swallow|Spit Up|Tidy Up|No Retreat|Autotomize|Minimize|Geomancy|Gear Up|Magnetic Flux|Flower Shield|Rototiller";
const MOVES_A2 = "Soak|Magic Powder|Forest's Curse|Trick-or-Treat|Reflect Type|Conversion|Conversion 2|Camouflage|Electrify|Ion Deluge|Tar Shot|Foresight|Odor Sleuth|Miracle Eye|Telekinesis|Embargo|Heal Block|Nightmare|Octolock|Attract|Captivate|Powder";
const MOVES_A3 = "Magic Coat|Snatch|Crafty Shield|Mat Block|Lucky Chant|Mist|Court Change|Defog|Magic Room|Wonder Room|Mud Sport|Water Sport|Corrosive Gas|Bestow|Recycle|Teatime|Stuff Cheeks|Aromatherapy|Heal Bell|Purify|Psycho Shift";
/** The removed reasons (SPEC2 §2.4 Removed, ADDENDUM2 §2.4 Removed) and the ones that stay (for the report). */
export const REMOVED: Removal[] = [
  { re: new RegExp(`^(${MOVES_A1}) is not modelled( and comes before another move)?\\.$`), key: "notModelled / notModelledBefore (L move)", owner: "A1", wave: "1a" },
  { re: new RegExp(`^(${MOVES_A2}) is not modelled( and comes before another move)?\\.$`), key: "notModelled / notModelledBefore (L move)", owner: "A2", wave: "1a" },
  { re: new RegExp(`^(${MOVES_A3}) is not modelled( and comes before another move)?\\.$`), key: "notModelled / notModelledBefore (L move)", owner: "A3", wave: "1a" },
  { re: / changes .*'s type: later moves are not modelled\.$/, key: "typeChange", owner: "A2", wave: "1a" },
  { re: / changes whether .* is grounded: later moves are not modelled\.$/, key: "groundingChange", owner: "A2", wave: "1a" },
  { re: /^Psychic Noise is not modelled in 2v2\.$/, key: "notIn2v2(Psychic Noise)", owner: "A2", wave: "1a" },
  { re: / copying a stat rise is not modelled in 2v2\.$/, key: "copiesRise", owner: "D", wave: "1a" },
  { re: / with .*'s accuracy or evasion stage from this turn is not modelled in 2v2\.$/, key: "hiddenStages", owner: "D", wave: "1a" },
  { re: / heals from more than one target: not modelled\.$/, key: "spreadHeal", owner: "D", wave: "1a" },
  { re: / after a confusion self-hit with (Berserk|Anger Shell) is not modelled in 2v2\.$/, key: "berryLocked", owner: "D", wave: "1a" },
  { re: / held by (Berserk|Anger Shell) after a Sheer Force hit is not modelled in 2v2\.$/, key: "berryLockedSheerForce", owner: "D", wave: "1a" },
  { re: / doubles the damage .* takes: later moves are not modelled\.$/, key: "takesDouble", owner: "D", wave: "1a" },
  { re: /^Encore changes .*'s move: not modelled\.$/, key: "encoreChange", owner: "D", wave: "1a" },
  { re: /^One-hit KO move: no damage range\.$/, key: "the 2v2 row's one-hit KO text", owner: "D", wave: "1a" },
  { re: /^Starf Berry raises a random stat/, key: "starf-random", owner: "D", wave: "1a" },
  // SPEC2 §2 item 2 and the Symbiosis enabler (F4 §6, Fling's E6): no stored case has it; G4-FLG-09 expects it gone.
  { re: /^Symbiosis is not modelled in 2v2\.$/, key: "notIn2v2(Symbiosis)", owner: "D", wave: "1a" },
  { re: /^Fling is not verified for this game\.$/, key: "the 2v2 row's Fling text", owner: "F", wave: "1a" },
  { re: /^(Harvest|Pickup) is not modelled in 2v2\.$/, key: "notIn2v2(Harvest / Pickup)", owner: "E1", wave: "1a" },
  { re: /^(Magic Room|Corrosive Gas|Bestow|Embargo) with Neutralizing Gas is not modelled in 2v2\.$/, key: "withGas (GAS_CHANGING_MOVES)", owner: "integrator", wave: "1a" },
  { re: / is semi-invulnerable after .*: later moves are not modelled\.$/, key: "semiInvulnerable", owner: "H", wave: "1a" },
  { re: / against a (confusion self-hit|multi-hit move) is not modelled in 2v2\.$/, key: "faceSelfHit / faceMultiHit", owner: "S", wave: "1a" },
  { re: /^(Max Moves|Magician|Mind Blown|Parental Bond|.* Z-Move) into a Substitute is not modelled in 2v2\.$/, key: "intoSubstitute", owner: "S", wave: "1a" },
  { re: /^(?!Triple Axel|Triple Kick).* into .*'s Substitute with (?!Parental Bond).* is not modelled in 2v2\.$/, key: "subPerHit", owner: "S", wave: "1a" },
  { re: / between the hits of .* is not modelled in 2v2\.$/, key: "berryBetweenHits", owner: "W", wave: "1a" },
  { re: /^Focus Band is not modelled\.$/, key: "focusBand", owner: "W", wave: "1a" },
  { re: /^Sparkling Aria's burn cure after .* faints in the move is not modelled in 2v2\.$/, key: "ariaFaint", owner: "W", wave: "1a" },
  { re: / against an ally's move is not modelled\.$/, key: "allyEffect", owner: "W", wave: "1a" },
  { re: /^(Gale Wings|Assurance|Safeguard|Helping Hand) is not modelled in 2v2\.$/, key: "notIn2v2 (W's entries)", owner: "W", wave: "1a" },
  { re: /^(Electric Seed|Grassy Seed|Misty Seed|Psychic Seed|Room Service) received by .* is not modelled in 2v2\.$/, key: "received (Seeds, Room Service)", owner: "A3", wave: "1a" },
  { re: /^(Lightning Rod|Storm Drain|Follow Me|Rage Powder|Spotlight) is not modelled in 2v2\.$/, key: "the redirect tie (needsEntryOrder)", owner: "N", wave: "1a" },
  // wave 1b
  { re: /^(Copycat|Me First|Mirror Move|Instruct|Nature Power|Sleep Talk|Uproar) is not modelled in 2v2\.$/, key: "presence-calling", owner: "CL", wave: "1b" },
  { re: / with (Fire|Grass|Water) Pledge is not modelled in 2v2\.$|^(Flame Burst|Round|Beak Blast|Shell Trap|Beat Up|Fusion Bolt|Fusion Flare|Counter|Mirror Coat|Metal Burst|Comeuppance|Spotlight|Commander|Dancer|Poison Puppeteer) is not modelled in 2v2\.$/, key: "presence", owner: "PR", wave: "1b" },
  { re: /^Pain Split with a Dynamaxed Pokémon is not modelled in 2v2\.$|^Max Guard is not modelled\.$|'s random status is not modelled in 2v2\.$/, key: "max", owner: "M", wave: "1b" },
  { re: /^(Unnerve|As One \(.*\)|Cotton Down|Flower Veil|Pastel Veil|Battle Bond|Aftermath|Innards Out|Receiver|Power of Alchemy|Core Enforcer) is not modelled in 2v2\.$/, key: "reactions", owner: "K", wave: "1b" },
  { re: /^A weather or terrain change this turn would change .*\.$| would activate .*\.$/, key: "fieldChange / activates", owner: "FC", wave: "1b" },
  { re: /^(Cud Chew is not modelled in 2v2|.* landing is not modelled in 2v2|.*'s damage over time is not modelled in 2v2|Zen Mode changing .*|Moody .*)\.$/, key: "the end of turn (E2)", owner: "E2", wave: "1b" },
  // Integration 1a's stopgap for a field effect the input says ends this turn (fieldTurns 1: int1a/eot-fieldturns.py), E2's in 1b.
  { re: /^(Magic Room|Gravity|(Electric|Grassy|Misty|Psychic) Terrain) ending is not modelled in 2v2\.$/, key: "the field's end (fieldTurns, E2)", owner: "E2", wave: "1b" },
  // kept
  // status2 wave 2 (Track R-V): with a bench in the input the switch is modelled (cases-r.ts); a stored case gives no bench,
  // so its reason stays (sideCanSwitch: no bench is today's canSwitch), and STATUS2_REEXPECT's "2" drops nothing.
  { re: / switches out: the replacement is not known\.$/, key: "switchesOut (kept without a bench)", owner: "R", wave: "kept" },
  { re: /^Neutralizing Gas ending is not modelled in 2v2\.$|^An Ability Shield change under Neutralizing Gas is not modelled in 2v2\.$| with Neutralizing Gas is not modelled in 2v2\.$/, key: "gasEnds / gasShield / withGas (Q5)", owner: "—", wave: "kept" },
  { re: /^Dragon Darts aimed where its user now stands is not modelled in 2v2\.$|needs .*'s moves\.$|needs .*'s move from the last turn\.$|^Status Z-Moves are not calculated\.$/, key: "kept (dartsAimSelf, needsMoves, needsLastMove, the Z status row)", owner: "—", wave: "kept" },
];
export const removalOf = (text: string) => REMOVED.find((r) => r.re.test(text)) ?? null;

/**
 * A stored case whose removed reason becomes another reason, not an estimate (the input it lacks): its new expectation.
 * ER41c's Exeggutor holds nothing and its item from an earlier turn is not given (SPEC2 §2.4 needsLastItem).
 */
export const REEXPECT_TO: Record<string, { notEstimated?: string; endNotEstimated?: string }> = {
  ER41c: { endNotEstimated: "Harvest needs Exeggutor's item from an earlier turn." },
  // Integration 1a (SPEC2 §8.4): Magic Room left GAS_CHANGING_MOVES; gasShieldGuard follows the Shield it switches off.
  VG39: { notEstimated: "An Ability Shield change under Neutralizing Gas is not modelled in 2v2." },
  // Wave 1b (Track V2, ADDENDUM2 §2.4): a bare `cudChew: true` and a bare landing id keep a narrow input reason (C33).
  ER41d: { endNotEstimated: "Cud Chew needs Farigiraf's Berry from the last turn." },
  ER41e: { endNotEstimated: "Future Sight landing needs its user." },
  // CL: Sleep Talk with its user's moves not given keeps needsMoves (ADDENDUM2 §2.4, the generalised Imprison text).
  F14a: { notEstimated: "Sleep Talk needs Snorlax's moves." },
  F14c: { notEstimated: "Sleep Talk needs Komala's moves." },
  S47b: { notEstimated: "Sleep Talk needs Snorlax's moves." },
};
