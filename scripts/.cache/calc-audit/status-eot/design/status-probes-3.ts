// Status-move architect's design probes, batch 3 (immunities, blocks, self-hit handlers, last-move moves, items, fields).
// Run from the repo root: npx --no-install tsx scripts/.cache/calc-audit/status-eot/design/status-probes-3.ts [R1 ...] > .../status-probes-3.out
import { enumerate, report, type Mon, type Probe } from "./status-sim";

const L = /^\|(move|cant|-status|-curestatus|-start|-end|-activate|-fail|-immune|-damage|-heal|-boost|-unboost|-setboost|-item|-enditem|-ability|-endability|-sethp|-swap|-singleturn|-clearallboost|-copyboost|-invertboost|-swapboost|-miss|-block|faint|-sidestart|-sideend|-fieldstart|-fieldend|-weather|-crit|-hint|-transform|-formechange|detailschange)/;
const splash: Mon = { species: "Blissey", ability: "Natural Cure", moves: ["Splash"] };
const still: Mon = { species: "Chansey", ability: "Natural Cure", moves: ["Splash"] };
const slow: Mon = { species: "Shuckle", ability: "Gluttony", moves: ["Splash"] };
const base = (over: Partial<Probe>): Probe => ({ game: "sv", mons: [splash, still, splash, slow], turns: [["move 1, move 1", "move 1, move 1"]], lines: L, ...over });
const only = process.argv.slice(2);
const want = (id: string) => !only.length || only.includes(id);
const hp = (b: any, side: "p1" | "p2", pos: 0 | 1, frac: number) => { const p = b[side].active[pos]; p.sethp(Math.max(1, Math.floor(p.maxhp * frac))); };
const jolt = (moves: string[]): Mon => ({ species: "Jolteon", ability: "Volt Absorb", moves });

// R1. The confusion self-hit goes through the Damage event as a Move: Sturdy and Focus Sash at full HP, Disguise and
// Endure act; Magic Guard does not stop it; a Sitrus Berry is eaten at the action's Update; hurtThisTurn is set (Assurance).
if (want("R1")) {
  report("R1a sv: Swagger on a 1-HP-max Shedinja given Sturdy: the self-hit is stopped at full HP (Damage event, effectType Move)", enumerate(base({
    mons: [jolt(["Swagger"]), still, { species: "Shedinja", ability: "Sturdy", item: "", moves: ["Splash"] }, slow],
    turns: [["move 1 1, move 1", "move 1, move 1"]],
    lines: /^\|(-activate|-damage|-enditem)\|/,
  })), { outcomes: false });
  report("R1b sv: Swagger on a Disguise Mimikyu: Disguise takes the self-hit", enumerate(base({
    mons: [jolt(["Swagger"]), still, { species: "Mimikyu", ability: "Disguise", moves: ["Splash"] }, slow],
    turns: [["move 1 1, move 1", "move 1, move 1"]],
    lines: /^\|(-activate|-damage|detailschange|-formechange)\|/,
  })));
  report("R1c sv: Swagger on a Magic Guard Clefable at 40%, holding Sitrus: self-hit, then Sitrus at the Update", enumerate(base({
    mons: [jolt(["Swagger"]), still, { species: "Clefable", ability: "Magic Guard", item: "Sitrus Berry", moves: ["Splash"] }, slow],
    turns: [["move 1 1, move 1", "move 1, move 1"]],
    setup: (b) => hp(b, "p2", 0, 0.55),
    lines: /^\|(-activate|-damage|-enditem|-heal)\|/,
  })));
  report("R1d sv: Confuse Ray on Snorlax, Snorlax self-hits, then Shuckle Assurance into Snorlax (doubled after any damage)", enumerate(base({
    mons: [jolt(["Confuse Ray"]), still, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] }, { species: "Tyranitar", ability: "Sand Stream", moves: ["Assurance"], level: 20 }],
    turns: [["move 1 1, move 1", "move 1, move 1 -1"]],
    setup: (b) => b.field.clearWeather(),
    lines: /^\|(-activate|-damage|move)\|/,
  })));
}

// R2. Thunder Wave: Ground types immune (ignoreImmunity: false), Electric types immune to paralysis; Glare hits a Ghost.
if (want("R2")) report("R2 sv: Thunder Wave into Garchomp (Ground) and into Raichu (Electric); Glare into Gengar", enumerate(base({
  mons: [jolt(["Thunder Wave"]), { species: "Arbok", ability: "Intimidate", moves: ["Glare"] }, { species: "Garchomp", ability: "Rough Skin", moves: ["Splash"] }, { species: "Gengar", ability: "Cursed Body", moves: ["Splash"] }],
  turns: [["move 1 1, move 1 2", "move 1, move 1"]],
  setup: (b) => { for (const p of [b.p1.active[0], b.p1.active[1], b.p2.active[0], b.p2.active[1]]) p.boosts.atk = 0; },
})));

// R3. Will-O-Wisp into Flash Fire (absorbed, Flash Fire active) and Well-Baked Body (+2 Def).
if (want("R3")) report("R3 sv: Will-O-Wisp into Flash Fire Arcanine and into Well-Baked Body Dachsbun", enumerate(base({
  mons: [jolt(["Will-O-Wisp"]), { species: "Ninetales", ability: "Drought", moves: ["Will-O-Wisp"] }, { species: "Arcanine", ability: "Flash Fire", moves: ["Splash"] }, { species: "Dachsbun", ability: "Well-Baked Body", moves: ["Splash"] }],
  turns: [["move 1 1, move 1 2", "move 1, move 1"]],
  setup: (b) => { b.field.clearWeather(); b.p2.active[0].boosts.atk = 0; },
})));

// R4. Psychic Terrain stops a foe's Prankster status move into a grounded target; Quick Guard stops it too.
if (want("R4")) {
  report("R4 sv: Prankster Thunder Wave into a grounded Snorlax on Psychic Terrain", enumerate(base({
    mons: [{ species: "Whimsicott", ability: "Prankster", moves: ["Thunder Wave"] }, still, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] }, slow],
    turns: [["move 1 1, move 1", "move 1, move 1"]],
    setup: (b) => b.field.setTerrain("psychicterrain", "debug"),
  })));
  report("R4b sv: Quick Guard (Shuckle) vs Prankster Thunder Wave into Snorlax", enumerate(base({
    mons: [{ species: "Whimsicott", ability: "Prankster", moves: ["Thunder Wave"] }, still, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] }, { species: "Shuckle", ability: "Gluttony", moves: ["Quick Guard"] }],
    turns: [["move 1 1, move 1", "move 1, move 1"]],
  })));
}

// R5. Safeguard stops Thunder Wave and Swagger's confusion (the +2 still lands); Mist stops Screech; Infiltrator passes both.
if (want("R5")) {
  report("R5 sv: Safeguard (Shuckle) side; Jolteon Swagger and Raichu Thunder Wave into Snorlax", enumerate(base({
    mons: [jolt(["Swagger"]), { species: "Raichu", ability: "Static", moves: ["Thunder Wave"] }, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] }, { species: "Shuckle", ability: "Gluttony", moves: ["Safeguard"] }],
    turns: [["move 1 1, move 1 1", "move 1, move 1"]],
    setup: (b) => b.p2.addSideCondition("safeguard", "debug"),
  })));
  report("R5b sv: Mist side; Screech from Jolteon and from Infiltrator Crobat into Snorlax", enumerate(base({
    mons: [jolt(["Screech"]), { species: "Crobat", ability: "Infiltrator", moves: ["Screech"] }, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] }, slow],
    turns: [["move 1 1, move 1 1", "move 1, move 1"]],
    setup: (b) => b.p2.addSideCondition("mist", "debug"),
  })));
}

// R6. Drops: Clear Body stops Charm, Mirror Armor reflects it, Defiant answers with +2 Atk, Competitive with +2 Sp. Atk.
if (want("R6")) report("R6 sv: Charm into Metagross (Clear Body) and Corviknight (Mirror Armor); Fake Tears into Kingambit (Defiant)", enumerate(base({
  mons: [jolt(["Charm"]), { species: "Sylveon", ability: "Pixilate", moves: ["Fake Tears"] }, { species: "Metagross", ability: "Clear Body", moves: ["Splash"] }, { species: "Kingambit", ability: "Defiant", moves: ["Splash"] }],
  turns: [["move 1 1, move 1 2", "move 1, move 1"]],
})));
if (want("R6")) report("R6b sv: Charm into Mirror Armor Corviknight", enumerate(base({
  mons: [jolt(["Charm"]), still, { species: "Corviknight", ability: "Mirror Armor", moves: ["Splash"] }, slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]],
})));

// R7. Oblivious stops Taunt; Aroma Veil stops Taunt on its ally; Mental Herb cures Taunt at the Update (the status move works).
if (want("R7")) report("R7 sv: Taunt into Oblivious Slowbro, into Snorlax beside Aroma Veil Aromatisse, and into Mental Herb Shuckle", enumerate(base({
  mons: [jolt(["Taunt"]), { species: "Weavile", ability: "Pressure", moves: ["Taunt"] }, { species: "Slowbro", ability: "Oblivious", moves: ["Calm Mind"] }, { species: "Shuckle", ability: "Gluttony", item: "Mental Herb", moves: ["Iron Defense"] }],
  turns: [["move 1 1, move 1 2", "move 1, move 1"]],
})));

// R8. Status immunities: Insomnia, Vital Spirit, Comatose, Purifying Salt, Leaf Guard in sun, Limber, Water Veil, Immunity, Own Tempo (Swagger: +2, no confusion).
if (want("R8")) {
  report("R8 sv: Hypnosis into Insomnia Hypno; Thunder Wave into Limber Hitmonlee", enumerate(base({
    mons: [jolt(["Hypnosis"]), { species: "Raichu", ability: "Static", moves: ["Thunder Wave"] }, { species: "Hypno", ability: "Insomnia", moves: ["Splash"] }, { species: "Hitmonlee", ability: "Limber", moves: ["Splash"] }],
    turns: [["move 1 1, move 1 2", "move 1, move 1"]],
  })));
  report("R8b sv: Toxic into Purifying Salt Garganacl; Swagger into Own Tempo Smeargle", enumerate(base({
    mons: [jolt(["Toxic"]), { species: "Raichu", ability: "Static", moves: ["Swagger"] }, { species: "Garganacl", ability: "Purifying Salt", moves: ["Splash"] }, { species: "Smeargle", ability: "Own Tempo", moves: ["Splash"] }],
    turns: [["move 1 1, move 1 2", "move 1, move 1"]],
  })));
  report("R8c sv: Thunder Wave into Leaf Guard Leafeon in sun; Will-O-Wisp into Water Veil Wailord", enumerate(base({
    mons: [jolt(["Thunder Wave"]), { species: "Ninetales", ability: "Flash Fire", moves: ["Will-O-Wisp"] }, { species: "Leafeon", ability: "Leaf Guard", moves: ["Splash"] }, { species: "Wailord", ability: "Water Veil", moves: ["Splash"] }],
    turns: [["move 1 1, move 1 2", "move 1, move 1"]],
    setup: (b) => b.field.setWeather("sunnyday", "debug"),
  })));
}

// R9. Encore / Disable on a target still to move this turn need its last move (from the turn before).
if (want("R9")) for (const game of ["sv", "champions"] as const) {
  report(`R9 ${game}: turn 1 Snorlax Body Slam; turn 2 Jolteon Encore then Snorlax picks Curse (Encore makes it Body Slam)`, enumerate(base({
    game,
    mons: [jolt(["Encore", "Splash"]), still, { species: "Snorlax", ability: "Thick Fat", moves: ["Body Slam", "Curse"] }, slow],
    turns: [["move 2, move 1", "move 1 2, move 1"], ["move 1 1, move 1", "move 2, move 1"]],
    lines: /^\|(move|-start|cant)\|/,
  })), { outcomes: true, lines: false });
  report(`R9b ${game}: turn 1 Snorlax Body Slam; turn 2 Jolteon Disable then Snorlax Body Slam again`, enumerate(base({
    game,
    mons: [jolt(["Disable", "Splash"]), still, { species: "Snorlax", ability: "Thick Fat", moves: ["Body Slam"] }, slow],
    turns: [["move 2, move 1", "move 1 2, move 1"], ["move 1 1, move 1", "move 1 2, move 1"]],
    lines: /^\|(move|-start|cant)\|/,
  })), { outcomes: true, lines: false });
}

// R10. Imprison: a foe's move that the user also knows fails (onFoeBeforeMove; the user's whole moveset).
if (want("R10")) report("R10 sv: Jolteon (knows Body Slam) Imprison, then Snorlax Body Slam", enumerate(base({
  mons: [jolt(["Imprison", "Body Slam"]), still, { species: "Snorlax", ability: "Thick Fat", moves: ["Body Slam"] }, slow],
  turns: [["move 1, move 1", "move 1 2, move 1"]],
})));

// R11. Trick hands a Sitrus Berry to a foe below half: eaten at the Update; Unburden activates on the giver; Sticky Hold stops it.
if (want("R11")) {
  report("R11 sv: Unburden Hawlucha Tricks its Sitrus to Snorlax (40%); Snorlax then Body Slams", enumerate(base({
    mons: [{ species: "Hawlucha", ability: "Unburden", item: "Sitrus Berry", moves: ["Trick"] }, still, { species: "Snorlax", ability: "Thick Fat", moves: ["Body Slam"] }, slow],
    turns: [["move 1 1, move 1", "move 1 2, move 1"]],
    setup: (b) => hp(b, "p2", 0, 0.4),
  })));
  report("R11b sv: Trick into Sticky Hold Muk", enumerate(base({
    mons: [{ species: "Hawlucha", ability: "Unburden", item: "Choice Scarf", moves: ["Trick"] }, splash, { species: "Muk", ability: "Sticky Hold", item: "Black Sludge", moves: ["Splash"] }, slow],
    turns: [["move 1 1, move 1", "move 1, move 1"]],
  })));
}

// R12. Charge used this turn doubles the next Electric move this turn and raises Sp. Def.
if (want("R12")) report("R12 sv: Raichu Charge then its ally Jolteon... (Charge is self) - Raichu Charge turn 1, Thunderbolt turn 2 vs no Charge", enumerate(base({
  mons: [{ species: "Raichu", ability: "Static", moves: ["Charge", "Thunderbolt"] }, still, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] }, slow],
  turns: [["move 1, move 1", "move 1, move 1"], ["move 2 1, move 1", "move 1, move 1"]],
  lines: /^\|(-start|-boost|-damage|-end)\|/,
})));

// R13. Defog clears screens and the terrain (gen 8+); Court Change swaps side conditions.
if (want("R13")) report("R13 sv: Defog (Corviknight) into Snorlax with Reflect on its side and Electric Terrain", enumerate(base({
  mons: [{ species: "Corviknight", ability: "Pressure", moves: ["Defog"] }, still, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] }, slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]],
  setup: (b) => { b.p2.addSideCondition("reflect", "debug"); b.p1.addSideCondition("lightscreen", "debug"); b.field.setTerrain("electricterrain", "debug"); },
})));

// R14. Magic Room set mid-turn switches items off for later moves; Wonder Room swaps Def / Sp. Def.
if (want("R14")) report("R14 sv: Magic Room (Jolteon) then Snorlax hit below half by Body Slam does not eat its Sitrus", enumerate(base({
  mons: [jolt(["Magic Room"]), { species: "Snorlax", ability: "Thick Fat", moves: ["Body Slam"] }, { species: "Lapras", ability: "Shell Armor", item: "Sitrus Berry", moves: ["Splash"] }, slow],
  turns: [["move 1, move 1 1", "move 1, move 1"]],
  setup: (b) => hp(b, "p2", 0, 0.6),
})));

// R15. Belly Drum fails at half HP or less; non-Ghost Curse (+1 Atk +1 Def -1 Spe) re-sorts the queue.
if (want("R15")) report("R15 sv: Belly Drum at exactly half fails; Curse by Lapras (80 -> Spe -1: 53) moves after Snorlax? (Snorlax 50)", enumerate(base({
  mons: [{ species: "Azumarill", ability: "Huge Power", moves: ["Belly Drum"] }, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] }, { species: "Lapras", ability: "Shell Armor", moves: ["Curse"] }, slow],
  turns: [["move 1, move 1", "move 1, move 1"]],
  setup: (b) => { const p = b.p1.active[0]; p.sethp(Math.floor(p.maxhp / 2)); },
  lines: /^\|(move|-fail|-damage|-boost|-unboost|-setboost)\|/,
})));

// R16. After You on a Pokémon that has already moved fails.
if (want("R16")) report("R16 sv: Jolteon After You on Lapras after Lapras moved (fails)", enumerate(base({
  mons: [{ species: "Shuckle", ability: "Gluttony", moves: ["After You"] }, still, { species: "Lapras", ability: "Shell Armor", moves: ["Splash"] }, { species: "Blissey", ability: "Natural Cure", moves: ["Splash"] }],
  turns: [["move 1 1, move 1", "move 1, move 1"]],
  lines: /^\|(move|-fail|-activate)\|/,
})));

// R17. Yawn from the turn before: sleep at this end of turn (order 23), then Bad Dreams (28.2) damages it the same turn.
if (want("R17")) report("R17 sv: Darkrai (Bad Dreams) Yawns Snorlax on turn 1; turn 2 end: Snorlax falls asleep, then Bad Dreams", enumerate(base({
  mons: [{ species: "Darkrai", ability: "Bad Dreams", moves: ["Yawn", "Splash"] }, still, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] }, slow],
  turns: [["move 1 1, move 1", "move 1, move 1"], ["move 2, move 1", "move 1, move 1"]],
  lines: /^\|(-status|-damage|-start|-end)\|/,
})));

// R18. Leech Seed: Grass types immune; a Substitute stops it; Liquid Ooze hurts the seeder; Big Root raises the heal.
if (want("R18")) report("R18 sv: Leech Seed into Snorlax (seeder Big Root Venusaur at 50%) and into Liquid Ooze Tentacruel", enumerate(base({
  mons: [{ species: "Venusaur", ability: "Chlorophyll", item: "Big Root", moves: ["Leech Seed"] }, { species: "Ferrothorn", ability: "Iron Barbs", moves: ["Leech Seed"] }, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] }, { species: "Tentacruel", ability: "Liquid Ooze", moves: ["Splash"] }],
  turns: [["move 1 1, move 1 2", "move 1, move 1"]],
  setup: (b) => { hp(b, "p1", 0, 0.5); hp(b, "p1", 1, 0.5); },
})));

// R19. Substitute and multi-hit: the hits after the one that breaks it reach the Pokémon.
if (want("R19")) report("R19 sv: Jolteon Substitute, then Shuckle... Lapras Icicle Spear (5 hits forced) into it", enumerate(base({
  mons: [jolt(["Substitute"]), still, { species: "Cloyster", ability: "Skill Link", moves: ["Icicle Spear"] }, slow],
  turns: [["move 1, move 1", "move 1 1, move 1"]],
  setup: (b) => { b.p2.active[0].boosts.spe = -6; },
  lines: /^\|(move|-damage|-start|-end|-activate|-hitcount)\|/,
})));

// R20. Endure fails when no Pokémon acts after it (stall check, like Protect).
if (want("R20")) report("R20 sv: Shuckle (slowest) Endure", enumerate(base({
  mons: [splash, still, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] }, { species: "Shuckle", ability: "Gluttony", moves: ["Endure"] }],
  turns: [["move 1, move 1", "move 1, move 1"]],
  lines: /^\|(move|-fail|-singleturn)/,
})));

// R21. Perish Song: every Pokémon hearing it gets a count of 3 at this end of turn (Soundproof immune).
if (want("R21")) report("R21 sv: Perish Song; Soundproof Kommo-o", enumerate(base({
  mons: [jolt(["Perish Song"]), still, { species: "Kommo-o", ability: "Soundproof", moves: ["Splash"] }, slow],
  turns: [["move 1, move 1", "move 1, move 1"]],
  lines: /^\|(-start|-fieldactivate|-immune)/,
})));
