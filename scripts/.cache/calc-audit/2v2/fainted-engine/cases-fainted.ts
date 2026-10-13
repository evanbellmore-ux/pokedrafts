// Fainted-before-the-turn cases (2v2: current HP 0 = fainted with no replacement; the app input is null for that slot).
// Showdown: the slot's Pokémon enters at the start (its entry ability runs, as in a real battle), then faints before the
// turn (sim-dfs.ts prepare: Pokemon.faint and faintMessages, so side.totalFainted counts it) and passes; fainted-engine/
// real-battle.ts checks this start against a real battle where the Pokémon is knocked out on the turn before with no
// replacement left. Level 50, 31 IVs, Serious, 0 EVs unless set; same shape as verify/cases.ts.
import type { Case, CaseAction, CaseMon, SlotId } from "../verify/case-types";

type Slot = CaseMon & { action: CaseAction };
const mon = (species: string, ability: string, extra: Partial<CaseMon> = {}): CaseMon => ({ species, ability, ...extra });
const act = (m: CaseMon, move: string | null, target?: SlotId, context?: Record<string, unknown>): Slot =>
  ({ ...m, action: { move, ...(target ? { target } : {}), ...(context ? { context } : {}) } });
const idle = (m: CaseMon): Slot => act(m, null);
/** Fainted before the turn: the app's slot is null; the move it would have used is kept in Showdown's set only. */
const fainted = (m: CaseMon, move: string | null = null): Slot => ({ ...m, absent: true, action: { move } });
const slots = (ownLeft: Slot, ownRight: Slot, oppLeft: Slot, oppRight: Slot): Case["slots"] =>
  ({ "own-left": ownLeft, "own-right": ownRight, "opponent-left": oppLeft, "opponent-right": oppRight });
const with_ = (m: CaseMon, extra: Partial<CaseMon>): CaseMon => ({ ...m, ...extra });

// Native sets. Level 50 Speeds: Garchomp Jolly 252 169, Charizard Timid 252 152, Venusaur (4 EVs) 101, Blastoise 98,
// Snorlax (4 EVs) 51, Weavile 145, Pikachu 110, Raichu 130, Dragapult 162.
const chomp = mon("Garchomp", "Rough Skin", { nature: "Jolly", evs: { atk: 252, spe: 252 } });
const zard = mon("Charizard", "Blaze", { nature: "Timid", evs: { spa: 252, spe: 252 } });
const venusaur = mon("Venusaur", "Overgrow", { evs: { spe: 4 } });
const blastoise = mon("Blastoise", "Torrent");
const snorlax = (extra: Partial<CaseMon> = {}) => mon("Snorlax", "Thick Fat", { evs: { spe: 4 }, ...extra });
// Champions (Stat Points): Garchomp 122, Charizard 120, Venusaur 100, Blastoise 98, Snorlax 50.
const cChomp = mon("Garchomp", "Sand Veil");
const cZard = mon("Charizard", "Blaze");
const cVenusaur = mon("Venusaur", "Overgrow", { evs: { spe: 1 } });
const cSnorlax = (extra: Partial<CaseMon> = {}) => mon("Snorlax", "Thick Fat", { evs: { spe: 1 }, ...extra });

export const FAINTED_CASES: Case[] = [
  // A spread move into a lone foe: one target, so no spread modifier (sim/battle-actions.ts:551 spreadHit needs two).
  ...(["sv", "swsh", "usum"] as const).map((game): Case => ({
    id: `K01${{ sv: "a", swsh: "b", usum: "c" }[game]}`, title: `Rock Slide into a lone foe (${game})`, game,
    slots: slots(act(chomp, "Rock Slide"), idle(venusaur), fainted(blastoise), idle(snorlax())),
    checks: "Blastoise fainted before the turn: Rock Slide hits Snorlax alone at full damage.",
  })),
  {
    id: "K01d", title: "Rock Slide into a lone foe (champions)", game: "champions",
    slots: slots(act(cChomp, "Rock Slide"), idle(cVenusaur), fainted(blastoise), idle(cSnorlax())),
    checks: "Blastoise fainted before the turn: Rock Slide hits Snorlax alone at full damage.",
  },
  {
    id: "K02a", title: "Heat Wave into a lone foe", game: "sv",
    slots: slots(idle(chomp), act(zard, "Heat Wave"), idle(venusaur), fainted(snorlax())),
    checks: "Snorlax fainted before the turn: Heat Wave hits Venusaur alone at full damage.",
  },
  {
    id: "K02b", title: "Heat Wave into a lone foe (champions)", game: "champions",
    slots: slots(idle(cChomp), act(cZard, "Heat Wave"), idle(cVenusaur), fainted(cSnorlax())),
    checks: "Snorlax fainted before the turn: Heat Wave hits Venusaur alone at full damage.",
  },
  {
    id: "K03a", title: "Earthquake with a fainted ally", game: "sv",
    slots: slots(act(chomp, "Earthquake"), fainted(zard), idle(venusaur), idle(snorlax())),
    checks: "Charizard fainted before the turn: Earthquake hits only the two foes, each at 0.75.",
  },
  {
    id: "K03b", title: "Earthquake with a fainted ally into a lone foe", game: "swsh",
    slots: slots(act(chomp, "Earthquake"), fainted(zard), fainted(venusaur), idle(snorlax())),
    checks: "Charizard and Venusaur fainted before the turn: Earthquake hits Snorlax alone at full damage.",
  },
  // A move aimed at the fainted foe goes to the other one (sim/battle.ts getTarget, getRandomTarget); the app input aims at the empty slot.
  {
    id: "K04a", title: "Dragon Claw aimed at the fainted foe", game: "sv",
    slots: slots(act(chomp, "Dragon Claw", "opponent-left"), idle(venusaur), fainted(blastoise), idle(snorlax())),
    checks: "Blastoise fainted before the turn: Dragon Claw aimed at it hits Snorlax.",
  },
  {
    id: "K04b", title: "Dragon Claw aimed at your fainted Pokémon (from the far side)", game: "usum",
    slots: slots(fainted(venusaur), idle(snorlax()), idle(blastoise), act(chomp, "Dragon Claw", "own-left")),
    checks: "Your Venusaur fainted before the turn: the opponent's Dragon Claw aimed at it hits Snorlax.",
  },
  // The core 2v1: two attacks into the last foe, which attacks back.
  {
    id: "K05a", title: "Two attacks into the last foe, which attacks back", game: "sv",
    slots: slots(act(chomp, "Dragon Claw", "opponent-right"), act(zard, "Flamethrower", "opponent-right"), fainted(blastoise),
      act(snorlax({ item: "Sitrus Berry" }), "Body Slam", "own-left")),
    checks: "Dragon Claw, then Flamethrower into Snorlax (its Sitrus Berry between them), then its Body Slam into Garchomp.",
  },
  {
    id: "K05b", title: "Two attacks into the last foe, which attacks back (swsh)", game: "swsh",
    slots: slots(act(chomp, "Dragon Claw", "opponent-left"), act(zard, "Air Slash", "opponent-left"),
      act(snorlax({ item: "Sitrus Berry" }), "Body Slam", "own-right"), fainted(blastoise)),
    checks: "Dragon Claw, then Air Slash into Snorlax, then its Body Slam into Charizard.",
  },
  {
    id: "K05c", title: "Two attacks into the last foe, which attacks back (usum)", game: "usum",
    slots: slots(act(chomp, "Dragon Claw", "opponent-right"), act(zard, "Flamethrower", "opponent-right"), fainted(blastoise),
      act(snorlax({ item: "Sitrus Berry" }), "Body Slam", "own-left")),
    checks: "Dragon Claw, then Flamethrower into Snorlax, then its Body Slam into Garchomp.",
  },
  {
    id: "K05d", title: "Two attacks into the last foe, which attacks back (champions)", game: "champions",
    slots: slots(act(cChomp, "Dragon Claw", "opponent-right"), act(cZard, "Flamethrower", "opponent-right"), fainted(blastoise),
      act(cSnorlax({ item: "Sitrus Berry" }), "Body Slam", "own-left")),
    checks: "Dragon Claw, then Flamethrower into Snorlax, then its Body Slam into Garchomp.",
  },
  {
    id: "K05e", title: "Two attacks knock out the last foe before it moves", game: "sv",
    slots: slots(act(chomp, "Dragon Claw", "opponent-right"), act(zard, "Flamethrower", "opponent-right"), fainted(blastoise),
      act(snorlax({ hp: 120 }), "Body Slam", "own-left")),
    checks: "Snorlax at 120: the two attacks can knock it out before its Body Slam.",
  },
  // The lone foe's spread move into your two: two targets, 0.75 each.
  {
    id: "K06a", title: "The last foe's Rock Slide into both of yours", game: "sv",
    slots: slots(idle(venusaur), idle(blastoise), fainted(snorlax()), act(chomp, "Rock Slide")),
    checks: "Rock Slide from the last foe hits Venusaur and Blastoise at 0.75.",
  },
  {
    id: "K06b", title: "The last foe's Earthquake with its ally fainted", game: "champions",
    slots: slots(idle(cVenusaur), idle(blastoise), fainted(cSnorlax()), act(cChomp, "Earthquake")),
    checks: "Earthquake from the last foe hits only your two, at 0.75.",
  },
  // Moves that need an ally.
  {
    id: "K07a", title: "Helping Hand with the ally fainted", game: "sv",
    slots: slots(act(mon("Clefable", "Magic Guard"), "Helping Hand"), fainted(zard), act(chomp, "Rock Slide"), idle(snorlax())),
    checks: "Charizard fainted before the turn: Helping Hand has no target and fails; Rock Slide hits Clefable alone.",
  },
  {
    id: "K07b", title: "Aromatic Mist with the ally fainted", game: "sv",
    slots: slots(act(mon("Alcremie", "Sweet Veil"), "Aromatic Mist"), fainted(zard), idle(chomp), act(snorlax(), "Body Slam", "own-left")),
    checks: "Charizard fainted before the turn: Aromatic Mist (Alcremie 84) has no target and fails before Snorlax's Body Slam.",
  },
  // A fainted Pokémon gives its partner none of its effects.
  {
    id: "K08a", title: "Follow Me user fainted", game: "champions",
    slots: slots(act(cChomp, "Dragon Claw", "opponent-right"), idle(cVenusaur), fainted(mon("Clefable", "Magic Guard"), "Follow Me"), idle(blastoise)),
    checks: "Clefable fainted before the turn: no Follow Me, Dragon Claw hits Blastoise.",
  },
  {
    id: "K09a", title: "Friend Guard partner fainted", game: "sv",
    slots: slots(act(chomp, "Dragon Claw", "opponent-right"), idle(venusaur), fainted(mon("Clefairy", "Friend Guard")), idle(blastoise)),
    checks: "Clefairy fainted before the turn: no Friend Guard on Blastoise.",
  },
  {
    id: "K10a", title: "Intimidate holder fainted", game: "sv",
    slots: slots(act(with_(chomp, { boosts: { atk: -1 } }), "Dragon Claw", "opponent-right"), idle(with_(venusaur, { boosts: { atk: -1 } })),
      fainted(mon("Incineroar", "Intimidate")), idle(snorlax())),
    checks: "Incineroar's Intimidate ran as it entered (-1 Attack on both of yours, as Showdown's start shows), then it fainted: nothing more.",
  },
  {
    id: "K10b", title: "Unnerve holder fainted: the Sitrus Berry is eaten at the start", game: "sv",
    slots: slots(idle(venusaur), idle(snorlax({ item: "Sitrus Berry", hp: 100 })), fainted(mon("Tyranitar", "Unnerve")), act(chomp, "Dragon Claw", "own-right")),
    checks: "Tyranitar fainted before the turn: Snorlax at 100/235 eats its Sitrus Berry as the turn starts (158), then Dragon Claw.",
  },
  {
    id: "K10c", title: "Unnerve holder fainted: the Sitrus Berry after the hit", game: "sv",
    slots: slots(idle(venusaur), idle(snorlax({ item: "Sitrus Berry", hp: 150 })), fainted(mon("Tyranitar", "Unnerve")), act(chomp, "Dragon Claw", "own-right")),
    checks: "Tyranitar fainted before the turn: Dragon Claw takes Snorlax under half and it eats its Sitrus Berry.",
  },
  {
    id: "K11a", title: "Last Respects with the ally fainted (count 0 given)", game: "sv",
    slots: slots(act(mon("Basculegion", "Swift Swim"), "Last Respects", "opponent-left", { fainted: 0 }), fainted(zard), idle(venusaur), idle(snorlax())),
    checks: "Charizard fainted before the turn (side.totalFainted 1): Last Respects into Venusaur has 100 power though the count given is 0.",
  },
  {
    id: "K11b", title: "Last Respects with the ally fainted (count 1 given)", game: "sv",
    slots: slots(act(mon("Basculegion", "Swift Swim"), "Last Respects", "opponent-left", { fainted: 1 }), fainted(zard), idle(venusaur), idle(snorlax())),
    checks: "The count given already counts Charizard: 100 power, not 150.",
  },
  {
    id: "K11c", title: "Last Respects with the ally fainted (champions)", game: "champions",
    slots: slots(act(mon("Basculegion", "Swift Swim"), "Last Respects", "opponent-left"), fainted(cZard), idle(cVenusaur), idle(cSnorlax())),
    checks: "Charizard fainted before the turn: Last Respects has 100 power.",
  },
  {
    id: "K12a", title: "Plus with the Minus partner fainted", game: "sv",
    slots: slots(act(mon("Plusle", "Plus"), "Thunderbolt", "opponent-right"), fainted(mon("Minun", "Minus")), idle(venusaur), idle(blastoise)),
    checks: "Minun fainted before the turn: Plus does not raise Plusle's Sp. Atk.",
  },
  {
    id: "K13a", title: "Flower Gift partner fainted in sun", game: "swsh", field: { weather: "Sun" },
    slots: slots(fainted(mon("Cherrim", "Flower Gift")), act(chomp, "Dragon Claw", "opponent-left"), idle(snorlax()), idle(blastoise)),
    checks: "Cherrim fainted before the turn: no Flower Gift Attack for Garchomp.",
  },
  {
    id: "K14a", title: "Armor Tail partner fainted: a priority move gets through", game: "sv",
    slots: slots(act(mon("Weavile", "Pressure"), "Ice Shard", "opponent-right"), idle(blastoise), fainted(mon("Farigiraf", "Armor Tail")), idle(chomp)),
    checks: "Farigiraf fainted before the turn: Ice Shard (+1) hits Garchomp.",
  },
  {
    id: "K15a", title: "Battery partner fainted", game: "usum",
    slots: slots(act(mon("Pikachu", "Static"), "Thunderbolt", "opponent-right"), fainted(mon("Charjabug", "Battery")), idle(venusaur), idle(blastoise)),
    checks: "Charjabug fainted before the turn: no Battery on Pikachu's Thunderbolt.",
  },
  {
    id: "K16a", title: "Sword of Ruin holder fainted", game: "sv",
    slots: slots(act(chomp, "Dragon Claw", "opponent-right"), fainted(mon("Chien-Pao", "Sword of Ruin")), idle(venusaur), idle(snorlax())),
    checks: "Chien-Pao fainted before the turn: Snorlax's Defense is not lowered.",
  },
  {
    id: "K17a", title: "Cloud Nine holder fainted in sun", game: "champions", field: { weather: "Sun" },
    slots: slots(idle(cChomp), act(cZard, "Flamethrower", "opponent-right"), fainted(mon("Altaria", "Cloud Nine")), idle(cVenusaur)),
    checks: "Altaria fainted before the turn: the sun boosts Flamethrower.",
  },
  {
    id: "K18a", title: "Lightning Rod partner fainted", game: "sv",
    slots: slots(act(mon("Pikachu", "Static"), "Thunderbolt", "opponent-right"), idle(venusaur), fainted(mon("Raichu", "Lightning Rod")), idle(blastoise)),
    checks: "Raichu fainted before the turn: Thunderbolt hits Blastoise.",
  },
  {
    id: "K19a", title: "Dragon Darts into a lone foe", game: "sv",
    slots: slots(act(mon("Dragapult", "Clear Body"), "Dragon Darts", "opponent-right"), idle(venusaur), fainted(blastoise), idle(snorlax())),
    checks: "Blastoise fainted before the turn: both darts hit Snorlax.",
  },
];
