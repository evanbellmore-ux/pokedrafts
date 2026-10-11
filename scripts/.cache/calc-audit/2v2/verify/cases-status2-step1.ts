// status2 Step 1 (SPEC2 §8.2, ADDENDUM2 §8.2): the correctness fixes' oracle cases, each against pinned Showdown c23d2e94.
// Ids as the designs name them (G4- guards.md F1-F3 and §4.10; F2- types-volatiles.md §4; T2P-UNB tier2-presence.md §5.1;
// FX- and T2M-VS tier2-moves.md §5 renamed by ADDENDUM2 §7.2; CQ- ADDENDUM2 §7.2; IN-SW tier2-eot-training.md §4.7.5;
// S1-RSP SPEC2 §8.2 #7), each with its game suffix. Showdown names; level 50, 31 IVs, Serious nature and 0 EVs unless set
// (Champions: Stat Points). Wired into cases-se.ts as cases-review.ts is.
import type { Case, CaseAction, CaseMon, SlotId } from "./case-types";

type Slot = CaseMon & { action: CaseAction };
const mon = (species: string, ability: string, extra: Partial<CaseMon> = {}): CaseMon => ({ species, ability, ...extra });
const act = (m: CaseMon, move: string | null, target?: SlotId): Slot => ({ ...m, action: { move, ...(target ? { target } : {}) } });
const idle = (m: CaseMon): Slot => act(m, null);
const slots = (ownLeft: Slot, ownRight: Slot, oppLeft: Slot, oppRight: Slot): Case["slots"] =>
  ({ "own-left": ownLeft, "own-right": ownRight, "opponent-left": oppLeft, "opponent-right": oppRight });
const OL: SlotId = "own-left", OR: SlotId = "own-right", PL: SlotId = "opponent-left", PR: SlotId = "opponent-right";
const lax = (spe: number, extra: Partial<CaseMon> = {}): CaseMon => mon("Snorlax", "Thick Fat", { evs: { spe }, ...extra });

// ---- #1 Ally targets in the pairwise step: no Defiant, Competitive, Opportunist or Mirror Herb (guards.md F1) ----
const ALLY: Case[] = [
  {
    id: "G4-ALY-01-sv", title: "Bulldoze into the user's own Defiant partner, which then uses Kowtow Cleave (GA5b)", game: "sv",
    slots: slots(act(mon("Garchomp", "Rough Skin", { evs: { spe: 252 } }), "Bulldoze"), act(mon("Kingambit", "Defiant"), "Kowtow Cleave", PL), idle(lax(4)), idle(lax(12))),
    checks: "PS/data/abilities.ts defiant onAfterEachBoost returns for an ally's drop: Kowtow Cleave at +0 Attack (88-105), not +2.",
  },
  {
    id: "G4-ALY-02-swsh", title: "SwSh: Bulldoze into the user's own Competitive Milotic, which then uses Scald", game: "swsh",
    slots: slots(act(mon("Garchomp", "Rough Skin", { evs: { spe: 252 } }), "Bulldoze"), act(mon("Milotic", "Competitive"), "Scald", PL), idle(lax(4)), idle(lax(12))),
    checks: "competitive onAfterEachBoost returns for an ally's drop: Scald at +0 Sp. Atk.",
  },
  {
    id: "G4-ALY-03-champions", title: "Champions: Aerodactyl's Bulldoze into its Defiant Kingambit partner, then Kowtow Cleave", game: "champions",
    slots: slots(act(mon("Aerodactyl", "Pressure", { evs: { spe: 32 } }), "Bulldoze"), act(mon("Kingambit", "Defiant"), "Kowtow Cleave", PL), idle(lax(4)), idle(lax(12))),
    checks: "No Defiant rise from the ally's drop in Champions.",
  },
  {
    id: "G4-ALY-04-sv", title: "Flame Charge into the user's own Opportunist partner, no foe copier (GA3, E2)", game: "sv", outcomes: true,
    slots: slots(act(mon("Arcanine", "Intimidate", { evs: { spe: 252 } }), "Flame Charge", OR), idle(mon("Espathra", "Opportunist")), idle(lax(4)), idle(lax(12))),
    checks: "opportunist onFoeAfterBoost: an ally's rise is not copied; E2 Espathra keeps +0 Speed.",
  },
];

// ---- #2 Champions: a Sheer Force hit locks a Berserk / Anger Shell Berry (guards.md F2) ----
const drampa = (extra: Partial<CaseMon> = {}) => mon("Drampa", "Berserk", { item: "Sitrus Berry", hp: 140, ...extra });
const LOCK: Case[] = [
  {
    id: "G4-SFL-01-champions", title: "Champions: a Sheer Force Crunch on a Berserk Sitrus holder, then a later Body Slam on it (GA2)", game: "champions",
    notEstimated: "Sitrus Berry held by Berserk after a Sheer Force hit is not modelled in 2v2.",
    slots: slots(act(drampa(), "Dragon Pulse", PR), idle(mon("Venusaur", "Overgrow", { evs: { spe: 4 } })),
      act(mon("Feraligatr", "Sheer Force", { evs: { atk: 32, spe: 32 } }), "Crunch", OL), act(mon("Snorlax", "Thick Fat"), "Body Slam", OL)),
    checks: "PS/data/mods/champions/abilities.ts berserk onDamage has no Sheer Force clause: the Sitrus stays held (locked); the later Body Slam's AfterMoveSecondary resets it (Showdown: KO 1.95 %): not followed in Step 1 (D models the later hit).",
  },
  {
    id: "G4-SFL-02-champions", title: "Champions: the same Sheer Force Crunch, then the Berserk holder's own No move (Splash) (GA2b)", game: "champions",
    slots: slots(idle(drampa()), idle(mon("Venusaur", "Overgrow", { evs: { spe: 4 } })),
      act(mon("Feraligatr", "Sheer Force", { evs: { atk: 32, spe: 32 } }), "Crunch", OL), idle(mon("Snorlax", "Thick Fat"))),
    checks: "Splash runs AfterMoveSecondary on its user: the lock resets and the Sitrus is eaten at that action's Update.",
  },
  {
    id: "G4-SFL-02b-champions", title: "Champions: a slower Steelix's Sheer Force Crunch after Drampa's Splash: the Sitrus stays held to the end of the turn", game: "champions", outcomes: true,
    slots: slots(idle(drampa({ hp: 100 })), idle(mon("Venusaur", "Overgrow", { evs: { spe: 4 } })),
      act(mon("Steelix", "Sheer Force", { evs: { atk: 32 } }), "Crunch", OL), idle(mon("Snorlax", "Thick Fat", { evs: { spe: 8 } }))),
    checks: "Drampa's Splash comes before the Crunch; the lock stands through the end of turn (no residual damage): the Sitrus is held after the turn (E2).",
  },
  {
    id: "G4-SFL-03-sv", title: "SV: a Sheer Force Crunch into an Anger Shell Klawf with a Sitrus Berry, then a later Body Slam: no lock", game: "sv",
    slots: slots(act(mon("Klawf", "Anger Shell", { item: "Sitrus Berry", hp: 110 }), "Rock Slide"), idle(mon("Venusaur", "Overgrow", { evs: { spe: 4 } })),
      act(mon("Feraligatr", "Sheer Force", { evs: { atk: 252, spe: 252 } }), "Crunch", OL), act(mon("Snorlax", "Thick Fat"), "Body Slam", OL)),
    checks: "PS/data/abilities.ts angershell onDamage: a Sheer Force hit leaves checkedAngerShell true: the Sitrus is eaten at the hit's Update; no Anger Shell rise (no AfterMoveSecondary).",
  },
  {
    id: "G4-SFL-03-usum", title: "USUM: the same Sheer Force Crunch into a Berserk Drampa: no lock (Sheer Force clause)", game: "usum",
    slots: slots(act(drampa({ hp: 120 }), "Dragon Pulse", PR), idle(mon("Venusaur", "Overgrow", { evs: { spe: 4 } })),
      act(mon("Feraligatr", "Sheer Force", { evs: { atk: 252, spe: 252 } }), "Crunch", OL), act(mon("Snorlax", "Thick Fat"), "Body Slam", OL)),
    checks: "PS/data/abilities.ts berserk onDamage: a Sheer Force hit leaves checkedBerserk true: the Sitrus is eaten at the hit's Update.",
  },
];

// ---- #3 Color Change (types-volatiles.md §4; TV25, TW17) ----
const COLOR: Case[] = [
  {
    id: "F2-CC1-usum", title: "USUM: Thunderbolt into Kecleon (Color Change), then its ally's Earthquake (2x)", game: "usum",
    slots: slots(act(mon("Jolteon", "Volt Absorb", { evs: { spe: 252 } }), "Thunderbolt", PL), idle(mon("Chansey", "Natural Cure")),
      idle(mon("Kecleon", "Color Change")), act(mon("Garchomp", "Rough Skin"), "Earthquake")),
    checks: "PS/data/abilities.ts colorchange onAfterMoveSecondary: Kecleon becomes Electric; Earthquake is 2x into it (TV25: a certain KO).",
  },
  {
    id: "F2-CC2-usum", title: "USUM: the same behind a Substitute: no type change", game: "usum",
    slots: slots(act(mon("Jolteon", "Volt Absorb", { evs: { spe: 252 } }), "Thunderbolt", PL), idle(mon("Chansey", "Natural Cure")),
      idle(mon("Kecleon", "Color Change", { substitute: 33 })), act(mon("Garchomp", "Rough Skin"), "Earthquake")),
    checks: "TW17: a hit into the Substitute runs no AfterMoveSecondary on Kecleon: it stays Normal (Earthquake 1x).",
  },
  {
    id: "F2-CC3-usum", title: "USUM: a Sheer Force Poison Jab into Kecleon: no type change; Chansey's later Psychic 1x", game: "usum",
    slots: slots(act(mon("Nidoking", "Sheer Force", { evs: { spe: 252 } }), "Poison Jab", PL), act(mon("Chansey", "Natural Cure"), "Psychic", PL),
      idle(mon("Kecleon", "Color Change")), idle(mon("Garchomp", "Rough Skin"))),
    checks: "A Sheer Force move with secondaries runs no AfterMoveSecondary (sim/battle-actions.ts:811-816): Kecleon keeps Normal (a Poison type would take Psychic 2x).",
  },
  {
    id: "F2-CC4-usum", title: "USUM: the same Poison Jab without Sheer Force: Kecleon becomes Poison; Chansey's Psychic 2x", game: "usum",
    slots: slots(act(mon("Nidoking", "Poison Point", { evs: { spe: 252 } }), "Poison Jab", PL), act(mon("Chansey", "Natural Cure"), "Psychic", PL),
      idle(mon("Kecleon", "Color Change")), idle(mon("Garchomp", "Rough Skin"))),
    checks: "The control for F2-CC3: Color Change to Poison, then Psychic super effective.",
  },
];

// ---- #4 Trace's copied curing ability: the facts (guards.md F3; GA1, GA1b) ----
const TRACE: Case[] = [
  {
    id: "G4-TRC-01-sv", title: "An asleep Trace holder that copied Insomnia: cured at the turn's first Update (GA1b)", game: "sv",
    slots: slots(act(mon("Gardevoir", "Trace", { status: "slp", evs: { spe: 252 }, appBuild: { tracedAbility: "insomnia" } }), "Psychic", PL),
      idle(mon("Snorlax", "Thick Fat", { evs: { spe: 4 } })), idle(mon("Hypno", "Insomnia")), idle(mon("Hypno", "Insomnia", { evs: { spe: 8 } }))),
    checks: "The settle writes Insomnia into abilityId: the cure fact, and no \"lost no turns to sleep\" fact.",
  },
  {
    id: "G4-TRC-02-usum", title: "USUM: a paralysed Trace holder that copied Limber moves (GA1 in USUM)", game: "usum",
    slots: slots(act(mon("Gardevoir", "Trace", { status: "par", evs: { spe: 252 }, appBuild: { tracedAbility: "limber" } }), "Psychic", PL),
      idle(mon("Snorlax", "Thick Fat", { evs: { spe: 4 } })), idle(mon("Persian", "Limber")), idle(mon("Persian", "Limber", { evs: { spe: 8 } }))),
    checks: "Limber cures the paralysis at the first Update: no full-paralysis roll.",
  },
];

// ---- #5 Ghost Curse: the user's cost is a loss, its faint another faint (guards.md §4.10; J1) ----
const CURSE: Case[] = [
  {
    id: "G4-CRS-01-sv", title: "A Ghost type's Curse at under half HP faints its user (J1)", game: "sv",
    slots: slots(act(mon("Gengar", "Cursed Body", { hp: 60, evs: { spe: 252 } }), "Curse", PL), idle(lax(4)), idle(lax(8)), idle(lax(12))),
    checks: "PS/data/moves.ts curse onHit: directDamage(maxhp / 2) to the user: Gengar 60/135 faints; the target is cursed (-29 at the end of turn).",
  },
  {
    id: "G4-CRS-02-champions", title: "Champions: Mimikyu's Curse at 40 % HP faints it", game: "champions",
    slots: slots(act(mon("Mimikyu", "Disguise", { hp: 50, evs: { spe: 32 } }), "Curse", PL), idle(lax(4)), idle(lax(8)), idle(lax(12))),
    checks: "Disguise does not take the Curse cost (not a Move effect): the user faints.",
  },
];

// ---- #9 Unburden at the turn's first Update (tier2-presence.md §5.1; UB2) ----
const unburden = (game: Case["game"]): Case => ({
  id: `T2P-UNB-0${game === "sv" ? 1 : game === "usum" ? 2 : 3}-${game}`, game,
  title: `${game}: a paralysed Unburden holder's Lum Berry at the turn's first Update: the order against a foe between its speeds`,
  slots: slots(act(mon(game === "usum" ? "Hawlucha" : "Sneasler", "Unburden", { item: "Lum Berry", status: "par", silentStatus: true }), game === "usum" ? "Tackle" : "Poison Jab", PR), idle(lax(8)),
    idle(lax(16)), act(mon("Garchomp", "Rough Skin", { evs: game === "champions" ? { spe: 4 } : {} }), "Dragon Claw", OL)),
  checks: "Unburden doubles the holder's Speed after the Lum Berry: generation 8 on sorts the first move after that Update (the holder first); USUM's order is frozen before it (Garchomp first).",
});
const UNBURDEN: Case[] = [
  unburden("sv"), unburden("usum"), unburden("champions"),
  {
    id: "T2P-UNB-04-usum", title: "USUM: a paralysed Mold Breaker Hawlucha's Lum Berry at the first Update: the frozen order reads the paralysis", game: "usum",
    slots: slots(act(mon("Hawlucha", "Mold Breaker", { item: "Lum Berry", status: "par", silentStatus: true }), "Tackle", PR), idle(lax(8)),
      idle(lax(16)), act(mon("Garchomp", "Rough Skin"), "Dragon Claw", OL)),
    checks: "Generation 7 sorts the turn before its first Update: Hawlucha's paralysed Speed (69) below Garchomp's (122), though the Lum Berry cures it before either moves.",
  },
  {
    id: "T2P-UNB-05-usum", title: "USUM: a burned Quick Feet Jolteon's Lum Berry at the first Update: the frozen order reads Quick Feet (225 against Crobat's 182)", game: "usum",
    slots: slots(act(mon("Jolteon", "Quick Feet", { item: "Lum Berry", status: "brn", silentStatus: true }), "Thunderbolt", PR), idle(lax(8)),
      idle(lax(16)), act(mon("Crobat", "Inner Focus", { evs: { spe: 252 } }), "Brave Bird", OL)),
    checks: "The status the Berry cures at the first Update is on Jolteon as generation 7 sorts: Quick Feet's 1.5x (150 to 225) puts it before Crobat (182).",
  },
];

// ---- #10 Crash damage (tier2-moves.md §3.1.7, C24; T2-CR01-05, T2A-CR1-3, CQ04) ----
const kicker = (species: string, extra: Partial<CaseMon> = {}) => mon(species, "Limber", extra);
const CRASH: Case[] = [
  {
    id: "FX-CR-01-sv", title: "High Jump Kick into a Protect user: the kicker loses half its maximum HP (T2A-CR1)", game: "sv",
    slots: slots(act(mon("Dragonite", "Inner Focus", { evs: { spe: 252 } }), "Protect"), idle(lax(4)), act(kicker("Hitmonlee"), "High Jump Kick", OL), idle(lax(8))),
    checks: "PS/data/moves.ts highjumpkick onMoveFail: trunc(baseMaxhp / 2) = 62 of 125.",
  },
  {
    id: "FX-CR-01-champions", title: "Champions: High Jump Kick into a Protect user", game: "champions",
    slots: slots(act(mon("Dragonite", "Inner Focus", { evs: { spe: 32 } }), "Protect"), idle(lax(20)), act(mon("Hawlucha", "Limber"), "High Jump Kick", OL), idle(lax(24))),
    checks: "The crash in Champions.",
  },
  {
    id: "FX-CR-02-champions", title: "Champions: High Jump Kick into a Ghost type (immune): crash (T2A-CR2)", game: "champions",
    slots: slots(idle(mon("Gengar", "Cursed Body", { evs: { spe: 32 } })), idle(lax(20)), act(mon("Hawlucha", "Limber"), "High Jump Kick", OL), idle(lax(24))),
    checks: "A type immunity fails every target: crash 76 of 153.",
  },
  {
    id: "FX-CR-02-sv", title: "High Jump Kick into a Ghost type (immune): crash", game: "sv",
    slots: slots(idle(mon("Gengar", "Cursed Body", { evs: { spe: 252 } })), idle(lax(4)), act(kicker("Hitmonlee"), "High Jump Kick", OL), idle(lax(8))),
    checks: "The type immunity: crash.",
  },
  {
    id: "FX-CR-03-usum", title: "USUM: Jump Kick into a Protect user: crash", game: "usum",
    slots: slots(act(mon("Dragonite", "Inner Focus", { evs: { spe: 252 } }), "Protect"), idle(lax(4)), act(kicker("Hitmonlee"), "Jump Kick", OL), idle(lax(8))),
    checks: "Jump Kick (USUM only) has hasCrashDamage too.",
  },
  {
    id: "FX-CR-03b-usum", title: "USUM: Jump Kick into a Ghost type: crash", game: "usum",
    slots: slots(idle(mon("Gengar", "Cursed Body", { evs: { spe: 252 } })), idle(lax(4)), act(kicker("Hitmonlee"), "Jump Kick", OL), idle(lax(8))),
    checks: "Jump Kick's type immunity: crash.",
  },
  {
    id: "FX-CR-04-sv", title: "Supercell Slam into a Protect user, then the kicker's ally Body Slams it (T2A-CR3)", game: "sv",
    slots: slots(act(mon("Dragonite", "Inner Focus", { evs: { spe: 252 } }), "Protect"), idle(lax(4)),
      act(mon("Pawmot", "Volt Absorb", { item: "Sitrus Berry", evs: { spe: 100 } }), "Supercell Slam", OL), act(mon("Snorlax", "Thick Fat"), "Body Slam", PL)),
    checks: "The crash takes Pawmot under half: its Sitrus at the action's Update; the ally's Body Slam reads that HP.",
  },
  {
    id: "FX-CR-04-champions", title: "Champions: Supercell Slam into Protect, then the kicker's ally Body Slams it", game: "champions",
    slots: slots(act(mon("Dragonite", "Inner Focus", { evs: { spe: 32 } }), "Protect"), idle(lax(20)),
      act(mon("Pawmot", "Volt Absorb", { item: "Sitrus Berry", evs: { spe: 20 } }), "Supercell Slam", OL), act(mon("Snorlax", "Thick Fat"), "Body Slam", PL)),
    checks: "The crash in Champions with a later move reading it.",
  },
  {
    id: "FX-CR-05-sv", title: "Axe Kick into a Ghost type: crash", game: "sv",
    slots: slots(idle(mon("Gengar", "Cursed Body", { evs: { spe: 252 } })), idle(lax(4)), act(kicker("Hitmonlee"), "Axe Kick", OL), idle(lax(8))),
    checks: "Axe Kick has hasCrashDamage (SV, Champions).",
  },
  {
    id: "FX-CR-06-sv", title: "A faster Fly user, then High Jump Kick into it (a miss): not followed past the charge (H models the miss)", game: "sv",
    notEstimated: "Dragonite is semi-invulnerable after Fly: later moves are not modelled.",
    slots: slots(act(mon("Dragonite", "Inner Focus", { evs: { spe: 252 } }), "Fly", PL), idle(lax(4)), act(kicker("Hitmonlee"), "High Jump Kick", OL), idle(lax(8))),
    checks: "The miss into a hidden target is a failure (crash); the hidden state is H's (wave 1a).",
  },
  {
    id: "CQ-CRS-01a-sv", title: "Supercell Slam into a Volt Absorb Lanturn (absorbed): crash (CQ04d)", game: "sv",
    slots: slots(act(mon("Pawmot", "Volt Absorb"), "Supercell Slam", PR), idle(lax(20)), idle(lax(28)), idle(mon("Lanturn", "Volt Absorb", { hp: 100 }))),
    checks: "An absorbing ability fails the target (TryHit): crash 72 of 145; Lanturn heals a quarter.",
  },
  {
    id: "CQ-CRS-01b-sv", title: "High Jump Kick under Gravity: stopped at BeforeMove, no crash (CQ04c)", game: "sv", field: { gravity: true },
    slots: slots(act(kicker("Hitmonlee", { evs: { spe: 4 } }), "High Jump Kick", PR), idle(lax(20)), idle(lax(28)), idle(lax(24))),
    checks: "Gravity's onBeforeMove: cant, no MoveFail.",
  },
  {
    id: "CQ-CRS-02-sv", title: "High Jump Kick into Spiky Shield: 1/8, then the crash (CQ04b)", game: "sv",
    slots: slots(act(kicker("Hitmonlee", { evs: { spe: 4 } }), "High Jump Kick", PR), idle(lax(20)), idle(lax(28)), act(mon("Chesnaught", "Bulletproof", { evs: { spe: 252 } }), "Spiky Shield")),
    checks: "Spiky Shield's contact damage (15), then the crash (62).",
  },
  {
    id: "CQ-CRS-02-usum", title: "USUM: High Jump Kick into Spiky Shield", game: "usum",
    slots: slots(act(kicker("Hitmonlee", { evs: { spe: 4 } }), "High Jump Kick", PR), idle(lax(20)), idle(lax(28)), act(mon("Chesnaught", "Bulletproof", { evs: { spe: 252 } }), "Spiky Shield")),
    checks: "The same in USUM.",
  },
  {
    id: "CQ-CRS-03-sv", title: "High Jump Kick into a Substitute: the Substitute takes it, no crash (CQ04e)", game: "sv",
    slots: slots(act(kicker("Hitmonlee", { evs: { spe: 4 } }), "High Jump Kick", PR), idle(lax(20)), idle(lax(28)), idle(lax(24, { substitute: 20 }))),
    checks: "A hit into a Substitute is a hit: no MoveFail.",
  },
];

// ---- #12 Burning Jealousy and Alluring Voice (tier2-moves.md §3.2; T2A-VS1, T2-VS01, T2-VS02) ----
const VOLATILE: Case[] = [
  {
    id: "FX-BJ-01-sv", title: "Burning Jealousy as the last action into a foe whose Attack rose this turn: the end-of-turn burn (T2A-VS1)", game: "sv",
    slots: slots(act(mon("Torkoal", "White Smoke"), "Burning Jealousy"), idle(lax(20)), act(mon("Lucario", "Inner Focus", { evs: { spe: 252 } }), "Swords Dance"), idle(lax(24))),
    checks: "PS/data/moves.ts burningjealousy secondary onHit: statsRaisedThisTurn: burned; burn damage at the end of turn.",
  },
  {
    id: "FX-BJ-02-champions", title: "Champions: Burning Jealousy as the last action into a raised foe", game: "champions",
    slots: slots(act(mon("Torkoal", "White Smoke"), "Burning Jealousy"), idle(lax(20)), act(mon("Lucario", "Inner Focus", { evs: { spe: 32 } }), "Swords Dance"), idle(lax(24))),
    checks: "The burn in Champions.",
  },
  ...(["sv", "swsh"] as const).map((game): Case => ({
    id: `T2M-VS-01-${game}`, title: `${game}: Howl, then Burning Jealousy burns both raised foes; the burned foe's later Body Slam is halved (T2-VS01)`, game,
    slots: slots(act(mon("Torkoal", "White Smoke", { evs: { spe: 32 } }), "Burning Jealousy"), idle(lax(20)),
      act(mon("Snorlax", "Thick Fat", { ivs: { spe: 0 }, nature: "Brave" }), "Body Slam", OL), act(mon("Arcanine", "Intimidate", { evs: { spe: 252 } }), "Howl")),
    checks: "Howl raises both foes (gen 8+: allies): Burning Jealousy burns both; the Body Slam at +1 Attack burned.",
  })),
  ...(["sv", "champions"] as const).map((game): Case => ({
    id: `T2M-VS-03-${game}`, title: `${game}: Howl, then Alluring Voice confuses the raised foe; its later Body Slam (T2-VS02)`, game,
    slots: slots(act(mon("Sylveon", "Cute Charm", { evs: { spe: 32 } }), "Alluring Voice", PL), idle(lax(20)),
      act(mon("Snorlax", "Thick Fat", { ivs: { spe: 0 }, nature: "Brave" }), "Body Slam", OL), act(mon("Arcanine", "Intimidate", { evs: { spe: game === "champions" ? 32 : 252 } }), "Howl")),
    checks: "PS/data/moves.ts alluringvoice secondary onHit: statsRaisedThisTurn: confused; its Body Slam with a third's self-hit.",
  })),
];

// ---- #13 Spectral Thief (tier2-moves.md §3.2; T2A-VS3, T2-VS03, T2-VS03b) ----
const marshadow = (extra: Partial<CaseMon> = {}) => mon("Marshadow", "Technician", { evs: { spe: 252 }, ...extra });
const THIEF: Case[] = [
  ...(["swsh", "usum"] as const).map((game): Case => ({
    id: `FX-ST-01-${game}`, title: `${game}: Spectral Thief as the last action into a foe at +2 Attack (E2 stages; T2A-VS3)`, game, outcomes: true,
    slots: slots(act(marshadow(), "Spectral Thief", PL), idle(lax(20)), idle(mon("Lucario", "Justified", { boosts: { atk: 2 }, evs: { spe: 100 } })), idle(lax(24))),
    checks: "hitStepStealBoosts: Marshadow +2 Attack, Lucario 0 (E2).",
  })),
  {
    id: "T2M-VS-04-swsh", title: "SwSh: Spectral Thief steals +2 Attack; the target's later Iron Head into the user's ally reads +0 (T2-VS03)", game: "swsh",
    slots: slots(act(marshadow(), "Spectral Thief", PL), idle(lax(20)), act(mon("Bisharp", "Pressure", { boosts: { atk: 2 } }), "Iron Head", OR), idle(lax(24))),
    checks: "The steal comes before the hit (Bisharp resists it and stays in) and its stages are 0 after it: Iron Head at +0.",
  },
  {
    id: "T2M-VS-04-usum", title: "USUM: Spectral Thief through the target's Substitute; its later Iron Head (T2-VS03b)", game: "usum",
    slots: slots(act(marshadow(), "Spectral Thief", PL), idle(lax(20)), act(mon("Bisharp", "Pressure", { boosts: { atk: 2 }, substitute: 30 }), "Iron Head", OR), idle(lax(24))),
    checks: "Spectral Thief bypasses the Substitute and steals.",
  },
  {
    id: "T2M-VS-04b-swsh", title: "SwSh: Spectral Thief into a Normal type: immune, nothing stolen; its Close Combat at +2", game: "swsh",
    slots: slots(act(marshadow(), "Spectral Thief", PL), idle(lax(20)), act(mon("Snorlax", "Thick Fat", { boosts: { atk: 2 } }), "Body Slam", OR), idle(lax(24))),
    checks: "hitStepTypeImmunity comes before hitStepStealBoosts.",
  },
];

// ---- #11, #12, #14 The earlier-this-turn flags (ADDENDUM2 C19; CQ03a, CQ03e) ----
// The leads' Intimidate already happened (the case's stages and earlierThisTurn); CQ-ETT-04 runs it as this turn's switch-in.
// Speeds: Incineroar first, then Grimmsnarl (the Lash Out user), then Kingambit, then Torkoal; the idle Snorlaxes apart from them.
const incin = (game: Case["game"], extra: Partial<CaseMon> = {}) => mon("Incineroar", "Intimidate", { evs: { spe: game === "champions" ? 32 : 252 }, ...extra });
const gambit = (game: Case["game"], extra: Partial<CaseMon> = {}) => mon("Kingambit", "Defiant", { evs: { spe: game === "champions" ? 10 : 4 }, ...extra });
const lasher = (game: Case["game"], extra: Partial<CaseMon> = {}) => mon("Grimmsnarl", "Pickpocket", { evs: { spe: game === "champions" ? 4 : 0 }, ...extra });
const EARLIER: Case[] = [
  ...(["sv", "champions"] as const).map((game): Case => ({
    id: `CQ-ETT-01-${game}`, title: `${game}: Burning Jealousy into Kingambit whose Defiant rose earlier this turn; its Kowtow Cleave burned (CQ03a)`, game,
    slots: slots(act(incin(game), "Burning Jealousy"), idle(lax(28)),
      act(gambit(game, { boosts: { atk: 1 }, earlierThisTurn: { statsRaised: true, statsLowered: true } }), "Kowtow Cleave", OR),
      idle(lasher(game, { boosts: { atk: -1 }, earlierThisTurn: { statsLowered: true } }))),
    checks: "PS/data/moves.ts burningjealousy reads statsRaisedThisTurn (set before the moves): Kingambit is burned; Kowtow Cleave at +1 burned.",
  })),
  ...(["sv", "champions"] as const).map((game): Case => ({
    id: `CQ-ETT-02-${game}`, title: `${game}: Lash Out by a Pokémon whose Attack fell earlier this turn: doubled (CQ03e)`, game,
    slots: slots(idle(incin(game)), idle(lax(28)),
      idle(gambit(game, { boosts: { atk: 1 }, earlierThisTurn: { statsRaised: true, statsLowered: true } })),
      act(lasher(game, { boosts: { atk: -1 }, earlierThisTurn: { statsLowered: true } }), "Lash Out", OR)),
    checks: "PS/data/moves.ts lashout onBasePower: statsLoweredThisTurn doubles it (Lash Out 57 against 29 in CQ03a/b).",
  })),
  ...(["sv", "champions"] as const).map((game): Case => ({
    id: `CQ-ETT-04-${game}`, title: `${game}: Incineroar switches in (Intimidate, Kingambit's Defiant); Lash Out, then Torkoal's Burning Jealousy (CQ03e)`, game,
    slots: slots(act(incin(game), null, undefined), act(mon("Torkoal", "White Smoke"), "Burning Jealousy"),
      idle(gambit(game, { appBoosts: { atk: 1 }, earlierThisTurn: { statsRaised: true, statsLowered: true } })),
      act(lasher(game, { appBoosts: { atk: -1 }, earlierThisTurn: { statsLowered: true } }), "Lash Out", OR)),
    checks: "The switch's Intimidate sets the flags this turn: Lash Out doubled, Kingambit burned (CQ03e).",
  })),
];
for (const c of EARLIER) if (c.id.startsWith("CQ-ETT-04")) c.slots[OL].action = { move: null, switchIn: true };

// ---- #14 A Pokémon that switched in this turn takes no action (T2E §4.7.4; TR02, TR06a, TR10a) ----
const SWITCHED: Case[] = [
  ...(["champions", "sv"] as const).map((game): Case => ({
    id: `IN-SW01-${game}`, title: `${game}: an asleep Snorlax switches in and is hit by Kowtow Cleave: no BeforeMove, its counter stays (TR02)`, game, outcomes: true,
    slots: slots({ ...lax(12, { status: "slp", carried: { sleep: { attempts: 1, rest: false } } }), action: { move: null, switchIn: true } }, idle(lax(28)),
      act(gambit(game), "Kowtow Cleave", OL), idle(lax(24))),
    checks: "PS/sim/battle-queue.ts: a switch is no move action: the newcomer runs no BeforeMove (no wake roll); E2 sleep counter kept.",
  })),
  ...(["champions", "sv"] as const).map((game): Case => ({
    id: `IN-SW02-${game}`, title: `${game}: Tyranitar's Payback into a Pokémon that switched in this turn: not doubled (TR06a)`, game,
    slots: slots(act(mon("Tyranitar", "Unnerve"), "Payback", PL), idle(lax(28)),
      { ...lax(12), action: { move: null, switchIn: true } }, idle(lax(24))),
    checks: "PS/data/moves.ts payback onBasePower: target.newlySwitched: not doubled (51 against 102, TR06a/b).",
  })),
  ...(["champions", "sv"] as const).map((game): Case => ({
    id: `IN-SW03-${game}`, title: `${game}: Analytic ${game === "sv" ? "Porygon2" : "Starmie"} moves last under Trick Room; the foe across switched in (TR10a)`, game,
    field: { trickRoom: true },
    slots: slots(act(game === "sv" ? mon("Porygon2", "Analytic", { evs: { spe: 252 } }) : mon("Starmie", "Analytic", { evs: { spe: 32 } }), game === "sv" ? "Tri Attack" : "Hydro Pump", PL), idle(lax(28)),
      { ...lax(12), action: { move: null, switchIn: true } }, idle(lax(24))),
    checks: "PS/data/abilities.ts analytic: no queued action left (the newcomer has none): 1.3x (TR10a 76 against TR10b's 58).",
  })),
  {
    id: "IN-SW04-swsh", title: "SwSh: Dracozolt's Bolt Beak into a Pokémon that switched in this turn: doubled", game: "swsh",
    slots: slots(act(mon("Dracozolt", "Volt Absorb"), "Bolt Beak", PL), idle(lax(28)), { ...lax(12), action: { move: null, switchIn: true } }, idle(lax(24))),
    checks: "PS/data/moves.ts boltbeak onBasePower: target.newlySwitched or will move: doubled.",
  },
  {
    id: "IN-SW04b-swsh", title: "SwSh: Dracovish's Fishious Rend into a Pokémon that switched in this turn: doubled", game: "swsh",
    slots: slots(act(mon("Dracovish", "Water Absorb"), "Fishious Rend", PL), idle(lax(28)), { ...lax(12), action: { move: null, switchIn: true } }, idle(lax(24))),
    checks: "PS/data/moves.ts fishiousrend onBasePower: target.newlySwitched or will move: doubled.",
  },
];

// ---- #7 Rapid Spin and Mortal Spin clear the user's side's pre-turn hazards (E2 hazardsFrom null) ----
const SPIN: Case[] = [
  {
    id: "S1-RSP-champions", title: "Champions: Starmie's Rapid Spin with Stealth Rock and Spikes on its side: both gone (E2 hazardsFrom null)", game: "champions", outcomes: true,
    field: { own: { hazards: ["stealthrock", "spikes"] }, opponent: { hazards: ["stealthrock"] } },
    slots: slots(act(mon("Starmie", "Natural Cure", { evs: { spe: 32 } }), "Rapid Spin", PL), idle(lax(28)), idle(lax(20)), idle(lax(24))),
    checks: "PS/data/moves.ts rapidspin onAfterHit: the user's side's hazards removed; the foe's Stealth Rock stays; +1 Speed.",
  },
  {
    id: "S1-RSP-sv", title: "SV: Glimmora's Mortal Spin with Spikes on its side: gone; both foes poisoned (E2 hazardsFrom null)", game: "sv", outcomes: true,
    field: { own: { hazards: ["spikes", "toxicspikes"] } },
    slots: slots(act(mon("Glimmora", "Toxic Debris", { evs: { spe: 252 } }), "Mortal Spin"), idle(lax(28)), idle(lax(20)), idle(lax(24))),
    checks: "PS/data/moves.ts mortalspin onAfterHit: the user's side's hazards removed; the foes poisoned.",
  },
];

export const STEP1_CASES: Case[] = [...ALLY, ...LOCK, ...COLOR, ...TRACE, ...CURSE, ...UNBURDEN, ...CRASH, ...VOLATILE, ...THIEF, ...EARLIER, ...SWITCHED, ...SPIN];
