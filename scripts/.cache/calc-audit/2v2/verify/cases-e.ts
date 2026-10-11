// status-eot ADDENDUM §7.1 "E" cases: Ally Switch, Trick / Switcheroo, hits into a Substitute. Showdown names; level 50,
// 31 IVs, Serious nature and 0 EVs unless set (Speed at level 50 with 0 EVs is base + 20). Reuniclus (Magic Guard, 50) and
// Smeargle (Technician) stand in for users of Ally Switch and Trick.
import type { Case, CaseAction, CaseMon, SlotId } from "./case-types";
import { chomp, clef, gengar, jolt, lax, saur, sm, toise, zard } from "./cases-s";

type Slot = CaseMon & { action: CaseAction };
type Game = Case["game"];
const mon = (species: string, ability: string, extra: Partial<CaseMon> = {}): CaseMon => ({ species, ability, ...extra });
const act = (m: CaseMon, move: string | null, target?: SlotId, context?: Record<string, unknown>): Slot =>
  ({ ...m, action: { move, ...(target ? { target } : {}), ...(context ? { context } : {}) } });
const idle = (m: CaseMon): Slot => act(m, null);
const empty = (m: CaseMon): Slot => ({ ...m, absent: true, action: { move: null } });
const slots = (ownLeft: Slot, ownRight: Slot, oppLeft: Slot, oppRight: Slot): Case["slots"] =>
  ({ "own-left": ownLeft, "own-right": ownRight, "opponent-left": oppLeft, "opponent-right": oppRight });
const OL: SlotId = "own-left", OR: SlotId = "own-right", PL: SlotId = "opponent-left", PR: SlotId = "opponent-right";
const games = <T,>(list: readonly Game[], f: (g: Game) => T): T[] => list.map(f);
const reun = (extra: Partial<CaseMon> = {}) => mon("Reuniclus", "Magic Guard", extra);
const fastSm = (extra: Partial<CaseMon> = {}) => sm(252, { nature: "Jolly", ...extra });
const laxN = (spe: number, extra: Partial<CaseMon> = {}) => lax({ evs: { spe }, ...extra });
const hipp = (extra: Partial<CaseMon> = {}) => mon("Hippowdon", "Sand Force", extra);

export const E_CASES: Case[] = [
  // ======== Ally Switch ========
  ...games(["sv", "champions", "swsh", "usum"], (game) => ({
    id: `E01-${game}`, title: `Ally Switch, then Aqua Jet at the old position (${game})`, game,
    slots: slots(idle(jolt()), act(reun(), "Ally Switch"), act(mon("Azumarill", "Huge Power"), "Aqua Jet", OL), idle(toise())),
    checks: "Ally Switch (+2) first: Reuniclus now stands where Jolteon was, so Aqua Jet (+1) aimed at that position hits Reuniclus.",
  })),
  {
    id: "E02", title: "Fake Out into the Ally Switch user", game: "sv",
    slots: slots(idle(jolt()), act(reun(), "Ally Switch"), act(mon("Azumarill", "Huge Power"), "Aqua Jet", OL), act(mon("Hitmontop", "Technician"), "Fake Out", OR)),
    checks: "Fake Out (+3) flinches Reuniclus: no swap; Aqua Jet hits Jolteon.",
  },
  ...(["Body Slam", "Heal Pulse", "Pollen Puff", "Aromatic Mist"] as const).map((move) => ({
    id: `E03-${move.replace(/ /g, "")}`, title: `${move} at the ally, which Ally Switches first`, game: "sv" as const,
    slots: slots(act(fastSm({ hp: 100 }), move, OR), act(reun({ hp: 100 }), "Ally Switch"), idle(chomp()), idle(toise())),
    checks: `After its ally's Ally Switch, Smeargle stands at the aimed position: ${move} fails [notarget].`,
  })),
  {
    id: "E03-DragonDarts", title: "Dragon Darts at the ally, which Ally Switches first", game: "sv", notEstimated: "Dragon Darts aimed where its user now stands is not modelled in 2v2.",
    slots: slots(act(mon("Dragapult", "Clear Body"), "Dragon Darts", OR), act(reun(), "Ally Switch"), idle(chomp()), idle(toise())),
    checks: "dartsAimSelf (Showdown hits its user and the ally).",
  },
  {
    id: "E04", title: "Follow Me after its partner's Ally Switch", game: "sv",
    slots: slots(act(lax(), "Body Slam", PR), idle(saur()), act(reun(), "Ally Switch"), act(clef(), "Follow Me")),
    checks: "Reuniclus swaps with Clefable; Follow Me follows Clefable to its new place: Body Slam (aimed at Clefable's old position) hits Clefable.",
  },
  ...(["Archaludon/Stalwart/Flash Cannon", "Inteleon/Sniper/Snipe Shot", "Snorlax/Thick Fat/Body Slam"] as const).map((spec) => {
    const [species, ability, move] = spec.split("/");
    return {
      id: `E05-${move.replace(/ /g, "")}`, title: `${move} after a foe's Ally Switch`, game: "sv" as const,
      slots: slots(act(mon(species, ability, species === "Snorlax" ? { evs: { spe: 4 } } : {}), move, PL), idle(saur()), act(reun(), "Ally Switch"), idle(toise())),
      checks: species === "Snorlax" ? "A plain move hits the new occupant of the chosen position (Blastoise)." : `${ability === "Stalwart" ? "Stalwart" : "Snipe Shot"} keeps the Pokémon chosen at queue time: it hits Reuniclus.`,
    };
  }),
  {
    id: "E06", title: "Rock Slide after a foe's Ally Switch, Sitrus Berries at half", game: "sv",
    slots: slots(act(mon("Tyranitar", "Unnerve"), "Rock Slide"), idle(saur()), act(reun({ item: "Sitrus Berry", hp: 110 }), "Ally Switch"), idle(toise({ item: "Sitrus Berry", hp: 80 }))),
    checks: "Spread order by the new positions; each Sitrus at its Update; Unnerve stops them... Tyranitar's Unnerve stops both Berries.",
  },
  ...games(["sv", "champions"], (game) => ({
    id: `E07a-${game}`, title: `Leech Seed: the seeder's partner Ally Switches (${game})`, game, outcomes: true,
    slots: slots(idle(saur({ hp: 100 })), act(reun({ hp: 100 }), "Ally Switch"), idle(chomp({ carried: { leechSeed: OL } })), idle(toise())),
    checks: "Reuniclus now stands at the seeder's slot: it gains the drain (Leech Seed heals getAtSlot(sourceSlot)).",
  })),
  {
    id: "E07b", title: "Leech Seed: the seeded Ally Switches", game: "sv",
    slots: slots(idle(saur({ hp: 100 })), idle(lax()), act(mon("Reuniclus", "Overcoat", { carried: { leechSeed: OL } }), "Ally Switch"), idle(toise())),
    checks: "The seeded Reuniclus (Overcoat, not Magic Guard) is drained wherever it stands; Venusaur gains.",
  },
  {
    id: "E08", title: "A Wish lands on the slot an Ally Switch user moved into", game: "sv",
    slots: slots(idle(jolt({ carried: { wish: 70 } })), act(reun({ hp: 50 }), "Ally Switch"), idle(chomp()), idle(toise())),
    checks: "The Wish heals whoever stands at its slot: Reuniclus +70.",
  },
  ...games(["sv", "champions"], (game) => ({
    id: `E09a-${game}`, title: `Ally Switch used last turn: counter 3 (${game})`, game,
    slots: slots(idle(jolt()), act(reun({ carried: { allySwitch: 3 } }), "Ally Switch"), act(mon("Azumarill", "Huge Power"), "Aqua Jet", OL), idle(toise())),
    checks: "The second use works with 1/3 (then counter 9); fails 2/3 (the volatile ends).",
  })),
  ...games(["sv", "swsh", "usum"], (game) => ({
    id: `E09b-${game}`, title: `Both Pokémon of a side use Ally Switch (${game})`, game,
    slots: slots(act(game === "swsh" ? clef() : mon("Reuniclus", "Overcoat", { evs: { spe: 12 } }), "Ally Switch"), act(reun(), "Ally Switch"), act(mon("Azumarill", "Huge Power"), "Aqua Jet", OL), idle(toise())),
    checks: "Two swaps: the side ends where it started; SV: each user's own counter (no carried, the fact); gen 8/7: no counter.",
  })),
  {
    id: "E10a", title: "Ally Switch with the ally slot empty", game: "sv",
    slots: slots(empty(jolt()), act(reun(), "Ally Switch"), idle(chomp()), idle(toise())),
    checks: "The ally has fainted before the turn: Ally Switch fails.",
  },
  {
    id: "E10b", title: "Ally Switch after the ally is knocked out, counter 3", game: "sv",
    slots: slots(idle(jolt({ hp: 1 })), act(reun({ carried: { allySwitch: 3 } }), "Ally Switch"), act(mon("Dragonite", "Inner Focus", { nature: "Jolly", evs: { spe: 252 } }), "Extreme Speed", OL), idle(toise())),
    checks: "Extreme Speed (+2, faster) knocks out Jolteon first; the counter still rolls at PrepareHit (1/3), then onHit fails (fainted ally).",
  },
  {
    id: "E11a", title: "Thrash after a foe's Ally Switch", game: "sv",
    slots: slots(act(sm(), "Thrash"), idle(saur()), act(reun(), "Ally Switch"), idle(toise())),
    checks: "A random target among the living foes, 1/2 each.",
  },
  {
    id: "E11b", title: "A move at a fainted foe after the user's own side swapped", game: "sv",
    slots: slots(act(lax(), "Body Slam", PL), act(reun(), "Ally Switch"), idle(chomp({ hp: 1 })), act(jolt(), "Shadow Ball", PL)),
    checks: "Reuniclus swaps Snorlax to the other position; Jolteon knocks out its own ally Garchomp; Snorlax's Body Slam at the fainted foe goes across from its new position.",
  },
  {
    id: "E12", title: "Sucker Punch at a position whose occupant changed", game: "sv",
    slots: slots(act(mon("Kingambit", "Defiant"), "Sucker Punch", PL), idle(saur()), act(reun(), "Ally Switch"), act(toise(), "Water Pulse", OR)),
    checks: "Reuniclus swaps into Blastoise's position... Sucker Punch aimed at Reuniclus's old place hits Blastoise, which has a damaging move queued: it works.",
  },
  ...(["Inteleon/Sniper/Snipe Shot", "Archaludon/Stalwart/Flash Cannon"] as const).map((spec) => {
    const [species, ability, move] = spec.split("/");
    return {
      id: `E46-${move.replace(/ /g, "")}`, title: `${move} at its own ally, which Ally Switches`, game: "sv" as const,
      slots: slots(act(mon(species, ability), move, OR), act(reun(), "Ally Switch"), idle(chomp()), idle(toise())),
      checks: "A tracking move keeps its chosen Pokémon: it hits Reuniclus, no failure (K4).",
    };
  }),
  // ======== Trick, Switcheroo ========
  ...games(["sv", "champions", "swsh", "usum"], (game) => ({
    id: `E13-${game}`, title: `Trick a Choice Scarf onto a slower foe (${game})`, game, outcomes: true,
    slots: slots(act(reun({ item: "Choice Scarf" }), "Trick", PL), idle(saur()), act(lax(), "Body Slam", OR), act(hipp(), "Earthquake")),
    checks: "Snorlax 51 → 76 with the Scarf: from gen 8 it moves before Hippowdon (67); gen 7 keeps the start order.",
  })),
  {
    id: "E14", title: "Trick an Iron Ball onto Gyarados, then Earthquake", game: "sv",
    slots: slots(act(fastSm({ item: "Iron Ball" }), "Trick", PL), idle(lax()), act(mon("Gyarados", "Moxie"), "Waterfall", OR), act(hipp(), "Earthquake")),
    checks: "Gyarados gets the Iron Ball: Speed halved (re-sort) and grounded: Earthquake hits it.",
  },
  {
    id: "E15a", title: "Trick a Life Orb onto a later attacker", game: "sv",
    slots: slots(act(fastSm({ item: "Life Orb" }), "Trick", PL), idle(lax()), act(chomp(), "Dragon Claw", OR), idle(toise())),
    checks: "Garchomp's Dragon Claw ×1.3 and Life Orb's 1/10.",
  },
  {
    id: "E15b", title: "Trick a Choice Band onto a later attacker", game: "sv",
    slots: slots(act(fastSm({ item: "Choice Band" }), "Trick", PL), idle(lax()), act(chomp(), "Dragon Claw", OR), idle(toise())),
    checks: "Garchomp's Dragon Claw ×1.5.",
  },
  {
    id: "E16a", title: "Trick a Sitrus Berry onto a foe at half", game: "sv",
    slots: slots(act(fastSm({ item: "Sitrus Berry" }), "Trick", PL), idle(lax()), act(chomp({ hp: 80 }), "Dragon Claw", OR), idle(toise())),
    checks: "Garchomp receives the Sitrus Berry at 80 ≤ 91 and eats it at the Update.",
  },
  {
    id: "E16b", title: "Trick a Lum Berry onto a paralysed foe", game: "sv",
    slots: slots(act(fastSm({ item: "Lum Berry" }), "Trick", PL), idle(lax()), act(chomp({ status: "par" }), "Dragon Claw", OR), idle(toise())),
    checks: "Lum Berry cures the paralysis at the Update: no full paralysis.",
  },
  {
    id: "E16c", title: "Trick a White Herb onto a foe with a lowered stage", game: "sv",
    slots: slots(act(fastSm({ item: "White Herb" }), "Trick", PL), idle(lax()), act(chomp({ boosts: { atk: -2 } }), "Dragon Claw", OR), idle(toise())),
    checks: "White Herb is used inside setItem's Start: Attack back to 0 before Dragon Claw.",
  },
  {
    id: "E16d", title: "Trick a Mental Herb onto a taunted foe", game: "sv",
    slots: slots(act(mon("Grimmsnarl", "Prankster", { evs: { spe: 4 } }), "Taunt", PL), act(fastSm({ item: "Mental Herb" }), "Trick", PL), act(clef(), "Thunder Wave", OR), idle(toise())),
    checks: "Taunt first (Prankster); the Mental Herb arrives and ends the Taunt: Thunder Wave lands.",
  },
  {
    id: "E16e", title: "Trick a Figy Berry onto a foe at a quarter, Modest", game: "sv",
    slots: slots(act(fastSm({ item: "Figy Berry" }), "Trick", PL), idle(lax()), act(chomp({ hp: 40, nature: "Modest" }), "Dragon Claw", OR), idle(toise())),
    checks: "Garchomp eats the Figy Berry at ≤ 1/4 and is confused (Modest dislikes it): 1/3 self-hit.",
  },
  {
    id: "E16f", title: "Trick a Sitrus Berry onto a Klutz foe", game: "sv",
    slots: slots(act(fastSm({ item: "Sitrus Berry" }), "Trick", PL), idle(lax()), idle(mon("Golurk", "Klutz", { hp: 80 })), idle(toise())),
    checks: "Klutz: the Sitrus Berry is held, not eaten.",
  },
  {
    id: "E16g", title: "Trick a Sitrus Berry under Magic Room", game: "sv", field: { magicRoom: true },
    slots: slots(act(fastSm({ item: "Sitrus Berry" }), "Trick", PL), idle(lax()), idle(chomp({ hp: 80 })), idle(toise())),
    checks: "Magic Room: the Sitrus Berry is held, not eaten.",
  },
  {
    id: "E16h", title: "The Trick user receives a Sitrus Berry below half", game: "sv",
    slots: slots(act(fastSm({ hp: 60 }), "Trick", PL), idle(lax()), idle(chomp({ item: "Sitrus Berry" })), idle(toise())),
    checks: "Smeargle at 60 ≤ 65 receives Garchomp's Sitrus Berry and eats it at once.",
  },
  {
    id: "E17a", title: "Trick into Sticky Hold", game: "sv",
    slots: slots(act(fastSm({ item: "Choice Scarf" }), "Trick", PL), idle(lax()), idle(mon("Muk", "Sticky Hold", { item: "Leftovers" })), idle(toise())),
    checks: "Sticky Hold: immune; both keep their items.",
  },
  {
    id: "E17b", title: "Trick into a Substitute, into Protect, both item-less", game: "sv",
    slots: slots(act(fastSm({ item: "Choice Scarf" }), "Trick", PL), act(sm(), "Trick", PR), idle(chomp({ item: "Leftovers", substitute: 45 })), act(toise(), "Protect")),
    checks: "A Substitute stops Trick; Protect blocks the other.",
  },
  {
    id: "E17c", title: "Trick with neither holding an item", game: "sv",
    slots: slots(act(fastSm(), "Trick", PL), idle(lax()), idle(chomp()), idle(toise())),
    checks: "Neither holds an item: Trick fails.",
  },
  {
    id: "E18a", title: "Trick a Booster Energy onto a Paradox Pokémon; an Arceus Plate", game: "sv",
    slots: slots(act(fastSm({ item: "Booster Energy" }), "Trick", PL), act(fastSm({ item: "Leftovers", evs: { spe: 248 } }), "Trick", PR), idle(mon("Iron Hands", "Quark Drive")), idle(mon("Arceus-Fire", "Multitype", { item: "Flame Plate" }))),
    checks: "Booster Energy cannot go to a Paradox Pokémon; a Plate cannot leave Arceus: both fail.",
  },
  {
    id: "E18b-champions", title: "Trick a Mega Stone from its species (Champions)", game: "champions",
    slots: slots(act(reun({ item: "Leftovers" }), "Trick", PL), idle(lax()), idle(chomp({ item: "Garchompite" })), idle(toise())),
    checks: "A Mega Stone cannot leave its species' holder: Trick fails.",
  },
  {
    id: "E18c-swsh", title: "Trick Zacian's Rusted Sword (SwSh)", game: "swsh",
    slots: slots(act(reun({ item: "Leftovers" }), "Trick", PL), idle(lax()), idle(mon("Zacian-Crowned", "Intrepid Sword", { item: "Rusted Sword", boosts: { atk: 1 } })), idle(toise())),
    checks: "Rusted Sword cannot leave Zacian: Trick fails.",
  },
  {
    id: "E18d-usum", title: "Trick a Z-Crystal (USUM)", game: "usum",
    slots: slots(act(reun({ item: "Firium Z" }), "Trick", PL), idle(lax()), idle(chomp({ item: "Leftovers" })), idle(toise())),
    checks: "A Z-Crystal cannot be moved: Trick fails.",
  },
  {
    id: "E19a", title: "Unburden loses its item to Trick", game: "sv",
    slots: slots(act(fastSm(), "Trick", PL), idle(lax()), act(mon("Drifblim", "Unburden", { item: "Sitrus Berry" }), "Air Slash", OR), act(chomp(), "Dragon Claw", OL)),
    checks: "Drifblim (100) gets nothing back: Unburden doubles its Speed at once (200): it moves before Garchomp (122) from gen 8.",
  },
  {
    id: "E19b", title: "Unburden loses its item, then gets one back", game: "sv",
    slots: slots(act(fastSm(), "Trick", PL), act(sm(240, { item: "Leftovers" }), "Trick", PL), act(mon("Drifblim", "Unburden", { item: "Sitrus Berry" }), "Air Slash", OR), act(chomp(), "Dragon Claw", OL)),
    checks: "The first Trick takes Drifblim's Sitrus Berry (Unburden 200); the second gives it Leftovers: no doubling while it holds one (Speed 100 again).",
  },
  ...(["Leftovers", "Black Sludge", "Toxic Orb", "Flame Orb", "Sticky Barb"] as const).map((item) => ({
    id: `E20-${item.replace(/ /g, "")}`, title: `Trick ${item}; the end of turn reads the new holder`, game: "sv" as const,
    slots: slots(act(fastSm({ item }), "Trick", PL), idle(lax()), idle(chomp({ hp: 150 })), idle(toise())),
    checks: `Garchomp holds ${item} at the end of turn.`,
  })),
  {
    id: "E20-Micle", title: "Trick a Micle Berry onto a Cheek Pouch holder at a quarter", game: "sv",
    slots: slots(act(fastSm({ item: "Micle Berry" }), "Trick", PL), idle(lax()), idle(mon("Dedenne", "Cheek Pouch", { hp: 30 })), idle(toise())),
    checks: "C18: Micle Berry eaten after every ordered residual (≤ 1/4); Cheek Pouch heals 1/3.",
  },
  ...games(["sv", "usum"], (game) => ({
    id: `E21-${game}`, title: `Switcheroo (${game})`, game,
    slots: slots(act(mon("Malamar", "Contrary", { item: "Choice Scarf" }), "Switcheroo", PL), idle(saur()), act(lax(), "Body Slam", OR), act(hipp(), "Earthquake")),
    checks: "Switcheroo is Trick: the Scarf moves to Snorlax.",
  })),
  {
    id: "E22a", title: "An Air Balloon received, then Earthquake", game: "sv",
    slots: slots(act(fastSm({ item: "Air Balloon" }), "Trick", PL), idle(lax()), idle(chomp({ hp: 150 })), act(hipp(), "Earthquake")),
    checks: "Garchomp is not grounded with the Air Balloon: Earthquake misses it.",
  },
  {
    id: "E22b", title: "A Klutz giver's Electric Seed on Electric Terrain", game: "sv", field: { terrain: "Electric" }, notEstimated: "Electric Seed received by Garchomp is not modelled in 2v2.",
    slots: slots(act(mon("Golurk", "Klutz", { item: "Electric Seed" }), "Trick", PL), idle(lax()), idle(chomp()), idle(toise())),
    checks: "received: the Seed is used inside setItem.",
  },
  {
    id: "E22c", title: "A Klutz giver's Room Service under Trick Room", game: "sv", field: { trickRoom: true }, notEstimated: "Room Service received by Garchomp is not modelled in 2v2.",
    slots: slots(act(mon("Golurk", "Klutz", { item: "Room Service" }), "Trick", PL), idle(lax()), idle(chomp()), idle(toise())),
    checks: "received: Room Service is used inside setItem.",
  },
  {
    id: "E23", title: "Trick with a Symbiosis partner", game: "sv",
    slots: slots(act(fastSm({ item: "Choice Scarf" }), "Trick", PL), idle(mon("Florges", "Symbiosis", { item: "Leftovers" })), idle(chomp()), idle(toise())),
    checks: "Smeargle gives its Scarf away and gets nothing; Trick runs takeItem/setItem with no useItem: Symbiosis passes nothing (T11).",
  },
  // ======== Hits into a Substitute ========
  ...games(["sv", "champions", "usum", "swsh"], (game) => ({
    id: `E24-${game}`, title: `A carried Substitute, a single hit (${game})`, game, outcomes: true,
    slots: slots(act(zard(), "Flamethrower", PL), idle(saur()), idle(lax({ substitute: 28 })), idle(toise())),
    checks: "Damage (25–31) capped at the Substitute's 28 HP; the share that breaks it; Snorlax untouched.",
  })),
  {
    id: "E25a", title: "Brave Bird into Substitutes of 30 and 200", game: "sv",
    slots: slots(act(mon("Talonflame", "Flame Body"), "Brave Bird", PL), act(mon("Staraptor", "Reckless"), "Brave Bird", PR), idle(lax({ substitute: 30 })), idle(laxN(12, { substitute: 200 }))),
    checks: "Recoil round(taken × 33/100) from the damage the Substitute took (U2): 10 from 30.",
  },
  {
    id: "E25b", title: "Draining Kiss into a Substitute; Big Root", game: "sv",
    slots: slots(act(mon("Alcremie", "Sweet Veil", { hp: 60 }), "Draining Kiss", PL), act(mon("Alcremie", "Sweet Veil", { hp: 60, item: "Big Root", evs: { spe: 12 } }), "Draining Kiss", PR), idle(chomp({ substitute: 23 })), idle(mon("Garchomp", "Rough Skin", { substitute: 23, evs: { spe: 4 } }))),
    checks: "Drain ceil(23 × 3/4) = 18 (not round); Big Root 23.",
  },
  {
    id: "E25c", title: "Draining Kiss into a Liquid Ooze Substitute, with and without Big Root, at full HP", game: "sv",
    slots: slots(act(mon("Alcremie", "Sweet Veil"), "Draining Kiss", PL), act(mon("Alcremie", "Sweet Veil", { item: "Big Root", evs: { spe: 12 } }), "Draining Kiss", PR), idle(mon("Tentacruel", "Liquid Ooze", { substitute: 13 })), idle(mon("Tentacruel", "Liquid Ooze", { substitute: 13, evs: { spe: 4 } }))),
    checks: "Liquid Ooze deals the raw ceil(taken × 3/4) to the attacker, unchanged by Big Root and at full HP (K2).",
  },
  {
    id: "E25d", title: "Steel Beam into a Substitute", game: "sv",
    slots: slots(act(mon("Archaludon", "Stamina"), "Steel Beam", PL), idle(saur()), idle(lax({ substitute: 58 })), idle(toise())),
    checks: "Steel Beam costs half once (K7).",
  },
  {
    id: "E26", title: "Life Orb, Shell Bell and a Normal Gem into Substitutes", game: "sv",
    slots: slots(act(chomp({ item: "Life Orb" }), "Dragon Claw", PL), act(mon("Talonflame", "Flame Body", { item: "Shell Bell" }), "Brave Bird", PR), idle(lax({ substitute: 58 })), idle(laxN(12, { substitute: 58 }))),
    checks: "Life Orb costs 1/10 once; Shell Bell heals nothing (totalDamage 0); Brave Bird's recoil from the Substitute's damage.",
  },
  {
    id: "E26b", title: "A Normal Gem into a Substitute", game: "sv",
    slots: slots(act(lax({ item: "Normal Gem" }), "Body Slam", PL), idle(saur()), idle(chomp({ substitute: 45 })), idle(toise())),
    checks: "The Gem is spent on the hit into the Substitute.",
  },
  ...games(["sv", "champions", "usum", "swsh"], (game) => ({
    id: `E27a-${game}`, title: `Icicle Spear (Skill Link) into a 30-HP Substitute (${game})`, game, outcomes: true,
    slots: slots(act(game === "champions" ? mon("Weavile", "Pressure") : mon("Cloyster", "Skill Link"), "Icicle Spear", PL), idle(saur()), idle(chomp({ substitute: 30 })), idle(toise())),
    checks: "Hits into the Substitute until it breaks, the rest into Garchomp (continuation), KO chance (Champions: Weavile, 2–5 hits).",
  })),
  {
    id: "E27b", title: "Bullet Seed 2–5 into a 50-HP Substitute", game: "sv",
    slots: slots(act(mon("Breloom", "Technician"), "Bullet Seed", PL), idle(saur()), idle(lax({ substitute: 50 })), idle(toise())),
    checks: "2–5 hits with their shares: the hits after the break reach Snorlax.",
  },
  {
    id: "E27c", title: "Triple Axel into a 20-HP Substitute", game: "sv",
    slots: slots(act(mon("Weavile", "Pressure"), "Triple Axel", PL), idle(saur()), idle(lax({ substitute: 20 })), idle(toise())),
    checks: "Triple Axel keeps its absolute-index powers after the break (U4c).",
  },
  {
    id: "E27d", title: "Icicle Spear into a Substitute in front of a Focus Sash", game: "sv",
    slots: slots(act(mon("Cloyster", "Skill Link"), "Icicle Spear", PL), idle(saur()), idle(mon("Dragapult", "Clear Body", { item: "Focus Sash", substitute: 20 })), idle(toise())),
    checks: "The first hit after the break meets Dragapult at full HP: Focus Sash saves it (U4d).",
  },
  {
    id: "E27e", title: "Dual Wingbeat into Rocky Helmet after a break", game: "sv",
    slots: slots(act(mon("Talonflame", "Flame Body"), "Dual Wingbeat", PL), idle(saur()), idle(mon("Scizor", "Technician", { item: "Rocky Helmet", substitute: 10 })), idle(toise())),
    checks: "The first hit breaks the Substitute; Rocky Helmet hits back once, for the hit on Scizor (K8).",
  },
  {
    id: "E28", title: "Rock Slide into a Substitute and its twin", game: "sv",
    slots: slots(act(mon("Tyranitar", "Unnerve"), "Rock Slide"), idle(saur()), idle(lax({ substitute: 58 })), idle(laxN(12))),
    checks: "The spread modifier applies to the hit into the Substitute (38 = the twin's 38).",
  },
  {
    id: "E29", title: "Hyper Voice and Infiltrator pass a Substitute", game: "sv",
    slots: slots(act(sm(), "Hyper Voice"), act(mon("Dragapult", "Infiltrator"), "Dragon Darts", PL), idle(lax({ substitute: 58 })), idle(laxN(12, { substitute: 58 }))),
    checks: "Sound and Infiltrator pass it: both Snorlax take the damage directly, Substitutes intact.",
  },
  {
    id: "E30a", title: "Behind a Substitute: Rough Skin, Rocky Helmet, Weakness Policy", game: "sv",
    slots: slots(act(mon("Hawlucha", "Limber"), "Close Combat", PR), act(lax(), "Body Slam", PL), idle(chomp({ substitute: 45, item: "Rocky Helmet" })), idle(mon("Tyranitar", "Unnerve", { substitute: 44, item: "Weakness Policy" }))),
    checks: "No Rough Skin, no Rocky Helmet, no Weakness Policy behind a Substitute.",
  },
  {
    id: "E30b", title: "Behind a Substitute: Occa Berry, Stamina, Air Balloon", game: "sv",
    slots: slots(act(zard(), "Flamethrower", PL), act(saur(), "Sludge Bomb", PR), idle(mon("Scizor", "Technician", { substitute: 35, item: "Occa Berry" })), idle(mon("Mudsdale", "Stamina", { substitute: 50, item: "Air Balloon" }))),
    checks: "A resist Berry neither halves nor is eaten; Stamina does not act; the Air Balloon pops on the hit into the Substitute.",
  },
  {
    id: "E30c", title: "Knock Off into a Substitute: item and no item", game: "sv",
    slots: slots(act(mon("Weavile", "Pressure"), "Knock Off", PL), act(mon("Weavile", "Pressure", { evs: { spe: 4 } }), "Knock Off", PR), idle(lax({ substitute: 200, item: "Leftovers" })), idle(laxN(12, { substitute: 200 }))),
    checks: "Knock Off keeps ×1.5 for any removable item behind a Substitute and takes nothing.",
  },
  {
    id: "E31a", title: "Into a Substitute: Close Combat, Flame Charge, Fake Out, Nuzzle", game: "sv",
    slots: slots(act(mon("Hawlucha", "Limber"), "Close Combat", PL), act(mon("Hitmontop", "Technician"), "Fake Out", PR), act(lax({ substitute: 58 }), "Body Slam", OL), act(laxN(12, { substitute: 58 }), "Body Slam", OL)),
    checks: "The user's own effects happen (Close Combat's drops); none on the target (Fake Out's flinch): both Snorlax move.",
  },
  {
    id: "E31b", title: "Into a Substitute: Flame Charge, Nuzzle, Dragon Tail", game: "sv",
    slots: slots(act(zard(), "Flame Charge", PL), act(mon("Raichu", "Static"), "Nuzzle", PR), idle(lax({ substitute: 58 })), idle(laxN(12, { substitute: 58 }))),
    checks: "Flame Charge's Speed +1 happens; Nuzzle's paralysis does not.",
  },
  {
    id: "E31c", title: "Dragon Tail into a Substitute", game: "sv",
    slots: slots(act(chomp(), "Dragon Tail", PL), idle(saur()), idle(lax({ substitute: 58 })), idle(toise())),
    checks: "No drag behind a Substitute.",
  },
  {
    id: "E31d", title: "Rapid Spin with a carried Leech Seed into a Substitute", game: "sv",
    slots: slots(act(mon("Donphan", "Sturdy", { carried: { leechSeed: PR } }), "Rapid Spin", PL), idle(saur()), idle(lax({ substitute: 58 })), idle(toise())),
    checks: "Rapid Spin hits the Substitute: it still ends its user's Leech Seed and raises Speed (C16): no drain at the end of turn.",
  },
  {
    id: "E31e", title: "Ice Spinner on Psychic Terrain into a Substitute", game: "sv", field: { terrain: "Psychic" },
    slots: slots(act(mon("Weavile", "Pressure"), "Ice Spinner", PL), idle(saur()), idle(lax({ substitute: 58 })), idle(toise())),
    checks: "Ice Spinner ends the terrain on a hit into the Substitute (onAfterSubDamage).",
  },
  {
    id: "E32a", title: "U-turn into a Substitute as the last action", game: "sv", endNotEstimated: "Vespiquen switches out: the replacement is not known.",
    slots: slots(act(mon("Vespiquen", "Pressure"), "U-turn", PL), idle(saur()), idle(toise({ substitute: 38 })), idle(chomp())),
    checks: "U-turn's switch happens on a hit into the Substitute: end of turn not estimated (every other Pokémon is faster).",
  },
  {
    id: "E32b", title: "U-turn into a Substitute with a later action", game: "sv", notEstimated: "Vespiquen switches out: the replacement is not known.",
    slots: slots(act(mon("Vespiquen", "Pressure"), "U-turn", PL), idle(saur()), act(mon("Amoonguss", "Regenerator"), "Sludge Bomb", OR), idle(lax({ substitute: 58 }))),
    checks: "switchesOut with a later action.",
  },
  {
    id: "E33", title: "Mimikyu behind a Substitute", game: "sv",
    slots: slots(act(zard(), "Flamethrower", PL), idle(saur()), idle(mon("Mimikyu", "Disguise", { substitute: 35 })), idle(toise())),
    checks: "Disguise does not act for a hit into the Substitute: full damage to it, Mimikyu stays disguised (U9).",
  },
  {
    id: "E34a", title: "Substitute this turn, broken, then Will-O-Wisp", game: "sv",
    slots: slots(act(chomp({ nature: "Adamant", evs: { atk: 252 } }), "Dragon Claw", PL), act(zard(), "Will-O-Wisp", PL), act(mon("Dragapult", "Clear Body"), "Substitute"), idle(toise())),
    checks: "Dragapult's Substitute (162) breaks to Dragon Claw (122); Charizard's Will-O-Wisp (120) then burns it (U10).",
  },
  {
    id: "E34b", title: "A standing Substitute blocks Will-O-Wisp", game: "sv",
    slots: slots(act(gengar(), "Will-O-Wisp", PL), idle(saur()), idle(lax({ substitute: 58 })), idle(toise())),
    checks: "The Substitute stands: Will-O-Wisp fails.",
  },
  {
    id: "E35", title: "Frost Breath into a Substitute", game: "sv",
    slots: slots(act(mon("Froslass", "Cursed Body"), "Frost Breath", PL), idle(saur()), idle(lax({ substitute: 58 })), idle(toise())),
    checks: "A certain critical hit crits the Substitute.",
  },
  {
    id: "E36", title: "Super Fang into 300- and 30-HP Substitutes; Seismic Toss", game: "sv",
    slots: slots(act(mon("Maushold", "Technician"), "Super Fang", PL), act(mon("Blissey", "Natural Cure"), "Seismic Toss", PR), idle(lax({ substitute: 300 })), idle(laxN(12, { substitute: 30 }))),
    checks: "Super Fang deals half Snorlax's HP (117) into the 300 Substitute; Seismic Toss 50 breaks the 30 one.",
  },
  {
    id: "E37", title: "A trapped Pokémon uses Substitute", game: "sv",
    slots: slots(idle(zard()), idle(saur()), act(lax({ carried: { trap: { source: OL, bindingBand: false } } }), "Substitute"), idle(toise())),
    checks: "Starting a Substitute ends the partial trap (U13): no trap damage at the end of turn.",
  },
  {
    id: "E38", title: "Focus Punch behind a Substitute", game: "sv",
    slots: slots(act(mon("Breloom", "Technician", { substitute: 33 }), "Focus Punch", PL), idle(saur()), act(chomp(), "Dragon Claw", OL), idle(toise())),
    checks: "Dragon Claw hits the Substitute: Breloom keeps its focus and Focus Punch works (U14).",
  },
  {
    id: "E39a-usum", title: "A type Z-Move into a Substitute (USUM)", game: "usum",
    slots: slots(act(zard({ item: "Firium Z", choice: "zmove" }), "Flamethrower", PL), idle(saur()), idle(lax({ substitute: 58 })), idle(toise())),
    checks: "Inferno Overdrive hits the Substitute (U16b).",
  },
  {
    id: "E39b-usum", title: "A Z-Move through Spiky Shield into a Substitute (USUM)", game: "usum",
    slots: slots(act(zard({ item: "Firium Z", choice: "zmove" }), "Flamethrower", PL), idle(saur()), act(mon("Chesnaught", "Bulletproof", { substitute: 70 }), "Spiky Shield"), idle(toise())),
    checks: "A Z-Move breaks through for 1/4; behind a Substitute no contact effect (needs the Hit event).",
  },
  ...([30, 300] as const).map((hp) => ({
    id: `E43-${hp}`, title: `Icicle Spear into Annihilape behind a ${hp}-HP Substitute, then Rage Fist`, game: "sv" as const,
    slots: slots(act(mon("Cloyster", "Skill Link", { nature: "Jolly", evs: { spe: 252 } }), "Icicle Spear", PL), idle(saur()), act(mon("Annihilape", "Defiant", { substitute: hp }), "Rage Fist", OR), idle(toise())),
    checks: hp === 30 ? "K1: a hit after the break reached Annihilape: timesAttacked 5, Rage Fist at 50 + 5 × 50." : "K1: every hit met the Substitute: timesAttacked 0, Rage Fist at 50.",
  })),
  {
    id: "E44", title: "Knock Off into a Colbur Berry holder and Poltergeist into a Kasib Berry holder behind Substitutes", game: "sv",
    slots: slots(act(mon("Weavile", "Pressure"), "Knock Off", PL), act(mon("Gengar", "Cursed Body"), "Poltergeist", PR), idle(lax({ substitute: 200, item: "Colbur Berry" })), idle(toise({ substitute: 200, item: "Kasib Berry" }))),
    checks: "Knock Off keeps ×1.5, the Berry is kept; Poltergeist hits Blastoise's Substitute (a held item) (K6).",
  },
  {
    id: "E47", title: "A 44-HP Substitute on a Pokémon whose quarter is lower", game: "sv",
    slots: slots(act(toise(), "Ice Beam", PL), idle(saur()), idle(sm(0, { substitute: 44 })), idle(lax())),
    checks: "A Shed Tail Substitute keeps its maker's quarter: 44 HP accepted and capped as any Substitute.",
  },
  // ---- E40: reasons only.
  {
    id: "E40-Magician", title: "Magician into a Substitute", game: "sv", notEstimated: "Magician into a Substitute is not modelled in 2v2.",
    slots: slots(act(mon("Delphox", "Magician"), "Psychic", PL), idle(saur()), idle(lax({ substitute: 58, item: "Leftovers" })), idle(toise())),
    checks: "intoSubstitute(Magician).",
  },
  {
    id: "E40-MaxMove-swsh", title: "A Max Move into a Substitute (SwSh)", game: "swsh", notEstimated: "Max Moves into a Substitute is not modelled in 2v2.",
    slots: slots(act(zard({ choice: "dynamax" }), "Flamethrower", PL), idle(saur()), idle(lax({ substitute: 58 })), idle(toise())),
    checks: "intoSubstitute(Max Moves).",
  },
  {
    id: "E40-ParentalBond-usum", title: "Parental Bond into a Substitute (USUM)", game: "usum", notEstimated: "Parental Bond into a Substitute is not modelled in 2v2.",
    slots: slots(act(mon("Kangaskhan", "Parental Bond", { item: "Kangaskhanite", choice: "mega", appSpecies: "kangaskhanmega" }), "Body Slam", PL), idle(saur()), idle(lax({ substitute: 58 })), idle(toise())),
    checks: "intoSubstitute(Parental Bond).",
  },
  {
    id: "E40-MindBlown-usum", title: "Mind Blown into a Substitute (USUM)", game: "usum", notEstimated: "Mind Blown into a Substitute is not modelled in 2v2.",
    slots: slots(act(mon("Blacephalon", "Beast Boost"), "Mind Blown"), idle(saur()), idle(lax({ substitute: 58 })), idle(toise())),
    checks: "intoSubstitute(Mind Blown).",
  },
  ...([["Dragonite", "Multiscale", "Multiscale"], ["Mudsdale", "Stamina", "Stamina"], ["Garchomp", "Rough Skin", "Yache Berry"]] as const).map(([species, ability, what]) => ({
    id: `E40-IcicleSpear-${what.replace(/ /g, "")}`, title: `Icicle Spear into a Substitute in front of ${what}`, game: "sv" as const,
    notEstimated: `Icicle Spear into ${species}'s Substitute with ${what} is not modelled in 2v2.`,
    slots: slots(act(mon("Cloyster", "Skill Link"), "Icicle Spear", PL), idle(saur()), idle(mon(species, ability, { substitute: 20, ...(what === "Yache Berry" ? { item: "Yache Berry" } : {}) })), idle(toise())),
    checks: "subPerHit.",
  })),
  {
    id: "E40-DualWingbeat-Mummy-swsh", title: "Dual Wingbeat into a Substitute in front of Mummy (SwSh)", game: "swsh", notEstimated: "Dual Wingbeat into Cofagrigus's Substitute with Mummy is not modelled in 2v2.",
    slots: slots(act(mon("Talonflame", "Flame Body"), "Dual Wingbeat", PL), idle(saur()), idle(mon("Cofagrigus", "Mummy", { substitute: 20 })), idle(toise())),
    checks: "subPerHit (K5).",
  },
  {
    id: "E40-Disguise", title: "A multi-hit move into a Substitute in front of Disguise", game: "sv", notEstimated: "Disguise against a multi-hit move is not modelled in 2v2.",
    slots: slots(act(mon("Cloyster", "Skill Link"), "Icicle Spear", PL), idle(saur()), idle(mon("Mimikyu", "Disguise", { substitute: 20 })), idle(toise())),
    checks: "faceMultiHit.",
  },
  {
    id: "E40-FlameBurst-usum", title: "Flame Burst (USUM)", game: "usum", notEstimated: "Flame Burst is not modelled in 2v2.",
    slots: slots(act(zard(), "Flame Burst", PL), idle(saur()), idle(lax()), idle(toise())),
    checks: "C17: Flame Burst's splash damage: presence guard.",
  },
  // ---- E45: Weakness Policy and Kee Berry with a breaking and a holding Substitute.
  {
    id: "E45a", title: "Icicle Spear breaks a Substitute in front of Weakness Policy", game: "sv",
    slots: slots(act(mon("Cloyster", "Skill Link"), "Icicle Spear", PL), idle(saur()), idle(chomp({ substitute: 30, item: "Weakness Policy" })), idle(toise())),
    checks: "Weakness Policy on the first hit after the break.",
  },
  {
    id: "E45b", title: "Icicle Spear into a holding Substitute in front of Weakness Policy and Kee Berry", game: "sv",
    slots: slots(act(mon("Cloyster", "Skill Link"), "Icicle Spear", PL), act(lax(), "Body Slam", PR), idle(chomp({ substitute: 400, item: "Weakness Policy" })), idle(laxN(12, { substitute: 50, item: "Kee Berry" }))),
    checks: "Every hit meets the Substitute: no Weakness Policy; a Body Slam breaking the 50 one: Kee Berry? None while every hit meets it.",
  },
  // ---- E41: Trick, Ally Switch and a hit into a carried Substitute in one turn.
  {
    id: "E41", title: "Trick, then Ally Switch, then a hit into a carried Substitute", game: "sv",
    slots: slots(act(fastSm({ item: "Choice Scarf" }), "Trick", PR), act(reun(), "Ally Switch"), act(lax({ substitute: 58 }), "Body Slam", OL), act(zard(), "Flamethrower", PL)),
    checks: "Ally Switch (+2) first; Trick (139) gives Charizard the Scarf; Charizard's Flamethrower into Snorlax's Substitute; Snorlax's Body Slam at the swapped position hits Reuniclus.",
  },
];
