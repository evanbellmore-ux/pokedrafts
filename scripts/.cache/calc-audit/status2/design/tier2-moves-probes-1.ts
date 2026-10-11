// TIER 2 (moves phase) probes, part 1: the semi-invulnerable family (Fly, Dig, Dive, Bounce, Phantom Force, Shadow
// Force) against later moves, and crash damage (High Jump Kick and its kin), on pinned Showdown c23d2e94 through the
// guards harness (guards-sim.ts: exact enumeration, every move hits but a semi-invulnerability miss, no critical hit,
// added effects below 100% fail, damage rolls fixed at the lowest unless enumerated). Run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/status2/design/tier2-moves-probes-1.ts [ID ...] > scripts/.cache/calc-audit/status2/design/tier2-moves-probes-1.out
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
  return `${id}:${p?.name}(${p?.hp}/${p?.maxhp}${p?.status ? " " + p.status : ""}) ${boosts(p)} [${vols(p)}]`;
}).join(" | ");
const LINES = /^\|(move|cant|-miss|-heal|-damage|-boost|-unboost|-enditem|-activate|-fail|-immune|-start|-end|-fieldstart|-status|-prepare|-supereffective|-resisted|turn)\|/;
const lax = (n: number, name = `Lax${n}`): Mon => ({ species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], evs: { spe: n * 8 }, name });
const trace = (id: string, title: string, probe: Probe, keep: RegExp = LINES) => { if (want(id)) showTrace(`${id} ${title}`, probe, keep); };
const run = (id: string, title: string, probe: Probe) => { if (want(id)) report(`${id} ${title}`, enumerate({ lines: LINES, inspect: who, ...probe }), { lines: true }); };

// ---- Dig: Earthquake and Magnitude hit it with 2x (onSourceModifyDamage), everything else misses ----
trace("T2-SI01", "sv: Garchomp Dig; its ally Excadrill's Earthquake (allAdjacent) then hits it underground at 2x, the foes at the spread 0.75", {
  game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Garchomp", ability: "Rough Skin", moves: ["Dig"], evs: { spe: 252 }, nature: "Jolly", name: "Chomp" },
    { species: "Excadrill", ability: "Mold Breaker", moves: ["Earthquake"], evs: { atk: 252, spe: 100 }, name: "Drill" }, lax(4), lax(8)],
});
trace("T2-SI01c", "sv: control: Garchomp Splash; the same Earthquake", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Garchomp", ability: "Rough Skin", moves: ["Splash"], evs: { spe: 252 }, nature: "Jolly", name: "Chomp" },
    { species: "Excadrill", ability: "Mold Breaker", moves: ["Earthquake"], evs: { atk: 252, spe: 100 }, name: "Drill" }, lax(4), lax(8)],
});
trace("T2-SI02", "sv: Garchomp Dig; a foe's Body Slam at it misses; the other foe's Earthquake (spread) hits it at 2x and the others at 0.75", {
  game: "sv", turns: [["move 1 1, move 1", "move 1 1, move 1"]],
  mons: [{ species: "Garchomp", ability: "Rough Skin", moves: ["Dig"], evs: { spe: 252 }, name: "Chomp" }, lax(1),
    { species: "Snorlax", ability: "Thick Fat", moves: ["Body Slam"], evs: { spe: 16 }, name: "Slammer" },
    { species: "Hippowdon", ability: "Sand Force", moves: ["Earthquake"], evs: { spe: 0 }, name: "Hippo" }],
});
trace("T2-SI02b", "sv: Garchomp Dig; a foe's Thunderbolt at it misses", {
  game: "sv", turns: [["move 1 1, move 1", "move 1 1, move 1"]],
  mons: [{ species: "Garchomp", ability: "Rough Skin", moves: ["Dig"], evs: { spe: 252 }, name: "Chomp" }, lax(1),
    { species: "Raichu", ability: "Static", moves: ["Thunderbolt"], evs: { spe: 0 }, name: "Rai" }, lax(2)],
});

// ---- Fly: Hurricane, Thunder, Smack Down hit (no 2x); Gust and Twister 2x (onSourceModifyDamage); spread moves miss it ----
trace("T2-SI03", "sv: Dragonite Fly; a foe's Hurricane at it hits; the other foe's Gust at it hits at 2x", {
  game: "sv", turns: [["move 1 1, move 1", "move 1 1, move 1 1"]],
  mons: [{ species: "Dragonite", ability: "Inner Focus", moves: ["Fly"], evs: { spe: 252 }, name: "Nite" }, lax(1),
    { species: "Pelipper", ability: "Keen Eye", moves: ["Hurricane"], name: "Peli" }, { species: "Pidgeot", ability: "Keen Eye", moves: ["Gust"], evs: { spe: 0 }, name: "Pidge" }],
});
trace("T2-SI03c", "sv: control: Dragonite Splash; the same Hurricane and Gust", {
  game: "sv", turns: [["move 1, move 1", "move 1 1, move 1 1"]],
  mons: [{ species: "Dragonite", ability: "Inner Focus", moves: ["Splash"], evs: { spe: 252 }, name: "Nite" }, lax(1),
    { species: "Pelipper", ability: "Keen Eye", moves: ["Hurricane"], name: "Peli" }, { species: "Pidgeot", ability: "Keen Eye", moves: ["Gust"], evs: { spe: 0 }, name: "Pidge" }],
});
trace("T2-SI04", "champions: Dragonite Fly; a foe's Rock Slide (allAdjacentFoes) misses it, hits its ally with the spread modifier", {
  game: "champions", turns: [["move 1 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Dragonite", ability: "Inner Focus", moves: ["Fly"], evs: { spe: 32 }, name: "Nite" }, lax(1),
    { species: "Tyranitar", ability: "Unnerve", moves: ["Rock Slide"], name: "Tar" }, lax(2)],
});
trace("T2-SI04c", "champions: control: Dragonite Splash; the same Rock Slide", {
  game: "champions", turns: [["move 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Dragonite", ability: "Inner Focus", moves: ["Splash"], evs: { spe: 32 }, name: "Nite" }, lax(1),
    { species: "Tyranitar", ability: "Unnerve", moves: ["Rock Slide"], name: "Tar" }, lax(2)],
});
trace("T2-SI04d", "champions: Dragonite Fly; a foe's Thunder at it hits, Smack Down at it hits and grounds it; then a slower Earthquake hits it", {
  game: "champions", turns: [["move 1 1, move 1", "move 1 1, move 1"]],
  mons: [{ species: "Dragonite", ability: "Inner Focus", moves: ["Fly"], evs: { spe: 32 }, name: "Nite" }, lax(1),
    { species: "Tyranitar", ability: "Unnerve", moves: ["Smack Down"], evs: { spe: 8 }, name: "Tar" },
    { species: "Garchomp", ability: "Rough Skin", moves: ["Earthquake"], evs: { spe: 0 }, nature: "Brave", ivs: { spe: 0 }, name: "Chomp" }],
});
// ---- Bounce: Gust and Twister through onSourceBasePower (power 2x); Phantom Force: nothing hits it ----
trace("T2-SI05", "swsh: Lopunny Bounce; a foe's Gust at it (power 2x), the other's Twister at it", {
  game: "swsh", turns: [["move 1 1, move 1", "move 1 1, move 1"]],
  mons: [{ species: "Lopunny", ability: "Limber", moves: ["Bounce"], evs: { spe: 252 }, name: "Bun" }, lax(1),
    { species: "Pidgeot", ability: "Keen Eye", moves: ["Gust"], name: "Pidge" }, { species: "Dragonite", ability: "Inner Focus", moves: ["Twister"], evs: { spe: 0 }, name: "Nite" }],
});
trace("T2-SI05c", "swsh: control: Lopunny Splash; the same Gust and Twister", {
  game: "swsh", turns: [["move 1, move 1", "move 1 1, move 1"]],
  mons: [{ species: "Lopunny", ability: "Limber", moves: ["Splash"], evs: { spe: 252 }, name: "Bun" }, lax(1),
    { species: "Pidgeot", ability: "Keen Eye", moves: ["Gust"], name: "Pidge" }, { species: "Dragonite", ability: "Inner Focus", moves: ["Twister"], evs: { spe: 0 }, name: "Nite" }],
});
trace("T2-SI06", "usum: Kingdra Dive; a foe's Surf (allAdjacent) hits it at 2x, its ally and the foe's own ally at 0.75", {
  game: "usum", turns: [["move 1 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Kingdra", ability: "Sniper", moves: ["Dive"], evs: { spe: 252 }, name: "King" }, lax(1),
    { species: "Starmie", ability: "Natural Cure", moves: ["Surf"], evs: { spe: 0 }, name: "Star" }, lax(2)],
});
trace("T2-SI06c", "usum: control: Kingdra Splash; the same Surf", {
  game: "usum", turns: [["move 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Kingdra", ability: "Sniper", moves: ["Splash"], evs: { spe: 252 }, name: "King" }, lax(1),
    { species: "Starmie", ability: "Natural Cure", moves: ["Surf"], evs: { spe: 0 }, name: "Star" }, lax(2)],
});
trace("T2-SI07", "sv: Dragapult Phantom Force; a foe's Earthquake misses it; a No Guard Machamp's Close Combat at it hits", {
  game: "sv", turns: [["move 1 1, move 1", "move 1, move 1 1"]],
  mons: [{ species: "Dragapult", ability: "Clear Body", moves: ["Phantom Force"], evs: { spe: 252 }, name: "Pult" }, lax(1),
    { species: "Garchomp", ability: "Rough Skin", moves: ["Earthquake"], evs: { spe: 0 }, name: "Chomp" }, { species: "Machamp", ability: "No Guard", moves: ["Knock Off"], evs: { spe: 0 }, name: "Champ" }],
});
// ---- Toxic from a Poison type hits a semi-invulnerable target (gen 8+: hitStepInvulnerabilityEvent; gen 7: the toxic volatile's onSourceInvulnerability 0) ----
for (const game of ["sv", "usum"] as const) {
  trace(`T2-SI08-${game}`, `${game}: Dragonite Fly; a Poison-type Toxapex's Toxic at it, then a Snorlax's Toxic at it`, {
    game, turns: [["move 1 1, move 1", "move 1 1, move 1 1"]],
    mons: [{ species: "Dragonite", ability: "Inner Focus", moves: ["Fly"], evs: { spe: 252 }, name: "Nite" }, lax(1),
      { species: "Toxapex", ability: "Limber", moves: ["Toxic"], name: "Pex" }, { species: "Snorlax", ability: "Thick Fat", moves: ["Toxic"], name: "Lax" }],
  });
}
// ---- Gravity brings a Fly or Bounce user down (gravity onFieldStart: removeVolatile fly / bounce, cancelMove) ----
trace("T2-SI09", "sv: Dragonite Fly; a foe's Gravity; then a slower foe's Thunderbolt at it hits", {
  game: "sv", turns: [["move 1 1, move 1", "move 1, move 1 1"]],
  mons: [{ species: "Dragonite", ability: "Inner Focus", moves: ["Fly"], evs: { spe: 252 }, name: "Nite" }, lax(1),
    { species: "Bronzong", ability: "Levitate", moves: ["Gravity"], evs: { spe: 0 }, name: "Gong" }, { species: "Snorlax", ability: "Thick Fat", moves: ["Thunderbolt"], evs: { spe: 0 }, ivs: { spe: 0 }, nature: "Brave", name: "Slow" }],
}, /^\|(move|-miss|-damage|-fieldstart|-end|-activate|cant)\|/);
// ---- Crash damage: High Jump Kick and its kin into a semi-invulnerable target, into Protect, into an immune target ----
trace("T2-CR01", "sv: Dragonite Fly; a foe's High Jump Kick at it misses and crashes (half its maximum HP)", {
  game: "sv", turns: [["move 1 1, move 1", "move 1 1, move 1"]],
  mons: [{ species: "Dragonite", ability: "Inner Focus", moves: ["Fly"], evs: { spe: 252 }, name: "Nite" }, lax(1),
    { species: "Hitmonlee", ability: "Limber", moves: ["High Jump Kick"], name: "Lee" }, lax(2)],
}, /^\|(move|-miss|-damage|-activate|cant)\|/);
trace("T2-CR02", "sv: a foe uses Protect; High Jump Kick at it crashes", {
  game: "sv", turns: [["move 1, move 1", "move 1 1, move 1"]],
  mons: [{ species: "Dragonite", ability: "Inner Focus", moves: ["Protect"], evs: { spe: 252 }, name: "Nite" }, lax(1),
    { species: "Hitmonlee", ability: "Limber", moves: ["High Jump Kick"], name: "Lee" }, lax(2)],
}, /^\|(move|-miss|-damage|-activate|-immune|cant)\|/);
trace("T2-CR03", "sv: High Jump Kick at a Ghost type (immune) crashes; Supercell Slam at a protected one crashes too", {
  game: "sv", turns: [["move 1, move 1", "move 1 1, move 1 2"]],
  mons: [{ species: "Gengar", ability: "Cursed Body", moves: ["Splash"], evs: { spe: 252 }, name: "Ghost" }, { species: "Dragonite", ability: "Inner Focus", moves: ["Protect"], evs: { spe: 252 }, name: "Nite" },
    { species: "Hitmonlee", ability: "Limber", moves: ["High Jump Kick"], name: "Lee" }, { species: "Electrode", ability: "Static", moves: ["Supercell Slam"], name: "Ball" }],
}, /^\|(move|-miss|-damage|-activate|-immune|cant)\|/);
trace("T2-CR04", "usum: Jump Kick at a Ghost type crashes (gen 7)", {
  game: "usum", turns: [["move 1, move 1", "move 1 1, move 1"]],
  mons: [{ species: "Gengar", ability: "Levitate", moves: ["Splash"], evs: { spe: 252 }, name: "Ghost" }, lax(1),
    { species: "Hitmonlee", ability: "Limber", moves: ["Jump Kick"], name: "Lee" }, lax(2)],
}, /^\|(move|-miss|-damage|-activate|-immune|cant)\|/);
trace("T2-CR05", "champions: High Jump Kick into Protect crashes; Magic Guard keeps it off", {
  game: "champions", turns: [["move 1, move 1", "move 1 1, move 1 2"]],
  mons: [{ species: "Dragonite", ability: "Inner Focus", moves: ["Protect"], evs: { spe: 252 }, name: "Nite" }, { species: "Garchomp", ability: "Rough Skin", moves: ["Protect"], evs: { spe: 252 }, name: "Chomp" },
    { species: "Hitmonlee", ability: "Limber", moves: ["High Jump Kick"], name: "Lee" }, { species: "Clefable", ability: "Magic Guard", moves: ["High Jump Kick"], name: "Fable" }],
}, /^\|(move|-miss|-damage|-activate|-immune|cant)\|/);
// ---- Redirection comes before the semi-invulnerability check: Lightning Rod takes a move into its hidden holder, which then misses ----
trace("T2-SI10", "usum: Alolan Marowak (Lightning Rod) Dig; a foe's Thunderbolt at its ally is redirected to it and misses (no Sp. Atk rise)", {
  game: "usum", turns: [["move 1 1, move 1", "move 1 2, move 1"]],
  mons: [{ species: "Marowak-Alola", ability: "Lightning Rod", moves: ["Dig"], evs: { spe: 252 }, nature: "Jolly", name: "Wak" }, lax(1),
    { species: "Snorlax", ability: "Thick Fat", moves: ["Thunderbolt"], name: "Slow" }, lax(2)],
}, /^\|(move|-miss|-damage|-activate|-immune|-boost|cant)\|/);
// ---- Status moves at a semi-invulnerable target miss; a spread status move misses it only ----
trace("T2-SI11", "sv: Dragonite Fly; a foe's Thunder Wave at it misses; the other foe's Growl misses it and lowers its ally", {
  game: "sv", turns: [["move 1 1, move 1", "move 1 1, move 1"]],
  mons: [{ species: "Dragonite", ability: "Inner Focus", moves: ["Fly"], evs: { spe: 252 }, name: "Nite" }, lax(1),
    { species: "Raichu", ability: "Static", moves: ["Thunder Wave"], name: "Rai" }, { species: "Snorlax", ability: "Thick Fat", moves: ["Growl"], name: "Lax" }],
}, /^\|(move|-miss|-damage|-unboost|-status|-fail|-immune|cant)\|/);
trace("T2-SI11b", "sv: Dragonite Fly; its ally's Pollen Puff at it misses; a foe's Haze (field) clears its stages; a foe's Perish Song reaches it", {
  game: "sv", turns: [["move 1 1, move 1 -1", "move 1, move 1"]],
  mons: [{ species: "Dragonite", ability: "Inner Focus", moves: ["Fly"], evs: { spe: 252 }, nature: "Jolly", name: "Nite" }, { species: "Snorlax", ability: "Thick Fat", moves: ["Pollen Puff"], name: "Bee" },
    { species: "Snorlax", ability: "Thick Fat", moves: ["Haze"], evs: { spe: 8 }, name: "Weez" }, { species: "Snorlax", ability: "Thick Fat", moves: ["Perish Song"], evs: { spe: 4 }, name: "Toed" }],
  setup: (b) => { b.p1.active[0].boosts.atk = 2; b.p1.active[0].sethp(100); },
}, /^\|(move|-miss|-damage|-heal|-clearallboost|-start|-fail|-immune|cant)\|/);
// ---- The release turn: a Fly user from last turn is hidden until it moves; a full paralysis keeps it hidden to the end of the turn ----
if (false) run("T2-SI12", "champions: turn 1 a slow paralysed Dragonite uses Fly; turn 2 a faster foe's Thunderbolt at it, then its release (full paralysis 1/8 keeps it up), then a slower foe's Body Slam at it", {
  game: "champions", turns: [["move 1 1, move 1", "move 1, move 1"], ["move 1, move 1", "move 1 1, move 1 1"]],
  mons: [{ species: "Dragonite", ability: "Inner Focus", moves: ["Fly"], evs: { spe: 0 }, name: "Nite" }, lax(1),
    { species: "Raichu", ability: "Static", moves: ["Thunderbolt"], evs: { spe: 32 }, name: "Rai" }, { species: "Snorlax", ability: "Thick Fat", moves: ["Body Slam"], evs: { spe: 0 }, name: "Slammer" }],
  setup: (b) => { b.p1.active[0].setStatus("par"); },
});
trace("T2-SI13", "sv: Garchomp Dig; Helping Hand from its ally at it after it moved (fails: it moved); an Earthquake from its ally hits it at 2x in Sandstorm (no sand damage underground)", {
  game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Garchomp", ability: "Rough Skin", moves: ["Dig"], evs: { spe: 252 }, name: "Chomp" }, { species: "Hippowdon", ability: "Sand Stream", moves: ["Earthquake"], name: "Hippo" }, lax(4), lax(8)],
}, /^\|(move|-miss|-damage|-weather|cant)\|/);

// T2-SI12b (custom two-turn run): turn 1 Dragonite Fly (charges); then paralysis is set on it and full paralysis forced
// for turn 2: it stays in the air through turn 2 (the fly volatile's duration 2 ends at turn 2's residual), so the slower
// foe's Body Slam at it misses; control T2-SI12c: no paralysis, it releases Fly and the slower Body Slam hits.
import { start } from "./guards-sim";
for (const [id, para] of [["T2-SI12b", true], ["T2-SI12c", false]] as const) {
  if (!want(id)) continue;
  console.log(`\n== ${id} champions: turn 1 Dragonite Fly; turn 2 ${para ? "fully paralysed (forced)" : "no paralysis"}; a faster foe's Thunderbolt and a slower foe's Body Slam at it`);
  const b: any = start({ game: "champions", turns: [], mons: [{ species: "Dragonite", ability: "Inner Focus", moves: ["Fly"], evs: { spe: 0 }, name: "Nite" }, lax(1),
    { species: "Raichu", ability: "Static", moves: ["Thunderbolt", "Splash"], evs: { spe: 32 }, name: "Rai" }, { species: "Snorlax", ability: "Thick Fat", moves: ["Body Slam", "Splash"], evs: { spe: 0 }, name: "Slammer" }] });
  b.randomChance = function (n: number, d: number) { return this.effect?.id === "par" ? para : n >= d; };
  b.random = function (m?: number, n?: number) { return n === undefined ? (m === 100 ? 99 : 0) : (m as number); };
  const at = b.log.length;
  b.makeChoices("move 1 1, move 1", "move 2, move 2");
  if (para) b.p1.active[0].setStatus("par");
  b.makeChoices("move 1, move 1", "move 1 1, move 1 1");
  for (const line of (b.log.slice(at) as string[]).filter((l) => LINES.test(l) || l.startsWith("|cant") || l.startsWith("|-end") || l.startsWith("|upkeep"))) console.log(`  ${line}`);
  console.log(`  volatiles after turn 2: ${Object.keys(b.p1.active[0].volatiles).join(",")}`);
}
