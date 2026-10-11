// ADDENDUM probes, batch 2: Trick, Switcheroo, Bestow (items moved by moves). Run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/status-eot/design/addendum-probes-2.ts [T1 ...] > scripts/.cache/calc-audit/status-eot/design/addendum-probes-2.out
import { enumerate, report, type AProbe } from "./addendum-sim";
import type { Mon } from "./status-sim";

const L = /^\|(move|cant|-fail|-immune|-activate|-item|-enditem|-damage|-heal|-boost|-unboost|-status|-curestatus|-start|-end|-clearnegativeboost)\|/;
const still: Mon = { species: "Chansey", ability: "Natural Cure", moves: ["Splash"] };
const slow: Mon = { species: "Shuckle", ability: "Gluttony", moves: ["Splash"] };
const base = (over: Partial<AProbe>): AProbe => ({ game: "sv", mons: [still, still, still, slow], turns: [["move 1, move 1", "move 1, move 1"]], lines: L, ...over });
const only = process.argv.slice(2);
const want = (id: string) => !only.length || only.includes(id);
const items = (b: any) => [...b.p1.active, ...b.p2.active].map((p: any) => `${p.name}:${p.item || "-"}`).join(" ");
const order = (b: any) => (b.log as string[]).filter((l) => l.startsWith("|move|")).map((l) => l.split("|")[2].split(": ")[1]).join(" > ");
const hps = (b: any) => [...b.p1.active, ...b.p2.active].map((p: any) => `${p.name} ${p.hp}${p.status ? ` ${p.status}` : ""}`).join(", ");

// T1. Trick a Choice Scarf onto a slower foe (Snorlax 50 -> 75, Chansey 70): gen 8+ re-sorts the queue after each action
// (sim/battle.ts:2919 updateSpeed + queue sort), gen 7 keeps the start order.
for (const game of ["sv", "champions", "swsh", "usum"] as const) if (want("T1")) {
  report(`T1 ${game}: Jolteon Tricks its Choice Scarf to Snorlax (50 -> 75); Chansey (70) and Snorlax act after`, enumerate(base({
    game,
    mons: [{ species: "Jolteon", ability: "Volt Absorb", item: "Choice Scarf", moves: ["Trick"] }, slow, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] }, still],
    turns: [["move 1 1, move 1", "move 1, move 1"]],
    inspect: (b) => `${items(b)} || ${order(b)}`,
  })), { lines: false });
}

// T2. Iron Ball: halves Speed (re-sort) and grounds the holder (sim/pokemon.ts isGrounded): Earthquake then hits Gyarados.
if (want("T2")) report("T2 sv: Regieleki (110 with Iron Ball) Tricks Iron Ball to Gyarados (101 -> 50); Chansey (70) Splash; Garchomp (63) Earthquake", enumerate(base({
  mons: [{ species: "Regieleki", ability: "Transistor", item: "Iron Ball", moves: ["Trick"] }, { species: "Garchomp", ability: "Rough Skin", moves: ["Earthquake"], level: 25 },
    { species: "Gyarados", ability: "Moxie", moves: ["Splash"] }, still],
  turns: [["move 1 1, move 1", "move 1, move 1"]],
  inspect: (b) => `${items(b)} || ${order(b)} || ${hps(b)}`,
})));

// T3. Life Orb moves with the item: the receiver's later attack has x1.3 and costs it 1/10; the giver's does not.
if (want("T3")) report("T3 sv: Jolteon (fast) Tricks Life Orb to Snorlax; Snorlax Body Slams Chansey; Jolteon's ally Lapras Body Slams Snorlax", enumerate(base({
  mons: [{ species: "Jolteon", ability: "Volt Absorb", item: "Life Orb", moves: ["Trick"] }, { species: "Lapras", ability: "Shell Armor", moves: ["Body Slam"] },
    { species: "Snorlax", ability: "Thick Fat", moves: ["Body Slam"] }, still],
  turns: [["move 1 1, move 1 1", "move 1 -2, move 1"]],
  inspect: (b) => `${items(b)} || ${hps(b)}`,
})));

// T4. What acts on receipt at the action's Update: Sitrus (half HP), Lum (a status), White Herb (lowered stages), Mental Herb
// (Taunt), a Figy-family Berry (quarter HP, nature confusion), a held item a Klutz holder or Magic Room keeps from working.
for (const [item, setup, note] of [
  ["Sitrus Berry", (p: any) => p.sethp(90), "Snorlax at 90/235"],
  ["Lum Berry", (p: any) => p.setStatus("par", null, null, true), "Snorlax paralysed"],
  ["White Herb", (p: any) => { p.boosts.def = -2; }, "Snorlax at Def -2"],
  ["Mental Herb", (p: any) => p.addVolatile("taunt"), "Snorlax taunted"],
  ["Figy Berry", (p: any) => p.sethp(50), "Snorlax at 50/235, Modest (-Atk)"],
] as const) if (want("T4")) {
  report(`T4 sv: Jolteon Tricks ${item} to ${note}`, enumerate(base({
    mons: [{ species: "Jolteon", ability: "Volt Absorb", item, moves: ["Trick"] }, still,
      { species: "Snorlax", ability: "Thick Fat", nature: item === "Figy Berry" ? "Modest" : "Serious", moves: ["Splash"] }, slow],
    turns: [["move 1 1, move 1", "move 1, move 1"]],
    setup: (b) => setup(b.p2.active[0]),
    inspect: (b) => `${items(b)} || ${hps(b)} || Snorlax volatiles ${Object.keys(b.p2.active[0].volatiles).join(",") || "-"} def ${b.p2.active[0].boosts.def}`,
  })));
}
for (const [label, ability, room] of [["Klutz Snorlax", "Klutz", false], ["Magic Room", "Thick Fat", true]] as const) if (want("T4")) {
  report(`T4b sv: Jolteon Tricks Sitrus Berry to Snorlax at 90 HP under ${label}`, enumerate(base({
    mons: [{ species: "Jolteon", ability: "Volt Absorb", item: "Sitrus Berry", moves: ["Trick"] }, still, { species: "Snorlax", ability, moves: ["Splash"] }, slow],
    turns: [["move 1 1, move 1", "move 1, move 1"]],
    setup: (b) => { b.p2.active[0].sethp(90); if (room) b.field.addPseudoWeather("magicroom", "debug"); },
    inspect: (b) => `${items(b)} || ${hps(b)}`,
  })));
}

// T5. Failures: Sticky Hold (onTryImmunity hasAbility: Mold Breaker does not pass it, data/moves.ts trick), a Substitute (no
// bypasssub), Protect, both item-less, the user's Sticky Hold (its own takeItem passes: data/abilities.ts stickyhold source === pokemon).
for (const [label, user, target, setup] of [
  ["Mold Breaker Trick into Sticky Hold", { species: "Excadrill", ability: "Mold Breaker", item: "Choice Scarf", moves: ["Trick"] }, { species: "Muk", ability: "Sticky Hold", item: "Black Sludge", moves: ["Splash"], evs: { spe: 4 } }, null],
  ["Trick into a Substitute", { species: "Jolteon", ability: "Volt Absorb", item: "Choice Scarf", moves: ["Trick"] }, { species: "Snorlax", ability: "Thick Fat", item: "Leftovers", moves: ["Splash"] }, (b: any) => b.p2.active[0].addVolatile("substitute")],
  ["Trick into Protect", { species: "Jolteon", ability: "Volt Absorb", item: "Choice Scarf", moves: ["Trick"] }, { species: "Snorlax", ability: "Thick Fat", item: "Leftovers", moves: ["Protect"] }, null],
  ["both item-less", { species: "Jolteon", ability: "Volt Absorb", moves: ["Trick"] }, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] }, null],
  ["a Sticky Hold user Tricks", { species: "Muk", ability: "Sticky Hold", item: "Black Sludge", moves: ["Trick"], evs: { spe: 252 }, nature: "Jolly" }, { species: "Snorlax", ability: "Thick Fat", item: "Leftovers", moves: ["Splash"] }, null],
] as const) if (want("T5")) {
  report(`T5 sv: ${label}`, enumerate(base({
    mons: [user as Mon, still, target as Mon, slow],
    turns: [["move 1 1, move 1", "move 1, move 1"]],
    setup: setup ? (b) => { (setup as (b: any) => void)(b); b.p2.active[0].hp = b.p2.active[0].maxhp; } : undefined,
    inspect: items,
  })));
}

// T6. Items no Trick moves (their onTakeItem, run for the holder and again for the receiver: data/moves.ts trick onHit
// singleEvent('TakeItem', item, ..., receiver)): a Plate from Arceus and to Arceus, Booster Energy from a Paradox Pokémon and to
// one (then used on receipt), a Mega Stone (Champions) from and to its species, Rusted Sword, a Z-Crystal (USUM).
for (const [game, label, user, target] of [
  ["sv", "Plate from Arceus", { species: "Jolteon", ability: "Volt Absorb", item: "Choice Scarf", moves: ["Trick"] }, { species: "Arceus-Fire", ability: "Multitype", item: "Flame Plate", moves: ["Splash"] }],
  ["sv", "Plate to Arceus", { species: "Jolteon", ability: "Volt Absorb", item: "Flame Plate", moves: ["Trick"] }, { species: "Arceus", ability: "Multitype", moves: ["Splash"] }],
  ["sv", "Booster Energy from Flutter Mane", { species: "Jolteon", ability: "Volt Absorb", item: "Choice Scarf", moves: ["Trick"] }, { species: "Flutter Mane", ability: "Protosynthesis", item: "Booster Energy", moves: ["Splash"] }],
  ["sv", "Booster Energy to Flutter Mane", { species: "Jolteon", ability: "Volt Absorb", item: "Booster Energy", moves: ["Trick"] }, { species: "Flutter Mane", ability: "Protosynthesis", moves: ["Splash"] }],
  ["sv", "Booster Energy to Snorlax (non-Paradox)", { species: "Jolteon", ability: "Volt Absorb", item: "Booster Energy", moves: ["Trick"] }, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] }],
  ["champions", "Charizardite X from Charizard", { species: "Jolteon", ability: "Volt Absorb", item: "Choice Scarf", moves: ["Trick"] }, { species: "Charizard", ability: "Blaze", item: "Charizardite X", moves: ["Splash"] }],
  ["champions", "Charizardite X to Charizard", { species: "Jolteon", ability: "Volt Absorb", item: "Charizardite X", moves: ["Trick"] }, { species: "Charizard", ability: "Blaze", moves: ["Splash"] }],
  ["champions", "Charizardite X to Snorlax", { species: "Jolteon", ability: "Volt Absorb", item: "Charizardite X", moves: ["Trick"] }, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] }],
  ["swsh", "Rusted Sword from Zacian", { species: "Jolteon", ability: "Volt Absorb", item: "Choice Scarf", moves: ["Trick"] }, { species: "Zacian", ability: "Intrepid Sword", item: "Rusted Sword", moves: ["Splash"] }],
  ["usum", "a Z-Crystal", { species: "Jolteon", ability: "Volt Absorb", item: "Electrium Z", moves: ["Trick"] }, { species: "Snorlax", ability: "Thick Fat", item: "Leftovers", moves: ["Splash"] }],
] as const) if (want("T6")) {
  report(`T6 ${game}: ${label}`, enumerate(base({ game, mons: [user as Mon, still, target as Mon, slow], turns: [["move 1 1, move 1", "move 1, move 1"]], inspect: (b) => `${items(b)} || Flutter/target volatiles ${Object.keys(b.p2.active[0].volatiles).join(",") || "-"}` })));
}

// T7. Unburden: the target that loses its item and gets none doubles its Speed at once (data/abilities.ts unburden onTakeItem
// addVolatile; condition onModifySpe while item-less): gen 9 re-sorts, so Hawlucha now moves before Dragapult.
if (want("T7")) report("T7 sv: Regieleki (item-less) Tricks Hawlucha (Unburden, Sitrus); Dragapult (162) and Hawlucha (138 -> 276) act after", enumerate(base({
  mons: [{ species: "Regieleki", ability: "Transistor", moves: ["Trick"] }, { species: "Dragapult", ability: "Infiltrator", moves: ["Splash"] },
    { species: "Hawlucha", ability: "Unburden", item: "Sitrus Berry", moves: ["Splash"] }, slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]],
  inspect: (b) => `${items(b)} || ${order(b)} || Hawlucha volatiles ${Object.keys(b.p2.active[0].volatiles).join(",") || "-"}`,
})), { lines: false });
if (want("T7")) report("T7b sv: Hawlucha (Unburden, active: item-less) receives Regieleki's Leftovers: Unburden stops while it holds one", enumerate(base({
  mons: [{ species: "Regieleki", ability: "Transistor", item: "Leftovers", moves: ["Trick"] }, { species: "Dragapult", ability: "Infiltrator", moves: ["Splash"] },
    { species: "Hawlucha", ability: "Unburden", moves: ["Splash"] }, slow],
  setup: (b) => { b.p2.active[0].addVolatile("unburden"); },
  turns: [["move 1 1, move 1", "move 1, move 1"]],
  inspect: (b) => `${items(b)} || ${order(b)} || Hawlucha volatiles ${Object.keys(b.p2.active[0].volatiles).join(",") || "-"} spe ${b.p2.active[0].getStat("spe")}`,
})), { lines: false });

// T8. The end of turn reads the new holder: Leftovers (1/16), Black Sludge on a non-Poison type (-1/8), Toxic Orb and Flame
// Orb (status at order 28.3, no damage this turn), Sticky Barb (-1/8 to its holder at 28.3).
for (const item of ["Leftovers", "Black Sludge", "Toxic Orb", "Flame Orb", "Sticky Barb"]) if (want("T8")) {
  report(`T8 sv: Jolteon (100/140) Tricks ${item} to Snorlax (100/235)`, enumerate(base({
    mons: [{ species: "Jolteon", ability: "Volt Absorb", item, moves: ["Trick"] }, still, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] }, slow],
    turns: [["move 1 1, move 1", "move 1, move 1"]],
    setup: (b) => { b.p1.active[0].sethp(100); b.p2.active[0].sethp(100); },
    inspect: (b) => `${items(b)} || ${hps(b)}`,
  })), { lines: false });
}

// T9. Switcheroo is Trick (sv); Bestow (USUM only): no protect flag, bypasssub, fails into a holder, no Sticky Hold immunity.
if (want("T9")) report("T9 sv: Switcheroo Sitrus Berry to Snorlax at 90 HP", enumerate(base({
  mons: [{ species: "Jolteon", ability: "Volt Absorb", item: "Sitrus Berry", moves: ["Switcheroo"] }, still, { species: "Snorlax", ability: "Thick Fat", item: "Leftovers", moves: ["Splash"] }, slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]],
  setup: (b) => { b.p2.active[0].sethp(90); },
  inspect: (b) => `${items(b)} || ${hps(b)}`,
})));
for (const [label, target, setup] of [
  ["Bestow Sitrus to Snorlax at 90 HP through Protect", { species: "Snorlax", ability: "Thick Fat", moves: ["Protect"] }, (b: any) => b.p2.active[0].sethp(90)],
  ["Bestow Sitrus into a Substitute (Snorlax at 90 HP)", { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] }, (b: any) => { b.p2.active[0].addVolatile("substitute"); b.p2.active[0].sethp(90); }],
  ["Bestow Sitrus to a holder", { species: "Snorlax", ability: "Thick Fat", item: "Leftovers", moves: ["Splash"] }, null],
  ["Bestow Sitrus to Sticky Hold Muk at 50 HP", { species: "Muk", ability: "Sticky Hold", moves: ["Splash"], evs: { spe: 4 } }, (b: any) => b.p2.active[0].sethp(50)],
] as const) if (want("T9")) {
  report(`T9b usum: ${label}`, enumerate(base({
    game: "usum",
    mons: [{ species: "Jolteon", ability: "Volt Absorb", item: "Sitrus Berry", moves: ["Bestow"] }, still, target as Mon, slow],
    turns: [["move 1 1, move 1", "move 1, move 1"]],
    setup: setup ? (b) => (setup as (b: any) => void)(b) : undefined,
    inspect: (b) => `${items(b)} || ${hps(b)}`,
  })));
}

// T10. Items that act on receipt beyond Berries and herbs: Air Balloon (ungrounds: a later Earthquake misses), Room Service under
// Trick Room (used: Speed -1), Electric Seed on Electric Terrain (used: Def +1), Choice Band (the receiver's later hit x1.5).
if (want("T10")) report("T10 sv: Jolteon Tricks Air Balloon to Snorlax; Garchomp (slow) Earthquake", enumerate(base({
  mons: [{ species: "Jolteon", ability: "Volt Absorb", item: "Air Balloon", moves: ["Trick"] }, { species: "Garchomp", ability: "Rough Skin", moves: ["Earthquake"], level: 30 },
    { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] }, still],
  turns: [["move 1 1, move 1", "move 1, move 1"]],
  inspect: (b) => `${items(b)} || ${hps(b)}`,
})));
for (const [item, setup] of [["Room Service", (b: any) => b.field.addPseudoWeather("trickroom", "debug")], ["Electric Seed", (b: any) => b.field.setTerrain("electricterrain", "debug")]] as const) if (want("T10")) {
  report(`T10b sv: Jolteon Tricks ${item} to Snorlax`, enumerate(base({
    mons: [{ species: "Jolteon", ability: "Volt Absorb", item, moves: ["Trick"] }, still, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] }, slow],
    turns: [["move 1 1, move 1", "move 1, move 1"]],
    setup: (b) => (setup as (b: any) => void)(b),
    inspect: (b) => `${items(b)} || Snorlax spe ${b.p2.active[0].boosts.spe} def ${b.p2.active[0].boosts.def}`,
  })));
}

// T11. Symbiosis does not pass an item after Trick (onAllyAfterUseItem: Trick runs takeItem/setItem, no useItem).
if (want("T11")) report("T11 sv: Jolteon Tricks its Choice Scarf to item-less Snorlax; Jolteon's ally Oranguru has Symbiosis + Leftovers", enumerate(base({
  mons: [{ species: "Jolteon", ability: "Volt Absorb", item: "Choice Scarf", moves: ["Trick"] }, { species: "Oranguru", ability: "Symbiosis", item: "Leftovers", moves: ["Splash"] },
    { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] }, slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]],
  inspect: items,
})));

// T10c. A Seed or Room Service reaches another Pokémon unused only from a holder that cannot use it (T10b: the giver used it
// first, so both are item-less and Trick fails); from a Klutz giver, the receiver uses it at once (its onStart useItem).
for (const [item, setup] of [["Room Service", (b: any) => b.field.addPseudoWeather("trickroom", "debug")], ["Electric Seed", (b: any) => b.field.setTerrain("electricterrain", "debug")]] as const) if (want("T10")) {
  report(`T10c sv: Klutz Lopunny Tricks ${item} to Snorlax`, enumerate(base({
    mons: [{ species: "Lopunny", ability: "Klutz", item, moves: ["Trick"] }, still, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] }, slow],
    turns: [["move 1 1, move 1", "move 1, move 1"]],
    setup: (b) => (setup as (b: any) => void)(b),
    inspect: (b) => `${items(b)} || Snorlax spe ${b.p2.active[0].boosts.spe} def ${b.p2.active[0].boosts.def}`,
  })));
}

// T12. The Trick user receives the target's Sitrus Berry below half HP: it eats it at once too.
if (want("T12")) report("T12 sv: Jolteon (60/140) Tricks its Choice Scarf to Snorlax for Snorlax's Sitrus Berry", enumerate(base({
  mons: [{ species: "Jolteon", ability: "Volt Absorb", item: "Choice Scarf", moves: ["Trick"] }, still, { species: "Snorlax", ability: "Thick Fat", item: "Sitrus Berry", moves: ["Splash"] }, slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]],
  setup: (b) => { b.p1.active[0].sethp(60); },
  inspect: (b) => `${items(b)} || ${hps(b)}`,
})));
