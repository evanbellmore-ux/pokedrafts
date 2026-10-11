// status2 wave 1b (Track V2): the T2M- cases of tier2-moves.md §5 whose tracks run in wave 1b (ADDENDUM2 §7.2, §8.5): K
// (T2M-VS-05, -SE, -SCK, -UN, -UNR, -CD, -FV, -BB, -AF, -IO, -RC, FX-CE-01, IN-BBD-02), M (T2M-GM, -PS), CL (T2M-ST, -UP,
// -HH, T2E-UP-01) and Q13's T2M-Q (A2's addition with Step 0b's calculate.ts paths: the integrator's in 1b). Each scenario
// runs in the game pair §5 names where every Pokémon and move of it is in that game's catalog (a game swapped in is said in
// the case's checks). Probes: tier2-moves-probes-2…5.ts (T2-…). Showdown names; level 50, 31 IVs, Serious nature, 0 EVs
// unless set (Champions: Stat Points). Wired into cases-se.ts through cases-wave1b.ts.
import type { Case, CaseMon, Game } from "./case-types";
import { OL, OR, PL, PR, act, carried, idle, mon, slots } from "./case-kit";
import { L, ev, evs, fastEvs, slowest } from "./case-kit2";

const cases: Case[] = [];
const add = (id: string, games: Game[], make: (game: Game) => Omit<Case, "id" | "game">) => {
  for (const game of games) cases.push({ id: `${id}-${game}`, game, ...make(game) });
};

// ================================ K: volatile secondaries (T2M §3.2: Core Enforcer) ================================
add("T2M-VS-05", ["usum", "swsh"], (game) => ({
  title: "Trick Room: Bronzong moves first; Zygarde's Core Enforcer suppresses it (it moved) but not Rotom-Wash (still to move); a later Earthquake hits Bronzong (T2-VS04)",
  field: { trickRoom: true },
  slots: slots(act(mon("Zygarde", "Aura Break", slowest(game)), "Core Enforcer"), act(mon("Garchomp", "Rough Skin", { nature: "Jolly", evs: fastEvs(game) }), "Earthquake"),
    idle(mon("Rotom-Wash", "Levitate", { nature: "Timid", evs: fastEvs(game) })), idle(mon("Bronzong", "Levitate", slowest(game)))),
  checks: "moves.ts coreenforcer onHit: gastroacid only on a target that has moved (queue.willMove null); Levitate gone, Earthquake hits.",
  outcomes: true,
}));
add("FX-CE-01", ["usum"], () => ({
  title: "Core Enforcer as the last action into a badly poisoned Poison Heal Gliscor (it moved): no heal at the end of turn, the toxic damage instead (T2A-VS2)",
  slots: slots(act(mon("Zygarde", "Aura Break", slowest("usum")), "Core Enforcer"), idle(mon("Garchomp", "Rough Skin")),
    idle(mon("Raichu", "Static")), idle(carried(mon("Gliscor", "Poison Heal", { status: "tox" }), { toxic: 2 }))),
  checks: "Core Enforcer suppresses both foes (both moved): Gliscor's Poison Heal off at 10; tox 3/16 at the residual (E2 gastroacid).",
  outcomes: true,
}));
add("FX-CE-01", ["swsh"], () => ({
  title: "Core Enforcer as the last action into Speed Boost Blaziken (it moved): no Speed rise at the end of turn (T2A-VS2)",
  slots: slots(act(mon("Zygarde", "Aura Break", slowest("swsh")), "Core Enforcer"), idle(mon("Garchomp", "Rough Skin")),
    idle(mon("Raichu", "Static")), idle(mon("Blaziken", "Speed Boost"))),
  checks: "gastroacid on Blaziken: abilities.ts speedboost onResidual does not run (E2 stages, gastroacid).",
  outcomes: true,
}));

// ================================ K: spread effects on the user (T2M §3.3) ================================
add("T2M-SE-01", ["champions"], () => ({
  title: "Garchomp's Rock Slide into Scovillain-Mega (Spicy Spray) and a Snorlax: the user is burned once (T2-SE01)",
  slots: slots(act(mon("Garchomp", "Rough Skin", { evs: { spe: 32 } }), "Rock Slide"), idle(L("champions", 1)),
    idle(L("champions", 2)), idle(mon("Scovillain-Mega", "Spicy Spray", { item: "Scovillainite" }))),
  checks: "abilities.ts spicyspray onDamagingHit: trySetStatus brn on the source; the burn from one target.",
  outcomes: true,
}));
add("T2M-SE-02", ["sv", "champions"], (game) => ({
  title: "Competitive Milotic's Breaking Swipe (contact) into two Gooey Goodra: Spe −1 twice, Competitive +2 Sp. Atk twice, in target order (T2-SE02)",
  slots: slots(act(mon("Milotic", "Competitive", { evs: fastEvs(game) }), "Breaking Swipe"), idle(L(game, 1)),
    idle(mon("Goodra-Hisui", "Gooey")), idle(mon("Goodra", "Gooey"))),
  checks: "Each target's DamagingHit after every target's damage: the Gooey drops in turn through boost() (Competitive per drop). Kingambit has no Breaking Swipe in these catalogs: Milotic.",
  outcomes: true,
}));
add("T2M-SE-03", ["champions", "sv"], (game) => ({
  title: "The same at Spe −6: both Gooey drops fail, so Competitive never rises (T2-SE03)",
  slots: slots(act(mon("Milotic", "Competitive", { evs: fastEvs(game), boosts: { spe: -6 } }), "Breaking Swipe"), idle(L(game, 1)),
    idle(mon("Goodra-Hisui", "Gooey")), idle(mon("Goodra", "Gooey"))),
  checks: "boost() at −6: no change, no Competitive (it reads a changed stat).",
  outcomes: true,
}));
add("T2M-SE-04", ["sv", "champions"], (game) => ({
  title: "A White Herb Milotic's Breaking Swipe into two Gooey Goodra: both drops, then White Herb restores at the Update after the hits (T2-SE04)",
  slots: slots(act(mon("Milotic", "Marvel Scale", { item: "White Herb", evs: fastEvs(game) }), "Breaking Swipe"), idle(L(game, 1)),
    idle(mon("Goodra-Hisui", "Gooey")), idle(mon("Goodra", "Gooey"))),
  checks: "items.ts whiteherb onUpdate after the move: −2 Spe cleared once.",
  outcomes: true,
}));
add("T2M-SE-05", ["swsh"], () => ({
  title: "Milotic's Breaking Swipe into Mummy Cofagrigus and Rough Skin Garchomp: the first contact gives it Mummy, Rough Skin's loss",
  slots: slots(act(mon("Milotic", "Competitive", { evs: { spe: 252 } }), "Breaking Swipe"), idle(L("swsh", 1)),
    idle(mon("Garchomp", "Rough Skin")), idle(mon("Cofagrigus", "Mummy"))),
  checks: "abilities.ts mummy onDamagingHit (contact): setAbility on the source; Rough Skin 1/8.",
  outcomes: true,
}));
add("T2M-SE-05", ["sv"], () => ({
  title: "Milotic's Breaking Swipe into Lingering Aroma Oinkologne and Rough Skin Garchomp (SV has no Cofagrigus: Lingering Aroma)",
  slots: slots(act(mon("Milotic", "Competitive", { evs: { spe: 252 } }), "Breaking Swipe"), idle(L("sv", 1)),
    idle(mon("Garchomp", "Rough Skin")), idle(mon("Oinkologne", "Lingering Aroma"))),
  checks: "abilities.ts lingeringaroma onDamagingHit (contact): setAbility on the source; Rough Skin 1/8.",
  outcomes: true,
}));

// ================================ K: a contact spread move into Spiky Shield (T2M §3.4) ================================
add("T2M-SCK-01", ["champions", "sv"], (game) => ({
  title: "Garchomp at 20 HP Breaking Swipe into a Spiky Shield Chesnaught and a Snorlax: the shield knocks it out first, the Snorlax still hit (T2-SCK01)",
  slots: slots(act(mon("Garchomp", "Rough Skin", { hp: 20, evs: fastEvs(game) }), "Breaking Swipe"), idle(L(game, 1)),
    idle(L(game, 2)), act(mon("Chesnaught", "Bulletproof"), "Spiky Shield")),
  checks: "Every target's TryHit first (battle-actions.ts:550-577): Spiky Shield's 1/8 (22) faints the user before the hits; hitStepMoveHitLoop reads no user HP.",
}));
add("T2M-SCK-02", ["usum"], () => ({
  title: "Garchomp at 20 HP: a Z-Move (Devastating Drake) through Chesnaught's Spiky Shield, the user's HP followed",
  slots: slots(act(mon("Garchomp", "Rough Skin", { hp: 20, item: "Dragonium Z", choice: "zmove", evs: { spe: 252 } }), "Dragon Claw", PR), idle(L("usum", 1)),
    idle(L("usum", 2)), act(mon("Chesnaught", "Bulletproof"), "Spiky Shield")),
  checks: "A Z-Move through protection deals 1/4 (zBrokeProtect); the shield's contact damage (if any) on the user before its hit.",
}));

// ================================ K: Unnerve (T2M §3.6, §3.7) ================================
add("T2M-UN-01", ["sv", "champions"], (game) => ({
  title: "Tyranitar's Unnerve beside Garchomp: Garchomp's Dragon Claw into a Haban Berry Dragonite: no Berry (a third Pokémon's Unnerve) (T2-UN01)",
  slots: slots(idle(mon("Tyranitar", "Unnerve")), act(mon("Garchomp", "Rough Skin", { evs: fastEvs(game) }), "Dragon Claw", PR),
    idle(L(game, 2)), idle(mon("Dragonite", "Inner Focus", { item: "Haban Berry" }))),
  checks: "abilities.ts unnerve onFoeTryEatItem: any foe's Unnerve stops the resist Berry (116 vs 58).",
}));
add("T2M-UN-02", ["sv", "usum"], (game) => ({
  title: "Tyranitar (Unnerve)'s Earthquake into its Shuca Berry ally Magnezone: its own Unnerve does not stop its ally's Berry (T2-UN02)",
  slots: slots(act(mon("Tyranitar", "Unnerve", { evs: fastEvs(game) }), "Earthquake"), idle(mon("Magnezone", "Sturdy", { item: "Shuca Berry" })),
    idle(L(game, 8)), idle(L(game, 4))),
  checks: "onFoeTryEatItem: an ally is no foe; the Shuca Berry halves Earthquake into Magnezone.",
}));
add("T2M-UNR-01", ["sv", "champions"], (game) => ({
  title: "Arcanine (Sitrus, 100 HP) Flare Blitz knocks out a 5 HP Tyranitar (Unnerve, Rocky Helmet): the hit's Update (Unnerve gone) eats the Sitrus before the recoil (T2-UN03)",
  slots: slots(act(mon("Arcanine", "Intimidate", { item: "Sitrus Berry", hp: 100, evs: fastEvs(game) }), "Flare Blitz", PR), idle(L(game, 1)),
    idle(L(game, 2)), idle(mon("Tyranitar", "Unnerve", { item: "Rocky Helmet", hp: 5 }))),
  checks: "Rocky Helmet 1/6 at the knocking hit; the Update after it runs with Tyranitar fainted (no Unnerve): Sitrus, then recoil.",
}));
add("T2M-UNR-02", ["sv", "champions"], (game) => ({
  title: "Arcanine (Sitrus, 84 HP) Flare Blitz knocks out a 5 HP Unnerve Tyranitar (Leftovers): the recoil takes it to half, and the Sitrus is eaten (the Unnerve holder gone)",
  slots: slots(act(mon("Arcanine", "Intimidate", { item: "Sitrus Berry", hp: 84, evs: fastEvs(game) }), "Flare Blitz", PR), idle(L(game, 1)),
    idle(L(game, 2)), idle(mon("Tyranitar", "Unnerve", { item: "Leftovers", hp: 5 }))),
  checks: "Arcanine at 84 of 165: the recoil (round(5 × 33 %) = 2) takes it to 82, half or less; the move's last Update eats the Sitrus with the Unnerve holder gone.",
}));

// ================================ K: Cotton Down (T2M §3.8, SwSh) ================================
add("T2M-CD-01", ["swsh"], () => ({
  title: "Garchomp's Dragon Claw into Eldegoss (Cotton Down): Spe −1 on Garchomp and Eldegoss's ally; its ally Corviknight's Mirror Armor reflects (T2-CD01)",
  slots: slots(act(mon("Garchomp", "Rough Skin", { evs: { spe: 252 } }), "Dragon Claw", PR), idle(mon("Corviknight", "Mirror Armor")),
    idle(L("swsh", 2)), idle(mon("Eldegoss", "Cotton Down"))),
  checks: "abilities.ts cottondown onDamagingHit: every other active Pokémon −1 Spe in getAllActive order; Mirror Armor sends it to Eldegoss.",
  outcomes: true,
}));
add("T2M-CD-02", ["swsh"], () => ({
  title: "Dragonite's two-hit Dual Wingbeat into Eldegoss: two rounds of drops; Dragonite's Defiant ally Bisharp +2 Atk twice (T2-CD02)",
  slots: slots(act(mon("Dragonite", "Inner Focus", { evs: { spe: 252 } }), "Dual Wingbeat", PR), idle(mon("Bisharp", "Defiant")),
    idle(L("swsh", 2)), idle(mon("Eldegoss", "Cotton Down"))),
  checks: "Cotton Down per damaging hit; Defiant on each drop from a foe.",
  outcomes: true,
}));

// ================================ K: Flower Veil (T2M §3.9) ================================
add("T2M-FV-01", ["sv", "usum"], (game) => ({
  title: "Incineroar's Snarl into Flower Veil Comfey and its Grass ally Venusaur: the drop kept off Venusaur, not off the Fairy Comfey (T2-FV01)",
  slots: slots(act(mon("Incineroar", "Blaze", { evs: fastEvs(game) }), "Snarl"), idle(L(game, 1)),
    idle(mon("Venusaur", "Overgrow")), idle(mon("Comfey", "Flower Veil"))),
  checks: "abilities.ts flowerveil onAllyTryBoost: a Grass-type ally's drops from another Pokémon blocked.",
  outcomes: true,
}));
add("T2M-FV-02", ["sv", "champions"], (game) => ({
  title: "A Mold Breaker Excadrill's Bulldoze into Flower Veil's side: Mold Breaker passes the veil; its Protecting ally (T2-FV02)",
  slots: slots(act(mon("Excadrill", "Mold Breaker", { evs: fastEvs(game) }), "Bulldoze"), act(L(game, 0), "Protect"),
    idle(mon("Venusaur", "Overgrow")), idle(game === "champions" ? mon("Florges", "Flower Veil") : mon("Comfey", "Flower Veil"))),
  checks: "Flower Veil is breakable: both foes −1 Spe; the ally's Protect blocks its hit. (Champions has no Comfey: Florges.)",
  outcomes: true,
}));

// ================================ K: Battle Bond (T2M §3.10, C22) ================================
add("T2M-BB-01", ["sv"], () => ({
  title: "Greninja-Bond's Dark Pulse knocks out a 1 HP Alakazam: Battle Bond +1 Atk, Sp. Atk, Spe; its ally's later Body Slam (T2-BB01)",
  slots: slots(act(mon("Greninja-Bond", "Battle Bond", { evs: { spe: 252 } }), "Dark Pulse", PR), act(L("sv", 1), "Body Slam", PL),
    idle(L("sv", 2)), idle(mon("Espeon", "Synchronize", { hp: 1 }))),
  checks: "abilities.ts battlebond onSourceAfterFaint (gen 9): one boost, bondTriggered (E2 onceUsed). (SV has no Alakazam: Espeon.)",
  outcomes: true,
}));
add("T2M-BB-02", ["usum"], () => ({
  title: "Greninja-Bond knocks out a foe: Ash form (its stats); a slower foe's Body Slam into it then (T2-BB02)",
  slots: slots(act(mon("Greninja-Bond", "Battle Bond", { evs: { spe: 252 } }), "Dark Pulse", PR), idle(L("usum", 1)),
    act(L("usum", 2), "Body Slam", OL), idle(mon("Alakazam", "Inner Focus", { hp: 1 }))),
  checks: "gen 7 formeChange to Greninja-Ash: the Body Slam reads the Ash form's Defense (E2 species).",
  outcomes: true,
}));
add("T2M-BB-03", ["sv"], () => ({
  title: "Greninja-Bond knocks out the foe side's last Pokémon (no bench, its partner gone): no boost (foePokemonLeft 0) (T2-BB03)",
  canSwitch: { opponent: false },
  slots: slots(act(mon("Greninja-Bond", "Battle Bond", { evs: { spe: 252 } }), "Dark Pulse", PR), idle(L("sv", 1)),
    { ...L("sv", 2), absent: true, action: { move: null } }, idle(mon("Espeon", "Synchronize", { hp: 1 }))),
  checks: "foePokemonLeft counted after the faint: 0, no boost (the battle ends).",
}));
add("IN-BBD-02", ["sv"], () => ({
  title: "Battle Bond already used this battle (onceUsed): Greninja's knockout gives nothing (IN-P18; C22: SV only)",
  slots: slots(act(carried(mon("Greninja-Bond", "Battle Bond", { evs: { spe: 252 } }), { onceUsed: ["battlebond"] }), "Dark Pulse", PR), act(L("sv", 1), "Body Slam", PL),
    idle(L("sv", 2)), idle(mon("Espeon", "Synchronize", { hp: 1 }))),
  checks: "bondTriggered set: no boost; no 'Assumes … Battle Bond' fact.",
  outcomes: true,
}));

// ================================ K: Aftermath, Innards Out (T2M §3.11) ================================
add("T2M-AF-01", ["sv"], (game) => ({
  title: "Garchomp (Sitrus, 110 HP) Dragon Claw knocks out a 1 HP Drifblim (Aftermath): a quarter inside the hit, then the Sitrus at its Update (T2-AF01)",
  slots: slots(act(mon("Garchomp", "Rough Skin", { item: "Sitrus Berry", hp: 110, evs: fastEvs(game) }), "Dragon Claw", PR), idle(L(game, 1)),
    idle(L(game, 2)), idle(mon("Drifblim", "Aftermath", { hp: 1 }))),
  checks: "abilities.ts aftermath onDamagingHit (contact, the knocking hit): trunc(183/4) = 45; Sitrus at the hit's Update.",
}));
add("T2M-AF-01", ["champions"], () => ({
  title: "Garchomp (Sitrus, 110 HP) Dragon Claw knocks out a 1 HP Garbodor (Aftermath): a quarter inside the hit, then the Sitrus (Champions has no Drifblim)",
  slots: slots(act(mon("Garchomp", "Rough Skin", { item: "Sitrus Berry", hp: 110, evs: { spe: 32 } }), "Dragon Claw", PR), idle(L("champions", 1)),
    idle(L("champions", 2)), idle(mon("Garbodor", "Aftermath", { hp: 1 }))),
  checks: "abilities.ts aftermath: trunc(183/4) = 45 at the knocking hit; the Sitrus at its Update.",
}));
add("T2M-AF-02", ["sv"], () => ({
  title: "The same knockout with a Damp Bellibolt on the field: no Aftermath (T2-AF02)",
  slots: slots(act(mon("Garchomp", "Rough Skin", { item: "Sitrus Berry", hp: 110, evs: { spe: 252 } }), "Dragon Claw", PR), idle(L("sv", 1)),
    idle(mon("Bellibolt", "Damp")), idle(mon("Drifblim", "Aftermath", { hp: 1 }))),
  checks: "abilities.ts damp onAnyDamage: Aftermath's damage stopped.",
}));
add("T2M-AF-02", ["usum"], () => ({
  title: "The same knockout with a Damp Politoed on the field: no Aftermath (T2-AF02)",
  slots: slots(act(mon("Garchomp", "Rough Skin", { item: "Sitrus Berry", hp: 110, evs: { spe: 252 } }), "Dragon Claw", PR), idle(L("usum", 1)),
    idle(mon("Politoed", "Damp")), idle(mon("Drifblim", "Aftermath", { hp: 1 }))),
  checks: "abilities.ts damp onAnyDamage: Aftermath's damage stopped.",
}));
add("T2M-AF-03", ["sv", "swsh"], (game) => ({
  title: "Arcanine's Flare Blitz knocks out a 30 HP Aftermath holder (Electrode; SwSh: Drifblim): Aftermath before the recoil (T2-AF03)",
  slots: slots(act(mon("Arcanine", "Intimidate", { evs: fastEvs(game) }), "Flare Blitz", PR), idle(L(game, 1)),
    idle(L(game, 2)), idle(mon(game === "swsh" ? "Drifblim" : "Electrode", "Aftermath", { hp: 30 }))),
  checks: "Aftermath (DamagingHit order 1) inside the hit; recoil after the loop.",
}));
add("T2M-IO-01", ["swsh", "usum"], (game) => ({
  title: "Garchomp's Dragon Claw knocks out Pyukumuku at 40 HP: Innards Out deals Garchomp 40 (T2-IO01)",
  slots: slots(act(mon("Garchomp", "Rough Skin", { evs: fastEvs(game) }), "Dragon Claw", PR), idle(L(game, 1)),
    idle(L(game, 2)), idle(mon("Pyukumuku", "Innards Out", { hp: 40 }))),
  checks: "abilities.ts innardsout onDamagingHit: damage + move.totalDamage... the HP it had at the hit.",
}));
add("T2M-IO-02", ["swsh"], () => ({
  title: "Dragonite's two-hit Dual Wingbeat knocks out Pyukumuku at 45 HP on the second hit: Innards Out deals the HP it had as the move started (T2-IO02)",
  slots: slots(act(mon("Dragonite", "Inner Focus", { evs: { spe: 252 } }), "Dual Wingbeat", PR), idle(L("swsh", 1)),
    idle(L("swsh", 2)), idle(mon("Pyukumuku", "Innards Out", { hp: 45 }))),
  checks: "innardsout: target.getUndynamaxedHP(damage) with totalDamage: 45 to Dragonite.",
}));
add("T2M-IO-03", ["champions"], () => ({
  title: "Garchomp's Rock Slide knocks out Victreebel-Mega (Innards Out) at 30 HP and hits its ally: 30 to the attacker (T2-IO03)",
  slots: slots(act(mon("Garchomp", "Rough Skin", { evs: { spe: 32 } }), "Rock Slide"), idle(L("champions", 1)),
    idle(L("champions", 2)), idle(mon("Victreebel-Mega", "Innards Out", { hp: 30, item: "Victreebelite" }))),
  checks: "A spread knockout: Innards Out's loss joins the user's first loss group.",
}));
add("T2M-IO-03", ["swsh"], () => ({
  title: "Garchomp's Rock Slide knocks out Pyukumuku (Innards Out) at 30 HP and hits its ally: 30 to the attacker",
  slots: slots(act(mon("Garchomp", "Rough Skin", { evs: { spe: 252 } }), "Rock Slide"), idle(L("swsh", 1)),
    idle(L("swsh", 2)), idle(mon("Pyukumuku", "Innards Out", { hp: 20 }))),
  checks: "A spread knockout: Innards Out's loss joins the user's first loss group.",
}));

// ================================ K: Receiver, Power of Alchemy (T2M §3.12) ================================
add("T2M-RC-01", ["sv", "champions"], (game) => ({
  title: "Passimian (Receiver) beside a 1 HP Incineroar (Intimidate); a foe knocks Incineroar out; Passimian gets Intimidate, which acts on both foes (T2-RC01)",
  slots: slots(idle(mon("Incineroar", "Intimidate", { hp: 1 })), idle(mon("Passimian", "Receiver")),
    idle(L(game, 2, { boosts: { atk: -1 } })), act(mon("Garchomp", "Rough Skin", { evs: fastEvs(game), boosts: { atk: -1 } }), "Dragon Claw", OL)),
  checks: "abilities.ts receiver onAllyFaint: setAbility(intimidate) runs its Start: both foes −1 Atk again (the lead's −1 is in the stages).",
  outcomes: true,
}));
add("T2M-RC-02", ["usum", "sv"], (game) => ({
  title: "Alolan Muk (Power of Alchemy) beside a 1 HP Bronzong (Levitate); a foe knocks Bronzong out; Muk gets Levitate and a later Earthquake misses it (T2-RC02)",
  slots: slots(idle(mon("Bronzong", "Levitate", { hp: 1 })), idle(mon("Muk-Alola", "Power of Alchemy")),
    act(mon("Excadrill", "Sand Rush", slowest(game)), "Earthquake"), act(mon("Garchomp", "Rough Skin", { evs: fastEvs(game) }), "Dragon Claw", OL)),
  checks: "Power of Alchemy takes Levitate (not noreceiver); Earthquake: Muk immune, Garchomp hit. (The probe's Gengar has no Levitate in these catalogs: Bronzong.)",
  outcomes: true,
}));

// ================================ M: G-Max effects and Max Guard (T2M §3.19, SwSh) ================================
const gmax = (species: string, ability: string, extra: Partial<CaseMon> = {}): CaseMon =>
  mon(species, ability, { evs: { spe: 252 }, gender: "M", choice: "dynamax", gigantamax: true, appBuild: { mechanic: "gigantamax", configuration: { dynamaxLevel: 10, gigantamax: true } }, ...extra });
const gm = (id: string, title: string, user: CaseMon, move: string, foes: [CaseMon, CaseMon] = [L("swsh", 3), L("swsh", 2)], ally: CaseMon = L("swsh", 1), extra: Partial<Case> = {}) =>
  add(id, ["swsh"], () => ({
    title, outcomes: true, ...extra,
    slots: slots(act(user, move, PR), idle(ally), idle(foes[1]), idle(foes[0])),
    checks: `moves.ts ${id}'s G-Max move self.onHit (T2-${id.slice(4)}).`,
  }));
gm("T2M-GM-01", "Gigantamax Hatterene's G-Max Smite: every foe confused (T2-GM01)", gmax("Hatterene", "Magic Bounce", { gender: "F" }), "Dazzling Gleam");
gm("T2M-GM-02", "Gigantamax Meowth's G-Max Gold Rush: every foe confused (T2-GM02)", gmax("Meowth", "Pickup"), "Pay Day");
gm("T2M-GM-03", "Gigantamax Eevee's G-Max Cuddle: every foe of the opposite gender infatuated (T2-GM03)", gmax("Eevee", "Run Away"), "Body Slam",
  [L("swsh", 3, { gender: "F" }), L("swsh", 2, { gender: "M" })]);
add("T2M-GM-04", ["swsh"], () => ({
  title: "Gigantamax Machamp's G-Max Chi Strike: its side +1 critical-hit ratio; then its slower Scope Lens ally's Stone Edge (+3: certain) (T2-GM04)",
  outcomes: true,
  slots: slots(act(gmax("Machamp", "Guts"), "Close Combat", PR), act(mon("Garchomp", "Rough Skin", { item: "Scope Lens", ...slowest("swsh") }), "Stone Edge", PL),
    idle(L("swsh", 2)), idle(L("swsh", 3))),
  checks: "gmaxchistrike volatile on the user and its ally (layers 1); Scope Lens +1, Stone Edge +1: stage 3, a certain critical hit (gen 7+ critMult).",
}));
gm("T2M-GM-05", "Gigantamax Alcremie's G-Max Finale: the user's side heals 1/6 (its ally at 100 HP) (T2-GM05)", gmax("Alcremie", "Sweet Veil", { gender: "F" }), "Dazzling Gleam",
  undefined, L("swsh", 1, { hp: 100 }));
gm("T2M-GM-06", "Gigantamax Butterfree's G-Max Befuddle: each foe a random status (par, psn, slp: 9 worlds) (T2-GM06)", gmax("Butterfree", "Compound Eyes"), "Bug Buzz");
gm("T2M-GM-07", "Gigantamax Toxtricity's G-Max Stun Shock: each foe paralysed or poisoned (T2-GM07)", gmax("Toxtricity", "Punk Rock"), "Overdrive");
add("T2M-GM-08", ["swsh"], () => ({
  title: "Gigantamax Snorlax's G-Max Replenish: 1/2 for the move, the Berries its side ate come back (Lum to the user, Sitrus to its ally) (T2-GM08)",
  outcomes: true,
  slots: slots(act(gmax("Snorlax", "Thick Fat", { lastItem: "Lum Berry" }), "Body Slam", PR), idle(L("swsh", 1, { lastItem: "Sitrus Berry" })),
    idle(L("swsh", 2)), idle(L("swsh", 3))),
  checks: "moves.ts gmaxreplenish: randomChance(1, 2) once; each Pokémon of the side holding nothing gets its lastItem Berry back.",
}));
add("T2M-GM-09", ["swsh"], () => ({
  title: "A Dynamaxed Snorlax's status move is Max Guard; a foe's Max Move into it is blocked (T2-GM09)",
  slots: slots(act(mon("Snorlax", "Thick Fat", { evs: { spe: 252 }, choice: "dynamax" }), "Curse"), idle(L("swsh", 1)),
    idle(L("swsh", 3)), act(mon("Garchomp", "Rough Skin", { choice: "dynamax" }), "Dragon Claw", OL)),
  checks: "moves.ts maxguard: priority 4, blocks Max Moves; Max Wyrmwind blocked.",
}));
add("T2M-PS-01", ["swsh"], () => ({
  title: "Gengar (100 HP) Pain Split into a Dynamaxed Snorlax at 150 (300/470 Dynamaxed); the Snorlax attacks after (T2-PS01)",
  slots: slots(act(mon("Gengar", "Cursed Body", { hp: 100, evs: { spe: 252 } }), "Pain Split", PR), idle(L("swsh", 1)),
    idle(L("swsh", 2)), act(mon("Snorlax", "Thick Fat", { hp: 150, choice: "dynamax" }), "Body Slam", OR)),
  checks: "moves.ts painsplit: the undynamaxed HP averaged (getUndynamaxedHP), the Dynamaxed HP changed by the difference.",
}));
add("T2M-PS-02", ["swsh"], () => ({
  title: "Gengar at full HP Pain Split into a Dynamaxed Snorlax at 50 (100/470 Dynamaxed)",
  slots: slots(act(mon("Gengar", "Cursed Body", { evs: { spe: 252 } }), "Pain Split", PR), idle(L("swsh", 1)),
    idle(L("swsh", 2)), act(mon("Snorlax", "Thick Fat", { hp: 50, choice: "dynamax" }), "Body Slam", OR)),
  checks: "The Dynamaxed foe low, the user high: Gengar loses, the Snorlax gains by the undynamaxed difference.",
}));

// ================================ CL: Sleep Talk, Uproar, Helping Hand twice (T2M §3.26, §3.28; C26) ================================
add("T2M-ST-01", ["sv", "champions"], (game) => ({
  title: "An asleep Snorlax (Sleep Talk, Body Slam, Earthquake, Protect) uses Sleep Talk: 1/3 each; Body Slam at a random foe (T2-ST01)",
  slots: slots(act(L(game, 30, { status: "slp", moves: ["Body Slam", "Earthquake", "Protect"], exactMoves: true }), "Sleep Talk"), idle(L(game, 1)),
    idle(L(game, 3)), idle(L(game, 2))),
  checks: "moves.ts sleeptalk: a uniform pick over its slots but Sleep Talk; the called move's random target (getRandomTarget). Its sleep counter goes down first.",
}));
add("T2M-ST-02", ["usum"], () => ({
  title: "Komala (Comatose) uses Sleep Talk: Wood Hammer or Sucker Punch, 1/2 each, at a random foe (TP2·ST2)",
  slots: slots(act(mon("Komala", "Comatose", { moves: ["Wood Hammer", "Sucker Punch"], exactMoves: true }), "Sleep Talk"), idle(L("usum", 1)),
    act(L("usum", 3), "Body Slam", OR), idle(L("usum", 2))),
  checks: "Comatose counts as asleep for Sleep Talk; Sucker Punch fails into a foe that is not attacking (the Splash) and works into the Body Slam user.",
}));
add("T2M-ST-02b", ["usum"], () => ({
  title: "Komala (Comatose) with Sleep Talk, Rest and Wood Hammer: Rest is callable and fails (Comatose), Wood Hammer at a random foe",
  slots: slots(act(mon("Komala", "Comatose", { moves: ["Rest", "Wood Hammer"], exactMoves: true }), "Sleep Talk"), idle(L("usum", 1)),
    idle(L("usum", 3)), idle(L("usum", 2))),
  checks: "SV has no Komala: a second USUM case. Rest under Comatose fails.",
}));
// ADDENDUM2 §9's cross-family checklist: Sleep Talk with a two-turn move (not callable) and Uproar waking its user.
add("T2M-ST-03", ["sv"], () => ({
  title: "Sleep Talk with Solar Beam and Body Slam: Solar Beam (a charge move) is not callable, so Body Slam every time",
  slots: slots(act(L("sv", 30, { status: "slp", moves: ["Solar Beam", "Body Slam"], exactMoves: true }), "Sleep Talk"), idle(L("sv", 1)), idle(L("sv", 3)), idle(L("sv", 2))),
  checks: "moves.ts sleeptalk: flags.charge moves are left out of the pick.",
}));
add("T2M-ST-04", ["sv"], () => ({
  title: "A faster foe's Uproar wakes the Sleep Talk user before it moves: Sleep Talk fails (awake)",
  slots: slots(act(L("sv", 1, { status: "slp", moves: ["Body Slam"], exactMoves: true }), "Sleep Talk"), idle(L("sv", 2)), idle(L("sv", 3)), act(mon("Annihilape", "Inner Focus", { evs: { spe: 252 } }), "Uproar")),
  checks: "Uproar's onTryHit cures every sleeper; Sleep Talk's onTry fails for an awake user.",
}));
add("T2M-UP-01", ["sv", "swsh"], (game) => ({
  title: "Uproar (SV Annihilape, SwSh Exploud) wakes an asleep foe; its ally's Rest and a foe's Spore then fail (T2-UP01)",
  slots: slots(act(game === "sv" ? mon("Annihilape", "Inner Focus", { evs: fastEvs(game) }) : mon("Exploud", "Soundproof", { evs: fastEvs(game) }), "Uproar"), act(L(game, 2, { hp: 100 }), "Rest"),
    idle(L(game, 3, { status: "slp" })), act(mon("Amoonguss", "Effect Spore"), "Spore", OL)),
  checks: "moves.ts uproar onTryHit cures sleep on both sides; the uproar volatile's onAnySetStatus fails slp (Rest, Spore). E2 uproar turns left.",
  outcomes: true,
}));
add("T2E-UP-01", ["champions", "sv"], (game) => ({
  title: "An Uproar from last turn (2 turns left): a drowsy foe's Yawn sleep at the end of turn fails; E2 turns left",
  slots: slots(act(carried(mon("Annihilape", "Inner Focus", { evs: fastEvs(game) }), { uproar: 2 }), "Uproar"), idle(L(game, 1)),
    idle(L(game, 3)), idle(carried(L(game, 2), { yawn: true }))),
  checks: "The carried uproar volatile: Yawn's onEnd trySetStatus slp fails (onAnySetStatus); uproar 1 after the countdown.",
  outcomes: true,
}));
add("T2M-HH-01", ["sv", "champions"], (game) => ({
  title: "Helping Hand twice: a foe's Instruct makes Clefable use Helping Hand again, so its ally's Body Slam has two Helping Hands (C26)",
  slots: slots(act(L(game, 0), "Body Slam", PR), act(mon("Clefable", "Magic Guard"), "Helping Hand", OL),
    act(mon("Oranguru", "Inner Focus", { evs: fastEvs(game) }), "Instruct", OR), idle(L(game, 2))),
  checks: "moves.ts helpinghand onRestart: the volatile's multiplier ×1.5 again (chainModify 1.5^2); Instruct prioritises Clefable's Helping Hand at once.",
}));

// ================================ Q13: Electrify and Ion Deluge (T2M §3.29) ================================
/** p2's user (PR) beside the Electrify (or Ion Deluge) user (PL, fastest), into a bulky Gyarados or Garchomp (OL). */
const q = (game: Game, title: string, user: CaseMon, move: string, opts: { ion?: boolean; control?: boolean; target?: CaseMon; field?: Case["field"]; check: string; context?: Record<string, unknown> } ) => ({
  title, ...(opts.field ? { field: opts.field } : {}),
  slots: slots(idle(opts.target ?? mon("Gyarados", "Moxie", { evs: evs(game, { hp: 252, spd: 252 }) })), idle(L(game, 1)),
    opts.ion
      ? (opts.control ? idle(mon("Lanturn", "Volt Absorb", { evs: fastEvs(game) })) : act(mon("Lanturn", "Volt Absorb", { evs: fastEvs(game) }), "Ion Deluge"))
      : (opts.control ? idle(mon("Heliolisk", "Dry Skin", { evs: fastEvs(game) })) : act(mon("Heliolisk", "Dry Skin", { evs: fastEvs(game) }), "Electrify", PR)),
    act(user, move, OL, opts.context)),
  checks: opts.check,
});
add("T2M-Q-01", ["swsh"], (game) => q(game, "Electrify: a Dynamaxed Pixilate Sylveon's Hyper Voice becomes Max Lightning (no -ate boost) (T2-Q01)",
  mon("Sylveon", "Pixilate", { choice: "dynamax" }), "Hyper Voice", { check: "battle-actions.ts:393-438: the Max Move is picked after ModifyType: Max Lightning at the base move's maxMove power; Electric Terrain." }));
add("T2M-Q-01b", ["swsh"], (game) => q(game, "Electrify: a Gigantamax Pikachu's Body Slam becomes G-Max Volt Crash (T2-Q02)",
  mon("Pikachu", "Static", { choice: "dynamax", gigantamax: true, appBuild: { mechanic: "gigantamax", configuration: { dynamaxLevel: 10, gigantamax: true } } }), "Body Slam",
  { check: "The user's Electric G-Max move replaces Max Lightning: G-Max Volt Crash paralyses the foes." }));
add("T2M-Q-02", ["usum"], (game) => q(game, "Electrify: a Firium Z Flamethrower (Inferno Overdrive) into Gyarados becomes Electric (T2-Q06)",
  mon("Arcanine", "Intimidate", { item: "Firium Z", choice: "zmove" }), "Flamethrower", { check: "ModifyType runs on the Z-Move: Electric, keeping its name and 175 power." }));
add("T2M-Q-02b", ["usum"], (game) => q(game, "Ion Deluge: a Z-Body Slam (Breakneck Blitz, Normal) becomes Electric (T2-Q04)",
  mon("Snorlax", "Thick Fat", { item: "Normalium Z", choice: "zmove" }), "Body Slam", { ion: true, check: "iondeluge onModifyType: Normal → Electric, the Z-Move included." }));
add("T2M-Q-03", ["usum"], (game) => q(game, "Electrify: a Snorlium Z Giga Impact (Pulverizing Pancake) into Garchomp: immune (T2-Q05)",
  mon("Snorlax", "Thick Fat", { item: "Snorlium Z", choice: "zmove" }), "Giga Impact", { target: mon("Garchomp", "Rough Skin", { evs: { hp: 252, def: 252 } }), check: "The signature Z-Move is Electric: Garchomp is immune." }));
add("T2M-Q-04", ["swsh", "champions"], (game) => q(game, "Electrify: Weather Ball in sun (Fire 100) becomes Electric with its doubled power (T2-Q03)",
  mon("Ninetales", "Flash Fire"), "Weather Ball", { field: { weather: "Sun" }, check: "Weather Ball's type and power at use, then Electrify: Electric 100." }));
add("T2M-Q-05", ["swsh", "champions"], (game) => q(game, "Electrify: Terrain Pulse on Psychic Terrain (Psychic 100) becomes Electric 100 (T2-Q10)",
  mon("Indeedee", "Inner Focus"), "Terrain Pulse", { field: { terrain: "Psychic" }, check: "Terrain Pulse's power from the terrain (grounded user), then Electric." }));
add("T2M-Q-06", ["usum"], (game) => q(game, "Electrify: Arceus-Fire (Flame Plate) Judgment becomes Electric (T2-Q07)",
  mon("Arceus-Fire", "Multitype", { item: "Flame Plate" }), "Judgment", { check: "Judgment's plate type, then Electrify." }));
add("T2M-Q-07", ["usum", "swsh"], (game) => q(game, "Electrify: Silvally-Fire (Fire Memory) Multi-Attack becomes Electric (T2-Q11)",
  mon("Silvally-Fire", "RKS System", { item: "Fire Memory" }), "Multi-Attack", { check: "Multi-Attack's memory type, then Electrify." }));
add("T2M-Q-08", ["usum", "swsh"], (game) => q(game, "Electrify: Genesect's Techno Blast with a Burn Drive (Fire) becomes Electric (T2-Q14)",
  mon("Genesect-Burn", "Download", { item: "Burn Drive", boosts: { atk: 1 }, appBoosts: {} }), "Techno Blast", { check: "Techno Blast's drive type, then Electrify. (Download's entry boost: Showdown's start; the app settles it.)" }));
add("T2M-Q-09", ["usum"], (game) => q(game, "Electrify: Oricorio (Baile, Fire) Revelation Dance becomes Electric (T2-Q15)",
  mon("Oricorio", "Dancer"), "Revelation Dance", { check: "Revelation Dance's type from the user's primary type, then Electrify." }));
add("T2M-Q-10", ["usum"], (game) => q(game, "Electrify: Natural Gift with a Sitrus Berry (Psychic 80) becomes Electric; the Berry is used up (T2-Q13)",
  mon("Snorlax", "Thick Fat", { item: "Sitrus Berry" }), "Natural Gift", { check: "Natural Gift's Berry type and power, then Electrify; the Berry consumed." }));
add("T2M-Q-11", ["usum"], (game) => q(game, "Electrify: Hidden Power (Fire IVs) becomes Electric (T2-Q08)",
  mon("Magnezone", "Sturdy", { ivs: { atk: 30, spa: 30, spe: 30 } }), "Hidden Power", { check: "Hidden Power's IV type (Fire), then Electrify." }));
add("T2M-Q-12", ["swsh", "champions"], (game) => q(game, "Electrify: Hangry Morpeko's Aura Wheel (Dark) becomes Electric (T2-Q12)",
  mon("Morpeko-Hangry", "Hunger Switch"), "Aura Wheel", { check: "Aura Wheel's form type (Dark), then Electrify." }));
add("T2M-Q-13", ["champions"], (game) => q(game, "Electrify: Tauros-Paldea-Blaze's Raging Bull (Fire) becomes Electric; Reflect still broken (T2-Q16)",
  mon("Tauros-Paldea-Blaze", "Intimidate"), "Raging Bull", { field: { own: { reflect: true } }, check: "Raging Bull's form type, then Electrify; its onTryHit breaks the screens either way." }));
add("T2M-Q-14", ["usum"], (game) => q(game, "Ion Deluge: Weather Ball with no weather (Normal) becomes Electric (T2-Q09)",
  mon("Castform", "Forecast"), "Weather Ball", { ion: true, check: "Ion Deluge changes only a Normal move: Weather Ball with no weather." }));
add("T2M-Q-14b", ["usum"], (game) => q(game, "Ion Deluge: Weather Ball in rain (Water) stays Water (T2-Q09b)",
  mon("Castform", "Forecast"), "Weather Ball", { ion: true, field: { weather: "Rain" }, check: "Weather Ball is Water before Ion Deluge reads it: unchanged." }));
void ev; void PL;

/** Wave 1b's T2M- cases (with FX-CE-01, IN-BBD-02 and T2E-UP-01). */
export const T2M_1B_CASES: Case[] = cases;
