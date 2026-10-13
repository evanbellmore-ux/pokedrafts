// Verification cases, batch 4: stage resets without a boost event (M1 neighbourhood), the stored accuracy and evasion
// stages, more H1 games. Same conventions as cases.ts.
import type { Case, CaseAction, CaseMon, SlotId } from "../../2v2/verify/case-types";
import { chomp, lax, saur, toise } from "../../2v2/verify/cases-s";

type Slot = CaseMon & { action: CaseAction };
const mon = (species: string, ability: string, extra: Partial<CaseMon> = {}): CaseMon => ({ species, ability, ...extra });
const act = (m: CaseMon, move: string | null, target?: SlotId, context?: Record<string, unknown>): Slot =>
  ({ ...m, action: { move, ...(target ? { target } : {}), ...(context ? { context } : {}) } });
const idle = (m: CaseMon): Slot => act(m, null);
const slots = (ownLeft: Slot, ownRight: Slot, oppLeft: Slot, oppRight: Slot): Case["slots"] =>
  ({ "own-left": ownLeft, "own-right": ownRight, "opponent-left": oppLeft, "opponent-right": oppRight });
const OL: SlotId = "own-left", OR: SlotId = "own-right", PL: SlotId = "opponent-left", PR: SlotId = "opponent-right";
void OR; void PR;

export const VERIFY_CASES_4: Case[] = [
  // ---- M1 neighbourhood: Clear Smog's clearBoosts is no boost event either (data/moves.ts clearsmog onHit).
  {
    id: "VE-M1-1", title: "Clear Smog into a +1 Eject Pack holder that attacks later", game: "sv",
    slots: slots(act(mon("Chandelure", "Flash Fire"), "Clear Smog", PL), idle(saur()), act(lax({ item: "Eject Pack", boosts: { atk: 1 } }), "Body Slam", OL), idle(toise())),
    checks: "No boost event: Snorlax stays in and Body Slams at +0.",
  },
  {
    id: "VE-M1-2", title: "Clear Smog into a +1 Eject Pack holder as the last action", game: "sv",
    slots: slots(act(mon("Chandelure", "Flash Fire"), "Clear Smog", PL), idle(saur()), idle(lax({ item: "Eject Pack", boosts: { atk: 1 } })), idle(toise())),
    checks: "No boost event: Snorlax stays for the end of turn.",
  },
  {
    id: "VE-M1-3", title: "SwSh: Trick Room Spectral Thief steals a +1 from an Eject Pack holder as the last action", game: "swsh", field: { trickRoom: true },
    slots: slots(act(mon("Marshadow", "Technician"), "Spectral Thief", PL), idle(saur()), idle(chomp({ item: "Eject Pack", boosts: { def: 1 } })), idle(toise())),
    checks: "The target's stage goes to 0 with setBoost (no AfterBoost): no Eject Pack. Snorlax moves first? (Marshadow 145 first).",
  },
  {
    id: "VE-M1-4", title: "Clear Smog into a +1 Kingambit, then its Lash Out", game: "sv",
    slots: slots(act(mon("Chandelure", "Flash Fire"), "Clear Smog", PL), idle(saur()), act(mon("Kingambit", "Defiant", { boosts: { atk: 1 } }), "Lash Out", OL), idle(toise())),
    checks: "clearBoosts sets no statsLoweredThisTurn: Lash Out 75 power at +0.",
  },
  // ---- Stored accuracy and evasion stages: Contrary against Sand Attack, then the holder's Stored Power.
  {
    id: "VE-ST-1", title: "Sand Attack into Contrary Malamar, then its Stored Power", game: "sv",
    notEstimated: "Stored Power with Malamar's accuracy or evasion stage from this turn is not modelled in 2v2.",
    slots: slots(act(chomp(), "Sand Attack", PL), idle(saur()), act(mon("Malamar", "Contrary"), "Stored Power", OR), idle(toise())),
    checks: "Malamar's +1 accuracy: Stored Power 40 in Showdown; the calculation would read 20: not estimated.",
  },
  {
    id: "VE-ST-2", title: "Sand Attack into Contrary Malamar, then Haze, then its Stored Power", game: "sv",
    slots: slots(act(chomp(), "Sand Attack", PL), act(mon("Milotic", "Marvel Scale", { evs: { spe: 0 } }), "Haze"), act(mon("Malamar", "Contrary"), "Stored Power", OR), idle(toise())),
    checks: "Haze clears the +1 accuracy before Stored Power (Milotic 101 > Malamar 93): 20 power, ready.",
  },
  {
    id: "VE-ST-3", title: "Sand Attack into a Contrary White Herb holder: no drop, no White Herb", game: "sv", outcomes: true,
    slots: slots(act(chomp(), "Sand Attack", PL), idle(saur()), idle(mon("Malamar", "Contrary", { item: "White Herb" })), idle(toise())),
    checks: "+1 accuracy: White Herb stays.",
  },
  {
    id: "VE-ST-5", title: "Sand Attack into Snorlax, then a White Herb Tricked onto it", game: "sv", outcomes: true,
    slots: slots(act(chomp(), "Sand Attack", PL), act(mon("Hatterene", "Magic Bounce", { item: "White Herb" }), "Trick", PL), idle(lax()), idle(toise())),
    checks: "The received White Herb's Start (sim/pokemon.ts setItem) restores the accuracy and is used.",
  },
  {
    id: "VE-ST-4", title: "Double Team, then the user's ally uses Stored Power (its own stages)", game: "sv",
    slots: slots(act(mon("Dragapult", "Clear Body"), "Double Team"), act(mon("Espathra", "Speed Boost"), "Stored Power", PL), idle(lax()), idle(toise())),
    checks: "Stored Power reads Espathra's own stages: 20 power, ready.",
  },
  // ---- F1 neighbourhood: the target's own Lansat or Starf Berry at the Update after a damaging hit.
  {
    id: "VE-F1-6", title: "Starf eaten after a hit the holder survives; it attacks later", game: "sv", outcomes: true,
    slots: slots(act(chomp(), "Dragon Claw", PL), idle(saur()), act(lax({ item: "Starf Berry", hp: 110 }), "Body Slam", OL), idle(toise())),
    checks: "Snorlax 110 − (81–96) = 14–29, under a quarter (58): Starf +2 to a random stat (Attack 1/5) for Body Slam.",
  },
  {
    id: "VE-F1-7", title: "Lansat eaten after a hit the holder survives (E2 item)", game: "sv", outcomes: true,
    slots: slots(act(chomp(), "Dragon Claw", PL), idle(saur()), idle(lax({ item: "Lansat Berry", hp: 110 })), idle(toise())),
    checks: "Lansat eaten: no item, focusenergy (E2 volatile).",
  },
  {
    id: "VE-F1-8", title: "Lansat eaten after a spread hit (Rock Slide), then Super Luck Night Slash", game: "sv",
    slots: slots(act(mon("Honchkrow", "Super Luck", { item: "Lansat Berry", hp: 90 }), "Night Slash", PL), idle(saur()), act(mon("Azumarill", "Thick Fat"), "Aqua Jet", OL), idle(toise())),
    checks: "Aqua Jet takes Honchkrow to a quarter some rolls? (90 − 24..28 = 62..66: no): no Lansat, no crit (control).",
  },
  {
    id: "VE-F1-9", title: "USUM: Starf after a hit from an Unnerve attacker (kept)", game: "usum", outcomes: true,
    slots: slots(act(mon("Houndoom", "Unnerve"), "Crunch", PL), idle(saur()), act(lax({ item: "Starf Berry", hp: 90 }), "Body Slam", OL), idle(toise())),
    checks: "The attacker's Unnerve stops the Starf at the Update.",
  },
  {
    id: "VE-F1-10", title: "SwSh: Starf after a multi-hit Bullet Seed", game: "swsh", outcomes: true, notEstimated: "Starf Berry between the hits of Bullet Seed is not modelled in 2v2.",
    slots: slots(act(mon("Cinccino", "Technician"), "Bullet Seed", PL), idle(saur()), act(lax({ item: "Starf Berry", hp: 100 }), "Body Slam", OL), idle(toise())),
    checks: "Starf at the Update after the hit that takes Snorlax to a quarter; the later hits read a +2 Defense 1/5.",
  },
  {
    id: "VE-F1-13", title: "SwSh: Ganlon after a multi-hit Bullet Seed", game: "swsh", outcomes: true, notEstimated: "Ganlon Berry between the hits of Bullet Seed is not modelled in 2v2.",
    slots: slots(act(mon("Cinccino", "Technician"), "Bullet Seed", PL), idle(saur()), act(lax({ item: "Ganlon Berry", hp: 100 }), "Body Slam", OL), idle(toise())),
    checks: "Ganlon at the Update after the hit that takes Snorlax to a quarter: the later hits read +1 Defense.",
  },
  {
    id: "VE-F1-14", title: "The attacker's Lansat after Rough Skin (E2 focusenergy)", game: "sv", outcomes: true,
    slots: slots(act(lax({ item: "Lansat Berry", hp: 70 }), "Body Slam", PL), idle(saur()), idle(chomp()), idle(toise())),
    checks: "Rough Skin 29: Snorlax at 41, under a quarter (58): Lansat eaten, focusenergy.",
  },
  {
    id: "VE-F1-15", title: "The attacker's Starf after Rough Skin", game: "sv", notEstimated: "Starf Berry raises a random stat",
    slots: slots(act(lax({ item: "Starf Berry", hp: 70 }), "Body Slam", PL), idle(saur()), idle(chomp()), idle(toise())),
    checks: "The attacker's Starf inside the pair's step: not followed.",
  },
  {
    id: "VE-F1-11", title: "Cheek Pouch Dedenne's Starf after a hit", game: "sv", outcomes: true,
    slots: slots(act(chomp(), "Dragon Claw", PL), idle(saur()), act(mon("Dedenne", "Cheek Pouch", { item: "Starf Berry", hp: 140 }), "Dazzling Gleam"), idle(toise())),
    checks: "Starf and Cheek Pouch's third.",
  },
  {
    id: "VE-F1-12", title: "Lansat after a spread hit on two holders", game: "sv", outcomes: true,
    slots: slots(act(chomp(), "Rock Slide"), idle(saur()), idle(lax({ item: "Lansat Berry", hp: 80 })), idle(mon("Charizard", "Blaze", { item: "Starf Berry", hp: 100 }))),
    checks: "Each target's Berry at the Update after the spread hit.",
  },
  // ---- H1 in Champions (data/mods/champions/abilities.ts berserk onDamage).
  {
    id: "VE-H1-C1", title: "Champions: confused Berserk Drampa with a Sitrus Berry (No move), then a foe's Thunder Wave", game: "champions",
    notEstimated: "Sitrus Berry after a confusion self-hit with Berserk is not modelled in 2v2.",
    slots: slots(idle(mon("Drampa", "Berserk", { item: "Sitrus Berry", hp: 90, carried: { confusion: { attempts: 0 } } })), idle(lax()), act(mon("Toxapex", "Limber"), "Toxic", OL), idle(toise())),
    checks: "Toxic's AfterMoveSecondary unlocks the Sitrus: not followed.",
  },
  {
    id: "VE-H1-C2", title: "Champions: confused Berserk Drampa with a Sitrus Berry (No move)", game: "champions", endNotEstimated: "Sitrus Berry after a confusion self-hit with Berserk is not modelled in 2v2.",
    slots: slots(idle(mon("Drampa", "Berserk", { item: "Sitrus Berry", hp: 90, carried: { confusion: { attempts: 0 } } })), idle(lax()), idle(mon("Toxapex", "Limber")), idle(toise())),
    checks: "The moves: the Sitrus stays after the self-hit.",
  },
];
