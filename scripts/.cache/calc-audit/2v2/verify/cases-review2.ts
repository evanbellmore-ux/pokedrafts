// status2 review 2 (ADDENDUM2 §8.8): the review fixer's regression cases, each the turn of a confirmed round-1 finding
// (status2/build/REVIEW2-FIX-1.md) or a variant of it, stored once it agrees with pinned Showdown c23d2e94 (sim-dfs.ts, then
// --validate). Ids: RV2-<the reviewer's or verifier's probe id>-<game> (their probes: K1-/K2- R1-A1-K, RA-/V- R2-A2A3-H,
// RD-/V<n>- R3-DE-F, R4-/V<n>- R4-SW-M, FX- the first fixer's, PA- this fixer's pass A, PB- its pass B, PE- its final pass). Showdown names;
// level 50, 31 IVs, Serious nature, 0 EVs unless set (Champions: Stat Points). A guarded turn states the app's reason
// (notEstimated: no oracle run). Wired into cases-se.ts through cases-wave2.ts (owner "review2 fixer").
import type { Case, CaseBenchMon, CaseMon, Game } from "./case-types";
import { OL, OR, PL, PR, act, carried, idle, mon, slots } from "./case-kit";
import { L, fastEvs, slowest } from "./case-kit2";

const cases: Case[] = [];
/** One case per game: id `RV2-${id}-${game}`, E2 compared (outcomes) unless the case says otherwise. */
const add = (id: string, games: Game[], make: (game: Game) => Omit<Case, "id" | "game">) => {
  for (const game of games) cases.push({ id: `RV2-${id}-${game}`, game, outcomes: true, ...make(game) });
};
const member = (id: string, m: CaseMon): CaseBenchMon => ({ ...m, id });
const bench = (own?: CaseBenchMon[], opponent?: CaseBenchMon[]): Case["bench"] => ({
  ...(own ? { own: { members: own } } : {}), ...(opponent ? { opponent: { members: opponent } } : {}),
});
const fast = (game: Game, m: CaseMon): CaseMon => ({ ...m, evs: { ...(m.evs ?? {}), ...fastEvs(game) } });
const brave = (game: Game, m: CaseMon): CaseMon => ({ ...m, ...slowest(game) });

// =====================================================================================================================
// R1-A1K-01: Ability Shield works under Klutz (data/items.ts abilityshield ignoreKlutz; sim/pokemon.ts ignoringItem).
// Ability Shield is a generation 9 item: SV only (no other game's catalog has it).
// =====================================================================================================================
add("K1-KLUTZ-SHIELD", ["sv"], (game) => ({
  title: "Wyrdeer (Intimidate) Skill Swaps with a Klutz Golurk holding Ability Shield: the Shield works under Klutz, so the swap fails",
  slots: slots(act(fast(game, mon("Wyrdeer", "Intimidate")), "Skill Swap", PR), act(brave(game, mon("Snorlax", "Thick Fat")), "Body Slam", PL), idle(L(game, 2)), idle(mon("Golurk", "Klutz", { item: "Ability Shield" }))),
  checks: "data/items.ts:2-17 abilityshield (ignoreKlutz, onSetAbility null); sim/pokemon.ts:885 ignoringItem; Golurk keeps Klutz, the Body Slam 81–96.",
}));
add("K1-KLUTZ-SHIELD-SBM", ["sv"], (game) => ({
  title: "Simple Beam into a Klutz Golurk with Ability Shield: blocked; Snarl then lowers its Sp. Atk by 1",
  slots: slots(act(fast(game, mon("Smeargle", "Own Tempo")), "Simple Beam", OR), idle(mon("Golurk", "Klutz", { item: "Ability Shield" })), act(brave(game, mon("Arcanine", "Intimidate")), "Snarl"), idle(L(game, 0))),
  checks: "abilityshield onSetAbility under Klutz: no Simple, so Snarl's −1 stays −1.",
}));
add("K1-KLUTZ-SHIELD-GA", ["sv"], (game) => ({
  title: "Gastro Acid into a Klutz Golurk with Ability Shield: blocked (Klutz does not stop Ability Shield)",
  slots: slots(act(fast(game, mon("Eelektross", "Levitate")), "Gastro Acid", PR), idle(L(game, 0)), idle(L(game, 2)), idle(mon("Golurk", "Klutz", { item: "Ability Shield" }))),
  checks: "data/moves.ts gastroacid onTryHit: hasItem('Ability Shield') holds under Klutz (ignoreKlutz).",
}));
add("V1-KS-WS", ["sv"], (game) => ({
  title: "Worry Seed into a Klutz Golurk with Ability Shield: blocked; Spore then puts it to sleep",
  slots: slots(act(fast(game, mon("Comfey", "Natural Cure")), "Worry Seed", PR), act(brave(game, mon("Amoonguss", "Regenerator")), "Spore", PR), idle(L(game, 2)), idle(mon("Golurk", "Klutz", { item: "Ability Shield" }))),
  checks: "worryseed: setAbility through runEvent SetAbility; the Shield blocks it, so no Insomnia and Spore lands.",
}));
add("V1-KS-CTRL", ["sv"], (game) => ({
  title: "Control: Wyrdeer Skill Swaps with a No Guard Golurk holding Ability Shield: blocked",
  slots: slots(act(fast(game, mon("Wyrdeer", "Intimidate")), "Skill Swap", PR), act(brave(game, mon("Snorlax", "Thick Fat")), "Body Slam", PL), idle(L(game, 2)), idle(mon("Golurk", "No Guard", { item: "Ability Shield" }))),
  checks: "The Shield without Klutz (the path that already agreed).",
}));

// =====================================================================================================================
// R1-A1K-02: Receiver inside the knocking move: that move's ignoreAbility (sim/battle.ts:365-368 suppressingAbility; the
// faint batch inside the hit loop, sim/battle-actions.ts:974; data/abilities.ts receiver onAllyFaint).
// =====================================================================================================================
const rcMold = (game: Game, user: CaseMon, move: string, target?: typeof PR, ally: CaseMon = mon("Metagross", "Clear Body")) =>
  slots(act(fast(game, user), move, target), act(brave(game, ally), "Body Slam", PL), idle(mon("Passimian", "Receiver")), idle(mon("Incineroar", "Intimidate", { hp: 1, boosts: {} })));
add("K2-RC-MOLD", ["sv", "swsh", "champions"], (game) => ({
  title: "Mold Breaker Excadrill knocks out a 1 HP Incineroar; Passimian receives Intimidate inside Excadrill's move: its ally Metagross's Clear Body is suppressed (−1 Attack); Metagross's later Body Slam",
  slots: rcMold(game, mon("Excadrill", "Mold Breaker"), "Iron Head", PR),
  checks: "battle.ts:836-840 breakable TryBoost handlers skipped while Iron Head's ignoreAbility holds; Body Slam 34–40 (sv).",
}));
add("K2-RC-MOLD", ["usum"], (game) => ({
  title: "USUM: the same: generation 7's Mold Breaker suppresses the user's own abilities too (holder !== user || gen < 8)",
  slots: rcMold(game, mon("Excadrill", "Mold Breaker"), "Iron Head", PR),
  checks: "The faint batch inside the move; Clear Body suppressed.",
}));
add("K2-RC-MOLD-CTRL", ["sv"], (game) => ({
  title: "Control: Garchomp (Rough Skin) knocks out the 1 HP Incineroar; Passimian's Intimidate is stopped by Metagross's Clear Body",
  slots: rcMold(game, mon("Garchomp", "Rough Skin"), "Iron Head", PR),
  checks: "No ignoreAbility: Clear Body blocks; Body Slam 50–59.",
}));
add("K2-RC-MOLD-MA", ["sv"], (game) => ({
  title: "Mold Breaker Haxorus knocks out a 1 HP Incineroar; Passimian receives Intimidate: Haxorus's ally Corviknight's Mirror Armor is suppressed (no reflect, its Attack falls)",
  slots: rcMold(game, mon("Haxorus", "Mold Breaker"), "Iron Head", PR, mon("Corviknight", "Mirror Armor")),
  checks: "Mirror Armor (breakable) skipped; Body Slam 23–28.",
}));
add("V2-RC-GD", ["sv"], (game) => ({
  title: "Mold Breaker Excadrill knocks out a 1 HP Incineroar; Passimian receives Intimidate: its ally Mabosstiff's Guard Dog is suppressed (−1, not +1)",
  slots: rcMold(game, mon("Excadrill", "Mold Breaker"), "Iron Head", PR, mon("Mabosstiff", "Guard Dog")),
  checks: "Guard Dog (breakable) skipped while the move is active.",
}));
add("V2-RC-SPREAD", ["sv", "champions"], (game) => ({
  title: "Mold Breaker Excadrill's Rock Slide knocks out a 1 HP Incineroar; Passimian receives Intimidate after the hits: Metagross's Clear Body suppressed",
  slots: rcMold(game, mon("Excadrill", "Mold Breaker"), "Rock Slide"),
  checks: "The spread move's faint batch (spreadUser's stashed receive) inside the move.",
}));
add("V2-RC-TERAVOLT", ["sv", "swsh"], (game) => ({
  title: "Teravolt Kyurem-Black knocks out a 1 HP Incineroar; Passimian receives Intimidate: Metagross's Clear Body suppressed",
  slots: rcMold(game, mon("Kyurem-Black", "Teravolt"), "Iron Head", PR),
  checks: "teravolt onModifyMove ignoreAbility, as Mold Breaker.",
}));

// =====================================================================================================================
// R1-A1K-03: Pastel Veil's onAnySwitchIn (data/abilities.ts:3189-3206; gen8 inherits). Pastel Veil: SwSh only.
// =====================================================================================================================
add("K1-PASTEL-NEWCOMER", ["swsh"], (game) => ({
  title: "Liepard U-turns out beside Galarian Rapidash (Pastel Veil); the poisoned newcomer Snorlax is cured as it comes in",
  slots: slots(act(fast(game, mon("Liepard", "Limber")), "U-turn", PL), idle(mon("Rapidash-Galar", "Pastel Veil")), idle(L(game, 2)), idle(L(game, 1))),
  bench: bench([member("laxp", { ...L(game, 3), status: "psn" })]),
  checks: "pastelveil onAnySwitchIn: onStart again, cureStatus on poisoned alliesAndSelf: no Poison residual, 235 HP.",
}));
add("K1-PASTEL-NEWCOMER2", ["swsh"], (game) => ({
  title: "Liepard U-turns out beside a poisoned Snorlax; the newcomer Galarian Rapidash (Pastel Veil) cures it",
  slots: slots(act(fast(game, mon("Liepard", "Limber")), "U-turn", PL), idle({ ...L(game, 0), status: "psn" }), idle(L(game, 2)), idle(L(game, 1))),
  bench: bench([member("rapi", mon("Rapidash-Galar", "Pastel Veil"))]),
  checks: "The newcomer's own Start (the path that already agreed).",
}));
add("V3-PV-TOX", ["swsh"], (game) => ({
  title: "The opponent's Liepard U-turns out beside Galarian Rapidash (Pastel Veil); the badly poisoned newcomer Snorlax is cured",
  slots: slots(idle(L(game, 2)), idle(L(game, 1)), act(fast(game, mon("Liepard", "Limber")), "U-turn", OL), idle(mon("Rapidash-Galar", "Pastel Veil"))),
  bench: bench(undefined, [member("laxt", { ...L(game, 3), status: "tox" })]),
  checks: "pastelveil onAnySwitchIn on the opponent's side: no Bad poison, 235 HP.",
}));

// =====================================================================================================================
// R1-A1K-04: Transform into a Dynamaxed target (sim/pokemon.ts:1270-1350 transformInto: no Dynamax check). SwSh only.
// =====================================================================================================================
add("K1-TRF-DMAX", ["swsh"], (game) => ({
  title: "Ditto Transforms into a Dynamaxed Snorlax (+2 Def); a slower Body Slam into Ditto reads Snorlax's stats and +2 Def",
  slots: slots(act(fast(game, mon("Ditto", "Limber")), "Transform", PR), idle(L(game, 0)), act(brave(game, mon("Snorlax", "Thick Fat")), "Body Slam", OL), { ...L(game, 2, { boosts: { def: 2 }, choice: "dynamax", moves: ["Body Slam"] }), action: { move: "Body Slam", target: OR } }),
  checks: "transformInto copies species, stats, types, boosts and ability; not the dynamax volatile nor the doubled HP.",
}));
add("V4-TRF-DMAX-SPD", ["swsh"], (game) => ({
  title: "Ditto Transforms into a Dynamaxed Garchomp (+1 Sp. Def); a slower Snorlax's Ice Beam hits Ditto",
  slots: slots(act(fast(game, mon("Ditto", "Limber")), "Transform", PR), idle(L(game, 0)), act(brave(game, mon("Snorlax", "Thick Fat")), "Ice Beam", OL), { ...mon("Garchomp", "Rough Skin", { boosts: { spd: 1 }, choice: "dynamax", moves: ["Dragon Claw"] }), action: { move: "Dragon Claw", target: OR } }),
  checks: "The copied +1 Sp. Def and Garchomp's types.",
}));
add("V4-TRF-GMAXK", ["swsh"], (game) => ({
  title: "Ditto Transforms into a Gigantamaxed Kingler (+1 Def); a slower Conkeldurr's Low Kick hits Ditto (Kingler's weight)",
  slots: slots(act(fast(game, mon("Ditto", "Limber")), "Transform", PR), idle(L(game, 0)), act(brave(game, mon("Conkeldurr", "Guts")), "Low Kick", OL), { ...mon("Kingler", "Hyper Cutter", { boosts: { def: 1 }, choice: "dynamax", gigantamax: true, appBuild: { mechanic: "gigantamax", configuration: { dynamaxLevel: 10, gigantamax: true } }, moves: ["X-Scissor"] }), action: { move: "X-Scissor", target: OR } }),
  checks: "Gigantamax keeps the base species (no Gmax formeChange in sim/): the copy as a plain Dynamax one.",
}));

// =====================================================================================================================
// R1-A1K-05: a spread move's Aftermath / Innards Out in the hits' loss group before the Update (data/abilities.ts:78-84
// aftermath onDamagingHit; sim/battle-actions.ts:966-967 the Update after the hits).
// =====================================================================================================================
const chompSpread = (game: Game, extra: Partial<CaseMon>) => fast(game, mon("Garchomp", "Rough Skin", extra));
add("K2-AF-BREAKING", ["sv"], (game) => ({
  title: "Garchomp (Sitrus, 110 HP) Breaking Swipe knocks out a 1 HP Drifblim (Aftermath): a quarter, then the Sitrus at the Update",
  slots: slots(act(chompSpread(game, { item: "Sitrus Berry", hp: 110 }), "Breaking Swipe"), idle(L(game, 0)), idle(mon("Drifblim", "Aftermath", { hp: 1 })), idle(L(game, 1))),
  checks: "aftermath onDamagingHit baseMaxhp/4 (45), the Sitrus at the Update after the hits (110).",
}));
add("K2-RH-BREAKING", ["sv"], (game) => ({
  title: "Control: Garchomp (Sitrus, 110 HP) Breaking Swipe into a Rocky Helmet Snorlax and another: a sixth, then the Sitrus",
  slots: slots(act(chompSpread(game, { item: "Sitrus Berry", hp: 110 }), "Breaking Swipe"), idle(L(game, 0)), idle(L(game, 2, { item: "Rocky Helmet" })), idle(L(game, 1))),
  checks: "rockyhelmet onDamagingHit, the same loss group.",
}));
add("K2-AF-BREAKING-NOBERRY", ["sv"], (game) => ({
  title: "Control: Garchomp (Leftovers, 110 HP) Breaking Swipe knocks out a 1 HP Drifblim (Aftermath): a quarter",
  slots: slots(act(chompSpread(game, { item: "Leftovers", hp: 110 }), "Breaking Swipe"), idle(L(game, 0)), idle(mon("Drifblim", "Aftermath", { hp: 1 })), idle(L(game, 1))),
  checks: "Aftermath with no Berry.",
}));
add("V5-AF-BREAKING-SW", ["swsh"], (game) => ({
  title: "Garchomp (Sitrus, 110 HP) Breaking Swipe knocks out a 1 HP Drifblim (Aftermath): a quarter, then the Sitrus",
  slots: slots(act(chompSpread(game, { item: "Sitrus Berry", hp: 110 }), "Breaking Swipe"), idle(L(game, 0)), idle(mon("Drifblim", "Aftermath", { hp: 1 })), idle(L(game, 1))),
  checks: "As K2-AF-BREAKING in SwSh.",
}));
add("V5-IO-BREAKING", ["swsh"], (game) => ({
  title: "Garchomp (Sitrus, 110 HP) Breaking Swipe knocks out Pyukumuku (Innards Out, 50 HP): 50, then the Sitrus",
  slots: slots(act(chompSpread(game, { item: "Sitrus Berry", hp: 110 }), "Breaking Swipe"), idle(L(game, 0)), idle(mon("Pyukumuku", "Innards Out", { hp: 50 })), idle(L(game, 1))),
  checks: "innardsout onDamagingHit: the HP its holder had.",
}));
add("V5-IO-BREAKING2", ["swsh"], (game) => ({
  title: "Garchomp (Sitrus, 100 HP) Breaking Swipe knocks out Pyukumuku (Innards Out, 15 HP): 15, then the Sitrus",
  slots: slots(act(chompSpread(game, { item: "Sitrus Berry", hp: 100 }), "Breaking Swipe"), idle(L(game, 0)), idle(mon("Pyukumuku", "Innards Out", { hp: 15 })), idle(L(game, 1))),
  checks: "innardsout: 15, the Sitrus at the Update.",
}));
add("PA-AF-SPREAD-KO", ["sv"], (game) => ({
  title: "Garchomp at 40 HP Breaking Swipe knocks out a 1 HP Drifblim (Aftermath 45): Garchomp faints in the faint batch after the hits",
  slots: slots(act(chompSpread(game, { item: "Sitrus Berry", hp: 40 }), "Breaking Swipe"), idle(L(game, 0)), idle(mon("Drifblim", "Aftermath", { hp: 1 })), idle(L(game, 1))),
  checks: "The loss to 0 in the hits' group: no Sitrus, a faint.",
}));
add("PA-AF-RH-SPREAD", ["sv", "swsh"], (game) => ({
  title: "Garchomp (Sitrus, 130 HP) Breaking Swipe: a Rocky Helmet Snorlax (a sixth) and a 1 HP Drifblim (Aftermath, a quarter) together take it under half; the Sitrus at the Update after the hits",
  slots: slots(act(chompSpread(game, { item: "Sitrus Berry", hp: 130 }), "Breaking Swipe"), idle(L(game, 0)), idle(L(game, 2, { item: "Rocky Helmet" })), idle(mon("Drifblim", "Aftermath", { hp: 1 }))),
  checks: "Rocky Helmet and Aftermath summed in one group before the Update.",
}));
add("PA-IO-SPREAD-KO", ["swsh", "usum"], (game) => ({
  title: "Garchomp at 30 HP Rock Slide knocks out Pyukumuku (Innards Out, 40 HP): Garchomp faints in the faint batch",
  slots: slots(act(chompSpread(game, { hp: 30 }), "Rock Slide"), idle(L(game, 0)), idle(mon("Pyukumuku", "Innards Out", { hp: 40 })), idle(L(game, 1))),
  checks: "innardsout's loss knocks out the spread user in the faint batch.",
}));

// =====================================================================================================================
// R2-A2A3-H-1: Defog clears target.side and source.side only (data/moves.ts:3457-3475; gen 7 data/mods/gen7/moves.ts:125-145).
// =====================================================================================================================
const slowU = (game: Game) => brave(game, game === "swsh" ? mon("Liepard", "Limber") : mon("Ambipom", "Technician"));
add("RA-DEFOG-ALLY", ["sv"], (game) => ({
  title: "Defog at its own ally; Stealth Rock on the opponent's side stays; the opponent's slower U-turn brings Charizard in",
  field: { opponent: { hazards: ["stealthrock"] } },
  slots: slots(act(fast(game, mon("Corviknight", "Pressure")), "Defog", OR), idle(L(game, 1)), act(slowU(game), "U-turn", OL), idle(L(game, 3))),
  bench: bench(undefined, [member("zard", mon("Charizard", "Blaze"))]),
  checks: "defog onHit: target.side (own) and source.side (own); Charizard loses half to Stealth Rock (77 HP).",
}));
add("RA-DEFOG-ALLY7", ["usum"], (game) => ({
  title: "USUM: Skarmory's Defog at its own ally; the opponent side keeps Stealth Rock",
  field: { opponent: { hazards: ["stealthrock"] } },
  slots: slots(act(fast(game, mon("Skarmory", "Keen Eye")), "Defog", OR), idle(L(game, 1)), act(slowU(game), "U-turn", OL), idle(L(game, 3))),
  bench: bench(undefined, [member("zard", mon("Charizard", "Blaze"))]),
  checks: "data/mods/gen7/moves.ts defog: the same two sides.",
}));
add("V-DEFOG-SPK", ["sv", "swsh"], (game) => ({
  title: "Defog at its own ally; Spikes on the foe side stays; the foe's slow U-turn newcomer takes Spikes",
  field: { opponent: { hazards: ["spikes"] } },
  slots: slots(idle(L(game, 1)), act(fast(game, mon("Corviknight", "Pressure")), "Defog", OL), act(slowU(game), "U-turn", OL), idle(L(game, 3))),
  bench: bench(undefined, [member("lax9", L(game, 9))]),
  checks: "The newcomer enters at 206 (Spikes 1/8).",
}));
add("V-DEFOG-FOE", ["sv"], (game) => ({
  title: "Control: Defog at a foe; Spikes on the foe side go; the newcomer takes nothing",
  field: { opponent: { hazards: ["spikes"] } },
  slots: slots(idle(L(game, 1)), act(fast(game, mon("Corviknight", "Pressure")), "Defog", PR), act(slowU(game), "U-turn", OL), idle(L(game, 3))),
  bench: bench(undefined, [member("lax9", L(game, 9))]),
  checks: "A foe target: both sides cleared.",
}));
add("V-DEFOG-BOTH", ["usum"], (game) => ({
  title: "USUM: Skarmory Defogs its ally; Stealth Rock on both sides: own side cleared, foe side keeps it",
  field: { own: { hazards: ["stealthrock"] }, opponent: { hazards: ["stealthrock"] } },
  slots: slots(act(fast(game, mon("Skarmory", "Keen Eye")), "Defog", OR), idle(L(game, 1)), idle(L(game, 2)), idle(L(game, 3))),
  checks: "E2: the opponent's stealthrock stays (mass 1).",
}));

// =====================================================================================================================
// R2-A2A3-H-2: a party cure reaches the bench (data/moves.ts healbell / aromatherapy onHit: side.pokemon; gmaxsweetness
// self.onHit: source.side.pokemon; sim/pokemon.ts:1674-1682 cureStatus works off the field).
// =====================================================================================================================
const slowUturn = (game: Game) => brave(game, game === "champions" ? mon("Rillaboom", "Overgrow") : game === "swsh" ? mon("Liepard", "Limber") : mon("Ambipom", "Technician"));
const slowS = (game: Game) => brave(game, mon("Scizor", "Technician"));
const gmaxAppletun = (game: Game) => brave(game, mon("Appletun", "Ripen", { choice: "dynamax", gigantamax: true, appBuild: { mechanic: "gigantamax", configuration: { dynamaxLevel: 10, gigantamax: true } } }));
add("RA-HB-BENCH", ["sv", "usum", "champions"], (game) => ({
  title: "Chimecho's Heal Bell cures the poisoned bench Snorlax; the slower U-turn brings that Snorlax in: no poison at the end of turn",
  slots: slots(act(fast(game, mon("Chimecho", "Levitate")), "Heal Bell"), act(slowUturn(game), "U-turn", PL), idle(L(game, 4)), idle(L(game, 3))),
  bench: bench([member("laxp", { ...L(game, 2), status: "psn" })]),
  checks: "healbell onHit over side.pokemon: the newcomer enters cured (235 HP, status none).",
}));
add("RA-AT-BENCH", ["swsh"], (game) => ({
  title: "Alcremie's Aromatherapy cures the burned bench Snorlax; the slower U-turn brings it in; no burn at the end of turn",
  slots: slots(act(fast(game, mon("Alcremie", "Sweet Veil")), "Aromatherapy"), act(slowUturn(game), "U-turn", PL), idle(L(game, 4)), idle(L(game, 3))),
  bench: bench([member("laxb", { ...L(game, 2), status: "brn" })]),
  checks: "aromatherapy onHit over side.pokemon.",
}));
add("RA-GMAX-SWEET-BENCH", ["swsh"], (game) => ({
  title: "Under Trick Room, Gigantamax Appletun's G-Max Sweetness cures its side's party; the U-turn after it brings in the poisoned bench Snorlax",
  field: { trickRoom: true },
  slots: slots(act(gmaxAppletun(game), "Apple Acid", PL), act(fast(game, mon("Liepard", "Limber")), "U-turn", PL), idle(L(game, 4)), idle(L(game, 3))),
  bench: bench([member("laxp", { ...L(game, 2), status: "psn" })]),
  checks: "gmaxsweetness self.onHit over source.side.pokemon.",
}));
add("V-HB-TOX", ["sv"], (game) => ({
  title: "Heal Bell cures the badly poisoned bench Snorlax; the slow ally U-turn brings it in: no toxic damage",
  slots: slots(act(fast(game, mon("Blissey", "Natural Cure")), "Heal Bell"), act(slowS(game), "U-turn", PL), idle(L(game, 4)), idle(L(game, 3))),
  bench: bench([member("laxt", { ...L(game, 2), status: "tox" })]),
  checks: "The newcomer enters with no status and no toxic counter.",
}));
add("V-HB-BRN", ["usum"], (game) => ({
  title: "USUM: Heal Bell cures the burned bench Snorlax; the slow ally U-turn brings it in: no burn damage",
  slots: slots(act(fast(game, mon("Blissey", "Natural Cure")), "Heal Bell"), act(slowS(game), "U-turn", PL), idle(L(game, 4)), idle(L(game, 3))),
  bench: bench([member("laxb", { ...L(game, 2), status: "brn" })]),
  checks: "As V-HB-TOX with a burn, generation 7.",
}));
add("V-HB-CTRL", ["sv"], (game) => ({
  title: "Control: no Heal Bell; the badly poisoned bench Snorlax U-turned in takes toxic damage",
  slots: slots(idle(fast(game, mon("Blissey", "Natural Cure"))), act(slowS(game), "U-turn", PL), idle(L(game, 4)), idle(L(game, 3))),
  bench: bench([member("laxt", { ...L(game, 2), status: "tox" })]),
  checks: "The newcomer keeps its status without a cure.",
}));
add("V-HB-OPP", ["sv"], (game) => ({
  title: "The foe's Heal Bell cures its burned bench Snorlax; the foe's slow U-turn brings it in",
  slots: slots(idle(L(game, 4)), idle(L(game, 3)), act(fast(game, mon("Blissey", "Natural Cure")), "Heal Bell"), act(slowS(game), "U-turn", OL)),
  bench: bench(undefined, [member("laxb", { ...L(game, 2), status: "brn" })]),
  checks: "The opponent's side.",
}));
add("V-SWEET", ["swsh"], (game) => ({
  title: "Under Trick Room, the slow Gigantamax Appletun's G-Max Sweetness cures the badly poisoned bench Snorlax; the faster ally's U-turn after it brings it in",
  field: { trickRoom: true },
  slots: slots(act(gmaxAppletun(game), "Apple Acid", PR), act(fast(game, mon("Scizor", "Technician")), "U-turn", PL), idle(L(game, 4)), idle(L(game, 3))),
  bench: bench([member("laxt", { ...L(game, 2), status: "tox" })]),
  checks: "gmaxsweetness on the bench.",
}));
add("V-HB-CHAMP", ["champions"], (game) => ({
  title: "Heal Bell cures the burned bench Snorlax; a slower ally U-turn brings it in",
  slots: slots(act(fast(game, mon("Chimecho", "Levitate")), "Heal Bell"), act(slowS(game), "U-turn", PL), idle(L(game, 4)), idle(L(game, 3))),
  bench: bench([member("laxb", { ...L(game, 2), status: "brn" })]),
  checks: "Champions: the same cure on the bench.",
}));

// =====================================================================================================================
// R3-1: a carried Berserk / Anger Shell lock at the turn's first Update (data/abilities.ts:421-426 berserk, :150-155
// angershell onTryEatItem: checkedBerserk false; data/items.ts sitrusberry onUpdate → eatItem → TryEatItem).
// =====================================================================================================================
const zerk = (game: Game, extra: Partial<CaseMon> = {}) => carried(mon(game === "sv" ? "Moltres-Galar" : "Drampa", "Berserk", { item: "Sitrus Berry", ...extra }), { berryLocked: true });
const zerkHit = (game: Game) => (game === "sv" ? "Air Slash" : "Dragon Pulse");
add("RD-BZK-START", ["sv", "swsh", "usum"], (game) => ({
  title: "A Berserk holder with its Sitrus locked last turn at 70 HP attacks a foe; everyone else idle: the Sitrus stays all turn",
  slots: slots(idle(L(game, 1)), idle(L(game, 2)), act(zerk(game, { hp: 70 }), zerkHit(game), OL), idle(L(game, 3))),
  checks: "The start settle keeps the locked Sitrus (start and final HP 70).",
}));
add("V1-AS-START", ["sv"], (game) => ({
  title: "Klawf (Anger Shell, Sitrus locked) at 50 HP, everyone idle: no Sitrus at the start; its own Splash's AfterMoveSecondary unlocks it",
  slots: slots(idle(L(game, 1)), idle(L(game, 2)), idle(carried(mon("Klawf", "Anger Shell", { item: "Sitrus Berry", hp: 50 }), { berryLocked: true })), idle(L(game, 3))),
  checks: "angershell onTryEatItem at the first Update.",
}));
add("V1-BZK-ORAN", ["usum"], (game) => ({
  title: "Drampa (Berserk, Oran locked) at 60 HP, everyone idle",
  slots: slots(idle(L(game, 1)), idle(L(game, 2)), idle(carried(mon("Drampa", "Berserk", { item: "Oran Berry", hp: 60 }), { berryLocked: true })), idle(L(game, 3))),
  checks: "berserk onTryEatItem: the Oran Berry too.",
}));

// =====================================================================================================================
// R3-2: a move that takes or eats the locked or heal-blocked Berry before the hit's Update (data/moves.ts:19312-19322 thief
// onAfterHit, :1920-1928 bugbite onHit; the lock and Heal Block stop only the holder's own TryEatItem and TryHeal).
// =====================================================================================================================
const thiefUser = (game: Game, hp: number) => fast(game, mon(game === "sv" ? "Sneasler" : "Weavile", game === "sv" ? "Poison Touch" : "Pressure", { hp }));
add("RD-BZK-THIEF", ["sv", "swsh", "usum"], (game) => ({
  title: "A Berserk holder (Sitrus locked last turn) at 70 HP; an itemless foe at 70 HP Thiefs it: the thief holds the Sitrus and eats it",
  slots: slots(act(thiefUser(game, 70), "Thief", PL), idle(L(game, 1)), idle(zerk(game, { hp: 70 })), idle(L(game, 3))),
  checks: "thief onAfterHit takeItem/setItem before the Update.",
}));
add("RD-BZK-THIEF2", ["sv", "swsh", "usum"], (game) => ({
  title: "A Berserk holder (Sitrus locked last turn) at 120 HP; a fast Thief user at 70 HP takes the Sitrus and eats it",
  slots: slots(act(thiefUser(game, 70), "Thief", PL), idle(L(game, 1)), act(zerk(game, { hp: 120 }), zerkHit(game), OR), idle(L(game, 3))),
  checks: "The thief ends at 108 (sv) / 106.",
}));
add("RD-BZK-BUGBITE", ["sv", "swsh", "usum"], (game) => ({
  title: "A Berserk holder (Sitrus locked last turn) at 70 HP; Scizor's Bug Bite eats its Sitrus",
  slots: slots(act(mon("Scizor", "Technician", { hp: 100 }), "Bug Bite", PL), idle(L(game, 1)), idle(zerk(game, { hp: 70 })), idle(L(game, 3))),
  checks: "bugbite onHit: takeItem, the user's Eat.",
}));
add("RD-BZK-BUGBITE2", ["sv", "swsh", "usum"], (game) => ({
  title: "A Berserk holder (Sitrus locked last turn) at 120 HP; a fast Scizor at 100 HP Bug Bites it: Scizor eats the Sitrus",
  slots: slots(act(fast(game, mon("Scizor", "Technician", { hp: 100 })), "Bug Bite", PL), idle(L(game, 1)), act(zerk(game, { hp: 120 }), zerkHit(game), OR), idle(L(game, 3))),
  checks: "Scizor ends at 136; the holder has no Berry.",
}));
add("RD-HB-BUGBITE", ["sv", "usum"], (game) => ({
  title: "Snorlax at 100 HP holding a Sitrus under Heal Block (2 turns left); a fast Scizor at 100 HP Bug Bites it and eats the Sitrus",
  slots: slots(act(fast(game, mon("Scizor", "Technician", { hp: 100 })), "Bug Bite", PL), idle(L(game, 1)), idle(carried(L(game, 2, { item: "Sitrus Berry", hp: 100 }), { healBlock: 2 })), idle(L(game, 3))),
  checks: "Heal Block stops only the holder's TryHeal: Scizor eats it (136).",
}));
add("V2-PLUCK-HB", ["sv"], (game) => ({
  title: "Pluck into a heal-blocked Sitrus holder at 200 HP: the plucker at 80 HP eats it",
  slots: slots(act(fast(game, mon("Bombirdier", "Big Pecks", { hp: 80 })), "Pluck", PL), idle(L(game, 1)), idle(carried(L(game, 2, { item: "Sitrus Berry", hp: 200 }), { healBlock: 2 })), idle(L(game, 3))),
  checks: "pluck onHit, as Bug Bite.",
}));
add("PA-PLUCK-ZERK", ["swsh", "usum"], (game) => ({
  title: "Pluck into a Berserk Drampa (Sitrus locked) at 120 HP: the plucker at 60 HP eats the Sitrus; Drampa has none",
  slots: slots(act(fast(game, mon("Braviary", "Sheer Force", { hp: 60 })), "Pluck", PL), idle(L(game, 1)), idle(carried(mon("Drampa", "Berserk", { item: "Sitrus Berry", hp: 120 }), { berryLocked: true })), idle(L(game, 3))),
  checks: "pluck into the locked Berry.",
}));
add("FX-THIEF-PLAIN", ["sv"], (game) => ({
  title: "Control: a fast Sneasler at 70 HP Thiefs a Sitrus from a Snorlax (no lock): it eats it at the hit's Update",
  slots: slots(act(fast(game, mon("Sneasler", "Poison Touch", { hp: 70 })), "Thief", PL), idle(L(game, 1)), idle(L(game, 0, { item: "Sitrus Berry", hp: 120 })), idle(L(game, 3))),
  checks: "Thief without a stand-in.",
}));
add("FX-COVET-LOCK", ["sv", "usum"], (game) => ({
  title: "A fast Ambipom at 70 HP Covets a Berserk holder's locked Sitrus: it eats it at the hit's Update; the holder has none",
  slots: slots(act(fast(game, mon("Ambipom", "Technician", { hp: 70 })), "Covet", PL), idle(L(game, 1)), idle(zerk(game, { hp: 120 })), idle(L(game, 3))),
  checks: "covet onAfterHit, as Thief.",
}));
add("FX-INCIN-HB", ["swsh", "usum"], (game) => ({
  title: "Incinerate burns the Sitrus of a heal-blocked Snorlax at 100 HP; the Snorlax's later Body Slam",
  slots: slots(act(fast(game, mon("Arcanine", "Intimidate")), "Incinerate"), idle(L(game, 1)), act(carried(L(game, 0, { item: "Sitrus Berry", hp: 100 }), { healBlock: 3 }), "Body Slam", OL), idle(L(game, 3))),
  checks: "incinerate onHit (a spread move): the Berry gone before the Update.",
}));
add("PA-THIEF-STICKY-HB", ["sv"], (game) => ({
  title: "Thief into a heal-blocked Sticky Hold Muk holding a Sitrus at 100 HP: Sticky Hold keeps it; Heal Block keeps it uneaten",
  slots: slots(act(fast(game, mon("Sneasler", "Poison Touch", { hp: 70 })), "Thief", PL), idle(L(game, 1)), idle(carried(mon("Muk", "Sticky Hold", { item: "Sitrus Berry", hp: 100 }), { healBlock: 2 })), idle(L(game, 3))),
  checks: "stickyhold onTakeItem: the stand-in stays.",
}));
add("FX-MAGICIAN-LOCK", ["sv"], () => ({
  title: "An itemless Magician Delphox's Flamethrower into a Berserk holder with a locked Sitrus: Magician takes the item after the hit's Update (kept reason)",
  slots: slots(act(fast("sv", mon("Delphox", "Magician")), "Flamethrower", PL), idle(L("sv", 1)), idle(zerk("sv", { hp: 120 })), idle(L("sv", 3))),
  notEstimated: "Magician with Moltres-Galar's Sitrus Berry is not modelled in 2v2.",
  checks: "magician onAfterMoveSecondarySelf runs after the hit's Update, where the step reads the stand-in.",
}));

// =====================================================================================================================
// R3-3: the attacker's own Starf Berry between a multi-hit move's hits (sim/battle-actions.ts:967 the Update after each hit;
// data/items.ts:5985 starfberry onEat): kept as a reason; the controls stay exact.
// =====================================================================================================================
add("RD-STARF-MULTI", ["sv", "swsh"], (game) => ({
  title: "Cinderace (Starf, 60 HP) Double Kicks a Rocky Helmet Snorlax: the Starf at the Update after the first kick raises a random stat the second reads (kept reason)",
  slots: slots(act(fast(game, mon("Cinderace", "Blaze", { item: "Starf Berry", hp: 60 })), "Double Kick", PL), idle(L(game, 1)), idle(L(game, 2, { item: "Rocky Helmet" })), idle(L(game, 3))),
  notEstimated: "Starf Berry between the hits of Double Kick is not modelled in 2v2.",
  checks: "The step's hit loop does not branch over the random stat between hits.",
}));
add("RD-STARF-TGT", ["sv"], (game) => ({
  title: "Control: the target's Starf between Cinderace's Double Kick hits",
  slots: slots(act(fast(game, mon("Cinderace", "Blaze")), "Double Kick", PL), idle(L(game, 1)), idle(L(game, 2, { item: "Starf Berry", hp: 90 })), idle(L(game, 3))),
  checks: "The target's Starf (the path that already agreed).",
}));
add("V3-LIECHI-MULTI", ["sv"], (game) => ({
  title: "Control: Cinderace (Liechi, 60 HP) Double Kicks a Rocky Helmet Snorlax: the Liechi's +1 between the hits",
  slots: slots(act(fast(game, mon("Cinderace", "Blaze", { item: "Liechi Berry", hp: 60 })), "Double Kick", PL), idle(L(game, 1)), idle(L(game, 2, { item: "Rocky Helmet" })), idle(L(game, 3))),
  checks: "A deterministic pinch Berry between hits.",
}));
add("V3-STARF-SINGLE", ["sv"], (game) => ({
  title: "Control: Cinderace (Starf, 60 HP) Low Kicks a Rocky Helmet Snorlax: the Starf after the only hit",
  slots: slots(act(fast(game, mon("Cinderace", "Blaze", { item: "Starf Berry", hp: 60 })), "Low Kick", PL), idle(L(game, 1)), idle(L(game, 2, { item: "Rocky Helmet" })), idle(L(game, 3))),
  checks: "The Starf at the action's end (starfRise).",
}));

// =====================================================================================================================
// R3-4: Parental Bond with a one-hit KO move (data/abilities.ts:3170-3176 parentalbond onPrepareHit: no ohko exclusion;
// sim/battle-actions.ts:1606 each hit target.maxhp). USUM only (Mega Kangaskhan's Fissure).
// =====================================================================================================================
const kangaskhan = () => mon("Kangaskhan-Mega", "Parental Bond", { item: "Kangaskhanite", appSpecies: "kangaskhanmega" });
const pbReason = "Fissure with Parental Bond is not modelled in 2v2.";
add("RD-OHKO-PB", ["usum"], (game) => ({
  title: "Mega Kangaskhan's Fissure into a Focus Sash Snorlax at full HP: the second hit knocks it out (kept reason)",
  slots: slots(act(kangaskhan(), "Fissure", PL), idle(L(game, 1)), idle(L(game, 2, { item: "Focus Sash" })), idle(L(game, 3))),
  notEstimated: pbReason,
  checks: "The calculation's one-hit KO row has one hit.",
}));
add("RD-OHKO-PB-DISGUISE", ["usum"], (game) => ({
  title: "Mega Kangaskhan's Fissure into an intact Mimikyu: Disguise takes the first hit, the second knocks it out (kept reason)",
  slots: slots(act(kangaskhan(), "Fissure", PL), idle(L(game, 1)), idle(mon("Mimikyu", "Disguise")), idle(L(game, 3))),
  notEstimated: pbReason,
  checks: "As RD-OHKO-PB.",
}));
add("RD-OHKO-PB-SUB", ["usum"], (game) => ({
  title: "Mega Kangaskhan's Fissure into a Snorlax behind a Substitute: the first hit breaks it, the second knocks Snorlax out (kept reason)",
  slots: slots(act(kangaskhan(), "Fissure", PL), idle(L(game, 1)), idle({ ...L(game, 2), substitute: 58 }), idle(L(game, 3))),
  notEstimated: pbReason,
  checks: "As RD-OHKO-PB.",
}));
add("PA-OHKO-PB-BAND", ["usum"], (game) => ({
  title: "Mega Kangaskhan's Fissure into a Focus Band Snorlax: each hit 10% (kept reason)",
  slots: slots(act(kangaskhan(), "Fissure", PL), idle(L(game, 1)), idle(L(game, 2, { item: "Focus Band" })), idle(L(game, 3))),
  notEstimated: pbReason,
  checks: "As RD-OHKO-PB.",
}));
add("PA-OHKO-PB-PLAIN", ["usum"], (game) => ({
  title: "Mega Kangaskhan's Fissure into a full-HP Snorlax with no saver: the first hit knocks it out",
  slots: slots(act(kangaskhan(), "Fissure", PL), idle(L(game, 1)), idle(L(game, 2, { item: "Leftovers" })), idle(L(game, 3))),
  checks: "One hit is exact when the first knocks out.",
}));
add("PA-OHKO-PB-IMMUNE", ["usum"], (game) => ({
  title: "Mega Kangaskhan's Fissure into a Focus Sash Salamence (Flying: immune): no reason",
  slots: slots(act(kangaskhan(), "Fissure", PL), idle(L(game, 1)), idle(mon("Salamence", "Moxie", { item: "Focus Sash" })), idle(L(game, 3))),
  checks: "The immunity first (ohkoStep).",
}));

// =====================================================================================================================
// R3-5: a flung Custap Berry has no effect (data/items.ts:1235-1256 custapberry `onEat() { }`). Champions has no Custap.
// =====================================================================================================================
const flinger = (game: Game) => fast(game, game === "sv" ? mon("Sneasler", "Poison Touch", { item: "Custap Berry" }) : mon("Weavile", "Pressure", { item: "Custap Berry" }));
add("RD-FLING-CUSTAP", ["sv", "swsh"], (game) => ({
  title: "A fast Fling user throws a Custap Berry at a slower Snorlax; that Snorlax's Body Slam follows as queued",
  slots: slots(act(flinger(game), "Fling", PL), idle(L(game, 1)), act(L(game, 2), "Body Slam", OR), idle(L(game, 3))),
  checks: "custapberry onEat is empty: FractionalPriority is read only as an action is queued (sim/battle-queue.ts:249).",
}));
add("V5-CUSTAP-IDLE", ["sv"], (game) => ({
  title: "Sneasler flings a Custap Berry at an idle Snorlax",
  slots: slots(act(flinger(game), "Fling", PL), idle(L(game, 1)), idle(L(game, 2)), idle(L(game, 3))),
  checks: "No effect; the idle target's No move.",
}));
add("V5-CUSTAP-POUCH", ["sv"], (game) => ({
  title: "Sneasler flings a Custap Berry at a Greedent (Cheek Pouch) at 100 HP, whose Body Slam follows",
  slots: slots(act(flinger(game), "Fling", PL), idle(L(game, 1)), act(mon("Greedent", "Cheek Pouch", { hp: 100 }), "Body Slam", OR), idle(L(game, 3))),
  checks: "Cheek Pouch's heal on eating it.",
}));
add("V5-CUSTAP-POUCH-IDLE", ["sv"], (game) => ({
  title: "Sneasler flings a Custap Berry at an idle Greedent (Cheek Pouch) at 100 HP",
  slots: slots(act(flinger(game), "Fling", PL), idle(L(game, 1)), idle(mon("Greedent", "Cheek Pouch", { hp: 100 })), idle(L(game, 3))),
  checks: "Cheek Pouch, idle.",
}));
add("V5-CUSTAP-AFTER", ["sv"], (game) => ({
  title: "Greedent (Cheek Pouch, 100 HP) Body Slams first; a slow Snorlax flings a Custap Berry at it",
  slots: slots(act(L(game, 0, { item: "Custap Berry", nature: "Brave", ivs: { spe: 0 } }), "Fling", PL), idle(L(game, 1)), act(fast(game, mon("Greedent", "Cheek Pouch", { hp: 100 })), "Body Slam", OR), idle(L(game, 3))),
  checks: "The generic flung-Berry path.",
}));

// =====================================================================================================================
// R3-6: an Encore rewrite keeps the queued move's priority and pranksterBoosted (sim/battle-actions.ts:225-233); only Quick
// Guard, Psychic Terrain, Armor Tail, Dazzling, Queenly Majesty and Prankster's Dark immunity read them.
// =====================================================================================================================
const scizor = (last: string) => ({ ...mon("Scizor", "Technician"), lastMove: last });
const encoreReason = "Encore changes Scizor's move: not modelled.";
add("RD-ENC-PRIO", ["sv", "swsh", "usum"], (game) => ({
  title: "Whimsicott's Prankster Encore into Scizor (last move X-Scissor) whose Bullet Punch is queued: X-Scissor at a random foe (no reader)",
  slots: slots(act(fast(game, mon("Whimsicott", "Prankster")), "Encore", PL), idle(L(game, 1)), act(scizor("X-Scissor"), "Bullet Punch", OR), idle(L(game, 3))),
  checks: "runMove: baseMove.priority = the queued +1, which nothing in play reads.",
}));
add("V6-ENC-NOPRIO", ["sv"], (game) => ({
  title: "Control: Prankster Encore into Scizor (Bullet Punch queued, last Swords Dance)",
  slots: slots(act(fast(game, mon("Whimsicott", "Prankster")), "Encore", PL), idle(L(game, 1)), act(scizor("Swords Dance"), "Bullet Punch", OR), idle(L(game, 3))),
  checks: "A self move (the path that already agreed).",
}));
add("PA-ENC-NOREADER", ["sv", "usum"], (game) => ({
  title: "Infiltrator Whimsicott's Encore into a slower Scizor (X-Scissor queued, last Bullet Punch): Bullet Punch at the queued 0, no reader",
  slots: slots(act(fast(game, mon("Whimsicott", "Infiltrator")), "Encore", PL), idle(L(game, 1)), act(scizor("Bullet Punch"), "X-Scissor", OR), idle(L(game, 3))),
  checks: "The rewrite the other way, no reader.",
}));
add("PA-ENC-QG", ["usum"], (game) => ({
  title: "USUM: Quick Guard on the Encore user's side; Scizor's encored Bullet Punch keeps the queued 0 (generation 7's frozen priority, which the step reads)",
  slots: slots(act(fast(game, mon("Whimsicott", "Infiltrator")), "Encore", PL), act(mon("Hitmontop", "Steadfast"), "Quick Guard"), act(scizor("Bullet Punch"), "X-Scissor", OR), idle(L(game, 3))),
  checks: "quickguard onTryHit reads move.priority 0: not blocked.",
}));
add("PA-ENC-QG", ["sv"], (game) => ({
  title: "Quick Guard on the Encore user's side; Scizor's encored Bullet Punch keeps the queued 0, which Quick Guard does not block (kept reason)",
  slots: slots(act(fast(game, mon("Whimsicott", "Infiltrator")), "Encore", PL), act(mon("Hitmontop", "Steadfast"), "Quick Guard"), act(scizor("Bullet Punch"), "X-Scissor", OR), idle(L(game, 3))),
  notEstimated: encoreReason,
  checks: "The step reads the encored move's own +1: a reader in play.",
}));
add("PA-ENC-PT", ["sv", "swsh"], (game) => ({
  title: "Psychic Terrain: Scizor's encored Bullet Punch keeps the queued 0, so Psychic Terrain does not stop it (kept reason)",
  field: { terrain: "Psychic" },
  slots: slots(act(fast(game, mon("Whimsicott", "Infiltrator")), "Encore", PL), idle(L(game, 1)), act(scizor("Bullet Punch"), "X-Scissor", OR), idle(L(game, 3))),
  notEstimated: encoreReason,
  checks: "psychicterrain onTryHit reads the priority: a reader in play.",
}));
add("PA-ENC-AT", ["sv"], (game) => ({
  title: "Armor Tail Farigiraf beside the Encore user: Scizor's encored Bullet Punch keeps the queued 0, which Armor Tail does not stop (kept reason)",
  slots: slots(act(fast(game, mon("Whimsicott", "Infiltrator")), "Encore", PL), idle(mon("Farigiraf", "Armor Tail")), act(scizor("Bullet Punch"), "X-Scissor", OR), idle(L(game, 3))),
  notEstimated: encoreReason,
  checks: "armortail onFoeTryMove reads the priority: a reader in play.",
}));
add("PA-ENC-PRANK", ["sv", "usum"], (game) => ({
  title: "A faster Prankster Whimsicott Encores the other Whimsicott (Tailwind queued, last Moonblast): its Moonblast keeps pranksterBoosted, so a Dark foe is immune (kept reason)",
  slots: slots(act(fast(game, mon("Whimsicott", "Prankster")), "Encore", PL), idle(mon("Umbreon", "Synchronize")), act({ ...mon("Whimsicott", "Prankster"), lastMove: "Moonblast" }, "Tailwind"), idle(L(game, 3))),
  notEstimated: "Encore changes Whimsicott (opponent's)'s move: not modelled.",
  checks: "hitStepTryImmunity reads pranksterBoosted, which the attack's step does not.",
}));
add("PA-ENC-PRANK-NODARK", ["sv"], (game) => ({
  title: "Control: the same Prankster rewrite with no Dark foe: no reader, the Moonblast at a random foe",
  slots: slots(act(fast(game, mon("Whimsicott", "Prankster")), "Encore", PL), idle(L(game, 1)), act({ ...mon("Whimsicott", "Prankster"), lastMove: "Moonblast" }, "Tailwind"), idle(L(game, 3))),
  checks: "No Dark foe in play.",
}));

// =====================================================================================================================
// Pass B (R4, the S/W/M reviewer's findings). Helpers: an intact Mimikyu, a Gigantamax and a Dynamaxed Pokémon (SwSh).
// =====================================================================================================================
const kyu = (extra: Partial<CaseMon> = {}) => mon("Mimikyu", "Disguise", extra);
const gmax = (species: string, ability: string, extra: Partial<CaseMon> = {}): CaseMon =>
  mon(species, ability, { evs: { spe: 252 }, gender: "M", choice: "dynamax", gigantamax: true, appBuild: { mechanic: "gigantamax", configuration: { dynamaxLevel: 10, gigantamax: true } }, ...extra });
const dmax = (m: CaseMon): CaseMon => ({ ...m, choice: "dynamax" });

// R4-1: a spread move with HP-reading damage into an intact face at Showdown's position 0 (opponent-right): the other
// target's damage at the attacker's HP (data/moves.ts:4893-4894 eruption basePowerCallback; data/abilities.ts:463,470 blaze).
add("R4-S-ERUPTKYU", ["sv"], (game) => ({
  title: "Typhlosion at 77 HP: Eruption (75 power) into an intact Mimikyu (opponent-right) and a Snorlax",
  slots: slots(act(fast(game, mon("Typhlosion", "Flash Fire", { hp: 77 })), "Eruption"), idle(L(game, 1)), idle(L(game, 2)), idle(kyu())),
  checks: "The Snorlax takes 16–19 (Eruption at 77/155); the face hit's getDamage 33–40.",
}));
add("R4-S-SPREADBLAZEKYU", ["sv", "usum"], (game) => ({
  title: "Blaze Charizard at 30 HP: Heat Wave into an intact Mimikyu (opponent-right) and a Snorlax",
  slots: slots(act(fast(game, mon("Charizard", "Blaze", { hp: 30 })), "Heat Wave"), idle(L(game, 1)), idle(L(game, 2)), idle(kyu())),
  checks: "Blaze at a third reaches the Snorlax (31–37 in SV) and the face hit's getDamage.",
}));
add("R4-S-SPREADROWAPLO", ["sv"], (game) => ({
  title: "Life Orb Blaze Charizard at 30 HP: Heat Wave into an intact Rowap Mimikyu and a Snorlax: Rowap 1/8 at the hits' Update, Life Orb after",
  slots: slots(act(fast(game, mon("Charizard", "Blaze", { item: "Life Orb", hp: 30 })), "Heat Wave"), idle(L(game, 1)), idle(L(game, 2)), idle(kyu({ item: "Rowap Berry" }))),
  checks: "Blaze at a third with the face first in the target order.",
}));
add("V1-WSPOUT", ["usum", "swsh"], (game) => ({
  title: "Wailord at 100 HP: Water Spout into an intact Mimikyu (opponent-right) and a Snorlax",
  slots: slots(act(fast(game, mon("Wailord", "Oblivious", { hp: 100 })), "Water Spout"), idle(L(game, 1)), idle(L(game, 2)), idle(kyu())),
  checks: "Water Spout at 100 HP reaches the Snorlax (22–27) and the face hit's getDamage (24–28).",
}));
add("R4-S-ERUPTKYU2", ["sv"], (game) => ({
  title: "Control: Typhlosion at 77 HP: Eruption into an intact Mimikyu (opponent-left) and a Snorlax (opponent-right)",
  slots: slots(act(fast(game, mon("Typhlosion", "Flash Fire", { hp: 77 })), "Eruption"), idle(L(game, 1)), idle(kyu()), idle(L(game, 2))),
  checks: "The face second in the target order: the Snorlax was already right; the face hit's getDamage 33–40 (R4-5).",
}));

// R4-5: a face hit's calculated range (getDamage before Disguise takes it) at the attacker's HP.
add("R4-S-BLAZEKYU1", ["sv", "swsh", "usum"], (game) => ({
  title: "Blaze Charizard at 30 HP: Flamethrower into an intact Mimikyu (the hit's calculated range)",
  slots: slots(act(fast(game, mon("Charizard", "Blaze", { hp: 30 })), "Flamethrower", PR), idle(L(game, 1)), idle(L(game, 2)), idle(kyu())),
  checks: "The face hit's getDamage with Blaze (79–94 in SV); Mimikyu takes 0.",
}));
add("R4-S-TORRENTKYU", ["sv"], (game) => ({
  title: "Torrent Greninja at 40 HP: Water Shuriken into an intact Mimikyu: the face's hit, then the Torrent hits",
  slots: slots(act(fast(game, mon("Greninja", "Torrent", { hp: 40 })), "Water Shuriken", PR), idle(L(game, 1)), idle(L(game, 2)), idle(kyu())),
  checks: "The face's first hit read with Torrent: the move's range 26–80.",
}));
add("V5-OVERGROWKYU", ["sv"], (game) => ({
  title: "Overgrow Venusaur at 40 HP: Energy Ball into an intact Mimikyu",
  slots: slots(act(fast(game, mon("Venusaur", "Overgrow", { hp: 40 })), "Energy Ball", PR), idle(L(game, 1)), idle(L(game, 2)), idle(kyu())),
  checks: "The face hit's getDamage with Overgrow (75–88).",
}));
add("PB-TORRENTSUBKYU", ["sv"], (game) => ({
  title: "Torrent Greninja at 40 HP: Water Shuriken into an intact Mimikyu behind a 20 HP Substitute: the face's hit after the break",
  slots: slots(act(fast(game, mon("Greninja", "Torrent", { hp: 40 })), "Water Shuriken", PR), idle(L(game, 1)), idle(L(game, 2)), idle(kyu({ substitute: 20 }))),
  checks: "doubles-faces.ts faceAfterSub: the face's hit read with Torrent.",
}));

// R4-4: a called move is used with its caller's priority (sim/battle-actions.ts:410-411); Dazzling and Armor Tail need
// move.priority > 0.1 (data/abilities.ts:872), Psychic Terrain stops one above 0.1 (data/moves.ts:14116-14117).
add("R4-W-SLPTALKGW", ["sv", "usum"], (game) => ({
  title: "An asleep full-HP Gale Wings Talonflame Sleep Talks into Brave Bird at a random foe: priority 0 (Sleep Talk's); the Dazzling Bruxish do not stop it",
  slots: slots(act(mon("Talonflame", "Gale Wings", { status: "slp", moves: ["Brave Bird"], exactMoves: true }), "Sleep Talk"), idle(L(game, 1)), idle(mon("Bruxish", "Dazzling")), idle(mon("Bruxish", "Dazzling"))),
  checks: "Brave Bird hits a Bruxish (76–91 in SV) with its recoil.",
}));
add("R4-W-SLPTALKPT", ["sv", "usum"], (game) => ({
  title: "Psychic Terrain: an asleep Prankster Whimsicott Sleep Talks into Moonblast (+1, Sleep Talk's): the grounded Snorlax foes are protected",
  field: { terrain: "Psychic" },
  slots: slots(act(mon("Whimsicott", "Prankster", { status: "slp", moves: ["Moonblast"], exactMoves: true }), "Sleep Talk"), idle(L(game, 1)), idle(L(game, 2)), idle(L(game, 3))),
  checks: "Psychic Terrain blocks the called Moonblast: the Snorlax stay at full HP.",
}));
add("V4-SLPTALKAT", ["sv"], (game) => ({
  title: "An asleep full-HP Gale Wings Talonflame Sleep Talks into Brave Bird; the foes are Armor Tail Farigiraf",
  slots: slots(act(mon("Talonflame", "Gale Wings", { status: "slp", moves: ["Brave Bird"], exactMoves: true }), "Sleep Talk"), idle(L(game, 1)), idle(mon("Farigiraf", "Armor Tail")), idle(mon("Farigiraf", "Armor Tail"))),
  checks: "Armor Tail reads priority 0: Brave Bird hits, with recoil.",
}));
add("R4-W-SLPTALKPR", ["sv"], (game) => ({
  title: "Control: an asleep Prankster Grimmsnarl Sleep Talks into Spirit Break (+1); the Dazzling Bruxish stop it",
  slots: slots(act(mon("Grimmsnarl", "Prankster", { status: "slp", moves: ["Spirit Break"], exactMoves: true }), "Sleep Talk"), idle(L(game, 1)), idle(mon("Bruxish", "Dazzling")), idle(mon("Bruxish", "Dazzling"))),
  checks: "The kernel's shield already read the caller's priority.",
}));

// R4-6: a Berry between the hits: recoil and Shell Bell read the move's whole total once (sim/battle-actions.ts:965,
// 981-982 applyRecoilDamage(move.totalDamage); data/items.ts:5653-5655 shellbell). Champions has no Ganlon, Apicot, Starf
// or Lansat Berry.
add("R4-W-GANLONSB", ["sv", "swsh"], (game) => ({
  title: "Shell Bell Corviknight (100 HP) Dual Wingbeat into a Ganlon Snorlax at 90 HP: Shell Bell over both parts",
  slots: slots(act(fast(game, mon("Corviknight", "Pressure", { nature: "Adamant", evs: { atk: 252, spe: 252 }, item: "Shell Bell", hp: 100 })), "Dual Wingbeat", PR), idle(L(game, 1)), idle(L(game, 2)), idle(L(game, 3, { item: "Ganlon Berry", hp: 90 }))),
  checks: "Shell Bell heals trunc(total / 8) once, the hit before the Ganlon included.",
}));
add("R4-W-PBRECOIL", ["usum"], (game) => ({
  title: "Mega Kangaskhan's Double-Edge into a Ganlon Snorlax at 200 HP: Ganlon between the strikes; recoil from both",
  slots: slots(act(mon("Kangaskhan", "Parental Bond", { item: "Kangaskhanite", choice: "mega", appSpecies: "kangaskhanmega", evs: { atk: 252, spe: 252 } }), "Double-Edge", PR), idle(L(game, 1)), idle(L(game, 2)), idle(L(game, 3, { item: "Ganlon Berry", hp: 200 }))),
  checks: "Recoil a third of both strikes' total, once.",
}));
add("V6-DHSB", ["sv"], (game) => ({
  title: "Shell Bell Ambipom at 60 HP: Double Hit into a Ganlon Snorlax at 75 HP",
  slots: slots(act(fast(game, mon("Ambipom", "Technician", { item: "Shell Bell", hp: 60 })), "Double Hit", PR), idle(L(game, 1)), idle(L(game, 2)), idle(L(game, 3, { item: "Ganlon Berry", hp: 75 }))),
  checks: "Shell Bell over both parts; the Snorlax knocked out 0.78.",
}));
add("V6-PBTAKEDOWN", ["usum"], (game) => ({
  title: "Mega Kangaskhan's Take Down into a Ganlon Snorlax at 150 HP: recoil from both strikes",
  slots: slots(act(mon("Kangaskhan", "Parental Bond", { item: "Kangaskhanite", choice: "mega", appSpecies: "kangaskhanmega", evs: { atk: 252, spe: 252 } }), "Take Down", PR), idle(L(game, 1)), idle(L(game, 2)), idle(L(game, 3, { item: "Ganlon Berry", hp: 150 }))),
  checks: "Recoil a quarter of both strikes' total.",
}));

// R4-2: G-Max Finale heals in self.onHit (sim/battle-actions.ts:1096), before a Gulping or Gorging Cramorant's Gulp Missile
// in DamagingHit (:1121; data/abilities.ts:1745-1749). Sword/Shield only (Dynamax).
const finaleReason = (who: string) => `G-Max Finale with ${who}'s Gulp Missile is not modelled in 2v2.`;
add("R4-M-FINALEGULP", ["swsh"], () => ({
  title: "Gigantamax Alcremie at full HP: G-Max Finale into Cramorant-Gulping (kept reason)",
  slots: slots(act(gmax("Alcremie", "Sweet Veil", { gender: "F" }), "Dazzling Gleam", PR), idle(L("swsh", 1, { hp: 100 })), idle(L("swsh", 2)), idle(mon("Cramorant-Gulping", "Gulp Missile"))),
  notEstimated: finaleReason("Cramorant-Gulping"),
  checks: "Pinned heals first (none at full HP), then Gulp Missile's quarter: 245/280.",
}));
add("V2-FINALEGORGE", ["swsh"], () => ({
  title: "Gigantamax Alcremie at 130 HP: G-Max Finale into Cramorant-Gorging (kept reason)",
  slots: slots(act(gmax("Alcremie", "Sweet Veil", { gender: "F", hp: 130 }), "Dazzling Gleam", PR), idle(L("swsh", 1)), idle(L("swsh", 2)), idle(mon("Cramorant-Gorging", "Gulp Missile"))),
  notEstimated: finaleReason("Cramorant-Gorging"),
  checks: "Pinned heals to the 280 cap, then Gulp Missile's 35: 245.",
}));
add("PB-FINALECRAM", ["swsh"], () => ({
  title: "Control: Gigantamax Alcremie at 130 HP: G-Max Finale into a Cramorant in its base form (no Gulp Missile hit)",
  slots: slots(act(gmax("Alcremie", "Sweet Veil", { gender: "F", hp: 130 }), "Dazzling Gleam", PR), idle(L("swsh", 1)), idle(L("swsh", 2)), idle(mon("Cramorant", "Gulp Missile"))),
  checks: "The heal alone: no reason.",
}));

// R4-3: a Max Move's self.onHit (sim/battle-actions.ts:1096) before the target's DamagingHit (:1121): G-Max Foam Burst
// with Weak Armor (data/abilities.ts:5451), Max Airstream's partner rise with Cotton Down (:734). At a ±6 cap the order
// changes the stage: kept reason; away from the caps the turn is estimated.
const comboReason = (move: string, who: string, ability: string) => `${move} with ${who}'s ${ability} is not modelled in 2v2.`;
add("R4-M-FOAMWA", ["swsh"], () => ({
  title: "G-Max Foam Burst into Weak Armor Skarmory at Speed +5 (kept reason)",
  slots: slots(act(gmax("Kingler", "Hyper Cutter"), "Crabhammer", PR), idle(L("swsh", 1)), idle(L("swsh", 2)), idle(mon("Skarmory", "Weak Armor", { boosts: { spe: 5 } }))),
  notEstimated: comboReason("G-Max Foam Burst", "Skarmory", "Weak Armor"),
  checks: "Pinned −2 then +2: +5; the other order +4.",
}));
add("V3-FOAMWA6", ["swsh"], () => ({
  title: "G-Max Foam Burst into Weak Armor Skarmory at Speed +6 (kept reason)",
  slots: slots(act(gmax("Kingler", "Hyper Cutter"), "Crabhammer", PR), idle(L("swsh", 1)), idle(L("swsh", 2)), idle(mon("Skarmory", "Weak Armor", { boosts: { spe: 6 } }))),
  notEstimated: comboReason("G-Max Foam Burst", "Skarmory", "Weak Armor"),
  checks: "Pinned −2 then +2: +6; the other order +4.",
}));
add("PB-FOAMWA0", ["swsh"], () => ({
  title: "Control: G-Max Foam Burst into Weak Armor Skarmory at Speed 0: −2 and +2 in either order",
  slots: slots(act(gmax("Kingler", "Hyper Cutter"), "Crabhammer", PR), idle(L("swsh", 1)), idle(L("swsh", 2)), idle(mon("Skarmory", "Weak Armor"))),
  checks: "No cap met: estimated, Skarmory ends at Speed 0, Defense −1.",
}));
add("R4-M-AIRCOTTON", ["swsh"], () => ({
  title: "A Dynamaxed Corviknight's Max Airstream into Cotton Down Eldegoss; its ally Snorlax at Speed +6 (kept reason)",
  slots: slots(act(dmax(mon("Corviknight", "Pressure", { evs: { spe: 252 } })), "Brave Bird", PR), idle(L("swsh", 1, { boosts: { spe: 6 } })), idle(L("swsh", 2)), idle(mon("Eldegoss", "Cotton Down"))),
  notEstimated: comboReason("Max Airstream", "Eldegoss", "Cotton Down"),
  checks: "Pinned +1 (no change) then −1: +5; the other order +6.",
}));
add("V3-AIRCOTTONLOW", ["swsh"], () => ({
  title: "A Dynamaxed Corviknight's Max Airstream into Cotton Down Eldegoss; its ally Snorlax at Speed −6 (kept reason)",
  slots: slots(act(dmax(mon("Corviknight", "Pressure", { evs: { spe: 252 } })), "Brave Bird", PR), idle(L("swsh", 1, { boosts: { spe: -6 } })), idle(L("swsh", 2)), idle(mon("Eldegoss", "Cotton Down"))),
  notEstimated: comboReason("Max Airstream", "Eldegoss", "Cotton Down"),
  checks: "Pinned +1 then −1: −6; the other order −5.",
}));
add("PB-AIRCOTTON0", ["swsh"], () => ({
  title: "Control: a Dynamaxed Corviknight's Max Airstream into Cotton Down Eldegoss; its ally Snorlax at Speed 0",
  slots: slots(act(dmax(mon("Corviknight", "Pressure", { evs: { spe: 252 } })), "Brave Bird", PR), idle(L("swsh", 1)), idle(L("swsh", 2)), idle(mon("Eldegoss", "Cotton Down"))),
  checks: "No cap met: estimated, the ally ends at Speed 0.",
}));
add("V3-AIRCOTTONSELF", ["swsh"], () => ({
  title: "Control: a Dynamaxed Corviknight at Speed +6: Max Airstream into Cotton Down Eldegoss (its own rise is the step's)",
  slots: slots(act(dmax(mon("Corviknight", "Pressure", { evs: { spe: 252 }, boosts: { spe: 6 } })), "Brave Bird", PR), idle(L("swsh", 1)), idle(L("swsh", 2)), idle(mon("Eldegoss", "Cotton Down"))),
  checks: "The user's own +1 then Cotton Down −1 in the step: +5.",
}));
add("V3-STRIKEWA5", ["swsh"], () => ({
  title: "Control: a Dynamaxed Snorlax's Max Strike into Weak Armor Skarmory at Speed +5 (the target's drop is the step's)",
  slots: slots(act(dmax(L("swsh", 30)), "Body Slam", PR), idle(L("swsh", 1)), idle(L("swsh", 2)), idle(mon("Skarmory", "Weak Armor", { boosts: { spe: 5 } }))),
  checks: "−1 then Weak Armor +2: +6.",
}));


// =====================================================================================================================
// Pass C (R5-PRCLST-FC). R5-1: a damaging dance into a Substitute: activeTarget is the target (sim/battle-actions.ts:693,
// hitStepAccuracy), so an ally Dancer copies at that foe (:334-340), not at the dance's user.
// =====================================================================================================================
add("R5-DAN-SUB", ["sv", "usum"], (game) => ({
  title: "Volcarona's Fiery Dance into a foe's Substitute; ally Oricorio (Dancer) copies it at that foe",
  slots: slots(idle(mon("Oricorio", "Dancer")), act(mon("Volcarona", "Flame Body"), "Fiery Dance", PL), idle(L(game, 0, { substitute: 58 })), idle(L(game, 1))),
  checks: "The copy goes into the Substitute's Snorlax; Volcarona stays at 160.",
}));
add("V1-DAN-SUB", ["sv", "usum"], (game) => ({
  title: "Volcarona's Fiery Dance into opponent-right Snorlax's Substitute; ally Oricorio (Dancer) copies it",
  slots: slots(act(fast(game, mon("Volcarona", "Flame Body")), "Fiery Dance", PR), idle(mon("Oricorio", "Dancer")), idle(L(game, 2)), idle(L(game, 0, { substitute: 58 }))),
  checks: "The copy reaches opponent-right; Volcarona untouched.",
}));
add("V1-DAN-SUB2", ["sv"], (game) => ({
  title: "Quaquaval's Aqua Step into a Snorlax Substitute; ally Oricorio (Dancer) copies it",
  slots: slots(act(fast(game, mon("Quaquaval", "Moxie")), "Aqua Step", PR), idle(mon("Oricorio", "Dancer")), idle(L(game, 2)), idle(L(game, 0, { substitute: 58 }))),
  checks: "The Substitute breaks; the copy then hits the Snorlax (196-202).",
}));

// =====================================================================================================================
// R5-2: a status dance's success is useMove's result (sim/battle-actions.ts:304, read at :319): boost's success and
// addVolatile's as applied, before Defiant, White Herb at AfterMove (data/items.ts:7695-7697) or a Persim Berry at the Update.
// =====================================================================================================================
add("R5-DAN-WH", ["sv", "usum"], (game) => ({
  title: "Feather Dance into a White Herb Snorlax (restored at AfterMove); ally Oricorio copies it; the Snorlax's later Body Slam",
  slots: slots(idle(mon("Oricorio", "Dancer")), act(fast(game, mon("Oricorio-Pom-Pom", "Dancer")), "Feather Dance", PL), act(L(game, 0, { item: "White Herb" }), "Body Slam", OL), idle(L(game, 1))),
  checks: "The copy's -2 stays: Body Slam 36-43.",
}));
add("R5-DAN-TEETER", ["sv"], (game) => ({
  title: "Teeter Dance confuses all three (each cured by Persim at once); Oricorio (Dancer, Persim) copies it; later Body Slams",
  slots: slots(idle(mon("Oricorio", "Dancer", { item: "Persim Berry" })), act(fast(game, mon("Oricorio-Pom-Pom", "Dancer", { item: "Persim Berry" })), "Teeter Dance"),
    act(L(game, 0, { item: "Persim Berry" }), "Body Slam", OL), act(L(game, 1, { item: "Persim Berry" }), "Body Slam", OL)),
  checks: "data/items.ts:4522-4526 persimberry onUpdate; the copy confuses the Snorlaxes again (their self-hits).",
}));
add("R5-DAN-DEF", ["sv"], (game) => ({
  title: "Feather Dance into Defiant Kingambit (-2 then +2); ally Oricorio copies it",
  slots: slots(idle(mon("Oricorio", "Dancer")), act(fast(game, mon("Oricorio-Pom-Pom", "Dancer")), "Feather Dance", PL), act(mon("Kingambit", "Defiant"), "Iron Head", OL), idle(L(game, 1))),
  checks: "The copy step runs.",
}));
add("PC-DAN-MIRROR", ["sv"], (game) => ({
  title: "Feather Dance into Mirror Armor Corviknight: nothing applied to the target (boost's success null), no copy",
  slots: slots(idle(mon("Oricorio", "Dancer")), act(fast(game, mon("Oricorio-Pom-Pom", "Dancer")), "Feather Dance", PL), act(mon("Corviknight", "Mirror Armor"), "Brave Bird", OL), idle(L(game, 1))),
  checks: "data/abilities.ts mirrorarmor onTryBoost: the drop goes back; sim/battle.ts:2020 boost returns null for the target.",
}));
add("PC-DAN-CAP", ["sv"], (game) => ({
  title: "Feather Dance into a Snorlax at -6 Attack: nothing applied, no copy; its Body Slam",
  slots: slots(idle(mon("Oricorio", "Dancer")), act(fast(game, mon("Oricorio-Pom-Pom", "Dancer")), "Feather Dance", PL), act(L(game, 0, { boosts: { atk: -6 } }), "Body Slam", OL), idle(L(game, 1))),
  checks: "getCappedBoost: 0; no copy step.",
}));
add("PC-DAN-CLANG", ["sv"], (game) => ({
  title: "Kommo-o's Clangorous Soul; ally Oricorio (Dancer) copies it",
  slots: slots(act(fast(game, mon("Kommo-o", "Bulletproof")), "Clangorous Soul"), idle(mon("Oricorio", "Dancer")), idle(L(game, 0)), idle(L(game, 1))),
  checks: "Its onTryHit boost succeeds: the copy raises Oricorio's five stats and costs it a third.",
}));
add("PC-DAN-CONTRARY", ["sv"], (game) => ({
  title: "Contrary Lurantis with White Herb uses Swords Dance (-2, restored at AfterMove); ally Oricorio (Dancer) still copies it",
  slots: slots(act(fast(game, mon("Lurantis", "Contrary", { item: "White Herb" })), "Swords Dance"), act(mon("Oricorio", "Dancer"), "Air Slash", PL), idle(L(game, 0)), idle(L(game, 1))),
  checks: "The boost changed a stage: the copy runs (+2 Attack on Oricorio).",
}));

// =====================================================================================================================
// R5-3: the Choice lock (data/items.ts:995-997 onModifyMove adds choicelock for a Dancer's copy too; data/conditions.ts:324-348
// onStart takes the active move, onBeforeMove fails another move: shown used, then -fail).
// =====================================================================================================================
add("R5-DAN-SCARF", ["sv"], (game) => ({
  title: "Pom-Pom Oricorio's Quiver Dance; Choice Scarf Oricorio (Dancer, slower) copies it and is locked: its own Hurricane fails",
  slots: slots(act(brave(game, mon("Oricorio", "Dancer", { item: "Choice Scarf" })), "Hurricane", PL), act(fast(game, mon("Oricorio-Pom-Pom", "Dancer")), "Quiver Dance"), idle(L(game, 0)), idle(L(game, 1))),
  checks: "Hurricane is used and fails; the foe stays at 235.",
}));
add("R5-DAN-SCARF2", ["sv"], (game) => ({
  title: "Choice Scarf Oricorio (Dancer) uses Hurricane first; Pom-Pom Oricorio's later Quiver Dance: the copy fails (locked into Hurricane)",
  slots: slots(act(fast(game, mon("Oricorio", "Dancer", { item: "Choice Scarf" })), "Hurricane", PL), act(brave(game, mon("Oricorio-Pom-Pom", "Dancer")), "Quiver Dance"), idle(L(game, 0)), idle(L(game, 1))),
  checks: "No Sp. Atk, Sp. Def or Speed rise on the Scarf holder.",
}));
add("PC-DAN-SCARF-SD", ["sv", "usum"], (game) => ({
  title: "Garchomp's Swords Dance; the slower Choice Scarf Oricorio (Dancer) copies it and is locked: its own Air Slash fails",
  slots: slots(act(fast(game, mon("Garchomp", "Rough Skin")), "Swords Dance"), act(brave(game, mon("Oricorio", "Dancer", { item: "Choice Scarf" })), "Air Slash", PL), idle(L(game, 0)), idle(L(game, 1))),
  checks: "Air Slash fails: the foe untouched.",
}));
add("PC-DAN-SCARF-SD2", ["sv", "usum"], (game) => ({
  title: "Choice Scarf Oricorio (Dancer) uses Air Slash first; Garchomp's later Swords Dance: the copy fails",
  slots: slots(act(brave(game, mon("Garchomp", "Rough Skin")), "Swords Dance"), act(fast(game, mon("Oricorio", "Dancer", { item: "Choice Scarf" })), "Air Slash", PL), idle(L(game, 0)), idle(L(game, 1))),
  checks: "No +2 Attack on Oricorio.",
}));
add("PC-DAN-SCARF-MR", ["sv"], (game) => ({
  title: "Magic Room: Garchomp's Swords Dance; the slower Choice Scarf Oricorio (Dancer) copies it; its own Air Slash still works",
  field: { magicRoom: true },
  slots: slots(act(fast(game, mon("Garchomp", "Rough Skin")), "Swords Dance"), act(brave(game, mon("Oricorio", "Dancer", { item: "Choice Scarf" })), "Air Slash", PL), idle(L(game, 0)), idle(L(game, 1))),
  checks: "The item is ignored (sim/pokemon.ts ignoringItem): no lock.",
}));
add("PC-DAN-SCARF-OTHER", ["sv"], (game) => ({
  title: "Choice Scarf Oricorio (Dancer) whose last move was Hurricane picks Air Slash (no lock carried): it copies Swords Dance, then Air Slash fails",
  slots: slots(act(fast(game, mon("Garchomp", "Rough Skin")), "Swords Dance"), act(brave(game, mon("Oricorio", "Dancer", { item: "Choice Scarf", lastMove: "Hurricane" })), "Air Slash", PL), idle(L(game, 0)), idle(L(game, 1))),
  checks: "A lock into Hurricane would have let it pick nothing else.",
}));
add("PC-DAN-SCARF-NONE", ["sv"], (game) => ({
  title: "Choice Scarf Oricorio (Dancer) with no move since it came in: it copies Swords Dance, then Air Slash fails",
  slots: slots(act(fast(game, mon("Garchomp", "Rough Skin")), "Swords Dance"), act(brave(game, mon("Oricorio", "Dancer", { item: "Choice Scarf", lastMove: null })), "Air Slash", PL), idle(L(game, 0)), idle(L(game, 1))),
  checks: "lastMove null: no lock from an earlier turn.",
}));
add("PC-DAN-SCARF-LAST", ["sv"], (game) => ({
  title: "Choice Scarf Oricorio (Dancer) whose last move was its Air Slash: a lock from an earlier turn is not known (kept reason)",
  slots: slots(act(fast(game, mon("Garchomp", "Rough Skin")), "Swords Dance"), act(brave(game, mon("Oricorio", "Dancer", { item: "Choice Scarf", lastMove: "Air Slash" })), "Air Slash", PL), idle(L(game, 0)), idle(L(game, 1))),
  notEstimated: "Dancer needs whether Oricorio is locked into a move by Choice Scarf.",
  checks: "Locked into Air Slash (it held the Scarf then): the copy fails; not locked: the copy locks it and Air Slash fails.",
}));
add("PC-INS-SCARF", ["sv", "usum"], (game) => ({
  title: "Oranguru Instructs its slower Choice Band ally Garchomp (last move Dragon Claw): the instructed Dragon Claw locks it, its own Stone Edge fails",
  slots: slots(act(fast(game, mon("Oranguru", "Inner Focus")), "Instruct", OR),
    act(brave(game, mon("Garchomp", "Rough Skin", { item: "Choice Band", lastMove: "Dragon Claw", lastMoveTarget: PL })), "Stone Edge", PL), idle(L(game, 0)), idle(L(game, 1))),
  checks: "The instructed move is a move action (runMove, BeforeMove): it sets the lock; Stone Edge is used and fails.",
}));

// =====================================================================================================================
// R5-4: Instruct fails when the move slot's PP is 0 (data/moves.ts:9654-9660), after this turn's use spent 1
// (sim/battle-actions.ts:281) and 1 per Pressure foe it was aimed at (:467-482).
// =====================================================================================================================
add("R5-INS-PP", ["sv", "usum"], (game) => ({
  title: "Garchomp uses Dragon Claw with 1 PP left; slower Oranguru's Instruct on it (no PP left: fails)",
  slots: slots(act(mon("Oranguru", "Inner Focus"), "Instruct", OR), act(carried(fast(game, mon("Garchomp", "Rough Skin")), { ppLeft: { "Dragon Claw": 1 } }), "Dragon Claw", PR), idle(L(game, 2)), idle(L(game, 1))),
  checks: "The foe takes one Dragon Claw: 139-154.",
}));
add("R5-INS-PP3", ["sv"], (game) => ({
  title: "Control: Dragon Claw with 3 PP left; Instruct on it (2 left: used again)",
  slots: slots(act(mon("Oranguru", "Inner Focus"), "Instruct", OR), act(carried(fast(game, mon("Garchomp", "Rough Skin")), { ppLeft: { "Dragon Claw": 3 } }), "Dragon Claw", PR), idle(L(game, 2)), idle(L(game, 1))),
  checks: "Two Dragon Claws.",
}));
add("R5-INS-PRESS", ["sv", "usum"], (game) => ({
  title: "Dragon Claw with 2 PP left into a Pressure foe (2 spent); Instruct on it (no PP left: fails)",
  slots: slots(act(mon("Oranguru", "Inner Focus"), "Instruct", OR), act(carried(fast(game, mon("Garchomp", "Rough Skin")), { ppLeft: { "Dragon Claw": 2 } }), "Dragon Claw", PR), idle(L(game, 2)),
    idle(mon(game === "usum" ? "Aerodactyl" : "Corviknight", "Pressure"))),
  checks: "data/abilities.ts:3441-3444 pressure onDeductPP: one Dragon Claw (SV: 140-146).",
}));
add("PC-INS-PRESS3", ["sv"], (game) => ({
  title: "Control: Dragon Claw with 3 PP left into a Pressure foe (2 spent); Instruct on it (1 left: used again)",
  slots: slots(act(mon("Oranguru", "Inner Focus"), "Instruct", OR), act(carried(fast(game, mon("Garchomp", "Rough Skin")), { ppLeft: { "Dragon Claw": 3 } }), "Dragon Claw", PR), idle(L(game, 2)), idle(mon("Corviknight", "Pressure"))),
  checks: "Two Dragon Claws.",
}));
add("PC-INS-PRESS-ALLY", ["sv"], (game) => ({
  title: "Dragon Claw with 2 PP left at a foe without Pressure while the other foe has it (1 spent); Instruct on it (used again)",
  slots: slots(act(mon("Oranguru", "Inner Focus"), "Instruct", OR), act(carried(fast(game, mon("Garchomp", "Rough Skin")), { ppLeft: { "Dragon Claw": 2 } }), "Dragon Claw", PL), idle(L(game, 2)), idle(mon("Corviknight", "Pressure"))),
  checks: "pressureTargets are the move's targets only.",
}));
add("PC-INS-PRESS-EQ", ["sv"], (game) => ({
  title: "Earthquake with 2 PP left into a Pressure foe and its partner (2 spent); Instruct on it (fails)",
  slots: slots(act(mon("Oranguru", "Inner Focus"), "Instruct", OR), act(carried(fast(game, mon("Garchomp", "Rough Skin")), { ppLeft: { Earthquake: 2 } }), "Earthquake"), idle(L(game, 2)), idle(mon("Corviknight", "Pressure"))),
  checks: "The ally Oranguru is no Pressure target (an ally); one Earthquake.",
}));

// =====================================================================================================================
// R5-5: a strong weather ends with its last holder's faint in a hit (data/abilities.ts:954-963 onEnd clearWeather), and the
// step's field line keeps it ended. Primal Reversion exists in USUM only.
// =====================================================================================================================
add("R5-FC-PRIMAL", ["usum"], () => ({
  title: "Harsh Sunshine; Garchomp knocks out Groudon-Primal (1 HP): the sun ends; Castform reverts; its Weather Ball then",
  field: { weather: "Harsh Sunshine" },
  slots: slots(act(mon("Castform", "Forecast"), "Weather Ball", PR), act(fast("usum", mon("Garchomp", "Rough Skin")), "Dragon Claw", PL), idle(mon("Groudon-Primal", "Desolate Land", { hp: 1, item: "Red Orb" })), idle(L("usum", 1))),
  checks: "Weather Ball 21-25 (no weather); E2 weather none.",
}));
add("R5-FC-PRIMAL2", ["usum"], () => ({
  title: "Harsh Sunshine; Garchomp knocks out Groudon-Primal (1 HP): the sun ends; Blastoise's slower Water Pulse then works",
  field: { weather: "Harsh Sunshine" },
  slots: slots(act(mon("Blastoise", "Torrent"), "Water Pulse", PR), act(fast("usum", mon("Garchomp", "Rough Skin")), "Dragon Claw", PL), idle(mon("Groudon-Primal", "Desolate Land", { hp: 1, item: "Red Orb" })), idle(L("usum", 1))),
  checks: "Water Pulse 28-34.",
}));
add("V5-KYOGRE", ["usum"], () => ({
  title: "Heavy Rain; Garchomp knocks out 1 HP Kyogre-Primal; slower Arcanine's Flamethrower at Snorlax",
  field: { weather: "Heavy Rain" },
  slots: slots(act(fast("usum", mon("Garchomp", "Rough Skin")), "Dragon Claw", PL), act(mon("Arcanine", "Intimidate"), "Flamethrower", PR), idle(mon("Kyogre-Primal", "Primordial Sea", { hp: 1, item: "Blue Orb" })), idle(L("usum", 1))),
  checks: "Flamethrower 25-30.",
}));

// =====================================================================================================================
// R5-6: a caller's Dancer guard reads the moves it can call (Sleep Talk: its own moves).
// =====================================================================================================================
add("R5-ST-DANCER", ["sv", "usum"], (game) => ({
  title: "An asleep Snorlax's Sleep Talk (Body Slam only) while Garchomp uses Swords Dance and Oricorio (Dancer) copies it",
  slots: slots(act(L(game, 1, { status: "slp", moves: ["Body Slam"], exactMoves: true }), "Sleep Talk"), idle(mon("Oricorio", "Dancer")), act(fast(game, mon("Garchomp", "Rough Skin")), "Swords Dance"), idle(L(game, 2))),
  checks: "Sleep Talk calls Body Slam; no reason.",
}));
add("PC-ST-DANCE", ["sv"], (game) => ({
  title: "Kept: an asleep Snorlax's Sleep Talk with Swords Dance among its moves beside a Dancer",
  slots: slots(act(L(game, 1, { status: "slp", moves: ["Body Slam", "Swords Dance"], exactMoves: true }), "Sleep Talk"), idle(mon("Oricorio", "Dancer")), idle(L(game, 0)), idle(L(game, 2))),
  notEstimated: "Sleep Talk with Dancer is not modelled in 2v2.",
  checks: "A called dance is the action's active move (sim/battle-actions.ts runMove): the Dancer would copy it.",
}));

// =====================================================================================================================
// R5-7: a called Instruct is the direct one at the caller's random foe (data/moves.ts instruct: no failcopycat, nosleeptalk).
// =====================================================================================================================
add("V7B-CPY-INSTR", ["sv", "usum"], (game) => ({
  title: "Oranguru's Instruct at a foe with no last move (fails); Clefable's Copycat then calls Instruct at a random foe",
  slots: slots(act(fast(game, mon("Oranguru", "Inner Focus")), "Instruct", PR), act(mon("Clefable", "Magic Guard"), "Copycat"),
    idle(L(game, 1, { lastMove: "Body Slam", lastMoveTarget: OL })), idle(L(game, 0, { lastMove: null }))),
  checks: "Half the time the foe with a last move uses Body Slam again.",
}));
add("V7C-ST-INSTR", ["sv", "usum"], (game) => ({
  title: "An asleep Oranguru's Sleep Talk (Instruct only): it instructs a random foe",
  slots: slots(act(mon("Oranguru", "Inner Focus", { status: "slp", moves: ["Instruct"], exactMoves: true }), "Sleep Talk"), idle(L(game, 3)),
    idle(L(game, 1, { lastMove: "Body Slam", lastMoveTarget: OL })), idle(L(game, 0, { lastMove: "Body Slam", lastMoveTarget: OL }))),
  checks: "The instructed foe's Body Slam again.",
}));
add("R5-CPY-INSTR", ["sv"], (game) => ({
  title: "Oranguru's Instruct fails (no last move); Clefable's Copycat calls Instruct at a random foe: the one with a last move uses Body Slam again",
  slots: slots(act(fast(game, mon("Oranguru", "Inner Focus")), "Instruct", PL), act(mon("Clefable", "Magic Guard"), "Copycat"),
    idle(L(game, 0, { lastMove: null })), idle(L(game, 1, { lastMove: "Body Slam", lastMoveTarget: OL }))),
  checks: "As the direct Instruct at that foe.",
}));

// =====================================================================================================================
// Pass D (R6-NNU-U, R7-T-R). R7-1: Heal Block keeps an HP Berry at the kernel's Update (data/items.ts sitrusberry
// onTryEatItem: TryHeal; data/moves.ts healblock condition onTryHeal: false; sim/pokemon.ts copyVolatileFrom passes healblock).
// =====================================================================================================================
add("R7-BP-HB2", ["sv"], (game) => ({
  title: "Baton Pass passes Heal Block to a newcomer at 80 HP with a Sitrus Berry; the foe's later Body Slam into it",
  slots: slots(act(fast(game, mon("Ambipom", "Technician", { carried: { healBlock: 1 } })), "Baton Pass"), idle(L(game, 1)), act(L(game, 4), "Body Slam", OL), idle(L(game, 3))),
  bench: bench([member("lax", L(game, 2, { hp: 80, item: "Sitrus Berry" }))]),
  checks: "The newcomer keeps its Sitrus Berry until Heal Block ends at the residual: 0-5 HP after the Body Slam, KO 56.25%.",
}));
add("R7-BP-HB3", ["champions"], (game) => ({
  title: "Champions: Espeon's Baton Pass passes Heal Block to a newcomer at 80 HP with a Sitrus Berry; the foe's later Body Slam",
  slots: slots(act(fast(game, mon("Espeon", "Synchronize", { carried: { healBlock: 1 } })), "Baton Pass"), idle(L(game, 1)), act(L(game, 4), "Body Slam", OL), idle(L(game, 3))),
  bench: bench([member("lax", L(game, 2, { hp: 80, item: "Sitrus Berry" }))]),
  checks: "As RV2-R7-BP-HB2 in Champions (Psychic Noise's Heal Block passed by Baton Pass).",
}));
add("R7-UNNERVE-HB", ["sv", "usum"], (game) => ({
  title: "Heal-blocked Snorlax at 80 HP with a Sitrus Berry; the foe's Unnerve Tyranitar at 1 HP is knocked out: no Sitrus (Heal Block)",
  slots: slots(act(fast(game, mon("Garchomp", "Rough Skin")), "Dragon Claw", PL), act(L(game, 1, { hp: 80, item: "Sitrus Berry", carried: { healBlock: 2 } }), null),
    idle(mon("Tyranitar", "Unnerve", { hp: 1 })), idle(L(game, 3))),
  checks: "The kernel's unnerveEnds after the faint: Heal Block keeps the Sitrus Berry; Snorlax stays at 80.",
}));
add("R7-UNNERVE-UT-HB", ["sv"], (game) => ({
  title: "Unnerve Corviknight U-turns out; the heal-blocked foe at 80 HP keeps its Sitrus Berry (Heal Block), as it did under Unnerve",
  slots: slots(act(mon("Corviknight", "Unnerve"), "U-turn", PR), idle(L(game, 1)), idle(L(game, 4, { hp: 80, item: "Sitrus Berry", carried: { healBlock: 2 } })), idle(L(game, 3))),
  bench: bench([member("lax", L(game, 2))]),
  checks: "R's unnerveEnds as the Unnerve holder leaves: no Sitrus under Heal Block.",
}));
add("V-PN-UNNERVE", ["sv"], (game) => ({
  title: "Psychic Noise heal-blocks Snorlax at 80 HP (Sitrus); then the foe's Unnerve Tyranitar at 1 HP is knocked out",
  slots: slots(act(brave(game, mon("Garchomp", "Rough Skin")), "Dragon Claw", PL), idle(L(game, 1, { hp: 80, item: "Sitrus Berry" })),
    idle(mon("Tyranitar", "Unnerve", { hp: 1 })), act(fast(game, mon("Indeedee", "Inner Focus")), "Psychic Noise", OR)),
  checks: "Heal Block from this turn's Psychic Noise: 31-38 with the Sitrus kept.",
}));
add("PD-HB-POUCH", ["sv"], (game) => ({
  title: "Heal-blocked Dedenne (Cheek Pouch) at 20 HP with a Liechi Berry; the foe's Unnerve Tyranitar is knocked out: Liechi eaten, no Cheek Pouch heal",
  slots: slots(act(fast(game, mon("Garchomp", "Rough Skin")), "Dragon Claw", PL), idle(mon("Dedenne", "Cheek Pouch", { hp: 20, item: "Liechi Berry", carried: { healBlock: 2 } })),
    idle(mon("Tyranitar", "Unnerve", { hp: 1 })), idle(L(game, 3))),
  checks: "A pinch Berry is eaten under Heal Block (+1 Attack); Cheek Pouch's heal fails (TryHeal): Dedenne stays at 20.",
}));
add("PD-HB-SPIKY", ["sv", "champions"], (game) => ({
  title: "Heal-blocked Snorlax (130 HP, Sitrus) Body Slams into a Spiky Shield: the loss takes it under half; no Sitrus (the kernel's afterLoss)",
  slots: slots(act(L(game, 1, { hp: 130, item: "Sitrus Berry", carried: { healBlock: 2 } }), "Body Slam", PL), idle(L(game, 0)),
    act(fast(game, mon("Chesnaught", "Bulletproof")), "Spiky Shield"), idle(L(game, 2))),
  checks: "Spiky Shield's 1/8 at the Update with Heal Block up: Snorlax ends at 101 holding its Sitrus Berry.",
}));

// =====================================================================================================================
// R7-2: hazards act in the order they went up (sim/battle.ts resolvePriority: SwitchIn handlers' effectOrder) and none
// after a knock-out (fieldEvent's faintMessages, then a fainted holder's handlers skipped). The case's hazards are added in
// its order (sim-dfs prepare), and app-turn.ts passes that order (DoublesHazards.order).
// =====================================================================================================================
add("R7-WEBSR-DEF-TURN", ["sv"], (game) => ({
  title: "Ribombee (Mirror Herb) sets Sticky Web, Garchomp Stealth Rock; Scizor's slower U-turn brings in Defiant Kingambit at 10 HP",
  slots: slots(act(brave(game, mon("Scizor", "Technician")), "U-turn", PR), idle(L(game, 1)),
    act(fast(game, mon("Ribombee", "Shield Dust", { item: "Mirror Herb" })), "Sticky Web"), act(mon("Garchomp", "Rough Skin"), "Stealth Rock")),
  bench: bench([member("gambit", mon("Kingambit", "Defiant", { hp: 10 })), member("lax", L(game, 2))]),
  checks: "Sticky Web first: Defiant +2, the foe's Mirror Herb copies it (used up), then Stealth Rock knocks Kingambit out.",
}));
add("R7-WEBSR-DEF-PRE", ["sv"], (game) => ({
  title: "Sticky Web then Stealth Rock up before the turn; U-turn brings in Defiant Kingambit at 10 HP; the foe's Mirror Herb copies +2 Attack",
  field: { own: { hazards: ["stickyweb", "stealthrock"] } },
  slots: slots(act(fast(game, mon("Scizor", "Technician")), "U-turn", PR), idle(L(game, 1)), act({ ...L(game, 4), item: "Mirror Herb" }, "Body Slam", OR), idle(L(game, 3))),
  bench: bench([member("gambit", mon("Kingambit", "Defiant", { hp: 10 })), member("lax", L(game, 2))]),
  checks: "The Mirror Herb holder's later Body Slam at +2: 147-174.",
}));
add("R7-SRWEB-DEF-PRE", ["sv"], (game) => ({
  title: "Stealth Rock then Sticky Web up before the turn (control): Kingambit at 10 HP faints first; no copy",
  field: { own: { hazards: ["stealthrock", "stickyweb"] } },
  slots: slots(act(fast(game, mon("Scizor", "Technician")), "U-turn", PR), idle(L(game, 1)), act({ ...L(game, 4), item: "Mirror Herb" }, "Body Slam", OR), idle(L(game, 3))),
  bench: bench([member("gambit", mon("Kingambit", "Defiant", { hp: 10 })), member("lax", L(game, 2))]),
  checks: "No Sticky Web after the knock-out: the Mirror Herb stays, the Body Slam 75-88.",
}));
add("V-TS-SR-POISON", ["sv", "usum"], (game) => ({
  title: "Toxic Spikes then Stealth Rock up before the turn; U-turn brings in Toxapex at 5 HP: it takes the Toxic Spikes away, then faints",
  field: { own: { hazards: ["toxicspikes", "stealthrock"] } },
  slots: slots(act(fast(game, mon("Scizor", "Technician")), "U-turn", PR), idle(L(game, 1)), idle(L(game, 4)), idle(L(game, 3))),
  bench: bench([member("pex", mon("Toxapex", "Regenerator", { hp: 5 })), member("lax", L(game, 2))]),
  checks: "E2: only Stealth Rock stays on your side.",
}));
add("PD-SR-TS-POISON", ["sv", "usum"], (game) => ({
  title: "Stealth Rock then Toxic Spikes up before the turn (control): Toxapex at 5 HP faints first; the Toxic Spikes stay",
  field: { own: { hazards: ["stealthrock", "toxicspikes"] } },
  slots: slots(act(fast(game, mon("Scizor", "Technician")), "U-turn", PR), idle(L(game, 1)), idle(L(game, 4)), idle(L(game, 3))),
  bench: bench([member("pex", mon("Toxapex", "Regenerator", { hp: 5 })), member("lax", L(game, 2))]),
  checks: "E2: both stay.",
}));
add("PD-WEB-MIRROR-SR", ["sv"], (game) => ({
  title: "Sticky Web then Spikes up before the turn; a grounded Mirror Armor newcomer at 5 HP sends the drop back, then faints",
  field: { own: { hazards: ["stickyweb", "spikes"] } },
  slots: slots(act(fast(game, mon("Scizor", "Technician")), "U-turn", PR), idle(L(game, 1)), act(L(game, 4), "Body Slam", OR), idle(L(game, 3))),
  bench: bench([member("corv", mon("Corviknight", "Mirror Armor", { hp: 5, item: "Iron Ball" })), member("lax", L(game, 2))]),
  checks: "The foe at position 0 takes the −1 Speed before Spikes knocks Corviknight out.",
}));

// =====================================================================================================================
// R6-3: a protecting move reached through Instruct or Sleep Talk rolls last turn's counter (data/conditions.ts stall,
// duration 2; data/moves.ts protect onPrepareHit StallMove; instruct re-runs lastMove; sleeptalk a move slot).
// =====================================================================================================================
add("R6-INS-PROT-STL3", ["sv", "usum"], (game) => ({
  title: "Oranguru (fast) Instructs its ally Snorlax, whose Protect last turn worked (stall 3); a foe's Body Slam into Snorlax; Snorlax's own Body Slam last",
  slots: slots(act(mon("Oranguru", "Inner Focus", { evs: fastEvs(game) }), "Instruct", OR),
    act(carried(L(game, 0, { lastMove: "Protect", moves: ["Protect", "Body Slam"], exactMoves: true }), { stall: 3 }), "Body Slam", PL),
    act(L(game, 20), "Body Slam", OR), idle(L(game, 1))),
  checks: "Protected in 1/3: Snorlax 147-235, average 181.04.",
}));
add("R6-INS-PROT-NONE", ["sv"], (game) => ({
  title: "The same without a stall input: the turn assumes no protecting move last turn",
  slots: slots(act(mon("Oranguru", "Inner Focus", { evs: fastEvs(game) }), "Instruct", OR),
    act(L(game, 0, { lastMove: "Protect", moves: ["Protect", "Body Slam"], exactMoves: true }), "Body Slam", PL),
    act(L(game, 20), "Body Slam", OR), idle(L(game, 1))),
  checks: "Protected always, with the fact \"Assumes no protecting move was used last turn.\"",
}));
add("PD-INS-ENDURE-STL9", ["sv"], (game) => ({
  title: "Oranguru Instructs Snorlax at 30 HP, whose Endure the two turns before worked (stall 9); a foe Garchomp's Dragon Claw into Snorlax",
  slots: slots(act(mon("Oranguru", "Inner Focus", { evs: fastEvs(game) }), "Instruct", OR),
    act(carried(L(game, 0, { hp: 30, lastMove: "Endure", moves: ["Endure", "Body Slam"], exactMoves: true }), { stall: 9 }), "Body Slam", PL),
    act(brave(game, mon("Garchomp", "Rough Skin")), "Dragon Claw", OR), idle(L(game, 1))),
  checks: "Endure works in 1/9; Snorlax's Body Slam then meets Rough Skin at 1 HP.",
}));
add("R6-STALK-STL3", ["sv", "usum"], (game) => ({
  title: "An asleep fast Snorlax (Protect, Body Slam) Sleep Talks with stall 3 from last turn; a slower Snorlax's Body Slam into it",
  slots: slots(act(carried(L(game, 31, { status: "slp", moves: ["Protect", "Body Slam"], exactMoves: true }), { stall: 3 }), "Sleep Talk"), idle(L(game, 1)),
    act(L(game, 0), "Body Slam", OL), idle(L(game, 2))),
  checks: "Sleep Talk calls Protect in 1/2, which works in 1/3: the Body Slam is blocked in 1/6.",
}));
add("R6-STALK-NONE", ["sv"], (game) => ({
  title: "The same with no stall input: the turn assumes no protecting move last turn",
  slots: slots(act(L(game, 31, { status: "slp", moves: ["Protect", "Body Slam"], exactMoves: true }), "Sleep Talk"), idle(L(game, 1)),
    act(L(game, 0), "Body Slam", OL), idle(L(game, 2))),
  checks: "Blocked in 1/2, with the assumption.",
}));

// =====================================================================================================================
// R6-1, R6-2, R6-7: the engine is exact with the inputs the calculator now passes (Conversion 2's target's last move,
// the moves a Snatch or Copycat user reads for Conversion, the side's bench for an instructed U-turn).
// =====================================================================================================================
add("R6-CONV2", ["sv", "usum"], (game) => ({
  title: "Porygon2's Conversion 2 into a slower Snorlax whose last move was Body Slam: Rock, Steel or Ghost, 1/3 each; that Snorlax's Body Slam into Porygon2",
  slots: slots(act(fast(game, mon("Porygon2", "Analytic")), "Conversion 2", PL), idle(L(game, 1)), act(L(game, 0, { lastMove: "Body Slam" }), "Body Slam", OL), idle(L(game, 2))),
  checks: "data/moves.ts conversion2 reads target.lastMoveUsed: a Ghost Porygon2 takes no Body Slam (1/3).",
}));
add("R6-SNT-CONV", ["usum"], (game) => ({
  title: "USUM: Absol (Psycho Cut first) Snatches Porygon's Conversion: Absol becomes Psychic; a slower foe's Dark Pulse into Absol",
  slots: slots(act(mon("Absol", "Pressure", { evs: fastEvs(game), moves: ["Psycho Cut", "Snatch"], exactMoves: true }), "Snatch"), idle(L(game, 0)),
    act(mon("Porygon", "Analytic", { moves: ["Conversion", "Tackle"] }), "Conversion"), act(mon("Houndoom", "Flash Fire"), "Dark Pulse", OL)),
  checks: "data/moves.ts conversion onHit: the snatcher's moveSlots[0].",
}));
add("R6-COPY-CONV", ["sv", "usum"], (game) => ({
  title: "Porygon2 (fast) uses Conversion; Azumarill (Ice Beam first) Copycats it and becomes Ice; a slower Snorlax's Fire Punch into Azumarill",
  slots: slots(act(mon("Porygon2", "Analytic", { evs: fastEvs(game), moves: ["Thunderbolt", "Conversion"], exactMoves: true }), "Conversion"),
    act(mon("Azumarill", "Thick Fat", { moves: ["Ice Beam", "Copycat"], exactMoves: true }), "Copycat"),
    act(L(game, 0, { nature: "Brave", ivs: { spe: 0 } }), "Fire Punch", OR), idle(L(game, 1))),
  checks: "The Copycat user's own first move gives its type.",
}));
add("V-INSU-BENCH", ["sv", "usum"], (game) => ({
  title: "Trick Room: Oranguru Instructs Ambipom (last move U-turn at the foe Snorlax); Ambipom switches to Corviknight (USUM: Skarmory)",
  field: { trickRoom: true },
  slots: slots(act(mon("Oranguru", "Inner Focus"), "Instruct", OR),
    act(mon("Ambipom", "Technician", { lastMove: "U-turn", lastMoveTarget: PL, moves: ["U-turn", "Double Hit"], exactMoves: true }), "Double Hit", PL),
    act(L(game, 0), "Body Slam", OR), act(L(game, 1), "Body Slam", OL)),
  bench: bench([member("corv", game === "usum" ? mon("Skarmory", "Sturdy") : mon("Corviknight", "Pressure"))]),
  checks: "Instruct: Ambipom uses U-turn again and switches out; the bench Pokémon comes in.",
}));
// =====================================================================================================================
// Final pass (open from pass A, PA-BZK-START-GAS): a Berserk or Anger Shell lock under a suppressed ability. The lock is the
// ability's state (data/abilities.ts berserk, angershell: checkedBerserk false); a suppressed ability (Neutralizing Gas,
// Gastro Acid: sim/pokemon.ts ignoringAbility) runs no onTryEatItem, onDamage or onAfterMoveSecondary, so the lock stays
// (E2 berryLocked) and keeps nothing (doubles-guards.ts lockActs).
// =====================================================================================================================
const zerkPE = (game: Game, hp: number) => carried(mon(game === "sv" ? "Moltres-Galar" : "Drampa", "Berserk", { item: "Sitrus Berry", hp }), { berryLocked: true });
add("PE-BZK-START-GAS", ["sv", "swsh"], (game) => ({
  title: "Neutralizing Gas from the start: a carried Berserk lock at 70 HP keeps nothing, so the turn's first Update eats the Sitrus; the lock stays",
  slots: slots(idle(mon("Weezing-Galar", "Neutralizing Gas")), idle(L(game, 2)), idle(zerkPE(game, 70)), idle(L(game, 3))),
  checks: "ignoringAbility: no onTryEatItem, no onAfterMoveSecondary for its Splash; E2 berryLocked 1.",
}));
add("PE-GAS-BZK-IDLE", ["sv", "swsh"], (game) => ({
  title: "Neutralizing Gas: the idle Berserk holder at 120 HP keeps its lock (its Splash runs no AfterMoveSecondary handler)",
  slots: slots(idle(mon("Weezing-Galar", "Neutralizing Gas")), idle(L(game, 2)), idle(zerkPE(game, 120)), idle(L(game, 3))),
  checks: "E2 berryLocked 1, HP 120.",
}));
add("PE-GAS-BZK-HIT", ["sv", "swsh"], (game) => ({
  title: "Neutralizing Gas: a Body Slam takes the locked Berserk holder under half; the Sitrus is eaten at the hit's Update and the lock stays",
  slots: slots(idle(mon("Weezing-Galar", "Neutralizing Gas")), act(L(game, 2), "Body Slam", PL), idle(zerkPE(game, 120)), idle(L(game, 3))),
  checks: "No onDamage, no onTryEatItem: Body Slam then the Sitrus; no Berserk rise; E2 berryLocked 1.",
}));
add("PE-GA-BZK-HIT", ["sv", "usum"], (game) => ({
  title: "Gastro Acid on a locked Berserk holder, then a Body Slam under half: the Sitrus is eaten (SV: Moltres-Galar's own Splash first ends the lock)",
  slots: slots(act(fast(game, mon("Swalot", "Sticky Hold")), "Gastro Acid", PL), act(L(game, 2), "Body Slam", PL), idle(zerkPE(game, 120)), idle(L(game, 3))),
  checks: "USUM: Drampa is slower than Swalot, so the lock stays (E2 1); SV: Moltres-Galar's Splash comes first and its working Berserk ends it (E2 0).",
}));
add("PE-GA-BZK-LOW", ["sv", "usum"], (game) => ({
  title: "Gastro Acid on a locked Berserk holder at 70 HP (USUM: Drampa, slower; SV: Moltres-Galar, faster): the Sitrus is eaten",
  slots: slots(act(fast(game, mon("Swalot", "Sticky Hold")), "Gastro Acid", PL), idle(L(game, 2)), idle(zerkPE(game, 70)), idle(L(game, 3))),
  checks: "USUM: Gastro Acid's Update eats the Sitrus, the lock stays; SV: the holder's own Splash ends the lock first.",
}));
add("PE-GA-KLAWF-LOW", ["sv"], (game) => ({
  title: "Gastro Acid on a slower locked Anger Shell Klawf at 70 HP: the Sitrus is eaten at the action's Update; the lock stays",
  slots: slots(act(fast(game, mon("Swalot", "Sticky Hold")), "Gastro Acid", PL), idle(L(game, 2)), idle(carried(mon("Klawf", "Anger Shell", { item: "Sitrus Berry", hp: 70 }), { berryLocked: true })), idle(L(game, 3))),
  checks: "angershell onAfterMoveSecondary suppressed for Klawf's Splash: E2 berryLocked 1, HP 106.",
}));
// =====================================================================================================================
// Round 2 (ADDENDUM2 §8.8, the review fixer's second round: status2/build/REVIEW2-FIX-2.md). Ids keep the round-2
// reviewer's or verifier's probe id: Q2-/V1-/V2- R1-A1-K, RB-/VT- R2-A2A3-H, R2- R3-DE-F and R5-PRCLST-FC, R2E-/R2-M-/V-
// R4-SW-M, R6R2- R6-NNU-U, R2-SR1-/R2-TS1-/V1-SP1-/V2-TS1- R7-T-R, Q- this round's fixer.
// =====================================================================================================================
const gmax2 = (m: CaseMon, move: string): CaseMon => ({ ...m, choice: "dynamax", gigantamax: true, appBuild: { mechanic: "gigantamax", configuration: { dynamaxLevel: 10, gigantamax: true } }, moves: [move] });
const dmax2 = (m: CaseMon, move: string): CaseMon => ({ ...m, choice: "dynamax", moves: [move] });
const rcKnock = (game: Game, user: CaseMon, move: string, target: typeof PR | undefined, ally: CaseMon = mon("Metagross", "Clear Body")) =>
  slots(target ? act(fast(game, user), move, target) : act(fast(game, user), move), idle(ally), idle(mon("Passimian", "Receiver")), idle(mon("Incineroar", "Intimidate", { hp: 1, boosts: {} })));

// R2-A1K-01: Receiver's breaker is the move as it runs (sim/battle-actions.ts:397-407 the Z or Max form; :422-425 a called
// move's ignoreAbility is its caller's; sim/battle.ts:365-368 suppressingAbility).
add("Q2-RC-GMAX-DRUM", ["swsh"], (game) => ({
  title: "Gigantamax Rillaboom's G-Max Drum Solo (ignoreAbility) knocks out a 1 HP Incineroar; Passimian receives Intimidate: Metagross's Clear Body is suppressed",
  slots: rcKnock(game, gmax2(mon("Rillaboom", "Overgrow"), "Wood Hammer"), "Wood Hammer", PR),
  checks: "data/moves.ts:6889 gmaxdrumsolo ignoreAbility: E2 Metagross −1 Attack.",
}));
add("Q2-RC-GMAX-FIREBALL", ["swsh"], (game) => ({
  title: "Gigantamax Cinderace's G-Max Fireball (ignoreAbility) knocks out a 1 HP Incineroar; Passimian receives Intimidate: Clear Body is suppressed; Metagross's later Body Slam",
  slots: slots(act(fast(game, gmax2(mon("Cinderace", "Blaze"), "Pyro Ball")), "Pyro Ball", PR),
    act(mon("Metagross", "Clear Body", slowest(game)), "Body Slam", PL), idle(mon("Passimian", "Receiver")), idle(mon("Incineroar", "Intimidate", { hp: 1, boosts: {} }))),
  checks: "data/moves.ts:6927 gmaxfireball ignoreAbility: Metagross at −1, its Body Slam 34–40.",
}));
add("Q2-RC-MAXSTEEL", ["swsh"], (game) => ({
  title: "Dynamaxed Solgaleo's Sunsteel Strike is Max Steelspike (no ignoreAbility): Metagross's Clear Body blocks the received Intimidate",
  slots: rcKnock(game, dmax2(mon("Solgaleo", "Full Metal Body"), "Sunsteel Strike"), "Sunsteel Strike", PR),
  checks: "data/moves.ts:11424 maxsteelspike has no ignoreAbility (getActiveMaxMove, sim/battle-actions.ts:1494).",
}));
add("V1-GMAX-HYDRO-HC", ["swsh"], (game) => ({
  title: "Gigantamax Inteleon's G-Max Hydrosnipe knocks out a 1 HP Incineroar; Passimian receives Intimidate: Kingler's Hyper Cutter is suppressed",
  slots: rcKnock(game, gmax2(mon("Inteleon", "Torrent"), "Hydro Pump"), "Hydro Pump", PR, mon("Kingler", "Hyper Cutter")),
  checks: "gmaxhydrosnipe ignoreAbility: Kingler −1 Attack.",
}));
add("V1-MAXPHANTASM", ["swsh"], (game) => ({
  title: "Dynamaxed Lunala's Moongeist Beam is Max Phantasm (no ignoreAbility): Metagross's Clear Body holds",
  slots: rcKnock(game, dmax2(mon("Lunala", "Shadow Shield"), "Moongeist Beam"), "Moongeist Beam", PR),
  checks: "maxphantasm has no ignoreAbility.",
}));
add("Q2-RC-CORKSCREW", ["usum"], (game) => ({
  title: "Solgaleo's Sunsteel Strike with Steelium Z is Corkscrew Crash (no ignoreAbility): Metagross's Clear Body blocks the received Intimidate",
  slots: rcKnock(game, mon("Solgaleo", "Full Metal Body", { item: "Steelium Z", choice: "zmove" }), "Sunsteel Strike", PR),
  checks: "data/moves.ts:2899 corkscrewcrash has no ignoreAbility (getActiveZMove, sim/battle-actions.ts:1425-1445).",
}));
add("Q2-RC-SUNRAZE", ["usum"], (game) => ({
  title: "Control: Solgaleo's Searing Sunraze Smash (Solganium Z; ignoreAbility): Metagross's Clear Body is suppressed",
  slots: rcKnock(game, mon("Solgaleo", "Full Metal Body", { item: "Solganium Z", choice: "zmove" }), "Sunsteel Strike", PR),
  checks: "searingsunrazesmash ignoreAbility: −1 Attack.",
}));
add("V1-NEVERENDING", ["usum"], (game) => ({
  title: "Lunala's Moongeist Beam with Ghostium Z is Never-Ending Nightmare (no ignoreAbility): Metagross's Clear Body holds",
  slots: rcKnock(game, mon("Lunala", "Shadow Shield", { item: "Ghostium Z", choice: "zmove" }), "Moongeist Beam", PR),
  checks: "neverendingnightmare has no ignoreAbility.",
}));
add("Q2-RC-STALK-MYC-SWIFT", ["sv"], (game) => ({
  title: "Asleep Toedscruel (Mycelium Might) Sleep Talks into Swift, which takes Sleep Talk's ignoreAbility; Passimian receives Intimidate after the hits: Metagross's Clear Body is suppressed",
  slots: rcKnock(game, mon("Toedscruel", "Mycelium Might", { status: "slp", moves: ["Swift"], exactMoves: true }), "Sleep Talk", undefined),
  checks: "sim/battle-actions.ts:422-425 move.ignoreAbility = sourceEffect.ignoreAbility; data/abilities.ts:2801-2805 myceliummight.",
}));
add("Q2-RC-MYC-SWIFT-DIRECT", ["sv"], (game) => ({
  title: "Control: Toedscruel (Mycelium Might) uses Swift itself (not a status move): Metagross's Clear Body blocks the received Intimidate",
  slots: rcKnock(game, mon("Toedscruel", "Mycelium Might"), "Swift", undefined),
  checks: "No ignoreAbility on a damaging move.",
}));
add("Q2-RC-STALK-MYC", ["sv"], (game) => ({
  title: "Asleep Toedscruel (Mycelium Might) Sleep Talks into Earth Power: the single-target called move takes Sleep Talk's ignoreAbility; Clear Body is suppressed",
  slots: rcKnock(game, mon("Toedscruel", "Mycelium Might", { status: "slp", moves: ["Earth Power"], exactMoves: true }), "Sleep Talk", undefined),
  checks: "The called move's ignoreAbility is Sleep Talk's (Mycelium Might on a status move).",
}));
add("Q2-RC-STALK-SUN", ["sv", "usum"], (game) => ({
  title: "Asleep Solgaleo's Sleep Talk calls Sunsteel Strike: the called move takes Sleep Talk's ignoreAbility (none), so Clear Body blocks the received Intimidate",
  slots: rcKnock(game, mon("Solgaleo", "Full Metal Body", { status: "slp", moves: ["Sunsteel Strike"], exactMoves: true }), "Sleep Talk", undefined),
  checks: "sim/battle-actions.ts:422-425: a called Sunsteel Strike loses its own ignoreAbility.",
}));
add("Q2-RC-SUN-DIRECT", ["sv", "usum"], (game) => ({
  title: "Control: Solgaleo's own Sunsteel Strike knocks out the 1 HP Incineroar: Clear Body is suppressed",
  slots: rcKnock(game, mon("Solgaleo", "Full Metal Body"), "Sunsteel Strike", PR),
  checks: "sunsteelstrike ignoreAbility: −1 Attack.",
}));
// R2-A1K-02: no move runs at a switch request's newcomer (sim/battle.ts:2831 clearActiveMove); Pursuit at a switch-out runs as
// its own move (data/moves.ts:14432).
add("Q2-RC-EJECT-SR2", ["sv", "swsh", "usum"], (game) => ({
  title: "Mold Breaker Excadrill's Iron Head hits Eject Button Snorlax; its newcomer Incineroar faints to Stealth Rock after the move; Passimian's Intimidate meets Metagross's Clear Body; Metagross's later Body Slam",
  slots: slots(act(fast(game, mon("Excadrill", "Mold Breaker")), "Iron Head", PL),
    act(mon("Metagross", "Clear Body", slowest(game)), "Body Slam", PR), idle(L(game, 2, { item: "Eject Button" })), idle(mon("Passimian", "Receiver"))),
  bench: bench(undefined, [member("incin", mon("Incineroar", "Intimidate", { hp: 10 }))]),
  field: { opponent: { hazards: ["stealthrock"] } },
  checks: "No active move at the switch request: Clear Body blocks; the Body Slam 50–59.",
}));
add("Q2-RC-EJECT-SR-CTRL", ["sv"], (game) => ({
  title: "Control: Garchomp's Iron Head hits Eject Button Snorlax; the newcomer Incineroar faints to Stealth Rock; Passimian's Intimidate meets Metagross's Clear Body",
  slots: slots(act(fast(game, mon("Garchomp", "Rough Skin")), "Iron Head", PL),
    idle(mon("Metagross", "Clear Body")), idle(L(game, 2, { item: "Eject Button" })), idle(mon("Passimian", "Receiver"))),
  bench: bench(undefined, [member("incin", mon("Incineroar", "Intimidate", { hp: 10 }))]),
  field: { opponent: { hazards: ["stealthrock"] } },
  checks: "Clear Body blocks.",
}));
add("V2-EJECTPACK-SR", ["sv", "swsh"], (game) => ({
  title: "Mold Breaker Excadrill's Rock Tomb sets off Snorlax's Eject Pack; the newcomer Incineroar faints to Stealth Rock; Passimian's Intimidate meets Metagross's Clear Body",
  slots: slots(act(fast(game, mon("Excadrill", "Mold Breaker")), "Rock Tomb", PL),
    idle(mon("Metagross", "Clear Body")), idle(L(game, 2, { item: "Eject Pack" })), idle(mon("Passimian", "Receiver"))),
  bench: bench(undefined, [member("incin", mon("Incineroar", "Intimidate", { hp: 10 }))]),
  field: { opponent: { hazards: ["stealthrock"] } },
  checks: "No active move at the switch request: Clear Body blocks.",
}));
add("Q2-RC-MOLD-RH", ["sv"], (game) => ({
  title: "Mold Breaker Excadrill (20 HP) Iron Heads a 1 HP Rocky Helmet Incineroar: both faint in one batch inside the move; Passimian's Intimidate passes Metagross's Clear Body",
  slots: rcKnock(game, mon("Excadrill", "Mold Breaker", { hp: 20 }), "Iron Head", PR),
  checks: "The faint batch runs inside Iron Head (sim/battle-actions.ts:974).",
}));
add("Q2-RC-PURSUIT", ["usum"], (game) => ({
  title: "USUM: 1 HP Incineroar (Intimidate) U-turns; Mold Breaker Rampardos's Pursuit knocks it out as it leaves; Passimian receives Intimidate: Metagross's Clear Body is suppressed",
  slots: slots(act(mon("Rampardos", "Mold Breaker"), "Pursuit", PL), idle(mon("Metagross", "Clear Body")),
    act(fast(game, mon("Incineroar", "Intimidate", { hp: 1, boosts: {} })), "U-turn", OR), idle(mon("Passimian", "Receiver"))),
  bench: bench(undefined, [member("laxo", L(game, 3))]),
  checks: "data/moves.ts:14432 Pursuit's runMove in onBeforeSwitchOut: its ignoreAbility holds; Metagross −1.",
}));
add("V2-PURSUIT-CTRL", ["usum"], (game) => ({
  title: "Control (USUM): Unnerve Tyranitar's Pursuit knocks out the U-turning 1 HP Incineroar; Passimian receives Intimidate: Metagross's Clear Body holds",
  slots: slots(act(mon("Tyranitar", "Unnerve"), "Pursuit", PL), idle(mon("Metagross", "Clear Body")),
    act(fast(game, mon("Incineroar", "Intimidate", { hp: 1, boosts: {} })), "U-turn", OR), idle(mon("Passimian", "Receiver"))),
  bench: bench(undefined, [member("laxo", L(game, 3))]),
  checks: "No breaker: Clear Body blocks.",
}));
// R2-A2A3-H-r2-1, R5r2-1: a Choice item that reaches a locked Pokémon ends the lock (data/items.ts:965-970, 989-994,
// 1012-1017 onStart removeVolatile('choicelock'); sim/pokemon.ts:1885-1887 setItem's Start; sim/battle.ts:607 not suppressed).
add("RB-TRICK-LOCK", ["sv", "usum"], (game) => ({
  title: "Choice Scarf Oricorio (Dancer) Air Slashes first; a Choice Specs holder Tricks it (Oricorio gets Specs: the lock ends); Garchomp's Swords Dance: the copy goes",
  slots: slots(act(fast(game, mon("Oricorio", "Dancer", { item: "Choice Scarf" })), "Air Slash", PL), idle(L(game, 0)),
    act(game === "sv" ? mon("Gardevoir", "Synchronize", { item: "Choice Specs" }) : mon("Alakazam", "Synchronize", { item: "Choice Specs" }), "Trick", OL), act(brave(game, mon("Garchomp", "Rough Skin")), "Swords Dance")),
  checks: "Trick's setItem runs the Specs' onStart: choicelock removed; E2 Oricorio +2 Attack.",
}));
add("RB-TRICK-LOCK-PLAIN", ["sv"], (game) => ({
  title: "Control: the Tricker holds a Sitrus Berry: Oricorio gets a non-Choice item, so the lock ends at its next BeforeMove",
  slots: slots(act(fast(game, mon("Oricorio", "Dancer", { item: "Choice Scarf" })), "Air Slash", PL), idle(L(game, 0)),
    act(mon("Gardevoir", "Synchronize", { item: "Sitrus Berry" }), "Trick", OL), act(brave(game, mon("Garchomp", "Rough Skin")), "Swords Dance")),
  checks: "choicelock onBeforeMove: not a Choice item, removed; the copy goes.",
}));
add("RB-SWITCH-LOCK", ["sv"], (game) => ({
  title: "Choice Scarf Oricorio Air Slashes; its ally Gardevoir Tricks it a Choice Band (the lock ends); Garchomp's Swords Dance: the copy goes",
  slots: slots(act(fast(game, mon("Oricorio", "Dancer", { item: "Choice Scarf" })), "Air Slash", PL), act(mon("Gardevoir", "Synchronize", { item: "Choice Band" }), "Trick", OL),
    idle(L(game, 0)), act(brave(game, mon("Garchomp", "Rough Skin")), "Swords Dance")),
  checks: "The Band's onStart removes choicelock.",
}));
add("RB-BESTOW-LOCK", ["usum"], (game) => ({
  title: "Choice Scarf Oricorio Air Slashes; Knock Off takes its Scarf; its ally Blissey Bestows a Choice Band; Garchomp's Swords Dance: the copy goes",
  slots: slots(act(fast(game, mon("Oricorio", "Dancer", { item: "Choice Scarf" })), "Air Slash", PL), act(fast(game, mon("Blissey", "Natural Cure", { item: "Choice Band" })), "Bestow", OL),
    act(fast(game, mon("Weavile", "Pressure")), "Knock Off", OL), act(brave(game, mon("Garchomp", "Rough Skin")), "Swords Dance")),
  checks: "bestow setItem: the Band's onStart.",
}));
add("RB-TRICK-CARRIED", ["sv"], (game) => ({
  title: "Choice Band Oricorio (last move Hurricane, Hurricane again) is Tricked Choice Specs by a faster Gardevoir; Garchomp's Swords Dance: the copy goes and locks it",
  slots: slots(act(brave(game, mon("Oricorio", "Dancer", { item: "Choice Band", lastMove: "Hurricane" })), "Hurricane", PL), idle(L(game, 0)),
    act(fast(game, mon("Gardevoir", "Synchronize", { item: "Choice Specs" })), "Trick", OL), act(mon("Garchomp", "Rough Skin"), "Swords Dance")),
  checks: "An earlier turn's lock is removed by the received Specs: the copy goes, then Hurricane fails (locked into Swords Dance).",
}));
add("VT-SWITCHEROO-BAND", ["usum"], (game) => ({
  title: "Scarf Oricorio's Air Slash first; Lopunny's Switcheroo gives it a Choice Band; the slowest Lilligant (own side) Quiver Dances: the copy goes",
  slots: slots(act(brave(game, mon("Lilligant", "Own Tempo")), "Quiver Dance"), act(fast(game, mon("Oricorio", "Dancer", { item: "Choice Scarf" })), "Air Slash", PR),
    act(mon("Lopunny", "Limber", { item: "Choice Band" }), "Switcheroo", OR), idle(L(game, 0))),
  checks: "switcheroo setItem: the Band's onStart removes choicelock.",
}));
add("VT-COPY-THEN-TRICK", ["sv", "usum"], (game) => ({
  title: "Fast Lilligant's Quiver Dance; Choice Band Oricorio copies it (locked into it); Sableye Tricks it Choice Specs (the lock ends); its own Air Slash lands",
  slots: slots(act(fast(game, mon("Lilligant", "Own Tempo")), "Quiver Dance"), act(brave(game, mon("Oricorio", "Dancer", { item: "Choice Band" })), "Air Slash", PR),
    act({ ...mon("Sableye", "Keen Eye", { item: "Choice Specs" }), evs: { spe: 252 } }, "Trick", OR), idle(L(game, 0))),
  checks: "The Air Slash hits Snorlax.",
}));
add("VT-COPY-THEN-TRICK-T", ["sv"], (game) => ({
  title: "Timid Lilligant's Quiver Dance; Choice Band Oricorio copies it; a Timid Gardevoir Tricks it Choice Specs; its own Air Slash lands",
  slots: slots(act({ ...fast(game, mon("Lilligant", "Own Tempo")), nature: "Timid" }, "Quiver Dance"), act(brave(game, mon("Oricorio", "Dancer", { item: "Choice Band" })), "Air Slash", PR),
    act({ ...fast(game, mon("Gardevoir", "Synchronize", { item: "Choice Specs" })), nature: "Timid" }, "Trick", OR), idle(L(game, 0))),
  checks: "The Air Slash hits Snorlax.",
}));
add("VT-COPY-THEN-TRICK-CTRL", ["sv"], (game) => ({
  title: "Control: Sableye Tricks Leftovers instead: the lock ends at Oricorio's BeforeMove (not a Choice item); its own Air Slash lands",
  slots: slots(act(fast(game, mon("Lilligant", "Own Tempo")), "Quiver Dance"), act(brave(game, mon("Oricorio", "Dancer", { item: "Choice Band" })), "Air Slash", PR),
    act({ ...mon("Sableye", "Keen Eye", { item: "Leftovers" }), evs: { spe: 252 } }, "Trick", OR), idle(L(game, 0))),
  checks: "choicelock onBeforeMove removes it.",
}));
add("R2-DAN-TRICK-SD", ["sv"], (game) => ({
  title: "Garchomp's Swords Dance; Choice Scarf Oricorio (Dancer) copies it (locked); Gardevoir (Choice Specs) Tricks it; Oricorio's Hurricane then hits",
  slots: slots(act(brave(game, mon("Oricorio", "Dancer", { item: "Choice Scarf" })), "Hurricane", PL), idle(L(game, 1)),
    act(fast(game, mon("Garchomp", "Rough Skin")), "Swords Dance"), act(fast(game, mon("Gardevoir", "Synchronize", { item: "Choice Specs", nature: "Timid" })), "Trick", OL)),
  checks: "Hurricane hits Garchomp: 59–78 of 183 left.",
}));
add("R2-DAN-TRICK-SD-LEFT", ["sv"], (game) => ({
  title: "Control: the same with Gardevoir holding Leftovers",
  slots: slots(act(brave(game, mon("Oricorio", "Dancer", { item: "Choice Scarf" })), "Hurricane", PL), idle(L(game, 1)),
    act(fast(game, mon("Garchomp", "Rough Skin")), "Swords Dance"), act(fast(game, mon("Gardevoir", "Synchronize", { item: "Leftovers", nature: "Timid" })), "Trick", OL)),
  checks: "The lock ends at the BeforeMove (Leftovers).",
}));
add("V1-SWITCH-SPECS", ["sv"], (game) => ({
  title: "Foe Garchomp's Swords Dance; Choice Band Oricorio (Dancer) copies it (locked); foe Persian (Choice Specs) Switcheroos it; Oricorio's Air Slash at Garchomp",
  slots: slots(act(brave(game, mon("Oricorio", "Dancer", { item: "Choice Band" })), "Air Slash", PL), idle(L(game, 1)),
    act(fast(game, mon("Garchomp", "Rough Skin")), "Swords Dance"), act(mon("Persian", "Limber", { item: "Choice Specs" }), "Switcheroo", OL)),
  checks: "Air Slash hits Garchomp: 98–111.",
}));
// R5r2-2: a Choice holder that becomes a Dancer after its own move is locked into that move (data/items.ts:995-997; its copy
// runs BeforeMove: sim/battle-actions.ts:255).
add("R2-DAN-ROLEPLAY", ["sv"], (game) => ({
  title: "Choice Scarf Greninja's Role Play copies ally Oricorio's Dancer (locked into Role Play); Garchomp's Swords Dance: Greninja's copy fails",
  slots: slots(act(mon("Greninja", "Torrent", { item: "Choice Scarf" }), "Role Play", OR), idle(mon("Oricorio", "Dancer")), act(mon("Garchomp", "Rough Skin"), "Swords Dance"), idle(L(game, 1))),
  checks: "E2: Greninja no Attack stage.",
}));
add("R2-DAN-ROLEPLAY-LEFT", ["sv"], (game) => ({
  title: "Control: Leftovers Greninja's Role Play copies Oricorio's Dancer; Garchomp's Swords Dance: Greninja copies it",
  slots: slots(act(mon("Greninja", "Torrent", { item: "Leftovers" }), "Role Play", OR), idle(mon("Oricorio", "Dancer")), act(mon("Garchomp", "Rough Skin"), "Swords Dance"), idle(L(game, 1))),
  checks: "E2: Greninja +2 Attack.",
}));
add("R2-DAN-DOODLE", ["sv"], (game) => ({
  title: "Choice Scarf Grafaiai's Doodle at foe Oricorio (Grafaiai and its ally become Dancers; Grafaiai locked into Doodle); Garchomp's Swords Dance",
  slots: slots(act(mon("Grafaiai", "Unburden", { item: "Choice Scarf" }), "Doodle", PL), idle(L(game, 1)), idle(mon("Oricorio", "Dancer")), act(mon("Garchomp", "Rough Skin"), "Swords Dance")),
  checks: "Grafaiai's copy fails; the ally Snorlax's copy goes.",
}));
add("V2-SKILLSWAP", ["sv"], (game) => ({
  title: "Choice Specs Gardevoir's Skill Swap with ally Oricorio (Gardevoir becomes a Dancer, locked into Skill Swap); the slower foe Garchomp's Swords Dance",
  slots: slots(act(fast(game, mon("Gardevoir", "Synchronize", { item: "Choice Specs", nature: "Timid" })), "Skill Swap", OR), idle(mon("Oricorio", "Dancer")),
    act(mon("Garchomp", "Rough Skin"), "Swords Dance"), idle(L(game, 1))),
  checks: "Gardevoir's copy fails.",
}));
add("V2-SKILLSWAP-LEFT", ["sv"], (game) => ({
  title: "Control: Leftovers Gardevoir's Skill Swap with ally Oricorio; Garchomp's Swords Dance: Gardevoir copies it",
  slots: slots(act(fast(game, mon("Gardevoir", "Synchronize", { item: "Leftovers", nature: "Timid" })), "Skill Swap", OR), idle(mon("Oricorio", "Dancer")),
    act(mon("Garchomp", "Rough Skin"), "Swords Dance"), idle(L(game, 1))),
  checks: "Gardevoir +2 Attack.",
}));
// R5r2-3: Trump Card reads the PP spent this turn (data/moves.ts:20081-20109; sim/battle-actions.ts:281 deductPP, :281-285 cant nopp).
const tcUser = (game: Game, pp: number, first: boolean) => first
  ? carried(mon("Umbreon", "Synchronize", { lastMove: "Trump Card", lastMoveTarget: PL }), { ppLeft: { "Trump Card": pp } })
  : carried(fast(game, mon("Espeon", "Synchronize")), { ppLeft: { "Trump Card": pp } });
const tcSlots = (game: Game, pp: number, first: boolean) =>
  slots(act(first ? fast(game, mon("Oranguru", "Inner Focus")) : mon("Oranguru", "Inner Focus"), "Instruct", OR), act(tcUser(game, pp, first), "Trump Card", PL), idle(L(game, 2)), idle(L(game, 1)));
add("R2-TC-INS", ["usum"], (game) => ({ title: "USUM: Espeon's Trump Card with 3 PP at Snorlax; the slower Oranguru instructs it (the second use reads 1 PP: 80)", slots: tcSlots(game, 3, false), checks: "The instructed hit 35–42." }));
add("R2-TC-INS4", ["usum"], (game) => ({ title: "USUM: the same with 4 PP (3 then 2 left: 50 then 60)", slots: tcSlots(game, 4, false), checks: "The instructed hit 27–32." }));
add("R2-TC-INS-FIRST", ["usum"], (game) => ({ title: "USUM: a fast Oranguru instructs Umbreon (last move Trump Card at Snorlax, 1 PP) first; Umbreon's own Trump Card then has no PP (cant nopp)", slots: tcSlots(game, 1, true), checks: "Snorlax 179–188; the own Trump Card not used." }));
add("R2-TC-INS-FIRST3", ["usum"], (game) => ({ title: "USUM: the same with 3 PP: the instructed Trump Card reads 2 (60), the own one 1 (80)", slots: tcSlots(game, 3, true), checks: "The own hit 19–23." }));
add("V3-TC-FIRST2", ["usum"], (game) => ({ title: "USUM: the same with 2 PP: the instructed one reads 1 (80), the own one 0 (200)", slots: tcSlots(game, 2, true), checks: "The own hit 47–56." }));
// R5r2-4: a mustpressure move's pressureTargets are every foe (sim/pokemon.ts:846-853; data/moves.ts mustpressure flags).
const insPP = (game: Game, move: string, pp: number, target?: typeof PL, user: CaseMon = fast(game, mon("Garchomp", "Rough Skin"))) =>
  slots(act(mon("Oranguru", "Inner Focus"), "Instruct", OR), target ? act(carried(user, { ppLeft: { [move]: pp } }), move, target) : act(carried(user, { ppLeft: { [move]: pp } }), move), idle(L(game, 2)), idle(mon("Corviknight", "Pressure")));
add("R2-INS-TB", ["sv"], (game) => ({ title: "Garchomp's Tera Blast with 2 PP at Snorlax; Corviknight (Pressure) beside it; the slower Oranguru's Instruct fails (no PP left)", slots: insPP(game, "Tera Blast", 2, PL), checks: "Snorlax 206–211 after one Tera Blast." }));
add("R2-INS-SPK", ["sv", "champions"], (game) => ({ title: "Garchomp's Spikes with 2 PP, a Pressure Corviknight on the foe side; the slower Oranguru's Instruct fails (no PP left)", slots: insPP(game, "Spikes", 2), checks: "One Spikes layer." }));
add("R2-INS-SPK3", ["sv"], (game) => ({ title: "Control: Spikes with 3 PP into the same side; Instruct (1 left: used again, 2 layers)", slots: insPP(game, "Spikes", 3), checks: "Two Spikes layers." }));
add("V4-TSPK", ["sv"], (game) => ({ title: "Glimmora's Toxic Spikes with 2 PP, a Pressure Corviknight on the foe side; the slower Oranguru's Instruct fails", slots: insPP(game, "Toxic Spikes", 2, undefined, fast(game, mon("Glimmora", "Toxic Debris"))), checks: "One Toxic Spikes layer." }));
// R5r2-5: a spread knockout of the strong weather's holder as an earlier target (data/abilities.ts:954-963 onEnd clearWeather).
add("R2-FC-PRIMAL-RS1", ["usum"], (game) => ({
  title: "USUM: Harsh Sunshine; Garchomp's Rock Slide knocks out the 1 HP Groudon-Primal (left) and hits Snorlax; Blastoise's Water Pulse at Snorlax",
  field: { weather: "Harsh Sunshine" },
  slots: slots(act(fast(game, mon("Garchomp", "Rough Skin")), "Rock Slide"), act(mon("Blastoise", "Torrent"), "Water Pulse", PR), idle(mon("Groudon-Primal", "Desolate Land", { hp: 1, item: "Red Orb" })), idle(L(game, 1))),
  checks: "Water Pulse 28–34; E2 weather none.",
}));
add("R2-FC-PRIMAL-RS2", ["usum"], (game) => ({
  title: "USUM: Harsh Sunshine; Garchomp's Rock Slide knocks out the 1 HP Groudon-Primal (right, applied first) and hits Snorlax; Blastoise's Water Pulse at Snorlax",
  field: { weather: "Harsh Sunshine" },
  slots: slots(act(fast(game, mon("Garchomp", "Rough Skin")), "Rock Slide"), act(mon("Blastoise", "Torrent"), "Water Pulse", PL), idle(L(game, 1)), idle(mon("Groudon-Primal", "Desolate Land", { hp: 1, item: "Red Orb" }))),
  checks: "Water Pulse 28–34, Snorlax 156–169; E2 weather none.",
}));
add("V5-KYOGRE-RS1", ["usum"], (game) => ({
  title: "USUM: Heavy Rain; Garchomp's Rock Slide knocks out the 1 HP Kyogre-Primal (left) and hits Snorlax; Arcanine's Flamethrower at Snorlax",
  field: { weather: "Heavy Rain" },
  slots: slots(act(fast(game, mon("Garchomp", "Rough Skin")), "Rock Slide"), act(mon("Arcanine", "Intimidate"), "Flamethrower", PR), idle(mon("Kyogre-Primal", "Primordial Sea", { hp: 1, item: "Blue Orb" })), idle(L(game, 1))),
  checks: "Flamethrower 25–30.",
}));
add("V5-KYOGRE-RS2", ["usum"], (game) => ({
  title: "USUM: Heavy Rain; Garchomp's Rock Slide knocks out the 1 HP Kyogre-Primal (right, applied first) and hits Snorlax; Arcanine's Flamethrower at Snorlax",
  field: { weather: "Heavy Rain" },
  slots: slots(act(fast(game, mon("Garchomp", "Rough Skin")), "Rock Slide"), act(mon("Arcanine", "Intimidate"), "Flamethrower", PL), idle(L(game, 1)), idle(mon("Kyogre-Primal", "Primordial Sea", { hp: 1, item: "Blue Orb" }))),
  checks: "Flamethrower 25–30, Snorlax 160–172.",
}));
// R5r2-6: Me First calls no status move (data/moves.ts:11542-11551).
add("R2-MF-DANCER", ["usum"], (game) => ({
  title: "USUM: Absol's Me First at Garchomp, whose Swords Dance Oricorio (Dancer) copies (Me First fails: it cannot call a status move)",
  slots: slots(idle(mon("Oricorio", "Dancer")), act(fast(game, mon("Absol", "Pressure", { nature: "Jolly" })), "Me First", PL), act(mon("Garchomp", "Rough Skin"), "Swords Dance"), idle(L(game, 1))),
  checks: "Oricorio +2 Attack.",
}));
// R5r2-7: Gorilla Tactics' lock (data/abilities.ts:1654-1690).
add("R2-INS-GT", ["swsh"], (game) => ({
  title: "SwSh: Oranguru instructs Darmanitan-Galar (Gorilla Tactics, last move Icicle Crash) before its own Flare Blitz: locked into Icicle Crash, Flare Blitz fails",
  slots: slots(act(fast(game, mon("Oranguru", "Inner Focus")), "Instruct", OR), act(brave(game, mon("Darmanitan-Galar", "Gorilla Tactics", { lastMove: "Icicle Crash", lastMoveTarget: PL })), "Flare Blitz", PL), idle(L(game, 2)), idle(L(game, 1))),
  checks: "Darmanitan stays at 180 (no recoil); opponent-left 145–159.",
}));
add("V7-GT", ["swsh"], (game) => ({
  title: "SwSh: a fast Oranguru instructs Darmanitan-Galar (Gorilla Tactics, last move Rock Slide) before its own Icicle Crash: Icicle Crash fails",
  slots: slots(act(fast(game, mon("Oranguru", "Inner Focus")), "Instruct", OR), act(brave(game, mon("Darmanitan-Galar", "Gorilla Tactics", { lastMove: "Rock Slide", lastMoveTarget: null })), "Icicle Crash", PL), idle(L(game, 2)), idle(L(game, 1))),
  checks: "opponent-left 157–169.",
}));
add("R2-INS-SCARF", ["swsh"], (game) => ({
  title: "Control: Oranguru instructs a Choice Band Darmanitan-Galar (Zen Mode, last move Icicle Crash) before its own Flare Blitz",
  slots: slots(act(fast(game, mon("Oranguru", "Inner Focus")), "Instruct", OR), act(brave(game, mon("Darmanitan-Galar", "Zen Mode", { item: "Choice Band", lastMove: "Icicle Crash", lastMoveTarget: PL })), "Flare Blitz", PL), idle(L(game, 2)), idle(L(game, 1))),
  checks: "The Choice lock (as RV2-PC-INS-SCARF).",
}));
// R3DEF-R2-1: Dragon Darts on two targets, one dart each with an Update between (sim/battle-actions.ts:896-899, :967): the
// attacker's Liechi or Starf Berry the first dart's loss makes due changes the second dart (doubles-spread.ts dartsBerryGuard).
const dartsUser = (game: Game, item: string, hp: number) => fast(game, mon("Dragapult", "Clear Body", { item, hp }));
add("R2-LIECHI-DARTS-JABOCA", ["sv", "swsh"], (game) => ({
  title: "Dragapult (Liechi, 55 HP) Dragon Darts: the first dart into a Jaboca Snorlax (1/8 back), the second into the other Snorlax",
  slots: slots(act(dartsUser(game, "Liechi Berry", 55), "Dragon Darts", PL), idle(L(game, 1)), idle(L(game, 2, { item: "Jaboca Berry" })), idle(L(game, 3))),
  notEstimated: "Dragon Darts with Dragapult's Liechi Berry is not modelled in 2v2.",
  checks: "Pinned: the Liechi after the first dart, the second dart 70–84 (the step reads it from the move's start).",
}));
add("R2-LIECHI-DARTS-IO", ["swsh"], (game) => ({
  title: "Dragapult (Liechi, 60 HP) Dragon Darts: the first dart knocks out a 30 HP Pyukumuku (Innards Out: 30), the second into a Snorlax",
  slots: slots(act(dartsUser(game, "Liechi Berry", 60), "Dragon Darts", PL), idle(L(game, 1)), idle(mon("Pyukumuku", "Innards Out", { hp: 30 })), idle(L(game, 3))),
  notEstimated: "Dragon Darts with Dragapult's Liechi Berry is not modelled in 2v2.",
  checks: "Pinned: Innards Out 30, Liechi +1, then the second dart.",
}));
add("R2-STARF-DARTS-IO", ["swsh"], (game) => ({
  title: "Dragapult (Starf, 60 HP) Dragon Darts: the first dart knocks out a 30 HP Pyukumuku (Innards Out), the second into a Snorlax",
  slots: slots(act(dartsUser(game, "Starf Berry", 60), "Dragon Darts", PL), idle(L(game, 1)), idle(mon("Pyukumuku", "Innards Out", { hp: 30 })), idle(L(game, 3))),
  notEstimated: "Dragon Darts with Dragapult's Starf Berry is not modelled in 2v2.",
  checks: "Pinned: the Starf's random +2 before the second dart.",
}));
add("R2-STARF-DARTS", ["sv", "swsh"], (game) => ({
  title: "Control: Dragapult (Starf, 60 HP) Dragon Darts into a Rocky Helmet Snorlax and the other Snorlax (no contact: no loss, no Berry)",
  slots: slots(act(dartsUser(game, "Starf Berry", 60), "Dragon Darts", PL), idle(L(game, 1)), idle(L(game, 2, { item: "Rocky Helmet" })), idle(L(game, 3))),
  checks: "Dragon Darts makes no contact: no Helmet loss.",
}));
add("V1-DARTS-LIECHI-JABOCA-HIGH", ["sv"], (game) => ({
  title: "Control: Dragapult (Liechi) at 150 HP: the Jaboca loss leaves it above its line",
  slots: slots(act(dartsUser(game, "Liechi Berry", 150), "Dragon Darts", PL), idle(L(game, 1)), idle(L(game, 2, { item: "Jaboca Berry" })), idle(L(game, 3))),
  checks: "No Berry: ready.",
}));
add("V1-DARTS-LIECHI-JABOCA-UNNERVE", ["sv"], (game) => ({
  title: "Control: the second foe is an Unnerve Tyranitar: no Liechi",
  slots: slots(act(dartsUser(game, "Liechi Berry", 55), "Dragon Darts", PL), idle(L(game, 1)), idle(L(game, 2, { item: "Jaboca Berry" })), idle(mon("Tyranitar", "Unnerve"))),
  checks: "Unnerve stops the Liechi: ready.",
}));
add("V1-DARTS-LANSAT-JABOCA", ["sv"], (game) => ({
  title: "Control: Dragapult (Lansat, 55 HP): the Lansat after the first dart changes only a critical hit's chance",
  slots: slots(act(dartsUser(game, "Lansat Berry", 55), "Dragon Darts", PL), idle(L(game, 1)), idle(L(game, 2, { item: "Jaboca Berry" })), idle(L(game, 3))),
  checks: "No critical hits: ready.",
}));
// R3DEF-R2-2: Encore into Perish Song keeps the queued priority (sim/battle-actions.ts:225-233), which Armor Tail, Dazzling and
// Queenly Majesty read for it (data/abilities.ts:216-227, :864, :3716).
const azu2 = { ...mon("Azumarill", "Huge Power"), lastMove: "Perish Song" };
const encPerish = (game: Game, shield: CaseMon) => slots(act(fast(game, mon("Whimsicott", "Prankster")), "Encore", PL), idle(shield), act(azu2, "Aqua Jet", OL), idle(L(game, 3)));
add("R2-ENC-PERISH-AT", ["sv"], (game) => ({ title: "Whimsicott's Prankster Encore into Azumarill (Aqua Jet queued, last Perish Song); the foe Farigiraf has Armor Tail: Perish Song fails", slots: encPerish(game, mon("Farigiraf", "Armor Tail")), checks: "No perish count on any Pokémon." }));
add("R2-ENC-PERISH-QM", ["swsh"], (game) => ({ title: "The same with Tsareena's Queenly Majesty: Perish Song fails", slots: encPerish(game, mon("Tsareena", "Queenly Majesty")), checks: "No perish count." }));
add("R2-ENC-PERISH-DZ", ["sv", "usum"], (game) => ({ title: "The same with Bruxish's Dazzling (USUM: the frozen priority): Perish Song fails", slots: encPerish(game, mon("Bruxish", "Dazzling")), checks: "No perish count." }));
add("R2-ENC-PERISH-NONE", ["sv"], (game) => ({ title: "Control: no shield: Perish Song gives every Pokémon a perish count", slots: encPerish(game, L(game, 1)), checks: "Perish count 3 on all four." }));
add("V2-ENC-PERISH-AT-CH", ["champions"], (game) => ({ title: "Champions: the same with Armor Tail: its Encore moves the action to Perish Song's own priority, so Perish Song goes", slots: encPerish(game, mon("Farigiraf", "Armor Tail")), checks: "data/mods/champions/moves.ts:298-309 encore onStart." }));
// R3DEF-R2-3, -5: Pickpocket takes the attacker's real item (a heal-blocked attacker's Sitrus, not its Leftovers stand-in) and
// eats a taken Berry at the action's Update (data/abilities.ts:3239-3255; sitrusberry onUpdate).
add("R2-PICKPOCKET-HB", ["sv"], (game) => ({
  title: "A heal-blocked Snorlax (Sitrus, 200 HP) Body Slams an itemless Weavile (Pickpocket, 120 HP): Weavile takes the Sitrus and eats it",
  slots: slots(act(carried(L(game, 0, { item: "Sitrus Berry", hp: 200 }), { healBlock: 2 }), "Body Slam", PL), idle(L(game, 1)), idle(mon("Weavile", "Pickpocket", { hp: 120 })), idle(L(game, 3))),
  checks: "Weavile 68–81 with no item.",
}));
add("V3-PICKPOCKET-HB", ["swsh"], (game) => ({
  title: "SwSh: the same heal-blocked Snorlax into the Pickpocket Weavile",
  slots: slots(act(carried(L(game, 0, { item: "Sitrus Berry", hp: 200 }), { healBlock: 2 }), "Body Slam", PL), idle(L(game, 1)), idle(mon("Weavile", "Pickpocket", { hp: 120 })), idle(L(game, 3))),
  checks: "Weavile eats the Sitrus.",
}));
add("R2-PICKPOCKET-PLAIN", ["sv"], (game) => ({
  title: "Snorlax (Sitrus, 200 HP) Body Slams an itemless Weavile (Pickpocket, 120 HP): Weavile takes the Sitrus and eats it at once",
  slots: slots(act(L(game, 0, { item: "Sitrus Berry", hp: 200 }), "Body Slam", PL), idle(L(game, 1)), idle(mon("Weavile", "Pickpocket", { hp: 120 })), idle(L(game, 3))),
  checks: "Weavile 68–81 after the move.",
}));
add("R2-PICKPOCKET-PLAIN-2HIT", ["sv"], (game) => ({
  title: "Snorlax (Sitrus, 200 HP) Body Slams Weavile (Pickpocket, 120 HP), which eats the taken Sitrus; a slower Snorlax Body Slams Weavile after",
  slots: slots(act(L(game, 8, { item: "Sitrus Berry", hp: 200 }), "Body Slam", PL), act(L(game, 0), "Body Slam", PL), idle(mon("Weavile", "Pickpocket", { hp: 120 })), idle(L(game, 3))),
  checks: "KO chance 0.84375; Weavile 0–6.",
}));
add("V5-PICKPOCKET-2HIT", ["swsh"], (game) => ({
  title: "SwSh: the same two Body Slams into the Pickpocket Weavile",
  slots: slots(act(L(game, 8, { item: "Sitrus Berry", hp: 200 }), "Body Slam", PL), act(L(game, 0), "Body Slam", PL), idle(mon("Weavile", "Pickpocket", { hp: 120 })), idle(L(game, 3))),
  checks: "The Sitrus eaten before the second hit.",
}));
// R3DEF-R2-4: Thief or Covet whose user Gulp Missile knocks out at DamagingHit takes nothing (sim/battle-actions.ts:1119-1125;
// data/abilities.ts:1745-1756): not estimated where it can (doubles-guards.ts thiefGulpGuard).
const sneasler = (game: Game, hp: number) => fast(game, mon("Sneasler", "Poison Touch", { hp }));
add("R2-THIEF-GULP-PLAIN", ["sv"], (game) => ({
  title: "Sneasler (itemless, 30 HP) Thiefs Cramorant-Gulping (Sitrus, 90 HP): Gulp Missile knocks Sneasler out before AfterHit",
  slots: slots(act(sneasler(game, 30), "Thief", PL), idle(L(game, 1)), idle(mon("Cramorant-Gulping", "Gulp Missile", { item: "Sitrus Berry", hp: 90 })), idle(L(game, 3))),
  notEstimated: "Thief with Cramorant-Gulping's Gulp Missile is not modelled in 2v2.",
  checks: "Pinned: no steal; Cramorant eats its Sitrus (72–81).",
}));
add("R2-THIEF-GULP-HB", ["sv"], (game) => ({
  title: "The same into a heal-blocked Cramorant-Gulping",
  slots: slots(act(sneasler(game, 30), "Thief", PL), idle(L(game, 1)), idle(carried(mon("Cramorant-Gulping", "Gulp Missile", { item: "Sitrus Berry", hp: 90 }), { healBlock: 2 })), idle(L(game, 3))),
  notEstimated: "Thief with Cramorant-Gulping's Gulp Missile is not modelled in 2v2.",
  checks: "Pinned: Cramorant keeps its Sitrus.",
}));
add("V4-COVET-GORGING2", ["swsh"], (game) => ({
  title: "Lopunny (itemless, 30 HP) Covets Cramorant-Gorging (Sitrus, 90 HP): Gulp Missile knocks it out before AfterHit",
  slots: slots(act(fast(game, mon("Lopunny", "Limber", { hp: 30 })), "Covet", PL), idle(L(game, 1)), idle(mon("Cramorant-Gorging", "Gulp Missile", { item: "Sitrus Berry", hp: 90 })), idle(L(game, 3))),
  notEstimated: "Covet with Cramorant-Gorging's Gulp Missile is not modelled in 2v2.",
  checks: "Pinned: no steal.",
}));
add("R2-THIEF-GULP-HB-SURVIVE", ["sv"], (game) => ({
  title: "Control: Sneasler at 100 HP survives Gulp Missile and steals the heal-blocked Cramorant's Sitrus",
  slots: slots(act(sneasler(game, 100), "Thief", PL), idle(L(game, 1)), idle(carried(mon("Cramorant-Gulping", "Gulp Missile", { item: "Sitrus Berry", hp: 90 }), { healBlock: 2 })), idle(L(game, 3))),
  checks: "The steal after DamagingHit.",
}));
// R3DEF-R2-6: a carried lock under a carried Gastro Acid keeps nothing at the turn's first Update (sim/pokemon.ts ignoringAbility).
const zerkGA2 = (game: Game, hp: number, lock = true) => carried(mon(game === "sv" ? "Moltres-Galar" : "Drampa", "Berserk", { item: "Sitrus Berry", hp }), { ...(lock ? { berryLocked: true } : {}), gastroAcid: true });
const zerkHit2 = (game: Game) => (game === "sv" ? "Air Slash" : "Dragon Pulse");
add("R2-GA-LOCK-START", ["sv", "swsh", "usum"], (game) => ({
  title: "A Berserk holder with its Sitrus locked and Gastro Acid from last turn, 70 HP, attacks a foe: the Sitrus is eaten at the turn's first Update",
  slots: slots(idle(L(game, 1)), idle(L(game, 2)), act(zerkGA2(game, 70), zerkHit2(game), OL), idle(L(game, 3))),
  checks: "Start 111 (sv) or 108.",
}));
add("R2-GA-LOCK-HIT", ["swsh", "usum"], (game) => ({
  title: "The same, a fast Snorlax Body Slams the holder first",
  slots: slots(act(fast(game, L(game, 1)), "Body Slam", PL), idle(L(game, 2)), act(zerkGA2(game, 70), zerkHit2(game), OL), idle(L(game, 3))),
  checks: "KO chance 0.",
}));
add("R2-GA-LOCK-KLAWF", ["sv"], (game) => ({
  title: "Klawf (Anger Shell, Sitrus locked, Gastro Acid from last turn) at 50 HP, idle: the Sitrus is eaten at the start",
  slots: slots(idle(L(game, 1)), idle(L(game, 2)), idle(carried(mon("Klawf", "Anger Shell", { item: "Sitrus Berry", hp: 50 }), { berryLocked: true, gastroAcid: true })), idle(L(game, 3))),
  checks: "The lock keeps nothing under Gastro Acid.",
}));
add("R2-GA-NOLOCK-HIT", ["sv"], (game) => ({
  title: "Control: Gastro Acid from last turn, no lock, 70 HP; a fast Snorlax Body Slams the holder first",
  slots: slots(act(fast(game, L(game, 1)), "Body Slam", PL), idle(L(game, 2)), act(zerkGA2(game, 70, false), zerkHit2(game), OL), idle(L(game, 3))),
  checks: "The same numbers as with the lock.",
}));
// R3DEF-R2-7: Magician into a Sticky Hold holder takes nothing (data/abilities.ts:4622-4630), so the stand-in is exact.
add("R2-MAGICIAN-STICKY-HB", ["sv"], (game) => ({
  title: "An itemless Magician Delphox's Flamethrower into a heal-blocked Sticky Hold Muk (Sitrus, 150 HP)",
  slots: slots(act(fast(game, mon("Delphox", "Magician")), "Flamethrower", PL), idle(L(game, 1)), idle(carried(mon("Muk", "Sticky Hold", { item: "Sitrus Berry", hp: 150 }), { healBlock: 2 })), idle(L(game, 3))),
  checks: "Muk keeps the Sitrus; ready.",
}));
add("V7-THIEF-STICKY-HB", ["sv"], (game) => ({
  title: "Control: an itemless Weavile Thiefs the same heal-blocked Sticky Hold Muk",
  slots: slots(act(fast(game, mon("Weavile", "Pressure")), "Thief", PL), idle(L(game, 1)), idle(carried(mon("Muk", "Sticky Hold", { item: "Sitrus Berry", hp: 150 }), { healBlock: 2 })), idle(L(game, 3))),
  checks: "Ready.",
}));
// R3DEF-R2-8: Focus Sash saves only from full HP (data/items.ts:2265-2276): below it, Parental Bond's Fissure is one hit.
add("R2-PB-SASH-NOTFULL", ["usum"], (game) => ({
  title: "Mega Kangaskhan's Fissure into a Focus Sash Snorlax at 200 HP: the first hit knocks it out",
  slots: slots(act(mon("Kangaskhan-Mega", "Parental Bond", { item: "Kangaskhanite", appSpecies: "kangaskhanmega" }), "Fissure", PL), idle(L(game, 1)), idle(L(game, 2, { item: "Focus Sash", hp: 200 })), idle(L(game, 3))),
  checks: "KO.",
}));
add("V8-OHKO-SASH-NOTFULL-NOPB", ["usum"], (game) => ({
  title: "Control: plain Kangaskhan's Fissure into the same Focus Sash Snorlax at 200 HP",
  slots: slots(act(mon("Kangaskhan", "Scrappy"), "Fissure", PL), idle(L(game, 1)), idle(L(game, 2, { item: "Focus Sash", hp: 200 })), idle(L(game, 3))),
  checks: "KO.",
}));
add("V8-PB-SASH-FULL", ["usum"], (game) => ({
  title: "Mega Kangaskhan's Fissure into a full-HP Focus Sash Snorlax (the kept reason)",
  slots: slots(act(mon("Kangaskhan-Mega", "Parental Bond", { item: "Kangaskhanite", appSpecies: "kangaskhanmega" }), "Fissure", PL), idle(L(game, 1)), idle(L(game, 2, { item: "Focus Sash" })), idle(L(game, 3))),
  notEstimated: "Fissure with Parental Bond is not modelled in 2v2.",
  checks: "The Sash saves from the first hit.",
}));
// R4-r2-1, -2: the Max Move's self.onHit before the target's DamagingHit and the hit's Update (sim/battle-actions.ts:1096,
// :1121, :967; White Herb at AfterMove): doubles-max.ts orderReplay from the stages before the step. SwSh only (Dynamax).
const gmax3 = (species: string, ability: string, extra: Partial<CaseMon> = {}): CaseMon =>
  mon(species, ability, { evs: { spe: 252 }, gender: "M", choice: "dynamax", gigantamax: true, appBuild: { mechanic: "gigantamax", configuration: { dynamaxLevel: 10, gigantamax: true } }, ...extra });
const dmax3 = (m: CaseMon): CaseMon => ({ ...m, choice: "dynamax", appBuild: { mechanic: "dynamax", configuration: { dynamaxLevel: 10 } } });
const foamInto = (move: string, skarm: CaseMon) => slots(act(gmax3("Kingler", "Shell Armor"), move, PR), idle(L("swsh", 3)), idle(L("swsh", 4)), idle(skarm));
const sign = (n: number) => (n < 0 ? `M${-n}` : `P${n}`);
const foamCase = (id: string, title: string, skarm: CaseMon, checks: string, notEstimated?: string, move = "Liquidation") =>
  add(id, ["swsh"], () => ({ title, slots: foamInto(move, skarm), checks, ...(notEstimated ? { notEstimated } : {}) }));
const salacReason = (who: string) => `G-Max Foam Burst with ${who}'s Salac Berry is not modelled in 2v2.`;
add("R2E-M-FOAMWASALACM5", ["swsh"], () => ({
  title: "G-Max Foam Burst (Crabhammer) into Weak Armor Skarmory (100 HP, Salac) at Speed −5: −2, Weak Armor +2, Salac +1",
  slots: slots(act(gmax3("Kingler", "Hyper Cutter"), "Crabhammer", PR), idle(L("swsh", 1)), idle(L("swsh", 2)), idle(mon("Skarmory", "Weak Armor", { item: "Salac Berry", hp: 100, boosts: { spe: -5 } }))),
  notEstimated: salacReason("Skarmory"),
  checks: "Pinned −3; the step's order would give −4.",
}));
add("R2E-M-FOAMWASALAC0", ["swsh"], () => ({
  title: "Control: the same at Speed 0 (both orders give +1)",
  slots: slots(act(gmax3("Kingler", "Hyper Cutter"), "Crabhammer", PR), idle(L("swsh", 1)), idle(L("swsh", 2)), idle(mon("Skarmory", "Weak Armor", { item: "Salac Berry", hp: 100, boosts: { spe: 0 } }))),
  checks: "Speed +1, Defense −1.",
}));
add("R2E-M-FOAMWASTARFM5", ["swsh"], () => ({
  title: "G-Max Foam Burst into Weak Armor Skarmory (100 HP, Starf) at Speed −5",
  slots: slots(act(gmax3("Kingler", "Hyper Cutter"), "Crabhammer", PR), idle(L("swsh", 1)), idle(L("swsh", 2)), idle(mon("Skarmory", "Weak Armor", { item: "Starf Berry", hp: 100, boosts: { spe: -5 } }))),
  notEstimated: "G-Max Foam Burst with Skarmory's Starf Berry is not modelled in 2v2.",
  checks: "The Starf's +2 on Speed after the cap.",
}));
foamCase("V-WASALACM4", "G-Max Foam Burst into Weak Armor Skarmory (90 HP, Salac) at Speed −4: both orders give −3", mon("Skarmory", "Weak Armor", { item: "Salac Berry", hp: 90, boosts: { spe: -4 } }), "Speed −3.");
foamCase(`V-KESALAC${sign(-5)}`, "G-Max Foam Burst into Keen Eye Skarmory (90 HP, Salac) at Speed −5: −2 capped at −6, Salac +1", mon("Skarmory", "Keen Eye", { item: "Salac Berry", hp: 90, boosts: { spe: -5 } }), "Pinned −5.", salacReason("Skarmory"));
foamCase(`V-KESALAC${sign(6)}`, "G-Max Foam Burst into Keen Eye Skarmory (90 HP, Salac) at Speed +6: −2, then Salac +1", mon("Skarmory", "Keen Eye", { item: "Salac Berry", hp: 90, boosts: { spe: 6 } }), "Pinned +5.", salacReason("Skarmory"));
foamCase(`V-KESALAC${sign(0)}`, "Control: Keen Eye Skarmory (90 HP, Salac) at Speed 0: −1 in either order", mon("Skarmory", "Keen Eye", { item: "Salac Berry", hp: 90, boosts: { spe: 0 } }), "Speed −1.");
const coal = (spe: number, hp?: number, item?: string) => mon("Coalossal", "Steam Engine", { evs: { hp: 252, spd: 252 }, nature: "Calm", boosts: { spe }, ...(hp ? { hp } : {}), ...(item ? { item } : {}) });
foamCase("V-SE160SALACM5", "G-Max Foam Burst (Bubble Beam) into Steam Engine Coalossal (160 HP, Salac) at Speed −5", coal(-5, 160, "Salac Berry"), "Pinned +1.", "G-Max Foam Burst with Coalossal's Salac Berry is not modelled in 2v2.", "Bubble Beam");
foamCase("V-SE160SALACM4", "Control: the same at Speed −4", coal(-4, 160, "Salac Berry"), "Both orders agree.", undefined, "Bubble Beam");
foamCase("V-FOAMWA4", "G-Max Foam Burst into Weak Armor Skarmory at +4: both orders give +4 (R4-r2-2)", mon("Skarmory", "Weak Armor", { boosts: { spe: 4 } }), "Speed +4, Defense −1.");
foamCase("V-FOAMWA3", "Control: Weak Armor Skarmory at +3", mon("Skarmory", "Weak Armor", { boosts: { spe: 3 } }), "Speed +3.");
foamCase("V-FOAMSE0", "G-Max Foam Burst (Bubble Beam) into Steam Engine Coalossal at 0: both orders give +4 (R4-r2-2)", coal(0), "Speed +4.", undefined, "Bubble Beam");
foamCase("V-KEWHITEHERB", "G-Max Foam Burst into Keen Eye Skarmory holding White Herb at 0: the Herb restores it after the move", mon("Skarmory", "Keen Eye", { item: "White Herb" }), "Speed 0, White Herb used.");
foamCase("V-WAWHITEHERB", "G-Max Foam Burst into Weak Armor Skarmory holding White Herb at 0", mon("Skarmory", "Weak Armor", { item: "White Herb" }), "Speed 0, Defense 0, White Herb used.");
add("V-FOAMCOTTONWH", ["swsh"], () => ({
  title: "G-Max Foam Burst into Cotton Down Eldegoss; the other foe Snorlax holds White Herb at 0 (pinned: −2, −1, then the Herb at AfterMove)",
  slots: slots(act(gmax3("Kingler", "Shell Armor"), "Liquidation", PR), idle(L("swsh", 3)), idle(L("swsh", 4, { item: "White Herb" })), idle(mon("Eldegoss", "Cotton Down", { evs: { hp: 252, def: 252 }, nature: "Bold" }))),
  notEstimated: "G-Max Foam Burst with Snorlax (opponent's)'s White Herb is not modelled in 2v2.",
  checks: "Pinned 0 with the Herb used; the step uses it at Cotton Down's drop.",
}));
const airInto = (ally: CaseMon) => slots(act(dmax3(mon("Togekiss", "Serene Grace", { evs: { spe: 252 } })), "Air Slash", PR), idle(ally), idle(L("swsh", 4)), idle(mon("Eldegoss", "Cotton Down", { evs: { hp: 252, spd: 252 }, nature: "Calm" })));
add("V-AIRCOTTONM5", ["swsh"], () => ({ title: "Max Airstream into Cotton Down Eldegoss; the partner Snorlax at −5: both orders give −5 (R4-r2-2)", slots: airInto(L("swsh", 3, { boosts: { spe: -5 } })), checks: "Partner −5." }));
add("V-AIRCOTTONM6", ["swsh"], () => ({ title: "Max Airstream into Cotton Down Eldegoss; the partner at −6 (pinned −6, the step's order −5)", slots: airInto(L("swsh", 3, { boosts: { spe: -6 } })), notEstimated: "Max Airstream with Eldegoss's Cotton Down is not modelled in 2v2.", checks: "The reason." }));
add("V-AIRCOTTONWH", ["swsh"], () => ({ title: "Max Airstream into Cotton Down Eldegoss; the partner Snorlax holds White Herb at 0 (pinned: +1, −1, the Herb kept)", slots: airInto(L("swsh", 3, { item: "White Herb" })), notEstimated: "Max Airstream with Snorlax (yours)'s White Herb is not modelled in 2v2.", checks: "Pinned 0, the Herb kept." }));
// R7-r2-1: one hazard from before the turn with no order given has its place: every hazard set this turn went up after it
// (sim/battle.ts:3322-3331 initEffectState's effectOrder; :994-999 SwitchIn handlers tie on it). Its order goes to the app
// with no DoublesHazards.order (app-turn.ts passes one only for two or more).
const uturnIn = (game: Game, target: typeof OL) => act(brave(game, mon("Scizor", "Technician")), "U-turn", target);
add("R2-SR1-WEBTURN-DEF", ["sv"], (game) => ({
  title: "Stealth Rock up before the turn; Ribombee (Mirror Herb) sets Sticky Web this turn; the slower U-turn brings in Defiant Kingambit at 10 HP: Stealth Rock knocks it out first",
  field: { own: { hazards: ["stealthrock"] } },
  slots: slots(uturnIn(game, PR), idle(L(game, 1)), act(fast(game, mon("Ribombee", "Shield Dust", { item: "Mirror Herb" })), "Sticky Web"), idle(L(game, 3))),
  bench: bench([member("gambit", mon("Kingambit", "Defiant", { hp: 10 })), member("lax", L(game, 2))]),
  checks: "The Mirror Herb is kept; no Attack rise.",
}));
add("R2-TS1-SRTURN-POISON", ["sv", "usum"], (game) => ({
  title: "Toxic Spikes up before the turn; Garchomp sets Stealth Rock this turn; Toxapex at 5 HP comes in: it takes the Toxic Spikes away, then Stealth Rock knocks it out",
  field: { own: { hazards: ["toxicspikes"] } },
  slots: slots(uturnIn(game, PR), idle(L(game, 1)), act(fast(game, mon("Garchomp", "Rough Skin")), "Stealth Rock"), idle(L(game, 3))),
  bench: bench([member("pex", mon("Toxapex", "Regenerator", { hp: 5 })), member("lax", L(game, 2))]),
  checks: "E2 own hazards: Stealth Rock only.",
}));
add("R2-SR1-TSTURN-POISON", ["sv"], (game) => ({
  title: "Stealth Rock up before the turn; Glimmora sets Toxic Spikes this turn; Toxapex at 5 HP comes in: knocked out first, the Toxic Spikes stay",
  field: { own: { hazards: ["stealthrock"] } },
  slots: slots(uturnIn(game, PR), idle(L(game, 1)), act(fast(game, mon("Glimmora", "Toxic Debris")), "Toxic Spikes"), idle(L(game, 3))),
  bench: bench([member("pex", mon("Toxapex", "Regenerator", { hp: 5 })), member("lax", L(game, 2))]),
  checks: "E2 own hazards: both.",
}));
add("V1-SP1-WEB-DEF", ["sv"], (game) => ({
  title: "Spikes on the opponent's side before the turn; Ribombee sets Sticky Web; Defiant Kingambit at 8 HP comes in: Spikes knocks it out first",
  field: { opponent: { hazards: ["spikes"] } },
  slots: slots(act(fast(game, mon("Ribombee", "Shield Dust", { item: "Mirror Herb" })), "Sticky Web"), idle(L(game, 1)), uturnIn(game, OL), idle(L(game, 3))),
  bench: bench(undefined, [member("gambit", mon("Kingambit", "Defiant", { hp: 8 })), member("lax", L(game, 2))]),
  checks: "The Mirror Herb is kept.",
}));
add("V2-TS1-SP-POISON", ["sv", "usum", "swsh", "champions"], (game) => ({
  title: "Toxic Spikes on the opponent's side before the turn; Skarmory sets Spikes; Toxapex at 5 HP comes in: the Toxic Spikes go first",
  field: { opponent: { hazards: ["toxicspikes"] } },
  slots: slots(act(fast(game, mon("Skarmory", "Sturdy")), "Spikes"), idle(L(game, 1)), uturnIn(game, OL), idle(L(game, 3))),
  bench: bench(undefined, [member("pex", mon("Toxapex", "Regenerator", { hp: 5 })), member("lax", L(game, 2))]),
  checks: "Toxapex takes the Toxic Spikes away, then Spikes.",
}));
// R6-r2-3: a source that switched in this turn was on the bench at last turn's end: the trap, Syrup Bomb and Attract it started
// have ended (data/conditions.ts partiallytrapped onResidual; data/moves.ts attract, syrupbomb onUpdate).
const switchedIn = (m: CaseMon) => ({ ...m, action: { move: null, switchIn: true } }) as never;
add("R6R2-SWTRAP", ["sv", "usum"], (game) => ({
  title: "Snorlax switches in at own-left; the foe Snorlax is trapped by a Fire Spin from own-left's slot: the trap has ended",
  slots: slots(switchedIn(L(game, 12)), idle(L(game, 1)), idle(carried(L(game, 2), { trap: { source: OL, bindingBand: false, move: "Fire Spin" } })), idle(L(game, 3))),
  checks: "No Fire Spin damage.",
}));
add("R6R2-SWSYRUP", ["sv"], (game) => ({
  title: "Snorlax switches in at own-left; the foe Snorlax has Syrup Bomb from own-left's slot: it has ended",
  slots: slots(switchedIn(L(game, 12)), idle(L(game, 1)), idle(carried(L(game, 2), { syrupBomb: OL })), idle(L(game, 3))),
  checks: "No Speed drop.",
}));
add("R6R2-SWATTRACT", ["sv", "usum"], (game) => ({
  title: "A male Snorlax switches in at own-left; the female foe Snorlax, infatuated with own-left's slot, Body Slams own-right: no infatuation",
  slots: slots(switchedIn(L(game, 12, { gender: "M" } as never)), idle(L(game, 1)), act(carried(L(game, 2, { gender: "F" } as never), { attract: OL } as never), "Body Slam", OR), idle(L(game, 3))),
  checks: "The Body Slam is used.",
}));
// R6-r2-2: a called Instruct (Sleep Talk, Copycat) or a Spotlight's redirect re-runs a Protect with last turn's counter.
const insFoe = (game: Game, stall?: 3) => {
  const foe = L(game, 1, { lastMove: "Protect", moves: ["Protect", "Body Slam"], exactMoves: true });
  return idle(stall ? carried(foe, { stall }) : foe);
};
add("R6R2-STALK-INS-STL3", ["sv"], (game) => ({
  title: "An asleep fast Snorlax (Instruct only) Sleep Talks: Instruct at the only foe, whose Protect last turn worked (stall 3); own-right's slow Body Slam into it",
  slots: slots(act(fast(game, L(game, 31, { status: "slp", moves: ["Instruct"], exactMoves: true })), "Sleep Talk"), act(L(game, 0, { nature: "Brave", ivs: { spe: 0 } }), "Body Slam", PL),
    insFoe(game, 3), { ...idle(L(game, 2)), absent: true }),
  checks: "Protected in 1/3: 139–235.",
}));
add("R6R2-STALK-INS-NONE", ["sv"], (game) => ({
  title: "The same with no counter given: the assumption",
  slots: slots(act(fast(game, L(game, 31, { status: "slp", moves: ["Instruct"], exactMoves: true })), "Sleep Talk"), act(L(game, 0, { nature: "Brave", ivs: { spe: 0 } }), "Body Slam", PL),
    insFoe(game), { ...idle(L(game, 2)), absent: true }),
  checks: "Assumes no protecting move was used last turn.",
}));
add("R6R2-COPY-INS-STL3", ["sv", "usum"], (game) => ({
  title: "Azumarill's Copycat calls Instruct (the battle's last move) at the only foe, whose Protect last turn worked (stall 3); own-right's slow Body Slam into it",
  battleLastMove: "Instruct",
  slots: slots(act(fast(game, mon("Azumarill", "Huge Power", { moves: ["Aqua Tail", "Copycat"], exactMoves: true })), "Copycat"), act(L(game, 0, { nature: "Brave", ivs: { spe: 0 } }), "Body Slam", PL),
    insFoe(game, 3), { ...idle(L(game, 2)), absent: true }),
  checks: "Protected in 1/3.",
}));
add("R6R2-SPOT-INS-STL3", ["usum"], (game) => ({
  title: "USUM: Oranguru's Instruct at Clefable, whose Spotlight makes its ally Snorlax (Protect last turn, stall 3) the centre of attention; own-right's slow Body Slam into Snorlax",
  slots: slots(act(mon("Oranguru", "Inner Focus"), "Instruct", PL), act(L(game, 0, { nature: "Brave", ivs: { spe: 0 } }), "Body Slam", PR),
    act(mon("Clefable", "Magic Guard"), "Spotlight", PR), insFoe(game, 3)),
  checks: "The redirected Instruct re-runs Protect: 1/3.",
}));
// R6-r2-1: a Snatch or Copycat user's moves for a called Imprison (the calculator passes them).
add("R6R2-SNT-IMP", ["usum"], (game) => ({
  title: "USUM: fast Absol (Night Slash, Snatch) Snatches Mismagius's Imprison; the slowest foe Absol's Night Slash into Snorlax is then blocked",
  slots: slots(act(fast(game, mon("Absol", "Pressure", { moves: ["Night Slash", "Snatch"], exactMoves: true })), "Snatch"), idle(L(game, 0)),
    act(mon("Mismagius", "Levitate", { moves: ["Imprison", "Shadow Ball"], exactMoves: true }), "Imprison"), act(mon("Absol", "Justified", { nature: "Brave", ivs: { spe: 0 } }), "Night Slash", OR)),
  checks: "Imprison: Night Slash cannot be used.",
}));
add("R6R2-COPY-IMP", ["sv", "usum"], (game) => ({
  title: "Fast Mismagius Imprisons; Azumarill (Aqua Tail, Copycat) Copycats it; the slowest Azumarill's Aqua Tail into the foe Snorlax is then blocked",
  slots: slots(act(fast(game, mon("Mismagius", "Levitate", { moves: ["Imprison", "Shadow Ball"], exactMoves: true })), "Imprison"),
    act(mon("Azumarill", "Thick Fat", { nature: "Brave", ivs: { spe: 0 } }), "Aqua Tail", PR),
    act(mon("Azumarill", "Huge Power", { moves: ["Aqua Tail", "Copycat"], exactMoves: true }), "Copycat"), idle(L(game, 1))),
  checks: "Copycat calls Imprison.",
}));
// R6-r2-4: Conversion 2 redirected by Spotlight reads its new target's last move.
add("R6R2-CONV2-SPOT", ["usum"], (game) => ({
  title: "USUM: Porygon2's Conversion 2 at Clefable, whose Spotlight makes Snorlax (last move Body Slam) the centre of attention; Snorlax's Body Slam into Porygon2",
  slots: slots(act(mon("Porygon2", "Analytic"), "Conversion 2", PL), idle(L(game, 1)), act(mon("Clefable", "Magic Guard"), "Spotlight", PR), act(L(game, 0, { lastMove: "Body Slam" }), "Body Slam", OL)),
  checks: "Ghost, Rock or Steel at 1/3 each.",
}));
// ROUND2-END
void PR;
export const REVIEW2_CASES: Case[] = cases.map((c) => ({ checks: "", ...c }));
