// Verification cases, batch 3: L1, L2, M2, M4, the positions-items-sub fixes and the turn's first Update. Same conventions as cases.ts.
import type { Case, CaseAction, CaseMon, SlotId } from "../../2v2/verify/case-types";
import { chomp, jolt, lax, saur, toise } from "../../2v2/verify/cases-s";

type Slot = CaseMon & { action: CaseAction };
const mon = (species: string, ability: string, extra: Partial<CaseMon> = {}): CaseMon => ({ species, ability, ...extra });
const act = (m: CaseMon, move: string | null, target?: SlotId, context?: Record<string, unknown>): Slot =>
  ({ ...m, action: { move, ...(target ? { target } : {}), ...(context ? { context } : {}) } });
const idle = (m: CaseMon): Slot => act(m, null);
const empty = (m: CaseMon): Slot => ({ ...m, absent: true, action: { move: null } });
const slots = (ownLeft: Slot, ownRight: Slot, oppLeft: Slot, oppRight: Slot): Case["slots"] =>
  ({ "own-left": ownLeft, "own-right": ownRight, "opponent-left": oppLeft, "opponent-right": oppRight });
const OL: SlotId = "own-left", OR: SlotId = "own-right", PL: SlotId = "opponent-left", PR: SlotId = "opponent-right";
void PR; void empty; void jolt; void OR;

export const VERIFY_CASES_3: Case[] = [
  // ---- L1: a certain critical hit from a Lansat Berry eaten mid-turn (focusenergy +2): Super Luck Honchkrow's Night Slash.
  {
    id: "VE-L1-1", title: "Lansat eaten after a hit, then Super Luck Night Slash (ratio 2+1+2: certain)", game: "sv",
    slots: slots(act(mon("Honchkrow", "Super Luck", { item: "Lansat Berry", hp: 60 }), "Night Slash", PL), idle(saur()), act(mon("Azumarill", "Thick Fat"), "Aqua Jet", "own-left"), idle(toise())),
    checks: "Azumarill's Aqua Jet first; Honchkrow below a quarter eats Lansat; its Night Slash always crits.",
  },
  {
    id: "VE-L1-2", title: "Always-critical Wicked Blow (SwSh)", game: "swsh",
    slots: slots(act(mon("Urshifu", "Unseen Fist"), "Wicked Blow", PL), idle(saur()), idle(lax()), idle(toise())),
    checks: "Every hit critical: the turn fact names certain crits.",
  },
  // ---- L2: Perish Song with one Soundproof Pokémon, the others already counting: the block is a result, no failure.
  {
    id: "VE-L2-1", title: "Perish Song: three counting, one Soundproof", game: "sv", outcomes: true,
    slots: slots(act(mon("Gengar", "Cursed Body", { carried: { perish: 2 } }), "Perish Song"), idle(saur({ carried: { perish: 2 } })), idle(mon("Kommo-o", "Soundproof")), idle(toise({ carried: { perish: 3 } }))),
    checks: "Kommo-o's TryHit null counts as a result: Perish Song does not fail.",
  },
  {
    id: "VE-L2-2", title: "Perish Song: three counting, one new", game: "sv", outcomes: true,
    slots: slots(act(mon("Gengar", "Cursed Body", { carried: { perish: 2 } }), "Perish Song"), idle(saur({ carried: { perish: 2 } })), idle(lax()), idle(toise({ carried: { perish: 3 } }))),
    checks: "Snorlax gets a count.",
  },
  // ---- M2 neighbourhood: Teleport outside generation 7 switches its user out.
  {
    id: "VE-M2-1", title: "SwSh: Teleport as the last action (it switches out)", game: "swsh", endNotEstimated: "Alakazam switches out: the replacement is not known.",
    slots: slots(act(mon("Alakazam", "Magic Guard"), "Teleport"), idle(saur()), act(lax(), "Body Slam", OL), idle(toise())),
    checks: "Generation 8 Teleport has −6 priority and selfSwitch: not estimated.",
  },
  {
    id: "VE-M2-2", title: "USUM: Teleport with no Pokémon to switch in (fails either way)", game: "usum", canSwitch: { own: false },
    slots: slots(act(mon("Alakazam", "Magic Guard"), "Teleport"), idle(saur()), act(lax(), "Body Slam", OL), idle(toise())),
    checks: "Fails.",
  },
  // ---- M4 neighbourhood: Yawn.
  {
    id: "VE-M4-1", title: "USUM: Yawn into Comatose Komala", game: "usum", outcomes: true,
    slots: slots(act(lax(), "Yawn", PL), idle(saur()), idle(mon("Komala", "Comatose")), idle(toise())),
    checks: "Yawn starts on Komala (gen 7 as gen 9).",
  },
  {
    id: "VE-M4-2", title: "Yawn into a sleeping Pokémon fails", game: "sv", outcomes: true,
    slots: slots(act(lax(), "Yawn", PL), idle(saur()), idle(chomp({ status: "slp", carried: { sleep: { attempts: 0, rest: false } } })), idle(toise())),
    checks: "Already asleep: fails.",
  },
  {
    id: "VE-M4-3", title: "Yawn into an Insomnia Pokémon", game: "sv", outcomes: true,
    slots: slots(act(lax(), "Yawn", PL), idle(saur()), idle(mon("Hypno", "Insomnia")), idle(toise())),
    checks: "Insomnia's TryAddVolatile: immune.",
  },
  {
    id: "VE-M4-4", title: "Yawn into a grounded Pokémon in Electric Terrain", game: "sv", outcomes: true, field: { terrain: "Electric" },
    slots: slots(act(lax(), "Yawn", PL), idle(saur()), idle(chomp()), idle(toise())),
    checks: "Electric Terrain: no drowsiness.",
  },
  // ---- F1 neighbourhood: Lansat and Starf.
  {
    id: "VE-F1-1", title: "Starf eaten after a hit; the holder attacks later", game: "sv",
    slots: slots(act(chomp(), "Dragon Claw", PL), idle(saur()), act(lax({ item: "Starf Berry", hp: 70 }), "Body Slam", OL), idle(toise())),
    checks: "Snorlax falls under a quarter (58) and eats Starf: a random stat +2 (Attack 1/5) for Body Slam.",
  },
  {
    id: "VE-F1-2", title: "Gluttony Lansat eaten at half after a hit (SV)", game: "sv",
    slots: slots(act(chomp(), "Dragon Claw", PL), idle(saur()), act(mon("Greedent", "Gluttony", { item: "Lansat Berry", hp: 150 }), "Body Slam", OL), idle(toise())),
    checks: "Gluttony eats Lansat at half: focusenergy for Body Slam (ratio 3: 1/2 crit, not certain).",
  },
  {
    id: "VE-F1-3", title: "Ripen Starf via Trick onto a low-HP Flapple", game: "sv",
    slots: slots(act(mon("Hatterene", "Magic Bounce", { item: "Starf Berry" }), "Trick", PL), idle(saur()), act(mon("Flapple", "Ripen", { hp: 30 }), "Dragon Rush", OL), idle(toise())),
    checks: "Flapple eats the received Starf at once: +4 to a random stat.",
  },
  {
    id: "VE-F1-4", title: "Lansat after a confusion self-hit (No move)", game: "sv", outcomes: true,
    slots: slots(idle(lax({ item: "Lansat Berry", hp: 64, carried: { confusion: { attempts: 0 } } })), idle(saur()), idle(chomp()), idle(toise())),
    checks: "Self-hit below a quarter: Lansat eaten (focusenergy).",
  },
  {
    id: "VE-F1-5", title: "Starf with every stat at +6 is not eaten? (Showdown: eaten, no boost)", game: "sv", outcomes: true,
    slots: slots(act(chomp(), "Dragon Claw", PL), idle(saur()), idle(lax({ item: "Starf Berry", hp: 70, boosts: { atk: 6, def: 6, spa: 6, spd: 6, spe: 6 } })), idle(toise())),
    checks: "Starf's onEat with no stat below +6 returns false: the Berry is still eaten? (Showdown decides).",
  },
  // ---- F2 neighbourhood: Berry Juice and Unnerve.
  {
    id: "VE-F2-1", title: "USUM: confused Berry Juice holder hurts itself below half beside a foe's Unnerve", game: "usum",
    slots: slots(idle(lax({ item: "Berry Juice", hp: 125, carried: { confusion: { attempts: 0 } } })), idle(saur()), idle(mon("Houndoom", "Unnerve")), idle(toise())),
    checks: "Berry Juice is used, not eaten: Unnerve does not stop it.",
  },
  {
    id: "VE-F2-2", title: "SwSh: Pain Split leaves a Berry Juice holder below half beside a foe's Unnerve", game: "swsh",
    slots: slots(act(mon("Gengar", "Cursed Body", { hp: 20 }), "Pain Split", PL), idle(saur()), idle(lax({ item: "Berry Juice" })), idle(mon("Tyranitar", "Unnerve"))),
    checks: "Pain Split (to 127? no: (235+20)/2 = 127, above half 117): no drink; check the arithmetic.",
  },
  // ---- F3 neighbourhood: Air Balloon.
  {
    id: "VE-F3-1", title: "Air Balloon under Magic Room: a Ground move hits", game: "sv", field: { magicRoom: true }, outcomes: true,
    slots: slots(act(chomp(), "Earthquake"), empty(saur()), idle(lax({ item: "Air Balloon" })), idle(toise())),
    checks: "Magic Room: the balloon does not levitate and does not pop.",
  },
  {
    id: "VE-F3-2", title: "Air Balloon pops on a hit (control)", game: "sv", outcomes: true,
    slots: slots(act(chomp(), "Dragon Claw", PL), idle(saur()), act(lax({ item: "Air Balloon" }), "Body Slam", OL), idle(toise())),
    checks: "The balloon pops.",
  },
  // ---- F4 neighbourhood: Assault Vest.

  {
    id: "VE-F4-2", title: "Klutz Assault Vest Golurk's Curse", game: "sv",
    slots: slots(act(mon("Golurk", "Klutz", { item: "Assault Vest" }), "Curse", PL), idle(saur()), idle(lax()), idle(toise())),
    checks: "Klutz: the vest does nothing.",
  },

  // ---- ui F1/F2 neighbourhood: the turn's first Update.
  {
    id: "VE-UI-1", title: "USUM: paralysed Limber Hitmonlee against Venusaur (order frozen at the paralysed Speed)", game: "usum",
    slots: slots(act(mon("Hitmonlee", "Limber", { status: "par" }), "High Jump Kick", PL), idle(lax()), act(saur({ hp: 60 }), "Giga Drain", OL), idle(toise())),
    checks: "Gen 7: sorted with the paralysed Speed (53): Venusaur first; Limber cures at the first Update.",
  },
  {
    id: "VE-UI-2", title: "SV: paralysed Limber Hitmonlee against Venusaur", game: "sv",
    slots: slots(act(mon("Hitmonlee", "Limber", { status: "par" }), "High Jump Kick", PL), idle(lax()), act(saur({ hp: 60 }), "Giga Drain", OL), idle(toise())),
    checks: "Gen 9: cured before the sort: Hitmonlee (107) first.",
  },
  {
    id: "VE-UI-3", title: "Immunity Snorlax badly poisoned beside a foe's Neutralizing Gas", game: "sv",
    slots: slots(act(lax({ ability: "Immunity", status: "tox", carried: { toxic: 3 } }), "Body Slam", PL), idle(saur()), idle(mon("Weezing-Galar", "Neutralizing Gas")), idle(toise())),
    checks: "Neutralizing Gas suppresses Immunity: the poison stays.",
  },
  {
    id: "VE-UI-4", title: "SwSh: poisoned Pastel Veil Galarian Rapidash", game: "swsh",
    slots: slots(act(mon("Rapidash-Galar", "Pastel Veil", { status: "psn" }), "Psycho Cut", PL), idle(saur()), idle(lax()), idle(toise())),
    checks: "Cured at the first Update.",
  },
  {
    id: "VE-UI-5", title: "Burned Thermal Exchange Baxcalibur's Icicle Crash", game: "sv",
    slots: slots(act(mon("Baxcalibur", "Thermal Exchange", { status: "brn" }), "Icicle Crash", PL), idle(saur()), idle(lax()), idle(toise())),
    checks: "Cured: Icicle Crash not halved; no burn at the end.",
  },
  {
    id: "VE-UI-6", title: "USUM: burned Water Bubble Araquanid's Liquidation", game: "usum",
    slots: slots(act(mon("Araquanid", "Water Bubble", { status: "brn" }), "Liquidation", PL), idle(saur()), idle(lax()), idle(toise())),
    checks: "Cured at the first Update.",
  },
  {
    id: "VE-UI-7", title: "Confused Own Tempo Grumpig beside a foe's Neutralizing Gas", game: "sv",
    slots: slots(act(mon("Grumpig", "Own Tempo", { carried: { confusion: { attempts: 0 } } }), "Psychic", PR), idle(saur()), idle(mon("Weezing-Galar", "Neutralizing Gas")), idle(toise())),
    checks: "Neutralizing Gas suppresses Own Tempo: the confusion stays (1/3 self-hit).",
  },
  {
    id: "VE-UI-8", title: "Asleep Insomnia Hypno holding a Chesto Berry", game: "sv", outcomes: true,
    slots: slots(act(mon("Hypno", "Insomnia", { status: "slp", item: "Chesto Berry", carried: { sleep: { attempts: 1, rest: false } } }), "Psychic", PL), idle(saur()), idle(chomp()), idle(toise())),
    checks: "Insomnia cures first: the Chesto Berry stays.",
  },
  {
    id: "VE-UI-9", title: "Asleep and confused Vital Spirit Annihilape holding a Lum Berry", game: "sv", outcomes: true,
    slots: slots(act(mon("Annihilape", "Vital Spirit", { status: "slp", item: "Lum Berry", carried: { sleep: { attempts: 1, rest: false }, confusion: { attempts: 0 } } }), "Close Combat", PL), idle(saur()), idle(lax()), idle(toise())),
    checks: "Vital Spirit cures the sleep; Lum then cures the confusion at the same Update.",
  },

  {
    id: "VE-UI-11", title: "Badly poisoned Immunity Snorlax with an Ability Shield beside Neutralizing Gas", game: "sv",
    slots: slots(act(lax({ ability: "Immunity", status: "tox", item: "Ability Shield", carried: { toxic: 2 } }), "Body Slam", PL), idle(saur()), idle(mon("Weezing-Galar", "Neutralizing Gas")), idle(toise())),
    checks: "Ability Shield keeps Immunity under the gas: cured.",
  },
  {
    id: "VE-UI-12", title: "Frozen Magma Armor Magcargo (SV) uses Earth Power, No move partner", game: "sv",
    slots: slots(act(mon("Magcargo", "Magma Armor", { status: "frz" }), "Earth Power", PL), idle(saur()), idle(chomp()), idle(toise())),
    checks: "Cured at the first Update: Earth Power always comes.",
  },
  {
    id: "VE-UI-13", title: "Paralysed Limber Hitmonlee holding a Lum Berry (SwSh)", game: "swsh", outcomes: true,
    slots: slots(act(mon("Hitmonlee", "Limber", { status: "par", item: "Lum Berry" }), "High Jump Kick", PL), idle(saur()), idle(lax()), idle(toise())),
    checks: "Limber cures first: the Lum Berry stays.",
  },
];
