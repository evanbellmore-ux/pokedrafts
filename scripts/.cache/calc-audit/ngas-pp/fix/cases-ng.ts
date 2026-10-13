// ngas-pp fix: 2v2 oracle cases NG01-NG22 for Neutralizing Gas from the turn's start (calculate.ts settleDoublesStart's
// DoublesGas; doubles-turn.ts gasEnds, gasShieldGuard and the gas presence guards), run through the pinned Showdown oracle
// (2v2/verify/sim-dfs.ts) and compared with the app (2v2/verify/compare.ts). Pinned Showdown c23d2e94
// data/abilities.ts neutralizinggas (onSwitchIn priority 2; onEnd restarts every other active Pokémon's ability) and
// sim/pokemon.ts:858-877 ignoringAbility (cantsuppress, another holder, Ability Shield outside Magic Room keep an ability).
// Level 50, 31 IVs, Serious, 0 EVs unless set: Speed is base + 20.
import type { Case, CaseAction, CaseMon, SlotId } from "../../2v2/verify/case-types";

type Slot = CaseMon & { action: CaseAction };
const mon = (species: string, ability: string, extra: Partial<CaseMon> = {}): CaseMon => ({ species, ability, ...extra });
const act = (m: CaseMon, move: string | null, target?: SlotId, choice?: CaseMon["choice"]): Slot => ({ ...m, ...(choice ? { choice } : {}), action: { move, ...(target ? { target } : {}) } });
const idle = (m: CaseMon): Slot => act(m, null);
const S = (a: Slot, b: Slot, c: Slot, d: Slot): Case["slots"] => ({ "own-left": a, "own-right": b, "opponent-left": c, "opponent-right": d });
const gasG = mon("Weezing-Galar", "Neutralizing Gas");
const gasK = mon("Weezing", "Neutralizing Gas");
const venusaur = mon("Venusaur", "Overgrow", { evs: { spe: 4 } });
const snorlax = (extra: Partial<CaseMon> = {}) => mon("Snorlax", "Thick Fat", { evs: { spe: 4 }, ...extra });
const NOT_ENDING = "Neutralizing Gas ending is not modelled in 2v2.";

export const NG_CASES: Case[] = [
  // Abilities that change damage are off from the start.
  { id: "NG01", title: "Gas Weezing idle: Charizard's Flamethrower into a Thick Fat Snorlax (full damage), Snorlax's Body Slam into Weezing (SV)", game: "sv",
    slots: S(idle(gasG), act(mon("Charizard", "Blaze"), "Flamethrower", "opponent-right"), idle(venusaur), act(snorlax(), "Body Slam", "own-left")), checks: "Thick Fat suppressed" },
  { id: "NG02", title: "Gas on the foe's side: Garchomp's Dragon Claw into a full-HP Multiscale Dragonite is not halved (SV)", game: "sv",
    slots: S(act(mon("Garchomp", "Rough Skin"), "Dragon Claw", "opponent-right"), idle(venusaur), idle(gasG), idle(mon("Dragonite", "Multiscale"))), checks: "Multiscale suppressed" },
  { id: "NG03", title: "Ability Shield keeps Snorlax's Thick Fat under the gas: Flamethrower is halved (SV)", game: "sv",
    slots: S(idle(gasG), act(mon("Charizard", "Blaze"), "Flamethrower", "opponent-right"), idle(venusaur), idle(snorlax({ item: "Ability Shield" }))), checks: "Ability Shield keeps it" },
  { id: "NG04", title: "Magic Room: Snorlax's Ability Shield does not work, so its Thick Fat is suppressed (SV)", game: "sv", field: { magicRoom: true },
    slots: S(idle(gasG), act(mon("Charizard", "Blaze"), "Flamethrower", "opponent-right"), idle(venusaur), idle(snorlax({ item: "Ability Shield" }))), checks: "Magic Room off the Shield" },
  { id: "NG05", title: "Earthquake hits a Levitate Hydreigon under the gas, and the gas holder across (SV)", game: "sv",
    slots: S(act(mon("Garchomp", "Rough Skin"), "Earthquake"), idle(mon("Talonflame", "Flame Body")), idle(gasG), idle(mon("Hydreigon", "Levitate"))), checks: "Levitate suppressed; spread" },
  { id: "NG06", title: "Unnerve suppressed: Tyranitar's Body Slam takes Snorlax under half and it eats its Sitrus Berry before Charizard's hit (SV)", game: "sv",
    slots: S(act(mon("Tyranitar", "Unnerve"), "Body Slam", "opponent-right"), act(mon("Charizard", "Blaze"), "Flamethrower", "opponent-right"), idle(gasG), idle(snorlax({ item: "Sitrus Berry", hp: 200 }))),
    checks: "Unnerve suppressed, Sitrus eaten" },
  { id: "NG07", title: "Friend Guard suppressed: Charizard's Flamethrower into Venusaur next to a Friend Guard Clefairy (SV)", game: "sv",
    slots: S(idle(gasG), act(mon("Charizard", "Blaze"), "Flamethrower", "opponent-left"), idle(venusaur), idle(mon("Clefairy", "Friend Guard"))), checks: "partner Friend Guard suppressed" },
  { id: "NG08", title: "Friend Guard kept by an Ability Shield: the gas holder's own Sludge Bomb into Venusaur is cut to 75% (SV)", game: "sv",
    slots: S(act(gasG, "Sludge Bomb", "opponent-left"), idle(mon("Charizard", "Blaze")), idle(venusaur), idle(mon("Clefairy", "Friend Guard", { item: "Ability Shield" }))), checks: "shielded partner ability vs the holder" },
  { id: "NG09", title: "Gale Wings suppressed: Talonflame's Brave Bird at full HP has no priority, Garchomp moves first (SV)", game: "sv",
    slots: S(act(mon("Talonflame", "Gale Wings"), "Brave Bird", "opponent-right"), idle(gasG), act(mon("Garchomp", "Rough Skin", { nature: "Jolly", evs: { spe: 252 } }), "Dragon Claw", "own-right"), idle(snorlax())),
    checks: "priority from an ability suppressed; Jolly Garchomp (169) before Talonflame (146)" },
  { id: "NG10", title: "Two gas holders: Garchomp's Dragon Claw into Dragonite (Multiscale suppressed), Weezing's Sludge Bomb into Weezing-Galar (SV)", game: "sv",
    slots: S(act(gasK, "Sludge Bomb", "opponent-left"), act(mon("Garchomp", "Rough Skin"), "Dragon Claw", "opponent-right"), idle(gasG), idle(mon("Dragonite", "Multiscale"))), checks: "two holders" },
  { id: "NG11", title: "Gas-proof Disguise: Sludge Bomb into an intact Mimikyu still breaks the disguise (SV)", game: "sv",
    slots: S(act(gasG, "Sludge Bomb", "opponent-left"), idle(venusaur), idle(mon("Mimikyu", "Disguise")), idle(snorlax())), checks: "cantsuppress" },
  { id: "NG12", title: "Mimicry suppressed on Electric Terrain: Raichu's Thunderbolt into Ground/Steel Stunfisk has no effect (SwSh)", game: "swsh", field: { terrain: "Electric" },
    slots: S(act(mon("Raichu", "Static"), "Thunderbolt", "opponent-left"), idle(gasK), idle(mon("Stunfisk-Galar", "Mimicry")), idle(snorlax())), checks: "Mimicry types" },
  { id: "NG13", title: "Dynamax under the gas: Max Flare into a Thick Fat Snorlax (SwSh)", game: "swsh",
    slots: S(act(mon("Charizard", "Blaze"), "Flamethrower", "opponent-right", "dynamax"), idle(gasK), idle(venusaur), idle(snorlax())), checks: "Max Move with gas" },
  { id: "NG14", title: "Terastallized Ogerpon-Wellspring: Embody Aspect is suppressed (no +1 Sp. Def) for Charizard's Flamethrower (SV)", game: "sv",
    slots: S(idle(gasG), act(mon("Charizard", "Blaze"), "Flamethrower", "opponent-left"), act(mon("Ogerpon-Wellspring", "Water Absorb", { item: "Wellspring Mask", teraType: "Water" }), null, undefined, "terastallize"), idle(snorlax())),
    checks: "Tera form ability suppressed" },
  { id: "NG15", title: "Terapagos-Terastal at full HP: Tera Shell is suppressed, Garchomp's Dragon Claw is neutral (SV)", game: "sv",
    slots: S(idle(gasG), act(mon("Garchomp", "Rough Skin"), "Dragon Claw", "opponent-left"), idle(mon("Terapagos", "Tera Shift")), idle(snorlax())), checks: "Tera Shift form, Tera Shell suppressed" },
  { id: "NG16", title: "The gas holder survives two hits: Garchomp and Charizard into Weezing-Galar (SV)", game: "sv",
    slots: S(act(mon("Garchomp", "Rough Skin"), "Dragon Claw", "opponent-left"), act(mon("Charizard", "Blaze"), "Air Slash", "opponent-left"), idle(gasG), idle(snorlax())), checks: "holder hit, gas stays" },
  { id: "NG23", title: "Cloud Nine suppressed: Blastoise's Hydro Pump into Snorlax is boosted by the rain (SV)", game: "sv", field: { weather: "Rain" },
    slots: S(idle(gasG), act(mon("Blastoise", "Torrent"), "Hydro Pump", "opponent-right"), idle(mon("Golduck", "Cloud Nine")), idle(snorlax())), checks: "weather negator suppressed" },
  { id: "NG24", title: "Lightning Rod suppressed: Magnezone's Thunderbolt hits Snorlax, not its partner Raichu (SV)", game: "sv",
    slots: S(act(mon("Magnezone", "Magnet Pull"), "Thunderbolt", "opponent-right"), idle(gasG), idle(mon("Raichu", "Lightning Rod")), idle(snorlax())), checks: "redirection suppressed" },
  { id: "NG28", title: "Water Absorb suppressed: Blastoise's Hydro Pump damages Politoed (SV)", game: "sv",
    slots: S(idle(gasG), act(mon("Blastoise", "Torrent"), "Hydro Pump", "opponent-left"), idle(mon("Politoed", "Water Absorb")), idle(snorlax())), checks: "absorbing ability suppressed" },
  { id: "NG25", title: "Quark Drive with Booster Energy suppressed: Iron Hands's Thunder Punch into Snorlax (SV)", game: "sv",
    slots: S(act(mon("Iron Hands", "Quark Drive", { item: "Booster Energy" }), "Thunder Punch", "opponent-right"), idle(gasG), idle(venusaur), idle(snorlax())), checks: "paradox boost suppressed, Booster Energy kept" },
  { id: "NG26", title: "Imposter suppressed: Ditto stays Ditto and takes Charizard's Flamethrower (SV)", game: "sv",
    slots: S(idle(gasG), act(mon("Charizard", "Blaze"), "Flamethrower", "opponent-left"), idle(mon("Ditto", "Imposter")), idle(snorlax())), checks: "no transformation" },
  { id: "NG27", title: "Sturdy suppressed: Charizard's Specs Overheat knocks out a full-HP Magnezone (SV)", game: "sv",
    slots: S(idle(gasG), act(mon("Charizard", "Blaze", { item: "Choice Specs", nature: "Modest", evs: { spa: 252 } }), "Overheat", "opponent-left"), idle(mon("Magnezone", "Sturdy")), idle(snorlax())),
    checks: "OHKO through Sturdy" },
  { id: "NG29", title: "Gluttony suppressed: Snorlax at 117 HP (half) keeps its Figy Berry; Flamethrower takes it to a quarter on some rolls (SV)", game: "sv",
    slots: S(idle(gasG), act(mon("Charizard", "Blaze"), "Flamethrower", "opponent-right"), idle(venusaur), idle(mon("Snorlax", "Gluttony", { evs: { spe: 4 }, item: "Figy Berry", hp: 117 }))),
    checks: "berry line at a quarter, not half" },
  { id: "NG30", title: "Serene Grace suppressed: Blissey's Rock Smash does not lower Snorlax's Defense before Conkeldurr's Hammer Arm (SwSh; the serene-grace unit test's turn)", game: "swsh",
    slots: S(act(mon("Blissey", "Serene Grace"), "Rock Smash", "opponent-left"), act(mon("Conkeldurr", "Guts"), "Hammer Arm", "opponent-left"), idle(snorlax()), idle(gasG)),
    checks: "doubled chance suppressed: the 50% drop does not happen" },
  { id: "NG31", title: "Core Enforcer into the gas holder (Weezing, 80) before it moves: no suppression, the gas stays (SwSh)", game: "swsh",
    slots: S(act(mon("Zygarde", "Aura Break"), "Core Enforcer"), idle(venusaur), idle(gasK), idle(snorlax())), checks: "willMove: no gastroacid" },
  // Guards: the gas ends, or what it suppresses changes.
  { id: "NG17", title: "The gas holder is knocked out by the first hit, with a later move (SV)", game: "sv", notEstimated: NOT_ENDING,
    slots: S(act(mon("Garchomp", "Rough Skin", { nature: "Jolly", evs: { atk: 252, spe: 252 } }), "Earthquake"), idle(mon("Talonflame", "Flame Body")), idle(mon("Weezing-Galar", "Neutralizing Gas", { hp: 20 })), act(snorlax(), "Body Slam", "own-left")),
    checks: "gas ends mid-turn" },
  { id: "NG18", title: "The gas holder is knocked out by the last move of the turn (SV)", game: "sv", notEstimated: NOT_ENDING,
    slots: S(act(snorlax(), "Body Slam", "opponent-left"), act(mon("Charizard", "Blaze"), "Flamethrower", "opponent-right"), idle(mon("Weezing-Galar", "Neutralizing Gas", { hp: 10 })), idle(venusaur)),
    checks: "gas ends after the last move (onEnd restarts abilities)" },
  { id: "NG19", title: "Eject Button on the gas holder hit by the last move (SV)", game: "sv", notEstimated: NOT_ENDING,
    slots: S(act(mon("Charizard", "Blaze"), "Flamethrower", "opponent-left"), idle(venusaur), idle(mon("Weezing-Galar", "Neutralizing Gas", { item: "Eject Button" })), idle(snorlax())),
    checks: "holder switched out" },
  { id: "NG20", title: "Knock Off removes Snorlax's Ability Shield under the gas (SV)", game: "sv", notEstimated: "An Ability Shield change under Neutralizing Gas is not modelled in 2v2.",
    slots: S(idle(gasG), act(mon("Tyranitar", "Unnerve"), "Knock Off", "opponent-right"), idle(venusaur), act(snorlax({ item: "Ability Shield" }), "Body Slam", "own-left")),
    checks: "Shield lost" },
  { id: "NG21", title: "Lingering Aroma kept by an Ability Shield under the gas (SV)", game: "sv", notEstimated: "Lingering Aroma with Neutralizing Gas is not modelled in 2v2.",
    slots: S(idle(gasG), act(mon("Garchomp", "Rough Skin"), "Dragon Claw", "opponent-right"), idle(venusaur), idle(mon("Oinkologne", "Lingering Aroma", { item: "Ability Shield" }))),
    checks: "contact replacer kept" },
  { id: "NG32", title: "Core Enforcer into a Choice Scarf gas holder that has moved: its gas ends (SwSh)", game: "swsh", notEstimated: NOT_ENDING,
    slots: S(act(mon("Zygarde", "Aura Break"), "Core Enforcer"), idle(venusaur), idle(mon("Weezing", "Neutralizing Gas", { item: "Choice Scarf" })), idle(snorlax())),
    checks: "gastroacid on the holder" },
  { id: "NG22", title: "Explosion from the gas holder (SV)", game: "sv", notEstimated: NOT_ENDING,
    slots: S(act(gasG, "Explosion"), idle(mon("Charizard", "Blaze")), idle(venusaur), idle(snorlax())), checks: "holder faints in its own move" },
];
