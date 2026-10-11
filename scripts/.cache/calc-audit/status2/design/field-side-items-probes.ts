// FAMILY 3 probes (status2 design: field, side, reflection and items): whole turns in pinned Showdown c23d2e94 on the
// earlier design's exact harness (status-eot/design/addendum-sim.ts: every random decision enumerated, every move hits,
// crits only when certain, the lowest roll), for the behaviours field-side-items.md's model rests on that CENSUS 1's
// K-probes do not already show. Where a claim is a difference the probe runs with a control. Ids: F<nn>[letter].
// Run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/status2/design/field-side-items-probes.ts [F01 ...] > scripts/.cache/calc-audit/status2/design/field-side-items-probes.out
import { enumerate, report, type AProbe } from "../../status-eot/design/addendum-sim";
import type { Game, Mon } from "../../status-eot/design/status-sim";

const LINES = /^\|(move|cant|-fail|-immune|-miss|-activate|-item|-enditem|-damage|-heal|-boost|-unboost|-setboost|-status|-curestatus|-start|-end|-singleturn|-sidestart|-sideend|-fieldstart|-fieldend|-fieldactivate|-ability|-swapsideconditions|-crit|-supereffective|-resisted|-block|-zbroken|-formechange|-transform|-clearallboost|-clearboost)\|/;
// Speeds at level 50, 0 EVs, 31 IVs, neutral nature: base + 20.
const still: Mon = { species: "Chansey", ability: "Natural Cure", moves: ["Splash"] }; // 70
const slow: Mon = { species: "Shuckle", ability: "Gluttony", moves: ["Splash"] }; // 25
const jolt = (moves: string[], over: Partial<Mon> = {}): Mon => ({ species: "Jolteon", ability: "Volt Absorb", moves, gender: "M", ...over }); // 150
const lapras = (moves: string[], over: Partial<Mon> = {}): Mon => ({ species: "Lapras", ability: "Shell Armor", moves, ...over }); // 80
const lax = (moves: string[], over: Partial<Mon> = {}): Mon => ({ species: "Snorlax", ability: "Thick Fat", moves, gender: "F", ...over }); // 50
const chomp = (moves: string[], over: Partial<Mon> = {}): Mon => ({ species: "Garchomp", ability: "Rough Skin", moves, ...over }); // 122
const base = (over: Partial<AProbe>): AProbe => ({ game: "sv", mons: [still, still, still, slow], turns: [["move 1, move 1", "move 1, move 1"]], lines: LINES, ...over });
const only = process.argv.slice(2);
const want = (id: string) => !only.length || only.includes(id);
const all = (b: any) => [...b.p1.active, ...b.p2.active];
const hps = (b: any) => all(b).map((p: any) => `${p.name} ${p.hp}${p.status ? ` ${p.status}` : ""}`).join(", ");
const order = (b: any) => (b.log as string[]).filter((l) => l.startsWith("|move|") && !l.includes("[from]")).map((l) => l.split("|")[2].split(": ")[1]).join(" > ");
const types = (b: any) => all(b).map((p: any) => `${p.name}:${p.getTypes().join("/")}`).join(" ");
const stages = (p: any) => Object.entries(p.boosts).filter(([, v]) => v).map(([k, v]) => `${k}${(v as number) > 0 ? "+" : ""}${v}`).join(" ") || "0";
const boosts = (b: any) => all(b).map((p: any) => `${p.name}[${stages(p)}]`).join(" ");
const items = (b: any) => all(b).map((p: any) => `${p.name}:${p.item || "-"}${p.lastItem ? `(last ${p.lastItem})` : ""}`).join(" ");
const vols = (b: any) => all(b).map((p: any) => `${p.name}{${Object.keys(p.volatiles).join(",")}}`).join(" ");
const sideText = (side: any) => Object.entries(side.sideConditions).map(([id, s]: [string, any]) => `${id}${s.layers ? `x${s.layers}` : ""}${s.duration ? `(${s.duration})` : ""}`).join(",") || "-";
const sides = (b: any) => `p1 ${sideText(b.p1)} | p2 ${sideText(b.p2)}`;
const field = (b: any) => `terrain ${b.field.terrain || "-"} pseudo ${Object.entries(b.field.pseudoWeather).map(([id, s]: [string, any]) => `${id}(${s.duration})`).join(",") || "-"}`;
const team = (b: any, side: "p1" | "p2") => b[side].pokemon.map((p: any) => `${p.name}:${p.status || "-"}`).join(" ");
const species = (b: any) => all(b).map((p: any) => `${p.name}=${p.species.name}`).join(" ");
const run = (id: string, title: string, probe: Partial<AProbe>) => { if (want(id)) report(`${id} ${probe.game ?? "sv"}: ${title}`, enumerate(base(probe))); };
/** A status on a Pokémon not in battle (setStatus refuses an inactive one: its runEvent needs isActive). */
const benchStatus = (b: any, side: "p1" | "p2", index: number, status: string, ability?: string) => {
  const p = b[side].pokemon[index];
  p.status = status;
  p.statusState = b.initEffectState({ id: status, target: p });
  if (ability) { p.baseAbility = ability; p.ability = ability; p.abilityState = b.initEffectState({ id: ability, target: p }); }
};

// ---- Reflection: Magic Coat ---------------------------------------------------------------------------------------------
// F01. A reflected spread status move is used again by the coat holder at its own targets (sim/battle-actions.ts useMove with
// {target: source}: getMoveTargets of the holder): Growl hits both foes; the holder's ally still takes the original Growl.
run("F01", "Jolteon Magic Coat; Snorlax Growl (allAdjacentFoes)", {
  game: "swsh", mons: [jolt(["Magic Coat"]), lapras(["Splash"]), lax(["Growl"]), slow],
  turns: [["move 1, move 1", "move 1, move 1"]], inspect: (b) => boosts(b),
});
// F02. Gen 7+: the reflection keeps the Magic Coat use's pranksterBoosted (data/moves.ts:10707-10709, 10718): a Prankster
// Sableye's reflected Thunder Wave fails on a Dark-type foe. Control: Chansey's Magic Coat.
for (const coat of ["Sableye", "Chansey"]) run("F02", `${coat} Magic Coat; Umbreon Thunder Wave into ${coat}`, {
  game: "usum", mons: [coat === "Sableye" ? { species: "Sableye", ability: "Prankster", moves: ["Magic Coat"] } : { ...still, moves: ["Magic Coat"] }, lapras(["Splash"]),
    { species: "Umbreon", ability: "Inner Focus", moves: ["Thunder Wave"] }, slow],
  turns: [["move 1, move 1", "move 1 1, move 1"]], inspect: (b) => hps(b),
});
// F03. Magic Coat is a volatile: Mold Breaker does not pass it (Haxorus's Thunder Wave comes back); Magic Bounce is breakable (control).
for (const holder of ["Magic Coat", "Magic Bounce"]) run("F03", `Mold Breaker Haxorus Thunder Wave into ${holder}`, {
  game: "swsh", mons: [holder === "Magic Coat" ? { ...still, moves: ["Magic Coat"] } : { species: "Espeon", ability: "Magic Bounce", moves: ["Splash"] }, lapras(["Splash"]),
    { species: "Haxorus", ability: "Mold Breaker", moves: ["Thunder Wave"] }, slow],
  turns: [["move 1, move 1", "move 1 1, move 1"]], inspect: (b) => hps(b),
});
// F04. onAllyTryHitSide (data/moves.ts:10722-10732): Stealth Rock into the holder's side lands on the user's side.
run("F04", "Jolteon Magic Coat; Snorlax Stealth Rock", {
  game: "swsh", mons: [jolt(["Magic Coat"]), lapras(["Splash"]), lax(["Stealth Rock"]), slow],
  turns: [["move 1, move 1", "move 1, move 1"]], inspect: (b) => sides(b),
});
// F05. An ally's reflectable move into the holder comes back too (onTryHit checks only target === source).
run("F05", "Chansey Magic Coat; its ally Lapras Thunder Wave into Chansey", {
  game: "swsh", mons: [{ ...still, moves: ["Magic Coat"] }, lapras(["Thunder Wave"]), lax(["Splash"]), slow],
  turns: [["move 1, move 1 -1", "move 1, move 1"]], inspect: (b) => hps(b),
});
// F06. A reflected Defog is the holder's at the original user: the user's side loses Reflect, the user's evasion falls, and the
// gen 8 terrain clear still happens.
run("F06", "Jolteon Magic Coat; Snorlax Defog into Jolteon (Reflect on Snorlax's side, Electric Terrain)", {
  game: "swsh", mons: [jolt(["Magic Coat"]), lapras(["Splash"]), lax(["Defog"]), slow],
  turns: [["move 1, move 1", "move 1 1, move 1"]], setup: (b) => { b.p2.addSideCondition("reflect", "debug"); b.field.setTerrain("electricterrain", "debug"); },
  inspect: (b) => `${field(b)} || ${sides(b)} || ${boosts(b)}`,
});
// F07. A reflected Purify cures the original user and heals the holder.
run("F07", "Jolteon (50 HP) Magic Coat; poisoned Snorlax Purify into Jolteon", {
  game: "swsh", mons: [jolt(["Magic Coat"]), lapras(["Splash"]), lax(["Purify"]), slow],
  turns: [["move 1, move 1", "move 1 1, move 1"]], setup: (b) => { b.p1.active[0].sethp(50); b.p2.active[0].setStatus("psn", null, null, true); }, inspect: (b) => hps(b),
});

// ---- Snatch (USUM) ---------------------------------------------------------------------------------------------------------
// F10. Snatch takes its own ally's snatchable move.
run("F10", "Jolteon Snatch; its ally Chansey Swords Dance", {
  game: "usum", mons: [jolt(["Snatch"]), { ...still, moves: ["Swords Dance"] }, lax(["Splash"]), slow],
  turns: [["move 1, move 1", "move 1, move 1"]], inspect: (b) => boosts(b),
});
// F11. Only the first snatchable move: Snorlax's Reflect goes up on Jolteon's side; Shuckle's later Swords Dance is its own.
run("F11", "Jolteon Snatch; Snorlax Reflect, then Shuckle Swords Dance", {
  game: "usum", mons: [jolt(["Snatch"]), lapras(["Splash"]), lax(["Reflect"]), { ...slow, moves: ["Swords Dance"] }],
  turns: [["move 1, move 1", "move 1, move 1"]], inspect: (b) => `${sides(b)} || ${boosts(b)}`,
});
// F12. The original user's PrepareHit runs before Snatch's onAnyPrepareHit (priority -1): does a Protean Greninja become Normal?
run("F12", "Jolteon Snatch; Protean Greninja Swords Dance", {
  game: "usum", mons: [jolt(["Snatch"]), lapras(["Splash"]), { species: "Greninja", ability: "Protean", moves: ["Swords Dance"] }, slow],
  turns: [["move 1, move 1", "move 1, move 1"]], inspect: (b) => `${types(b)} || ${boosts(b)}`,
});
// F13. A snatched Substitute is paid by the Snatch user; a snatched Recover heals it.
run("F13a", "Jolteon Snatch; Snorlax Substitute", {
  game: "usum", mons: [jolt(["Snatch"]), lapras(["Splash"]), lax(["Substitute"]), slow],
  turns: [["move 1, move 1", "move 1, move 1"]], inspect: (b) => `${hps(b)} || ${vols(b)}`,
});
run("F13b", "Jolteon (70 HP) Snatch; Snorlax (100 HP) Recover", {
  game: "usum", mons: [jolt(["Snatch"]), lapras(["Splash"]), lax(["Recover"]), slow],
  turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { b.p1.active[0].sethp(70); b.p2.active[0].sethp(100); }, inspect: (b) => hps(b),
});
// F14. A Snatch user knocked out before the snatchable move takes nothing.
run("F14", "Jolteon (1 HP) Snatch; Garchomp Dragon Claw into Jolteon; Snorlax Swords Dance", {
  game: "usum", mons: [jolt(["Snatch"]), lapras(["Splash"]), lax(["Swords Dance"]), chomp(["Dragon Claw"])],
  turns: [["move 1, move 1", "move 1, move 1 1"]], setup: (b) => b.p1.active[0].sethp(1), inspect: (b) => `${hps(b)} || ${boosts(b)}`,
});
// F15. The stolen move runs through useMove (no BeforeMove for the Snatch user): only Snatch's own full paralysis (1/4) matters.
run("F15", "Paralysed Jolteon Snatch; Snorlax Swords Dance", {
  game: "usum", mons: [jolt(["Snatch"]), lapras(["Splash"]), lax(["Swords Dance"]), slow],
  turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => b.p1.active[0].setStatus("par", null, null, true), inspect: (b) => boosts(b),
});
// F16. A snatched Tailwind goes up on the Snatch user's side.
run("F16", "Jolteon Snatch; Snorlax Tailwind", {
  game: "usum", mons: [jolt(["Snatch"]), lapras(["Splash"]), lax(["Tailwind"]), slow],
  turns: [["move 1, move 1", "move 1, move 1"]], inspect: (b) => sides(b),
});
// F17. Swallow snatched (data/moves.ts:18584: onTry passes a snatched use): the Snatch user heals a quarter; Snorlax keeps its Stockpile.
run("F17", "Jolteon (70 HP) Snatch; Snorlax (Stockpile 1) Swallow", {
  game: "usum", mons: [jolt(["Snatch"]), lapras(["Splash"]), lax(["Swallow"]), slow],
  turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { b.p1.active[0].sethp(70); b.p2.active[0].sethp(100); b.p2.active[0].addVolatile("stockpile"); },
  inspect: (b) => `${hps(b)} || ${boosts(b)} || ${vols(b)}`,
});

// ---- Crafty Shield (SwSh) ---------------------------------------------------------------------------------------------------
// F20. onTry: !!queue.willAct() (data/moves.ts:3154-3156): after three +4 Protects nothing is left to act; it fails.
run("F20", "Jolteon Crafty Shield after three Protects", {
  game: "swsh", mons: [jolt(["Crafty Shield"]), lapras(["Protect"]), lax(["Protect"]), { ...slow, moves: ["Protect"] }],
  turns: [["move 1, move 1", "move 1, move 1"]], inspect: (b) => sides(b),
});
// F21. Crafty Shield blocks a spread status move on both, not a side move (Stealth Rock: TryHitSide, no onTryHit).
run("F21", "Jolteon Crafty Shield; Snorlax Growl; Shuckle Stealth Rock", {
  game: "swsh", mons: [jolt(["Crafty Shield"]), lapras(["Splash"]), lax(["Growl"]), { ...slow, moves: ["Stealth Rock"] }],
  turns: [["move 1, move 1", "move 1, move 1"]], inspect: (b) => `${boosts(b)} || ${sides(b)}`,
});
// F22. A target "all" move (Haze) is not blocked.
run("F22", "Jolteon Crafty Shield; Lapras (+2 Atk); Snorlax Haze", {
  game: "swsh", mons: [jolt(["Crafty Shield"]), lapras(["Splash"]), lax(["Haze"]), slow],
  turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => b.boost({ atk: 2 }, b.p1.active[1]), inspect: (b) => boosts(b),
});
// F23. A damaging move is not blocked.
run("F23", "Jolteon Crafty Shield; Snorlax Body Slam into Lapras", {
  game: "swsh", mons: [jolt(["Crafty Shield"]), lapras(["Splash"]), lax(["Body Slam"]), slow],
  turns: [["move 1, move 1", "move 1 2, move 1"]], inspect: (b) => hps(b),
});
// F24. Acupressure aimed at its user (target adjacentAllyOrSelf, not "self") is blocked by its own side's Crafty Shield.
run("F24", "Jolteon Crafty Shield; Lapras Acupressure on itself", {
  game: "swsh", mons: [jolt(["Crafty Shield"]), lapras(["Acupressure"]), lax(["Splash"]), slow],
  turns: [["move 1, move 1 -2", "move 1, move 1"]], inspect: (b) => boosts(b),
});
// F25. Crafty Shield (TryHit 3) comes before Magic Coat (2): a blocked Thunder Wave is not reflected.
run("F25", "Lapras Magic Coat; Jolteon Crafty Shield; Snorlax Thunder Wave into Lapras", {
  game: "swsh", mons: [jolt(["Crafty Shield"]), lapras(["Magic Coat"]), lax(["Thunder Wave"]), slow],
  turns: [["move 1, move 1", "move 1 2, move 1"]], inspect: (b) => hps(b),
});
// F26. Feint (breaksProtect: sim/battle-actions.ts hitStepBreakProtect) removes Crafty Shield; a later Thunder Wave lands.
run("F26", "Jolteon Crafty Shield; Garchomp Feint into Lapras; Snorlax Thunder Wave into Lapras", {
  game: "swsh", mons: [jolt(["Crafty Shield"]), lapras(["Splash"]), chomp(["Feint"]), lax(["Thunder Wave"])],
  turns: [["move 1, move 1", "move 1 2, move 1 2"]], inspect: (b) => `${hps(b)} || ${sides(b)}`,
});

// ---- Mat Block (SwSh) -------------------------------------------------------------------------------------------------------
// F30. A Max Move breaks through Mat Block at a quarter (checkMoveBypassesProtect: bypassProtect; sim/battle-actions.ts:1828-1834). Control: Splash.
for (const mat of [true, false]) run("F30", `Jolteon ${mat ? "Mat Block" : "Splash"}; Dynamaxed Garchomp Dragon Claw into Lapras`, {
  game: "swsh", mons: [jolt([mat ? "Mat Block" : "Splash"]), lapras(["Splash"]), chomp(["Dragon Claw"]), slow],
  turns: [["move 1, move 1", "move 1 2 dynamax, move 1"]], inspect: (b) => hps(b),
});
// F31. Mat Block's onTryHit is its side's: the user's own ally's Earthquake does not hit the Mat Block user.
run("F31", "Jolteon Mat Block; its ally Lapras Earthquake", {
  game: "swsh", mons: [jolt(["Mat Block"]), lapras(["Earthquake"]), lax(["Splash"]), slow],
  turns: [["move 1, move 1", "move 1, move 1"]], inspect: (b) => hps(b),
});
// F32. Not the user's first turn out (activeMoveActions > 1): Mat Block fails and Body Slam lands.
run("F32", "Turn 1 Splash; turn 2 Jolteon Mat Block; Snorlax Body Slam into Lapras", {
  game: "swsh", mons: [jolt(["Splash", "Mat Block"]), lapras(["Splash"]), lax(["Splash", "Body Slam"]), slow],
  turns: [["move 1, move 1", "move 1, move 1"], ["move 2, move 1", "move 2 2, move 1"]], inspect: (b) => hps(b),
});

// ---- Lucky Chant (USUM) -----------------------------------------------------------------------------------------------------
// F35. Lucky Chant's onCriticalHit false stops Merciless's certain crit into a poisoned target. Control: Splash.
for (const chant of [true, false]) run("F35", `Jolteon ${chant ? "Lucky Chant" : "Splash"}; Merciless Toxapex Liquidation into a poisoned Garchomp`, {
  game: "usum", mons: [jolt([chant ? "Lucky Chant" : "Splash"]), chomp(["Splash"]), { species: "Toxapex", ability: "Merciless", moves: ["Liquidation"] }, slow],
  turns: [["move 1, move 1", "move 1 2, move 1"]], setup: (b) => b.p1.active[1].setStatus("psn", null, null, true), inspect: (b) => hps(b),
});
// F36. And a certain crit from stages (Focus Energy +2, Scope Lens +1, Slash +1: gen 7 stage 3+ always crits). Control: Splash.
for (const chant of [true, false]) run("F36", `Jolteon ${chant ? "Lucky Chant" : "Splash"}; Snorlax (Focus Energy, Scope Lens) Slash into Garchomp`, {
  game: "usum", mons: [jolt([chant ? "Lucky Chant" : "Splash"]), chomp(["Splash"]), lax(["Slash"], { item: "Scope Lens" }), slow],
  turns: [["move 1, move 1", "move 1 2, move 1"]], setup: (b) => b.p2.active[0].addVolatile("focusenergy"), inspect: (b) => hps(b),
});

// ---- Mist (SV) -----------------------------------------------------------------------------------------------------------------
// F40. Mist (side condition, subOrder 4) runs before Mirror Armor (ability, 7) in TryBoost: no drop, nothing reflected. Control: Splash.
for (const mist of [true, false]) run("F40", `Jolteon ${mist ? "Mist" : "Splash"}; Corviknight (Mirror Armor) beside it; Snorlax Growl`, {
  mons: [jolt([mist ? "Mist" : "Splash"]), { species: "Corviknight", ability: "Mirror Armor", moves: ["Splash"] }, lax(["Growl"]), slow],
  turns: [["move 1, move 1", "move 1, move 1"]], inspect: (b) => boosts(b),
});
// F41. Mist stops an ally's drop (source !== target): Spicy Extract's Defense −2 on Jolteon, not its Attack +2.
run("F41", "Jolteon Mist; its ally Lapras Spicy Extract into Jolteon", {
  mons: [jolt(["Mist"]), lapras(["Spicy Extract"]), lax(["Splash"]), slow],
  turns: [["move 1, move 1 -1", "move 1, move 1"]], inspect: (b) => boosts(b),
});
// F42. An Infiltrator foe's move passes Mist (gen 6+: data/moves.ts:12085).
run("F42", "Jolteon Mist; Infiltrator Chandelure Growl", {
  mons: [jolt(["Mist"]), lapras(["Splash"]), { species: "Chandelure", ability: "Infiltrator", moves: ["Growl"] }, slow],
  turns: [["move 1, move 1", "move 1, move 1"]], inspect: (b) => boosts(b),
});
// F43. Parting Shot into Mist: no drop, so no switch (data/moves.ts partingshot onHit deletes selfSwitch).
run("F43", "Jolteon Mist; Snorlax Parting Shot into Jolteon", {
  mons: [jolt(["Mist"]), lapras(["Splash"]), lax(["Parting Shot"]), slow],
  turns: [["move 1, move 1", "move 1 1, move 1"]], inspect: (b) => `${boosts(b)} || ${all(b).map((p: any) => p.name).join(",")}`,
});
// F44. Mist on the attacker's side stops King's Shield's contact drop (a move effect from another Pokémon). Control: Splash.
for (const mist of [true, false]) run("F44", `Lapras ${mist ? "Mist" : "Splash"}; Snorlax Body Slam into King's Shield Aegislash`, {
  mons: [lapras([mist ? "Mist" : "Splash"]), lax(["Body Slam"]), { species: "Aegislash", ability: "Stance Change", moves: ["King's Shield"] }, slow],
  turns: [["move 1, move 1 1", "move 1, move 1"]], inspect: (b) => boosts(b),
});
// F45. And Gooey's Speed drop on contact (an ability effect from another Pokémon). Control: Splash.
for (const mist of [true, false]) run("F45", `Lapras ${mist ? "Mist" : "Splash"}; Snorlax Body Slam into Gooey Goodra`, {
  mons: [lapras([mist ? "Mist" : "Splash"]), lax(["Body Slam"]), { species: "Goodra", ability: "Gooey", moves: ["Splash"] }, slow],
  turns: [["move 1, move 1 1", "move 1, move 1"]], inspect: (b) => boosts(b),
});

// ---- Court Change ---------------------------------------------------------------------------------------------------------------
// F50. Court Change moves every listed condition with its state (layers, duration).
run("F50", "Jolteon Court Change; own side Spikes x2 and Reflect, opponent's Tailwind and Stealth Rock", {
  mons: [jolt(["Court Change"]), lapras(["Splash"]), lax(["Splash"]), slow],
  setup: (b) => { b.p1.addSideCondition("spikes", "debug"); b.p1.addSideCondition("spikes", "debug"); b.p1.addSideCondition("reflect", "debug"); b.p2.addSideCondition("tailwind", "debug"); b.p2.addSideCondition("stealthrock", "debug"); },
  inspect: (b) => sides(b),
});
// F51. The moved Tailwind keeps its turns: set by the opponent on turn 1, Court Change on turn 2, it ends on Jolteon's side after turn 4.
run("F51", "Turn 1 Snorlax Tailwind; turn 2 Jolteon Court Change; turns 3-4 nothing", {
  game: "champions", mons: [jolt(["Splash", "Court Change"]), lapras(["Splash"]), lax(["Tailwind", "Splash"]), slow],
  turns: [["move 1, move 1", "move 1, move 1"], ["move 2, move 1", "move 2, move 1"], ["move 1, move 1", "move 2, move 1"], ["move 1, move 1", "move 2, move 1"]],
  inspect: (b) => sides(b),
});
// F52. With no listed condition up, Court Change fails.
run("F52", "Jolteon Court Change with nothing up", {
  game: "swsh", mons: [jolt(["Court Change"]), lapras(["Splash"]), lax(["Splash"]), slow],
});
// F53. Wide Guard (not on the list) stays on its side through Court Change: Snorlax's later Earthquake is blocked there.
run("F53", "Lapras Wide Guard; Jolteon Court Change; Snorlax Earthquake", {
  mons: [jolt(["Court Change"]), lapras(["Wide Guard"]), lax(["Earthquake"]), slow],
  turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => b.p1.addSideCondition("reflect", "debug"), inspect: (b) => `${hps(b)} || ${sides(b)}`,
});

// ---- Defog -------------------------------------------------------------------------------------------------------------------------
// F55. The evasion drop comes first and Mist on the target's side stops it; then Mist is removed, so Lapras's later Snarl lowers.
run("F55", "Jolteon Defog into Snorlax (Mist on its side); Lapras Snarl", {
  mons: [jolt(["Defog"]), lapras(["Snarl"]), lax(["Splash"]), slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => b.p2.addSideCondition("mist", "debug"), inspect: (b) => `${sides(b)} || ${boosts(b)}`,
});
// F56. Into a Substitute (bypasssub): no evasion drop, Reflect still removed.
run("F56", "Jolteon Defog into Snorlax behind a Substitute (Reflect on its side)", {
  mons: [jolt(["Defog"]), lapras(["Splash"]), lax(["Splash"]), slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { b.p2.active[0].addVolatile("substitute"); b.p2.addSideCondition("reflect", "debug"); }, inspect: (b) => `${sides(b)} || ${boosts(b)}`,
});
// F57. Into its own ally: its own side's Reflect goes, and the terrain.
run("F57", "Jolteon Defog into its ally Lapras (Reflect on its own side, Electric Terrain)", {
  mons: [jolt(["Defog"]), lapras(["Splash"]), lax(["Splash"]), slow],
  turns: [["move 1 -2, move 1", "move 1, move 1"]], setup: (b) => { b.p1.addSideCondition("reflect", "debug"); b.field.setTerrain("electricterrain", "debug"); },
  inspect: (b) => `${field(b)} || ${sides(b)} || ${boosts(b)}`,
});
// F58. Nothing to remove and the target at −6 evasion: Defog fails, and the terrain is still cleared (clearTerrain before return).
run("F58", "Jolteon Defog into Snorlax at −6 evasion, nothing up, Psychic Terrain", {
  mons: [jolt(["Defog"]), lapras(["Splash"]), lax(["Splash"]), slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { b.p2.active[0].boosts.evasion = -6; b.field.setTerrain("psychicterrain", "debug"); }, inspect: (b) => `${field(b)} || ${boosts(b)}`,
});
// F59. The evasion drop is a foe's drop: Defiant +2 Attack.
run("F59", "Jolteon Defog into Defiant Kingambit", {
  mons: [jolt(["Defog"]), lapras(["Splash"]), { species: "Kingambit", ability: "Defiant", moves: ["Splash"] }, slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], inspect: (b) => boosts(b),
});
// F60. Defog ends Electric Terrain: Quark Drive (from the terrain, no Booster Energy) ends before Iron Hands's later Drain Punch. Control: Splash.
for (const defog of [true, false]) run("F60", `Jolteon ${defog ? "Defog" : "Splash"} into Snorlax (Electric Terrain); Iron Hands (Quark Drive) Drain Punch into Lapras`, {
  mons: [jolt([defog ? "Defog" : "Splash"]), lapras(["Splash"]), lax(["Splash"]), { species: "Iron Hands", ability: "Quark Drive", moves: ["Drain Punch"] }],
  turns: [[defog ? "move 1 1, move 1" : "move 1, move 1", "move 1, move 1 2"]], setup: (b) => b.field.setTerrain("electricterrain", "debug"),
  inspect: (b) => `${field(b)} || ${vols(b)} || ${hps(b)}`,
});
// F61. Champions: Defog clears the hazards on both sides, and the target side's screens and Safeguard.
run("F61", "Jolteon Defog into Snorlax; hazards on both sides, Reflect and Safeguard on Snorlax's", {
  game: "champions", mons: [jolt(["Defog"]), lapras(["Splash"]), lax(["Splash"]), slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]],
  setup: (b) => { b.p1.addSideCondition("spikes", "debug"); b.p2.addSideCondition("stealthrock", "debug"); b.p2.addSideCondition("reflect", "debug"); b.p2.addSideCondition("safeguard", "debug"); b.p1.addSideCondition("reflect", "debug"); },
  inspect: (b) => sides(b),
});

// ---- Magic Room ----------------------------------------------------------------------------------------------------------------------
// F65. Magic Room ended mid-turn (its onFieldRestart): at the action's AfterMove White Herb restores Shuckle's −1, and at its Update Snorlax eats
// its Sitrus (100/235) and Lapras's Mental Herb ends its Taunt.
run("F65", "Magic Room up; Jolteon Magic Room (ends it); Snorlax (Sitrus, 100), Shuckle (White Herb, −1 Atk), Lapras (Mental Herb, Taunted)", {
  mons: [jolt(["Magic Room"]), lapras(["Splash"], { item: "Mental Herb" }), lax(["Splash"], { item: "Sitrus Berry" }), { ...slow, item: "White Herb" }],
  turns: [["move 1, move 1", "move 1, move 1"]],
  setup: (b) => { b.field.addPseudoWeather("magicroom", b.p2.active[1]); b.p2.active[0].sethp(100); b.boost({ atk: -1 }, b.p2.active[1]); b.p1.active[1].addVolatile("taunt"); },
  inspect: (b) => `${field(b)} || ${items(b)} || ${boosts(b)} || ${vols(b)} || ${hps(b)}`,
});
// F66. Magic Room started mid-turn: Heatran's Air Balloon stops working, Garchomp's Earthquake hits it. Control: Splash.
for (const room of [true, false]) run("F66", `Jolteon ${room ? "Magic Room" : "Splash"}; Garchomp Earthquake; Heatran (Air Balloon)`, {
  mons: [jolt([room ? "Magic Room" : "Splash"]), chomp(["Earthquake"]), { species: "Heatran", ability: "Flash Fire", item: "Air Balloon", moves: ["Splash"] }, slow],
  turns: [["move 1, move 1", "move 1, move 1"]], inspect: (b) => `${items(b)} || ${hps(b)}`,
});
// F67. Magic Room starting runs each item's End: Utility Umbrella's re-runs WeatherChange (data/items.ts:7456-7461): Cherrim in sun changes form.
run("F67", "Sun; Cherrim (Flower Gift, Utility Umbrella); Jolteon Magic Room", {
  game: "swsh", mons: [jolt(["Magic Room"]), lapras(["Splash"]), { species: "Cherrim", ability: "Flower Gift", item: "Utility Umbrella", moves: ["Splash"] }, slow],
  turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => b.field.setWeather("sunnyday", "debug"), inspect: (b) => species(b),
});
// F68. Magic Room re-sorts from gen 8: Chansey's Choice Scarf (70 → 105) stops working, Lapras (80) moves before it.
for (const room of [true, false]) run("F68", `Jolteon ${room ? "Magic Room" : "Splash"}; Chansey (Choice Scarf) and Lapras`, {
  mons: [jolt([room ? "Magic Room" : "Splash"]), lapras(["Splash"]), { ...still, item: "Choice Scarf" }, slow],
  turns: [["move 1, move 1", "move 1, move 1"]], inspect: (b) => order(b),
});
// F69. Magic Room up, ended by Jolteon's and started again by Lapras's: set this turn, 5 turns (4 after the countdown); Chansey's Leftovers off.
run("F69", "Magic Room up; Jolteon Magic Room, then Lapras Magic Room; Chansey (Leftovers, 200)", {
  mons: [jolt(["Magic Room"]), lapras(["Magic Room"]), { ...still, item: "Leftovers" }, slow],
  turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { b.field.addPseudoWeather("magicroom", b.p2.active[1]); b.p2.active[0].sethp(200); },
  inspect: (b) => `${field(b)} || ${hps(b)}`,
});

// ---- Wonder Room ----------------------------------------------------------------------------------------------------------------------
// F72. Wonder Room ended mid-turn: Lapras's later Body Slam into Chansey reads its Defense again (K53: 135 with no room, 28 under it).
run("F72", "Wonder Room up; Jolteon Wonder Room (ends it); Lapras Body Slam into Chansey", {
  mons: [jolt(["Wonder Room"]), lapras(["Body Slam"]), still, slow],
  turns: [["move 1, move 1 1", "move 1, move 1"]], setup: (b) => b.field.addPseudoWeather("wonderroom", b.p2.active[1]), inspect: (b) => `${field(b)} || ${hps(b)}`,
});

// ---- Mud Sport, Water Sport (USUM) ----------------------------------------------------------------------------------------------------
// F75. Mud Sport reads the type after ModifyType: Galvanize Golem's Body Slam is Electric and weakened. Control: Splash.
for (const sport of [true, false]) run("F75", `Jolteon ${sport ? "Mud Sport" : "Splash"}; Galvanize Golem Body Slam into Lapras`, {
  game: "usum", mons: [jolt([sport ? "Mud Sport" : "Splash"]), lapras(["Splash"]), { species: "Golem-Alola", ability: "Galvanize", moves: ["Body Slam"] }, slow],
  turns: [["move 1, move 1", "move 1 2, move 1"]], inspect: (b) => hps(b),
});
// F76. Water Sport with three other base-power modifiers (Technician, Charcoal, Helping Hand): Showdown's chain order (priority 30, 15, 10, 1). Control: Splash.
for (const sport of [true, false]) run("F76", `Garchomp ${sport ? "Water Sport" : "Splash"}; Jolteon Helping Hand; Technician Breloom (Charcoal) Ember into Snorlax`, {
  game: "usum", mons: [jolt(["Helping Hand"]), { species: "Breloom", ability: "Technician", item: "Charcoal", moves: ["Ember"] }, lax(["Splash"]), chomp([sport ? "Water Sport" : "Splash"])],
  turns: [["move 1 -2, move 1 1", "move 1, move 1"]], inspect: (b) => hps(b),
});

// ---- Corrosive Gas (SwSh, Champions) -----------------------------------------------------------------------------------------------
// F80. Sticky Hold keeps its item (takeItem runEvent: source !== holder); every other adjacent Pokémon loses one, the ally included.
run("F80a", "Jolteon Corrosive Gas; Muk (Sticky Hold, Black Sludge), Shuckle (Sitrus), Lapras (Life Orb)", {
  game: "swsh", mons: [jolt(["Corrosive Gas"]), lapras(["Splash"], { item: "Life Orb" }), { species: "Muk", ability: "Sticky Hold", item: "Black Sludge", moves: ["Splash"] }, { ...slow, item: "Sitrus Berry" }],
  turns: [["move 1, move 1", "move 1, move 1"]], inspect: (b) => items(b),
});
// F80b. Sticky Hold is breakable: a Mold Breaker user's Corrosive Gas takes Muk's Black Sludge.
run("F80b", "Mold Breaker Haxorus Corrosive Gas; Muk (Sticky Hold, Black Sludge)", {
  game: "swsh", mons: [{ species: "Haxorus", ability: "Mold Breaker", moves: ["Corrosive Gas"] }, lapras(["Splash"]), { species: "Muk", ability: "Sticky Hold", item: "Black Sludge", moves: ["Splash"] }, slow],
  turns: [["move 1, move 1", "move 1, move 1"]], inspect: (b) => items(b),
});
// F81. Champions: a held Mega Stone stays; a Substitute stops it; the ally's Leftovers goes.
run("F81", "Champions Jolteon Corrosive Gas; Venusaur (Venusaurite), Snorlax (Leftovers, Substitute), Lapras (Leftovers)", {
  game: "champions", mons: [jolt(["Corrosive Gas"]), lapras(["Splash"], { item: "Leftovers" }), { species: "Venusaur", ability: "Chlorophyll", item: "Venusaurite", moves: ["Splash"] }, lax(["Splash"], { item: "Leftovers" })],
  turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => b.p2.active[1].addVolatile("substitute"), inspect: (b) => items(b),
});
// F82. Unburden (onTakeItem) after Corrosive Gas: Drifblim (100 → 200) moves before Garchomp (122) in gen 8's re-sort.
for (const gas of [true, false]) run("F82", `Jolteon ${gas ? "Corrosive Gas" : "Splash"}; Drifblim (Unburden, Sitrus) and Garchomp`, {
  game: "swsh", mons: [jolt([gas ? "Corrosive Gas" : "Splash"]), lapras(["Splash"]), { species: "Drifblim", ability: "Unburden", item: "Sitrus Berry", moves: ["Splash"] }, chomp(["Splash"])],
  turns: [["move 1, move 1", "move 1, move 1"]], inspect: (b) => order(b),
});
// F83. Corrosive Gas removes Heatran's Air Balloon: Garchomp's later Earthquake hits it.
run("F83", "Jolteon Corrosive Gas; Garchomp Earthquake; Heatran (Air Balloon)", {
  game: "swsh", mons: [jolt(["Corrosive Gas"]), chomp(["Earthquake"]), { species: "Heatran", ability: "Flash Fire", item: "Air Balloon", moves: ["Splash"] }, slow],
  turns: [["move 1, move 1", "move 1, move 1"]], inspect: (b) => `${items(b)} || ${hps(b)}`,
});
// F84. takeItem runs no AfterUseItem: a Symbiosis partner passes nothing (data/abilities.ts:4837-4851 onAllyAfterUseItem).
run("F84", "Jolteon Corrosive Gas; Snorlax (Leftovers) beside Florges (Symbiosis, Sitrus)", {
  game: "swsh", mons: [jolt(["Corrosive Gas"]), lapras(["Splash"]), lax(["Splash"], { item: "Leftovers" }), { species: "Florges", ability: "Symbiosis", item: "Sitrus Berry", moves: ["Splash"] }],
  turns: [["move 1, move 1", "move 1, move 1"]], inspect: (b) => items(b),
});
// F85. Magic Bounce reflects it during the original's TryHit: the holder's use reaches its own ally and both foes first.
run("F85", "Jolteon (Leftovers) Corrosive Gas; Hatterene (Magic Bounce, Life Orb), Shuckle (Sitrus), Lapras (Life Orb)", {
  game: "swsh", mons: [jolt(["Corrosive Gas"], { item: "Leftovers" }), lapras(["Splash"], { item: "Life Orb" }), { species: "Hatterene", ability: "Magic Bounce", item: "Life Orb", moves: ["Splash"] }, { ...slow, item: "Sitrus Berry" }],
  turns: [["move 1, move 1", "move 1, move 1"]], inspect: (b) => items(b),
});

// ---- Bestow (USUM) -------------------------------------------------------------------------------------------------------------------
// F88. Bestow gives its Sitrus to an ally at 80/205: eaten at the action's Update; Bestow passes Protect (no protect flag).
run("F88a", "Jolteon (Sitrus) Bestow to its ally Lapras (80 HP)", {
  game: "usum", mons: [jolt(["Bestow"], { item: "Sitrus Berry" }), lapras(["Splash"]), lax(["Splash"]), slow],
  turns: [["move 1 -2, move 1", "move 1, move 1"]], setup: (b) => b.p1.active[1].sethp(80), inspect: (b) => `${items(b)} || ${hps(b)}`,
});
run("F88b", "Snorlax Protect; Jolteon (Leftovers) Bestow into Snorlax", {
  game: "usum", mons: [jolt(["Bestow"], { item: "Leftovers" }), lapras(["Splash"]), lax(["Protect"]), slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], inspect: (b) => items(b),
});

// ---- Recycle --------------------------------------------------------------------------------------------------------------------------
// F90. Knock Off takes the item (takeItem): no lastItem, Recycle fails.
run("F90", "Jolteon Knock Off into Snorlax (Sitrus); Snorlax Recycle", {
  mons: [jolt(["Knock Off"]), lapras(["Splash"]), lax(["Recycle"], { item: "Sitrus Berry" }), slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], inspect: (b) => items(b),
});
// F91. A popped Air Balloon sets no lastItem (data/items.ts:198-199): Recycle fails.
run("F91", "Lapras Ice Beam into a slower Heatran (Air Balloon); Heatran Recycle", {
  mons: [jolt(["Splash"]), lapras(["Ice Beam"]), { species: "Heatran", ability: "Flash Fire", item: "Air Balloon", moves: ["Recycle"], nature: "Brave", ivs: { spe: 0 } }, slow],
  turns: [["move 1, move 1 1", "move 1, move 1"]], inspect: (b) => items(b),
});
// F92. A Sitrus eaten mid-turn is lastItem: Recycle brings it back (held above half, so not eaten again).
run("F92", "Jolteon Thunderbolt into Snorlax (Sitrus, 150); Snorlax Recycle", {
  mons: [jolt(["Thunderbolt"]), lapras(["Splash"]), lax(["Recycle"], { item: "Sitrus Berry" }), slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => b.p2.active[0].sethp(150), inspect: (b) => `${items(b)} || ${hps(b)}`,
});
// F93. lastItem from an earlier turn: Sitrus eaten on turn 1, Recycle on turn 2.
run("F93", "Turn 1 Jolteon Thunderbolt into Snorlax (Sitrus, 150); turn 2 Snorlax Recycle", {
  mons: [jolt(["Thunderbolt", "Splash"]), lapras(["Splash"]), lax(["Splash", "Recycle"], { item: "Sitrus Berry" }), slow],
  turns: [["move 1 1, move 1", "move 1, move 1"], ["move 2, move 1", "move 2, move 1"]], setup: (b) => b.p2.active[0].sethp(150), inspect: (b) => `${items(b)} || ${hps(b)}`,
});
// F94. A Focus Sash used this turn (useItem) comes back.
run("F94", "Jolteon Fire Blast into Ferrothorn (Focus Sash, full HP); Ferrothorn Recycle", {
  mons: [jolt(["Fire Blast"]), lapras(["Splash"]), lax(["Splash"]), { species: "Ferrothorn", ability: "Iron Barbs", item: "Focus Sash", moves: ["Recycle"] }],
  turns: [["move 1 2, move 1", "move 1, move 1"]], inspect: (b) => `${items(b)} || ${hps(b)}`,
});
// F96. Champions: Bug Bite takes the Berry (takeItem, [from] stealeat): no lastItem for its holder.
run("F96", "Champions Jolteon Bug Bite into Snorlax (Sitrus); Snorlax Recycle", {
  game: "champions", mons: [jolt(["Bug Bite"]), lapras(["Splash"]), lax(["Recycle"], { item: "Sitrus Berry" }), slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], inspect: (b) => items(b),
});

// ---- Teatime ----------------------------------------------------------------------------------------------------------------------------
// F100. Under Magic Room the Berries are eaten with no effect (singleEvent Eat skipped), but Cheek Pouch heals (EatItem).
run("F100", "Magic Room; Jolteon Teatime; Snorlax (Sitrus, 150), Dedenne (Cheek Pouch, Sitrus, 50), Lapras (Lum, paralysed)", {
  mons: [jolt(["Teatime"]), lapras(["Splash"], { item: "Lum Berry" }), lax(["Splash"], { item: "Sitrus Berry" }), { species: "Dedenne", ability: "Cheek Pouch", item: "Sitrus Berry", moves: ["Splash"] }],
  turns: [["move 1, move 1", "move 1, move 1"]],
  setup: (b) => { b.field.addPseudoWeather("magicroom", b.p2.active[1]); b.p2.active[0].sethp(150); b.p2.active[1].sethp(50); b.p1.active[1].setStatus("par", null, null, true); },
  inspect: (b) => `${items(b)} || ${hps(b)}`,
});
// F101. No protect flag: Teatime reaches a Protecting Pokémon; a semi-invulnerable one (Dig) is missed.
run("F101", "Garchomp Dig (charging), Snorlax Protect; Shuckle Teatime last; all hold Sitrus", {
  mons: [{ ...slow, moves: ["Teatime"], item: "Sitrus Berry" }, lapras(["Splash"], { item: "Sitrus Berry" }), lax(["Protect"], { item: "Sitrus Berry" }), chomp(["Dig"], { item: "Sitrus Berry" })],
  turns: [["move 1, move 1", "move 1, move 1 1"]], setup: (b) => { for (const p of all(b)) p.sethp(Math.floor(p.maxhp * 0.6)); },
  inspect: (b) => `${items(b)} || ${hps(b)}`,
});
// F102. Champions: forced eating: a foe's Unnerve does not stop it; a Figy Berry confuses a Modest eater; Heal Block stops a Sitrus's heal.
run("F102", "Champions Jolteon Teatime; Tyranitar (Unnerve); Snorlax (Sitrus, Heal Block); Lapras (Figy, Modest)", {
  game: "champions", mons: [jolt(["Teatime"]), lapras(["Splash"], { item: "Figy Berry", nature: "Modest" }), lax(["Splash"], { item: "Sitrus Berry" }), { species: "Tyranitar", ability: "Unnerve", moves: ["Splash"] }],
  turns: [["move 1, move 1", "move 1, move 1"]],
  setup: (b) => { b.p2.active[0].sethp(150); b.p1.active[1].sethp(100); b.p2.active[0].addVolatile("healblock"); },
  inspect: (b) => `${items(b)} || ${hps(b)} || ${vols(b)}`,
});
// F103. Ripen doubles the forced Sitrus.
run("F103", "Jolteon Teatime; Appletun (Ripen, Sitrus, 100)", {
  mons: [jolt(["Teatime"]), lapras(["Splash"]), { species: "Appletun", ability: "Ripen", item: "Sitrus Berry", moves: ["Splash"] }, slow],
  turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => b.p2.active[0].sethp(100), inspect: (b) => `${items(b)} || ${hps(b)}`,
});

// ---- Stuff Cheeks ---------------------------------------------------------------------------------------------------------------------
// F105. At +6 Defense boost() changes nothing and returns null: no Berry is eaten.
run("F105", "Snorlax (Sitrus, 150, +6 Def) Stuff Cheeks", {
  mons: [jolt(["Splash"]), lapras(["Splash"]), lax(["Stuff Cheeks"], { item: "Sitrus Berry" }), slow],
  turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { b.p2.active[0].sethp(150); b.p2.active[0].boosts.def = 6; }, inspect: (b) => `${items(b)} || ${boosts(b)} || ${hps(b)}`,
});
// F106. Contrary turns it into −2 Defense, which is a change: the Berry is eaten.
run("F106", "Contrary Snorlax (Sitrus, 150) Stuff Cheeks", {
  mons: [jolt(["Splash"]), lapras(["Splash"]), lax(["Stuff Cheeks"], { item: "Sitrus Berry", ability: "Contrary" }), slow],
  turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => b.p2.active[0].sethp(150), inspect: (b) => `${items(b)} || ${boosts(b)} || ${hps(b)}`,
});
// F107. Champions under Magic Room: onTry still sees a Berry (getItem), Defense +2, the Sitrus eaten with no heal.
run("F107", "Champions Magic Room; Snorlax (Sitrus, 100) Stuff Cheeks", {
  game: "champions", mons: [jolt(["Splash"]), lapras(["Splash"]), lax(["Stuff Cheeks"], { item: "Sitrus Berry" }), slow],
  turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { b.field.addPseudoWeather("magicroom", b.p2.active[1]); b.p2.active[0].sethp(100); }, inspect: (b) => `${items(b)} || ${boosts(b)} || ${hps(b)}`,
});
// F108. A foe's Unnerve does not stop it (eatItem(true): no TryEatItem).
run("F108", "Tyranitar (Unnerve); Snorlax (Sitrus, 200) Stuff Cheeks", {
  mons: [{ species: "Tyranitar", ability: "Unnerve", moves: ["Splash"] }, lapras(["Splash"]), lax(["Stuff Cheeks"], { item: "Sitrus Berry" }), slow],
  turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => b.p2.active[0].sethp(200), inspect: (b) => `${items(b)} || ${hps(b)}`,
});

// ---- Psycho Shift (SwSh, USUM) -------------------------------------------------------------------------------------------------------
// F110. Bad poison moves with a fresh stage (1/16 at the end of turn); Synchronize passes nothing back (its user still has the status).
run("F110", "Badly poisoned Jolteon Psycho Shift into Synchronize Espeon", {
  game: "swsh", mons: [jolt(["Psycho Shift"]), lapras(["Splash"]), { species: "Espeon", ability: "Synchronize", moves: ["Splash"] }, slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { const p = b.p1.active[0]; p.setStatus("tox", null, null, true); p.statusState.stage = 3; }, inspect: (b) => hps(b),
});
// F111. Safeguard on the target's side stops the status: the user stays burned.
run("F111", "Burned Jolteon Psycho Shift into Snorlax under Safeguard", {
  game: "usum", mons: [jolt(["Psycho Shift"]), lapras(["Splash"]), lax(["Splash"]), slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { b.p1.active[0].setStatus("brn", null, null, true); b.p2.addSideCondition("safeguard", "debug"); }, inspect: (b) => hps(b),
});
// F113. The target's Lum Berry cures the moved paralysis at the Update; the user is cured.
run("F113", "Paralysed Jolteon Psycho Shift into Snorlax (Lum)", {
  game: "swsh", mons: [jolt(["Psycho Shift"]), lapras(["Splash"]), lax(["Splash"], { item: "Lum Berry" }), slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => b.p1.active[0].setStatus("par", null, null, true), inspect: (b) => `${items(b)} || ${hps(b)}`,
});

// ---- Purify ----------------------------------------------------------------------------------------------------------------------------
// F115. At full HP: the target cured, no heal.
run("F115", "Jolteon (full HP) Purify into a poisoned Snorlax", {
  game: "usum", mons: [jolt(["Purify"]), lapras(["Splash"]), lax(["Splash"]), slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => b.p2.active[0].setStatus("psn", null, null, true), inspect: (b) => hps(b),
});
// F116. Comatose has no status to cure: Purify fails, no heal.
run("F116", "Jolteon (50 HP) Purify into Komala (Comatose)", {
  game: "swsh", mons: [jolt(["Purify"]), lapras(["Splash"]), { species: "Komala", ability: "Comatose", moves: ["Splash"] }, slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => b.p1.active[0].sethp(50), inspect: (b) => hps(b),
});

// ---- Party cures: Aromatherapy, Heal Bell ---------------------------------------------------------------------------------------
// F120. Aromatherapy (gen 8): the bench (abilities ignored off the field, sim/pokemon.ts:859) is cured, a Sap Sipper there too; an ally behind a
// Substitute is not (no Infiltrator).
run("F120", "Jolteon Aromatherapy; Lapras (poisoned, Substitute); the bench Snorlax poisoned with Sap Sipper", {
  game: "swsh", mons: [jolt(["Aromatherapy"]), lapras(["Splash"]), lax(["Splash"]), slow],
  turns: [["move 1, move 1", "move 1, move 1"]],
  setup: (b) => { b.p1.active[1].setStatus("psn", null, null, true); b.p1.active[1].addVolatile("substitute"); benchStatus(b, "p1", 2, "psn", "sapsipper"); },
  inspect: (b) => team(b, "p1"),
});
// F121. Heal Bell (gen 9): an active Good as Gold ally is immune; a Soundproof Pokémon on the bench is cured.
run("F121", "Jolteon Heal Bell; Gholdengo (Good as Gold, burned); the bench Snorlax poisoned with Soundproof", {
  mons: [jolt(["Heal Bell"]), { species: "Gholdengo", ability: "Good as Gold", moves: ["Splash"] }, lax(["Splash"]), slow],
  turns: [["move 1, move 1", "move 1, move 1"]],
  setup: (b) => { b.p1.active[1].setStatus("brn", null, null, true); benchStatus(b, "p1", 2, "psn", "soundproof"); },
  inspect: (b) => team(b, "p1"),
});
// F122. Heal Bell (gen 7 mod): its user and the bench's Soundproof holder: the bench's ability is ignored (hasAbility false), the user's is not.
run("F122", "USUM Exploud (Soundproof, poisoned) Heal Bell; the bench Snorlax poisoned with Soundproof", {
  game: "usum", mons: [{ species: "Exploud", ability: "Soundproof", moves: ["Heal Bell"] }, lapras(["Splash"]), lax(["Splash"]), slow],
  turns: [["move 1, move 1", "move 1, move 1"]],
  setup: (b) => { b.p1.active[0].setStatus("psn", null, null, true); benchStatus(b, "p1", 2, "psn", "soundproof"); },
  inspect: (b) => team(b, "p1"),
});
// F123. A Mold Breaker user's Heal Bell (suppressingAbility) cures a Soundproof ally.
run("F123", "Mold Breaker Haxorus Heal Bell; Exploud (Soundproof, poisoned)", {
  mons: [{ species: "Haxorus", ability: "Mold Breaker", moves: ["Heal Bell"] }, { species: "Exploud", ability: "Soundproof", moves: ["Splash"] }, lax(["Splash"]), slow],
  turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => b.p1.active[1].setStatus("psn", null, null, true), inspect: (b) => team(b, "p1"),
});
// F125. Champions Heal Bell cures the bench.
run("F125", "Champions Jolteon Heal Bell; Lapras paralysed; the bench Snorlax asleep", {
  game: "champions", mons: [jolt(["Heal Bell"]), lapras(["Splash"]), lax(["Splash"]), slow],
  turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { b.p1.active[1].setStatus("par", null, null, true); benchStatus(b, "p1", 2, "slp"); },
  inspect: (b) => team(b, "p1"),
});
// F126. A snatched Heal Bell cures the Snatch user's team, bench included, not the original user's.
run("F126", "USUM Jolteon Snatch; Snorlax Heal Bell; both sides with a status active and on the bench", {
  game: "usum", mons: [jolt(["Snatch"]), lapras(["Splash"]), lax(["Heal Bell"]), slow],
  turns: [["move 1, move 1", "move 1, move 1"]],
  setup: (b) => { b.p1.active[1].setStatus("par", null, null, true); b.p2.active[1].setStatus("brn", null, null, true); benchStatus(b, "p1", 2, "psn"); benchStatus(b, "p2", 2, "psn"); },
  inspect: (b) => `${team(b, "p1")} || ${team(b, "p2")}`,
});

// ---- Embargo (USUM) ---------------------------------------------------------------------------------------------------------------------
// F130. Embargo suppresses an Air Balloon: Garchomp's later Earthquake hits Heatran.
run("F130", "Jolteon Embargo into Heatran (Air Balloon); Garchomp Earthquake", {
  game: "usum", mons: [jolt(["Embargo"]), chomp(["Earthquake"]), { species: "Heatran", ability: "Flash Fire", item: "Air Balloon", moves: ["Splash"] }, slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], inspect: (b) => `${items(b)} || ${hps(b)}`,
});
// F131. Knock Off into an embargoed Pokémon keeps its 1.5x and removes the item. Control: no Embargo.
for (const embargo of [true, false]) run("F131", `Jolteon ${embargo ? "Embargo" : "Splash"} into Snorlax (Leftovers); Lapras Knock Off into Snorlax`, {
  game: "usum", mons: [jolt([embargo ? "Embargo" : "Splash"]), lapras(["Knock Off"]), lax(["Splash"], { item: "Leftovers" }), slow],
  turns: [[embargo ? "move 1 1, move 1 1" : "move 1, move 1 1", "move 1, move 1"]], inspect: (b) => `${items(b)} || ${hps(b)}`,
});
// F132. Magic Coat reflects Embargo; the embargoed Jolteon's Leftovers then heals nothing at the end of turn.
run("F132", "Snorlax Magic Coat; Jolteon (Leftovers, 100) Embargo into Snorlax", {
  game: "usum", mons: [jolt(["Embargo"], { item: "Leftovers" }), lapras(["Splash"]), lax(["Magic Coat"]), slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => b.p1.active[0].sethp(100), inspect: (b) => `${vols(b)} || ${hps(b)}`,
});
// F133. Fling fails while its user's item is suppressed (data/moves.ts fling onPrepareHit: ignoringItem(true)).
run("F133", "Jolteon Embargo into Snorlax (Iron Ball); Snorlax Fling into Jolteon", {
  game: "usum", mons: [jolt(["Embargo"]), lapras(["Splash"]), lax(["Fling"], { item: "Iron Ball" }), slow],
  turns: [["move 1 1, move 1", "move 1 1, move 1"]], inspect: (b) => `${items(b)} || ${hps(b)}`,
});

// ---- Swallow ---------------------------------------------------------------------------------------------------------------------------
// F135. Three Stockpiles from earlier turns: modify(maxhp, 1) heals in full, then the counted Defense and Sp. Def go back.
run("F135", "Snorlax (50 HP, Stockpile 3) Swallow", {
  mons: [jolt(["Splash"]), lapras(["Splash"]), lax(["Swallow"]), slow],
  turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { const p = b.p2.active[0]; p.sethp(50); p.addVolatile("stockpile"); p.addVolatile("stockpile"); p.addVolatile("stockpile"); },
  inspect: (b) => `${boosts(b)} || ${hps(b)} || ${vols(b)}`,
});

// ---- Follow-ups ------------------------------------------------------------------------------------------------------------
// F140. Memento (selfdestruct "ifHit") into Mist: the drops are stopped; does its user still faint? Control: Clear Body (an ability TryBoost).
for (const guard of ["Mist", "Clear Body"]) run("F140", `Memento into ${guard}`, {
  mons: [guard === "Mist" ? jolt(["Mist"]) : { species: "Metagross", ability: "Clear Body", moves: ["Splash"] }, lapras(["Splash"]), lax(["Memento"]), slow],
  turns: [["move 1, move 1", "move 1 1, move 1"]], inspect: (b) => `${boosts(b)} || ${hps(b)}`,
});
// F142. Court Change moves Tailwind onto a Wind Rider's side without a SideConditionStart: no Attack rise (data/abilities.ts windrider onSideConditionStart).
run("F142", "Opponent's Tailwind; Jolteon Court Change; Brambleghast (Wind Rider) beside Jolteon", {
  mons: [jolt(["Court Change"]), { species: "Brambleghast", ability: "Wind Rider", moves: ["Splash"] }, lax(["Splash"]), slow],
  turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => b.p2.addSideCondition("tailwind", "debug"), inspect: (b) => `${sides(b)} || ${boosts(b)}`,
});
// F143. Magic Room ended mid-turn: a Lum Berry cures a confusion from before (lumberry onUpdate reads confusion too).
run("F143", "Magic Room up; Jolteon Magic Room (ends it); confused Snorlax (Lum)", {
  mons: [jolt(["Magic Room"]), lapras(["Splash"]), lax(["Splash"], { item: "Lum Berry" }), slow],
  turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { b.field.addPseudoWeather("magicroom", b.p2.active[1]); b.p2.active[0].addVolatile("confusion"); },
  inspect: (b) => `${items(b)} || ${vols(b)}`,
});
// F67b. Why F67 shows no form change: Magic Room's onFieldStart calls each item's End after the room is in pseudoWeather, so
// sim/battle.ts:607-609 suppresses that singleEvent (an ignored item's handlers do not run): Utility Umbrella's End never runs
// (its effectState.inactive stays unset) and Cherrim's weather reads do not change.
run("F67b", "Sun; Cherrim (Flower Gift, Utility Umbrella); Jolteon Magic Room: the umbrella's End state", {
  game: "swsh", mons: [jolt(["Magic Room"]), lapras(["Splash"]), { species: "Cherrim", ability: "Flower Gift", item: "Utility Umbrella", moves: ["Splash"] }, slow],
  turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => b.field.setWeather("sunnyday", "debug"),
  inspect: (b) => `${species(b)} || umbrella inactive ${String(b.p2.active[0].itemState.inactive)} || effectiveWeather ${b.p2.active[0].effectiveWeather()}`,
});
