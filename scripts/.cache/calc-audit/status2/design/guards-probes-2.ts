// FAMILY 4 probes, part 2: Harvest and Pickup (C), Stored Power / Power Trip / Punishment (D), Fling (E), one-hit KO moves
// (F), spread heals (G), the Berserk lock (H), Trace's curing ability (I), the Ghost Curse cost (J), Heal Block in later steps
// (K), the attacker's Starf Berry (L), White Herb at order 29 (M), on pinned Showdown c23d2e94 through guards-sim.ts.
// Run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/status2/design/guards-probes-2.ts > scripts/.cache/calc-audit/status2/design/guards-probes-2.out
import { Dex, enumerate, monAt, report, showTrace, start, type Game, type Mon, type Probe } from "./guards-sim";

const LINES = /^\|(move|switch|drag|-weather|-heal|-damage|-boost|-unboost|-enditem|-item|-ability|-activate|-fail|-immune|cant|-start|-end|-status|-curestatus|-clearnegativeboost|-sethp|-ohko|-miss|upkeep|turn|-singleturn)\|/;
const lax = (n: number, name = `Lax${n}`): Mon => ({ species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], evs: { spe: n * 8 }, name });
const run = (title: string, probe: Probe, opts: Parameters<typeof report>[2] = {}) => report(title, enumerate({ lines: LINES, ...probe }), opts);
const items = (b: any) => ["p1a", "p1b", "p2a", "p2b"].map((id) => { const p = monAt(b, id as any); return `${p?.name}:${p?.item || "-"}(last ${p?.lastItem || "-"}${p?.usedItemThisTurn ? ", used" : ""}) ${p?.hp}`; }).join(" | ");

// ---------------------------------------------------------------------------------------------------------------------
// C. Harvest (PS/data/abilities.ts:1800-1816) and Pickup (PS/data/abilities.ts:3262-3281)
// ---------------------------------------------------------------------------------------------------------------------
const exeggutor = (item = "Sitrus Berry"): Mon => ({ species: "Exeggutor", ability: "Harvest", item, moves: ["Splash"], name: "Egg" });
run("C1 Harvest outside sun: 1/2 at 28.2, then the final Update eats the Berry again", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { b.p1.active[0].sethp(30); },
  mons: [exeggutor(), lax(4), lax(8), lax(12)], inspect: items,
}, { lines: false });
run("C2 Harvest in sun under Cloud Nine (field.isWeather false): 1/2", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { b.p1.active[0].sethp(30); b.field.setWeather("sunnyday", "debug"); },
  mons: [exeggutor(), lax(4), { species: "Golduck", ability: "Cloud Nine", moves: ["Splash"] }, lax(12)], inspect: items,
}, { lines: false });
run("C3a Harvest after flinging its own Berry (Fling's condition sets lastItem), in sun", {
  game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { b.field.setWeather("sunnyday", "debug"); },
  mons: [{ ...exeggutor(), moves: ["Fling"] }, lax(4), lax(8), lax(12)], inspect: items,
});
run("C3b Harvest after Bug Bite took its Berry (takeItem: no lastItem), in sun", {
  game: "sv", turns: [["move 1, move 1", "move 1 1, move 1"]], setup: (b) => { b.field.setWeather("sunnyday", "debug"); },
  mons: [exeggutor(), lax(4), { species: "Scizor", ability: "Technician", moves: ["Bug Bite"], evs: { spe: 252 } }, lax(12)], inspect: items,
});
run("C4 Harvest over two turns: lastItem stays when the 1/2 fails", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"], ["move 1, move 1", "move 1, move 1"]], setup: (b) => { b.p1.active[0].sethp(30); },
  mons: [exeggutor(), lax(4), lax(8), lax(12)], inspect: items,
}, { lines: false });
run("C5 Pickup with two candidates (both foes ate a Berry this turn): uniform sample", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { b.p2.active[0].sethp(40); b.p2.active[1].sethp(40); },
  mons: [{ species: "Zigzagoon", ability: "Pickup", moves: ["Splash"], name: "Zig" }, lax(4), { ...lax(8), item: "Sitrus Berry" }, { ...lax(12), item: "Oran Berry" }], inspect: items,
}, { lines: false });
run("C6 Pickup: a knocked-off item is not a candidate", {
  game: "sv", turns: [["move 1, move 1", "move 1 2, move 1"]],
  mons: [{ species: "Zigzagoon", ability: "Pickup", moves: ["Splash"], name: "Zig" }, { ...lax(4), item: "Leftovers" }, { species: "Weavile", ability: "Pressure", moves: ["Knock Off"] }, lax(12)], inspect: items,
}, { lines: false });
run("C7 Pickup takes a Lum Berry eaten at the turn's first Update", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { b.p1.active[1].setStatus("par", null, null, true); },
  mons: [{ species: "Zigzagoon", ability: "Pickup", moves: ["Splash"], name: "Zig" }, { ...lax(4), item: "Lum Berry" }, lax(8), lax(12)], inspect: items,
}, { lines: false });
run("C8 Pickup and its own used item (isAdjacent excludes itself): the Pickup holder's own eaten Sitrus", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { b.p1.active[0].sethp(10); },
  mons: [{ species: "Zigzagoon", ability: "Pickup", item: "Sitrus Berry", moves: ["Splash"], name: "Zig" }, lax(4), lax(8), lax(12)], inspect: items,
}, { lines: false });

// ---------------------------------------------------------------------------------------------------------------------
// D. Stored Power, Power Trip, Punishment read accuracy and evasion (PS/sim/pokemon.ts positiveBoosts)
// ---------------------------------------------------------------------------------------------------------------------
console.log("\n== D base power callbacks with accuracy and evasion stages");
for (const game of ["sv", "champions", "swsh", "usum"] as Game[]) {
  const b = start({ game, turns: [], mons: [lax(4), lax(8), lax(12), lax(16)] });
  const user = b.p1.active[0], target = b.p2.active[0];
  for (const id of ["storedpower", "powertrip", "punishment"]) {
    const move = b.dex.moves.get(id);
    if (!move.exists || move.isNonstandard) { console.log(`  ${game} ${id}: ${move.exists ? `isNonstandard ${move.isNonstandard}` : "absent"}`); continue; }
    const active = b.dex.getActiveMove(id);
    const cases = [{ user: { spe: 1, evasion: 1 }, target: {} }, { user: { accuracy: 2 }, target: {} }, { user: {}, target: { evasion: 2, atk: 1 } }, { user: {}, target: { evasion: 6, accuracy: 6, atk: 6 } }];
    const out = cases.map((c) => {
      for (const k of Object.keys(user.boosts)) { user.boosts[k] = (c.user as any)[k] ?? 0; target.boosts[k] = (c.target as any)[k] ?? 0; }
      return `${JSON.stringify(c)} -> ${active.basePowerCallback.call(b, user, target, active)}`;
    });
    console.log(`  ${game} ${id}: ${out.join("; ")}`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// E. Fling (PS/data/moves.ts:5734-5787)
// ---------------------------------------------------------------------------------------------------------------------
const sneasler = (item: string, extra: Partial<Mon> = {}): Mon => ({ species: "Sneasler", ability: "Unburden", item, moves: ["Fling"], evs: { atk: 252, spe: 252 }, nature: "Jolly", ...extra });
for (const item of ["Shell Bell", "Life Orb", "Choice Band", "Black Glasses", "Expert Belt"]) {
  showTrace(`E1 Fling with ${item} (30 power, or the held item's own damage effect while it is held)`, {
    game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]], mons: [sneasler(item), lax(4), { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], name: "Target" }, lax(12)],
  }, /^\|(move|-damage|-enditem|-heal)\|/);
}
showTrace("E2 Fling a Sitrus Berry at its ally (the ally eats it: singleEvent Eat, no TryEatItem: a foe's Unnerve does not stop it)", {
  game: "sv", turns: [["move 1 -2, move 1", "move 1, move 1"]], setup: (b) => { b.p1.active[1].sethp(100); },
  mons: [sneasler("Sitrus Berry"), { ...lax(4), name: "Ally" }, { species: "Aerodactyl", ability: "Unnerve", moves: ["Splash"] }, lax(12)],
}, LINES);
showTrace("E3 Fling a White Herb at a foe with a lowered stat, and a Mental Herb at a Taunted foe", {
  game: "sv", turns: [["move 1 1, move 1 2", "move 1, move 1"]], setup: (b) => { b.p2.active[0].boosts.atk = -2; b.p2.active[1].addVolatile("taunt"); },
  mons: [sneasler("White Herb"), { species: "Weavile", ability: "Pressure", item: "Mental Herb", moves: ["Fling"], evs: { spe: 252 } }, { ...lax(8), name: "Lowered" }, { ...lax(12), name: "Taunted" }],
}, LINES);
for (const item of ["Flame Orb", "Toxic Orb", "Light Ball", "Poison Barb", "King's Rock", "Razor Fang"]) {
  showTrace(`E4 Fling ${item}: its fling status or volatile as a 100% secondary (the target has not moved)`, {
    game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]], mons: [sneasler(item), lax(4), { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], name: "Target" }, lax(12)],
  }, /^\|(move|-damage|-enditem|-status|cant)\|/);
}
showTrace("E4b Fling Flame Orb into Shield Dust: the secondary does not land; the Orb is still used up", {
  game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]], mons: [sneasler("Flame Orb"), lax(4), { species: "Volcarona", ability: "Shield Dust", moves: ["Splash"], name: "Dusty" }, lax(12)],
}, /^\|(move|-damage|-enditem|-status|cant)\|/);
showTrace("E5 Fling fails: Klutz, Magic Room, no item", {
  game: "sv", turns: [["move 1 1, move 1 1", "move 1, move 1"]],
  mons: [{ species: "Lopunny", ability: "Klutz", item: "Iron Ball", moves: ["Fling"], evs: { spe: 252 }, name: "Klutzy" }, { ...sneasler(""), name: "Empty" }, lax(8), lax(12)],
}, LINES);
showTrace("E5b Fling under Magic Room fails", {
  game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { b.field.addPseudoWeather("magicroom", "debug"); },
  mons: [sneasler("Iron Ball"), lax(4), lax(8), lax(12)],
}, LINES);
showTrace("E6 Unburden after Fling, and Symbiosis passing the partner's item (AfterUseItem at the fling volatile's Update)", {
  game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]],
  mons: [sneasler("Iron Ball"), { species: "Oranguru", ability: "Symbiosis", item: "Sitrus Berry", moves: ["Splash"], name: "Orang" }, lax(8), lax(12)],
}, /^\|(move|-damage|-enditem|-item|-activate)\|/);
showTrace("E7 Fling Flame Orb into a Substitute: no burn, the Orb is used up", {
  game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { b.p2.active[0].addVolatile("substitute"); b.p2.active[0].volatiles.substitute.hp = 60; },
  mons: [sneasler("Flame Orb"), lax(4), { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], name: "Subbed" }, lax(12)],
}, /^\|(move|-damage|-enditem|-status|-activate|-end)\|/);
for (const game of ["champions", "swsh", "usum"] as Game[]) {
  const dex = Dex.forFormat({ sv: "gen9doublescustomgame", swsh: "gen8doublescustomgame", usum: "gen7doublescustomgame", champions: "gen9championsdoublescustomgame" }[game]);
  const flinger = game === "champions" ? "Sneasler" : game === "usum" ? "Weavile" : "Weavile";
  console.log(`\n(${game}: Fling ${dex.moves.get("fling").isNonstandard ?? "standard"}; ${flinger} ${dex.species.get(flinger).isNonstandard ?? "standard"})`);
  showTrace(`E8 (${game}) Fling Iron Ball and Life Orb`, {
    game, turns: [["move 1 1, move 1 2", "move 1, move 1"]],
    mons: [{ species: flinger, ability: game === "champions" ? "Unburden" : "Pressure", item: "Iron Ball", moves: ["Fling"], evs: { spe: 252 } }, { species: "Garchomp", ability: "Rough Skin", item: "Life Orb", moves: ["Fling"] }, lax(8), lax(12)],
  }, /^\|(move|-damage|-enditem)\|/);
}

// ---------------------------------------------------------------------------------------------------------------------
// F. One-hit KO moves (PS/sim/battle-actions.ts:696-708, :1606; PS/data/abilities.ts:4673 sturdy)
// ---------------------------------------------------------------------------------------------------------------------
const ohkoUser = (move: string, extra: Partial<Mon> = {}): Mon => ({ species: "Lapras", ability: "Water Absorb", moves: [move], evs: { spe: 252 }, ...extra });
const ohko = (title: string, game: Game, user: Mon, target: Mon, setup?: (b: any) => void, p2 = "move 1, move 1") =>
  showTrace(title, { game, turns: [["move 1 1, move 1", p2]], mons: [user, lax(4), target, lax(12)], ...(setup ? { setup } : {}) }, LINES);
ohko("F1 Sheer Cold into a non-Ice type at partial HP: damage = maxhp", "sv", ohkoUser("Sheer Cold"), { ...lax(8), name: "Plain" }, (b) => { b.p2.active[0].sethp(100); });
ohko("F2 Sheer Cold into an Ice type (generation 7+)", "sv", ohkoUser("Sheer Cold"), { species: "Glalie", ability: "Inner Focus", moves: ["Splash"] });
ohko("F3 Fissure into Levitate", "sv", ohkoUser("Fissure"), { species: "Bronzong", ability: "Levitate", moves: ["Splash"] });
ohko("F4 Horn Drill into a Ghost type", "sv", ohkoUser("Horn Drill"), { species: "Gengar", ability: "Cursed Body", moves: ["Splash"] });
ohko("F5 Sheer Cold into a higher-level target", "sv", ohkoUser("Sheer Cold"), { ...lax(8), level: 51, name: "Higher" });
ohko("F6 Sheer Cold into Sturdy", "sv", ohkoUser("Sheer Cold"), { species: "Bastiodon", ability: "Sturdy", moves: ["Splash"] });
ohko("F7 Sheer Cold into a full-HP Focus Sash holder", "sv", ohkoUser("Sheer Cold"), { ...lax(8), item: "Focus Sash", name: "Sash" });
ohko("F8 Sheer Cold into an Endure user holding a Sitrus Berry", "sv", ohkoUser("Sheer Cold"), { species: "Snorlax", ability: "Thick Fat", item: "Sitrus Berry", moves: ["Endure"], name: "Endurer" });
ohko("F9 Sheer Cold into a Substitute", "sv", ohkoUser("Sheer Cold"), { ...lax(8), name: "Subbed" }, (b) => { b.p2.active[0].addVolatile("substitute"); b.p2.active[0].volatiles.substitute.hp = 58; });
ohko("F10 Sheer Cold into an intact Disguise", "sv", ohkoUser("Sheer Cold"), { species: "Mimikyu", ability: "Disguise", moves: ["Splash"] });
ohko("F11 Sheer Cold into Wonder Guard (neutral: blocked)", "sv", ohkoUser("Sheer Cold"), { species: "Shedinja", ability: "Wonder Guard", moves: ["Splash"] });
ohko("F12 (swsh) Sheer Cold into a Dynamaxed target", "swsh", ohkoUser("Sheer Cold"), { species: "Snorlax", ability: "Thick Fat", moves: ["Tackle"], evs: { spe: 64 }, name: "Dyna" }, undefined, "move 1 2 dynamax, move 1");
ohko("F13 (usum) Guillotine at partial HP", "usum", ohkoUser("Guillotine", { species: "Kingler", ability: "Hyper Cutter" }), { ...lax(8), name: "Plain" }, (b) => { b.p2.active[0].sethp(77); });
ohko("F14 (swsh) Fissure into an Air Balloon holder", "swsh", ohkoUser("Fissure", { species: "Garchomp", ability: "Rough Skin" }), { ...lax(8), item: "Air Balloon", name: "Balloon" });
{
  const dex = Dex.forFormat("gen9championsdoublescustomgame");
  console.log(`\n(champions: ${["fissure", "guillotine", "horndrill", "sheercold"].map((id) => `${id} ${dex.moves.get(id).isNonstandard ?? "standard"}`).join(", ")})`);
  ohko("F15 (champions) Sheer Cold at partial HP", "champions", { species: "Vanilluxe", ability: "Ice Body", moves: ["Sheer Cold"], evs: { spe: 32 } }, { ...lax(8), name: "Plain" }, (b) => { b.p2.active[0].sethp(120); });
}

// ---------------------------------------------------------------------------------------------------------------------
// G. Spread heals (PS/sim/battle.ts:2165-2172 drain per target in spreadDamage; PS/data/items.ts:5646 Shell Bell)
// ---------------------------------------------------------------------------------------------------------------------
const sinistcha = (extra: Partial<Mon> = {}): Mon => ({ species: "Sinistcha", ability: "Hospitality", moves: ["Matcha Gotcha"], evs: { spa: 252, spe: 252 }, nature: "Modest", ...extra });
showTrace("G1 Matcha Gotcha: drain per target in hit order, one target with Liquid Ooze", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { b.p1.active[0].sethp(80); },
  mons: [sinistcha(), lax(4), { species: "Tentacruel", ability: "Liquid Ooze", moves: ["Splash"], name: "Ooze" }, { ...lax(12), name: "Plain" }],
}, LINES);
showTrace("G1b the same with the Liquid Ooze target second in hit order", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { b.p1.active[0].sethp(80); },
  mons: [sinistcha(), lax(4), { ...lax(8), name: "Plain" }, { species: "Tentacruel", ability: "Liquid Ooze", moves: ["Splash"], name: "Ooze" }],
}, LINES);
showTrace("G2 Matcha Gotcha with Big Root (each target's heal rounded on its own)", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { b.p1.active[0].sethp(40); },
  mons: [sinistcha({ item: "Big Root" }), lax(4), lax(8), lax(12)],
}, LINES);
showTrace("G3 Matcha Gotcha into a Rowap Berry holder: drains, then the Berry's damage, then the user's Sitrus at the Update", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { b.p1.active[0].sethp(76); },
  mons: [sinistcha({ item: "Sitrus Berry" }), lax(4), { ...lax(8), item: "Rowap Berry", name: "Rowap" }, lax(12)],
}, LINES);
showTrace("G4 Shell Bell on Rock Slide over two targets (one heal of totalDamage/8), one behind a Substitute", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { b.p1.active[0].sethp(60); b.p2.active[1].addVolatile("substitute"); b.p2.active[1].volatiles.substitute.hp = 40; },
  mons: [{ species: "Garchomp", ability: "Rough Skin", item: "Shell Bell", moves: ["Rock Slide"], evs: { atk: 252, spe: 252 } }, lax(4), lax(8), { ...lax(12), name: "Subbed" }],
}, LINES);
showTrace("G4b Shell Bell on Rock Slide over two targets, no Substitute", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { b.p1.active[0].sethp(60); },
  mons: [{ species: "Garchomp", ability: "Rough Skin", item: "Shell Bell", moves: ["Rock Slide"], evs: { atk: 252, spe: 252 } }, lax(4), lax(8), lax(12)],
}, LINES);
for (const [title, oozeFaster] of [["faster", true], ["slower", false]] as const) {
  showTrace(`G5 a heal-blocked drainer into Liquid Ooze (Ooze holder ${title}): TryHeal's handler order`, {
    game: "sv", turns: [["move 1 1, move 1 1", "move 1, move 1"]],
    mons: [{ species: "Venusaur", ability: "Overgrow", moves: ["Giga Drain"], evs: { spe: oozeFaster ? 0 : 252 }, name: "Drainer" }, { species: "Farigiraf", ability: "Armor Tail", moves: ["Psychic Noise"], evs: { spe: 4 } },
      { species: "Tentacruel", ability: "Liquid Ooze", moves: ["Splash"], evs: { spe: oozeFaster ? 252 : 0 }, name: "Ooze" }, lax(12)],
    setup: (b) => { b.p1.active[0].sethp(100); b.p1.active[0].addVolatile("healblock"); },
  }, LINES);
}
showTrace("G6 Matcha Gotcha knocking a target out: the drain reads the damage dealt (its HP)", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { b.p1.active[0].sethp(40); b.p2.active[0].sethp(10); },
  mons: [sinistcha(), lax(4), { ...lax(8), name: "Low" }, lax(12)],
}, LINES);
showTrace("G7 Parabolic Charge (allAdjacent: the ally too)", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { b.p1.active[0].sethp(40); },
  mons: [{ species: "Dedenne", ability: "Cheek Pouch", moves: ["Parabolic Charge"], evs: { spa: 252, spe: 252 } }, lax(4), lax(8), lax(12)],
}, LINES);

// ---------------------------------------------------------------------------------------------------------------------
// H. The Berserk / Anger Shell lock (PS/data/abilities.ts:414-444, :143-173; data/mods/champions/abilities.ts:2-13)
// ---------------------------------------------------------------------------------------------------------------------
const drampa = (extra: Partial<Mon> = {}): Mon => ({ species: "Drampa", ability: "Berserk", item: "Sitrus Berry", moves: ["Splash"], evs: { spe: 252 }, name: "Drampa", ...extra });
const confused = (hp: number) => (b: any) => { const d = b.p1.active[0]; d.sethp(hp); d.addVolatile("confusion"); d.volatiles.confusion.time = 5; };
showTrace("H1 a self-hit locks the Sitrus; a later single-hit Tackle: the Berry at that action's end (AfterMoveSecondary)", {
  game: "sv", turns: [["move 1, move 1", "move 1 1, move 1"]], setup: confused(85), force: ["confusion"],
  mons: [drampa(), lax(4), { species: "Snorlax", ability: "Thick Fat", moves: ["Tackle"], evs: { spe: 0 }, name: "Hitter" }, lax(12)],
}, LINES);
showTrace("H2 the same with a multi-hit Double Hit: the Berry between the hits (onDamage multihit resets the lock)", {
  game: "sv", turns: [["move 1, move 1", "move 1 1, move 1"]], setup: confused(85), force: ["confusion"],
  mons: [drampa(), lax(4), { species: "Snorlax", ability: "Thick Fat", moves: ["Double Hit"], evs: { spe: 0 }, name: "Hitter" }, lax(12)],
}, LINES);
showTrace("H3 the same with a status move (Growl) reaching it", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"]], setup: confused(85), force: ["confusion"],
  mons: [drampa(), lax(4), { species: "Snorlax", ability: "Thick Fat", moves: ["Growl"], evs: { spe: 0 }, name: "Growler" }, lax(12)],
}, LINES);
showTrace("H4b turn 2 with the Tackle chosen as move 2 (Drampa snaps out of confusion on turn 2)", {
  game: "sv", turns: [["move 2 1, move 1", "move 1, move 1"], ["move 2 1, move 1", "move 2 1, move 1"]], setup: (b) => { confused(85)(b); b.p1.active[0].volatiles.confusion.time = 2; }, force: ["confusion"],
  mons: [drampa({ moves: ["Splash", "Dragon Pulse"] }), lax(4), { species: "Snorlax", ability: "Thick Fat", moves: ["Splash", "Tackle"], evs: { spe: 0 }, name: "Hitter" }, lax(12)],
}, LINES);
showTrace("H5 (sv) a Sheer Force hit resets the lock at onDamage: the Berry at the hit's Update", {
  game: "sv", turns: [["move 1, move 1", "move 1 1, move 1"]], setup: confused(85), force: ["confusion"],
  mons: [drampa(), lax(4), { species: "Nidoking", ability: "Sheer Force", moves: ["Sludge Bomb"], nature: "Brave", ivs: { spe: 0 }, name: "SF" }, lax(12)],
}, LINES);
showTrace("H6 (champions) a Sheer Force hit on a Berserk holder (no confusion): Champions' onDamage drops the Sheer Force clause", {
  game: "champions", turns: [["move 1, move 1", "move 1 1, move 1"]], setup: (b) => { b.p1.active[0].sethp(85); },
  mons: [{ species: "Drampa", ability: "Berserk", item: "Sitrus Berry", moves: ["Splash"], evs: { spe: 32 }, name: "Drampa" }, lax(4), { species: "Feraligatr", ability: "Sheer Force", moves: ["Crunch"], name: "SF" }, lax(12)],
}, LINES);
showTrace("H6b (sv) the same Sheer Force hit (no confusion): the Berry at the hit's Update", {
  game: "sv", turns: [["move 1, move 1", "move 1 1, move 1"]], setup: (b) => { b.p1.active[0].sethp(85); },
  mons: [drampa(), lax(4), { species: "Feraligatr", ability: "Sheer Force", moves: ["Crunch"], name: "SF" }, lax(12)],
}, LINES);

// ---------------------------------------------------------------------------------------------------------------------
// I. Trace's copied curing ability (PS/data/abilities.ts:5118 trace, :2368 limber onUpdate)
// ---------------------------------------------------------------------------------------------------------------------
showTrace("I1 a paralysed Trace holder that copied Limber: cured at the turn's first Update", {
  game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { b.p1.active[0].setStatus("par", null, null, true); },
  mons: [{ species: "Gardevoir", ability: "Trace", moves: ["Psychic"], evs: { spe: 252 } }, lax(4), { species: "Persian", ability: "Limber", moves: ["Splash"] }, { species: "Persian", ability: "Limber", moves: ["Splash"], name: "Persian2" }],
}, /^\|(move|-activate|-curestatus|-ability|cant|-status)\|/);

// ---------------------------------------------------------------------------------------------------------------------
// J. A Ghost type's Curse cost (PS/data/moves.ts:3266 curse onHit directDamage)
// ---------------------------------------------------------------------------------------------------------------------
showTrace("J1 Ghost Curse at under half HP: the user faints", {
  game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { b.p1.active[0].sethp(60); },
  mons: [{ species: "Gengar", ability: "Cursed Body", moves: ["Curse"], evs: { spe: 252 } }, lax(4), lax(8), lax(12)],
}, /^\|(move|-start|-damage|faint)\|/);

// ---------------------------------------------------------------------------------------------------------------------
// K. Psychic Noise's Heal Block in later steps (PS/data/moves.ts:8274-8343 healblock condition)
// ---------------------------------------------------------------------------------------------------------------------
const noise: Mon = { species: "Farigiraf", ability: "Armor Tail", moves: ["Psychic Noise"], evs: { spe: 252 }, name: "Noise" };
showTrace("K1 Heal Block, then the target's own Giga Drain: no drain heal", {
  game: "sv", turns: [["move 1 1, move 1", "move 1 1, move 1"]], setup: (b) => { b.p2.active[0].sethp(80); },
  mons: [noise, lax(4), { species: "Venusaur", ability: "Overgrow", moves: ["Giga Drain"], name: "Drainer" }, lax(12)],
}, LINES);
showTrace("K2 Heal Block, then a later hit takes the Sitrus holder under half: the Berry stays", {
  game: "sv", turns: [["move 1 1, move 1 1", "move 1, move 1"]], setup: (b) => { b.p2.active[0].sethp(130); b.p2.active[0].addVolatile("healblock"); },
  mons: [noise, { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], name: "Chomp" }, { ...lax(8), item: "Sitrus Berry", name: "Holder" }, lax(12)],
}, LINES);
showTrace("K3 Heal Block, then an Electric move into its Volt Absorb: immune, no heal", {
  game: "sv", turns: [["move 1 1, move 1 1", "move 1, move 1"]], setup: (b) => { b.p2.active[0].sethp(80); b.p2.active[0].addVolatile("healblock"); },
  mons: [noise, { species: "Jolteon", ability: "Volt Absorb", moves: ["Thunderbolt"], name: "Bolt" }, { species: "Lanturn", ability: "Volt Absorb", moves: ["Splash"], name: "Absorber" }, lax(12)],
}, LINES);
showTrace("K4 Heal Block, then the target's own Shell Bell hit: no Shell Bell heal", {
  game: "sv", turns: [["move 1 1, move 1", "move 1 2, move 1"]], setup: (b) => { b.p2.active[0].sethp(80); b.p2.active[0].addVolatile("healblock"); },
  mons: [noise, lax(4), { species: "Garchomp", ability: "Rough Skin", item: "Shell Bell", moves: ["Dragon Claw"], name: "Bell" }, lax(12)],
}, LINES);
showTrace("K5 Heal Block, then its ally's Pollen Puff onto it", {
  game: "sv", turns: [["move 1 1, move 1", "move 1, move 1 -1"]], setup: (b) => { b.p2.active[0].sethp(80); b.p2.active[0].addVolatile("healblock"); },
  mons: [noise, lax(4), { ...lax(8), name: "Blocked" }, { species: "Ribombee", ability: "Shield Dust", moves: ["Pollen Puff"], name: "Puffer" }],
}, LINES);

// ---------------------------------------------------------------------------------------------------------------------
// L. The attacker's own Starf Berry at its move's Update (PS/data/items.ts:5985 starfberry: sample over the stats below +6)
// ---------------------------------------------------------------------------------------------------------------------
run("L1 Double-Edge recoil takes the attacker to its Starf Berry's line: one world per stat", {
  game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { b.p1.active[0].sethp(60); },
  mons: [{ species: "Tauros", ability: "Intimidate", item: "Starf Berry", moves: ["Double-Edge"], evs: { atk: 252, spe: 252 }, name: "Taur" }, lax(4), lax(8), lax(12)],
  inspect: (b) => `${b.p1.active[0].name} ${JSON.stringify(b.p1.active[0].boosts)} item ${b.p1.active[0].item || "-"}`,
}, { lines: false, hp: false });

// ---------------------------------------------------------------------------------------------------------------------
// M. White Herb at order 29 after Magic Room ends (27.6): accuracy and evasion too (PS/data/items.ts whiteherb)
// ---------------------------------------------------------------------------------------------------------------------
run("M1 White Herb at order 29 restores a lowered accuracy stage made under Magic Room", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"]],
  setup: (b) => { b.field.addPseudoWeather("magicroom", "debug"); b.field.pseudoWeather.magicroom.duration = 1; b.p1.active[0].boosts.accuracy = -1; },
  mons: [{ ...lax(4), item: "White Herb", name: "Herb" }, lax(6), lax(8), lax(12)],
  inspect: (b) => `${JSON.stringify(b.p1.active[0].boosts)} item ${b.p1.active[0].item || "-"} room ${!!b.field.pseudoWeather.magicroom}`,
}, { hp: false });
