// status2 Track E1 (SPEC2 §4.6): the end of turn's new rows against pinned Showdown c23d2e94, through the verify harness
// (sim-dfs.ts oracle(), compare.ts compareCase()). The app input is caseInput() plus the wave 1a carried fields this track
// reads (V1's app-turn.ts maps them later). Run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/status2/build/e1-probes.ts [ID ...] > scripts/.cache/calc-audit/status2/build/e1-probes.out
import { oracle } from "../../2v2/verify/sim-dfs";
import { caseInput, runtimeFor } from "../../2v2/verify/app-turn";
import { compareCase } from "../../2v2/verify/compare";
import { SLOTS, toID, type Case, type CaseAction, type CaseMon, type SlotId } from "../../2v2/verify/case-types";
import { calculateDoublesOutcomes, calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import type { DoublesCarried, DoublesTurnInput } from "@/app/lib/battle/doubles-types";

type Slot = CaseMon & { action: CaseAction };
const act = (m: CaseMon, move: string | null = null, target?: SlotId): Slot => ({ ...m, action: { move, ...(target ? { target } : {}) } });
const slots = (a: Slot, b: Slot, c: Slot, d: Slot): Case["slots"] => ({ "own-left": a, "own-right": b, "opponent-left": c, "opponent-right": d });
const lax = (spe = 0, extra: Partial<CaseMon> = {}): CaseMon => ({ species: "Snorlax", ability: "Thick Fat", evs: { spe }, ...extra });

/** The wave 1a carried fields and lastItem the harness's caseInput does not map yet. */
function patch(c: Case, input: DoublesTurnInput) {
  for (const slot of SLOTS) {
    const m = c.slots[slot], entry = input.pokemon[slot];
    if (!entry || m.absent) continue;
    const cc = m.carried ?? {};
    const extra: DoublesCarried = {};
    if (cc.telekinesis) extra.telekinesis = cc.telekinesis;
    if (cc.healBlock) extra.healBlock = cc.healBlock;
    if (cc.embargo) extra.embargo = cc.embargo;
    if (cc.nightmare) extra.nightmare = true;
    if (cc.octolock) extra.octolock = cc.octolock;
    if (cc.copy) extra.copy = { ...cc.copy };
    if (cc.taunt) extra.taunt = cc.taunt;
    if (Object.keys(extra).length) entry.carried = { ...entry.carried, ...extra };
    if (m.lastItem !== undefined) entry.lastItem = m.lastItem === null ? null : toID(m.lastItem);
  }
}

const CASES: Case[] = [
  // Liquid Ooze against a heal-blocked seeder (F4 §4.16, GA4): TryHeal's handlers by Speed; at one Speed, subOrder (a
  // volatile's 2 before an ability's 7: sim/battle.ts resolvePriority) or a tie?
  ...([["LOZ-faster", 252, 156, "Ooze faster"], ["LOZ-slower", 0, 252, "Ooze slower"], ["LOZ-tie", 0, 156, "one Speed (120)"]] as const).map(([id, oozeSpe, seederSpe, title]): Case => ({
    id: `E1-${id}`, title: `usum: Leech Seed from a heal-blocked seeder (3 turns left) into Liquid Ooze, ${title}`, game: "usum", outcomes: true, checks: "F4 §4.16",
    slots: slots(
      act({ species: "Venusaur", ability: "Overgrow", hp: 60, evs: { spe: seederSpe }, carried: { healBlock: 3 } }),
      act(lax(4)),
      act({ species: "Tentacruel", ability: "Liquid Ooze", evs: { spe: oozeSpe }, carried: { leechSeed: "own-left" } }),
      act(lax(12)),
    ),
  })),
  // Nightmare (TV17, CR11): 1/4 of its base maximum HP at 11; Comatose; Magic Guard.
  {
    id: "E1-NM-01", title: "usum: Nightmare on a sleeping Snorlax, a Comatose Komala, a sleeping Magic Guard Clefable", game: "usum", outcomes: true, checks: "residual 11",
    slots: slots(
      act(lax(4, { status: "slp", carried: { sleep: { attempts: 0, rest: false }, nightmare: true } })),
      act({ species: "Komala", ability: "Comatose", carried: { nightmare: true } }),
      act({ species: "Clefable", ability: "Magic Guard", status: "slp", carried: { sleep: { attempts: 0, rest: false }, nightmare: true } }),
      act(lax(12)),
    ),
  },
  // Healer (5.3, 3/10 outside Champions) cures the sleep first: no Nightmare at 11 in that world (cureStatus removes it).
  {
    id: "E1-NM-02", title: "usum: a sleeping Snorlax with Nightmare beside a Healer Audino: 3/10 cured first, no damage then", game: "usum", outcomes: true, checks: "CR11 with Healer",
    slots: slots(
      act(lax(4, { status: "slp", carried: { sleep: { attempts: 0, rest: false }, nightmare: true } })),
      act({ species: "Audino", ability: "Healer" }),
      act(lax(8)),
      act(lax(12)),
    ),
  },
  // Psychic Noise's Heal Block (duration 2) counts down to 1 at this end of turn.
  {
    id: "E1-PN-01", title: "sv: Psychic Noise into Garchomp: Heal Block with 1 turn left after the turn", game: "sv", outcomes: true, checks: "healblock durationCallback",
    slots: slots(act({ species: "Bronzong", ability: "Levitate" }, "Psychic Noise", "opponent-left"), act(lax(4)), act({ species: "Garchomp", ability: "Rough Skin" }), act(lax(12))),
  },
  // Speed Boost on a Pokémon that switched in this turn (activeTurns 0): none.
  {
    id: "E1-SPB-01", title: "sv: Blaziken (Speed Boost) switched in this turn: no Speed Boost at its first end of turn", game: "sv", outcomes: true, checks: "speedboost activeTurns",
    slots: slots({ species: "Blaziken", ability: "Speed Boost", action: { move: null, switchIn: true } }, act(lax(4)), act(lax(8)), act({ species: "Blaziken", ability: "Speed Boost" })),
  },
  // Octolock carried (CR05 as a carried volatile): −1/−1 at 14, Defiant +4, the source's ally Espathra copies +4 at 29.
  {
    id: "E1-OCT-01", title: "champions: Octolock on a Defiant Kingambit from Grapploct, whose ally Espathra has Opportunist", game: "champions", outcomes: true, checks: "C9",
    slots: slots(
      act({ species: "Grapploct", ability: "Limber" }),
      act({ species: "Espathra", ability: "Opportunist" }),
      act({ species: "Kingambit", ability: "Defiant", carried: { octolock: "own-left" } }),
      act(lax(12)),
    ),
  },
  {
    id: "E1-OCT-04", title: "champions: Octolock and Syrup Bomb on one Defiant Kingambit (14, one holder: a tie); a foe Espathra copies at 29", game: "champions", outcomes: true, checks: "C9 with two 14 handlers",
    slots: slots(
      act({ species: "Grapploct", ability: "Limber" }), act(lax(4)),
      act({ species: "Kingambit", ability: "Defiant", carried: { octolock: "own-left", syrupBomb: "own-right" } }), act({ species: "Espathra", ability: "Opportunist" }),
    ),
  },
  {
    id: "E1-HRV-03", title: "sv: Trevenant (Harvest) and a paralysed Ambipom (Pickup) at one Speed (76) after Trevenant's Sitrus at the sand's Update", game: "sv", outcomes: true, checks: "C8 tie",
    slots: slots(act({ species: "Trevenant", ability: "Harvest", item: "Sitrus Berry", hp: 90 }), act({ species: "Ambipom", ability: "Pickup", hp: 140, status: "par", evs: { spe: 132 } }), act(lax(12)), act(lax(16))),
    field: { weather: "Sand" }, weatherTurns: 3,
  },
  {
    id: "E1-OCT-02", title: "swsh: Octolock on Mirror Armor Corviknight (back onto Grapploct) and on Clear Body Metagross", game: "swsh", outcomes: true, checks: "TV18c",
    slots: slots(
      act({ species: "Grapploct", ability: "Limber" }),
      act(lax(4)),
      act({ species: "Corviknight", ability: "Mirror Armor", carried: { octolock: "own-left" } }),
      act({ species: "Metagross", ability: "Clear Body", carried: { octolock: "own-left" } }),
    ),
  },
  {
    id: "E1-OCT-03", title: "swsh: Octolock whose source faints to sand first: it ends silently; a White Herb holder at 29", game: "swsh", outcomes: true, checks: "TV18b",
    slots: slots(
      act({ species: "Grapploct", ability: "Limber", hp: 1, evs: { spe: 252 } }),
      act({ species: "Grapploct", ability: "Limber" }),
      act({ species: "Snorlax", ability: "Thick Fat", carried: { octolock: "own-left" } }),
      act({ species: "Snorlax", ability: "Thick Fat", item: "White Herb", carried: { octolock: "own-right" } }),
    ),
    field: { weather: "Sand" }, weatherTurns: 3,
  },
  // Heal Block and Embargo with 1 turn left end before the final Update (CR01, CR02); 2 turns: nothing.
  ...([["HB-01", "sv", "healBlock", 1, "Sitrus Berry"], ["HB-02", "sv", "healBlock", 2, "Sitrus Berry"], ["HB-03", "sv", "healBlock", 1, "Leftovers"],
    ["EM-01", "usum", "embargo", 1, "Sitrus Berry"], ["EM-02", "usum", "embargo", 2, "Sitrus Berry"], ["EM-03", "usum", "embargo", 1, "Leftovers"]] as const)
    .map(([id, game, which, turns, item]): Case => ({
      id: `E1-${id}`, title: `${game}: Snorlax (${item}) at 130 HP in sand (to 116, under its Sitrus line) with ${which} ${turns} turn(s) left`, game, outcomes: true, checks: "C3, C4",
      slots: slots(act(lax(4)), act(lax(8)), act(lax(12, { hp: 130, item, carried: { [which]: turns } })), act(lax(16))),
      field: { weather: "Sand" }, weatherTurns: 3,
    })),
  // Embargo ending at 21 frees a Flame Orb for 28.3 (USUM).
  {
    id: "E1-EM-04", title: "usum: Embargo with 1 turn left on a Flame Orb holder: burned at 28.3", game: "usum", outcomes: true, checks: "C4",
    slots: slots(act(lax(4)), act(lax(8)), act(lax(12, { item: "Flame Orb", carried: { embargo: 1 } })), act(lax(16, { item: "Flame Orb", carried: { embargo: 2 } }))),
  },
  // Telekinesis ending at 19 grounds a Flame Orb holder for Misty Terrain at 28.3.
  {
    id: "E1-TK-01", title: "usum: Telekinesis (1 turn left; 2 turns left) on Flame Orb Snorlax under Misty Terrain", game: "usum", outcomes: true, checks: "residual 19",
    slots: slots(act(lax(4)), act(lax(8)), act(lax(12, { item: "Flame Orb", carried: { telekinesis: 1 } })), act(lax(16, { item: "Flame Orb", carried: { telekinesis: 2 } }))),
    field: { terrain: "Misty" },
  },
  // Speed Boost copied at 29 (A9).
  {
    id: "E1-OPP-01", title: "sv: Speed Boost Blaziken beside a foe Espathra (Opportunist): +1 Speed copied at 29", game: "sv", outcomes: true, checks: "A9",
    slots: slots(act({ species: "Blaziken", ability: "Speed Boost" }), act(lax(4)), act({ species: "Espathra", ability: "Opportunist" }), act(lax(12))),
  },
  // Two Espathra across: the one beside Blaziken's foes copies the Speed Boost at 29; that copy is not copied back (A8).
  {
    id: "E1-OPP-03", title: "sv: Speed Boost Blaziken with an Opportunist Espathra on each side: one copy, none back", game: "sv", outcomes: true, checks: "A8 at 29",
    slots: slots(act({ species: "Blaziken", ability: "Speed Boost" }), act({ species: "Espathra", ability: "Opportunist" }), act({ species: "Espathra", ability: "Opportunist" }), act(lax(12))),
  },
  // A pinch Berry at the final Update: the copy stays pending into the next turn (A11).
  {
    id: "E1-OPP-02", title: "sv: a Liechi Berry eaten at the final Update after sand; a foe Espathra's copy is pending", game: "sv", outcomes: true, checks: "A11",
    slots: slots(act(lax(4, { item: "Liechi Berry", hp: 70, status: "brn" })), act(lax(8)), act({ species: "Espathra", ability: "Opportunist" }), act(lax(12))),
  },
  // A Starf Berry at the final Update: one world per stat (E2 too).
  {
    id: "E1-STF-01", title: "sv: a burned Snorlax at 70 HP eats a Starf Berry at the final Update", game: "sv", outcomes: true, checks: "F4 §4.13",
    slots: slots(act(lax(4, { item: "Starf Berry", hp: 70, status: "brn" })), act(lax(8)), act(lax(12)), act(lax(16))),
  },
  // White Herb at 29 with an accuracy stage once Embargo ends at 21 (M1 with Embargo for Magic Room).
  {
    id: "E1-WHR-01", title: "usum: White Herb under Embargo (1 turn left) with an accuracy stage of -1: restored at 29", game: "usum", outcomes: true, checks: "M1",
    slots: slots(act(lax(4, { item: "White Herb", carried: { embargo: 1, stages: { accuracy: -1 } } })), act(lax(8)), act(lax(12)), act(lax(16))),
  },
  // Mental Herb at the final Update once Embargo ends at 21.
  {
    id: "E1-MH-01", title: "usum: a taunted Mental Herb holder under Embargo (1 turn left): the herb ends the Taunt at the final Update", game: "usum", outcomes: true, checks: "mentalherb onUpdate",
    slots: slots(act(lax(4, { item: "Mental Herb", carried: { embargo: 1, taunt: 2 } })), act(lax(8)), act(lax(12)), act(lax(16))),
  },
  // Harvest (C1-C4): not in sun 1/2; in sun certain; the final Update eats it when due.
  {
    id: "E1-HRV-01", title: "sv: Trevenant (Harvest, no item, last item Sitrus) at 70 HP: 1/2, then eaten at the final Update", game: "sv", outcomes: true, checks: "C1",
    slots: slots(act({ species: "Trevenant", ability: "Harvest", hp: 70, lastItem: "Sitrus Berry" }), act(lax(8)), act(lax(12)), act(lax(16))),
  },
  {
    id: "E1-HRV-02", title: "sv: the same in sun (5 turns left): certain", game: "sv", outcomes: true, checks: "C2",
    slots: slots(act({ species: "Trevenant", ability: "Harvest", hp: 70, lastItem: "Sitrus Berry" }), act(lax(8)), act(lax(12)), act(lax(16))),
    field: { weather: "Sun" }, weatherTurns: 5,
  },
  // Pickup (CQ03c as a case: earlierThisTurn.usedItem and lastItem Electric Seed; Ambipom picks it up in Electric Terrain).
  {
    id: "E1-PKP-01", title: "sv: a foe used its Electric Seed earlier this turn; Ambipom (Pickup) takes it and uses it at once", game: "sv", outcomes: true, checks: "CQ03c",
    slots: slots(act({ species: "Pincurchin", ability: "Electric Surge" }), act(lax(8, { lastItem: "Electric Seed", earlierThisTurn: { usedItem: true }, boosts: { def: 1 } })), act({ species: "Ambipom", ability: "Pickup" }), act(lax(16))),
    field: { terrain: "Electric" },
  },
  // Pickup of a Mental Herb used earlier this turn by a taunted holder: the herb ends the Taunt at the final Update.
  {
    id: "E1-MH-02", title: "sv: a taunted Ambipom (Pickup) takes the Mental Herb a foe used earlier this turn; it is used at the final Update", game: "sv", outcomes: true, checks: "mentalherb onUpdate",
    slots: slots(act(lax(4)), act(lax(8, { lastItem: "Mental Herb", earlierThisTurn: { usedItem: true } })), act({ species: "Ambipom", ability: "Pickup", carried: { taunt: 2 } }), act(lax(16))),
  },
  // Pickup before a slower Harvest (C8, CR09 with the Sitrus eaten at the weather's Update instead of by Teatime).
  {
    id: "E1-PKP-02", title: "sv: Trevenant eats its Sitrus at the sand's Update; a faster Ambipom (Pickup) takes it before Harvest", game: "sv", outcomes: true, checks: "C8",
    slots: slots(act({ species: "Trevenant", ability: "Harvest", item: "Sitrus Berry", hp: 90 }), act({ species: "Ambipom", ability: "Pickup", hp: 140 }), act(lax(12)), act(lax(16))),
    field: { weather: "Sand" }, weatherTurns: 3,
  },
];

(async () => {
  const want = process.argv.slice(2);
  for (const c of CASES) {
    if (want.length && !want.some((id) => c.id.startsWith(id))) continue;
    console.log(`\n### ${c.id}: ${c.title}`);
    let o: ReturnType<typeof oracle> | null = null;
    try { o = oracle(c); } catch (error) { console.log(`  oracle failed: ${(error as Error).message.split("\n")[0]}`); continue; }
    for (const w of o.warnings) console.log(`  oracle warning: ${w}`);
    for (const slot of SLOTS) {
      const s = o.walks.all.afterTurn?.slots[slot];
      if (s) console.log(`  oracle ${slot} ${s.species}: turn [${s.min}–${s.max}] avg ${s.average.toFixed(3)} ko ${s.koChance} boosts ${JSON.stringify(s.boosts ?? {})} items ${JSON.stringify(s.item ?? {})} status ${JSON.stringify(s.status ?? {})} vol ${JSON.stringify(s.volatiles ?? {})} dur ${JSON.stringify(s.durations ?? {})} copy ${JSON.stringify(s.pendingCopy ?? {})} lastItem ${JSON.stringify(s.lastItem ?? {})}`);
    }
    for (const r of o.residuals) console.log(`  oracle residual ${r.slot} ${r.effect}${r.other ? ` (${r.other})` : ""}: ${r.chance} ${r.min}..${r.max} ko ${r.koChance} ${JSON.stringify(r.facts ?? {})}`);
    const runtime = await runtimeFor(c);
    const input = caseInput(c, runtime);
    patch(c, input);
    const result = calculateDoublesTurn(input);
    const outcomes = c.outcomes ? calculateDoublesOutcomes(input) : undefined;
    if (result.status === "ready") {
      console.log(`  app facts: ${result.facts.join(" / ")}`);
      if (result.endOfTurn.status === "ready") {
        for (const r of result.endOfTurn.residuals) console.log(`  app residual ${r.slot} ${r.effect}${r.other ? ` (${r.other})` : ""}: ${r.chance} ${r.min}..${r.max} ko ${r.koChance} ${JSON.stringify(r.facts)}`);
        for (const slot of SLOTS) { const hp = result.endOfTurn.hp[slot]; if (hp) console.log(`  app eot ${slot}: [${hp.min}–${hp.max}] avg ${hp.average.toFixed(3)} ${JSON.stringify(hp.conditions ?? [])}`); }
      } else console.log(`  app end of turn: ${result.endOfTurn.reason}`);
    } else console.log(`  app: ${result.status} ${"reason" in result ? result.reason : JSON.stringify(result)}`);
    if (outcomes?.status === "ready") {
      for (const outcome of outcomes.outcomes) {
        console.log(`  app E2 ${outcome.chance.toFixed(4)}: ${SLOTS.map((slot) => { const m = outcome.mons[slot]; return m ? `${slot} ${m.build.itemId || "-"} ${JSON.stringify(m.build.boosts)} ${m.build.status || ""} v${JSON.stringify(m.volatiles ?? [])} t${JSON.stringify(m.turnsLeft ?? {})} c${JSON.stringify(m.pendingCopy ?? {})}` : `${slot} -`; }).join(" | ")}`);
      }
    } else if (outcomes) console.log(`  app E2: ${outcomes.status} ${"reason" in outcomes ? outcomes.reason : ""}`);
    const mismatches = compareCase(c, o, result, (moveId) => runtime.movesById.get(moveId)?.category === "Status", outcomes);
    console.log(`  mismatches: ${mismatches.length}`);
    for (const m of mismatches) console.log(`    ${m.where} ${m.field}: expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.got)}${m.note ? ` (${m.note})` : ""}`);
  }
})();
