// status2 G4- cases (guards.md §4, §6's SPEC2-modelled rows; SPEC2 §7.2: Track D's guards and E1's end-of-turn ones, wave
// 1a): ids G4-<topic>-<n>-<game> as guards.md names them. Step 1's G4-ALY, -SFL, -TRC, -CRS are in cases-status2-step1.ts.
// The Tier 2 rows of guards.md §6 (G4-SMI, -ALE, …) are not built (SPEC2 §7.2; their T2M- cases replace them). Pokémon and
// moves from each game's app catalog (v1/pick.mjs): SV has no Drampa (its Berserk holder is Moltres-Galar), no Shedinja,
// no Zigzagoon (Ambipom's Pickup). Probes: guards-probes-1…3.ts (A, C, D, E, G, H, K, L, M), guards-app-probes.ts (GA).
// Showdown names; level 50, 31 IVs, Serious nature, 0 EVs unless set (Champions: Stat Points). Wired into cases-se.ts.
import type { Case, CaseMon, Game } from "./case-types";
import { OL, OR, PL, PR, act, carried, idle, lax, mon, slots } from "./case-kit";

const top = (game: Game) => (game === "champions" ? 32 : 252);
const k = (game: Game, n: number) => (game === "champions" ? n : n * 8);
const cases: Case[] = [];
const add = (id: string, game: Game, c: Omit<Case, "id" | "game">) => cases.push({ id: `${id}-${game}`, game, outcomes: true, ...c });
const fast = (game: Game, m: CaseMon) => ({ ...m, evs: { ...(m.evs ?? {}), spe: top(game) } });
const esp = (extra: Partial<CaseMon> = {}) => mon("Espathra", "Opportunist", extra);

// ---- §4.1 Opportunist and Mirror Herb copying a rise (A1–A11) ----
add("G4-OPP-01", "sv", {
  title: "Cloyster's Shell Smash: the foe Espathra (Opportunist) copies the rises only, before the next action (A1)",
  slots: slots(act(fast("sv", mon("Cloyster", "Skill Link")), "Shell Smash"), idle(lax(0)), idle(esp()), act(lax(8), "Body Slam", OL)),
  checks: "opportunist onFoeAfterBoost sums the positive parts; applied at the AfterMove of Shell Smash.",
});
add("G4-OPP-02", "sv", {
  title: "Arcanine's Howl raises both foes of Espathra: the copy is the sum (+2 Atk) (A2)",
  slots: slots(act(fast("sv", mon("Arcanine", "Justified")), "Howl"), idle(lax(0)), idle(esp()), idle(lax(8))),
  checks: "Two boost events, one copy table.",
});
add("G4-OPP-03", "sv", {
  title: "Glalie's Icy Wind sets off a foe's Defiant (+2): the Icy Wind user's ally Espathra copies it (A3)",
  slots: slots(act(fast("sv", mon("Glalie", "Inner Focus")), "Icy Wind"), idle(esp()), idle(mon("Kingambit", "Defiant")), idle(lax(8))),
  checks: "Defiant's rise is a foe's rise for Glalie's side.",
});
add("G4-OPP-04", "sv", {
  title: "Garchomp's Breaking Swipe sets off a foe's Weakness Policy (+2/+2) beside the drop: Garchomp's ally Espathra copies the rises (A4)",
  slots: slots(act(fast("sv", mon("Garchomp", "Rough Skin")), "Breaking Swipe"), idle(esp()), idle(mon("Dragonite", "Inner Focus", { item: "Weakness Policy" })), idle(lax(8))),
  checks: "The rise and the drop in one hit: only positives copied.",
});
add("G4-OPP-05", "sv", {
  title: "Garchomp's Swords Dance; a foe's Contrary Malamar with Mirror Herb copies it (inverted by Contrary) (A5)",
  slots: slots(act(fast("sv", mon("Garchomp", "Rough Skin")), "Swords Dance"), idle(lax(0)), idle(mon("Malamar", "Contrary", { item: "Mirror Herb" })), idle(lax(8))),
  checks: "Mirror Herb's copy is a boost() through Contrary: −2 Atk; the Herb is used.",
});
add("G4-OPP-06", "sv", {
  title: "Garchomp at +5 Atk uses Swords Dance (raises 1): Espathra copies +1 (A6)",
  slots: slots(act(fast("sv", mon("Garchomp", "Rough Skin", { boosts: { atk: 5 } })), "Swords Dance"), idle(lax(0)), idle(esp()), idle(lax(8))),
  checks: "The copy is the capped table.",
});
add("G4-OPP-07", "sv", {
  title: "A foe Garchomp eats its Liechi Berry at the turn's first Update; Espathra (faster) uses Stored Power first: its copy waits for that AfterMove (A10)",
  slots: slots(act(fast("sv", esp()), "Stored Power", PR), idle(lax(0)), idle(lax(8)), idle(mon("Garchomp", "Rough Skin", { item: "Liechi Berry", hp: 40 }))),
  checks: "A10: Stored Power at 20 (no copy yet); +1 Atk after its action.",
});
add("G4-OPP-09", "champions", {
  title: "Champions: a foe Scolipede's Speed Boost at 28.2 is copied by Espathra at 29 (A9)",
  slots: slots(idle(esp()), idle(lax(0)), idle(mon("Scolipede", "Speed Boost")), idle(lax(1))),
  checks: "residual 29: Opportunist applies the copied +1 Speed.",
});
add("G4-OPP-10", "sv", {
  title: "Espathra with a copy pending from last turn (+1 Atk) applies it at the first AfterMove (A11)",
  slots: slots(idle(carried(esp(), { copy: { atk: 1 } })), idle(lax(0)), act(lax(8), "Body Slam", OL), idle(lax(16))),
  checks: "DoublesCarried.copy: applied at the first action's end.",
});
add("G4-OPP-11", "sv", {
  title: "Two Espathra: one's Calm Mind is copied by the other; that copy is not copied back (A8)",
  slots: slots(act(fast("sv", esp()), "Calm Mind"), idle(lax(0)), idle(esp()), idle(lax(8))),
  checks: "A copy is not copied (effect Opportunist).",
});

// ---- §4.2 Harvest (C1–C4) ----
const egg = (extra: Partial<CaseMon> = {}) => mon("Exeggutor", "Harvest", { item: "Sitrus Berry", ...extra });
add("G4-HRV-01", "sv", {
  title: "Exeggutor (Harvest) at 30 HP eats its Sitrus at the turn's first Update; Harvest outside sun: 1/2, then eaten again (C1)",
  slots: slots(idle(egg({ hp: 30 })), idle(lax(32)), idle(lax(64)), idle(lax(96))),
  checks: "harvest onResidual 28.2: randomChance(1, 2) outside sun; the final Update eats the restored Berry.",
});
add("G4-HRV-02", "usum", {
  title: "USUM: the same in sun: Harvest certain, eaten again",
  field: { weather: "Sun" },
  slots: slots(idle(egg({ hp: 30 })), idle(lax(32)), idle(lax(64)), idle(lax(96))),
  checks: "Sun: certain.",
});
add("G4-HRV-03", "swsh", {
  title: "SwSh: Harvest in sun under a foe's Cloud Nine: 1/2 (C2)",
  field: { weather: "Sun" },
  slots: slots(idle(egg({ hp: 30 })), idle(lax(32)), idle(mon("Golduck", "Cloud Nine")), idle(lax(96))),
  checks: "isWeather false under Cloud Nine.",
});
add("G4-HRV-04", "sv", {
  title: "Arboliva (Harvest) flings its Sitrus at a foe in sun: Harvest restores it (C3a)",
  field: { weather: "Sun" },
  slots: slots(act(mon("Arboliva", "Harvest", { item: "Sitrus Berry" }), "Fling", PR), idle(lax(32)), idle(lax(64)), idle(lax(96))),
  checks: "Fling's flung Berry sets lastItem.",
});
add("G4-HRV-05", "sv", {
  title: "Exeggutor with no item and its Sitrus eaten on an earlier turn (lastItem) in sun: Harvest restores it",
  field: { weather: "Sun" },
  slots: slots(idle(egg({ item: "", hp: 100, lastItem: "Sitrus Berry" })), idle(lax(32)), idle(lax(64)), idle(lax(96))),
  checks: "DoublesPokemonInput.lastItem read by Harvest.",
});
add("G4-HRV-06", "champions", {
  title: "Champions: Trevenant's Harvest after a Sitrus eaten this turn, not in sun",
  slots: slots(idle(mon("Trevenant", "Harvest", { item: "Sitrus Berry", hp: 40 })), idle(lax(1)), idle(lax(2)), idle(lax(3))),
  checks: "1/2 outside sun.",
});

// ---- §4.3 Pickup (C5–C8) ----
add("G4-PKP-01", "sv", {
  title: "Ambipom (Pickup) with two foes that ate a Berry this turn: a uniform pick (C5)",
  slots: slots(idle(mon("Ambipom", "Pickup")), idle(lax(32)), idle(lax(64, { item: "Sitrus Berry", hp: 40 })), idle(lax(96, { item: "Oran Berry", hp: 40 }))),
  checks: "pickup samples among adjacent Pokémon with usedItemThisTurn and lastItem.",
});
add("G4-PKP-02", "sv", {
  title: "Pickup: a knocked-off item is not a candidate (C6)",
  slots: slots(idle(mon("Ambipom", "Pickup")), idle(lax(32, { item: "Leftovers" })), act(mon("Weavile", "Pressure"), "Knock Off", OR), idle(lax(96))),
  checks: "Knock Off does not set lastItem.",
});
add("G4-PKP-03", "usum", {
  title: "USUM: Pickup takes a Lum Berry eaten at the turn's first Update (C7)",
  // silentStatus (integration 1a): the paralysis set with no SetStatus event, so the Lum Berry waits for the turn's first Update
  // (without it the setup's setStatus ate the Berry before the turn, the oracle's usedItemThisTurn cleared).
  slots: slots(idle(mon("Zigzagoon", "Pickup")), idle(lax(32, { item: "Lum Berry", status: "par", silentStatus: true })), idle(lax(64)), idle(lax(96))),
  checks: "The first Update's eat sets usedItemThisTurn.",
});
add("G4-PKP-04", "swsh", {
  title: "SwSh: the Pickup holder's own eaten Sitrus is not a candidate (C8)",
  slots: slots(idle(mon("Zigzagoon", "Pickup", { item: "Sitrus Berry", hp: 10 })), idle(lax(32)), idle(lax(64)), idle(lax(96))),
  checks: "isAdjacent excludes itself.",
});
add("G4-PKP-05", "champions", {
  title: "Champions: Dedenne's Pickup after a foe's Sitrus Berry",
  slots: slots(idle(mon("Dedenne", "Pickup")), idle(lax(1)), idle(lax(2, { item: "Sitrus Berry", hp: 40 })), idle(lax(3))),
  checks: "The same in Champions.",
});

// ---- §4.4 Stored Power, Power Trip, Punishment after an accuracy or evasion stage ----
add("G4-STP-01", "sv", {
  title: "Cresselia's Double Team, then its ally Espathra's Stored Power... (Cresselia's own Stored Power reads +1 evasion)",
  slots: slots(act(fast("sv", mon("Cresselia", "Levitate")), "Double Team"), act(esp(), "Stored Power", PL), idle(lax(0)), idle(lax(8))),
  checks: "hiddenStages: evasion counts for Stored Power (the user's own).",
});
add("G4-STP-02", "champions", {
  title: "Champions: Espathra with a carried +2 evasion (Baton Pass) and Speed Boost: Stored Power",
  slots: slots(act(carried(esp(), { stages: { evasion: 2 } }), "Stored Power", PL), idle(lax(0)), idle(lax(2)), idle(lax(1))),
  checks: "60 power (+2 evasion).",
});
add("G4-STP-03", "usum", {
  title: "USUM: Absol's Punishment into a +2 evasion Snorlax",
  slots: slots(act(mon("Absol", "Pressure"), "Punishment", PL), idle(lax(0)), idle(carried(lax(16), { stages: { evasion: 2 } })), idle(lax(8))),
  checks: "Punishment counts the target's positive stages, evasion included.",
});
add("G4-STP-04", "swsh", {
  title: "SwSh: Incineroar's Power Trip with a carried +1 accuracy",
  slots: slots(act(carried(mon("Incineroar", "Blaze"), { stages: { accuracy: 1 } }), "Power Trip", PL), idle(lax(0)), idle(lax(16)), idle(lax(8))),
  checks: "40 power (+1 accuracy).",
});

// ---- §4.5 Fling (E1–E9) ----
const sneasler = (item: string, game: Game, extra: Partial<CaseMon> = {}) => mon("Sneasler", "Unburden", { item, nature: "Jolly", evs: { atk: top(game), spe: top(game) }, ...extra });
add("G4-FLG-01", "sv", {
  title: "Sneasler flings its Life Orb into Snorlax",
  slots: slots(act(sneasler("Life Orb", "sv"), "Fling", PR), idle(lax(0)), idle(lax(8)), idle(lax(16))),
  checks: "Fling 30 power (Life Orb); Unburden after.",
});
add("G4-FLG-02", "sv", {
  title: "Sneasler flings its Sitrus Berry at its ally at 100 HP past a foe's Unnerve: the ally eats it (E2)",
  slots: slots(act(sneasler("Sitrus Berry", "sv"), "Fling", OR), idle(lax(0, { hp: 100 })), idle(mon("Tyranitar", "Unnerve")), idle(lax(16))),
  checks: "The flung Berry is eaten by the target (no TryEatItem: Unnerve does not stop it).",
});
add("G4-FLG-03", "sv", {
  title: "Sneasler flings a White Herb at a foe at −2 Atk: restored (E3)",
  slots: slots(act(sneasler("White Herb", "sv"), "Fling", PR), idle(lax(0)), idle(lax(8)), idle(lax(16, { boosts: { atk: -2 } }))),
  checks: "The flung White Herb's effect on the target.",
});
add("G4-FLG-04", "sv", {
  title: "Sneasler flings a Flame Orb into a Shield Dust Vivillon: no burn, the Orb is used up (E4b)",
  slots: slots(act(sneasler("Flame Orb", "sv"), "Fling", PR), idle(lax(0)), idle(lax(8)), idle(mon("Vivillon", "Shield Dust"))),
  checks: "Shield Dust stops the flung secondary.",
});
add("G4-FLG-05", "champions", {
  title: "Champions: Sneasler (Unburden) flings an Iron Ball: Unburden doubles its Speed for the next turn (E2)",
  slots: slots(act(sneasler("Iron Ball", "champions"), "Fling", PR), idle(lax(0)), idle(lax(2)), idle(lax(1))),
  checks: "Iron Ball 130 power; E2 Unburden active.",
});
add("G4-FLG-06", "champions", {
  title: "Champions: Sneasler flings a Light Ball: the target is paralysed",
  slots: slots(act(sneasler("Light Ball", "champions"), "Fling", PR), idle(lax(0)), idle(lax(2)), idle(lax(1))),
  checks: "Light Ball's fling status.",
});
add("G4-FLG-07", "swsh", {
  title: "SwSh: Weavile flings a King's Rock at a slower Snorlax: it flinches",
  slots: slots(act(mon("Weavile", "Pressure", { item: "King's Rock", evs: { spe: 252 } }), "Fling", PR), idle(lax(0)), idle(lax(8)), act(lax(16), "Body Slam", OL)),
  checks: "King's Rock's fling flinch (100%).",
});
add("G4-FLG-08", "usum", {
  title: "USUM: Fling with a Z-Crystal fails",
  slots: slots(act(mon("Weavile", "Pressure", { item: "Normalium Z", evs: { spe: 252 } }), "Fling", PR), idle(lax(0)), idle(lax(8)), idle(lax(16))),
  checks: "Z-Crystals cannot be flung.",
});
add("G4-FLG-09", "sv", {
  title: "Sneasler flings its Iron Ball; its Symbiosis ally Oranguru passes it a Sitrus Berry (E6)",
  slots: slots(act(sneasler("Iron Ball", "sv"), "Fling", PR), idle(mon("Oranguru", "Symbiosis", { item: "Sitrus Berry" })), idle(lax(8)), idle(lax(16))),
  checks: "Symbiosis at AfterUseItem: the partner's item moves; Unburden ends? (the oracle decides).",
});
add("G4-FLG-10", "sv", {
  title: "Sneasler flings a Flame Orb into a Substitute: no burn, the Orb is used up (E7)",
  slots: slots(act(sneasler("Flame Orb", "sv"), "Fling", PR), idle(lax(0)), idle(lax(8)), idle(lax(16, { substitute: 60 }))),
  checks: "Into a Substitute: no secondary.",
});

// ---- §4.6 One-hit KO moves ----
add("G4-OHK-01", "sv", {
  title: "Beartic's Sheer Cold into a Snorlax at partial HP",
  slots: slots(act(mon("Beartic", "Swift Swim"), "Sheer Cold", PR), idle(lax(0)), idle(lax(8)), idle(lax(16, { hp: 150 }))),
  checks: "ohkoStep: a fixed hit of the target's HP.",
});
add("G4-OHK-02", "sv", {
  title: "Sheer Cold into an Ice type (Glalie): immune",
  slots: slots(act(mon("Beartic", "Swift Swim"), "Sheer Cold", PR), idle(lax(0)), idle(lax(8)), idle(mon("Glalie", "Inner Focus"))),
  checks: "Gen 7+: Ice types immune to Sheer Cold.",
});
add("G4-OHK-03", "champions", {
  title: "Champions: Vanilluxe's Sheer Cold (a non-Ice user still hits? it is Ice)",
  slots: slots(act(mon("Vanilluxe", "Ice Body"), "Sheer Cold", PR), idle(lax(0)), idle(lax(1)), idle(lax(2))),
  checks: "Champions OHKO.",
});
add("G4-OHK-04", "swsh", {
  title: "SwSh: Sheer Cold into a Snorlax that Dynamaxes this turn (its Max Strike at Lapras's ally): fails",
  slots: slots(act(mon("Lapras", "Shell Armor"), "Sheer Cold", PR), idle(lax(0)), idle(lax(8)), act(lax(16, { choice: "dynamax" }), "Body Slam", OR)),
  checks: "Dynamax: OHKO immune.",
});
add("G4-OHK-05", "usum", {
  title: "USUM: Kingler's Guillotine into Snorlax",
  slots: slots(act(mon("Kingler", "Hyper Cutter"), "Guillotine", PR), idle(lax(0)), idle(lax(8)), idle(lax(16))),
  checks: "Guillotine.",
});
add("G4-OHK-06", "sv", {
  title: "Sheer Cold into a Focus Sash Snorlax at full HP: Sash holds at 1",
  slots: slots(act(mon("Beartic", "Swift Swim"), "Sheer Cold", PR), idle(lax(0)), idle(lax(8)), idle(lax(16, { item: "Focus Sash" }))),
  checks: "Sash works on OHKO moves.",
});
add("G4-OHK-07", "sv", {
  title: "Sheer Cold into an enduring Sitrus Snorlax: 1 HP, then the Sitrus",
  slots: slots(act(mon("Beartic", "Swift Swim"), "Sheer Cold", PR), idle(lax(0)), idle(lax(8)), act(lax(16, { item: "Sitrus Berry" }), "Endure")),
  checks: "Endure and the Berry at the Update.",
});
add("G4-OHK-08", "sv", {
  title: "Sheer Cold into a Substitute: the Substitute breaks",
  slots: slots(act(mon("Beartic", "Swift Swim"), "Sheer Cold", PR), idle(lax(0)), idle(lax(8)), idle(lax(16, { substitute: 50 }))),
  checks: "OHKO into a Substitute.",
});
add("G4-OHK-09", "sv", {
  title: "Sheer Cold into an intact Mimikyu: Disguise takes it",
  slots: slots(act(mon("Beartic", "Swift Swim"), "Sheer Cold", PR), idle(lax(0)), idle(lax(8)), idle(mon("Mimikyu", "Disguise"))),
  checks: "Disguise on an OHKO move (oracle decides).",
});
add("G4-OHK-10", "swsh", {
  title: "SwSh: Excadrill's Fissure into an Air Balloon Snorlax: immune (not grounded)",
  slots: slots(act(mon("Excadrill", "Mold Breaker"), "Fissure", PR), idle(lax(0)), idle(lax(8)), idle(lax(16, { item: "Air Balloon" }))),
  checks: "Ground OHKO and the balloon.",
});
add("G4-OHK-11", "usum", {
  title: "USUM: Guillotine into Shedinja (Wonder Guard): it is not super effective (SV has no Shedinja)",
  slots: slots(act(mon("Kingler", "Hyper Cutter"), "Guillotine", PR), idle(lax(0)), idle(lax(8)), idle(mon("Shedinja", "Wonder Guard"))),
  checks: "Wonder Guard blocks OHKO moves.",
});

// ---- §4.7 Spread heals (G1–G7) ----
const sinistcha = (game: Game, extra: Partial<CaseMon> = {}) => mon("Sinistcha", "Hospitality", { nature: "Modest", evs: { spa: top(game), spe: top(game) }, ...extra });
add("G4-SPH-01", "champions", {
  title: "Champions: Sinistcha at 50% Matcha Gotcha into two foes",
  slots: slots(act(sinistcha("champions", { hp: 80 }), "Matcha Gotcha"), idle(lax(1)), idle(lax(2)), idle(lax(3))),
  checks: "Drain per target in hit order, the joint kept.",
});
add("G4-SPH-02", "sv", {
  title: "Matcha Gotcha, one Liquid Ooze target first in hit order (G1)",
  slots: slots(act(sinistcha("sv", { hp: 80 }), "Matcha Gotcha"), idle(lax(32)), idle(lax(96)), idle(mon("Tentacruel", "Liquid Ooze"))),
  checks: "Liquid Ooze's damage then the plain heal, in hit order.",
});
add("G4-SPH-03", "sv", {
  title: "The same with the Liquid Ooze target second (G1b)",
  slots: slots(act(sinistcha("sv", { hp: 80 }), "Matcha Gotcha"), idle(lax(32)), idle(mon("Tentacruel", "Liquid Ooze")), idle(lax(96))),
  checks: "The other hit order.",
});
add("G4-SPH-04", "sv", {
  title: "Matcha Gotcha with Big Root (each target's heal rounded on its own) (G2)",
  slots: slots(act(sinistcha("sv", { hp: 40, item: "Big Root" }), "Matcha Gotcha"), idle(lax(32)), idle(lax(64)), idle(lax(96))),
  checks: "Big Root ×1.3 per drain.",
});
add("G4-SPH-05", "sv", {
  title: "Matcha Gotcha into a Rowap Berry holder: drains, the Berry's damage, then the user's Sitrus at the Update (G3)",
  slots: slots(act(sinistcha("sv", { hp: 76, item: "Sitrus Berry" }), "Matcha Gotcha"), idle(lax(32)), idle(lax(64, { item: "Rowap Berry" })), idle(lax(96))),
  checks: "G3's order.",
});
add("G4-SPH-06", "swsh", {
  title: "SwSh: Garchomp's Shell Bell Rock Slide over two targets, one behind a Substitute (G4)",
  slots: slots(act(mon("Garchomp", "Rough Skin", { item: "Shell Bell", hp: 60, evs: { atk: 252, spe: 252 } }), "Rock Slide"), idle(lax(32)), idle(lax(64)), idle(lax(96, { substitute: 40 }))),
  checks: "One heal of totalDamage/8 after the move.",
});
add("G4-SPH-07", "usum", {
  title: "USUM: Dedenne's Parabolic Charge (its ally too) (G7)",
  slots: slots(act(mon("Dedenne", "Cheek Pouch", { hp: 40, evs: { spa: 252, spe: 252 } }), "Parabolic Charge"), idle(lax(32)), idle(lax(64)), idle(lax(96))),
  checks: "allAdjacent drain: the ally's damage heals too.",
});
add("G4-SPH-08", "champions", {
  title: "Champions: Matcha Gotcha knocking a target out: the drain reads the damage dealt (G6)",
  slots: slots(act(sinistcha("champions", { hp: 40 }), "Matcha Gotcha"), idle(lax(1)), idle(lax(2, { hp: 10 })), idle(lax(3))),
  checks: "The drain of the knocking hit is the HP it took.",
});
add("G4-SPH-09", "champions", {
  title: "Champions: Matcha Gotcha at full HP: no heal",
  slots: slots(act(sinistcha("champions"), "Matcha Gotcha"), idle(lax(1)), idle(lax(2)), idle(lax(3))),
  checks: "No heal at full HP.",
});

// ---- §4.8 The Berserk / Anger Shell lock (H1–H4b, GA2) ----
const zerk = (game: Game, extra: Partial<CaseMon> = {}) => (game === "sv" ? mon("Moltres-Galar", "Berserk", { item: "Sitrus Berry", evs: { spe: 252 }, ...extra }) : mon("Drampa", "Berserk", { item: "Sitrus Berry", evs: { spe: top(game) }, ...extra }));
add("G4-BZK-01", "sv", {
  title: "A Berserk Moltres-Galar's confusion self-hit locks its Sitrus; a later single-hit Body Slam: the Berry at that action's end (H1)",
  slots: slots(idle(carried(zerk("sv", { hp: 90 }), { confusion: { attempts: 0 } })), idle(lax(32)), act(lax(0), "Body Slam", OL), idle(lax(96))),
  checks: "H1 (with SV's Berserk holder).",
});
add("G4-BZK-02", "sv", {
  title: "The same with a multi-hit Double Hit: the Berry between the hits (H2)",
  slots: slots(idle(carried(zerk("sv", { hp: 90 }), { confusion: { attempts: 0 } })), idle(lax(32)), act(mon("Ambipom", "Technician", { nature: "Brave", ivs: { spe: 0 } }), "Double Hit", OL), idle(lax(96))),
  checks: "onDamage of a multihit resets the lock.",
});
add("G4-BZK-03", "sv", {
  title: "The same with a status move (Growl) reaching it (H3)",
  slots: slots(idle(carried(zerk("sv", { hp: 90 }), { confusion: { attempts: 0 } })), idle(lax(32)), act(mon("Charizard", "Blaze", { nature: "Brave", ivs: { spe: 0 } }), "Growl"), idle(lax(96))),
  checks: "H3.",
});
add("G4-BZK-04", "sv", {
  title: "A carried lock (its Berry locked last turn) and a later Body Slam (H4b's turn 2)",
  slots: slots(idle(carried(zerk("sv", { hp: 90 }), { berryLocked: true })), idle(lax(32)), act(lax(0), "Body Slam", OL), idle(lax(96))),
  checks: "DoublesCarried.berryLocked: the reset at the Body Slam's AfterMoveSecondary.",
});
add("G4-BZK-05", "champions", {
  title: "Champions: Drampa with a Sheer Force hit, then a later Body Slam (GA2)",
  slots: slots(act(zerk("champions", { hp: 140, evs: {} }), "Dragon Pulse", PR), idle(mon("Venusaur", "Overgrow", { evs: { spe: 4 } })), act(mon("Feraligatr", "Sheer Force", { evs: { atk: 32, spe: 32 } }), "Crunch", OL), act(lax(0), "Body Slam", OL)),
  checks: "G4-SFL-01's turn, estimated once D models the later reset.",
});
add("G4-BZK-06", "champions", {
  title: "Champions: the same with the holder's own No move (GA2b)",
  slots: slots(idle(zerk("champions", { hp: 140, evs: {} })), idle(mon("Venusaur", "Overgrow", { evs: { spe: 4 } })), act(mon("Feraligatr", "Sheer Force", { evs: { atk: 32, spe: 32 } }), "Crunch", OL), idle(lax(0))),
  checks: "G4-SFL-02's turn.",
});
add("G4-BZK-07", "usum", {
  title: "USUM: a Berserk Drampa's confusion self-hit, then a later status move into it",
  slots: slots(idle(carried(zerk("usum", { hp: 90 }), { confusion: { attempts: 0 } })), idle(lax(32)), act(mon("Charizard", "Blaze", { nature: "Brave", ivs: { spe: 0 } }), "Growl"), idle(lax(96))),
  checks: "The status move's AfterMoveSecondary resets the lock (gen 7).",
});

// ---- §4.11 Psychic Noise before a later action (K2–K5) ----
const noise = (game: Game) => fast(game, mon("Farigiraf", "Armor Tail"));
add("G4-HBK-01", "sv", {
  title: "Psychic Noise, then a later hit takes the Sitrus holder under half: the Berry stays (K2)",
  slots: slots(act(noise("sv"), "Psychic Noise", PR), act(mon("Garchomp", "Rough Skin"), "Dragon Claw", PR), idle(lax(0)), idle(lax(8, { item: "Sitrus Berry", hp: 130 }))),
  checks: "K2: heal-blocked: no Sitrus.",
});
add("G4-HBK-02", "champions", {
  title: "Champions: Farigiraf's Psychic Noise, then a foe's later hit into the Sitrus holder",
  slots: slots(act(noise("champions"), "Psychic Noise", PR), act(mon("Garchomp", "Rough Skin"), "Dragon Claw", PR), idle(lax(0)), idle(lax(1, { item: "Sitrus Berry", hp: 130 }))),
  checks: "The same in Champions.",
});
add("G4-HBK-03", "sv", {
  title: "Psychic Noise, then an Electric move into its Volt Absorb: immune, no heal (K3)",
  slots: slots(act(noise("sv"), "Psychic Noise", PR), act(mon("Jolteon", "Volt Absorb"), "Thunderbolt", PR), idle(lax(0)), idle(mon("Lanturn", "Volt Absorb", { hp: 80 }))),
  checks: "K3.",
});
add("G4-HBK-04", "sv", {
  title: "Psychic Noise, then the target's own Shell Bell hit: no heal (K4)",
  slots: slots(act(noise("sv"), "Psychic Noise", PR), idle(lax(0)), idle(lax(8)), act(mon("Garchomp", "Rough Skin", { item: "Shell Bell", hp: 80 }), "Dragon Claw", OR)),
  checks: "K4.",
});
add("G4-HBK-05", "champions", {
  title: "Champions: Psychic Noise, then its ally's Pollen Puff onto it (K5)",
  slots: slots(act(noise("champions"), "Psychic Noise", PR), idle(lax(0)), act(mon("Florges", "Flower Veil"), "Pollen Puff", PR), idle(lax(1, { hp: 80 }))),
  checks: "K5: Pollen Puff onto a heal-blocked ally fails.",
});
add("G4-HBK-06", "sv", {
  title: "A carried Heal Block (1 turn left, from Psychic Noise) and a Leftovers holder (E2 to the next turn)",
  slots: slots(idle(lax(0)), idle(lax(8)), idle(lax(16)), idle(carried(lax(24, { item: "Leftovers", hp: 150 }), { healBlock: 1 }))),
  checks: "IN-P15: Leftovers blocked, the Heal Block ends at 20.",
});

// ---- §4.12 Perish projection ----
add("G4-PER-01", "sv", {
  title: "Altaria's Perish Song: E2's perish counts (3 after the turn)",
  slots: slots(act(mon("Altaria", "Natural Cure"), "Perish Song"), idle(lax(0)), idle(lax(8)), idle(lax(16))),
  checks: "E2 perishCount after the countdown.",
});

// ---- §4.13 Starf Berry (L1) ----
add("G4-STF-01", "sv", {
  title: "Tauros's Double-Edge recoil takes it to its Starf Berry's line: one world per stat (L1)",
  slots: slots(act(mon("Tauros", "Intimidate", { item: "Starf Berry", hp: 60, evs: { atk: 252, spe: 252 } }), "Double-Edge", PR), idle(lax(32)), idle(lax(64)), idle(lax(96))),
  checks: "starfberry: sample over the stats below +6.",
});
add("G4-STF-02", "usum", {
  title: "USUM: a Starf Berry eaten at the turn's start",
  slots: slots(idle(lax(0, { item: "Starf Berry", hp: 40 })), idle(lax(32)), act(lax(64), "Body Slam", OL), idle(lax(96))),
  checks: "The start Starf: start variants.",
});
add("G4-STF-03", "swsh", {
  title: "SwSh: Bug Bite eats a foe's Starf Berry",
  slots: slots(act(mon("Scizor", "Technician"), "Bug Bite", PR), idle(lax(32)), idle(lax(64)), idle(lax(96, { item: "Starf Berry" }))),
  checks: "Bug Bite's Starf: the user gets a random +2.",
});
add("G4-STF-04", "sv", {
  title: "A Starf Berry holder under a quarter after the end of turn's damage (E2)",
  field: { weather: "Sand" },
  slots: slots(idle(lax(0, { item: "Starf Berry", hp: 70 })), idle(lax(32)), idle(mon("Tyranitar", "Sand Stream")), idle(lax(96))),
  checks: "The Starf at the final Update: one outcome per stat.",
});

// ---- §4.14 White Herb at 29 (M1) ----
for (const game of ["sv", "swsh"] as Game[]) {
  add("G4-WHR-01", game, {
    title: "White Herb at order 29 restores a lowered accuracy stage once Magic Room (1 turn left) ends (M1)",
    field: { magicRoom: true }, fieldTurns: { magicRoom: 1 },
    slots: slots(idle(carried(lax(32, { item: "White Herb" }), { stages: { accuracy: -1 } })), idle(lax(48)), idle(lax(64)), idle(lax(96))),
    checks: "M1: the room ends at 27.6, White Herb at 29.",
    // Integration 1a: the field's turns left (fieldTurns) are E2's (wave 1b: T2E-FS, IN-FLD); until then the end of turn is
    // not estimated. Drop this line at integration 1b.
    endNotEstimated: "Magic Room ending is not modelled in 2v2.",
  });
}

// ---- §4.16 Liquid Ooze into a heal-blocked seeder (GA4) ----
for (const [suffix, oozeSpe, seederSpe] of [["01", 252, 0], ["02", 0, 252]] as const) {
  add(`G4-LOZ-${suffix}`, "sv", {
    title: `Leech Seed from a heal-blocked seeder into Liquid Ooze (Ooze holder ${oozeSpe ? "faster" : "slower"}) (GA4${suffix === "01" ? "a" : "b"})`,
    slots: slots(idle(mon("Venusaur", "Overgrow", { evs: { spe: seederSpe } })), idle(lax(4)),
      idle(carried(mon("Tentacruel", "Liquid Ooze", { evs: { spe: oozeSpe } }), { leechSeed: OL })), act(mon("Farigiraf", "Armor Tail", { evs: { spe: 252 } }), "Psychic Noise", OL)),
    checks: "TryHeal's handlers: the faster holder's handler first.",
  });
}
add("G4-LOZ-03", "usum", {
  title: "USUM: the same with the two at one Speed: a tie",
  slots: slots(idle(mon("Venusaur", "Overgrow", { evs: { spe: 36 } })), idle(lax(4)),
    idle(carried(mon("Tentacruel", "Liquid Ooze", { ivs: { spe: 0 } }), { leechSeed: OL })), act(mon("Bronzong", "Levitate", { evs: { spe: 252 } }), "Heal Block")),
  checks: "1/2 each order.",
});

// ---- §6: Last move (Q3) and Encore's change, Glaive Rush ----
add("G4-LMV-01", "champions", {
  title: "Champions: Whimsicott's Encore into a foe that used Protect last turn: the foe's Body Slam becomes Protect",
  slots: slots(act(mon("Whimsicott", "Prankster"), "Encore", PR), idle(lax(0)), idle(lax(2)), act(lax(1, { lastMove: "Protect", moves: ["Protect"] }), "Body Slam", OL)),
  checks: "lastMove input: the Encore locks Protect (the target's action changes: encore-change).",
});
add("G4-LMV-02", "sv", {
  title: "Encore into a foe whose last move was Body Slam (lastMove given)",
  slots: slots(act(mon("Whimsicott", "Prankster"), "Encore", PR), idle(lax(0)), idle(lax(8)), act(lax(16, { lastMove: "Body Slam" }), "Crunch", OL)),
  checks: "The encored move at the old priority and a random legal target.",
});
add("G4-ENC-01", "sv", {
  title: "Encore changes a queued move: Body Slam at a random foe (two worlds)",
  slots: slots(act(mon("Whimsicott", "Prankster"), "Encore", PR), idle(lax(0)), idle(lax(8)), act(lax(16, { lastMove: "Body Slam" }), "Rest")),
  checks: "encore onOverrideAction: the encored move, its target random among the legal ones.",
});
add("G4-ENC-02", "champions", {
  title: "Champions: Encore changes a queued Protect into the last move (Body Slam)",
  slots: slots(act(mon("Whimsicott", "Prankster"), "Encore", PR), idle(lax(0)), idle(lax(2)), act(lax(1, { lastMove: "Body Slam" }), "Protect")),
  checks: "The same in Champions.",
});
add("G4-GLV-01", "sv", {
  title: "Baxcalibur's Glaive Rush, then a later hit into it is doubled",
  slots: slots(act(fast("sv", mon("Baxcalibur", "Thermal Exchange")), "Glaive Rush", PR), idle(lax(0)), idle(lax(8)), act(lax(16), "Body Slam", OL)),
  checks: "glaiverush onSourceModifyDamage ×2 until its next BeforeMove.",
});
add("G4-GLV-02", "champions", {
  title: "Champions: the same Glaive Rush and a later hit",
  slots: slots(act(fast("champions", mon("Baxcalibur", "Thermal Exchange")), "Glaive Rush", PR), idle(lax(0)), idle(lax(1)), act(lax(2), "Body Slam", OL)),
  checks: "The same in Champions.",
});

/** SPEC2's G4- cases (wave 1; Step 1's are in cases-status2-step1.ts). */
export const G4_CASES: Case[] = cases;
void OR; void PL;
