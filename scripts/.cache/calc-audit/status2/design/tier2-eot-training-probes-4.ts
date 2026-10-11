// TIER 2 app probes: today's app engine (main 4008ee8, no code changed) on the inputs Training's bridge builds for the
// states the Showdown probes of part 2 cover, to show where the engine and pinned Showdown part today.
// Run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/status2/design/tier2-eot-training-probes-4.ts > scripts/.cache/calc-audit/status2/design/tier2-eot-training-probes-4.out 2> scripts/.cache/calc-audit/status2/design/tier2-eot-training-probes-4.err
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import { calculateDoublesOutcomes, calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import type { DoublesPokemonInput, DoublesSlotId, DoublesTurnInput } from "@/app/lib/battle/doubles-types";
import type { BattleBuild } from "@/app/lib/battle/types";

(async () => {
  const rt = await loadBattleRuntime("champions");
  const build = (id: string, extra: Partial<BattleBuild> = {}): BattleBuild => ({ ...createBuild(id, rt), ...extra });
  const mon = (b: BattleBuild, moveId: string | null, target: DoublesSlotId | null = null, extra: Partial<DoublesPokemonInput> = {}): DoublesPokemonInput => ({ build: b, contexts: {}, charged: false, action: { moveId, target }, ...extra });
  const input = (pokemon: Record<DoublesSlotId, DoublesPokemonInput | null>): DoublesTurnInput => ({ runtime: rt, field: { ...createConditions(), gameType: "Doubles" }, pokemon, canSwitch: { own: true, opponent: true } });
  const show = (title: string, i: DoublesTurnInput) => {
    const r = calculateDoublesTurn(i);
    console.log(`\n== ${title}`);
    if (r.status !== "ready") { console.log(`  ${r.status}: ${"reason" in r ? r.reason : JSON.stringify((r as any).issues)}`); return; }
    for (const step of r.steps) {
      const facts = [...step.skipped.map((f) => `skip ${f.text} (${+f.chance.toFixed(4)})`), ...step.facts.map((f) => `${f.text} (${+f.chance.toFixed(4)})`)];
      const hits = step.hits.map((h) => `${h.slot} ${h.kind} ${h.min ?? "-"}–${h.max ?? "-"}`).join("; ");
      console.log(`  ${step.slot} ${step.moveId}: ${hits} ${facts.join(" | ")}`);
    }
    for (const slot of ["own-left", "own-right", "opponent-left", "opponent-right"] as const) {
      const hp = r.hp[slot];
      if (hp) console.log(`  ${slot}: HP ${hp.min}–${hp.max}, conditions ${(hp.conditions ?? []).map((c) => `${c.text} ${+c.chance.toFixed(4)}`).join(", ") || "-"}`);
    }
    console.log(`  facts: ${r.facts.join(" / ")}`);
    console.log(`  end of turn: ${r.endOfTurn.status === "ready" ? "ready" : r.endOfTurn.reason}`);
    const e2 = calculateDoublesOutcomes(i);
    if (e2.status === "ready") {
      const asleep = e2.outcomes.map((o) => `${+o.chance.toFixed(4)}: own-left ${o.mons["own-left"]?.build.status || "-"}${o.mons["own-left"]?.sleepTurns !== undefined ? ` sleep ${o.mons["own-left"]!.sleepTurns}` : ""}`).join("; ");
      console.log(`  E2 own-left: ${asleep}`);
    }
  };
  // AP01: the bridge gives a Pokémon that switched in this turn "No move" (bridge.ts:302-304) and its carried sleep from the
  // public count (bridge.ts:184). Champions sleep: 2 or 3 turns (startTime sample [2, 3, 3]); after 1 attempt the engine's
  // No move can wake it (wakeChance), where Showdown runs no BeforeMove for the newcomer (probes-2 TR02: its counter stays).
  show("AP01 champions a sleeping Snorlax that switched in, as the bridge passes it (No move, 1 attempt so far)",
    input({ "own-left": mon(build("snorlax", { status: "slp" }), null, null, { carried: { sleep: { attempts: 1, rest: false } } }), "own-right": mon(build("garchomp"), null),
      "opponent-left": mon(build("incineroar"), null), "opponent-right": mon(build("sinistcha"), null) }));
  // AP02: Payback into a foe that switched in (the bridge: No move at its own Speed). Showdown: target.newlySwitched → 50 BP
  // (probes-2 TR06a); the engine doubles it when the newcomer's No move came first (contextFor: !willMove(target)).
  show("AP02 champions Payback (Tyranitar) into a faster foe that switched in, as the bridge passes it",
    input({ "own-left": mon(build("tyranitar"), "payback", "opponent-left"), "own-right": mon(build("snorlax"), null),
      "opponent-left": mon(build("garchomp"), null), "opponent-right": mon(build("sinistcha"), null) }));
  // AP03: a carried Future Sight and a carried Cud Chew today (doubles-eot.ts:213-214): the end of turn is not estimated.
  show("AP03 champions carried Future Sight landing on Garchomp",
    input({ "own-left": mon(build("hatterene"), null), "own-right": mon(build("snorlax"), null),
      "opponent-left": mon(build("garchomp"), null, null, { carried: { futureMove: "futuresight" } }), "opponent-right": mon(build("sinistcha"), null) }));
  show("AP04 champions carried Cud Chew on Farigiraf",
    input({ "own-left": mon(build("farigiraf", { abilityId: "cudchew", itemId: "" }), null, null, { carried: { cudChew: true } }), "own-right": mon(build("snorlax"), null),
      "opponent-left": mon(build("garchomp"), null), "opponent-right": mon(build("sinistcha"), null) }));
  // AP05: Moody in the calculator (a fact, no change) and in E2 (not estimated).
  {
    const i = input({ "own-left": mon(build("glalie", { abilityId: "moody" }), null), "own-right": mon(build("snorlax"), null),
      "opponent-left": mon(build("garchomp"), null), "opponent-right": mon(build("sinistcha"), null) });
    show("AP05 champions Moody", i);
    const e2 = calculateDoublesOutcomes(i);
    console.log(`  E2: ${e2.status}${e2.status === "ready" ? ` end of turn ${typeof e2.endOfTurn === "string" ? e2.endOfTurn : e2.endOfTurn.notEstimated}` : ""}`);
  }
})();
