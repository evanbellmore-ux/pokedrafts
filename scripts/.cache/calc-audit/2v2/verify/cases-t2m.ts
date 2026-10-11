// status2 T2M- cases (tier2-moves.md §5, renamed by ADDENDUM2 §7.2): wave 1a's (Track V1): H (T2M-SI, T2E-SI-01), S (T2M-FA,
// -FS, -SB, -SP), W (T2M-ALE, -FB, -BE, -AR, -GW, -AS, -SG-01) and A3 (T2M-RI). Step 1's FX- and T2M-VS-01/03/04 are in
// cases-status2-step1.ts; the 1b ones (K, M, CL: T2M-VS-05, -SE, -SCK, -UN, -UNR, -CD, -FV, -BB, -AF, -IO, -RC, -GM, -PS, -ST,
// -UP, -HH, -Q) are V2's. Each scenario runs in the game pair §5 names where every Pokémon and move of it is in that game's
// catalog (v1/who.mjs); a game swapped in is said in the case's checks. Probes: tier2-moves-probes-1…4.ts, guards-probes-3.ts.
// Showdown names; level 50, 31 IVs, Serious nature, 0 EVs unless set (Champions: Stat Points). Wired into cases-se.ts.
import type { Case, CaseMon, Game } from "./case-types";
import { OL, OR, PL, PR, act, carried, idle, lax, mon, slots } from "./case-kit";

const k = (game: Game, n: number) => (game === "champions" ? n : n * 8);
const max = (game: Game) => (game === "champions" ? 32 : 252);
const ev = (game: Game, evs: Record<string, number>) => Object.fromEntries(Object.entries(evs).map(([s, n]) => [s, game === "champions" ? Math.min(32, Math.round(n / 8)) : n]));
const cases: Case[] = [];
const add = (id: string, game: Game, c: Omit<Case, "id" | "game">) => cases.push({ id: `${id}-${game}`, game, ...c });

// =================================== H: the hidden state (T2M §3.1, C20, C21, C27, C38) ===================================
for (const game of ["sv", "champions"] as Game[]) {
  add("T2M-SI-01", game, {
    title: "Garchomp Digs; its ally Excadrill's Earthquake hits it underground at 2x, the foes at the spread 0.75 (T2-SI01)",
    slots: slots(act(mon("Garchomp", "Rough Skin", { nature: "Jolly", evs: ev(game, { spe: 252 }) }), "Dig", PR), act(mon("Excadrill", "Mold Breaker", { evs: ev(game, { atk: 252, spe: 100 }) }), "Earthquake"),
      idle(lax(k(game, 4))), idle(lax(k(game, 8)))),
    checks: "moves.ts dig condition onSourceModifyDamage: Earthquake ×2 into a Dig user; it lands Dig after.",
  });
  add("T2M-SI-02", game, {
    title: "Garchomp Digs; a foe's Body Slam at it misses; the other foe Hippowdon's Earthquake hits it at 2x (T2-SI02)",
    slots: slots(act(mon("Garchomp", "Rough Skin", { evs: ev(game, { spe: 252 }) }), "Dig", PR), idle(lax(k(game, 1))),
      act(mon("Hippowdon", "Sand Force"), "Earthquake"), act(lax(k(game, 2)), "Body Slam", OL)),
    checks: "The invulnerability step: Body Slam [miss]; Earthquake 2x into Dig, 0.75 spread on the others.",
  });
  add("T2M-SI-04", game, {
    title: "Dragonite Flies; a foe's Rock Slide misses it and hits its ally with the spread modifier (T2-SI04)",
    slots: slots(act(mon("Dragonite", "Inner Focus", { evs: ev(game, { spe: 252 }) }), "Fly", PR), idle(lax(k(game, 1))),
      idle(lax(k(game, 2))), act(mon("Tyranitar", "Unnerve"), "Rock Slide")),
    checks: "Rock Slide's spread modifier stays 0.75 on the ally though Dragonite was missed (two targets reached the hit steps).",
  });
  add("T2M-SI-05", game, {
    title: "Dragonite Flies; Tyranitar's Smack Down at it hits and grounds it; a slower Garchomp's Earthquake then hits it (T2-SI04d)",
    slots: slots(act(mon("Dragonite", "Inner Focus", { evs: ev(game, { spe: 252 }) }), "Fly", PR), idle(lax(k(game, 1))),
      act(mon("Garchomp", "Rough Skin", { nature: "Brave", ...(game === "champions" ? {} : { ivs: { spe: 0 } }) }), "Earthquake"), act(mon("Tyranitar", "Unnerve", { evs: ev(game, { spe: 8 }) }), "Smack Down", OL)),
    checks: "Smack Down passes Fly (in its list), cancels the queued release (smackdown onStart removes fly/twoturnmove) and grounds it: Earthquake hits.",
  });
  add("T2M-SI-08", game, {
    title: "Dragapult uses Phantom Force; a foe's Earthquake misses it; a No Guard Golurk's Knock Off at it hits (T2-SI07)",
    slots: slots(act(mon("Dragapult", "Clear Body", { evs: ev(game, { spe: 252 }) }), "Phantom Force", PR), idle(lax(k(game, 1))),
      act(mon("Golurk", "No Guard"), "Knock Off", OL), act(mon("Garchomp", "Rough Skin", { nature: "Brave" }), "Earthquake")),
    checks: "Phantom Force's pass list is empty; No Guard (either side) passes the invulnerability step.",
  });
  add("T2M-SI-10", game, {
    title: "Dragonite Flies; a foe's Gravity lands it; a slower foe's Thunderbolt then hits it (T2-SI09)",
    slots: slots(act(mon("Dragonite", "Inner Focus", { evs: ev(game, { spe: 252 }) }), "Fly", PR), idle(lax(k(game, 1))),
      act(game === "sv" ? mon("Bronzong", "Levitate") : mon("Clefable", "Magic Guard"), "Gravity"), act(lax(0, { nature: "Brave", ...(game === "champions" ? {} : { ivs: { spe: 0 } }) }), "Thunderbolt", OL)),
    checks: "gravity onFieldStart: a Fly user falls (the release cancelled); the later Thunderbolt hits.",
  });
  add("T2M-SI-12", game, {
    title: "Dragonite Flies; a foe's Thunder Wave at it misses; the other foe's spread stat drop misses it and lowers its ally (T2-SI11)",
    slots: slots(act(mon("Dragonite", "Inner Focus", { evs: ev(game, { spe: 252 }) }), "Fly", PR), idle(lax(k(game, 1))),
      act(game === "sv" ? mon("Ampharos", "Static") : mon("Beedrill", "Swarm"), game === "sv" ? "Growl" : "String Shot"), act(mon("Raichu", "Static"), "Thunder Wave", OL)),
    checks: "The status moves' invulnerability step (missesStatus): Thunder Wave [miss]; the spread drop misses Dragonite and lands on its ally.",
  });
  add("T2M-SI-12b", game, {
    title: "Dragonite (+2 Atk, 100 HP) Flies; its ally's Pollen Puff at it misses; a foe's Haze clears its stages; a foe's Perish Song reaches it (T2-SI11b)",
    slots: slots(act(mon("Dragonite", "Inner Focus", { nature: "Jolly", hp: 100, boosts: { atk: 2 }, evs: ev(game, { spe: 252 }) }), "Fly", PR), act(game === "sv" ? mon("Comfey", "Triage") : mon("Florges", "Flower Veil"), "Pollen Puff", OL),
      act(mon("Blastoise", "Torrent"), "Haze"), act(mon("Altaria", "Natural Cure"), "Perish Song")),
    checks: "Haze (field) and Perish Song (all) reach a hidden Pokémon (no hit step), Pollen Puff does not (missesField vs misses).",
  });
  add("T2M-SI-14", game, {
    title: "Dragon Darts at a faster foe that Flies: it is out of reach, so both darts go to its ally",
    slots: slots(act(mon("Dragapult", "Clear Body", { nature: "Brave", ...(game === "champions" ? {} : { ivs: { spe: 0 } }) }), "Dragon Darts", PR), idle(lax(k(game, 1))),
      idle(lax(k(game, 2))), act(game === "sv" ? mon("Dragonite", "Inner Focus", { nature: "Jolly", evs: { spe: 252 } }) : mon("Aerodactyl", "Pressure", { nature: "Jolly", evs: { spe: 32 } }), "Fly", OR)),
    checks: "Dragon Darts' smart target: a target the invulnerability step misses turns the redirection to the other foe for both darts.",
  });
}
for (const game of ["sv"] as Game[]) {
  add("T2M-SI-03", game, {
    title: "Dragonite Flies; a foe's Hurricane at it hits; the other foe Flygon's Gust at it hits at 2x (T2-SI03)",
    slots: slots(act(mon("Dragonite", "Inner Focus", { evs: { spe: 252 } }), "Fly", PR), idle(lax(8)),
      act(mon("Flygon", "Levitate"), "Gust", OL), act(mon("Pelipper", "Keen Eye"), "Hurricane", OL)),
    checks: "fly condition onInvulnerability passes Gust, Twister, Sky Uppercut, Thunder, Hurricane, Smack Down, Thousand Arrows; Gust ×2.",
  });
}
add("T2M-SI-03", "champions", {
  title: "Champions: Dragonite Flies; Pelipper's Hurricane at it hits; a faster Raichu's Thunderbolt at it misses",
  slots: slots(act(mon("Dragonite", "Inner Focus", { evs: { spe: 32 } }), "Fly", PR), idle(lax(1)),
    act(mon("Raichu", "Static"), "Thunderbolt", OL), act(mon("Pelipper", "Keen Eye"), "Hurricane", OL)),
  checks: "Champions has no Gust: Thunderbolt (not in the pass list) misses, Hurricane hits.",
});
add("T2M-SI-06", "usum", {
  title: "USUM: Lopunny Bounces; Pidgeot's Gust at it (power 2x); Dragonite's Twister at it (T2-SI05)",
  slots: slots(act(mon("Lopunny", "Limber", { evs: { spe: 252 } }), "Bounce", PR), idle(lax(8)),
    act(mon("Dragonite", "Inner Focus"), "Twister"), act(mon("Pidgeot", "Keen Eye"), "Gust", OL)),
  checks: "bounce condition: Gust and Twister ×2 base power (onSourceBasePower), not ×2 damage.",
});
add("T2M-SI-06", "swsh", {
  title: "SwSh: Lopunny Bounces; Butterfree's Gust at it (power 2x); Dragonite's Twister at it",
  slots: slots(act(mon("Lopunny", "Limber", { evs: { spe: 252 } }), "Bounce", PR), idle(lax(8)),
    act(mon("Dragonite", "Inner Focus"), "Twister"), act(mon("Butterfree", "Compound Eyes"), "Gust", OL)),
  checks: "The same in SwSh (no Pidgeot there: Butterfree's Gust).",
});
add("T2M-SI-07", "usum", {
  title: "USUM: Kingdra Dives; Starmie's Surf hits it at 2x, its ally and Starmie's own ally at 0.75 (T2-SI06)",
  slots: slots(act(mon("Kingdra", "Sniper", { evs: { spe: 252 } }), "Dive", PR), idle(lax(8)),
    idle(lax(16)), act(mon("Starmie", "Natural Cure"), "Surf")),
  checks: "dive condition onSourceModifyDamage: Surf and Whirlpool ×2 into a Dive user.",
});
add("T2M-SI-07", "sv", {
  title: "SV: Barraskewda Dives; Lapras's Surf hits it at 2x (SV's Kingdra has no Dive)",
  slots: slots(act(mon("Barraskewda", "Propeller Tail"), "Dive", PR), idle(lax(8)),
    idle(lax(16)), act(mon("Lapras", "Shell Armor"), "Surf")),
  checks: "The same in SV.",
});
for (const game of ["sv", "usum"] as Game[]) {
  add("T2M-SI-09", game, {
    title: "Dragonite Flies; a Poison-type Toxapex's Toxic at it, then a non-Poison foe's Toxic at it (T2-SI08)",
    slots: slots(act(mon("Dragonite", "Inner Focus", { evs: { spe: 252 } }), "Fly", PR), idle(lax(8)),
      act(game === "sv" ? mon("Gligar", "Hyper Cutter", { nature: "Brave", ivs: { spe: 0 } }) : lax(0), "Toxic", OL), act(mon("Toxapex", "Limber"), "Toxic", OL)),
    checks: "gen 8+: a Poison-type user's Toxic never misses, the invulnerability step included (sim/battle-actions.ts:621-633); USUM: it misses.",
  });
}
for (const game of ["usum", "swsh"] as Game[]) {
  add("T2M-SI-11", game, {
    title: "Alolan Marowak (Lightning Rod) Digs; a foe's Thunderbolt at its ally is redirected to it and misses (no Sp. Atk rise) (T2-SI10)",
    slots: slots(act(mon("Marowak-Alola", "Lightning Rod", { nature: "Jolly", evs: { spe: 252 } }), "Dig", PR), idle(lax(8)),
      idle(lax(16)), act(lax(0), "Thunderbolt", OR)),
    checks: "Redirection comes before the invulnerability step: the rod takes the move, then it misses; no Lightning Rod boost.",
  });
}
// A two-turn move charged last turn (C38): out of reach from the turn's start; fully paralysed it stays hidden (T2-SI12b, c).
for (const game of ["champions", "sv"] as Game[]) {
  const nite = (extra: Partial<CaseMon>) => carried(mon("Dragonite", "Inner Focus", extra), { charging: "fly" });
  add("T2M-SI-13", game, {
    title: "A paralysed Dragonite released its Fly from last turn: a faster Raichu's Thunderbolt misses; fully paralysed it stays up, else a slower Snorlax's Body Slam hits it after the release (T2-SI12b)",
    slots: slots(act(nite({ status: "par" }), "Fly", PR), idle(lax(k(game, 1))),
      act(lax(0, { nature: "Brave" }), "Body Slam", OL), act(mon("Raichu", "Static", { evs: ev(game, { spe: 252 }) }), "Thunderbolt", OL)),
    checks: "Hidden from the turn's start (twoturnmove + fly); full paralysis (1/4) stops the release and keeps it hidden to the end of the turn.",
  });
  add("T2M-SI-13b", game, {
    title: "The same without paralysis: Fly released before the slower Body Slam, which then hits (T2-SI12c)",
    slots: slots(act(nite({}), "Fly", PR), idle(lax(k(game, 1))),
      act(lax(0, { nature: "Brave" }), "Body Slam", OL), act(mon("Raichu", "Static", { evs: ev(game, { spe: 252 }) }), "Thunderbolt", OL)),
    checks: "The release removes the hidden state at its TryMove: Body Slam hits Dragonite.",
  });
  add("T2E-SI-01", game, {
    title: "E2: Dragonite charges Fly this turn (charging after the turn)",
    outcomes: true,
    slots: slots(act(mon("Dragonite", "Inner Focus"), "Fly", PR), idle(lax(k(game, 1))), idle(lax(k(game, 2))), idle(lax(k(game, 3)))),
    checks: "E2: DoublesOutcomeMon.charging \"fly\", volatiles twoturnmove and fly.",
  });
  add("T2E-SI-01b", game, {
    title: "E2: Dragonite charges Fly; a slower foe's Gravity lands it: nothing charging after the turn",
    outcomes: true,
    slots: slots(act(mon("Dragonite", "Inner Focus", { evs: ev(game, { spe: 252 }) }), "Fly", PR), idle(lax(k(game, 1))),
      act(game === "sv" ? mon("Bronzong", "Levitate") : mon("Clefable", "Magic Guard"), "Gravity"), idle(lax(k(game, 3)))),
    checks: "Gravity's landing removes twoturnmove and fly: no charging.",
  });
}
add("IN-CHG-01b", "sv", {
  title: "Garchomp's Dig charged last turn, fully out of reach: the Earthquake from the foe's side before its release hits it at 2x",
  slots: slots(act(mon("Weavile", "Pressure", { evs: { spe: 252 } }), "Night Slash", PR), act(mon("Excadrill", "Mold Breaker", { evs: { spe: 252 } }), "Earthquake"),
    idle(lax(8)), act(carried(mon("Garchomp", "Rough Skin"), { charging: "dig" }), "Dig", OL)),
  checks: "IN-P03's other half: hidden from the start, Earthquake ×2 into Dig before Garchomp's release (Excadrill is faster).",
});

// =================================== S: faces and Substitutes (T2M §3.13, §3.22, §3.23, §3.25) ===================================
const kyu = (extra: Partial<CaseMon> = {}) => mon("Mimikyu", "Disguise", extra);
add("T2M-FA-01", "sv", {
  title: "Ambipom's Double Hit into an intact Mimikyu: hit 1 takes no damage (the 1/8 chip), hit 2 into the busted form (T2-FA01)",
  slots: slots(act(mon("Ambipom", "Technician", { evs: { spe: 252 } }), "Double Hit", PR), idle(lax(8)), idle(lax(16)), idle(kyu())),
  checks: "SV Disguise: the first hit takes 0 and 1/8 at the Update (form change), the second hits Mimikyu-Busted.",
});
add("T2M-FA-01", "usum", {
  title: "USUM: the same Double Hit: no chip in generation 7",
  slots: slots(act(mon("Ambipom", "Technician", { evs: { spe: 252 } }), "Double Hit", PR), idle(lax(8)), idle(lax(16)), idle(kyu())),
  checks: "Gen 7 Disguise: no 1/8 damage.",
});
add("T2M-FA-02", "swsh", {
  title: "SwSh: Dragonite's Dual Wingbeat into an intact Eiscue: hit 1 takes no damage, Noice Face at the Update, hit 2 into Noice (T2-FA02)",
  slots: slots(act(mon("Dragonite", "Inner Focus", { evs: { spe: 252 } }), "Dual Wingbeat", PR), idle(lax(8)), idle(lax(16)), idle(mon("Eiscue", "Ice Face"))),
  checks: "iceface: a physical hit takes 0, the form changes at the Update before hit 2 (its lower Defense).",
});
add("T2M-FA-02", "sv", {
  title: "SV: Corviknight's Dual Wingbeat into an intact Eiscue (SV's Dragonite has no Dual Wingbeat)",
  slots: slots(act(mon("Corviknight", "Pressure", { evs: { spe: 252 } }), "Dual Wingbeat", PR), idle(lax(8)), idle(lax(16)), idle(mon("Eiscue", "Ice Face"))),
  checks: "The same in SV.",
});
for (const game of ["champions", "usum"] as Game[]) {
  add("T2M-FA-03", game, {
    title: "Mega Kangaskhan's Parental Bond Crunch into an intact Mimikyu: the first strike takes no damage, the second (x0.25) into the busted form (T2-FA03)",
    slots: slots(act(mon("Kangaskhan", "Parental Bond", { item: "Kangaskhanite", choice: "mega", appSpecies: "kangaskhanmega", evs: ev(game, { spe: 252 }) }), "Crunch", PR), idle(lax(k(game, 1))), idle(lax(k(game, 2))), idle(kyu())),
    checks: "Parental Bond's second strike through the continuation: Disguise busted by the first, the second at 0.25.",
  });
}
const FACE_ITEMS: [string, string, string, string][] = [
  ["T2M-FA-04", "Rocky Helmet", "Crunch", "a contact hit into an intact Mimikyu with Rocky Helmet: the 0-damage hit still hurts the attacker"],
  ["T2M-FA-05", "Leftovers", "Knock Off", "Knock Off into an intact Mimikyu with Leftovers: the item is knocked off"],
  ["T2M-FA-06", "Air Balloon", "Crunch", "a hit into an intact Mimikyu with Air Balloon: it pops"],
  ["T2M-FA-07", "Kee Berry", "Crunch", "a physical hit into an intact Mimikyu with Kee Berry: eaten"],
  ["T2M-FA-08", "Sticky Barb", "Crunch", "a contact hit into an intact Mimikyu with Sticky Barb: the Barb moves"],
  ["T2M-FA-09", "Leftovers", "Thief", "Thief (no item) into an intact Mimikyu with Leftovers: taken"],
  ["T2M-FA-10", "Leftovers", "Fire Spin", "Fire Spin into an intact Mimikyu: trapped"],
  ["T2M-FA-11", "Leftovers", "Salt Cure", "Salt Cure into an intact Mimikyu: the salt cure volatile"],
];
for (const [id, item, move, title] of FACE_ITEMS) {
  // Champions has no Kee Berry or Sticky Barb: those two run in SV and USUM.
  for (const game of (["T2M-FA-07", "T2M-FA-08"].includes(id) ? ["sv", "usum"] : ["sv", "champions"]) as Game[]) {
    const user = move === "Salt Cure" ? mon("Garganacl", "Purifying Salt", { evs: ev(game, { spe: 252 }) }) : move === "Fire Spin" ? mon("Arcanine", "Intimidate", { evs: ev(game, { spe: 252 }) })
      : move === "Crunch" ? mon("Garchomp", "Rough Skin", { evs: ev(game, { spe: 252 }) }) : mon("Weavile", "Pressure", { evs: ev(game, { spe: 252 }) });
    add(id, game, {
      title: `${title} (T2-${id.slice(4)})`, outcomes: true,
      slots: slots(act(user, move, PR), idle(lax(k(game, 1))), idle(lax(k(game, 2))), idle(kyu({ item }))),
      checks: "The 0-damage face hit runs DamagingHit and the move's hit effects (T2M §3.13).",
    });
  }
}
for (const game of ["sv", "champions"] as Game[]) {
  add("T2M-FA-12", game, {
    title: "A Magician Delphox (no item) Flamethrower into an intact Mimikyu with Leftovers: Magician takes it (T2-FA12)", outcomes: true,
    slots: slots(act(mon("Delphox", "Magician", { evs: ev(game, { spe: 252 }) }), "Flamethrower", PR), idle(lax(k(game, 1))), idle(lax(k(game, 2))), idle(kyu({ item: "Leftovers" }))),
    checks: "Magician onAfterMoveSecondarySelf after the 0-damage hit.",
  });
}
for (const game of ["sv", "usum"] as Game[]) {
  add("T2M-FA-13a", game, {
    title: "A physical hit into an intact Mimikyu with a Jaboca Berry: the 0-damage hit and the Berry", outcomes: true,
    slots: slots(act(mon("Weavile", "Pressure", { evs: { spe: 252 } }), "Night Slash", PR), idle(lax(8)), idle(lax(16)), idle(kyu({ item: "Jaboca Berry" }))),
    checks: "jabocaberry onDamagingHit (the oracle decides the 0-damage hit).",
  });
  add("T2M-FA-13b", game, {
    title: "An Electric hit into an intact Mimikyu with a Cell Battery", outcomes: true,
    slots: slots(act(mon("Raichu", "Static", { evs: { spe: 252 } }), "Thunderbolt", PR), idle(lax(8)), idle(lax(16)), idle(kyu({ item: "Cell Battery" }))),
    checks: "cellbattery onDamagingHit on a 0-damage face hit.",
  });
  add("T2M-FS-01", game, {
    title: "A confused intact Mimikyu hurts itself: Disguise takes the self-hit (T2-FA13)", outcomes: true,
    slots: slots(act(carried(kyu({ evs: { spe: 252 } }), { confusion: { attempts: 0 } }), "Shadow Claw", PR), idle(lax(8)), idle(lax(16)), idle(lax(24))),
    checks: "The confusion self-hit is a move effect: Disguise busts on it (SV also its 1/8).",
  });
  add("T2M-FS-02", game, {
    title: "A confused intact Mimikyu with No move hurts itself: Disguise takes the self-hit", outcomes: true,
    slots: slots(idle(carried(kyu({ evs: { spe: 252 } }), { confusion: { attempts: 0 } })), idle(lax(8)), idle(lax(16)), idle(lax(24))),
    checks: "The No-move (Splash) self-hit into Disguise.",
  });
}
add("T2M-FA-13c", "usum", {
  title: "USUM: Smelling Salts into a paralysed intact Mimikyu: the cure on the 0-damage hit (SV has no Smelling Salts)", outcomes: true,
  slots: slots(act(mon("Hariyama", "Thick Fat", { evs: { spe: 252 } }), "Smelling Salts", PR), idle(lax(8)), idle(lax(16)), idle(kyu({ status: "par" }))),
  checks: "smellingsalts onHit cures paralysis; its doubled power reads the status (the face takes 0).",
});
for (const [suffix, move, title] of [["a", "Crunch", "Max Darkness (Sp. Def −1 on every foe)"], ["b", "Superpower", "Max Knuckle (Atk +1 on the user's side)"], ["c", "Thunderbolt", "Max Lightning (Electric Terrain)"]] as const) {
  add(`T2M-SB-01${suffix}`, "swsh", {
    title: `SwSh: a Dynamaxed Snorlax's ${title} into a 300-HP Substitute (T2-SB0${"abc".indexOf(suffix) + 1})`, outcomes: true,
    slots: slots(act(lax(252, { choice: "dynamax" }), move, PR), idle(lax(8)), idle(lax(24)), idle(lax(16, { substitute: 300 }))),
    checks: "A Max Move into a Substitute: its secondary effects still apply (T2M §3.22).",
  });
}
add("T2M-SB-02", "usum", {
  title: "USUM: Lycanroc's Splintered Stormshards into a Substitute on Psychic Terrain: the terrain ends (T2-SB05)", outcomes: true,
  field: { terrain: "Psychic" },
  slots: slots(act(mon("Lycanroc", "Sand Rush", { item: "Lycanium Z", choice: "zmove", evs: { spe: 252 } }), "Stone Edge", PR), idle(lax(8)), idle(lax(24)), idle(lax(16, { substitute: 300 }))),
  checks: "The signature Z-Move's terrain removal happens though it hit a Substitute.",
});
add("T2M-SB-02b", "usum", {
  title: "USUM: Mew's Genesis Supernova into a Substitute: the Psychic Terrain it sets", outcomes: true,
  slots: slots(act(mon("Mew", "Synchronize", { item: "Mewnium Z", choice: "zmove", evs: { spe: 252 } }), "Psychic", PR), idle(lax(8)), idle(lax(24)), idle(lax(16, { substitute: 300 }))),
  checks: "Genesis Supernova's terrain (a self effect) behind a Substitute: the oracle decides.",
});
add("T2M-SB-03", "usum", {
  title: "USUM: Blacephalon's Mind Blown into two Substitutes: its half-HP cost", outcomes: true,
  slots: slots(act(mon("Blacephalon", "Beast Boost", { evs: { spe: 252 } }), "Mind Blown"), idle(lax(8)), idle(lax(24, { substitute: 50 })), idle(lax(16, { substitute: 50 }))),
  checks: "Mind Blown's cost (mindBlownRecoil) with every target a Substitute.",
});
for (const game of ["sv", "champions"] as Game[]) {
  add("T2M-SB-04", game, {
    title: "A Magician Delphox (no item) Flamethrower into a Substitute holder with Leftovers: nothing taken", outcomes: true,
    slots: slots(act(mon("Delphox", "Magician", { evs: ev(game, { spe: 252 }) }), "Flamethrower", PR), idle(lax(k(game, 1))), idle(lax(k(game, 2))), idle(lax(k(game, 3), { item: "Leftovers", substitute: 50 }))),
    checks: "Magician needs the target hit (not its Substitute).",
  });
}
for (const game of ["champions", "usum"] as Game[]) {
  const kanga = mon("Kangaskhan", "Parental Bond", { item: "Kangaskhanite", choice: "mega", appSpecies: "kangaskhanmega", evs: ev(game, { spe: 252 }) });
  // Champions' Mega Kangaskhan has no Power-Up Punch: its Crunch (two strikes) there.
  const punch = game === "usum" ? "Power-Up Punch" : "Crunch";
  add("T2M-SB-05", game, {
    title: `Mega Kangaskhan's ${punch} into a 300-HP Substitute: two strikes${game === "usum" ? ", two Attack rises" : ""} (T2-SB06)`, outcomes: true,
    slots: slots(act(kanga, punch, PR), idle(lax(k(game, 1))), idle(lax(k(game, 2))), idle(lax(k(game, 3), { substitute: 300 }))),
    checks: "Each strike into the Substitute raises Attack (self effect).",
  });
  add("T2M-SB-05b", game, {
    title: "The same into a 20-HP Substitute: the first strike breaks it, the second hits the Pokémon (T2-SB06b)", outcomes: true,
    slots: slots(act(kanga, punch, PR), idle(lax(k(game, 1))), idle(lax(k(game, 2))), idle(lax(k(game, 3), { substitute: 20 }))),
    checks: "The continuation with `fresh` after the break.",
  });
}
add("T2M-SP-01", "sv", {
  title: "Corviknight's Dual Wingbeat into a full-HP Multiscale Dragonite's 30-HP Substitute: the first hit breaks it, the second meets Multiscale (T2-SP01)", outcomes: true,
  slots: slots(act(mon("Corviknight", "Pressure", { evs: { atk: 252, spe: 252 } }), "Dual Wingbeat", PR), idle(lax(8)), idle(lax(24)), idle(mon("Dragonite", "Multiscale", { substitute: 30 }))),
  checks: "sub-per-hit: the second hit is a fresh calculation at full HP (Multiscale halves it).",
});
add("T2M-SP-01", "champions", {
  title: "Champions: Aerodactyl's Dual Wingbeat into the same Substitute", outcomes: true,
  slots: slots(act(mon("Aerodactyl", "Pressure", { evs: { atk: 32, spe: 32 } }), "Dual Wingbeat", PR), idle(lax(1)), idle(lax(3)), idle(mon("Dragonite", "Multiscale", { substitute: 30 }))),
  checks: "The same in Champions.",
});
for (const game of ["sv", "swsh"] as Game[]) {
  add("T2M-SP-02", game, {
    title: "Cloyster's Icicle Spear into a Stamina Mudsdale's 40-HP Substitute: Stamina after the break", outcomes: true,
    slots: slots(act(mon("Cloyster", "Skill Link", { evs: { spe: 252 } }), "Icicle Spear", PR), idle(lax(8)), idle(lax(24)), idle(mon("Mudsdale", "Stamina", { substitute: 40 }))),
    checks: "Each hit after the break raises its Defense (Stamina) before the next.",
  });
}
for (const game of ["usum", "sv"] as Game[]) {
  add("T2M-SP-03", game, {
    title: "Breloom's Bullet Seed into a Rindo Berry Snorlax's 30-HP Substitute", outcomes: true,
    slots: slots(act(mon("Breloom", "Technician", { evs: { spe: 252 } }), "Bullet Seed", PR), idle(lax(8)), idle(lax(24)), idle(lax(16, { item: "Rindo Berry", substitute: 30 }))),
    checks: "The resist Berry is read by the first hit into the Pokémon after the break.",
  });
}

// =================================== W: the pairwise step's environment (T2M §3.5, §3.14–§3.18, §3.27) ===================================
for (const game of ["sv", "champions"] as Game[]) {
  add("T2M-ALE-01", game, {
    title: "Pikachu's Quick Attack into its own Armor Tail ally on Psychic Terrain: not blocked (guards-probes-3 R1)",
    field: { terrain: "Psychic" },
    slots: slots(act(mon("Pikachu", "Static", { evs: ev(game, { spe: 252 }) }), "Quick Attack", OR), idle(mon("Farigiraf", "Armor Tail")), idle(lax(k(game, 2))), idle(lax(k(game, 3)))),
    checks: "Psychic Terrain and the priority shields stop only a foe's priority move (conditions.allyTarget).",
  });
}
for (const game of ["usum", "sv"] as Game[]) {
  add("T2M-ALE-02", game, {
    title: "Azumarill's Aqua Jet into its own Dazzling Bruxish ally on Psychic Terrain: not blocked",
    field: { terrain: "Psychic" },
    slots: slots(act(mon("Azumarill", "Huge Power"), "Aqua Jet", OR), idle(mon("Bruxish", "Dazzling")), idle(lax(16)), idle(lax(24))),
    checks: "Dazzling (onFoeTryMove) does not stop the ally's move.",
  });
}
for (const game of ["sv", "champions"] as Game[]) {
  add("T2M-FB-01", game, {
    title: "Garchomp's Dragon Claw into a Focus Band Snorlax at 30 HP: 1/10 it survives at 1 HP (O1)",
    slots: slots(act(mon("Garchomp", "Rough Skin", { evs: ev(game, { atk: 252, spe: 252 }) }), "Dragon Claw", PR), idle(lax(k(game, 4))), idle(lax(k(game, 12))), idle(lax(k(game, 8), { item: "Focus Band", hp: 30 }))),
    checks: "focusband onDamage: randomChance(1, 10) on the knocking hit (0.9 / 0.1).",
  });
}
add("T2M-FB-02", "sv", {
  title: "Corviknight's Dual Wingbeat into a Focus Band Snorlax at 20 HP: each hit can knock out (O1b)",
  slots: slots(act(mon("Corviknight", "Pressure", { evs: { atk: 252, spe: 252 } }), "Dual Wingbeat", PR), idle(lax(32)), idle(lax(96)), idle(lax(64, { item: "Focus Band", hp: 20 }))),
  checks: "Focus Band per knocking hit: 0.99 / 0.01 to survive both.",
});
add("T2M-FB-02", "usum", {
  title: "USUM: Ambipom's Double Hit into a Focus Band Snorlax at 20 HP (no Dual Wingbeat in USUM)",
  slots: slots(act(mon("Ambipom", "Technician", { evs: { atk: 252, spe: 252 } }), "Double Hit", PR), idle(lax(32)), idle(lax(96)), idle(lax(64, { item: "Focus Band", hp: 20 }))),
  checks: "Per hit, as O1b.",
});
for (const game of ["sv", "swsh"] as Game[]) {
  add("T2M-FB-03", game, {
    title: "A confused Snorlax at 10 HP with Focus Band and No move: the self-hit's 1/10 (T2-FB01)",
    slots: slots(idle(carried(lax(252, { item: "Focus Band", hp: 10 }), { confusion: { attempts: 0 } })), idle(lax(8)), idle(lax(16)), idle(lax(24))),
    checks: "The confusion self-hit is a Move effect: Focus Band can hold it (0.1).",
  });
}
add("T2M-BE-01", "sv", {
  title: "Corviknight's Dual Wingbeat into a Ganlon Berry Snorlax at 110 HP: Ganlon between the hits, hit 2 weaker (T2-BE01)",
  slots: slots(act(mon("Corviknight", "Pressure", { nature: "Adamant", evs: { atk: 252, spe: 252 } }), "Dual Wingbeat", PR), idle(lax(8)), idle(lax(24)), idle(lax(16, { item: "Ganlon Berry", hp: 110 }))),
  checks: "The Update between hits (stopAt): Ganlon +1 Def at the quarter line, hit 2 at +1.",
});
add("T2M-BE-01", "usum", {
  title: "USUM: Ambipom's Double Hit into the same Ganlon Snorlax",
  slots: slots(act(mon("Ambipom", "Technician", { nature: "Adamant", evs: { atk: 252, spe: 252 } }), "Double Hit", PR), idle(lax(8)), idle(lax(24)), idle(lax(16, { item: "Ganlon Berry", hp: 60 }))),
  checks: "The same in USUM.",
});
add("T2M-BE-02", "swsh", {
  title: "SwSh: Dragonite's Dual Wingbeat into a Starf Berry Snorlax at 110 HP: Starf between the hits (+2 to a random stat) (T2-BE02)",
  slots: slots(act(mon("Dragonite", "Inner Focus", { nature: "Adamant", evs: { atk: 252, spe: 252 } }), "Dual Wingbeat", PR), idle(lax(8)), idle(lax(24)), idle(lax(16, { item: "Starf Berry", hp: 110 }))),
  checks: "starfberry: sample over the stats below +6; hit 2 reads a Defense +2.",
});
add("T2M-BE-02", "sv", {
  title: "SV: Corviknight's Dual Wingbeat into the same Starf Snorlax",
  slots: slots(act(mon("Corviknight", "Pressure", { nature: "Adamant", evs: { atk: 252, spe: 252 } }), "Dual Wingbeat", PR), idle(lax(8)), idle(lax(24)), idle(lax(16, { item: "Starf Berry", hp: 110 }))),
  checks: "The same in SV.",
});
add("T2M-BE-03", "usum", {
  title: "USUM: Greninja's Water Shuriken (2–5 hits) into an Apicot Berry Snorlax at 80 HP: Apicot between the hits",
  slots: slots(act(mon("Greninja", "Torrent", { evs: { spa: 252, spe: 252 } }), "Water Shuriken", PR), idle(lax(8)), idle(lax(24)), idle(lax(16, { item: "Apicot Berry", hp: 80 }))),
  checks: "A special multi-hit move: Apicot +1 Sp. Def at the quarter line, the later hits at +1.",
});
add("T2M-BE-03", "swsh", {
  title: "SwSh: Accelgor's Water Shuriken into the same Apicot Snorlax",
  slots: slots(act(mon("Accelgor", "Hydration", { evs: { spa: 252, spe: 252 } }), "Water Shuriken", PR), idle(lax(8)), idle(lax(24)), idle(lax(16, { item: "Apicot Berry", hp: 80 }))),
  checks: "The same in SwSh (Greninja's Water Shuriken is not in its catalog there).",
});
for (const game of ["sv", "swsh"] as Game[]) {
  add("T2M-BE-04", game, {
    title: "A two-hit move into Dedenne (Cheek Pouch) at 70 HP holding a Lansat Berry: Lansat and Cheek Pouch between the hits",
    slots: slots(act(game === "sv" ? mon("Corviknight", "Pressure", { evs: { spe: 252 } }) : mon("Dragonite", "Inner Focus", { evs: { spe: 252 } }), "Dual Wingbeat", PR), idle(lax(8)), idle(lax(24)), idle(mon("Dedenne", "Cheek Pouch", { item: "Lansat Berry", hp: 70 }))),
    checks: "Lansat (Focus Energy) and Cheek Pouch's 1/3 heal at the Update between hits.",
  });
}
for (const game of ["sv", "champions"] as Game[]) {
  add("T2M-AR-01", game, {
    title: "Primarina at 5 HP with Life Orb: Sparkling Aria hits a burned foe; Life Orb knocks it out after the hits; the burn is cured (T2-AR01)",
    slots: slots(act(mon("Primarina", "Torrent", { item: "Life Orb", hp: 5, evs: ev(game, { spe: 252 }) }), "Sparkling Aria"), act(lax(k(game, 1)), "Protect"),
      idle(lax(k(game, 2), { status: "brn" })), act(lax(k(game, 3)), "Protect")),
    checks: "sparklingaria onAfterMove cures unless the user fainted in the hits (faintedInHits): Life Orb's knockout comes after.",
  });
}
for (const game of ["sv", "usum"] as Game[]) {
  add("T2M-AR-02", game, {
    title: "Primarina at 5 HP: Sparkling Aria hits a burned foe holding a Rowap Berry, which knocks Primarina out in the hit: no cure (T2-AR02)",
    slots: slots(act(mon("Primarina", "Torrent", { hp: 5, evs: { spe: 252 } }), "Sparkling Aria"), act(lax(8), "Protect"),
      idle(lax(16, { status: "brn", item: "Rowap Berry" })), act(lax(24), "Protect")),
    checks: "A knockout in the hits (Rowap's damage): the burn stays.",
  });
}
add("T2M-GW-01", "usum", {
  title: "USUM: Talonflame at full HP: its Brave Bird's priority is frozen at +1 though a foe's Fake Out hits it first; Dazzling Bruxish stops it (T2-GW01-usum)",
  slots: slots(act(mon("Talonflame", "Gale Wings", { evs: { spe: 252 } }), "Brave Bird", PR), idle(lax(8)),
    act(mon("Ambipom", "Technician"), "Fake Out", OL), idle(mon("Bruxish", "Dazzling"))),
  checks: "Gen 7 freezes priority at the turn's start (MoveContext.frozenPriority): +1 although Talonflame is no longer at full HP; Dazzling blocks it.",
});
add("T2M-GW-02", "usum", {
  title: "USUM: Talonflame below full HP (priority frozen at 0) healed to full by its ally's Heal Pulse before it moves: Psychic Terrain does not stop its Brave Bird",
  field: { terrain: "Psychic" },
  slots: slots(act(mon("Talonflame", "Gale Wings", { hp: 100 }), "Brave Bird", PR), act(mon("Blissey", "Natural Cure", { evs: { spe: 252 } }), "Heal Pulse", OL),
    idle(lax(16)), idle(lax(8))),
  checks: "Frozen at 0 at the start (not at full HP): no priority block, though it is at full HP when it moves.",
});
for (const game of ["sv", "champions"] as Game[]) {
  add("T2M-AS-01", game, {
    title: "A foe Arcanine's Flare Blitz (recoil) first; then Assurance into it is doubled (T2-AS01)",
    slots: slots(idle(lax(k(game, 1))), act(game === "sv" ? mon("Kingambit", "Defiant") : mon("Incineroar", "Blaze"), game === "sv" ? "Assurance" : "Assurance", PR),
      idle(lax(k(game, 2))), act(mon("Arcanine", "Intimidate", { evs: ev(game, { spe: 252 }) }), "Flare Blitz", OL)),
    checks: "Assurance doubles if its target was hurt this turn, its own recoil included (hurtThisTurn).",
  });
}
for (const game of ["sv", "usum"] as Game[]) {
  add("T2M-AS-02", game, {
    title: "A foe Garchomp's Life Orb Dragon Claw first; then Assurance into it is doubled",
    slots: slots(idle(lax(8)), act(game === "sv" ? mon("Kingambit", "Defiant") : mon("Absol", "Pressure"), "Assurance", PR),
      idle(lax(16)), act(mon("Garchomp", "Rough Skin", { item: "Life Orb", evs: { spe: 252 } }), "Dragon Claw", OL)),
    checks: "The Life Orb loss sets hurtThisTurn: Assurance ×2.",
  });
}
for (const game of ["sv", "champions"] as Game[]) {
  add("T2M-SG-01", game, {
    title: "A foe sets Safeguard this turn; a later Nuzzle into its side paralyses nothing; an Infiltrator Chandelure's Inferno burns through it", outcomes: true,
    slots: slots(act(mon("Pikachu", "Static"), "Nuzzle", PR), act(mon("Chandelure", "Infiltrator"), "Inferno", PL),
      idle(lax(k(game, 1))), act(mon("Altaria", "Natural Cure", { evs: ev(game, { spe: 252 }) }), "Safeguard")),
    checks: "UsesEnv.safeguard: a damaging move's status is stopped by Safeguard unless the user has Infiltrator.",
  });
}

// =================================== A3: a received item used at once (T2M §3.21) ===================================
for (const game of ["sv", "champions"] as Game[]) {
  add("T2M-RI-01", game, {
    title: "On Electric Terrain, a Klutz Golurk Tricks its Electric Seed onto a foe: the foe uses it at once (+1 Def)", outcomes: true,
    field: { terrain: "Electric" },
    slots: slots(act(mon("Golurk", "Klutz", { item: "Electric Seed", evs: ev(game, { spe: 252 }) }), "Trick", PR), idle(lax(k(game, 1))), idle(lax(k(game, 3))), idle(lax(k(game, 2), { item: "Leftovers" }))),
    checks: "The Seed's Update after Trick (status-eot T10c); Klutz kept the giver from using it.",
  });
}
for (const game of ["swsh", "sv"] as Game[]) {
  add("T2M-RI-02", game, {
    title: "Under Trick Room, a Klutz Golurk Tricks its Room Service onto a foe: used at once (Spe −1)", outcomes: true,
    field: { trickRoom: true },
    slots: slots(act(mon("Golurk", "Klutz", { item: "Room Service" }), "Trick", PR), idle(lax(8)), idle(lax(16)), idle(lax(252, { item: "Leftovers" }))),
    checks: "roomservice onUpdate under Trick Room after the Trick.",
  });
}

/** Wave 1a's T2M- cases. */
export const T2M_CASES: Case[] = cases;
void PL; void OL;
