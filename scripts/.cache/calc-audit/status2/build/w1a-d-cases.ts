// status2 wave 1a, Track D (SPEC2 §4.5, ADDENDUM2 §4.2): the moves-phase guards' scratch oracle cases (guards.md §4's G4-
// ids where the design names them; D-… for the extra checks). V1 owns verify/cases*.ts; these run through w1a-d-run.ts into
// status2/build/w1a-d-results/ (not verify/results). Showdown names; level 50, 31 IVs, Serious, 0 EVs unless set.
import type { Case, CaseAction, CaseMon, SlotId } from "../../2v2/verify/case-types";

type Slot = CaseMon & { action: CaseAction };
const mon = (species: string, ability: string, extra: Partial<CaseMon> = {}): CaseMon => ({ species, ability, ...extra });
const act = (m: CaseMon, move: string | null, target?: SlotId, context?: Record<string, unknown>): Slot => ({ ...m, action: { move, ...(target ? { target } : {}), ...(context ? { context } : {}) } });
const idle = (m: CaseMon): Slot => act(m, null);
const slots = (ownLeft: Slot, ownRight: Slot, oppLeft: Slot, oppRight: Slot): Case["slots"] =>
  ({ "own-left": ownLeft, "own-right": ownRight, "opponent-left": oppLeft, "opponent-right": oppRight });
const OL: SlotId = "own-left", OR: SlotId = "own-right", PL: SlotId = "opponent-left", PR: SlotId = "opponent-right";
const lax = (spe: number, extra: Partial<CaseMon> = {}): CaseMon => mon("Snorlax", "Thick Fat", { evs: { spe }, ...extra });

// ---- Opportunist and Mirror Herb (F4 §4.1) ----
const COPIES: Case[] = [
  {
    id: "G4-OPP-01-sv", title: "Trick Room: Cloyster's Shell Smash, then the foe Espathra's Stored Power with the copy (A1)", game: "sv", outcomes: true,
    field: { trickRoom: true },
    slots: slots(act(mon("Cloyster", "Skill Link"), "Shell Smash"), idle(lax(0)),
      act(mon("Espathra", "Opportunist"), "Stored Power", OR), idle(lax(0))),
    checks: "opportunist onFoeAfterBoost: +2 Atk +2 SpA +2 Spe (the positive parts) applied at Shell Smash's AfterMove; Stored Power 20 + 20 × 6.",
  },
  {
    id: "G4-OPP-02-sv", title: "Icy Wind into a Defiant Kingambit: the Icy Wind user's partner Espathra copies Defiant's +2 (A3)", game: "sv", outcomes: true,
    field: { trickRoom: true },
    slots: slots(act(mon("Glalie", "Inner Focus"), "Icy Wind"), act(mon("Espathra", "Opportunist", { evs: { spe: 252 } }), "Stored Power", PR),
      idle(mon("Kingambit", "Defiant", { evs: { spe: 252 } })), idle(lax(252))),
    checks: "A Defiant rise (effect Defiant) is a foe's rise: +2 Atk copied at Icy Wind's AfterMove; Stored Power 60.",
  },
  {
    id: "G4-OPP-03-sv", title: "Breaking Swipe into a Weakness Policy Dragonite: the user's partner copies +2 Atk +2 SpA (A4: the step reports its rises)", game: "sv", outcomes: true,
    field: { trickRoom: true },
    slots: slots(act(mon("Garchomp", "Rough Skin"), "Breaking Swipe"), act(mon("Espathra", "Opportunist", { evs: { spe: 252 } }), "Stored Power", PR),
      idle(mon("Dragonite", "Inner Focus", { item: "Weakness Policy", evs: { spe: 252 } })), idle(lax(252))),
    checks: "One hit: −1 Atk then +2/+2: the copy is +2 Atk +2 SpA (stage difference +1 Atk): Stored Power 100.",
  },
  {
    id: "G4-OPP-04-sv", title: "Mirror Herb: a foe's Swords Dance copied before the holder's Kowtow Cleave", game: "sv", outcomes: true,
    field: { trickRoom: true },
    slots: slots(act(mon("Scizor", "Technician"), "Swords Dance"), idle(lax(252)),
      act(mon("Kingambit", "Pressure", { item: "Mirror Herb", evs: { spe: 252 } }), "Kowtow Cleave", OR), idle(lax(252))),
    checks: "mirrorherb onFoeAfterBoost, onAnyAfterMove useItem: +2 Atk, the Herb used up before Kowtow Cleave.",
  },
  {
    id: "G4-OPP-05-champions", title: "Champions: Espathra copies a foe's Swords Dance, then its Stored Power", game: "champions", outcomes: true,
    field: { trickRoom: true },
    slots: slots(act(mon("Scizor", "Technician"), "Swords Dance"), idle(lax(32)),
      act(mon("Espathra", "Opportunist", { evs: { spe: 32 } }), "Stored Power", OR), idle(lax(32))),
    checks: "Opportunist in Champions: +2 Atk copied; Stored Power 60.",
  },
  {
    id: "G4-OPP-06-sv", title: "A carried copy: applied at the first action's AfterMove (another's), before Espathra's Stored Power", game: "sv", outcomes: true,
    slots: slots(act(mon("Espathra", "Opportunist", { carried: { copy: { spa: 1, spe: 1 } } }), "Stored Power", PR), idle(lax(0)),
      act(mon("Jolteon", "Volt Absorb", { evs: { spe: 252 } }), null), idle(lax(0))),
    checks: "The pending copy (abilityState.boosts) applies at the first AfterMove: Jolteon's Splash, before Espathra moves: Stored Power 60.",
  },
  {
    id: "G4-OPP-07-sv", title: "A copy is not copied back: two Espathra, one copies a Swords Dance, the other does not copy the copy (A8)", game: "sv", outcomes: true,
    field: { trickRoom: true },
    slots: slots(act(mon("Scizor", "Technician"), "Swords Dance"), act(mon("Espathra", "Opportunist", { evs: { spe: 252 } }), "Stored Power", PL),
      act(mon("Espathra", "Opportunist", { evs: { spe: 100 } }), "Stored Power", OR), idle(lax(252))),
    checks: "PS opportunist: effect Opportunist is skipped: the own side's Espathra copies nothing; Stored Power 20 into the foe Espathra.",
  },
];

// ---- The Berserk lock (F4 §4.8; G4-SFL-01 is Step 1's case, D models its later hit) ----
const drampa = (extra: Partial<CaseMon> = {}) => mon("Drampa", "Berserk", { item: "Sitrus Berry", hp: 140, ...extra });
const klawf = (extra: Partial<CaseMon> = {}) => mon("Klawf", "Anger Shell", { item: "Sitrus Berry", ...extra });
const LOCK: Case[] = [
  {
    id: "G4-SFL-01-champions", title: "Champions: a Sheer Force Crunch on a Berserk Sitrus holder, then a later Body Slam on it (GA2)", game: "champions",
    slots: slots(act(drampa(), "Dragon Pulse", PR), idle(mon("Venusaur", "Overgrow", { evs: { spe: 4 } })),
      act(mon("Feraligatr", "Sheer Force", { evs: { atk: 32, spe: 32 } }), "Crunch", OL), act(mon("Snorlax", "Thick Fat"), "Body Slam", OL)),
    checks: "The Sitrus stays locked through the Crunch; the Body Slam's AfterMoveSecondary resets it and the action's Update eats it (Showdown KO 1.95 %).",
  },
  {
    id: "G4-BZK-01-sv", title: "A carried Anger Shell lock: a Body Slam takes Klawf under half; its Sitrus is eaten at that action's end", game: "sv", outcomes: true,
    slots: slots(act(klawf({ carried: { berryLocked: true }, hp: 100 }), "Crabhammer", PR), idle(mon("Venusaur", "Overgrow", { evs: { spe: 4 } })),
      act(mon("Snorlax", "Thick Fat", { evs: { atk: 252, spe: 252 } }), "Body Slam", OL), idle(lax(0))),
    checks: "angershell onDamage locks again, AfterMoveSecondary resets, the action's Update eats the Sitrus; Anger Shell reads the HP before it.",
  },
  {
    id: "G4-BZK-02-sv", title: "A carried Anger Shell lock: a Bullet Seed resets it at its first hit, the Sitrus eaten between hits", game: "sv", outcomes: true,
    slots: slots(idle(klawf({ carried: { berryLocked: true }, hp: 80 })), idle(mon("Venusaur", "Overgrow", { evs: { spe: 4 } })),
      act(mon("Breloom", "Technician", { evs: { atk: 252, spe: 252 } }), "Bullet Seed", OL), idle(lax(0))),
    checks: "A multi-hit move's onDamage resets the lock (multihit): the Berry at that hit's Update (H2).",
  },
  {
    id: "G4-BZK-03-sv", title: "A carried Anger Shell lock on a Klawf under half: a foe's Thunder Wave reaches it; the Sitrus is eaten at that action's end", game: "sv", outcomes: true,
    slots: slots(act(klawf({ carried: { berryLocked: true }, hp: 55 }), "Crabhammer", PR), idle(mon("Venusaur", "Overgrow", { evs: { spe: 4 } })),
      act(mon("Jolteon", "Volt Absorb", { evs: { spe: 252 } }), "Thunder Wave", OL), idle(lax(0))),
    checks: "A status move's AfterMoveSecondary resets the lock; the action's last Update eats the Sitrus at its line.",
  },
  {
    id: "G4-BZK-04-usum", title: "USUM: a carried lock, a Body Slam under half, then the Drampa's Dragon Pulse", game: "usum", outcomes: true,
    slots: slots(act(drampa({ carried: { berryLocked: true }, hp: 120 }), "Dragon Pulse", PR), idle(mon("Venusaur", "Overgrow", { evs: { spe: 4 } })),
      act(mon("Snorlax", "Thick Fat", { evs: { atk: 252, spe: 252 } }), "Body Slam", OL), idle(lax(0))),
    checks: "As G4-BZK-01 in USUM.",
  },
];

// ---- Spread heals (F4 §4.7) ----
const SPREAD: Case[] = [
  {
    id: "G4-SPH-01-champions", title: "Champions: Matcha Gotcha into two foes, Sinistcha at half HP", game: "champions", outcomes: true,
    slots: slots(act(mon("Sinistcha", "Hospitality", { hp: 85 }), "Matcha Gotcha"), idle(lax(0)),
      idle(mon("Rhyperior", "Lightning Rod")), idle(mon("Garchomp", "Rough Skin"))),
    checks: "Each target's drain (round(dealt / 2)) right after its damage, in hit order, capped at the maximum.",
  },
  {
    id: "G4-SPH-02-sv", title: "SV: Matcha Gotcha with a Liquid Ooze target first", game: "sv", outcomes: true,
    slots: slots(act(mon("Sinistcha", "Hospitality", { hp: 120 }), "Matcha Gotcha"), idle(lax(0)),
      idle(mon("Tentacruel", "Liquid Ooze")), idle(mon("Garchomp", "Rough Skin"))),
    checks: "Liquid Ooze deals the raw drain to the user; the second target's drain heals (G1).",
  },
  {
    id: "G4-SPH-03-sv", title: "SV: Matcha Gotcha with a Liquid Ooze target second", game: "sv", outcomes: true,
    slots: slots(act(mon("Sinistcha", "Hospitality", { hp: 140 }), "Matcha Gotcha"), idle(lax(0)),
      idle(mon("Garchomp", "Rough Skin")), idle(mon("Tentacruel", "Liquid Ooze"))),
    checks: "The heal first (capped), then Liquid Ooze's loss (G1b).",
  },
  {
    id: "G4-SPH-04-sv", title: "SV: Matcha Gotcha with Big Root", game: "sv", outcomes: true,
    slots: slots(act(mon("Sinistcha", "Hospitality", { hp: 60, item: "Big Root" }), "Matcha Gotcha"), idle(lax(0)),
      idle(mon("Rhydon", "Lightning Rod")), idle(mon("Garchomp", "Rough Skin"))),
    checks: "Big Root 5324/4096 on each heal by itself (G2).",
  },
  {
    id: "G4-SPH-05-sv", title: "SV: Matcha Gotcha with a Rowap Berry target and the user's Sitrus Berry", game: "sv", outcomes: true,
    slots: slots(act(mon("Sinistcha", "Hospitality", { hp: 95, item: "Sitrus Berry" }), "Matcha Gotcha"), idle(lax(0)),
      idle(mon("Rhydon", "Lightning Rod", { item: "Rowap Berry" })), idle(mon("Garchomp", "Rough Skin"))),
    checks: "The drains, then Rowap's 1/8 (DamagingHit), then the Update's Sitrus (G3).",
  },
  {
    id: "G4-SPH-06-swsh", title: "SwSh: Shell Bell Rock Slide into two foes, one behind a Substitute", game: "swsh", outcomes: true,
    slots: slots(act(mon("Tyranitar", "Unnerve", { item: "Shell Bell", hp: 120 }), "Rock Slide"), idle(lax(0)),
      idle(mon("Charizard", "Blaze", { substitute: 39 })), idle(mon("Volcarona", "Flame Body"))),
    checks: "Shell Bell once: trunc(Σ dealt / 8), the Substitute's damage not counted (G4).",
  },
  {
    id: "G4-SPH-07-usum", title: "USUM: Parabolic Charge into its ally and the foes", game: "usum", outcomes: true,
    slots: slots(act(mon("Heliolisk", "Dry Skin", { hp: 60 }), "Parabolic Charge"), idle(lax(0)),
      idle(mon("Gyarados", "Intimidate")), idle(mon("Pelipper", "Keen Eye"))),
    checks: "A drain from the user's ally too (G7), each target in hit order.",
  },
  {
    id: "G4-SPH-08-champions", title: "Champions: Matcha Gotcha knocking a low-HP target out: its drain is from the HP it had", game: "champions", outcomes: true,
    slots: slots(act(mon("Sinistcha", "Hospitality", { hp: 50 }), "Matcha Gotcha"), idle(lax(0)),
      idle(mon("Rhyperior", "Lightning Rod", { hp: 20 })), idle(mon("Garchomp", "Rough Skin"))),
    checks: "A knocked-out target's damage is its HP (target.damage), so its drain is round(hp / 2) (G6).",
  },
  {
    id: "G4-SPH-09-champions", title: "Champions: Matcha Gotcha at full HP (no heal)", game: "champions", outcomes: true,
    slots: slots(act(mon("Sinistcha", "Hospitality"), "Matcha Gotcha"), idle(lax(0)),
      idle(mon("Rhyperior", "Lightning Rod")), idle(mon("Garchomp", "Rough Skin"))),
    checks: "heal() at full HP fails.",
  },
  {
    id: "G4-SPH-10-sv", title: "SV: Matcha Gotcha into two Snorlax from 20 HP (no cap): the two drains in order", game: "sv", outcomes: true,
    slots: slots(act(mon("Sinistcha", "Hospitality", { hp: 20 }), "Matcha Gotcha"), idle(lax(0)), idle(lax(4)), idle(lax(8))),
    checks: "round(dealt / 2) per target, summed onto the user's HP.",
  },
  {
    id: "G4-SPH-11-sv", title: "SV: the same with Big Root (each heal modified by itself)", game: "sv", outcomes: true,
    slots: slots(act(mon("Sinistcha", "Hospitality", { hp: 20, item: "Big Root" }), "Matcha Gotcha"), idle(lax(0)), idle(lax(4)), idle(lax(8))),
    checks: "Big Root: modify(round(dealt / 2), 5324/4096) per target.",
  },
  {
    id: "G4-SPH-12-swsh", title: "SwSh: Shell Bell Rock Slide into two Snorlax from 50 HP", game: "swsh", outcomes: true,
    slots: slots(act(mon("Tyranitar", "Unnerve", { item: "Shell Bell", hp: 50 }), "Rock Slide"), idle(lax(0)), idle(lax(4)), idle(lax(8))),
    checks: "Shell Bell once: trunc((d1 + d2) / 8).",
  },
  {
    id: "G4-SPH-13-champions", title: "Champions: Matcha Gotcha into two Snorlax from 20 HP", game: "champions", outcomes: true,
    slots: slots(act(mon("Sinistcha", "Hospitality", { hp: 20 }), "Matcha Gotcha"), idle(lax(0)), idle(lax(4)), idle(lax(8))),
    checks: "As G4-SPH-10 in Champions.",
  },
  {
    id: "G4-SPH-14-sv", title: "SV: Matcha Gotcha with a Liquid Ooze Tentacruel and a Snorlax from 15 HP: the Ooze can faint the user", game: "sv", outcomes: true,
    slots: slots(act(mon("Sinistcha", "Hospitality", { hp: 15 }), "Matcha Gotcha"), idle(lax(0)), idle(mon("Tentacruel", "Liquid Ooze")), idle(lax(8))),
    checks: "Liquid Ooze's raw drain first (to 0 when it reaches it), then no heal at 0 HP; the user faints in the faint batch.",
  },
];

// ---- Hidden stages (F4 §4.4) ----
const HIDDEN: Case[] = [
  {
    id: "G4-STP-01-sv", title: "SV: Stored Power with +2 evasion from an earlier turn", game: "sv",
    slots: slots(act(mon("Espathra", "Opportunist", { carried: { stages: { evasion: 2 } } }), "Stored Power", PL), idle(lax(0)), idle(lax(4)), idle(lax(8))),
    checks: "positiveBoosts counts evasion: 20 + 40 = 60 power.",
  },
  {
    id: "G4-STP-02-champions", title: "Champions: Stored Power with +1 Speed and +1 accuracy carried", game: "champions",
    slots: slots(act(mon("Espathra", "Opportunist", { boosts: { spe: 1 }, carried: { stages: { accuracy: 1 } } }), "Stored Power", PL), idle(lax(0)), idle(lax(4)), idle(lax(8))),
    checks: "20 + 20 × 2 = 60.",
  },
  {
    id: "G4-STP-03-usum", title: "USUM: Punishment into a +2 evasion target", game: "usum",
    slots: slots(act(mon("Absol", "Justified"), "Punishment", PL), idle(lax(0)), idle(lax(4, { carried: { stages: { evasion: 2 } } })), idle(lax(8))),
    checks: "punishment: 60 + 20 × the target's positive stages (evasion included) = 100.",
  },
  {
    id: "G4-STP-04-swsh", title: "SwSh: Power Trip with +1 accuracy carried", game: "swsh",
    slots: slots(act(mon("Krookodile", "Intimidate", { carried: { stages: { accuracy: 1 } } }), "Power Trip", PL), idle(lax(0)), idle(lax(4)), idle(lax(8))),
    checks: "20 + 20 = 40.",
  },
];

// ---- Glaive Rush (C5) ----
const GLAIVE: Case[] = [
  {
    id: "G4-GLV-01-sv", title: "SV: Baxcalibur's Glaive Rush, then a slower foe's Body Slam into it (2x)", game: "sv", outcomes: true,
    slots: slots(act(mon("Baxcalibur", "Thermal Exchange", { evs: { spe: 252 } }), "Glaive Rush", PL), idle(lax(0)),
      idle(lax(4)), act(lax(8), "Body Slam", OL)),
    checks: "glaiverush condition onSourceModifyDamage 2x until its next BeforeMove (Q1: 27 → 54).",
  },
  {
    id: "G4-GLV-02-sv", title: "SV: a carried Glaive Rush: a faster foe's hit is 2x, a slower one's normal (CR10b)", game: "sv", outcomes: true,
    slots: slots(act(mon("Baxcalibur", "Thermal Exchange", { carried: { glaiveRush: true } }), "Dragon Claw", PL), idle(lax(0)),
      act(mon("Jolteon", "Volt Absorb", { evs: { spe: 252 } }), "Thunderbolt", OL), act(lax(4), "Body Slam", OL)),
    checks: "glaiveRush carried: removed at Baxcalibur's BeforeMove (priority 100); Jolteon before it hits 2x, Snorlax after normally.",
  },
  {
    id: "G4-GLV-03-champions", title: "Champions: Baxcalibur's Glaive Rush, then a slower foe's Body Slam (2x)", game: "champions", outcomes: true,
    slots: slots(act(mon("Baxcalibur", "Thermal Exchange", { evs: { spe: 32 } }), "Glaive Rush", PL), idle(lax(0)),
      idle(lax(4)), act(lax(8), "Body Slam", OL)),
    checks: "As G4-GLV-01 in Champions.",
  },
];

// ---- Encore (F4 §6) ----
const ENCORE: Case[] = [
  {
    id: "G4-ENC-01-sv", title: "SV: Prankster Encore on a foe that used Protect last turn: its Thunderbolt becomes Protect (priority 0)", game: "sv",
    slots: slots(act(mon("Whimsicott", "Prankster"), "Encore", PL), act(lax(0), "Body Slam", PL),
      act(mon("Jolteon", "Volt Absorb", { lastMove: "Protect", moves: ["Protect"], evs: { spe: 252 } }), "Thunderbolt", OL), idle(lax(4))),
    checks: "encore onOverrideAction: Jolteon uses Protect at its Thunderbolt's priority; Snorlax's later Body Slam is blocked.",
  },
  {
    id: "G4-ENC-02-sv", title: "SV: Encore into a foe whose last move was Ice Beam, one foe left: the encored Ice Beam at that foe", game: "sv",
    slots: slots(act(mon("Whimsicott", "Prankster"), "Encore", PL), idle(mon("Snorlax", "Thick Fat", { absent: true })),
      act(mon("Jolteon", "Volt Absorb", { lastMove: "Ice Beam", moves: ["Ice Beam"], evs: { spe: 252 } }), "Thunderbolt", OL), idle(lax(4))),
    checks: "getRandomTarget: the one living foe; Thunderbolt's priority equals Ice Beam's.",
  },
];

// ---- One-hit KO moves' immunities (F4 §4.6; the hit itself waits for the fixed-damage row) ----
const OHKO: Case[] = [
  {
    id: "G4-OHK-02-sv", title: "SV: Sheer Cold into Glalie (Ice): immune", game: "sv",
    slots: slots(act(mon("Lapras", "Water Absorb"), "Sheer Cold", PL), idle(lax(0)), idle(mon("Glalie", "Inner Focus")), idle(lax(0))),
    checks: "hitStepAccuracy: Sheer Cold into an Ice type is [ohko] immune from generation 7.",
  },
  {
    id: "D-OHK-STURDY-sv", title: "SV: Fissure into a Sturdy Bastiodon: immune (TryHit)", game: "sv",
    slots: slots(act(mon("Excadrill", "Sand Rush"), "Fissure", PL), idle(lax(0)), idle(mon("Bastiodon", "Sturdy")), idle(lax(8))),
    checks: "sturdy onTryHit: OHKO moves fail.",
  },
  {
    id: "D-OHK-LEVITATE-usum", title: "USUM: Fissure into a Levitate Gengar and Horn Drill into... a Ghost: immune", game: "usum",
    slots: slots(act(mon("Rhydon", "Lightning Rod"), "Fissure", PL), act(mon("Rhydon", "Lightning Rod"), "Horn Drill", PR), idle(mon("Bronzong", "Levitate")), idle(mon("Gengar", "Cursed Body"))),
    checks: "runImmunity: Ground into a Levitate holder (isGrounded null); Normal into a Ghost.",
  },
];

// ---- Ripen's weakened Berry (carried) ----
const RIPEN: Case[] = [
  {
    id: "D-RIP-01-sv", title: "SV: a carried weakened Berry on Appletun: the first hit into it is halved, the next not", game: "sv",
    slots: slots(idle(mon("Appletun", "Ripen", { carried: { berryWeaken: true } })), idle(lax(0)),
      act(mon("Jolteon", "Volt Absorb", { evs: { spe: 252 } }), "Tackle", OL), act(lax(4), "Tackle", OL)),
    checks: "ripen onSourceModifyDamage: berryWeaken halves one damage calculation, then false.",
  },
];

// ---- Fling's own Try (F4 §4.5) ----
const FLING: Case[] = [
  {
    id: "D-FLG-01-sv", title: "SV: Fling with no item fails; Klutz Fling fails", game: "sv",
    slots: slots(act(mon("Golurk", "Klutz", { item: "Life Orb" }), "Fling", PL), act(mon("Sneasler", "Poison Touch"), "Fling", PR), idle(lax(4)), idle(lax(8))),
    checks: "fling onPrepareHit: ignoringItem(true) (Klutz) and no item: the move fails.",
  },
  {
    id: "D-FLG-02-sv", title: "SV: Unburden Sneasler flings a Life Orb into Snorlax (no recoil), then outspeeds", game: "sv", outcomes: true,
    slots: slots(act(mon("Sneasler", "Unburden", { item: "Life Orb" }), "Fling", PL), idle(lax(0)), act(lax(4), "Body Slam", OL), idle(lax(8))),
    checks: "Life Orb's ×1.3 on the flung item's 30 power, no recoil (the item is gone at the hit's Update); Unburden active after.",
  },
  {
    id: "D-FLG-03-sv", title: "SV: a flung Flame Orb burns Snorlax before its Body Slam", game: "sv", outcomes: true,
    slots: slots(act(mon("Sneasler", "Pressure", { item: "Flame Orb", evs: { spe: 252 } }), "Fling", PL), idle(lax(0)), act(lax(4), "Body Slam", OL), idle(lax(8))),
    checks: "fling.status brn as a 100 % secondary; the burned Body Slam does half.",
  },
  {
    id: "D-FLG-04-sv", title: "SV: a flung Sitrus Berry into the user's own ally at low HP: the ally eats it", game: "sv", outcomes: true,
    slots: slots(act(mon("Sneasler", "Pressure", { item: "Sitrus Berry", evs: { spe: 252 } }), "Fling", OR), idle(lax(0, { hp: 60 })), idle(lax(4)), idle(lax(8))),
    checks: "A flung Berry: the target eats it (singleEvent Eat): +1/4.",
  },
  {
    id: "D-FLG-05-sv", title: "SV: a flung King's Rock flinches a slower Snorlax", game: "sv", outcomes: true,
    slots: slots(act(mon("Sneasler", "Pressure", { item: "King's Rock", evs: { spe: 252 } }), "Fling", PL), idle(lax(0)), act(lax(4), "Body Slam", OL), idle(lax(8))),
    checks: "fling.volatileStatus flinch: Snorlax's Body Slam is lost.",
  },
  {
    id: "D-FLG-06-sv", title: "SV: a flung White Herb restores the ally's lowered stats before its attack", game: "sv", outcomes: true,
    slots: slots(act(mon("Sneasler", "Pressure", { item: "White Herb", evs: { spe: 252 } }), "Fling", OR), act(lax(0, { boosts: { atk: -2 } }), "Body Slam", PL), idle(lax(4)), idle(lax(8))),
    checks: "fling.effect: White Herb's onUse on the target.",
  },
  {
    id: "D-FLG-07-champions", title: "Champions: a flung Poison Barb poisons Snorlax", game: "champions", outcomes: true,
    slots: slots(act(mon("Sneasler", "Pressure", { item: "Poison Barb", evs: { spe: 32 } }), "Fling", PL), idle(lax(0)), act(lax(4), "Body Slam", OL), idle(lax(8))),
    checks: "fling.status psn as a certain secondary in Champions: Snorlax loses 1/8 at the end of turn.",
  },
  {
    id: "D-FLG-08-sv", title: "SV: a flung Liechi Berry raises the ally's Attack before its Body Slam", game: "sv", outcomes: true,
    slots: slots(act(mon("Sneasler", "Pressure", { item: "Liechi Berry", evs: { spe: 252 } }), "Fling", OR), act(lax(0), "Body Slam", PL), idle(lax(4)), idle(lax(8))),
    checks: "A flung pinch Berry: the Eat's boost() on the target (+1 Atk), no HP line.",
  },
  {
    id: "D-FLG-09-sv", title: "SV: a flung Toxic Orb into a Synchronize Umbreon: both badly poisoned", game: "sv", outcomes: true,
    slots: slots(act(mon("Ambipom", "Skill Link", { item: "Toxic Orb", evs: { spe: 252 } }), "Fling", PL), idle(lax(0)), idle(mon("Umbreon", "Synchronize")), idle(lax(8))),
    checks: "fling.status tox as a certain secondary; Synchronize passes it back to the thrower; end of turn 1/16 each.",
  },
  {
    id: "D-FLG-10-sv", title: "SV: a flung Lum Berry cures the burned ally before its Body Slam", game: "sv", outcomes: true,
    slots: slots(act(mon("Sneasler", "Pressure", { item: "Lum Berry", evs: { spe: 252 } }), "Fling", OR), act(lax(0, { status: "brn" }), "Body Slam", PL), idle(lax(4)), idle(lax(8))),
    checks: "A flung Lum Berry: the burn is cured in the hit; the Body Slam is not halved; no burn at the end of turn.",
  },
  {
    id: "D-FLG-11-sv", title: "SV: a flung Mental Herb ends the infatuated ally's attraction before its Body Slam", game: "sv", outcomes: true,
    slots: slots(act(mon("Sneasler", "Pressure", { item: "Mental Herb", evs: { spe: 252 } }), "Fling", OR), act(lax(0, { gender: "M", carried: { attract: PL } }), "Body Slam", PL),
      idle(lax(4, { gender: "F" })), idle(lax(8))),
    checks: "fling.effect: Mental Herb's onUse on the target: attract ends (with the others), so the Body Slam is never immobilised.",
  },
  {
    id: "D-FLG-12-sv", title: "SV: Fling into Protect: the Life Orb is still gone, Unburden on", game: "sv", outcomes: true,
    slots: slots(act(mon("Sneasler", "Unburden", { item: "Life Orb" }), "Fling", PL), idle(lax(0)), act(lax(4), "Protect"), idle(lax(8))),
    checks: "The fling volatile from onPrepareHit takes the item at the action's Update though Protect blocked the hit; no recoil.",
  },
  {
    id: "D-FLG-13-sv", title: "SV: a flung Figy Berry heals and confuses a Modest ally before its Body Slam", game: "sv", outcomes: true,
    slots: slots(act(mon("Sneasler", "Pressure", { item: "Figy Berry", evs: { spe: 252 } }), "Fling", OR), act(lax(0, { hp: 60, nature: "Modest" }), "Body Slam", PL), idle(lax(4)), idle(lax(8))),
    checks: "Figy Berry onEat: heals 1/3, confusion for a −Atk Nature; then the confused ally's Body Slam (1/3 self-hit).",
  },
  {
    id: "D-FLG-14-sv", title: "SV: a Sheer Force Feraligatr's flung Flame Orb still burns (E9)", game: "sv", outcomes: true,
    slots: slots(act(mon("Feraligatr", "Sheer Force", { item: "Flame Orb", evs: { spe: 252 } }), "Fling", PL), idle(lax(0)), act(lax(4), "Body Slam", OL), idle(lax(8))),
    checks: "Fling's status secondary is added in onPrepareHit, after Sheer Force's onModifyMove: the burn lands, no Sheer Force boost.",
  },
  {
    id: "D-FLG-15-sv", title: "SV: a flung Starf Berry raises a random stat of the ally by 2 before its Body Slam", game: "sv", outcomes: true,
    slots: slots(act(mon("Sneasler", "Pressure", { item: "Starf Berry", evs: { spe: 252 } }), "Fling", OR), act(lax(0), "Body Slam", PL), idle(lax(4)), idle(lax(8))),
    checks: "Starf Berry onEat: this.sample over the stats below +6: +2 Atk 1/5 of the time.",
  },
  {
    id: "D-FLG-16-sv", title: "SV: a flung Sitrus Berry into an ally whose own Liechi Berry the hit makes due: not followed", game: "sv", notEstimated: "Fling with Sitrus Berry is not modelled in 2v2.",
    slots: slots(act(mon("Sneasler", "Pressure", { item: "Sitrus Berry", evs: { spe: 252 } }), "Fling", OR), idle(lax(0, { hp: 62, item: "Liechi Berry" })), idle(lax(4)), idle(lax(8))),
    checks: "The flung Sitrus heals in onHit, before the hit's Update, where the ally's Liechi at a quarter is then no longer due; the step ate it.",
  },
  {
    id: "D-FLG-17-sv", title: "SV: a flung Razor Fang does not flinch an Inner Focus Dragonite", game: "sv", outcomes: true,
    slots: slots(act(mon("Sneasler", "Pressure", { item: "Razor Fang", evs: { spe: 252 } }), "Fling", PL), idle(lax(0)), act(mon("Dragonite", "Inner Focus"), "Body Slam", OL), idle(lax(8))),
    checks: "fling.volatileStatus flinch: Inner Focus stops it; Dragonite's Body Slam goes on.",
  },
  {
    id: "D-FLG-18-sv", title: "SV: a flung Sitrus Berry into a Cud Chew Farigiraf ally at low HP", game: "sv", outcomes: true,
    slots: slots(act(mon("Sneasler", "Pressure", { item: "Sitrus Berry", evs: { spe: 252 } }), "Fling", OR), idle(mon("Farigiraf", "Cud Chew", { hp: 60 })), idle(lax(4)), idle(lax(8))),
    endNotEstimated: "Cud Chew is not modelled in 2v2.",
    checks: "A flung Berry eaten by a Cud Chew holder: EatItem sets its Berry (counter 2), which the end of turn guards as any Cud Chew Berry.",
  },
  {
    id: "D-FLG-19-sv", title: "SV: a flung Sitrus Berry into an ally whose own Sitrus stays above its line", game: "sv", outcomes: true,
    slots: slots(act(mon("Sneasler", "Pressure", { item: "Sitrus Berry", evs: { spe: 252 } }), "Fling", OR), idle(lax(0, { hp: 130, item: "Sitrus Berry" })), idle(lax(4)), idle(lax(8))),
    checks: "The flung Sitrus heals 1/4 in onHit; the ally keeps its own (never at half).",
  },
];

export const W1A_D_CASES: Case[] = [...COPIES, ...LOCK, ...SPREAD, ...HIDDEN, ...GLAIVE, ...ENCORE, ...OHKO, ...RIPEN, ...FLING];
