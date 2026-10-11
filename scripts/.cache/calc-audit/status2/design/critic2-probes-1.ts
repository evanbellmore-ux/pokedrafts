// CRITIC 2 probes for status2 (ADDENDUM2.md): the claims where the four Tier 2 designs (tier2-moves, tier2-presence,
// tier2-eot-training, inputs) disagree with SPEC2 or with each other, and the risky rules each rests on, on pinned
// Showdown c23d2e94 through guards-sim.ts (exact enumeration: every random decision replayed, every move hits, no
// critical hit, added effects below 100% fail; `stall` and the listed chances enumerated). Run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/status2/design/critic2-probes-1.ts [CQ01 ...] > scripts/.cache/calc-audit/status2/design/critic2-probes-1.out 2> scripts/.cache/calc-audit/status2/design/critic2-probes-1.err
import { enumerate, monAt, report, showTrace, type Mon, type Probe } from "./guards-sim";

type Id = "p1a" | "p1b" | "p2a" | "p2b";
const only = process.argv.slice(2);
const want = (id: string) => !only.length || only.includes(id);
const LINES = /^\|(move|cant|-heal|-damage|-boost|-unboost|-enditem|-item|-ability|-activate|-fail|-immune|-miss|-start|-end|-singleturn|-status|-curestatus|-fieldstart|faint|-sidestart|turn)\|/;
const run = (title: string, probe: Probe, opts: Parameters<typeof report>[2] = {}) => report(title, enumerate({ lines: LINES, ...probe }), opts);
const lax = (n: number, name = `Lax${n}`, extra: Partial<Mon> = {}): Mon => ({ species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], evs: { spe: n * 8 }, name, ...extra });
const boosts = (p: any) => {
  if (!p) return "-";
  const parts = Object.entries(p.boosts as Record<string, number>).filter(([, v]) => v).map(([k, v]) => `${k}${v > 0 ? "+" : ""}${v}`);
  return parts.length ? parts.join(" ") : "0";
};
const state = (p: any) => !p ? "-" : `${p.name} ${p.hp}/${p.maxhp}${p.item ? " " + p.item : ""}${p.status ? " " + p.status : ""} [${boosts(p)}]${Object.keys(p.volatiles).length ? " v:" + Object.keys(p.volatiles).join(",") : ""}`;
const all = (b: any) => (["p1a", "p1b", "p2a", "p2b"] as Id[]).map((id) => `${id} ${state(monAt(b, id))}`).join(" | ");

// CQ01 (SPEC2 §3.1 stockpile doc vs inputs IN-C1). PS/data/moves.ts:17961-18008: each layer's boost that CHANGED the stat
// counts −1 (curDef !== target.boosts.def), Contrary included; the End boosts by the counts. SPEC2 says "+1 per layer
// Contrary lowered it" (its End would then lower Contrary's Defense further); IN-C1 says −1 (its End restores it).
if (want("CQ01")) {
  run("CQ01a sv: Contrary Shuckle Stockpile twice, then Swallow (the End's net stages)", {
    game: "sv", turns: [["move 1, move 1", "move 1, move 1"], ["move 1, move 1", "move 1, move 1"], ["move 2, move 1", "move 1, move 1"]],
    mons: [{ species: "Shuckle", ability: "Contrary", moves: ["Stockpile", "Swallow"], name: "Shuckle" }, lax(2), lax(3), lax(4)],
    setup: (b) => { b.p1.active[0].sethp(100); },
    inspect: (b) => { const p = b.p1.active[0]; const s = p.volatiles.stockpile; return `Shuckle ${p.hp}/${p.maxhp} [${boosts(p)}] stockpile ${s ? `layers ${s.layers} def ${s.def} spd ${s.spd}` : "none"}`; },
  }, { lines: false, hp: false });
  run("CQ01b sv: Simple Swalot Stockpile at Def +5 (the Def layer counts though capped to +1), then Spit Up", {
    game: "sv", turns: [["move 1, move 1", "move 1, move 1"], ["move 2 1, move 1", "move 1, move 1"]],
    mons: [{ species: "Swalot", ability: "Simple", moves: ["Stockpile", "Spit Up"], name: "Swalot" }, lax(2), lax(3), lax(4)],
    setup: (b) => { b.p1.active[0].boosts.def = 5; },
    inspect: (b) => { const p = b.p1.active[0]; const s = p.volatiles.stockpile; return `Swalot [${boosts(p)}] stockpile ${s ? `layers ${s.layers} def ${s.def} spd ${s.spd}` : "none"}`; },
  }, { lines: false, hp: false });
}

// CQ02 (tier2-presence `echoedVoiceTurns` vs inputs `echoedVoice`). PS/data/moves.ts:4404-4441: a pseudo-weather of
// duration 2 whose multiplier starts at 1; a use on a later turn (duration no longer 2) raises it (at most 5); a second use
// in the same turn does not. A turn without a use lets it end. The input both designs need is the multiplier after last turn.
if (want("CQ02")) {
  showTrace("CQ02 sv: Echoed Voice turn 1 (A), turn 2 (A and B), turn 3 none, turn 4 (A): power read from Target's losses (lowest rolls)", {
    game: "sv", turns: [["move 1 1, move 2", "move 1, move 1"], ["move 1 1, move 1 1", "move 1, move 1"], ["move 2, move 2", "move 1, move 1"], ["move 1 1, move 2", "move 1, move 1"]],
    mons: [lax(20, "A", { moves: ["Echoed Voice", "Splash"] }), lax(10, "B", { moves: ["Echoed Voice", "Splash"] }), lax(1, "Target"), lax(2)],
  }, /^\|(move|-damage|turn)\|/);
}

// CQ03 (new: the battle's first turn). sim/battle.ts:1670-1683 nextTurn resets statsRaisedThisTurn, statsLoweredThisTurn,
// usedItemThisTurn and hurtThisTurn only when `this.turn !== 1`: on the battle's first turn the leads' entry effects
// (Intimidate and the Defiant it sets off, an entry Seed) count as this turn's. Burning Jealousy, Lash Out and Pickup read
// them. Every oracle case runs Showdown's turn 1; the app's turn starts with none of them set.
if (want("CQ03")) {
  const kingambit: Mon = { species: "Kingambit", ability: "Defiant", moves: ["Splash"], name: "Kingambit", evs: { spe: 4 } };
  const incin: Mon = { species: "Incineroar", ability: "Intimidate", moves: ["Burning Jealousy", "Splash"], name: "Incineroar", evs: { spe: 252 } };
  const lashOut: Mon = { species: "Snorlax", ability: "Thick Fat", moves: ["Lash Out", "Splash"], name: "Lasher", evs: { spe: 24 } };
  run("CQ03a sv turn 1: Intimidate at the lead (Kingambit's Defiant +2); Burning Jealousy and Lash Out on turn 1", {
    game: "sv", turns: [["move 1, move 1", "move 1, move 1 2"]],
    mons: [incin, lax(1, "Shuckle"), kingambit, lashOut],
    inspect: (b) => all(b),
  });
  run("CQ03b sv control: the same, the moves on turn 2 after a turn of Splash", {
    game: "sv", turns: [["move 2, move 1", "move 1, move 2"], ["move 1, move 1", "move 1, move 1 2"]],
    mons: [incin, lax(1, "Shuckle"), kingambit, lashOut],
    inspect: (b) => all(b),
  });
  run("CQ03e sv turn 2: Incineroar switches in (Intimidate on the foes); Lash Out and Burning Jealousy later that turn", {
    game: "sv", turns: [["move 1, move 1", "move 1, move 2"], ["switch 3, move 2", "move 1, move 1 2"]],
    mons: [lax(30, "Starter", { moves: ["Splash"] }), lax(1, "Shuckle", { moves: ["Splash", "Burning Jealousy"] }), kingambit, lashOut],
    bench: { p1: [incin] },
    inspect: (b) => all(b),
  });
  const pinc: Mon = { species: "Pincurchin", ability: "Electric Surge", moves: ["Splash"], name: "Pincurchin" };
  const seed: Mon = { species: "Snorlax", ability: "Thick Fat", item: "Electric Seed", moves: ["Splash"], name: "SeedLax", evs: { spe: 16 } };
  const ambi: Mon = { species: "Ambipom", ability: "Pickup", moves: ["Splash"], name: "Ambipom" };
  run("CQ03c sv turn 1: a lead Electric Seed used in Electric Surge's terrain; a foe's Pickup at turn 1's end", {
    game: "sv", turns: [["move 1, move 1", "move 1, move 1"]],
    mons: [pinc, seed, ambi, lax(4)],
    inspect: (b) => all(b),
  }, { hp: false });
  run("CQ03d sv control: Ambipom holds Leftovers on turn 1 (no pickup), loses it to Knock Off on turn 2: Pickup at turn 2's end", {
    game: "sv", turns: [["move 2, move 1", "move 1, move 1"], ["move 1 1, move 1", "move 1, move 1"]],
    mons: [{ ...pinc, moves: ["Knock Off", "Splash"] }, seed, { ...ambi, item: "Leftovers" }, lax(4)],
    inspect: (b) => all(b),
  }, { hp: false });
}

// CQ04 (tier2-moves IN-CRASH): the crash when every target failed (PS/sim/battle-actions.ts:521-531 MoveFail;
// PS/data/moves.ts highjumpkick onMoveFail trunc(baseMaxhp / 2)). Which failures count: Protect (and its contact
// effect first), an absorbing ability (Volt Absorb against Supercell Slam), Gravity (stopped in BeforeMove: no MoveFail).
if (want("CQ04")) {
  const kicker = (extra: Partial<Mon> = {}): Mon => ({ species: "Hitmonlee", ability: "Limber", moves: ["High Jump Kick", "Splash"], name: "Kicker", evs: { spe: 4 }, ...extra });
  run("CQ04a sv: High Jump Kick into Protect (control for the amount)", {
    game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]],
    mons: [kicker(), lax(1), lax(2, "Protector", { moves: ["Protect"] }), lax(3)],
    inspect: (b) => all(b),
  }, { hp: false });
  run("CQ04b sv: High Jump Kick into Spiky Shield (1/8, then the crash)", {
    game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]],
    mons: [kicker(), lax(1), lax(2, "Spiky", { moves: ["Spiky Shield"] }), lax(3)],
    inspect: (b) => all(b),
  }, { hp: false });
  run("CQ04c sv: High Jump Kick under Gravity (stopped in BeforeMove: no crash)", {
    game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]],
    mons: [kicker(), lax(1), lax(2), lax(3)],
    setup: (b) => { b.field.addPseudoWeather("gravity", b.p1.active[1]); },
    inspect: (b) => all(b),
  }, { hp: false });
  run("CQ04d sv: Supercell Slam into a Volt Absorb Lanturn (absorbed: the crash?)", {
    game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]],
    mons: [{ species: "Pawmot", ability: "Volt Absorb", moves: ["Supercell Slam"], name: "Slammer" }, lax(1), { species: "Lanturn", ability: "Volt Absorb", moves: ["Splash"], name: "Lanturn" }, lax(3)],
    setup: (b) => { b.p2.active[0].sethp(100); },
    inspect: (b) => all(b),
  }, { hp: false });
  run("CQ04e sv: High Jump Kick into a Substitute (the Substitute takes it: no crash)", {
    game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]],
    mons: [kicker(), lax(1), lax(2, "Subbed"), lax(3)],
    setup: (b) => { b.p2.active[0].addVolatile("substitute"); b.p2.active[0].volatiles.substitute.hp = 20; },
    inspect: (b) => `${all(b)} | sub ${b.p2.active[0].volatiles.substitute?.hp ?? "gone"}`,
  }, { hp: false });
}

// CQ05 (tier2-eot-training `stall?: 1 | 3 …` vs inputs `stall?: 3 …`; who rolls). PS/data/conditions.ts:439-462 and
// PS/data/moves.ts quickguard / wideguard onTry (willAct only) + onHitSide addVolatile('stall'): Quick Guard and Wide Guard
// raise the counter without rolling it; Protect after them rolls 1/counter.
if (want("CQ05")) {
  run("CQ05a sv: Quick Guard on turn 1, Protect on turn 2 (stall 3 from Quick Guard)", {
    game: "sv", turns: [["move 1, move 1", "move 2, move 1"], ["move 2, move 1", "move 1 1, move 1"]],
    mons: [lax(20, "Guard", { moves: ["Quick Guard", "Protect"] }), lax(1), lax(2, "Tackler", { moves: ["Tackle", "Splash"] }), lax(3)],
    inspect: (b) => `${all(b)} | stall ${b.p1.active[0].volatiles.stall?.counter ?? "none"}`,
  }, { hp: false });
  run("CQ05b sv: Protect on turn 1, Wide Guard on turn 2 (no roll), Protect on turn 3 (stall 9)", {
    game: "sv", turns: [["move 2, move 1", "move 2, move 1"], ["move 1, move 1", "move 2, move 1"], ["move 2, move 1", "move 1 1, move 1"]],
    mons: [lax(20, "Guard", { moves: ["Wide Guard", "Protect"] }), lax(1), lax(2, "Tackler", { moves: ["Tackle", "Splash"] }), lax(3)],
    inspect: (b) => `stall ${b.p1.active[0].volatiles.stall?.counter ?? "none"} | Guard ${b.p1.active[0].hp}`,
  }, { hp: false });
}

// CQ06 (inputs carried.destinyBond, IN-DBD-03): a Destiny Bond from last turn is removed at its holder's BeforeMove
// (priority −1) or MoveAborted (PS/data/moves.ts:3483-3526). An asleep holder: a faster knockout before its action still
// takes the attacker down; a slower one after its aborted action does not.
if (want("CQ06")) {
  const gengar = (spe: number): Mon => ({ species: "Gengar", ability: "Cursed Body", moves: ["Splash"], name: "Gengar", evs: { spe } });
  const sleepy = (b: any) => { const g = b.p2.active[0]; g.sethp(1); g.setStatus("slp"); g.statusState.time = 3; g.statusState.startTime = 3; g.addVolatile("destinybond"); };
  run("CQ06a sv: asleep Gengar (1 HP, Destiny Bond from last turn), a faster Weavile's Knock Off", {
    game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]],
    mons: [{ species: "Weavile", ability: "Pressure", moves: ["Knock Off"], name: "Weavile", evs: { spe: 252 } }, lax(1), gengar(0), lax(2)],
    setup: sleepy, inspect: (b) => all(b),
  }, { hp: false });
  run("CQ06b sv: the same with Gengar faster than Weavile (its aborted BeforeMove removes Destiny Bond)", {
    game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]],
    mons: [{ species: "Weavile", ability: "Pressure", moves: ["Knock Off"], name: "Weavile", evs: { spe: 0 }, nature: "Brave" }, lax(1), gengar(252), lax(2)],
    setup: sleepy, inspect: (b) => all(b),
  }, { hp: false });
}

// CQ07 (tier2-moves: Burning Jealousy reads statsRaisedThisTurn; sim/battle.ts:2083-2086 sets it only when the boost
// table after the cap and TryBoost has a positive entry and some stat changed). Shell Smash at +6 Atk/SpA/Spe: the table's
// positive entries are capped to 0, so only its drops land: no rise this turn.
if (want("CQ07")) {
  run("CQ07 sv: Shell Smash at +6 Attack, Sp. Atk and Speed (only the drops land), then a slower Burning Jealousy", {
    game: "sv", turns: [["move 1, move 1", "move 1, move 1"]],
    mons: [lax(20, "Smasher", { moves: ["Shell Smash"] }), lax(1), lax(10, "Jealous", { moves: ["Burning Jealousy"] }), lax(2)],
    setup: (b) => { const p = b.p1.active[0]; p.boosts.atk = 6; p.boosts.spa = 6; p.boosts.spe = 6; },
    inspect: (b) => all(b),
  }, { hp: false });
}

// CQ08 (tier2-presence Sky Drop on H's hidden state; a 7.5 kg Clefairy, under Sky Drop's 200 kg limit): the lifted target cannot act this turn (onFoeBeforeMove null); a
// move at the Sky Drop user from its target's partner misses; Gust hits the user (it is in the pass list).
if (want("CQ08")) {
  run("CQ08 usum: Sky Drop lifts Clefairy; its queued Pound; its partner's Tackle and Gust at the Sky Drop user", {
    game: "usum", turns: [["move 1 1, move 1", "move 1 1, move 1 1"]],
    mons: [{ species: "Braviary", ability: "Keen Eye", moves: ["Sky Drop"], name: "Braviary", evs: { spe: 252 } }, lax(1, "Ally"),
      { species: "Clefairy", ability: "Friend Guard", moves: ["Pound"], name: "Lifted", evs: { spe: 4 } }, lax(3, "Partner", { moves: ["Tackle", "Gust"] })],
    inspect: (b) => all(b),
  }, { hp: false });
  run("CQ08b usum: the same with the partner's Gust", {
    game: "usum", turns: [["move 1 1, move 1", "move 1 1, move 2 1"]],
    mons: [{ species: "Braviary", ability: "Keen Eye", moves: ["Sky Drop"], name: "Braviary", evs: { spe: 252 } }, lax(1, "Ally"),
      { species: "Clefairy", ability: "Friend Guard", moves: ["Pound"], name: "Lifted", evs: { spe: 4 } }, lax(3, "Partner", { moves: ["Tackle", "Gust"] })],
    inspect: (b) => all(b),
  }, { hp: false });
}

// CQ09 (inputs entryOrder at the lead): the leads' ability states are made p1a, p1b, p2a, p2b (sim/battle.ts start, then
// battle-actions.ts switchIn): two equal-Speed Lightning Rods on opposite sides, the Thunderbolt from p2b's ally of the
// second rod: the older rod (p1's) takes it although the move's user is on p2's side (both are foes or allies of it).
if (want("CQ09")) {
  showTrace("CQ09 sv: Lightning Rod Raichu on each side at one Speed; p2a's Thunderbolt at p1b; who takes it at the lead (no shuffle in compareRedirectOrder)", {
    game: "sv", turns: [["move 1, move 1", "move 1 2, move 1"]],
    mons: [{ species: "Raichu", ability: "Lightning Rod", moves: ["Splash"], name: "RodA" }, lax(1, "Target"),
      { species: "Jolteon", ability: "Volt Absorb", moves: ["Thunderbolt"], name: "Bolt" }, { species: "Raichu", ability: "Lightning Rod", moves: ["Splash"], name: "RodB" }],
  }, /^\|(move|-boost|-immune|-damage|-ability|turn)\|/);
}

// CQ10 (T2P keeps a carried Bide): the release turn of a Bide from earlier turns (PS/data/moves.ts:1264-1338): at its
// BeforeMove with duration 1 it hits the last Pokémon that damaged it for twice the damage stored (tryMoveHit with fresh
// move data: Normal, Physical, contact, protect; no ignoreImmunity there). Is a Ghost immune, does Protect block it, and
// does damage taken this turn before it (a faster priority move) count?
if (want("CQ10")) {
  const bider = (b: any, source: any, stored: number) => { const p = b.p1.active[0]; p.addVolatile("bide"); p.volatiles.bide.duration = 1; p.volatiles.bide.totalDamage = stored; p.volatiles.bide.lastDamageSource = source; };
  run("CQ10a usum: release, 50 stored from Snorlax (control: 100)", {
    game: "usum", turns: [["move 1, move 1", "move 1, move 1"]],
    mons: [lax(1, "Bider", { moves: ["Bide"] }), lax(2), lax(3, "Source"), lax(4)],
    setup: (b) => bider(b, b.p2.active[0], 50), inspect: (b) => all(b),
  }, { hp: false });
  run("CQ10b usum: release at a Gengar that stored it (Ghost: immune?)", {
    game: "usum", turns: [["move 1, move 1", "move 1, move 1"]],
    mons: [lax(1, "Bider", { moves: ["Bide"] }), lax(2), { species: "Gengar", ability: "Levitate", moves: ["Splash"], name: "Gengar" }, lax(4)],
    setup: (b) => bider(b, b.p2.active[0], 50), inspect: (b) => all(b),
  }, { hp: false });
  run("CQ10c usum: release into the source's Protect", {
    game: "usum", turns: [["move 1, move 1", "move 1, move 1"]],
    mons: [lax(1, "Bider", { moves: ["Bide"] }), lax(2), lax(3, "Source", { moves: ["Protect"] }), lax(4)],
    setup: (b) => bider(b, b.p2.active[0], 50), inspect: (b) => all(b),
  }, { hp: false });
  run("CQ10d usum: a faster Quick Attack (priority 1, faster) into the Bider before its release adds to the store", {
    game: "usum", turns: [["move 1, move 1", "move 1 1, move 1"]],
    mons: [lax(1, "Bider", { moves: ["Bide"] }), lax(2), lax(30, "Quick", { moves: ["Quick Attack"] }), lax(4)],
    setup: (b) => bider(b, b.p2.active[1], 50), inspect: (b) => all(b),
  }, { hp: false });
}
