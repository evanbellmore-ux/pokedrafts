// Status-move architect's design probes, batch 2 (order, positions, items, abilities, HP moves, blocks, cures).
// Run from the repo root: npx --no-install tsx scripts/.cache/calc-audit/status-eot/design/status-probes-2.ts [Q1 ...] > .../status-probes-2.out
import { enumerate, report, start, type Mon, type Probe } from "./status-sim";

const L = /^\|(move|cant|-status|-curestatus|-cureteam|-start|-end|-activate|-fail|-immune|-damage|-heal|-boost|-unboost|-setboost|-item|-enditem|-ability|-sethp|-swap|-singleturn|-clearallboost|-clearnegativeboost|-copyboost|-invertboost|-swapboost|-transform|-miss|-block|faint|-sidestart|-sideend|-fieldstart|-fieldend|-weather|-hint)\|/;
const splash: Mon = { species: "Blissey", ability: "Natural Cure", moves: ["Splash"] };
const still: Mon = { species: "Chansey", ability: "Natural Cure", moves: ["Splash"] };
const slow: Mon = { species: "Shuckle", ability: "Gluttony", moves: ["Splash"] };
const base = (over: Partial<Probe>): Probe => ({ game: "sv", mons: [splash, still, splash, slow], turns: [["move 1, move 1", "move 1, move 1"]], lines: L, ...over });
const only = process.argv.slice(2);
const want = (id: string) => !only.length || only.includes(id);
const hp = (b: any, side: "p1" | "p2", pos: 0 | 1, frac: number) => { const p = b[side].active[pos]; p.sethp(Math.max(1, Math.floor(p.maxhp * frac))); };

// Q1. Trick a Choice Scarf onto a slower foe (gen 9): its Speed x1.5 re-sorts the queue; it now moves before Snorlax.
if (want("Q1")) report("Q1 sv: Jolteon Tricks its Choice Scarf to Lapras (80 -> 120); Snorlax (50) and Lapras attack", enumerate(base({
  mons: [{ species: "Jolteon", ability: "Volt Absorb", item: "Choice Scarf", moves: ["Trick"] }, { species: "Snorlax", ability: "Thick Fat", moves: ["Body Slam"] },
    { species: "Lapras", ability: "Shell Armor", moves: ["Body Slam"] }, slow],
  turns: [["move 1 1, move 1 1", "move 1 2, move 1"]],
  lines: /^\|(move|-item|-enditem)\|/,
})));

// Q2. Skill Swap gives a foe Intimidate: setAbility runs the new ability's Start, so Intimidate acts on the swap.
if (want("Q2")) report("Q2 sv: Skill Swap (Gyarados, Intimidate) <-> Snorlax (Thick Fat); Worry Seed on a sleeping foe", enumerate(base({
  mons: [{ species: "Gyarados", ability: "Intimidate", moves: ["Skill Swap"] }, still, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] }, slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]],
  setup: (b) => { for (const p of [b.p1.active[0], b.p1.active[1], b.p2.active[0], b.p2.active[1]]) p.boosts.atk = 0; },
})));
if (want("Q2")) report("Q2b sv: Worry Seed on a sleeping Snorlax: Insomnia cures the sleep (worryseed onHit), Snorlax then moves", enumerate(base({
  mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Worry Seed"] }, still, { species: "Snorlax", ability: "Thick Fat", moves: ["Body Slam"] }, slow],
  turns: [["move 1 1, move 1", "move 1 2, move 1"]],
  setup: (b) => { b.p2.active[0].setStatus("slp", null, null, true); b.p2.active[0].statusState.time = 3; b.p2.active[0].statusState.startTime = 3; },
})));

// Q3. After You (order 3) and Quash (order 201) in gen 9; gen 7 Quash moves the action to the end by priority -7.1.
for (const game of ["sv", "usum"] as const) if (want("Q3")) {
  const mons: Probe["mons"] = [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Quash", "After You"] }, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] },
    { species: "Lapras", ability: "Shell Armor", moves: ["Splash"] }, { species: "Shuckle", ability: "Gluttony", moves: ["Splash"] }];
  report(`Q3 ${game}: Jolteon Quashes Lapras (80); order of Snorlax (50), Shuckle (25), Lapras`, enumerate(base({ game, mons, turns: [["move 1 1, move 1", "move 1, move 1"]], lines: /^\|move\|/ })), { outcomes: true, lines: false });
  report(`Q3b ${game}: Jolteon uses After You on Shuckle (25): it moves next`, enumerate(base({ game, mons, turns: [["move 2 2, move 1", "move 1, move 1"]], lines: /^\|move\|/ })), { outcomes: true, lines: false });
}

// Q4. Ally Switch (priority +2): moves aimed at a position hit whoever stands there after the swap.
if (want("Q4")) report("Q4 sv: Blissey (p1b) Ally Switches; Lapras Body Slams p1a's position (Jolteon before the swap)", enumerate(base({
  mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Splash"] }, { species: "Blissey", ability: "Natural Cure", moves: ["Ally Switch"] },
    { species: "Lapras", ability: "Shell Armor", moves: ["Body Slam"] }, slow],
  turns: [["move 1, move 1", "move 1 1, move 1"]],
  lines: /^\|(move|-damage|swap|-swap|-activate)\|/,
})));

// Q5. HP moves: Heal Pulse ceil(1/2), Floral Healing in Grassy modify(0.667), Life Dew round(1/4) on both, Jungle Healing
// modify(maxhp, 0.25) and cures, Recover round(1/2), Moonlight in sun modify(0.667) (and with Utility Umbrella 0.5),
// Strength Sap (target's Attack with stages, then -1), Pain Split (average of the two).
if (want("Q5")) {
  report("Q5a sv: Heal Pulse (Jolteon) on its ally Chansey at 1 HP; Life Dew (Lapras) at 1 HP both", enumerate(base({
    mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Heal Pulse"] }, still, { species: "Lapras", ability: "Shell Armor", moves: ["Life Dew"] }, slow],
    turns: [["move 1 -2, move 1", "move 1, move 1"]],
    setup: (b) => { hp(b, "p1", 1, 0); hp(b, "p2", 0, 0); hp(b, "p2", 1, 0); },
  })));
  report("Q5b sv: Moonlight (Clefable) in sun, with and without Utility Umbrella; Recover (Snorlax) at 1 HP", enumerate(base({
    mons: [{ species: "Clefable", ability: "Magic Guard", moves: ["Moonlight"] }, { species: "Clefable", ability: "Magic Guard", item: "Utility Umbrella", moves: ["Moonlight"], evs: { spe: 4 } },
      { species: "Snorlax", ability: "Thick Fat", moves: ["Recover"] }, slow],
    turns: [["move 1, move 1", "move 1, move 1"]],
    setup: (b) => { b.field.setWeather("sunnyday", "debug"); hp(b, "p1", 0, 0); hp(b, "p1", 1, 0); hp(b, "p2", 0, 0); },
  })));
  report("Q5c sv: Strength Sap (Jolteon) on +2 Atk Snorlax; Pain Split (Shuckle) with Lapras", enumerate(base({
    mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Strength Sap"] }, still, { species: "Lapras", ability: "Shell Armor", moves: ["Splash"] }, { species: "Shuckle", ability: "Gluttony", moves: ["Pain Split"] }],
    turns: [["move 1 1, move 1", "move 1, move 1 -1"]],
    setup: (b) => { hp(b, "p1", 0, 0.1); b.p2.active[0].boosts.atk = 2; hp(b, "p2", 1, 0.2); },
  })));
  report("Q5d sv: Floral Healing in Grassy Terrain on Chansey; Jungle Healing (Lapras) cures and heals", enumerate(base({
    mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Floral Healing"] }, still, { species: "Lapras", ability: "Shell Armor", moves: ["Jungle Healing"] }, slow],
    turns: [["move 1 -2, move 1", "move 1, move 1"]],
    setup: (b) => { b.field.setTerrain("grassyterrain", "debug"); hp(b, "p1", 1, 0); hp(b, "p2", 0, 0.1); b.p2.active[1].setStatus("psn", null, null, true); },
  })));
  report("Q5e sv: Roost removes Flying for the turn: Earthquake hits a Roosting Talonflame", enumerate(base({
    mons: [{ species: "Talonflame", ability: "Flame Body", moves: ["Roost"] }, still, { species: "Garchomp", ability: "Rough Skin", moves: ["Earthquake"] }, slow],
    turns: [["move 1, move 1", "move 1, move 1"]],
    setup: (b) => { hp(b, "p1", 0, 0.6); },
  })));
}

// Q6. Substitute: costs floor(maxhp/4); a later status move into it fails; a damaging hit damages the substitute; a sound move passes.
if (want("Q6")) report("Q6 sv: Jolteon Substitute; Lapras Thunder Wave into it; Snorlax (p1b) Splash; Shuckle Hyper Voice", enumerate(base({
  mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Substitute"] }, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] },
    { species: "Lapras", ability: "Shell Armor", moves: ["Thunder Wave", "Ice Beam"] }, { species: "Shuckle", ability: "Gluttony", moves: ["Hyper Voice"] }],
  turns: [["move 1, move 1", "move 1 1, move 1"]],
})));
if (want("Q6")) report("Q6b sv: Jolteon Substitute; Lapras Ice Beam into it (lowest roll)", enumerate(base({
  mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Substitute"] }, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] },
    { species: "Lapras", ability: "Shell Armor", moves: ["Ice Beam"] }, slow],
  turns: [["move 1, move 1", "move 1 1, move 1"]],
})));

// Q7. Psych Up copies stages and the crit volatiles (gen 9); Haze clears every stage.
if (want("Q7")) report("Q7 sv: Snorlax +2 Atk with Focus Energy; Jolteon Psych Up on it; Shuckle Haze last", enumerate(base({
  mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Psych Up"] }, still, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] }, { species: "Shuckle", ability: "Gluttony", moves: ["Haze"] }],
  turns: [["move 1 1, move 1", "move 1, move 1"]],
  setup: (b) => { b.p2.active[0].boosts.atk = 2; b.p2.active[0].addVolatile("focusenergy"); },
})));

// Q8. Magic Bounce reflects a single-target status move to its user, and a spread one (String Shot) to the user's side.
if (want("Q8")) {
  report("Q8 sv: Jolteon Thunder Wave into Magic Bounce Espeon", enumerate(base({
    mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Thunder Wave"] }, still, { species: "Espeon", ability: "Magic Bounce", moves: ["Splash"] }, slow],
    turns: [["move 1 1, move 1", "move 1, move 1"]],
  })));
  report("Q8b sv: Lapras String Shot into foes Espeon (Magic Bounce) and Shuckle: reflected onto both of Lapras's side", enumerate(base({
    mons: [{ species: "Espeon", ability: "Magic Bounce", moves: ["Splash"] }, slow, { species: "Lapras", ability: "Shell Armor", moves: ["String Shot"] }, still],
    turns: [["move 1, move 1", "move 1, move 1"]],
  })));
}

// Q9. Prankster status move into a Dark type fails (gen 7+); onto its own Dark ally it works.
if (want("Q9")) report("Q9 sv: Prankster Whimsicott Thunder Wave into Umbreon (Dark)", enumerate(base({
  mons: [{ species: "Whimsicott", ability: "Prankster", moves: ["Thunder Wave"] }, still, { species: "Umbreon", ability: "Synchronize", moves: ["Splash"] }, slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]],
})));

// Q10. Blocks: Electric Terrain stops sleep on grounded; Misty stops status and confusion; Sweet Veil (ally); Safeguard; Good as Gold.
if (want("Q10")) {
  report("Q10 sv: Hypnosis in Electric Terrain into grounded Snorlax and Confuse Ray in Misty (second turn)", enumerate(base({
    mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Hypnosis", "Confuse Ray"] }, still, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] }, slow],
    turns: [["move 1 1, move 1", "move 1, move 1"]],
    setup: (b) => { b.field.setTerrain("electricterrain", "debug"); },
  })));
  report("Q10b sv: Hypnosis into Snorlax with a Sweet Veil ally (Alcremie); Thunder Wave into Gholdengo (Good as Gold)", enumerate(base({
    mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Hypnosis"] }, { species: "Raichu", ability: "Static", moves: ["Thunder Wave"] },
      { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] }, { species: "Gholdengo", ability: "Good as Gold", moves: ["Splash"] }],
    turns: [["move 1 1, move 1 2", "move 1, move 1"]],
    setup: (b) => { b.p2.active[1].setAbility("sweetveil"); },
  })));
}

// Q11. Lum / Chesto cure a sleep at the Update after the move, so the Pokémon then moves; Persim cures confusion.
if (want("Q11")) report("Q11 sv: Hypnosis into Chesto Berry Snorlax, then its Body Slam", enumerate(base({
  mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Hypnosis"] }, still, { species: "Snorlax", ability: "Thick Fat", item: "Chesto Berry", moves: ["Body Slam"] }, slow],
  turns: [["move 1 1, move 1", "move 1 2, move 1"]],
})));

// Q12. Curse (Ghost user): user loses floor(maxhp/2), target takes floor(maxhp/4) at the end of the turn (order 12). Non-Ghost: +1/+1/-1 Spe.
if (want("Q12")) report("Q12 sv: Gengar Curse into Snorlax; Belly Drum (Azumarill) at full HP", enumerate(base({
  mons: [{ species: "Gengar", ability: "Cursed Body", moves: ["Curse"] }, { species: "Azumarill", ability: "Huge Power", moves: ["Belly Drum"] }, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] }, slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]],
})));

// Q13. Memento: the user faints at once, its replacement comes only after the turn; the target's drops act on later moves.
if (want("Q13")) report("Q13 sv: Jolteon Memento into Snorlax, then Snorlax Body Slams Chansey", enumerate(base({
  mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Memento"] }, still, { species: "Snorlax", ability: "Thick Fat", moves: ["Body Slam"] }, slow],
  turns: [["move 1 1, move 1", "move 1 2, move 1"]],
  lines: /^\|(move|faint|-unboost|-damage|switch|drag)\|/,
})));

// Q14. Acupressure: one random stat among those below +6 (sample over atk, def, spa, spd, spe, accuracy, evasion).
if (want("Q14")) report("Q14 sv: Acupressure on its ally Snorlax", enumerate(base({
  mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Acupressure"] }, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] }, splash, slow],
  turns: [["move 1 -2, move 1", "move 1, move 1"]],
  lines: /^\|-boost\|/,
})));

// Q15. Teeter Dance confuses every adjacent Pokémon (its ally too); Own Tempo blocks.
if (want("Q15")) report("Q15 sv: Teeter Dance (Jolteon) hits Chansey, Snorlax, Smeargle (Own Tempo)", enumerate(base({
  mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Teeter Dance"] }, still, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] }, { species: "Smeargle", ability: "Own Tempo", moves: ["Splash"] }],
  turns: [["move 1, move 1", "move 1, move 1"]],
  lines: /^\|(-start|-immune|-activate)\|/,
})));

// Q16. Endure: survives a KO hit with 1 HP (priority +4; fails without a later action like Protect).
if (want("Q16")) report("Q16 sv: Jolteon Endure, Snorlax (+6 Atk) Body Slam into it", enumerate(base({
  mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Endure"] }, still, { species: "Snorlax", ability: "Thick Fat", moves: ["Body Slam"] }, slow],
  turns: [["move 1, move 1", "move 1 1, move 1"]],
  setup: (b) => { b.p2.active[0].boosts.atk = 6; },
})));

// Q17. Crafty Shield (priority 3) blocks status moves into its side, its ally's Heal Pulse included?
if (want("Q17")) report("Q17 usum: Chansey Crafty Shield; its ally Jolteon Heal Pulses it; Lapras Thunder Waves it", enumerate(base({
  game: "usum",
  mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Heal Pulse"] }, { species: "Chansey", ability: "Natural Cure", moves: ["Crafty Shield"] },
    { species: "Lapras", ability: "Shell Armor", moves: ["Thunder Wave"] }, slow],
  turns: [["move 1 -2, move 1", "move 1 2, move 1"]],
  setup: (b) => { hp(b, "p1", 1, 0.3); },
})));

// Q18. Instruct makes its target use its move again right away (it moved this turn).
if (want("Q18")) report("Q18 sv: Lapras Body Slams Chansey, then Shuckle Instructs Lapras", enumerate(base({
  mons: [splash, still, { species: "Lapras", ability: "Shell Armor", moves: ["Body Slam"] }, { species: "Shuckle", ability: "Gluttony", moves: ["Instruct"] }],
  turns: [["move 1, move 1", "move 1 2, move 1 -1"]],
  lines: /^\|(move|-damage)\|/,
})));

// Q19. Encore on a target that has moved this turn changes nothing this turn; one still to move uses its last move (needs it).
if (want("Q19")) report("Q19 sv: Encore (Shuckle) into Lapras after Lapras's Body Slam", enumerate(base({
  mons: [splash, still, { species: "Lapras", ability: "Shell Armor", moves: ["Body Slam"] }, { species: "Shuckle", ability: "Gluttony", moves: ["Encore"] }],
  turns: [["move 1, move 1", "move 1 2, move 1 1"]],
  lines: /^\|(move|-start|-fail|cant)\|/,
})));

// Q20. Heal Block (usum) stops a Sitrus Berry and Leftovers on its target.
if (want("Q20")) report("Q20 usum: Heal Block (Jolteon, spread) then Lapras is hit below half: Sitrus not eaten", enumerate(base({
  game: "usum",
  mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Heal Block"] }, { species: "Snorlax", ability: "Thick Fat", moves: ["Body Slam"] },
    { species: "Lapras", ability: "Shell Armor", item: "Sitrus Berry", moves: ["Splash"] }, { species: "Shuckle", ability: "Gluttony", item: "Leftovers", moves: ["Splash"] }],
  turns: [["move 1, move 1 1", "move 1, move 1"]],
  setup: (b) => { hp(b, "p2", 0, 0.6); hp(b, "p2", 1, 0.5); },
})));

// Q21. Focus Energy (+2) with Scope Lens (+1) reaches stage 3: every later hit is critical (gen 7+).
if (want("Q21")) report("Q21 sv: Snorlax Focus Energy with Scope Lens, Body Slam next turn: crit certain", enumerate(base({
  mons: [splash, still, { species: "Snorlax", ability: "Thick Fat", item: "Scope Lens", moves: ["Focus Energy", "Body Slam"] }, slow],
  turns: [["move 1, move 1", "move 1, move 1"], ["move 1, move 1", "move 2 1, move 1"]],
  lines: /^\|(-crit|-start)\|/,
})));

// Q22. Rest: full HP, sleep set to 3 (two turns asleep), cures poison; Synchronize passes Toxic back.
if (want("Q22")) {
  report("Q22 sv: Snorlax (poisoned, 1/3 HP) Rests", enumerate(base({
    mons: [splash, still, { species: "Snorlax", ability: "Thick Fat", moves: ["Rest"] }, slow],
    turns: [["move 1, move 1", "move 1, move 1"]],
    setup: (b) => { hp(b, "p2", 0, 0.33); b.p2.active[0].setStatus("psn", null, null, true); },
  })));
  report("Q22b sv: Toxic into Synchronize Umbreon passes bad poison to the user; both take 1/16 at the end of the turn", enumerate(base({
    mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Toxic"] }, still, { species: "Umbreon", ability: "Synchronize", moves: ["Splash"] }, slow],
    turns: [["move 1 1, move 1", "move 1, move 1"]],
  })));
}

// Q23. Champions Healer (1/2) and Shed Skin (1/3) at the end of the turn.
if (want("Q23")) report("Q23 champions: Healer ally cures a burned partner 1/2; Shed Skin 1/3", enumerate(base({
  game: "champions",
  mons: [{ species: "Audino", ability: "Healer", moves: ["Splash"] }, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] }, { species: "Garchomp", ability: "Rough Skin", moves: ["Splash"] }, { species: "Arbok", ability: "Shed Skin", moves: ["Splash"] }],
  turns: [["move 1, move 1", "move 1, move 1"]],
  setup: (b) => { b.p1.active[1].setStatus("brn", null, null, true); b.p2.active[1].setStatus("brn", null, null, true); },
  lines: /^\|(-curestatus|-activate|-damage)\|/,
})));

// Q24. Good as Gold: a status move from another Pokémon fails on it (onTryHit), an ally's included.
if (want("Q24")) report("Q24 sv: Thunder Wave (foe) and Heal Pulse (ally) into Gholdengo (Good as Gold)", enumerate(base({
  mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Thunder Wave"] }, still, { species: "Gholdengo", ability: "Good as Gold", moves: ["Splash"] }, { species: "Shuckle", ability: "Gluttony", moves: ["Heal Pulse"] }],
  turns: [["move 1 1, move 1", "move 1, move 1 -1"]],
  setup: (b) => { hp(b, "p2", 0, 0.5); },
})));

// Q25. Lightning Rod takes a foe's Thunder Wave (status moves are redirected); Sap Sipper absorbs Spore (+1 Atk).
if (want("Q25")) report("Q25 sv: Jolteon Thunder Wave at Snorlax with a Lightning Rod Raichu partner; Breloom Spore into Sap Sipper Azumarill", enumerate(base({
  mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Thunder Wave"] }, { species: "Breloom", ability: "Technician", moves: ["Spore"] },
    { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] }, { species: "Raichu", ability: "Lightning Rod", moves: ["Splash"] }],
  turns: [["move 1 1, move 1 2", "move 1, move 1"]],
  setup: (b) => { b.p2.active[1].setAbility("lightningrod"); },
})));
if (want("Q25")) report("Q25b sv: Breloom Spore into Sap Sipper Azumarill", enumerate(base({
  mons: [{ species: "Breloom", ability: "Technician", moves: ["Spore"] }, splash, { species: "Azumarill", ability: "Sap Sipper", moves: ["Splash"] }, slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]],
})));

// Q26. Follow Me draws a foe's single-target status move (Thunder Wave) too.
if (want("Q26")) report("Q26 sv: Follow Me (Clefairy) then Jolteon Thunder Wave aimed at Snorlax", enumerate(base({
  mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Thunder Wave"] }, still, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] }, { species: "Clefairy", ability: "Friend Guard", moves: ["Follow Me"] }],
  turns: [["move 1 1, move 1", "move 1, move 1"]],
})));

// Q27. A status move into a Protect, and Wide Guard against a spread status move (gen 6+ Wide Guard blocks spread status moves).
if (want("Q27")) report("Q27 sv: Wide Guard (Chansey) vs Lapras String Shot", enumerate(base({
  mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Splash"] }, { species: "Chansey", ability: "Natural Cure", moves: ["Wide Guard"] },
    { species: "Lapras", ability: "Shell Armor", moves: ["String Shot"] }, slow],
  turns: [["move 1, move 1", "move 1, move 1"]],
})));

// Q28. Toxic inflicted this turn: 1/16 at this end of turn (stage 1), Toxic Thread (Champions: Spe -2 and poison 1/8).
if (want("Q28")) for (const game of ["sv", "champions"] as const) report(`Q28 ${game}: Toxic into Snorlax; Toxic Thread into Shuckle`, enumerate(base({
  game,
  mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Toxic"] }, { species: "Ariados", ability: "Swarm", moves: ["Toxic Thread"] }, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] }, slow],
  turns: [["move 1 1, move 1 2", "move 1, move 1"]],
})));
