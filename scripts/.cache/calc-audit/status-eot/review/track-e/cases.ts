// Review cases (lens: Ally Switch, Trick/Switcheroo, hits into a Substitute). Showdown names; level 50, 31 IVs, Serious,
// 0 EVs unless set (cases-e.ts conventions).
import type { Case, CaseAction, CaseMon, SlotId } from "../../../2v2/verify/case-types";
import { chomp, clef, jolt, lax, saur, sm, toise, zard } from "../../../2v2/verify/cases-s";

type Slot = CaseMon & { action: CaseAction };
const mon = (species: string, ability: string, extra: Partial<CaseMon> = {}): CaseMon => ({ species, ability, ...extra });
const act = (m: CaseMon, move: string | null, target?: SlotId, context?: Record<string, unknown>): Slot =>
  ({ ...m, action: { move, ...(target ? { target } : {}), ...(context ? { context } : {}) } });
const idle = (m: CaseMon): Slot => act(m, null);
const empty = (m: CaseMon): Slot => ({ ...m, absent: true, action: { move: null } });
const slots = (ownLeft: Slot, ownRight: Slot, oppLeft: Slot, oppRight: Slot): Case["slots"] =>
  ({ "own-left": ownLeft, "own-right": ownRight, "opponent-left": oppLeft, "opponent-right": oppRight });
const OL: SlotId = "own-left", OR: SlotId = "own-right", PL: SlotId = "opponent-left", PR: SlotId = "opponent-right";
const reun = (extra: Partial<CaseMon> = {}) => mon("Reuniclus", "Magic Guard", extra);
const fastSm = (extra: Partial<CaseMon> = {}) => sm(252, { nature: "Jolly", ...extra });
const laxN = (spe: number, extra: Partial<CaseMon> = {}) => lax({ evs: { spe }, ...extra });
void empty; void jolt; void clef; void zard; void saur; void toise;

export const REVIEW_CASES: Case[] = [
  // ---- Substitute ----
  {
    id: "RE01", title: "Fissure into a Substitute larger than the holder's HP", game: "sv",
    slots: slots(act(chomp(), "Fissure", PL), idle(saur()), idle(lax({ hp: 30, substitute: 58 })), idle(toise())),
    checks: "OHKO damage is target.maxhp (battle-actions.ts:1606), capped at the Substitute: it breaks; Snorlax keeps 30.",
  },
  {
    id: "RE01b", title: "Sheer Cold into a full-HP Substitute holder", game: "sv",
    slots: slots(act(mon("Lapras", "Water Absorb"), "Sheer Cold", PL), idle(saur()), idle(lax({ substitute: 58 })), idle(toise())),
    checks: "OHKO into a Substitute breaks it.",
  },
  {
    id: "RE02", title: "Bullet Seed with Loaded Dice into a 50-HP Substitute", game: "sv",
    slots: slots(act(mon("Breloom", "Technician", { item: "Loaded Dice" }), "Bullet Seed", PL), idle(saur()), idle(lax({ substitute: 50 })), idle(toise())),
    checks: "4-5 hits; continuation into Snorlax.",
  },
  {
    id: "RE03", title: "Dragon Darts into a Substitute and the other foe", game: "sv",
    slots: slots(act(mon("Dragapult", "Clear Body"), "Dragon Darts", PL), idle(saur()), idle(lax({ substitute: 58 })), idle(chomp())),
    checks: "One dart each: one into Snorlax's Substitute, one into Garchomp.",
  },
  {
    id: "RE03b", title: "Dragon Darts into a Substitute, the other foe Fairy", game: "sv",
    slots: slots(act(mon("Dragapult", "Clear Body"), "Dragon Darts", PL), idle(saur()), idle(lax({ substitute: 30 })), idle(clef())),
    checks: "Clefable is immune: both darts into Snorlax; the first can break the Substitute and the second reach Snorlax.",
  },
  {
    id: "RE04", title: "Matcha Gotcha into a Substitute and another foe", game: "sv",
    slots: slots(act(mon("Sinistcha", "Hospitality", { hp: 60 }), "Matcha Gotcha"), idle(saur()), idle(lax({ substitute: 58 })), idle(toise())),
    checks: "Spread drain: ceil(taken/2) from the Substitute in TryPrimaryHit, round(damage/2) from Blastoise.",
  },
  {
    id: "RE05", title: "Rock Slide with Shell Bell into a Substitute and another foe", game: "sv",
    slots: slots(act(mon("Tyranitar", "Unnerve", { item: "Shell Bell", hp: 100 }), "Rock Slide"), idle(saur()), idle(lax({ substitute: 58 })), idle(laxN(12))),
    checks: "Shell Bell heals 1/8 of the damage dealt to Pokémon (move.totalDamage counts the twin only).",
  },
  {
    id: "RE06", title: "Rock Slide with Life Orb into a Substitute and another foe", game: "sv",
    slots: slots(act(mon("Tyranitar", "Unnerve", { item: "Life Orb" }), "Rock Slide"), idle(saur()), idle(lax({ substitute: 58 })), idle(laxN(12))),
    checks: "Life Orb once per move.",
  },
  {
    id: "RE07", title: "Earthquake into the ally's Substitute and both foes", game: "sv",
    slots: slots(act(chomp(), "Earthquake"), idle(lax({ substitute: 58 })), idle(toise()), idle(mon("Tyranitar", "Unnerve"))),
    checks: "The ally's Substitute takes Earthquake (spread modifier).",
  },
  {
    id: "RE08", title: "Final Gambit into a Substitute", game: "sv",
    slots: slots(act(sm(0, { hp: 100 }), "Final Gambit", PL), idle(saur()), idle(lax({ substitute: 58 })), idle(toise())),
    checks: "Final Gambit deals the user's HP capped at the Substitute; the user faints.",
  },
  {
    id: "RE09", title: "Endeavor into a Substitute", game: "sv",
    slots: slots(act(sm(0, { hp: 20 }), "Endeavor", PL), idle(saur()), idle(lax({ substitute: 58 })), idle(toise())),
    checks: "Endeavor deals target.hp − user.hp capped at the Substitute.",
  },
  {
    id: "RE10", title: "Icicle Spear into a Substitute in front of an Occa Berry", game: "sv",
    slots: slots(act(mon("Cloyster", "Skill Link"), "Icicle Spear", PL), idle(saur()), idle(chomp({ substitute: 30, item: "Occa Berry" })), idle(toise())),
    checks: "The stand-in Leftovers for the calculation into the Substitute; the continuation into Garchomp (Occa does not act on Ice).",
  },
  {
    id: "RE11", title: "Ice Beam into a full-HP Multiscale Dragonite behind a Substitute", game: "sv",
    slots: slots(act(toise(), "Ice Beam", PL), idle(saur()), idle(mon("Dragonite", "Multiscale", { substitute: 40 })), idle(lax())),
    checks: "Multiscale reads the Pokémon's HP: it halves the damage into the Substitute.",
  },
  // ---- Trick ----
  {
    id: "RE20", title: "Trick an Occa Berry onto Scizor, then Flamethrower", game: "sv",
    slots: slots(act(fastSm({ item: "Occa Berry" }), "Trick", PL), act(zard(), "Flamethrower", PL), idle(mon("Scizor", "Technician", { item: "Leftovers" })), idle(toise())),
    checks: "Scizor receives Occa: the Flamethrower is halved and the Berry eaten.",
  },
  {
    id: "RE21", title: "Trick an Assault Vest onto Snorlax, then Flamethrower", game: "sv",
    slots: slots(act(fastSm({ item: "Assault Vest" }), "Trick", PL), act(zard(), "Flamethrower", PL), idle(lax()), idle(toise())),
    checks: "Snorlax's Sp. Def ×1.5 for the later Flamethrower.",
  },
  {
    id: "RE22", title: "Trick a Sticky Barb, then a contact hit from an item-less attacker", game: "sv",
    slots: slots(act(fastSm({ item: "Sticky Barb" }), "Trick", PL), act(lax(), "Body Slam", PL), idle(chomp()), idle(toise())),
    checks: "Sticky Barb moves to Snorlax on contact; the end of turn hurts Snorlax.",
  },
  {
    id: "RE23", title: "Infiltrator Trick into a Substitute", game: "sv",
    slots: slots(act(mon("Chandelure", "Infiltrator", { item: "Choice Scarf" }), "Trick", PL), idle(saur()), idle(chomp({ item: "Leftovers", substitute: 45 })), idle(toise())),
    checks: "Infiltrator passes the Substitute (moves.ts:18343 move.infiltrates): Trick works.",
  },
  {
    id: "RE24-usum", title: "Unburden loses its item to Trick (USUM frozen order)", game: "usum",
    slots: slots(act(fastSm(), "Trick", PL), idle(lax()), act(mon("Drifblim", "Unburden", { item: "Sitrus Berry" }), "Shadow Ball", OR), act(chomp(), "Dragon Claw", OL)),
    checks: "Gen 7 keeps the start order: Drifblim still after Garchomp.",
  },
  // ---- Ally Switch ----
  {
    id: "RE30", title: "Leech Seed after the seeder's partner's Ally Switch", game: "sv",
    slots: slots(act(saur({ hp: 100 }), "Leech Seed", PL), act(reun({ hp: 100 }), "Ally Switch"), idle(chomp()), idle(toise())),
    checks: "Venusaur seeds from the position it now stands at (own-right): it gains the drain, not Reuniclus.",
  },
  {
    id: "RE31", title: "A Grass move aimed at the Ally Switch user's place, Rage Powder partner", game: "sv",
    slots: slots(act(saur(), "Energy Ball", PL), idle(lax()), act(reun(), "Ally Switch"), act(mon("Amoonguss", "Regenerator"), "Rage Powder")),
    checks: "Rage Powder does not redirect a Grass user; the aimed position now holds Amoonguss.",
  },
  {
    id: "RE32", title: "Body Slam at a foe position whose new occupant fainted", game: "sv",
    slots: slots(act(lax(), "Body Slam", PL), act(fastSm(), "Shadow Ball", PL), act(reun(), "Ally Switch"), idle(mon("Gengar", "Cursed Body", { hp: 1 }))),
    checks: "Ally Switch puts Gengar at PL's position; Smeargle's Shadow Ball KOs it; Body Slam goes to Reuniclus.",
  },
  {
    id: "RE33", title: "Propeller Tail after a foe's Ally Switch", game: "sv",
    slots: slots(act(mon("Barraskewda", "Propeller Tail"), "Liquidation", PL), idle(saur()), act(reun(), "Ally Switch"), idle(toise())),
    checks: "Propeller Tail keeps the Pokémon chosen at queue time: Reuniclus.",
  },
];

const farig = (extra: Partial<CaseMon> = {}) => mon("Farigiraf", "Armor Tail", extra);
export const REVIEW_CASES_2: Case[] = [
  {
    id: "RE40", title: "Ally Switch under Psychic Terrain", game: "sv", field: { terrain: "Psychic" },
    slots: slots(idle(jolt()), act(reun(), "Ally Switch"), act(mon("Azumarill", "Huge Power"), "Aqua Jet", OL), idle(toise())),
    checks: "Psychic Terrain does not stop a self-target move (data/conditions.ts psychicterrain onTryHit: target self returns).",
  },
  {
    id: "RE41", title: "Ally Switch with a foe's Armor Tail", game: "sv",
    slots: slots(idle(jolt()), act(reun(), "Ally Switch"), act(mon("Azumarill", "Huge Power"), "Aqua Jet", OL), idle(farig())),
    checks: "Armor Tail blocks priority moves aimed at its side; Ally Switch aims at its user: not blocked.",
  },
  {
    id: "RE42", title: "Explosion into a Substitute and the others", game: "sv",
    slots: slots(act(mon("Electrode", "Soundproof"), "Explosion"), idle(lax()), idle(lax({ substitute: 58 })), idle(toise())),
    checks: "Explosion's user faints; the Substitute takes the spread hit.",
  },
  {
    id: "RE43", title: "Fling a Flame Orb into a Substitute", game: "sv",
    slots: slots(act(sm(0, { item: "Flame Orb" }), "Fling", PL), idle(saur()), idle(lax({ substitute: 58 })), idle(toise())),
    checks: "Fling into a Substitute: no burn on Snorlax; Smeargle loses its item.",
  },
  {
    id: "RE44", title: "Trick a Choice Scarf under Trick Room", game: "sv", field: { trickRoom: true },
    slots: slots(act(reun({ item: "Choice Scarf" }), "Trick", PL), idle(saur()), act(mon("Hippowdon", "Sand Force"), "Earthquake"), act(toise(), "Water Pulse", OL)),
    checks: "Trick Room: Reuniclus (50) first; Hippowdon 67 → 100 with the Scarf moves after Blastoise (98) from gen 8.",
  },
  {
    id: "RE45", title: "Trick an Assault Vest away from Snorlax, then Flamethrower", game: "sv",
    slots: slots(act(fastSm({ item: "Leftovers" }), "Trick", PL), act(zard(), "Flamethrower", PL), idle(lax({ item: "Assault Vest" })), idle(toise())),
    checks: "Snorlax loses the Assault Vest's Sp. Def ×1.5 before the Flamethrower.",
  },
  {
    id: "RE46", title: "Rock Slide into two Substitutes", game: "sv",
    slots: slots(act(mon("Tyranitar", "Unnerve"), "Rock Slide"), idle(saur()), idle(lax({ substitute: 40 })), idle(laxN(12, { substitute: 45 }))),
    checks: "Two Substitutes, each its own HP mixture.",
  },
  {
    id: "RE48", title: "Thief into a Substitute", game: "sv",
    slots: slots(act(mon("Weavile", "Pressure"), "Thief", PL), idle(saur()), idle(lax({ substitute: 58, item: "Leftovers" })), idle(toise())),
    checks: "Thief takes nothing through a Substitute (onAfterHit needs a target).",
  },
  {
    id: "RE49", title: "Bug Bite into a Substitute in front of a Sitrus Berry", game: "sv",
    slots: slots(act(mon("Scizor", "Technician"), "Bug Bite", PL), idle(saur()), idle(lax({ substitute: 58, item: "Sitrus Berry", hp: 150 })), idle(toise())),
    checks: "Bug Bite eats nothing through a Substitute.",
  },
  {
    id: "RE52", title: "Make It Rain into a Substitute and another foe", game: "sv",
    slots: slots(act(mon("Gholdengo", "Good as Gold"), "Make It Rain"), idle(saur()), idle(lax({ substitute: 58 })), idle(toise())),
    checks: "The user's Sp. Atk −1 once; the Substitute takes the spread hit.",
  },
  {
    id: "RE55", title: "Prankster Switcheroo takes a Choice Scarf from a faster foe", game: "sv",
    slots: slots(act(mon("Klefki", "Prankster", { item: "Leftovers" }), "Switcheroo", PL), act(jolt(), "Thunderbolt", PR), act(chomp({ item: "Choice Scarf" }), "Dragon Claw", OR), idle(toise())),
    checks: "Garchomp 183 → 122 without the Scarf: from gen 8 Jolteon (150) moves before it.",
  },
  {
    id: "RE55-usum", title: "Prankster Switcheroo takes a Choice Scarf from a faster foe (USUM)", game: "usum",
    slots: slots(act(mon("Klefki", "Prankster", { item: "Leftovers" }), "Switcheroo", PL), act(jolt(), "Thunderbolt", PR), act(chomp({ item: "Choice Scarf" }), "Dragon Claw", OR), idle(toise())),
    checks: "Gen 7 keeps the start order: Garchomp before Jolteon.",
  },
  {
    id: "RE56", title: "Trick an Iron Ball onto Levitate Bronzong, then Earthquake", game: "sv",
    slots: slots(act(fastSm({ item: "Iron Ball" }), "Trick", PL), idle(lax()), idle(mon("Bronzong", "Levitate")), act(mon("Hippowdon", "Sand Force"), "Earthquake")),
    checks: "Iron Ball grounds a Levitate holder: Earthquake hits Bronzong.",
  },
];
REVIEW_CASES.push(...REVIEW_CASES_2);

export const REVIEW_CASES_3: Case[] = [
  {
    id: "RE60", title: "Trick a Starf Berry onto a foe at a quarter, which then attacks", game: "sv",
    slots: slots(act(fastSm({ item: "Starf Berry" }), "Trick", PL), idle(lax()), act(chomp({ hp: 40 }), "Dragon Claw", OR), idle(toise())),
    checks: "Starf Berry's onUpdate (hp <= maxhp/4) at the Trick's Update: a random stat +2 before Dragon Claw.",
  },
  {
    id: "RE61", title: "Trick a Lansat Berry onto a Cheek Pouch foe at a quarter, then Tackle", game: "sv",
    slots: slots(act(fastSm({ item: "Lansat Berry" }), "Trick", PL), act(lax(), "Tackle", PL), idle(mon("Dedenne", "Cheek Pouch", { hp: 30 })), idle(toise())),
    checks: "Lansat Berry's onUpdate at the Trick's Update: eaten, Cheek Pouch +47 before Tackle.",
  },
  {
    id: "RE62", title: "Trick a Lansat Berry onto a foe at a quarter (no Cheek Pouch)", game: "sv", outcomes: true,
    slots: slots(act(fastSm({ item: "Lansat Berry" }), "Trick", PL), idle(lax()), idle(chomp({ hp: 40 })), idle(toise())),
    checks: "Lansat Berry eaten at the Trick's Update: Garchomp holds nothing after the moves.",
  },
];
REVIEW_CASES.push(...REVIEW_CASES_3);

export const REVIEW_CASES_4: Case[] = [
  {
    id: "RE45b", title: "Trick an Assault Vest away from Snorlax, then Flamethrower (Snorlax attacks)", game: "sv",
    slots: slots(act(fastSm({ item: "Leftovers" }), "Trick", PL), act(zard(), "Flamethrower", PL), act(lax({ item: "Assault Vest" }), "Body Slam", OL), idle(toise())),
    checks: "Snorlax loses the Assault Vest's Sp. Def ×1.5 before the Flamethrower.",
  },
  {
    id: "RE63", title: "Substitute's cost brings a Cheek Pouch Lansat holder to a quarter, then Hyper Voice", game: "sv",
    slots: slots(idle(sm()), act(lax(), "Hyper Voice"), act(mon("Dedenne", "Cheek Pouch", { hp: 60, item: "Lansat Berry" }), "Substitute"), idle(toise())),
    checks: "Lansat Berry's onUpdate after Substitute's directDamage: eaten, Cheek Pouch +47; Hyper Voice (sound) then hits Dedenne.",
  },
];
REVIEW_CASES.push(...REVIEW_CASES_4);

export const REVIEW_CASES_5: Case[] = [
  {
    id: "RE64-swsh", title: "Trick a Berry Juice onto a foe at half, the user's partner has Unnerve (SwSh)", game: "swsh",
    slots: slots(act(reun({ item: "Berry Juice" }), "Trick", PL), idle(mon("Tyranitar", "Unnerve")), idle(chomp({ hp: 80 })), idle(toise())),
    checks: "Berry Juice is not a Berry (useItem, not eatItem): Unnerve does not stop it; Garchomp +20 at the Trick's Update.",
  },
];
REVIEW_CASES.push(...REVIEW_CASES_5);

export const REVIEW_CASES_6: Case[] = [
  {
    id: "RE70", title: "Population Bomb into a 30-HP Substitute", game: "sv",
    slots: slots(act(mon("Maushold", "Technician"), "Population Bomb", PL), idle(saur()), idle(lax({ substitute: 30 })), idle(toise())),
    checks: "10 hits (later hits forced to hit, as the oracle does); the Substitute breaks, the rest reach Snorlax.",
  },
  {
    id: "RE71", title: "Surging Strikes into a Substitute (always critical)", game: "sv",
    slots: slots(act(mon("Urshifu-Rapid-Strike", "Unseen Fist"), "Surging Strikes", PL), idle(saur()), idle(lax({ substitute: 40 })), idle(toise())),
    checks: "Three critical hits; the first can break the Substitute.",
  },
  {
    id: "RE72", title: "Scale Shot into a Substitute", game: "sv",
    slots: slots(act(mon("Garchomp", "Rough Skin"), "Scale Shot", PL), idle(saur()), idle(lax({ substitute: 50 })), idle(toise())),
    checks: "2-5 hits; the user's Defense −1 and Speed +1 after the move whatever it hit.",
  },
];
REVIEW_CASES.push(...REVIEW_CASES_6);

export const REVIEW_CASES_7: Case[] = [
  {
    id: "RE80", title: "Magic Room: a hit on an Unburden Air Balloon holder", game: "sv", field: { magicRoom: true },
    slots: slots(act(jolt(), "Shadow Ball", PL), act(chomp(), "Dragon Claw", PL), act(mon("Drifblim", "Unburden", { item: "Air Balloon" }), "Shadow Ball", OR), idle(toise())),
    checks: "Under Magic Room the Air Balloon is ignored (its onDamagingHit does not run): it stays, no Unburden; Garchomp (122) moves before Drifblim (100).",
  },
  {
    id: "RE81", title: "Klutz Air Balloon holder hit, then Earthquake", game: "sv",
    slots: slots(act(jolt(), "Shadow Ball", PL), idle(saur()), idle(mon("Golurk", "Klutz", { item: "Air Balloon", hp: 150 })), act(mon("Hippowdon", "Sand Force"), "Earthquake")),
    checks: "Klutz: the Air Balloon neither floats nor pops; Golurk keeps it.",
  },
];
REVIEW_CASES.push(...REVIEW_CASES_7);

export const REVIEW_CASES_8: Case[] = [
  {
    id: "RE82", title: "Wish after its partner's Ally Switch onto a position with a Wish landing", game: "sv",
    slots: slots(act(jolt({ hp: 60 }), "Wish"), act(reun({ hp: 100, carried: { wish: 90 } }), "Ally Switch"), idle(chomp()), idle(toise())),
    checks: "Jolteon now stands where a Wish lands this turn: its own Wish fails; the landing Wish heals Jolteon (+90 capped).",
  },
];
REVIEW_CASES.push(...REVIEW_CASES_8);

export const REVIEW_CASES_9: Case[] = [
  {
    id: "RE83", title: "Trick a Toxic Orb onto a Poison type and a Flame Orb onto a Fire type", game: "sv",
    slots: slots(act(fastSm({ item: "Toxic Orb" }), "Trick", PL), act(fastSm({ item: "Flame Orb", evs: { spe: 248 } }), "Trick", PR), idle(mon("Gengar", "Cursed Body")), idle(zard())),
    checks: "The Orbs read the new holder at the end of turn: neither can be statused.",
  },
  {
    id: "RE84", title: "Trick a Black Sludge onto a Poison type, Leftovers back", game: "sv",
    slots: slots(act(fastSm({ item: "Black Sludge", hp: 100 }), "Trick", PL), idle(lax()), idle(mon("Gengar", "Cursed Body", { hp: 100, item: "Leftovers" })), idle(toise())),
    checks: "Gengar heals 1/16 with Black Sludge; Smeargle heals 1/16 with Leftovers.",
  },
];
REVIEW_CASES.push(...REVIEW_CASES_9);

export const REVIEW_CASES_10: Case[] = [
  {
    id: "RE85", title: "A Klutz Air Balloon holder behind a Substitute is hit", game: "sv", outcomes: true,
    slots: slots(act(jolt(), "Shadow Ball", PL), idle(saur()), idle(mon("Golurk", "Klutz", { item: "Air Balloon", substitute: 40 })), idle(toise())),
    checks: "Klutz: the Air Balloon's onAfterSubDamage does not run; Golurk keeps it.",
  },
  {
    id: "RE86", title: "An Unburden Air Balloon holder behind a Substitute is hit, then moves", game: "sv",
    slots: slots(act(jolt(), "Shadow Ball", PL), act(chomp(), "Dragon Claw", PL), act(mon("Drifblim", "Unburden", { item: "Air Balloon", substitute: 40 }), "Shadow Ball", OR), idle(toise())),
    checks: "The Air Balloon pops on the hit into the Substitute (AfterUseItem: Unburden): Drifblim 200 moves before Garchomp 122.",
  },
];
REVIEW_CASES.push(...REVIEW_CASES_10);

export const REVIEW_CASES_11: Case[] = [
  {
    id: "RE87", title: "Wild Charge into a Substitute: recoil brings a Cheek Pouch Lansat holder to a quarter, then Water Pulse", game: "sv",
    slots: slots(act(mon("Dedenne", "Cheek Pouch", { hp: 46, item: "Lansat Berry" }), "Wild Charge", PL), idle(saur()), idle(lax({ substitute: 58 })), act(toise(), "Water Pulse", OL)),
    checks: "Recoil inside the Substitute's onTryPrimaryHit, then the hit's Update eats the Lansat Berry (Cheek Pouch +47) before Water Pulse.",
  },
];
REVIEW_CASES.push(...REVIEW_CASES_11);

export const REVIEW_CASES_12: Case[] = [
  {
    id: "RE88", title: "Wild Charge (no Substitute): recoil brings a Cheek Pouch Lansat holder to a quarter, then Water Pulse", game: "sv",
    slots: slots(act(mon("Dedenne", "Cheek Pouch", { hp: 46, item: "Lansat Berry" }), "Wild Charge", PL), idle(saur()), idle(lax({ item: "Leftovers" })), act(toise(), "Water Pulse", OL)),
    checks: "Control for RE87 without a Substitute: recoil after the hits, then the Update eats the Lansat Berry.",
  },
];
REVIEW_CASES.push(...REVIEW_CASES_12);

export const REVIEW_CASES_13: Case[] = [
  {
    id: "RE89", title: "A confused Pokémon behind its own Substitute hurts itself", game: "sv",
    slots: slots(idle(sm()), idle(saur()), act(lax({ substitute: 58, carried: { confusion: { attempts: 1 } } }), "Body Slam", OL), idle(toise())),
    checks: "The confusion self-hit damages the Pokémon, not its Substitute (sim/battle-actions.ts: directDamage-like damage to itself).",
  },
];
REVIEW_CASES.push(...REVIEW_CASES_13);

export const REVIEW_CASES_14: Case[] = [
  {
    id: "RE90-swsh", title: "Trick a Choice Scarf onto a Dynamaxed foe (SwSh)", game: "swsh",
    slots: slots(act(reun({ item: "Choice Scarf" }), "Trick", PL), idle(saur()), act(lax({ choice: "dynamax" }), "Body Slam", OR), act(mon("Hippowdon", "Sand Force"), "Earthquake")),
    checks: "Choice items do nothing while Dynamaxed (data/items.ts choicescarf onModifySpe: dynamax returns): Snorlax stays at 51, after Hippowdon (67).",
  },
];
REVIEW_CASES.push(...REVIEW_CASES_14);

export const REVIEW_CASES_15: Case[] = [
  {
    id: "RE64b-swsh", title: "Prankster Switcheroo a Berry Juice onto a foe at 70 HP beside an Unnerve partner, then Crunch (SwSh)", game: "swsh",
    slots: slots(act(mon("Klefki", "Prankster", { item: "Berry Juice" }), "Switcheroo", PL), act(mon("Tyranitar", "Unnerve"), "Crunch", PL), idle(chomp({ hp: 70 })), idle(toise())),
    checks: "Garchomp drinks the Berry Juice at the Switcheroo's Update (Unnerve does not stop it): 90 HP before Crunch.",
  },
];
REVIEW_CASES.push(...REVIEW_CASES_15);
