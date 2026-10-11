// TIER 2 (moves phase) probes, part 4: hits into a Substitute (Max Moves, a signature Z-Move, Parental Bond with a
// self effect, a multi-hit move in front of Multiscale), the G-Max effects and Max Guard (SwSh), and items received by
// Trick (a Terrain Seed in its terrain, Room Service under Trick Room, Booster Energy). Pinned Showdown c23d2e94 through
// guards-sim.ts. Run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/status2/design/tier2-moves-probes-4.ts [ID ...] > scripts/.cache/calc-audit/status2/design/tier2-moves-probes-4.out
import { enumerate, monAt, report, showTrace, type Mon, type Probe } from "./guards-sim";

const only = process.argv.slice(2);
const want = (id: string) => !only.length || only.includes(id);
const boosts = (p: any) => {
  if (!p) return "-";
  const parts = Object.entries(p.boosts as Record<string, number>).filter(([, v]) => v).map(([k, v]) => `${k}${v > 0 ? "+" : ""}${v}`);
  return parts.length ? parts.join(" ") : "0";
};
const vols = (p: any) => Object.keys(p?.volatiles ?? {}).filter((v) => !["stall"].includes(v)).map((v) => v === "substitute" ? `sub ${p.volatiles.substitute.hp}` : v).join(",") || "-";
const who = (b: any) => ["p1a", "p1b", "p2a", "p2b"].map((id) => {
  const p = monAt(b, id as any);
  return `${id}:${p?.name}(${p?.hp}/${p?.maxhp}${p?.status ? " " + p.status : ""}${p?.item ? " @" + p.item : ""}) ${boosts(p)} [${vols(p)}]`;
}).join(" | ") + ` || ${b.field.weather || "-"} ${b.field.terrain || "-"} ${Object.keys(b.p1.sideConditions).join(",")}`;
const LINES = /^\|(move|cant|-miss|-heal|-damage|-boost|-unboost|-enditem|-item|-ability|-activate|-fail|-immune|-start|-end|-status|-curestatus|-weather|-fieldstart|-sidestart|-singleturn|-hitcount|-sethp|-supereffective|-resisted|-zpower|-clearnegativeboost|turn)\|/;
const lax = (n: number, name = `Lax${n}`): Mon => ({ species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], evs: { spe: n * 8 }, name });
const sub = (b: any, slot: "p2a" | "p2b", hp: number) => { const p = monAt(b, slot); p.addVolatile("substitute"); p.volatiles.substitute.hp = hp; };
const trace = (id: string, title: string, probe: Probe, keep: RegExp = LINES) => { if (want(id)) showTrace(`${id} ${title}`, probe, keep); };
const run = (id: string, title: string, probe: Probe) => { if (want(id)) report(`${id} ${title}`, enumerate({ lines: LINES, inspect: who, ...probe }), { lines: true }); };

// ---- Max Moves into a Substitute: the user's side effect, the foe drops (self.onHit boosts every foe), the user boosts ----
for (const [id, move, title] of [
  ["T2-SB01", "Crunch", "Max Darkness (SpD −1 on every foe) into a Substitute"],
  ["T2-SB02", "Close Combat", "Max Knuckle (Atk +1 on the user's side) into a Substitute"],
  ["T2-SB03", "Thunderbolt", "Max Lightning (Electric Terrain) into a Substitute"],
] as const) {
  run(id, `swsh: a Dynamaxed Snorlax's ${title}`, {
    game: "swsh", turns: [["move 1 1 dynamax, move 1", "move 1, move 1"]],
    mons: [{ species: "Snorlax", ability: "Thick Fat", moves: [move], evs: { spe: 252 }, name: "Max" }, lax(1), lax(2, "Subbed"), lax(3)],
    setup: (b) => sub(b, "p2a", 300),
  });
}
// ---- A signature Z-Move with an effect of its own into a Substitute (USUM): Clangorous Soulblaze's boosts, Splintered Stormshards' terrain end ----
run("T2-SB04", "usum: Kommo-o's Clangorous Soulblaze (Kommonium Z) into two Substitutes: the user's +1 all", {
  game: "usum", turns: [["move 1 zmove, move 1", "move 1, move 1"]],
  mons: [{ species: "Kommo-o", ability: "Bulletproof", item: "Kommonium Z", moves: ["Clanging Scales"], evs: { spe: 252 }, name: "Kommo" }, lax(1), lax(2, "Sub1"), lax(3, "Sub2")],
  setup: (b) => { sub(b, "p2a", 300); sub(b, "p2b", 300); },
});
run("T2-SB05", "usum: Lycanroc's Splintered Stormshards (Lycanium Z) into a Substitute on Psychic Terrain: does the terrain end?", {
  game: "usum", turns: [["move 1 1 zmove, move 1", "move 1, move 1"]],
  mons: [{ species: "Lycanroc", ability: "Sand Rush", item: "Lycanium Z", moves: ["Stone Edge"], evs: { spe: 252 }, name: "Lyc" }, lax(1), lax(2, "Subbed"), lax(3)],
  setup: (b) => { sub(b, "p2a", 300); b.field.setTerrain("psychicterrain", b.p2.active[1]); },
});
// ---- Parental Bond into a Substitute with a per-strike self effect (Power-Up Punch: +1 Atk per strike) ----
run("T2-SB06", "champions: Kangaskhan-Mega's Power-Up Punch into a 300-HP Substitute: two strikes, two Attack rises?", {
  game: "champions", turns: [["move 1 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Kangaskhan-Mega", ability: "Parental Bond", moves: ["Power-Up Punch"], evs: { spe: 32 }, name: "Kanga" }, lax(1), lax(2, "Subbed"), lax(3)],
  setup: (b) => sub(b, "p2a", 300),
});
run("T2-SB06b", "champions: Kangaskhan-Mega's Power-Up Punch into a 20-HP Substitute: the first strike breaks it, the second hits the Pokémon", {
  game: "champions", turns: [["move 1 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Kangaskhan-Mega", ability: "Parental Bond", moves: ["Power-Up Punch"], evs: { spe: 32 }, name: "Kanga" }, lax(1), lax(2, "Subbed"), lax(3)],
  setup: (b) => sub(b, "p2a", 20),
});
// ---- A multi-hit move into a Substitute in front of Multiscale: Showdown halves the hits after the break while the Pokémon stays at full HP ----
run("T2-SP01", "sv: Dual Wingbeat into a full-HP Multiscale Dragonite's 30-HP Substitute: the first hit breaks it, the second meets Multiscale", {
  game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Dragonite", ability: "Inner Focus", moves: ["Dual Wingbeat"], evs: { atk: 252, spe: 252 }, name: "Wing" }, lax(1),
    { species: "Dragonite", ability: "Multiscale", moves: ["Splash"], name: "Scale" }, lax(3)],
  setup: (b) => sub(b, "p2a", 30),
});
run("T2-SP01c", "sv: control: the same Dual Wingbeat into the Multiscale Dragonite with no Substitute", {
  game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Dragonite", ability: "Inner Focus", moves: ["Dual Wingbeat"], evs: { atk: 252, spe: 252 }, name: "Wing" }, lax(1),
    { species: "Dragonite", ability: "Multiscale", moves: ["Splash"], name: "Scale" }, lax(3)],
});
// ---- G-Max effects (SwSh) ----
const gmax = (id: string, species: string, move: string, title: string, mons?: Partial<Record<1 | 2 | 3, Mon>>, extra: Partial<Probe> = {}) => run(id, `swsh: ${title}`, {
  game: "swsh", turns: [["move 1 1 dynamax, move 1", "move 1, move 1"]],
  mons: [{ species, ability: "Pressure", moves: [move], evs: { spe: 252 }, name: "Gmax", gender: "M" } as Mon, mons?.[1] ?? lax(1), mons?.[2] ?? lax(2), mons?.[3] ?? lax(3)],
  ...extra,
});
const G = (m: Mon): Mon => m;
if (want("T2-GM")) {
  // Showdown needs the set's gigantamax flag: guards-sim's setOf has none, so these set it on the Pokémon before the turn.
}
for (const [id, species, move, title] of [
  ["T2-GM01", "Hatterene", "Dazzling Gleam", "Gigantamax Hatterene's G-Max Smite: every foe confused"],
  ["T2-GM02", "Meowth", "Pay Day", "Gigantamax Meowth's G-Max Gold Rush: every foe confused"],
  ["T2-GM03", "Eevee", "Body Slam", "Gigantamax Eevee's G-Max Cuddle: every foe of the opposite gender infatuated"],
  ["T2-GM04", "Machamp", "Close Combat", "Gigantamax Machamp's G-Max Chi Strike: the user's side +1 critical-hit ratio"],
  ["T2-GM05", "Alcremie", "Dazzling Gleam", "Gigantamax Alcremie's G-Max Finale: the user's side heals 1/6"],
  ["T2-GM06", "Butterfree", "Bug Buzz", "Gigantamax Butterfree's G-Max Befuddle: each foe a random status (par, psn, slp)"],
  ["T2-GM07", "Toxtricity", "Overdrive", "Gigantamax Toxtricity's G-Max Stun Shock: each foe par or psn"],
  ["T2-GM08", "Snorlax", "Body Slam", "Gigantamax Snorlax's G-Max Replenish: each of the user's side's eaten Berries 1/2"],
] as const) {
  if (!want(id)) continue;
  const extra: Partial<Probe> = {
    setup: (b) => {
      const p = b.p1.active[0];
      p.canGigantamax = b.dex.species.get(p.species.name).canGigantamax ?? null;
      p.gigantamax = true;
      p.baseSpecies && (p.set.gigantamax = true);
      if (id === "T2-GM05") { b.p1.active[1].sethp(100); }
      if (id === "T2-GM08") { b.p1.active[1].item = ""; b.p1.active[1].lastItem = "sitrusberry"; b.p1.active[0].lastItem = "lumberry"; b.p1.active[0].item = ""; }
    },
    chances: id === "T2-GM08" ? ["gmaxreplenish"] : [], rolls: "lowest", maxRuns: 200_000,
  };
  gmax(id, species, move, title, id === "T2-GM03" ? { 2: { ...lax(2), gender: "F" }, 3: { ...lax(3), gender: "M" } } : undefined, extra);
}
trace("T2-GM09", "swsh: a Dynamaxed Snorlax's status move is Max Guard; a foe's Max Move into it is blocked; a foe's G-Max One Blow? (not available): its ally's Feint? into it", {
  game: "swsh", turns: [["move 1 dynamax, move 1", "move 1 1 dynamax, move 1"]],
  mons: [{ species: "Snorlax", ability: "Thick Fat", moves: ["Swords Dance"], evs: { spe: 252 }, name: "Guard" }, lax(1),
    { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], name: "Chomp" }, lax(3)],
});
// ---- Items received by Trick that are used at once (setItem's Start) ----
trace("T2-RI01", "sv: on Electric Terrain, Trick gives a foe an Electric Seed: used at once (+1 Def)", {
  game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { b.field.setTerrain("electricterrain", b.p2.active[1]); },
  mons: [{ species: "Alakazam", ability: "Inner Focus", item: "Electric Seed", moves: ["Trick"], evs: { spe: 252 }, name: "Zam" }, lax(1), { species: "Snorlax", ability: "Thick Fat", item: "Leftovers", moves: ["Splash"], name: "Got" }, lax(3)],
});
trace("T2-RI02", "sv: under Trick Room, Trick gives a foe Room Service: used at once (Spe −1)", {
  game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { b.field.addPseudoWeather("trickroom", b.p2.active[1]); },
  mons: [{ species: "Alakazam", ability: "Inner Focus", item: "Room Service", moves: ["Trick"], evs: { spe: 0 }, ivs: { spe: 0 }, name: "Zam" }, lax(1), { species: "Snorlax", ability: "Thick Fat", item: "Leftovers", moves: ["Splash"], evs: { spe: 252 }, name: "Got" }, lax(3)],
});
trace("T2-RI03", "sv: Trick gives a Protosynthesis Great Tusk Booster Energy (no sun): it activates at once (its best stat)", {
  game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Alakazam", ability: "Inner Focus", item: "Booster Energy", moves: ["Trick"], evs: { spe: 252 }, name: "Zam" }, lax(1), { species: "Great Tusk", ability: "Protosynthesis", item: "Leftovers", moves: ["Splash"], name: "Tusk" }, lax(3)],
});
