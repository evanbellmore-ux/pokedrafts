// TIER 2 (end of turn) probes, part 1: Future Sight / Doom Desire landing (FS), Cud Chew (CC), Moody (MO), G-Max damage
// over time (GX) and the order-29 form changes (FC), on pinned Showdown c23d2e94 through guards-sim.ts (exact enumeration:
// every damage roll with rolls "all", every sample(), speed ties shuffled, added effects below 100% off).
// Run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/status2/design/tier2-eot-training-probes-1.ts > scripts/.cache/calc-audit/status2/design/tier2-eot-training-probes-1.out 2> scripts/.cache/calc-audit/status2/design/tier2-eot-training-probes-1.err
import { enumerate, monAt, report, showTrace, type Mon, type Probe } from "./guards-sim";

type Id = "p1a" | "p1b" | "p2a" | "p2b";
const LINES = /^\|(move|switch|drag|-weather|-fieldstart|-fieldend|-heal|-damage|-boost|-unboost|-enditem|-item|-ability|-activate|-fail|-immune|-miss|cant|-start|-end|-sidestart|-sideend|-formechange|detailschange|-status|-curestatus|-terastallize|faint|turn|-hint)\|/;
const run = (title: string, probe: Probe, opts: Parameters<typeof report>[2] = {}) => report(title, enumerate({ lines: LINES, ...probe }), opts);
const lax = (n: number, name = `Lax${n}`, extra: Partial<Mon> = {}): Mon => ({ species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], evs: { spe: n * 8 }, name, ...extra });
const boosts = (p: any) => {
  if (!p) return "-";
  const parts = Object.entries(p.boosts as Record<string, number>).filter(([, v]) => v).map(([k, v]) => `${k}${v > 0 ? "+" : ""}${v}`);
  return parts.length ? parts.join(" ") : "0";
};
const state = (p: any) => !p ? "-" : `${p.name}=${p.species.id} ${p.hp}/${p.maxhp}${p.item ? " " + p.item : ""}${p.status ? " " + p.status : ""} [${boosts(p)}]${Object.keys(p.volatiles).length ? " v:" + Object.keys(p.volatiles).join(",") : ""}`;
const all = (b: any) => (["p1a", "p1b", "p2a", "p2b"] as Id[]).map((id) => `${id} ${state(monAt(b, id))}`).join(" | ");

// The futuremove slot condition as Future Sight's / Doom Desire's onTry leaves it (PS/data/moves.ts:6401-6420, :3856-3873),
// landing at this turn's residual (endingTurn reached: PS/data/conditions.ts:390-393). `source`: the Pokémon that used it.
const FS_DATA = { id: "futuresight", name: "Future Sight", accuracy: 100, basePower: 120, category: "Special", priority: 0, flags: { allyanim: 1, metronome: 1, futuremove: 1 }, ignoreImmunity: false, effectType: "Move", type: "Psychic" };
const DD_DATA = { id: "doomdesire", name: "Doom Desire", accuracy: 100, basePower: 140, category: "Special", priority: 0, flags: { metronome: 1, futuremove: 1 }, effectType: "Move", type: "Steel" };
function land(b: any, target: Id, source: any, move: "futuresight" | "doomdesire" = "futuresight") {
  const t = monAt(b, target);
  t.side.addSlotCondition(t, "futuremove", source);
  const s = t.side.slotConditions[t.position].futuremove;
  Object.assign(s, { move, source, moveData: { ...(move === "futuresight" ? FS_DATA : DD_DATA), flags: { ...(move === "futuresight" ? FS_DATA : DD_DATA).flags } } });
  s.endingTurn = 0;
}
const hatt: Mon = { species: "Hatterene", ability: "Magic Bounce", moves: ["Future Sight"], nature: "Modest", evs: { spa: 252, spe: 4 }, name: "Hatt" };

// =====================================================================================================================
// FS: Future Sight / Doom Desire landing (PS/data/conditions.ts:379-421; PS/sim/battle-actions.ts:550-620 trySpreadMoveHit)
// =====================================================================================================================

// FS01 natural: used on turn 1, it lands at the end of turn 3 (endingTurn = (1 - 1) + 2; getOverflowedTurnCount = turn - 1).
// Snorlax at 150 with a Sitrus Berry; its partner holds Leftovers: the landing (order 3) and the hit's Update come first.
run("FS01 sv natural: Future Sight on turn 1 lands at the end of turn 3 (Sitrus at the hit's Update, before Leftovers 5.4)", {
  game: "sv", rolls: "all", turns: [["move 1 1, move 1", "move 1, move 1"], ["move 1 1, move 1", "move 1, move 1"], ["move 1 1, move 1", "move 1, move 1"]],
  setup: (b) => { b.p2.active[0].sethp(150); b.p2.active[1].sethp(150); },
  mons: [{ ...hatt, moves: ["Future Sight", "Splash"] }, lax(4), lax(8, "Target", { item: "Sitrus Berry" }), lax(12, "Lefties", { item: "Leftovers" })],
  inspect: (b) => all(b),
}, { lines: false });
showTrace("FS01-trace the landing's lines (first roll)", {
  game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"], ["move 2, move 1", "move 1, move 1"], ["move 2, move 1", "move 1, move 1"]],
  setup: (b) => { b.p2.active[0].sethp(150); b.p2.active[1].sethp(150); },
  mons: [{ ...hatt, moves: ["Future Sight", "Splash"] }, lax(4), lax(8, "Target", { item: "Sitrus Berry" }), lax(12, "Lefties", { item: "Leftovers" })],
}, LINES);
// FS02: the same landing set up directly (the oracle's prepare in V): it must equal FS01's end of turn 3.
run("FS02 sv set-up landing from the active Hatterene (equals FS01)", {
  game: "sv", rolls: "all", turns: [["move 2, move 1", "move 1, move 1"]],
  setup: (b) => { b.p2.active[0].sethp(150); b.p2.active[1].sethp(150); land(b, "p2a", b.p1.active[0]); },
  mons: [{ ...hatt, moves: ["Future Sight", "Splash"] }, lax(4), lax(8, "Target", { item: "Sitrus Berry" }), lax(12, "Lefties", { item: "Leftovers" })],
}, { lines: false });
// FS03: the source's held item and ability apply only while it is active (PS/sim/pokemon.ts:858-885 ignoringAbility /
// ignoringItem: gen >= 5 && !isActive). Choice Specs Hatterene active vs the same Hatterene on the bench.
run("FS03a sv Choice Specs Hatterene active", {
  game: "sv", rolls: "all", turns: [["move 1 1, move 1", "move 1, move 1"]],
  setup: (b) => { land(b, "p2a", b.p1.active[0]); },
  mons: [{ ...hatt, item: "Choice Specs" }, lax(4), lax(8, "Target"), lax(12)],
}, { lines: false });
run("FS03b sv the same Choice Specs Hatterene on the bench (no item, no ability, no stages)", {
  game: "sv", rolls: "all", turns: [["move 1, move 1", "move 1, move 1"]], bench: { p1: [{ ...hatt, item: "Choice Specs", name: "BenchHatt" }] },
  setup: (b) => { land(b, "p2a", b.p1.pokemon[2]); },
  mons: [lax(2, "Front"), lax(4), lax(8, "Target"), lax(12)],
}, { lines: false });
run("FS03c sv control: Hatterene active, no item", {
  game: "sv", rolls: "all", turns: [["move 1 1, move 1", "move 1, move 1"]],
  setup: (b) => { land(b, "p2a", b.p1.active[0]); },
  mons: [hatt, lax(4), lax(8, "Target"), lax(12)],
}, { lines: false });
// FS04: an active source's stages as they stand at the landing (its Calm Mind this turn).
run("FS04 sv the active source's Calm Mind this turn counts at the landing", {
  game: "sv", rolls: "all", turns: [["move 2, move 1", "move 1, move 1"]],
  setup: (b) => { land(b, "p2a", b.p1.active[0]); },
  mons: [{ ...hatt, moves: ["Future Sight", "Calm Mind"] }, lax(4), lax(8, "Target"), lax(12)],
}, { lines: false });
// FS05: a source that faints this turn (faintMessages: clearVolatile, isActive false, Tera deleted, formeRegression;
// PS/sim/battle.ts faintMessages). Clefable Terastallized to Psychic: active (STAB), fainted (no Tera, no STAB), benched (Tera kept).
const clef: Mon = { species: "Clefable", ability: "Unaware", moves: ["Future Sight", "Splash"], nature: "Modest", evs: { spa: 252 }, teraType: "Psychic", name: "Clef" };
run("FS05a sv Tera Psychic Clefable active at the landing", {
  game: "sv", rolls: "all", turns: [["move 2 terastallize, move 1", "move 1, move 1"]],
  setup: (b) => { land(b, "p2a", b.p1.active[0]); },
  mons: [clef, lax(4), lax(8, "Target"), lax(12)],
}, { lines: false });
run("FS05b sv Tera Psychic Clefable knocked out this turn before the landing", {
  game: "sv", rolls: "lowest", turns: [["move 2 terastallize, move 1", "move 1, move 1 1"]],
  setup: (b) => { b.p1.active[0].sethp(1); land(b, "p2a", b.p1.active[0]); },
  mons: [clef, lax(4), lax(8, "Target"), { species: "Garchomp", ability: "Rough Skin", moves: ["Tackle"], name: "Hitter" }],
  inspect: (b) => `${state(b.p1.pokemon[0])} tera:${b.p1.pokemon[0].terastallized ?? "-"} active:${b.p1.pokemon[0].isActive}`,
}, { lines: false });
run("FS05c sv Tera Psychic Clefable on the bench, Terastallized earlier (terastallized kept)", {
  game: "sv", rolls: "lowest", turns: [["move 1, move 1", "move 1, move 1"]], bench: { p1: [{ ...clef, name: "BenchClef" }] },
  setup: (b) => { const c = b.p1.pokemon[2]; c.terastallized = "Psychic"; c.teraType = "Psychic"; land(b, "p2a", c); },
  mons: [lax(2, "Front"), lax(4), lax(8, "Target"), lax(12)],
}, { lines: false });
run("FS05d sv control: Clefable active, not Terastallized", {
  game: "sv", rolls: "lowest", turns: [["move 2, move 1", "move 1, move 1"]],
  setup: (b) => { land(b, "p2a", b.p1.active[0]); },
  mons: [clef, lax(4), lax(8, "Target"), lax(12)],
}, { lines: false });
// FS05e/f USUM: a Mega Evolved source knocked out this turn reverts to its base form (faintMessages formeRegression) before the
// landing; control: the same Mega Gardevoir alive.
const gard: Mon = { species: "Gardevoir", ability: "Trace", item: "Gardevoirite", moves: ["Future Sight", "Splash"], nature: "Modest", evs: { spa: 252 }, name: "Gard" };
run("FS05e usum Mega Gardevoir knocked out this turn before the landing", {
  game: "usum", rolls: "lowest", turns: [["move 2 mega, move 1", "move 1, move 1 1"]],
  setup: (b) => { b.p1.active[0].sethp(1); land(b, "p2a", b.p1.active[0]); },
  mons: [gard, lax(4), lax(8, "Target"), { species: "Garchomp", ability: "Rough Skin", moves: ["Tackle"], name: "Hitter" }],
  inspect: (b) => `${b.p1.pokemon[0].species.id} spa ${b.p1.pokemon[0].storedStats.spa} active:${b.p1.pokemon[0].isActive}`,
}, { lines: false });
run("FS05f usum control: the Mega Gardevoir alive", {
  game: "usum", rolls: "lowest", turns: [["move 2 mega, move 1", "move 1, move 1"]],
  setup: (b) => { land(b, "p2a", b.p1.active[0]); },
  mons: [gard, lax(4), lax(8, "Target"), lax(12)],
  inspect: (b) => `${b.p1.pokemon[0].species.id} spa ${b.p1.pokemon[0].storedStats.spa}`,
}, { lines: false });
run("FS05g usum control: base Gardevoir alive, no Mega", {
  game: "usum", rolls: "lowest", turns: [["move 2, move 1", "move 1, move 1"]],
  setup: (b) => { land(b, "p2a", b.p1.active[0]); },
  mons: [{ ...gard, item: "" }, lax(4), lax(8, "Target"), lax(12)],
}, { lines: false });
// FS06: the target side. A Dark type is immune (the stored moveData has ignoreImmunity false); a Substitute takes it; Protect
// and Endure this turn are removed before the hit (conditions.ts:403-404).
run("FS06a sv into Umbreon (Dark): immune", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { land(b, "p2a", b.p1.pokemon[2]); }, bench: { p1: [{ ...hatt, name: "BenchHatt" }] },
  mons: [lax(2, "Front"), lax(4), { species: "Umbreon", ability: "Synchronize", moves: ["Splash"], name: "Umbreon" }, lax(12)],
});
run("FS06b sv into a Substitute (40 HP left): the Substitute takes it", {
  game: "sv", turns: [["move 2, move 1", "move 1, move 1"]], setup: (b) => { land(b, "p2a", b.p1.active[0]); b.p2.active[0].addVolatile("substitute"); b.p2.active[0].volatiles.substitute.hp = 40; },
  mons: [{ ...hatt, moves: ["Future Sight", "Splash"] }, lax(4), lax(8, "Target"), lax(12)], inspect: (b) => `sub:${b.p2.active[0].volatiles.substitute?.hp ?? "gone"} hp:${b.p2.active[0].hp}`,
});
run("FS06c sv the target used Protect this turn: still hit", {
  game: "sv", rolls: "lowest", turns: [["move 2, move 1", "move 1, move 1"]], setup: (b) => { land(b, "p2a", b.p1.active[0]); },
  mons: [{ ...hatt, moves: ["Future Sight", "Splash"] }, lax(4), lax(8, "Target", { moves: ["Protect"] }), lax(12)],
});
run("FS06d sv the target used Endure this turn at 30 HP: Endure is removed, it faints", {
  game: "sv", rolls: "lowest", turns: [["move 2, move 1", "move 1, move 1"]], setup: (b) => { b.p2.active[0].sethp(30); land(b, "p2a", b.p1.active[0]); },
  mons: [{ ...hatt, moves: ["Future Sight", "Splash"] }, lax(4), lax(8, "Target", { moves: ["Endure"] }), lax(12)],
});
// FS07: an active source's Life Orb recoils (explicit AfterMoveSecondarySelf, conditions.ts:414-416); Shell Bell does not heal.
run("FS07a sv active Life Orb source: the landing is boosted and it loses 1/10", {
  game: "sv", rolls: "lowest", turns: [["move 2, move 1", "move 1, move 1"]], setup: (b) => { land(b, "p2a", b.p1.active[0]); },
  mons: [{ ...hatt, item: "Life Orb", moves: ["Future Sight", "Splash"] }, lax(4), lax(8, "Target"), lax(12)],
});
run("FS07b sv active Shell Bell source at 50 HP: no heal", {
  game: "sv", rolls: "lowest", turns: [["move 2, move 1", "move 1, move 1"]], setup: (b) => { b.p1.active[0].sethp(50); land(b, "p2a", b.p1.active[0]); },
  mons: [{ ...hatt, item: "Shell Bell", moves: ["Future Sight", "Splash"] }, lax(4), lax(8, "Target"), lax(12)],
});
// FS07c: the explicit Life Orb call (conditions.ts:414-416) does not depend on the landing hitting: an active Life Orb source
// against a Dark type (immune) still loses 1/10.
run("FS07c sv active Life Orb source, the landing into a Dark type", {
  game: "sv", rolls: "lowest", turns: [["move 2, move 1", "move 1, move 1"]], setup: (b) => { land(b, "p2a", b.p1.active[0]); },
  mons: [{ ...hatt, item: "Life Orb", moves: ["Future Sight", "Splash"] }, lax(4), { species: "Umbreon", ability: "Synchronize", moves: ["Splash"], name: "Umbreon" }, lax(12)],
});
// FS17: Helping Hand received this turn is still on an active source at order 3 (the volatile, duration 1, ends after the
// ordered handlers): does it boost the landing (onBasePower of the helpinghand condition)?
run("FS17 sv the active source received Helping Hand this turn", {
  game: "sv", rolls: "all", turns: [["move 2, move 1 -1", "move 1, move 1"]], setup: (b) => { land(b, "p2a", b.p1.active[0]); },
  mons: [{ ...hatt, moves: ["Future Sight", "Splash"] }, lax(4, "Helper", { moves: ["Helping Hand"], evs: { spe: 252 } }), lax(8, "Target"), lax(12)],
}, { lines: false });
// FS08 Champions: an active Infiltrator source bypasses Light Screen and a Substitute (moveData.infiltrates, gen >= 6); benched, it does not.
const meow: Mon = { species: "Meowstic-F", ability: "Infiltrator", moves: ["Future Sight", "Splash"], nature: "Modest", evs: { spa: 32 }, name: "Meow" };
run("FS08a champions active Infiltrator Meowstic-F into Light Screen and a Substitute", {
  game: "champions", rolls: "all", turns: [["move 2, move 1", "move 1, move 1"]],
  setup: (b) => { land(b, "p2a", b.p1.active[0]); b.p2.addSideCondition("lightscreen", "debug"); b.p2.active[0].addVolatile("substitute"); b.p2.active[0].volatiles.substitute.hp = 40; },
  mons: [meow, lax(4), lax(8, "Target"), lax(12)], inspect: (b) => `sub:${b.p2.active[0].volatiles.substitute?.hp ?? "gone"} hp:${b.p2.active[0].hp}`,
});
run("FS08b champions the same Meowstic-F benched: the Substitute takes it", {
  game: "champions", rolls: "all", turns: [["move 1, move 1", "move 1, move 1"]], bench: { p1: [{ ...meow, name: "BenchMeow" }] },
  setup: (b) => { land(b, "p2a", b.p1.pokemon[2]); b.p2.addSideCondition("lightscreen", "debug"); b.p2.active[0].addVolatile("substitute"); b.p2.active[0].volatiles.substitute.hp = 40; },
  mons: [lax(2, "Front"), lax(4), lax(8, "Target"), lax(12)], inspect: (b) => `sub:${b.p2.active[0].volatiles.substitute?.hp ?? "gone"} hp:${b.p2.active[0].hp}`,
});
run("FS08c champions benched Meowstic-F, Light Screen, no Substitute", {
  game: "champions", rolls: "all", turns: [["move 1, move 1", "move 1, move 1"]], bench: { p1: [{ ...meow, name: "BenchMeow" }] },
  setup: (b) => { land(b, "p2a", b.p1.pokemon[2]); b.p2.addSideCondition("lightscreen", "debug"); },
  mons: [lax(2, "Front"), lax(4), lax(8, "Target"), lax(12)],
}, { lines: false });
run("FS08d champions benched Meowstic-F, no screen, no Substitute", {
  game: "champions", rolls: "all", turns: [["move 1, move 1", "move 1, move 1"]], bench: { p1: [{ ...meow, name: "BenchMeow" }] },
  setup: (b) => { land(b, "p2a", b.p1.pokemon[2]); },
  mons: [lax(2, "Front"), lax(4), lax(8, "Target"), lax(12)],
}, { lines: false });
// FS09 SwSh: an active Analytic source at the residual (no one will move: onBasePower ×5325/4096); benched: none.
const beh: Mon = { species: "Beheeyem", ability: "Analytic", moves: ["Future Sight", "Splash"], nature: "Modest", evs: { spa: 252 }, name: "Beh" };
run("FS09a swsh active Analytic Beheeyem", {
  game: "swsh", rolls: "all", turns: [["move 2, move 1", "move 1, move 1"]], setup: (b) => { land(b, "p2a", b.p1.active[0]); },
  mons: [beh, lax(4), lax(8, "Target"), lax(12)],
}, { lines: false });
run("FS09b swsh the same Beheeyem benched", {
  game: "swsh", rolls: "all", turns: [["move 1, move 1", "move 1, move 1"]], bench: { p1: [{ ...beh, name: "BenchBeh" }] },
  setup: (b) => { land(b, "p2a", b.p1.pokemon[2]); },
  mons: [lax(2, "Front"), lax(4), lax(8, "Target"), lax(12)],
}, { lines: false });
// FS10 USUM: Doom Desire into a Babiri Berry holder with a Sitrus partner.
run("FS10 usum Doom Desire from an active Jirachi into a Babiri Berry Snorlax at 150", {
  game: "usum", rolls: "all", turns: [["move 2, move 1", "move 1, move 1"]], setup: (b) => { b.p2.active[0].sethp(150); land(b, "p2a", b.p1.active[0], "doomdesire"); },
  mons: [{ species: "Jirachi", ability: "Serene Grace", moves: ["Doom Desire", "Splash"], nature: "Modest", evs: { spa: 252 }, name: "Jira" }, lax(4), lax(8, "Target", { item: "Babiri Berry" }), lax(12)],
});
// FS11: positional (getAtSlot): after an Ally Switch the occupant of the slot is hit; the user standing at its own target slot is not.
run("FS11a sv Ally Switch this turn on the target side: the Pokémon now at the slot is hit", {
  game: "sv", rolls: "lowest", turns: [["move 2, move 1", "move 1, move 1"]], setup: (b) => { land(b, "p2a", b.p1.active[0]); },
  mons: [{ ...hatt, moves: ["Future Sight", "Splash"] }, lax(4), { species: "Indeedee-F", ability: "Psychic Surge", moves: ["Ally Switch"], evs: { spe: 252 }, name: "Indee" }, lax(12, "Partner")],
  inspect: (b) => all(b),
});
run("FS11b sv Future Sight into its own ally's slot, then the user Ally Switches into it: no hit (target is the user)", {
  game: "sv", rolls: "lowest", turns: [["move 2, move 1", "move 1, move 1"]], setup: (b) => { land(b, "p1b", b.p1.active[0]); },
  mons: [{ species: "Indeedee-F", ability: "Psychic Surge", moves: ["Future Sight", "Ally Switch"], evs: { spe: 252 }, name: "Indee" }, lax(4, "Ally"), lax(8), lax(12)],
});
// FS12: Psychic Terrain boosts the landing of a grounded source (active or benched): conditions.ts onBasePower reads the source.
run("FS12a sv Psychic Terrain, active Hatterene", {
  game: "sv", rolls: "all", turns: [["move 2, move 1", "move 1, move 1"]], setup: (b) => { b.field.setTerrain("psychicterrain", "debug"); land(b, "p2a", b.p1.active[0]); },
  mons: [{ ...hatt, moves: ["Future Sight", "Splash"] }, lax(4), lax(8, "Target"), lax(12)],
}, { lines: false });
run("FS12b sv Psychic Terrain, benched Hatterene", {
  game: "sv", rolls: "all", turns: [["move 1, move 1", "move 1, move 1"]], bench: { p1: [{ ...hatt, name: "BenchHatt" }] },
  setup: (b) => { b.field.setTerrain("psychicterrain", "debug"); land(b, "p2a", b.p1.pokemon[2]); },
  mons: [lax(2, "Front"), lax(4), lax(8, "Target"), lax(12)],
}, { lines: false });
// FS13: a Cud Chew target eats its Sitrus at the landing's Update (order 3, the queue empty): its counter starts at 1, so Cud
// Chew (28.2) eats it again at this same end of turn.
run("FS13 sv Farigiraf (Cud Chew, Sitrus, 110 HP) hit by the landing", {
  game: "sv", rolls: "lowest", turns: [["move 2, move 1", "move 1, move 1"]], setup: (b) => { b.p2.active[0].sethp(110); land(b, "p2a", b.p1.active[0]); },
  mons: [{ ...hatt, moves: ["Future Sight", "Splash"] }, lax(4), { species: "Farigiraf", ability: "Cud Chew", item: "Sitrus Berry", moves: ["Splash"], name: "Giraf" }, lax(12)],
  inspect: (b) => `${state(b.p2.active[0])} cud:${b.p2.active[0].abilityState.berry?.id ?? "-"}/${b.p2.active[0].abilityState.counter ?? "-"}`,
});
// FS14: a target on the charge turn of Fly: the landing misses (hitStepInvulnerabilityEvent).
run("FS14 sv the target is charging Fly this turn", {
  game: "sv", rolls: "lowest", turns: [["move 2, move 1", "move 1 1, move 1"]], setup: (b) => { land(b, "p2a", b.p1.active[0]); },
  mons: [{ ...hatt, moves: ["Future Sight", "Splash"] }, lax(4), { species: "Corviknight", ability: "Pressure", moves: ["Fly"], name: "Corv" }, lax(12)],
});
// FS15: the target's reactions as for any hit: Weakness Policy, Berserk.
run("FS15a sv into a Weakness Policy Annihilape (Psychic 2x)", {
  game: "sv", rolls: "lowest", turns: [["move 2, move 1", "move 1, move 1"]], setup: (b) => { land(b, "p2a", b.p1.active[0]); },
  mons: [{ ...clef, moves: ["Future Sight", "Splash"] }, lax(4), { species: "Annihilape", ability: "Defiant", item: "Weakness Policy", moves: ["Splash"], name: "Ape" }, lax(12)],
});
run("FS15b sv into a Berserk Drampa crossing half", {
  game: "sv", rolls: "lowest", turns: [["move 2, move 1", "move 1, move 1"]], setup: (b) => { b.p2.active[0].sethp(110); land(b, "p2a", b.p1.active[0]); },
  mons: [{ ...clef, moves: ["Future Sight", "Splash"] }, lax(4), { species: "Drampa", ability: "Berserk", moves: ["Splash"], name: "Drampa" }, lax(12)],
});
// FS16: a landing from a Pokémon that fainted on an earlier turn (on the bench at 0 HP): it still hits (only target === source
// and a fainted target stop it, conditions.ts:398-401).
run("FS16 sv source fainted on an earlier turn (bench, 0 HP)", {
  game: "sv", rolls: "all", turns: [["move 1, move 1", "move 1, move 1"]], bench: { p1: [{ ...hatt, name: "BenchHatt" }, lax(1, "Spare")] },
  setup: (b) => { const h = b.p1.pokemon[2]; h.hp = 0; h.fainted = true; h.side.pokemonLeft--; land(b, "p2a", h); },
  mons: [lax(2, "Front"), lax(4), lax(8, "Target"), lax(12)],
}, { lines: false });

// =====================================================================================================================
// CC: Cud Chew (PS/data/abilities.ts:742-771)
// =====================================================================================================================
const giraf = (extra: Partial<Mon> = {}): Mon => ({ species: "Farigiraf", ability: "Cud Chew", item: "Sitrus Berry", moves: ["Splash"], name: "Giraf", ...extra });
const cud = (b: any, id: Id = "p2a") => { const p = monAt(b, id); return `${state(p)} cud:${p.abilityState.berry?.id ?? "-"}/${p.abilityState.counter ?? "-"}`; };
// CC01: a Berry eaten during the moves: counter 2; this residual makes it 1; the next turn's residual re-eats (28.2).
run("CC01 sv Sitrus eaten in the moves of turn 1: re-eaten at the end of turn 2", {
  game: "sv", rolls: "lowest", turns: [["move 1 1, move 1", "move 1, move 1"], ["move 2, move 1", "move 1, move 1"]],
  setup: (b) => { b.p2.active[0].sethp(120); },
  mons: [{ species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw", "Splash"], evs: { atk: 252, spe: 252 }, name: "Chomp" }, lax(4), giraf(), lax(12)],
  inspect: (b) => cud(b),
});
// CC02: eaten at the weather's Update (order 1, queue empty): counter 1, so 28.2 re-eats it at this same end of turn.
run("CC02 sv Sitrus eaten after sand damage (order 1): re-eaten at 28.2 the same turn", {
  game: "sv", rolls: "lowest", turns: [["move 1, move 1", "move 1, move 1"]],
  setup: (b) => { b.field.setWeather("sandstorm", "debug"); b.p2.active[0].sethp(105); },
  mons: [lax(2), lax(4), giraf(), { species: "Tyranitar", ability: "Sand Stream", moves: ["Splash"], name: "Ttar" }],
  inspect: (b) => cud(b),
});
// CC03: eaten at the final Update (after 28.2): counter 1, re-eaten at the end of the next turn.
run("CC03 sv Sitrus eaten at the final Update (burn at 10 then... ) vs Leftovers: when is it re-eaten", {
  game: "sv", rolls: "lowest", turns: [["move 1, move 1", "move 1, move 1"], ["move 1, move 1", "move 1, move 1"]],
  setup: (b) => { b.p2.active[0].sethp(110); b.p2.active[0].addVolatile("leechseed", b.p1.active[0]); },
  mons: [lax(2), lax(4), giraf({ item: "Sitrus Berry" }), lax(12)],
  inspect: (b) => cud(b),
});
// CC04: the re-eat is singleEvent('Eat'): no TryEatItem, so a foe's Unnerve does not stop it; Heal Block stops the heal (TryHeal).
run("CC04a sv carried Cud Chew Sitrus due now beside a foe's Unnerve", {
  game: "sv", rolls: "lowest", turns: [["move 1, move 1", "move 1, move 1"]],
  setup: (b) => { const p = b.p2.active[0]; p.setItem(""); p.sethp(100); p.abilityState.berry = b.dex.items.get("sitrusberry"); p.abilityState.counter = 1; },
  mons: [{ species: "Corviknight", ability: "Unnerve", moves: ["Splash"], name: "Corv" }, lax(4), giraf({ item: "" }), lax(12)],
  inspect: (b) => cud(b),
});
run("CC04b sv carried Cud Chew Sitrus due now under Heal Block", {
  game: "sv", rolls: "lowest", turns: [["move 1, move 1", "move 1, move 1"]],
  setup: (b) => { const p = b.p2.active[0]; p.setItem(""); p.sethp(100); p.abilityState.berry = b.dex.items.get("sitrusberry"); p.abilityState.counter = 1; p.addVolatile("healblock", b.p1.active[0]); },
  mons: [lax(2), lax(4), giraf({ item: "" }), lax(12)],
  inspect: (b) => cud(b),
});
// CC05 Champions: a Lum Berry re-eaten cures a status gained this turn.
run("CC05 champions carried Cud Chew Lum due now; Toxic this turn", {
  game: "champions", rolls: "lowest", turns: [["move 1 1, move 1", "move 1, move 1"]],
  setup: (b) => { const p = b.p2.active[0]; p.setItem(""); p.abilityState.berry = b.dex.items.get("lumberry"); p.abilityState.counter = 1; },
  mons: [{ species: "Gengar", ability: "Cursed Body", moves: ["Toxic"], evs: { spe: 32 }, name: "Gengar" }, lax(4), giraf({ item: "" }), lax(12)],
  inspect: (b) => cud(b),
});
// CC06 SV: a Liechi Berry re-eaten: +1 Attack, a boost() a foe's Opportunist copies at 29.
run("CC06 sv carried Cud Chew Liechi due now; a foe's Opportunist", {
  game: "sv", rolls: "lowest", turns: [["move 1, move 1", "move 1, move 1"]],
  setup: (b) => { const p = b.p2.active[0]; p.setItem(""); p.abilityState.berry = b.dex.items.get("liechiberry"); p.abilityState.counter = 1; },
  mons: [{ species: "Espathra", ability: "Opportunist", moves: ["Splash"], name: "Espa" }, lax(4), giraf({ item: "" }), lax(12)],
  inspect: (b) => `${cud(b)} | ${state(b.p1.active[0])}`,
});
// CC07 Champions: Sitrus re-eaten at full HP heals nothing; the counter still ends.
run("CC07 champions carried Cud Chew Sitrus at full HP; then at 0 HP (fainted this turn)", {
  game: "champions", rolls: "lowest", turns: [["move 1, move 1", "move 1, move 1"]],
  setup: (b) => { const p = b.p2.active[0]; p.setItem(""); p.abilityState.berry = b.dex.items.get("sitrusberry"); p.abilityState.counter = 1; },
  mons: [lax(2), lax(4), giraf({ item: "" }), lax(12)],
  inspect: (b) => cud(b),
});
// CC08: a counter of 2 (eaten on the previous turn's final Update, or during the moves last turn... as the bridge sees it):
// this residual only counts down.
run("CC08 sv Cud Chew counter 2 at the turn's start: no re-eat this turn", {
  game: "sv", rolls: "lowest", turns: [["move 1, move 1", "move 1, move 1"]],
  setup: (b) => { const p = b.p2.active[0]; p.setItem(""); p.sethp(100); p.abilityState.berry = b.dex.items.get("sitrusberry"); p.abilityState.counter = 2; },
  mons: [lax(2), lax(4), giraf({ item: "" }), lax(12)],
  inspect: (b) => cud(b),
});
// CC10: a Berry eaten during the moves overwrites a pending one (onEatItem: berry and counter 2): the carried Sitrus due now
// is not re-eaten; the new Lum is pending (counter 1 after this residual).
run("CC10 sv carried Cud Chew Sitrus due now; the holder eats a Lum Berry in the moves (Toxic)", {
  game: "sv", rolls: "lowest", turns: [["move 1 1, move 1", "move 1, move 1"]],
  setup: (b) => { const p = b.p2.active[0]; p.sethp(100); p.abilityState.berry = b.dex.items.get("sitrusberry"); p.abilityState.counter = 1; },
  mons: [{ species: "Gengar", ability: "Cursed Body", moves: ["Toxic"], evs: { spe: 252 }, name: "Gengar" }, lax(4), giraf({ item: "Lum Berry" }), lax(12)],
  inspect: (b) => cud(b),
});
// CC09 SV: Starf re-eaten: one random stat +2 (sample over the stats below +6).
run("CC09 sv carried Cud Chew Starf due now (Attack already +6)", {
  game: "sv", rolls: "lowest", turns: [["move 1, move 1", "move 1, move 1"]],
  setup: (b) => { const p = b.p2.active[0]; p.setItem(""); p.boosts.atk = 6; p.abilityState.berry = b.dex.items.get("starfberry"); p.abilityState.counter = 1; },
  mons: [lax(2), lax(4), giraf({ item: "" }), lax(12)],
  inspect: (b) => cud(b),
}, { lines: false });

// =====================================================================================================================
// MO: Moody (PS/data/abilities.ts:2701-2733; gen 7: PS/data/mods/gen7/abilities.ts:39-64 counts accuracy and evasion)
// =====================================================================================================================
const glalie: Mon = { species: "Glalie", ability: "Moody", moves: ["Splash"], name: "Glalie" };
run("MO01 sv Moody from all stages 0: 5 × 4 equal outcomes", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"]], mons: [glalie, lax(4), lax(8), lax(12)], inspect: (b) => boosts(b.p1.active[0]),
}, { lines: false, hp: false });
run("MO02 usum Moody: accuracy and evasion counted (7 × 6)", {
  game: "usum", turns: [["move 1, move 1", "move 1, move 1"]], mons: [glalie, lax(4), lax(8), lax(12)], inspect: (b) => boosts(b.p1.active[0]),
}, { lines: false, hp: false });
run("MO03 sv Moody at Atk +6, Spe -6: the rise skips +6, the drop skips -6 and the raised stat", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { b.p1.active[0].boosts.atk = 6; b.p1.active[0].boosts.spe = -6; },
  mons: [glalie, lax(4), lax(8), lax(12)], inspect: (b) => boosts(b.p1.active[0]),
}, { lines: false, hp: false });
run("MO04 sv Moody with its own White Herb: the drop restored at 29", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"]], mons: [{ ...glalie, item: "White Herb" }, lax(4), lax(8), lax(12)],
  inspect: (b) => `${boosts(b.p1.active[0])} item:${b.p1.active[0].item || "-"}`,
}, { lines: false, hp: false });
run("MO05 sv Moody beside a foe's Opportunist: the +2 is copied at 29", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"]], mons: [glalie, lax(4), { species: "Espathra", ability: "Opportunist", moves: ["Splash"], name: "Espa" }, lax(12)],
  inspect: (b) => `${boosts(b.p1.active[0])} || ${boosts(b.p2.active[0])}`,
}, { lines: false, hp: false });
run("MO06 champions Moody (Glalie) from 0", {
  game: "champions", turns: [["move 1, move 1", "move 1, move 1"]], mons: [glalie, lax(4), lax(8), lax(12)], inspect: (b) => boosts(b.p1.active[0]),
}, { lines: false, hp: false });
showTrace("MO07 sv Moody's order: 28.2 with Speed Boost (by Speed), before the Orbs (28.3) and White Herb (29)", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"]],
  mons: [{ ...glalie, item: "Toxic Orb" }, { species: "Ninjask", ability: "Speed Boost", moves: ["Splash"], name: "Ninjask" }, lax(8), lax(12)],
}, LINES);

// =====================================================================================================================
// GX: G-Max damage over time (PS/data/moves.ts gmaxvinelash 7365-7400 and kin; gmaxcentiferno, gmaxsandblast) — SwSh
// =====================================================================================================================
// guards-sim's Mon has no gigantamax flag: the set gets it through the setup (Pokemon.gigantamax is read at the choice).
const gmax = (b: any, id: Id) => { const p = monAt(b, id); p.gigantamax = true; p.canGigantamax = p.baseSpecies.canGigantamax; };
run("GX01 swsh G-Max Wildfire: each non-Fire foe 1/6 at 5.1 (before Grassy Terrain 5.2 and Leftovers 5.4)", {
  game: "swsh", turns: [["move 1 1 dynamax, move 1", "move 1, move 1"]], setup: (b) => { gmax(b, "p1a"); b.field.setTerrain("grassyterrain", "debug"); b.p2.active[1].sethp(150); },
  mons: [{ species: "Charizard", ability: "Blaze", moves: ["Flamethrower"], evs: { spe: 252 }, name: "Zard" }, lax(4), { species: "Venusaur", ability: "Overgrow", moves: ["Splash"], name: "Saur" }, lax(12, "Lefties", { item: "Leftovers" })],
});
run("GX02 swsh G-Max Wildfire into a Substitute: is the side condition set", {
  game: "swsh", turns: [["move 1 1 dynamax, move 1", "move 1, move 1"]], setup: (b) => { gmax(b, "p1a"); b.p2.active[0].addVolatile("substitute"); b.p2.active[0].volatiles.substitute.hp = 400; },
  mons: [{ species: "Charizard", ability: "Blaze", moves: ["Flamethrower"], evs: { spe: 252 }, name: "Zard" }, lax(4), lax(8, "Subbed"), lax(12)],
  inspect: (b) => `wildfire:${!!b.p2.sideConditions.gmaxwildfire}`,
});
run("GX03 swsh G-Max Wildfire into Protect (1/4): is the side condition set", {
  game: "swsh", turns: [["move 1 1 dynamax, move 1", "move 1, move 1"]], setup: (b) => { gmax(b, "p1a"); },
  mons: [{ species: "Charizard", ability: "Blaze", moves: ["Flamethrower"], name: "Zard" }, lax(4), lax(8, "Protector", { moves: ["Protect"], evs: { spe: 252 } }), lax(12)],
  inspect: (b) => `wildfire:${!!b.p2.sideConditions.gmaxwildfire}`,
});
run("GX04 swsh G-Max Cannonade: a Magic Guard foe takes nothing; a Dynamaxed foe takes baseMaxhp/6", {
  game: "swsh", turns: [["move 1 1 dynamax, move 1", "move 1 1 dynamax, move 1"]], setup: (b) => { gmax(b, "p1a"); },
  mons: [{ species: "Blastoise", ability: "Torrent", moves: ["Surf"], evs: { spe: 252 }, name: "Toise" }, lax(4),
    lax(8, "Maxed", { moves: ["Tackle"] }), { species: "Clefable", ability: "Magic Guard", moves: ["Splash"], name: "Clef" }],
});
run("GX04b swsh G-Max Cannonade: the Water-type foe takes nothing, the other 1/6", {
  game: "swsh", turns: [["move 1 1 dynamax, move 1", "move 1, move 1"]], setup: (b) => { gmax(b, "p1a"); },
  mons: [{ species: "Blastoise", ability: "Torrent", moves: ["Surf"], evs: { spe: 252 }, name: "Toise" }, lax(4),
    lax(8, "Plain"), { species: "Gyarados", ability: "Moxie", moves: ["Splash"], name: "Gyara" }],
});
run("GX05 swsh G-Max Centiferno: both foes trapped (1/8 at 13 this turn); the user fainting does not end it", {
  game: "swsh", turns: [["move 1 1 dynamax, move 1", "move 1, move 1"]], setup: (b) => { gmax(b, "p1a"); b.p1.active[0].sethp(1); },
  mons: [{ species: "Centiskorch", ability: "Flash Fire", moves: ["Fire Lash"], evs: { spe: 252 }, name: "Centi" }, lax(4), lax(8, "FoeA"), lax(12, "Quaker", { moves: ["Earthquake"] })],
  inspect: (b) => `${state(b.p2.active[0])} | ${state(b.p2.active[1])}`,
});
run("GX06 swsh G-Max Vine Lash carried from an earlier turn (the side condition, 3 turns left): damage at 5.1, no landing this turn", {
  game: "swsh", turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { b.p2.addSideCondition("gmaxvinelash", b.p1.active[0]); b.p2.sideConditions.gmaxvinelash.duration = 3; },
  mons: [lax(2), lax(4), { species: "Venusaur", ability: "Overgrow", moves: ["Splash"], name: "Saur" }, lax(12, "Plain")],
});

// =====================================================================================================================
// FC: order-29 form changes (PS/data/abilities.ts zenmode 5585, shieldsdown 4239, schooling 4044, powerconstruct 3385;
// PS/sim/pokemon.ts:1387-1506 setSpecies / formeChange / updateMaxHp)
// =====================================================================================================================
const form = (b: any, id: Id = "p1a") => { const p = monAt(b, id); return `${p.species.id} ${p.hp}/${p.maxhp} types:${p.getTypes().join("/")} spe:${p.storedStats.spe} item:${p.item || "-"}`; };
run("FC01 usum Zen Mode: poisoned Darmanitan from 95 across half at 9 → Zen at 29", {
  game: "usum", turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { b.p1.active[0].sethp(95); b.p1.active[0].setStatus("psn", null, null, true); },
  mons: [{ species: "Darmanitan", ability: "Zen Mode", moves: ["Splash"], name: "Darm" }, lax(4), lax(8), lax(12)], inspect: (b) => form(b),
});
run("FC02 usum Zen Mode: Zen Darmanitan above half reverts at 29 (Leftovers to above half)", {
  game: "usum", turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { const p = b.p1.active[0]; p.sethp(85); p.addVolatile("zenmode"); },
  mons: [{ species: "Darmanitan", ability: "Zen Mode", item: "Leftovers", moves: ["Splash"], name: "Darm" }, lax(4), lax(8), lax(12)], inspect: (b) => form(b),
});
run("FC03 swsh Galarian Zen Mode across half (poison at 9)", {
  game: "swsh", turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { b.p1.active[0].sethp(95); b.p1.active[0].setStatus("psn"); },
  mons: [{ species: "Darmanitan-Galar", ability: "Zen Mode", moves: ["Splash"], name: "DarmG" }, lax(4), lax(8), lax(12)], inspect: (b) => form(b),
});
run("FC04 sv Shields Down: a Blue Core Minior (Meteor) taken to half by Leech Seed → the set's Core at 29", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { b.p1.active[0].sethp(Math.floor(b.p1.active[0].maxhp / 2) + 2); b.p1.active[0].addVolatile("leechseed", b.p2.active[0]); },
  mons: [{ species: "Minior-Blue", ability: "Shields Down", moves: ["Splash"], name: "Minior" }, lax(4), lax(8), lax(12)],
  inspect: (b) => form(b),
});
run("FC05 swsh Schooling: School Wishiwashi poisoned to a quarter → Solo at 29", {
  game: "swsh", turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { const p = b.p1.active[0]; p.sethp(Math.floor(p.maxhp / 4) + 3); p.setStatus("psn"); },
  mons: [{ species: "Wishiwashi", ability: "Schooling", moves: ["Splash"], name: "Wishi" }, lax(4), lax(8), lax(12)], inspect: (b) => form(b),
});
run("FC06 usum Power Construct: Zygarde at half after burn → Complete; HP = new max − (old max − hp); Sitrus at the final Update reads the new max", {
  game: "usum", turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { const p = b.p1.active[0]; p.sethp(Math.floor(p.maxhp / 2) + 5); p.setStatus("brn"); },
  mons: [{ species: "Zygarde", ability: "Power Construct", item: "Sitrus Berry", moves: ["Splash"], name: "Zyg" }, lax(4), lax(8), lax(12)], inspect: (b) => form(b),
});
