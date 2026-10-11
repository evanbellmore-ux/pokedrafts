// CRITIC probes for status2 (SPEC2.md): cross-family interactions and the conflicts between the four designs, on pinned
// Showdown c23d2e94 through the guards harness (guards-sim.ts: exact enumeration, the oracle's forcing, mid-turn switch
// requests answered, `inspect` at the residual pick and at the turn's end). Run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/status2/design/critic-probes-1.ts [CR01 ...] > scripts/.cache/calc-audit/status2/design/critic-probes-1.out
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
  return `${id}:${p?.name}(${p?.hp}/${p?.maxhp}${p?.item ? " " + p.item : ""}) ${boosts(p)} [${vols(p)}]`;
}).join(" | ");
const LINES = /^\|(move|cant|-heal|-damage|-boost|-unboost|-enditem|-item|-ability|-activate|-fail|-immune|-start|-end|-sidestart|-sideend|-transform|-curestatus|-status|upkeep|turn)\|/;
const lax = (n: number, name = `Lax${n}`): Mon => ({ species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], evs: { spe: n * 8 }, name });
const shuckle: Mon = { species: "Shuckle", ability: "Gluttony", moves: ["Splash"] };
const run = (title: string, probe: Probe) => report(title, enumerate({ lines: LINES, ...probe }), { lines: true });

// CR01 (F2 healBlockLeft vs F4 healBlock: true). The healblock condition (PS/data/moves.ts:8274-8343) has no onResidual
// handler but onResidualOrder 20: its duration counts down at order 20, so with 1 turn left it ends there, after
// Leftovers (5.4), Aqua Ring (6), Ingrain (7) and Leech Seed (8), and before the final Update: a held Sitrus at or under
// half is eaten at that Update. With 2 left it stays. So the turns left decide the end of turn: F2's count is needed.
for (const [label, item, duration] of [["Sitrus, 1 turn left", "Sitrus Berry", 1], ["Sitrus, 2 turns left", "Sitrus Berry", 2], ["Leftovers, 1 turn left", "Leftovers", 1]] as const) if (want("CR01")) {
  showTrace(`CR01 sv: Snorlax (${label}) at 100 HP under Heal Block; everyone uses Splash`, {
    game: "sv", turns: [["move 1, move 1", "move 1, move 1"]],
    mons: [lax(1), shuckle, { species: "Snorlax", ability: "Thick Fat", item, moves: ["Splash"], name: "Blocked" }, lax(2)],
    setup: (b) => {
      const p = b.p2.active[0];
      p.sethp(100);
      p.addVolatile("healblock", b.p1.active[0]);
      p.volatiles.healblock.duration = duration;
    },
  }, /^\|(-heal|-enditem|-end|-start|upkeep|turn)\|/);
}

// CR02 (F2 embargo turns vs F3 carried embargo: true). Embargo (PS/data/moves.ts:4680-4707, USUM): duration 5, ends at
// residual order 21. With 1 turn left Leftovers (5.4) still does nothing; a Sitrus is eaten at the final Update after it ends.
for (const [label, item, duration] of [["Sitrus, 1 turn left", "Sitrus Berry", 1], ["Sitrus, 2 turns left", "Sitrus Berry", 2], ["Leftovers, 1 turn left", "Leftovers", 1]] as const) if (want("CR02")) {
  showTrace(`CR02 usum: Snorlax (${label}) at 100 HP under Embargo; everyone uses Splash`, {
    game: "usum", turns: [["move 1, move 1", "move 1, move 1"]],
    mons: [lax(1), shuckle, { species: "Snorlax", ability: "Thick Fat", item, moves: ["Splash"], name: "Embargoed" }, lax(2)],
    setup: (b) => {
      const p = b.p2.active[0];
      p.sethp(100);
      p.addVolatile("embargo", b.p1.active[0]);
      p.volatiles.embargo.duration = duration;
    },
  }, /^\|(-heal|-enditem|-end|-start|upkeep|turn)\|/);
}

// CR03 (F1 transformTyped vs F2 world types; F1 omits timesAttacked). sim/pokemon.ts transformInto copies
// getTypes(true, true) (its types after a setType, before Tera), the added type, the weight and timesAttacked (Rage Fist).
if (want("CR03")) {
  run("CR03 sv: Ditto Transform into a Garchomp whose types were set to Water with an added Grass and which was hit 3 times", {
    game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]],
    mons: [{ species: "Ditto", ability: "Limber", moves: ["Transform"], evs: { spe: 252 } }, shuckle, { species: "Garchomp", ability: "Rough Skin", moves: ["Splash"] }, lax(1)],
    setup: (b) => { const g = b.p2.active[0]; g.setType(["Water"]); g.addedType = "Grass"; g.timesAttacked = 3; },
    inspect: (b) => { const d = b.p1.active[0]; return `Ditto species ${d.species.name}, types ${d.getTypes().join("/")} (base ${d.getTypes(true).join("/")}, added ${d.addedType || "-"}), timesAttacked ${d.timesAttacked}, weighthg ${d.weighthg}, ability ${d.ability}`; },
  });
}

// CR04 (F1 vs F3 on a snatched Swallow). PS/data/moves.ts:18574-18598: the snatched use skips onTry and heals by the Snatch
// user's OWN Stockpile layers (1 without), then removes the Snatch user's Stockpile (its End lowers its counted stages);
// the original user keeps its Stockpile.
if (want("CR04")) {
  run("CR04 usum: Absol (2 Stockpile layers, 100 HP) Snatch; Swalot (1 layer, 100 HP) Swallow", {
    game: "usum", turns: [["move 1, move 1", "move 1, move 1"]],
    mons: [{ species: "Absol", ability: "Pressure", moves: ["Snatch"], evs: { spe: 252 } }, shuckle, { species: "Swalot", ability: "Sticky Hold", moves: ["Swallow"] }, lax(1)],
    setup: (b) => {
      const a = b.p1.active[0], s = b.p2.active[0];
      a.addVolatile("stockpile"); a.addVolatile("stockpile"); a.sethp(100);
      s.addVolatile("stockpile"); s.sethp(100);
    },
    inspect: (b) => `Absol ${b.p1.active[0].hp}/${b.p1.active[0].maxhp} ${boosts(b.p1.active[0])} layers ${b.p1.active[0].volatiles.stockpile?.layers ?? 0} | Swalot ${b.p2.active[0].hp}/${b.p2.active[0].maxhp} ${boosts(b.p2.active[0])} layers ${b.p2.active[0].volatiles.stockpile?.layers ?? 0}`,
  });
}

// CR05 (F2 x F4): Octolock's residual drop (order 14, boost() with the octolock ActiveMove from its source) sets off the
// target's Defiant once per stat (+4 Atk), and the Octolock user's ally Opportunist copies that rise at residual 29.
if (want("CR05")) {
  run("CR05 champions: Grapploct Octolock into Defiant Kingambit; Grapploct's ally Espathra (Opportunist)", {
    game: "champions", turns: [["move 1 1, move 1", "move 1, move 1"]],
    mons: [{ species: "Grapploct", ability: "Technician", moves: ["Octolock"] }, { species: "Espathra", ability: "Opportunist", moves: ["Splash"] },
      { species: "Kingambit", ability: "Defiant", moves: ["Splash"] }, lax(1)],
    inspect: who,
  });
}

// CR06 (F1 x F3): Entrainment gives Intimidate mid-turn; its Start meets the foes' Mist (side, after the Pokémon's own
// TryBoost) and Mirror Armor (reflects first: the reflected drop lands on the new Intimidate holder).
if (want("CR06")) {
  run("CR06 sv: Incineroar Entrainment into Snorlax under Incineroar's side's Mist; Incineroar's ally Corviknight (Mirror Armor)", {
    game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]],
    mons: [{ species: "Incineroar", ability: "Intimidate", moves: ["Entrainment"], evs: { spe: 252 } }, { species: "Corviknight", ability: "Mirror Armor", moves: ["Splash"] },
      { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] }, lax(1)],
    setup: (b) => { b.p1.addSideCondition("mist", b.p1.active[0]); },
    inspect: who,
  });
}

// CR07 (the grounding gap neither F2 nor F4 designed: REASONS.groundingChange, the smackdown-later guard): isGrounded
// (sim/pokemon.ts) reads smackdown and ingrain before the Flying type, magnetrise after it.
for (const [label, first] of [["Smack Down then the ally's Earthquake into Skarmory", "Smack Down"], ["control: no Smack Down", "Splash"]] as const) if (want("CR07")) {
  run(`CR07 sv: ${label}`, {
    game: "sv", turns: [[first === "Splash" ? "move 1, move 1" : "move 1 1, move 1", "move 1, move 1"]],
    mons: [{ species: "Smeargle", ability: "Own Tempo", moves: [first], evs: { spe: 252 } }, shuckle, { species: "Skarmory", ability: "Sturdy", moves: ["Splash"] },
      { species: "Garchomp", ability: "Rough Skin", moves: ["Earthquake"] }],
  });
}
for (const [label, move] of [["Skarmory Ingrain then its ally's Earthquake", "Ingrain"], ["Snorlax Magnet Rise then its ally's Earthquake", "Magnet Rise"]] as const) if (want("CR07")) {
  showTrace(`CR07 sv: ${label} (one run, lowest rolls)`, {
    game: "sv", turns: [["move 1, move 1", "move 1, move 1"]],
    mons: [lax(1), shuckle, move === "Ingrain" ? { species: "Skarmory", ability: "Sturdy", moves: ["Ingrain"], evs: { spe: 252 } } : { species: "Snorlax", ability: "Thick Fat", moves: ["Magnet Rise"], evs: { spe: 252 } },
      { species: "Hippowdon", ability: "Sand Force", moves: ["Earthquake"] }],
  }, /^\|(move|-damage|-immune|-start|-heal|turn)\|/);
}

// CR08 (F1 x F4): a copy pending from the turn's first Update (a foe's Liechi Berry) is deleted when the copier's ability
// ends before the first AfterMove (Opportunist onEnd); Skill Swap gives the other Pokémon a fresh Opportunist (no copy).
for (const [label, move] of [["control: the partner uses Splash first", "Splash"], ["the partner's Gastro Acid on Espathra first", "Gastro Acid"], ["the partner's Skill Swap with Espathra first", "Skill Swap"]] as const) if (want("CR08")) {
  run(`CR08 sv: a foe Garchomp eats its Liechi Berry at the turn's first Update; Espathra (Opportunist, slow) and ${label}`, {
    game: "sv", turns: [[move === "Splash" ? "move 1, move 1" : "move 1, move 1 -1", "move 1, move 1"]],
    mons: [{ species: "Espathra", ability: "Opportunist", moves: ["Splash"] }, { species: "Smeargle", ability: "Own Tempo", moves: [move], evs: { spe: 252 } },
      { species: "Garchomp", ability: "Rough Skin", item: "Liechi Berry", moves: ["Splash"] }, lax(1)],
    setup: (b) => { b.p2.active[0].sethp(40); },
    inspect: who,
  });
}

// CR09 (F3 x F4, itemHistory): Teatime's eatItem(true) sets lastItem and usedItemThisTurn; at residual 28.2 Pickup
// (Ambipom, faster) and Harvest (Trevenant) both read it, in Speed order: Pickup first takes the Sitrus and clears the
// eater's lastItem, so Harvest then has nothing. Control: no Pickup holder, Harvest restores it (sun).
for (const [label, partner] of [["Ambipom (Pickup) beside Trevenant", { species: "Ambipom", ability: "Pickup", moves: ["Splash"] }], ["control: Snorlax beside Trevenant", lax(1)]] as const) if (want("CR09")) {
  run(`CR09 sv: Teatime in sun; Trevenant (Harvest, Sitrus); ${label}`, {
    game: "sv", turns: [["move 1, move 1", "move 1, move 1"]],
    mons: [{ species: "Sinistcha", ability: "Hospitality", moves: ["Teatime"], evs: { spe: 252 } }, shuckle,
      { species: "Trevenant", ability: "Harvest", item: "Sitrus Berry", moves: ["Splash"] }, partner],
    setup: (b) => { b.field.setWeather("sunnyday", b.p1.active[0]); b.field.weatherState.duration = 0; b.p2.active[0].sethp(120); },
    inspect: (b) => `${who(b)} | Trevenant lastItem ${b.p2.active[0].lastItem || "-"}`,
  });
}

// CR10 (F1 x F4: one final-modifier hook for Minimize and Glaive Rush). Both are onSourceModifyDamage chainModify(2) in the
// target's ModifyDamage chain with Reflect's: every roll of Snorlax's Body Slam into a slower Snorlax under Reflect. CR10b:
// Glaive Rush's drawback ends at its holder's own BeforeMove (onBeforeMovePriority 100, before sleep and flinch), so a
// faster holder that uses any move (Splash too) before the hit takes normal damage.
for (const [label, extra] of [["Minimize and Glaive Rush", ["minimize", "glaiverush"]], ["Minimize", ["minimize"]], ["Glaive Rush", ["glaiverush"]], ["neither", []]] as const) if (want("CR10")) {
  report(`CR10 sv: Snorlax (fast) Body Slam into a slower Snorlax under Reflect, the target with ${label}: every roll`, enumerate({
    game: "sv", rolls: "all", turns: [["move 1 2, move 1", "move 1, move 1"]],
    mons: [{ species: "Snorlax", ability: "Thick Fat", moves: ["Body Slam"], evs: { atk: 252, spe: 252 }, name: "Slammer" }, shuckle, lax(2), { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], name: "Target" }],
    setup: (b) => { b.p2.addSideCondition("reflect", b.p2.active[1]); for (const v of extra) b.p2.active[1].addVolatile(v); },
  }), { lines: false });
}
if (want("CR10")) {
  report("CR10b sv: the Glaive Rush holder (Garchomp, faster) uses Splash before Snorlax's Body Slam: the drawback is gone (every roll)", enumerate({
    game: "sv", rolls: "all", turns: [["move 1 1, move 1", "move 1, move 1"]],
    mons: [{ species: "Snorlax", ability: "Thick Fat", moves: ["Body Slam"], evs: { atk: 252 } }, shuckle, { species: "Garchomp", ability: "Sand Veil", moves: ["Splash"], evs: { hp: 252 } }, lax(1)],
    setup: (b) => { b.p2.active[0].addVolatile("glaiverush"); },
    inspect: (b) => `Garchomp glaiverush ${!!b.p2.active[0].volatiles.glaiverush}`,
  }), { lines: false });
}

// CR11 (F2 x F3): Heal Bell (gen 7) cures a sleeping ally whose Nightmare then ends with the sleep (cureStatus removes
// nightmare): no Nightmare damage at residual 11, and the cured ally moves.
for (const [label, move] of [["Heal Bell first", "Heal Bell"], ["control: Splash", "Splash"]] as const) if (want("CR11")) {
  run(`CR11 usum: Snorlax asleep with Nightmare; its ally ${label}`, {
    game: "usum", turns: [["move 1, move 1", "move 1 1, move 1"]],
    mons: [lax(1), shuckle, { species: "Snorlax", ability: "Thick Fat", moves: ["Tackle"], name: "Sleeper" }, { species: "Blissey", ability: "Natural Cure", moves: [move], evs: { spe: 252 } }],
    setup: (b) => { const p = b.p2.active[0]; p.setStatus("slp", null, null, true); p.statusState.time = 3; p.addVolatile("nightmare"); },
    inspect: who,
  });
}
