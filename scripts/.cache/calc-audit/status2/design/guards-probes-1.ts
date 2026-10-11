// FAMILY 4 probes, part 1: Opportunist / Mirror Herb copying a rise (A) and the switch-out family (B), on pinned Showdown
// c23d2e94 through guards-sim.ts (exact enumeration, mid-turn switch requests answered).
// Run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/status2/design/guards-probes-1.ts > scripts/.cache/calc-audit/status2/design/guards-probes-1.out
import { Dex, enumerate, monAt, report, showTrace, type Mon, type Probe } from "./guards-sim";

const boosts = (p: any) => {
  if (!p) return "-";
  const parts = Object.entries(p.boosts as Record<string, number>).filter(([, v]) => v).map(([k, v]) => `${k}${v > 0 ? "+" : ""}${v}`);
  return parts.length ? parts.join(" ") : "0";
};
const who = (b: any) => ["p1a", "p1b", "p2a", "p2b"].map((id) => { const p = monAt(b, id as any); return `${id}:${p?.name}(${p?.hp}/${p?.maxhp}${p?.item ? " " + p.item : ""}) ${boosts(p)}`; }).join(" | ");
const LINES = /^\|(move|switch|drag|-weather|-heal|-damage|-boost|-unboost|-enditem|-item|-ability|-activate|-fail|-immune|cant|-start|-end|upkeep|-sidestart|turn|-mega|detailschange)\|/;
const snorlax: Mon = { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] };
/** Snorlax with n Speed EVs (no Speed ties between the fillers). */
const lax = (n: number, name = `Lax${n}`): Mon => ({ species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], evs: { spe: n * 8 }, name });
const torkoal: Mon = { species: "Torkoal", ability: "Shell Armor", moves: ["Splash"] };
const torkoalTackle: Mon = { species: "Torkoal", ability: "Shell Armor", moves: ["Tackle"] };
const run = (title: string, probe: Probe, opts: Parameters<typeof report>[2] = {}) => report(title, enumerate({ lines: LINES, ...probe }), opts);

// ---------------------------------------------------------------------------------------------------------------------
// A. Opportunist and Mirror Herb (PS/data/abilities.ts:3041-3082, PS/data/items.ts:4146-4190, PS/sim/battle.ts:2020-2088)
// ---------------------------------------------------------------------------------------------------------------------

// A1: Shell Smash: only the positive parts are copied (onFoeAfterBoost sums boost[i] > 0), at the move's AfterMove.
showTrace("A1 Shell Smash copied (positives only), before the next action", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1 1"]],
  mons: [{ species: "Cloyster", ability: "Skill Link", moves: ["Shell Smash"], evs: { spe: 252 } }, snorlax, { species: "Espathra", ability: "Opportunist", moves: ["Splash"] }, torkoalTackle],
}, LINES);
// A2: Howl (generation 8+: the user and its ally) raises both foes of the copier: the two tables are summed (+2 Atk).
showTrace("A2 Howl on two foes: the copy is the sum", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Arcanine", ability: "Justified", moves: ["Howl"], evs: { spe: 252 } }, snorlax, { species: "Espathra", ability: "Opportunist", moves: ["Splash"] }, snorlax],
}, LINES);
// A3: Defiant's +2 from a foe's Icy Wind is a foe's rise for the Icy Wind user's ally (its own AfterBoost, effect Defiant).
showTrace("A3 Defiant's rise copied by the Icy Wind user's partner", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Glalie", ability: "Inner Focus", moves: ["Icy Wind"], evs: { spe: 252 } }, { species: "Espathra", ability: "Opportunist", moves: ["Splash"] },
    { species: "Kingambit", ability: "Defiant", moves: ["Splash"] }, snorlax],
}, LINES);
// A4: Weakness Policy +2/+2 then Breaking Swipe's -1 Attack on the same target in one step: the copy is +2 Atk +2 SpA, the
// stage difference only +1 Atk +2 SpA (why the pairwise step must report its rises).
showTrace("A4 Weakness Policy rise and a drop in one hit", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Garchomp", ability: "Rough Skin", moves: ["Breaking Swipe"], evs: { spe: 252 } }, { species: "Espathra", ability: "Opportunist", moves: ["Splash"] },
    { species: "Dragonite", ability: "Inner Focus", item: "Weakness Policy", moves: ["Splash"] }, snorlax],
}, LINES);
// A5: Mirror Herb on a Contrary holder: the copy goes through its own boost() (Contrary inverts it); the Herb is used up.
showTrace("A5 Mirror Herb with Contrary", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Garchomp", ability: "Rough Skin", moves: ["Swords Dance"], evs: { spe: 252 } }, snorlax, { species: "Malamar", ability: "Contrary", item: "Mirror Herb", moves: ["Splash"] }, snorlax],
}, LINES);
// A6: a capped rise: +5 Attack Swords Dance raises 1; the copy is the capped table (+1).
showTrace("A6 capped rise copied as capped", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { b.p1.active[0].boosts.atk = 5; },
  mons: [{ species: "Garchomp", ability: "Rough Skin", moves: ["Swords Dance"], evs: { spe: 252 } }, snorlax, { species: "Espathra", ability: "Opportunist", moves: ["Splash"] }, snorlax],
}, LINES);
// A7: an ally's rise is not copied (onFoeAfterBoost); a foe's is. Flame Charge into the user's own Opportunist ally.
showTrace("A7 Flame Charge into its own Opportunist ally: only the foe copies", {
  game: "sv", turns: [["move 1 -2, move 1", "move 1, move 1"]],
  mons: [{ species: "Arcanine", ability: "Intimidate", moves: ["Flame Charge"], evs: { spe: 252 } }, { species: "Espathra", ability: "Opportunist", moves: ["Splash"], name: "EspathraAlly" },
    { species: "Espathra", ability: "Opportunist", moves: ["Splash"], name: "EspathraFoe" }, snorlax],
}, /^\|(move|-boost|-ability|-damage)\|/);
// A8: a copy is not copied back (effect named Opportunist).
showTrace("A8 two Opportunists: no copy of a copy", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Espathra", ability: "Opportunist", moves: ["Calm Mind"], evs: { spe: 252 }, name: "EspA" }, snorlax, { species: "Espathra", ability: "Opportunist", moves: ["Splash"], name: "EspB" }, snorlax],
}, /^\|(move|-boost|-ability)\|/);
// A9: Speed Boost at residual 28.2 is copied at residual 29 (onResidualOrder 29).
showTrace("A9 Speed Boost copied at the end of turn", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Ninjask", ability: "Speed Boost", moves: ["Splash"] }, snorlax, { species: "Espathra", ability: "Opportunist", moves: ["Splash"] }, snorlax],
}, /^\|(move|-boost|-ability|upkeep|turn)\|/);
// A10: a Liechi Berry eaten at the turn's first Update (beforeTurn's Update): the copy waits for the first AfterMove (no
// Mega or Tera this turn) - so a copier moving first reads no copy in its own move. A10b: a Mega Evolution this turn applies
// it at AfterMega, before any move (Champions).
showTrace("A10 a start Berry's rise: copied at the first AfterMove (Espathra moves first)", {
  game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { b.p2.active[0].sethp(40); },
  mons: [{ species: "Espathra", ability: "Opportunist", moves: ["Stored Power"], evs: { spe: 252 } }, snorlax, { species: "Garchomp", ability: "Rough Skin", item: "Liechi Berry", moves: ["Splash"] }, snorlax],
}, /^\|(move|-boost|-ability|-enditem|-damage|-mega)\|/);
{
  const dex = Dex.forFormat("gen9championsdoublescustomgame");
  const stone = { name: "Venusaurite", megaEvolves: "Venusaur" };
  const espathra = dex.species.get("Espathra");
  console.log(`
(Champions: Venusaurite nonstandard ${dex.items.get("venusaurite").isNonstandard}; Espathra nonstandard ${espathra.isNonstandard}; Opportunist ${dex.abilities.get("opportunist").isNonstandard})`);
  showTrace("A10b the same with a Mega Evolution this turn (Champions): copied at AfterMega, before any move", {
    game: "champions", turns: [["move 1 1, move 1 mega", "move 1, move 1"]], setup: (b) => { b.p2.active[0].sethp(40); },
    mons: [{ species: "Espathra", ability: "Opportunist", moves: ["Stored Power"], evs: { spe: 32 } }, { species: stone.megaEvolves, ability: "Chlorophyll", item: stone.name, moves: ["Splash"] },
      { species: "Garchomp", ability: "Rough Skin", item: "Liechi Berry", moves: ["Splash"] }, snorlax],
  }, /^\|(move|-boost|-ability|-enditem|-damage|-mega|detailschange)\|/);
}
// A11: Opportunist copying a rise made at the final Update (a pinch Berry after the residual): no AfterMove until the next turn.
showTrace("A11 a rise at the final Update: copied at the next turn's first AfterMove", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"], ["move 1, move 1", "move 1, move 1"]], setup: (b) => { b.p2.active[0].sethp(50); b.p2.active[0].setStatus("brn", null, null, true); },
  mons: [{ species: "Espathra", ability: "Opportunist", moves: ["Splash"] }, snorlax, { species: "Garchomp", ability: "Rough Skin", item: "Liechi Berry", moves: ["Splash"] }, snorlax],
}, /^\|(move|-boost|-ability|-enditem|-damage|upkeep|turn)\|/);

// ---------------------------------------------------------------------------------------------------------------------
// B. Switch-out with a replacement (PS/sim/battle-actions.ts:62-191 switchIn/runSwitch, PS/sim/battle.ts:2821-2914)
// ---------------------------------------------------------------------------------------------------------------------

// B1: one Icy Wind drops two Eject Pack holders: the first used switches (onUseItem: no other switchFlag); the second
// keeps effectState.eject and is used at the next AfterMove.
showTrace("B1 two Eject Packs from one Icy Wind", {
  game: "sv", turns: [["move 1, move 1 1", "move 1, move 1"]], bench: { p2: [lax(8, "BenchA"), lax(16, "BenchB")] },
  mons: [{ species: "Glalie", ability: "Inner Focus", moves: ["Icy Wind"], evs: { spe: 252 } }, { species: "Venusaur", ability: "Overgrow", moves: ["Tackle"] },
    { species: "Snorlax", ability: "Thick Fat", item: "Eject Pack", moves: ["Splash"], name: "PackA" }, { species: "Torkoal", ability: "Shell Armor", item: "Eject Pack", moves: ["Splash"], name: "PackB" }],
}, LINES);
// B2: an Intimidate replacement brought in mid-turn by U-turn drops the foes at once; the later foe move reads it.
showTrace("B2 U-turn into an Intimidate replacement", {
  game: "sv", turns: [["move 1 1, move 1", "move 1 -2, move 1"]], bench: { p1: [{ species: "Incineroar", ability: "Intimidate", moves: ["Splash"], name: "Incin" }] },
  mons: [{ species: "Rillaboom", ability: "Grassy Surge", moves: ["U-turn"], evs: { spe: 252 } }, snorlax, { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"] }, snorlax],
}, LINES);
// B3: hazards on the leaver's side hurt the replacement at entry (Stealth Rock, 1/8 for neutral).
showTrace("B3 Stealth Rock on the replacement mid-turn", {
  game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { b.p1.addSideCondition("stealthrock", "debug"); },
  bench: { p1: [{ species: "Charizard", ability: "Blaze", moves: ["Splash"], name: "Zard" }] },
  mons: [{ species: "Rillaboom", ability: "Grassy Surge", moves: ["U-turn"], evs: { spe: 252 } }, snorlax, snorlax, torkoal],
}, LINES);
// B4: Baton Pass passes the stages; Shed Tail passes its Substitute.
run("B4a Baton Pass with +2 Attack and +1 evasion", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { b.p1.active[0].boosts.atk = 2; b.p1.active[0].boosts.evasion = 1; },
  mons: [{ species: "Espathra", ability: "Speed Boost", moves: ["Baton Pass"], evs: { spe: 252 } }, lax(4), lax(12), torkoal],
  inspect: (b) => `${b.p1.active[0].name} ${JSON.stringify(b.p1.active[0].boosts)}`,
}, { hp: false });
for (const result of [true]) void result;
{
  const probe: Probe = { game: "sv", turns: [["move 1, move 1", "move 1, move 1 1"]], mons: [{ species: "Cyclizar", ability: "Regenerator", moves: ["Shed Tail"], evs: { spe: 252 } }, lax(4), lax(12), torkoalTackle], lines: LINES,
    inspect: (b) => { const p = b.p1.active[0]; return `${p.name} sub=${p.volatiles.substitute?.hp ?? "none"} hp=${p.hp}`; } };
  report("B4b Shed Tail passes its Substitute (Tackle into it)", enumerate(probe), { hp: true });
}
// B5: Roar drags in one of the living bench at random (getRandomSwitchable: sample): one world per bench Pokémon, equal mass.
run("B5 Roar with two bench Pokémon: uniform", {
  game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]], bench: { p2: [lax(8, "BenchA"), { species: "Blissey", ability: "Natural Cure", moves: ["Splash"], name: "BenchB" }] },
  mons: [{ species: "Arcanine", ability: "Justified", moves: ["Roar"] }, lax(4), lax(12), torkoal],
  inspect: (b) => `p2 active ${b.p2.active.map((p: any) => p.name).join(",")}`,
}, { lines: false, hp: false });
// B6: Regenerator heals the leaver on its way out (onSwitchOut: 1/3); Natural Cure cures it.
{
  const probe: Probe = { game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { b.p1.active[0].sethp(80); b.p1.active[0].setStatus("par", null, null, true); },
    mons: [{ species: "Rillaboom", ability: "Regenerator", moves: ["U-turn"], evs: { spe: 252 } }, lax(4), lax(12), torkoal], lines: LINES, force: [],
    inspect: (b) => b.p1.pokemon.map((p: any) => `${p.name} ${p.hp}/${p.maxhp} ${p.status || "-"} ${p.isActive ? "in" : "bench"}`).join(", ") };
  report("B6 Regenerator on the leaver (U-turn at 80 HP, paralysed: full paralysis branch enumerated)", enumerate(probe), { hp: false, lines: false });
}
// B7: from generation 8 the queue is re-sorted after each action: a Drought replacement doubles a Chlorophyll partner's Speed
// for its later move; generation 7 keeps the order sorted at the turn's start.
for (const game of ["sv", "usum"] as const) {
  showTrace(`B7 (${game}) U-turn into Drought: Chlorophyll's later order`, {
    game, turns: [["move 1 1, move 1 1", "move 1, move 1"]], bench: { p1: [{ species: "Torkoal", ability: "Drought", moves: ["Splash"], name: "Drought" }] },
    mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["U-turn"], evs: { spe: 252 } }, { species: "Venusaur", ability: "Chlorophyll", moves: ["Tackle"], name: "Saur" },
      { species: "Garchomp", ability: "Rough Skin", moves: ["Splash"], name: "Chomp" }, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] }],
  }, /^\|(move|switch|-weather)\|/);
}
// B8: Eject Button on the target of U-turn: the holder switches, the U-turn user stays (its switch cancelled).
showTrace("B8 U-turn into an Eject Button holder", {
  game: "sv", turns: [["move 1 1, move 1", "move 1, move 1 1"]],
  mons: [{ species: "Rillaboom", ability: "Grassy Surge", moves: ["U-turn"], evs: { spe: 252 } }, lax(4), { species: "Snorlax", ability: "Thick Fat", item: "Eject Button", moves: ["Splash"] }, torkoalTackle],
}, LINES);
// B9: Red Card drags the attacker's side's bench at random (two members: two worlds).
run("B9 Red Card with two bench Pokémon on the attacker's side", {
  game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]], bench: { p1: [lax(8, "BenchA"), { species: "Blissey", ability: "Natural Cure", moves: ["Splash"], name: "BenchB" }] },
  mons: [{ species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], evs: { spe: 252 } }, lax(4), { species: "Snorlax", ability: "Thick Fat", item: "Red Card", moves: ["Splash"] }, torkoal],
  inspect: (b) => `p1 active ${b.p1.active.map((p: any) => p.name).join(",")}`,
}, { lines: false, hp: false });
// B10: Emergency Exit mid-turn (Sword/Shield, Golisopod): the switch request after the damaging action that took it to half.
showTrace("B10 (swsh) Emergency Exit with a later action", {
  game: "swsh", turns: [["move 1, move 1 1", "move 1, move 1"]], setup: (b) => { b.p2.active[0].sethp(80); },
  mons: [{ species: "Garchomp", ability: "Rough Skin", moves: ["Earthquake"], evs: { atk: 252, spe: 252 } }, { species: "Snorlax", ability: "Thick Fat", moves: ["Tackle"] },
    { species: "Golisopod", ability: "Emergency Exit", moves: ["Splash"] }, torkoal],
}, LINES);
// B11: the replacement's own entry ability (Drizzle) vs a weather move later in the turn, and the newcomer takes a spread move.
showTrace("B11 the newcomer meets a later spread move", {
  game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]], bench: { p1: [{ species: "Pelipper", ability: "Drizzle", moves: ["Splash"], name: "Peli" }] },
  mons: [{ species: "Rillaboom", ability: "Grassy Surge", moves: ["U-turn"], evs: { spe: 252 } }, snorlax, { species: "Garchomp", ability: "Rough Skin", moves: ["Rock Slide"] }, torkoal],
}, LINES);
// B12: Parting Shot's drops set off no Eject Pack (activeMove partingshot), and the user switches.
showTrace("B12 Parting Shot into an Eject Pack holder", {
  game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Incineroar", ability: "Blaze", moves: ["Parting Shot"], evs: { spe: 252 } }, snorlax, { species: "Snorlax", ability: "Thick Fat", item: "Eject Pack", moves: ["Splash"] }, torkoal],
}, LINES);
// B13: the leaver's Neutralizing Gas ends as it switches: the suppressed Intimidate of the foe starts.
showTrace("B13 U-turn by a Neutralizing Gas holder: the foe's Intimidate starts", {
  game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Weezing-Galar", ability: "Neutralizing Gas", moves: ["U-turn"], evs: { spe: 252 } }, snorlax, { species: "Incineroar", ability: "Intimidate", moves: ["Splash"] }, torkoal],
}, /^\|(move|switch|-ability|-boost|-unboost|-end)\|/);
