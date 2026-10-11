// TIER 2 (moves phase) probes, part 2: volatile secondaries (Burning Jealousy, Alluring Voice, Spectral Thief, Core
// Enforcer), a spread move's effects on its user from two targets, a contact spread move into Spiky Shield, Cotton Down,
// Flower Veil and Pastel Veil, Aftermath and Innards Out, Battle Bond, Receiver and Power of Alchemy, and the Unnerve
// stand-ins, on pinned Showdown c23d2e94 through guards-sim.ts. Run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/status2/design/tier2-moves-probes-2.ts [ID ...] > scripts/.cache/calc-audit/status2/design/tier2-moves-probes-2.out
import { enumerate, monAt, report, showTrace, type Mon, type Probe } from "./guards-sim";

const only = process.argv.slice(2);
const want = (id: string) => !only.length || only.includes(id);
const boosts = (p: any) => {
  if (!p) return "-";
  const parts = Object.entries(p.boosts as Record<string, number>).filter(([, v]) => v).map(([k, v]) => `${k}${v > 0 ? "+" : ""}${v}`);
  return parts.length ? parts.join(" ") : "0";
};
const vols = (p: any) => Object.keys(p?.volatiles ?? {}).filter((v) => !["stall"].includes(v)).join(",") || "-";
const who = (b: any) => ["p1a", "p1b", "p2a", "p2b"].map((id) => {
  const p = monAt(b, id as any);
  return `${id}:${p?.name}(${p?.hp}/${p?.maxhp}${p?.status ? " " + p.status : ""}${p?.item ? " @" + p.item : ""} ${p?.ability}) ${boosts(p)} [${vols(p)}]`;
}).join(" | ");
const LINES = /^\|(move|cant|-miss|-heal|-damage|-boost|-unboost|-clearpositiveboost|-enditem|-item|-ability|-endability|-activate|-block|-fail|-immune|-start|-end|-status|-curestatus|-formechange|detailschange|-supereffective|-resisted|turn)\|/;
const lax = (n: number, name = `Lax${n}`): Mon => ({ species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], evs: { spe: n * 8 }, name });
const trace = (id: string, title: string, probe: Probe, keep: RegExp = LINES) => { if (want(id)) { showTrace(`${id} ${title}`, { ...probe }, keep); } };
const run = (id: string, title: string, probe: Probe) => { if (want(id)) report(`${id} ${title}`, enumerate({ lines: LINES, inspect: who, ...probe }), { lines: true }); };
const state = (id: string, title: string, probe: Probe) => { if (want(id)) report(`${id} ${title}`, enumerate({ inspect: who, ...probe }), { lines: false }); };

// ---- Burning Jealousy: 100% burn on a target whose stats rose this turn; the burn then halves its later physical attack ----
for (const game of ["sv", "swsh"] as const) {
  trace(`T2-VS01-${game}`, `${game}: Howl (its ally's Attack rises too) first; Torkoal's Burning Jealousy burns both; the burned foe's later Body Slam is halved; end of turn burn`, {
    game, turns: [["move 1, move 1", "move 1, move 1 1"]],
    mons: [{ species: "Torkoal", ability: "White Smoke", moves: ["Burning Jealousy"], evs: { spe: 32 }, name: "Tork" }, lax(1),
      { species: "Arcanine", ability: "Intimidate", moves: ["Howl"], evs: { spe: 252 }, name: "Arc" }, { species: "Snorlax", ability: "Thick Fat", moves: ["Body Slam"], evs: { spe: 0 }, ivs: { spe: 0 }, nature: "Brave", name: "Slammer" }],
  });
}
trace("T2-VS01c", "sv: control: no Howl (Splash); the same Burning Jealousy and Body Slam", {
  game: "sv", turns: [["move 1, move 1", "move 2, move 1 1"]],
  mons: [{ species: "Torkoal", ability: "White Smoke", moves: ["Burning Jealousy"], evs: { spe: 32 }, name: "Tork" }, lax(1),
    { species: "Arcanine", ability: "Intimidate", moves: ["Howl", "Splash"], evs: { spe: 252 }, name: "Arc" }, { species: "Snorlax", ability: "Thick Fat", moves: ["Body Slam"], evs: { spe: 0 }, ivs: { spe: 0 }, nature: "Brave", name: "Slammer" }],
});
// ---- Alluring Voice (sv, champions): 100% confusion when the target's stats rose this turn ----
run("T2-VS02", "sv: a foe's Howl raises both foes; Sylveon's Alluring Voice confuses the slower one; its later Body Slam (a third self-hit chance)", {
  game: "sv", turns: [["move 1 2, move 1", "move 1, move 1 1"]],
  mons: [{ species: "Sylveon", ability: "Cute Charm", moves: ["Alluring Voice"], evs: { spe: 32 }, name: "Syl" }, lax(1),
    { species: "Arcanine", ability: "Intimidate", moves: ["Howl"], evs: { spe: 252 }, name: "Arc" }, { species: "Snorlax", ability: "Thick Fat", moves: ["Body Slam"], evs: { spe: 0 }, ivs: { spe: 0 }, nature: "Brave", name: "Slammer" }],
});
// ---- Spectral Thief: the target's positive stages go to the user before the damage (boost(), then the target's set to 0) ----
trace("T2-VS03", "swsh: Marshadow's Spectral Thief into a +2 Attack Lucario (a Ghost hit), which then uses Close Combat", {
  game: "swsh", turns: [["move 1 1, move 1", "move 1 1, move 1"]],
  mons: [{ species: "Marshadow", ability: "Technician", moves: ["Spectral Thief"], evs: { spe: 252 }, name: "Shadow" }, lax(1),
    { species: "Lucario", ability: "Justified", moves: ["Close Combat"], name: "Luke" }, lax(2)],
  setup: (b) => { b.p2.active[0].boosts.atk = 2; b.p2.active[0].boosts.evasion = 1; },
});
trace("T2-VS03b", "usum: the same Spectral Thief through the target's Substitute (bypasssub) and a foe Opportunist? (gen 7: none) ; the target's later Close Combat", {
  game: "usum", turns: [["move 1 1, move 1", "move 1 1, move 1"]],
  mons: [{ species: "Marshadow", ability: "Technician", moves: ["Spectral Thief"], evs: { spe: 252 }, name: "Shadow" }, lax(1),
    { species: "Lucario", ability: "Justified", moves: ["Close Combat"], name: "Luke" }, lax(2)],
  setup: (b) => { b.p2.active[0].boosts.atk = 2; b.p2.active[0].addVolatile("substitute"); b.p2.active[0].volatiles.substitute.hp = 30; },
});
// ---- Core Enforcer: the gastroacid volatile on a target that has moved (not on one still to move); Levitate gone, a later Earthquake hits ----
trace("T2-VS04", "usum, Trick Room: Bronzong (Levitate) moves first; Zygarde's Core Enforcer suppresses it; Rotom-Wash still to move keeps Levitate; a later Earthquake hits Bronzong only", {
  game: "usum", turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { b.field.addPseudoWeather("trickroom", b.p1.active[0]); },
  mons: [{ species: "Zygarde", ability: "Aura Break", moves: ["Core Enforcer"], evs: { spe: 0 }, ivs: { spe: 0 }, nature: "Brave", name: "Zyg" }, { species: "Garchomp", ability: "Rough Skin", moves: ["Earthquake"], evs: { spe: 252 }, nature: "Jolly", name: "Chomp" },
    { species: "Bronzong", ability: "Levitate", moves: ["Splash"], evs: { spe: 0 }, ivs: { spe: 0 }, nature: "Brave", name: "Gong" }, { species: "Rotom-Wash", ability: "Levitate", moves: ["Splash"], evs: { spe: 252 }, nature: "Timid", name: "Rotom" }],
}, /^\|(move|cant|-damage|-endability|-immune|-start|-end|turn)\|/);
// ---- A spread move's effects on its user from two targets: a burn (first only), two Gooey drops (with Defiant) ----
trace("T2-SE01", "champions: Garchomp's Rock Slide into Scovillain-Mega (Spicy Spray) and Snorlax: one burn", {
  game: "champions", turns: [["move 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Garchomp", ability: "Rough Skin", moves: ["Rock Slide"], evs: { spe: 32 }, name: "Chomp" }, lax(1),
    { species: "Scovillain-Mega", ability: "Spicy Spray", moves: ["Splash"], name: "Scov" }, lax(2)],
});
trace("T2-SE02", "champions: Kingambit (Defiant) Breaking Swipe (contact) into Goodra and Hisuian Goodra (Gooey): Spe −1 twice, Defiant +2 twice; Kingambit's later move", {
  game: "champions", turns: [["move 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Kingambit", ability: "Defiant", moves: ["Breaking Swipe"], evs: { spe: 32 }, name: "King" }, lax(1),
    { species: "Goodra", ability: "Gooey", moves: ["Splash"], name: "Goo" }, { species: "Goodra-Hisui", ability: "Gooey", moves: ["Splash"], name: "Hgoo" }],
});
trace("T2-SE03", "champions: Kingambit at Spe −6 Breaking Swipe into two Gooey Goodra: each drop fails, Defiant does not rise", {
  game: "champions", turns: [["move 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Kingambit", ability: "Defiant", moves: ["Breaking Swipe"], evs: { spe: 32 }, name: "King" }, lax(1),
    { species: "Goodra", ability: "Gooey", moves: ["Splash"], name: "Goo" }, { species: "Goodra-Hisui", ability: "Gooey", moves: ["Splash"], name: "Hgoo" }],
  setup: (b) => { b.p1.active[0].boosts.spe = -6; },
});
trace("T2-SE04", "sv: a White Herb Kingambit's Breaking Swipe into two Gooey Goodra: both drops, then White Herb restores at the Update after the hits", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Kingambit", ability: "Pressure", item: "White Herb", moves: ["Breaking Swipe"], evs: { spe: 32 }, name: "King" }, lax(1),
    { species: "Goodra", ability: "Gooey", moves: ["Splash"], name: "Goo" }, { species: "Goodra-Hisui", ability: "Gooey", moves: ["Splash"], name: "Hgoo" }],
});
// ---- A contact spread move into Spiky Shield: the user faints to the shield, its other target is still hit ----
trace("T2-SCK01", "champions: Garchomp at 20 HP Breaking Swipe into a Spiky Shield Chesnaught and a Snorlax: Garchomp faints to the shield before the hits", {
  game: "champions", turns: [["move 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Garchomp", ability: "Sand Veil", moves: ["Breaking Swipe"], evs: { spe: 32 }, name: "Chomp" }, lax(1),
    { species: "Chesnaught", ability: "Bulletproof", moves: ["Spiky Shield"], evs: { spe: 252 }, name: "Ches" }, lax(2)],
  setup: (b) => { b.p1.active[0].sethp(20); },
});
// ---- Cotton Down (swsh): each damaging hit lowers the Speed of every other active Pokémon, in position order ----
trace("T2-CD01", "swsh: Garchomp's Dual Chop? Dragon Claw into Eldegoss (Cotton Down): Spe −1 on Garchomp, its ally and Eldegoss's ally; a Mirror Armor Corviknight reflects", {
  game: "swsh", turns: [["move 1 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], evs: { spe: 252 }, name: "Chomp" }, { species: "Corviknight", ability: "Mirror Armor", moves: ["Splash"], name: "Corv" },
    { species: "Eldegoss", ability: "Cotton Down", moves: ["Splash"], name: "Goss" }, lax(2)],
});
trace("T2-CD02", "swsh: a two-hit Dual Wingbeat into Eldegoss: two rounds of drops; its Defiant ally Bisharp +2 Atk twice", {
  game: "swsh", turns: [["move 1 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Dragonite", ability: "Inner Focus", moves: ["Dual Wingbeat"], evs: { spe: 252 }, name: "Nite" }, { species: "Bisharp", ability: "Defiant", moves: ["Splash"], name: "Shar" },
    { species: "Eldegoss", ability: "Cotton Down", moves: ["Splash"], name: "Goss" }, lax(2)],
});
// ---- Flower Veil and Pastel Veil keep a foe's damaging move's secondary drop or status off their side ----
trace("T2-FV01", "sv: Snarl (100% SpA −1) into a Grass Comfey? no: into Flower Veil Comfey's Grass ally Venusaur and Comfey itself", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Incineroar", ability: "Blaze", moves: ["Snarl"], evs: { spe: 252 }, name: "Roar" }, lax(1),
    { species: "Comfey", ability: "Flower Veil", moves: ["Splash"], name: "Comf" }, { species: "Venusaur", ability: "Overgrow", moves: ["Splash"], name: "Saur" }],
});
trace("T2-FV02", "sv: a Mold Breaker Excadrill's Rock Tomb? no: Bulldoze (100% Spe −1, spread) into Flower Veil's Grass side: Mold Breaker passes the veil", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Excadrill", ability: "Mold Breaker", moves: ["Bulldoze"], evs: { spe: 252 }, name: "Drill" }, { species: "Snorlax", ability: "Thick Fat", moves: ["Protect"], name: "Lax" },
    { species: "Comfey", ability: "Flower Veil", moves: ["Splash"], name: "Comf" }, { species: "Venusaur", ability: "Overgrow", moves: ["Splash"], name: "Saur" }],
});
trace("T2-FV03", "swsh: Pastel Veil Galarian Ponyta's ally hit by a 100% poison move (Poison Fang? no: Toxic Spikes? : use Mortal Spin is sv) — swsh: Nidoking's Poison Jab forced? (Barb Barrage absent): Pastel Veil with a Sludge Bomb forced 30% poison", {
  game: "swsh", turns: [["move 1 2, move 1", "move 1, move 1"]], force: ["psn"],
  mons: [{ species: "Nidoking", ability: "Poison Point", moves: ["Sludge Bomb"], evs: { spe: 252 }, name: "King" }, lax(1),
    { species: "Ponyta-Galar", ability: "Pastel Veil", moves: ["Splash"], name: "Pony" }, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], name: "Ally" }],
});
// ---- Aftermath (a contact knockout: a quarter of the attacker's maximum HP, inside the hit) and Innards Out (the HP the holder had) ----
trace("T2-AF01", "sv: Garchomp at full HP with Sitrus Berry: Dragon Claw knocks out a 1 HP Drifblim (Aftermath); a quarter, Sitrus at the hit's Update; then Life Orb? (no item swap: Sitrus)", {
  game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Garchomp", ability: "Rough Skin", item: "Sitrus Berry", moves: ["Dragon Claw"], evs: { spe: 252 }, name: "Chomp" }, lax(1),
    { species: "Drifblim", ability: "Aftermath", moves: ["Splash"], name: "Blim" }, lax(2)],
  setup: (b) => { b.p2.active[0].sethp(1); b.p1.active[0].sethp(110); },
});
trace("T2-AF02", "sv: the same knockout with a Damp Politoed? (sv: Damp Bellibolt) on the field: no Aftermath", {
  game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Garchomp", ability: "Rough Skin", item: "Sitrus Berry", moves: ["Dragon Claw"], evs: { spe: 252 }, name: "Chomp" }, lax(1),
    { species: "Drifblim", ability: "Aftermath", moves: ["Splash"], name: "Blim" }, { species: "Bellibolt", ability: "Damp", moves: ["Splash"], name: "Damp" }],
  setup: (b) => { b.p2.active[0].sethp(1); b.p1.active[0].sethp(110); },
});
trace("T2-AF03", "sv: Flare Blitz (recoil) knocks out a 30 HP Electrode (Aftermath): Aftermath before the recoil", {
  game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Arcanine", ability: "Intimidate", moves: ["Flare Blitz"], evs: { spe: 252 }, name: "Arc" }, lax(1),
    { species: "Electrode", ability: "Aftermath", moves: ["Splash"], name: "Bolt" }, lax(2)],
  setup: (b) => { b.p2.active[0].sethp(30); },
});
trace("T2-IO01", "swsh: Garchomp's Dual Chop? Dragon Claw knocks out Pyukumuku at 40 HP (Innards Out: 40 to Garchomp)", {
  game: "swsh", turns: [["move 1 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], evs: { spe: 252 }, name: "Chomp" }, lax(1),
    { species: "Pyukumuku", ability: "Innards Out", moves: ["Splash"], name: "Pyuk" }, lax(2)],
  setup: (b) => { b.p2.active[0].sethp(40); },
});
trace("T2-IO02", "swsh: a two-hit Dual Wingbeat knocks out Pyukumuku at 60 HP on the second hit: Innards Out deals the HP it had at the move's start (60)", {
  game: "swsh", turns: [["move 1 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Dragonite", ability: "Inner Focus", moves: ["Dual Wingbeat"], evs: { spe: 252 }, name: "Nite" }, lax(1),
    { species: "Pyukumuku", ability: "Innards Out", moves: ["Splash"], name: "Pyuk" }, lax(2)],
  setup: (b) => { b.p2.active[0].sethp(45); },
});
trace("T2-IO03", "champions: Rock Slide knocks out Victreebel-Mega (Innards Out) at 30 HP and hits its ally: 30 to the attacker", {
  game: "champions", turns: [["move 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Garchomp", ability: "Rough Skin", moves: ["Rock Slide"], evs: { spe: 32 }, name: "Chomp" }, lax(1),
    { species: "Victreebel-Mega", ability: "Innards Out", moves: ["Splash"], name: "Bell" }, lax(2)],
  setup: (b) => { b.p2.active[0].sethp(30); },
});
// ---- Battle Bond: gen 9 a +1 Atk, SpA, Spe boost once; gen 7 the Ash form ----
trace("T2-BB01", "sv: Greninja-Bond's Dark Pulse knocks out a foe; then its ally's later move (bondTriggered once)", {
  game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Greninja-Bond", ability: "Battle Bond", moves: ["Dark Pulse"], evs: { spe: 252 }, name: "Gren" }, lax(1),
    { species: "Alakazam", ability: "Inner Focus", moves: ["Splash"], name: "Zam" }, lax(2)],
  setup: (b) => { b.p2.active[0].sethp(1); },
});
trace("T2-BB02", "usum: Greninja-Bond knocks out a foe: Ash form (stats); its later Water Shuriken? (next turn) — the form and a later hit into it", {
  game: "usum", turns: [["move 1 1, move 1", "move 1, move 1 1"]],
  mons: [{ species: "Greninja-Bond", ability: "Battle Bond", moves: ["Dark Pulse"], evs: { spe: 252 }, name: "Gren" }, lax(1),
    { species: "Alakazam", ability: "Inner Focus", moves: ["Splash"], name: "Zam" }, { species: "Snorlax", ability: "Thick Fat", moves: ["Body Slam"], name: "Slammer" }],
  setup: (b) => { b.p2.active[0].sethp(1); },
}, /^\|(move|-damage|-activate|-formechange|detailschange|turn)\|/);
trace("T2-BB03", "sv: Greninja-Bond knocks out the foe side's last Pokémon on the field with no bench: no boost (foePokemonLeft 0)", {
  game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Greninja-Bond", ability: "Battle Bond", moves: ["Dark Pulse"], evs: { spe: 252 }, name: "Gren" }, lax(1),
    { species: "Alakazam", ability: "Inner Focus", moves: ["Splash"], name: "Zam" }, lax(2)],
  bench: { p2: [] },
  setup: (b) => { b.p2.active[0].sethp(1); b.p2.active[1].faint(); b.p2.active[1].hp = 0; },
});
// ---- Receiver and Power of Alchemy: the fainted ally's ability (setAbility), its Start runs ----
trace("T2-RC01", "sv: Passimian (Receiver) beside Incineroar (Intimidate) at 1 HP; a foe knocks Incineroar out; Passimian gets Intimidate, which acts", {
  game: "sv", turns: [["move 1, move 1", "move 1 1, move 1"]],
  mons: [{ species: "Incineroar", ability: "Intimidate", moves: ["Splash"], name: "Roar" }, { species: "Passimian", ability: "Receiver", moves: ["Splash"], name: "Pass" },
    { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], evs: { spe: 252 }, name: "Chomp" }, lax(2)],
  setup: (b) => { b.p1.active[0].sethp(1); },
});
trace("T2-RC02", "usum: Alolan Muk (Power of Alchemy) beside a 1 HP Mimikyu (Disguise: noreceiver)? use Levitate Gengar? (usum Gengar Levitate) knocked out: Muk gets Levitate; a later Earthquake", {
  game: "usum", turns: [["move 1, move 1", "move 1 1, move 1"]],
  mons: [{ species: "Gengar", ability: "Levitate", moves: ["Splash"], name: "Gar" }, { species: "Muk-Alola", ability: "Power of Alchemy", moves: ["Splash"], name: "Muk" },
    { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw", "Earthquake"], evs: { spe: 252 }, name: "Chomp" }, { species: "Excadrill", ability: "Sand Rush", moves: ["Earthquake"], evs: { spe: 0 }, name: "Drill" }],
  setup: (b) => { b.p1.active[0].sethp(1); },
}, /^\|(move|-damage|-ability|-immune|-unboost|-activate|faint|turn)\|/);
// ---- Unnerve stand-ins: a third Pokémon's Unnerve stops the target's resist Berry; the attacker's own Unnerve does not stop its ally's ----
trace("T2-UN01", "sv: Tyranitar (Unnerve) beside Garchomp; Garchomp's Dragon Claw into a Haban Berry Dragonite: no Berry (a third Pokémon's Unnerve)", {
  game: "sv", turns: [["move 1, move 1 1", "move 1, move 1"]],
  mons: [{ species: "Tyranitar", ability: "Unnerve", moves: ["Splash"], name: "Tar" }, { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], evs: { spe: 252 }, name: "Chomp" },
    { species: "Dragonite", ability: "Inner Focus", item: "Haban Berry", moves: ["Splash"], name: "Nite" }, lax(2)],
});
trace("T2-UN01c", "sv: control: Garchomp's Dragon Claw into the Haban Berry Dragonite with no Unnerve on the field", {
  game: "sv", turns: [["move 1, move 1 1", "move 1, move 1"]],
  mons: [{ species: "Tyranitar", ability: "Sand Stream", moves: ["Splash"], name: "Tar" }, { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], evs: { spe: 252 }, name: "Chomp" },
    { species: "Dragonite", ability: "Inner Focus", item: "Haban Berry", moves: ["Splash"], name: "Nite" }, lax(2)],
});
trace("T2-UN02", "sv: Tyranitar (Unnerve)'s Earthquake hits its Shuca Berry ally Magnezone? (Ground into Steel/Electric 4x): its own Unnerve does not stop its ally's Berry", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Tyranitar", ability: "Unnerve", moves: ["Earthquake"], evs: { spe: 252 }, name: "Tar" }, { species: "Magnezone", ability: "Sturdy", item: "Shuca Berry", moves: ["Splash"], name: "Zone" }, lax(4), lax(8)],
});
trace("T2-UN03", "sv: Arcanine (Sitrus at 90/166?) Flare Blitz knocks out a 1 HP Tyranitar (Unnerve): the hit's Update (Unnerve gone) before the recoil", {
  game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Arcanine", ability: "Intimidate", item: "Sitrus Berry", moves: ["Flare Blitz"], evs: { spe: 252 }, name: "Arc" }, lax(1),
    { species: "Tyranitar", ability: "Unnerve", item: "Rocky Helmet", moves: ["Splash"], name: "Tar" }, lax(2)],
  setup: (b) => { b.p2.active[0].sethp(5); b.p1.active[0].sethp(100); },
});
