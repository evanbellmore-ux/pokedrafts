// TIER 2 (moves phase): today's app (main 4008ee8, read-only) against the pinned 2v2 oracle on the cases where a Tier 2
// guard does NOT fire but the turn may still be wrong (suspected silent gaps found while designing), and on the guards
// whose Showdown outcome this design relies on. Each case runs through 2v2/verify/sim-dfs.ts oracle(), app-turn.ts
// appTurn() and compare.ts compareCase(). Run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/status2/design/tier2-moves-app-probes.ts [ID ...] > scripts/.cache/calc-audit/status2/design/tier2-moves-app-probes.out
import { oracle } from "../../2v2/verify/sim-dfs";
import { appTurn, preflight, runtimeFor } from "../../2v2/verify/app-turn";
import { compareCase } from "../../2v2/verify/compare";
import type { Case, CaseAction, CaseMon, SlotId } from "../../2v2/verify/case-types";

type Slot = CaseMon & { action: CaseAction };
const act = (m: CaseMon, move: string | null, target?: SlotId): Slot => ({ ...m, action: { move, ...(target ? { target } : {}) } });
const slots = (a: Slot, b: Slot, c: Slot, d: Slot): Case["slots"] => ({ "own-left": a, "own-right": b, "opponent-left": c, "opponent-right": d });
const lax = (spe: number): CaseMon => ({ species: "Snorlax", ability: "Thick Fat", evs: { spe } });

const CASES: Case[] = [
  {
    id: "T2A-CR1", title: "High Jump Kick into a Protect user: Showdown crashes the kicker for half its maximum HP", game: "sv",
    checks: "PS/data/moves.ts highjumpkick onMoveFail (hasCrashDamage): the app has no crash damage anywhere",
    slots: slots(
      act({ species: "Dragonite", ability: "Inner Focus", evs: { spe: 252 } }, "Protect"),
      act(lax(4), null),
      act({ species: "Hitmonlee", ability: "Limber" }, "High Jump Kick", "own-left"),
      act(lax(8), null),
    ),
  },
  {
    id: "T2A-CR2", title: "Champions: High Jump Kick into a Ghost type (immune): crash", game: "champions",
    checks: "crash on a type immunity",
    slots: slots(
      act({ species: "Gengar", ability: "Cursed Body", evs: { spe: 32 } }, null),
      act(lax(1), null),
      act({ species: "Hawlucha", ability: "Limber" }, "High Jump Kick", "own-left"),
      act(lax(2), null),
    ),
  },
  {
    id: "T2A-CR3", title: "Supercell Slam into Wide Guard? no: into a Protect user, then a later move by the kicker's ally", game: "sv",
    checks: "the crash changes the kicker's HP before a later action (a Sitrus at the Update)",
    slots: slots(
      act({ species: "Dragonite", ability: "Inner Focus", evs: { spe: 252 } }, "Protect"),
      act(lax(4), null),
      act({ species: "Electrode", ability: "Static", item: "Sitrus Berry", evs: { spe: 100 } }, "Supercell Slam", "own-left"),
      act({ species: "Snorlax", ability: "Thick Fat" }, "Body Slam", "opponent-left"),
    ),
  },
  {
    id: "T2A-VS1", title: "Burning Jealousy as the last action into a foe whose Attack rose this turn: burn, end-of-turn burn damage", game: "sv",
    checks: "volatileGuard returns with no later action; does the step or the end of turn give the burn?",
    slots: slots(
      act({ species: "Torkoal", ability: "White Smoke" }, "Burning Jealousy"),
      act(lax(1), null),
      act({ species: "Lucario", ability: "Inner Focus", evs: { spe: 252 } }, "Swords Dance"),
      act(lax(2), null),
    ),
  },
  {
    id: "T2A-VS2", title: "USUM: Core Enforcer as the last action into a badly poisoned Poison Heal Gliscor that moved", game: "usum",
    checks: "Core Enforcer suppresses the ability: the end of turn's toxic damage instead of Poison Heal",
    slots: slots(
      act({ species: "Zygarde", ability: "Aura Break" }, "Core Enforcer"),
      act(lax(1), null),
      act({ species: "Gliscor", ability: "Poison Heal", status: "tox", hp: 100, evs: { spe: 252 } }, null),
      act(lax(2), null),
    ),
  },
  {
    id: "T2A-VS3", title: "SwSh: Spectral Thief as the last action into a foe at +2 Attack (E2 stages)", game: "swsh", outcomes: true,
    checks: "stealsBoosts: the user gains +2 Atk, the target loses it (E2)",
    slots: slots(
      act({ species: "Marshadow", ability: "Technician" }, "Spectral Thief", "opponent-left"),
      act(lax(1), null),
      act({ species: "Lucario", ability: "Justified", boosts: { atk: 2 }, evs: { spe: 252 } }, null),
      act(lax(2), null),
    ),
  },
  {
    id: "T2A-VS4", title: "Alluring Voice as the last action into a foe whose Attack rose this turn (E2 confusion)", game: "sv", outcomes: true,
    checks: "Alluring Voice's 100% confusion when statsRaisedThisTurn",
    slots: slots(
      act({ species: "Sylveon", ability: "Cute Charm" }, "Alluring Voice", "opponent-left"),
      act(lax(1), null),
      act({ species: "Lucario", ability: "Inner Focus", evs: { spe: 252 } }, "Swords Dance"),
      act(lax(2), null),
    ),
  },
  {
    id: "T2A-BB1", title: "Champions: Greninja (Battle Bond) knocks a foe out with a later action: Showdown checks species greninjabond", game: "champions",
    checks: "PS/data/abilities.ts battlebond: source.species.id === 'greninjabond'; Champions' Greninja is 'greninja'",
    slots: slots(
      act({ species: "Greninja", ability: "Battle Bond", evs: { spe: 32 } }, "Dark Pulse", "opponent-left"),
      act(lax(1), null),
      act({ species: "Alakazam", ability: "Inner Focus", hp: 1 }, null),
      act({ species: "Snorlax", ability: "Thick Fat" }, "Body Slam", "own-left"),
    ),
  },
  {
    id: "T2A-SI1", title: "Garchomp Dig with a later Earthquake from its ally (today: semiInvulnerable)", game: "sv",
    checks: "the guard's text today",
    slots: slots(
      act({ species: "Garchomp", ability: "Rough Skin", evs: { spe: 252 } }, "Dig", "opponent-left"),
      act({ species: "Excadrill", ability: "Mold Breaker", evs: { atk: 252, spe: 100 } }, "Earthquake"),
      act(lax(4), null),
      act(lax(8), null),
    ),
  },
  {
    id: "T2A-AF1", title: "Aftermath: a contact knockout of Garbodor (Champions) with a later action", game: "champions",
    checks: "the guard's text today",
    slots: slots(
      act({ species: "Garchomp", ability: "Rough Skin", evs: { spe: 32 } }, "Dragon Claw", "opponent-left"),
      act(lax(1), null),
      act({ species: "Garbodor", ability: "Aftermath", hp: 1 }, null),
      act({ species: "Snorlax", ability: "Thick Fat" }, "Body Slam", "own-left"),
    ),
  },
];

const only = process.argv.slice(2);
(async () => {
  for (const c of CASES) {
    if (only.length && !only.includes(c.id)) continue;
    const runtime = await runtimeFor(c);
    const pre = preflight(c, runtime);
    console.log(`\n### ${c.id}: ${c.title}${pre.length ? `\n  preflight: ${pre.join(" | ")}` : ""}`);
    if (pre.length) continue;
    let o: ReturnType<typeof oracle> | null = null;
    try { o = oracle(c); } catch (error) { console.log(`  oracle failed: ${(error as Error).message.split("\n")[0]}`); }
    const app = await appTurn(c);
    const r = app.result;
    console.log(`  app: ${r?.status}${r?.status === "not-estimated" ? ` — ${r.reason}` : ""}${r?.status === "ready" && r.endOfTurn.status === "not-estimated" ? ` (end of turn: ${r.endOfTurn.reason})` : ""}`);
    if (r?.status === "ready") {
      console.log(`  app facts: ${r.facts.join(" / ")}`);
      for (const step of r.steps) console.log(`  app step ${step.slot} ${step.moveId}: moves ${step.moves} skipped ${JSON.stringify(step.skipped)} facts ${JSON.stringify(step.facts)}`);
      for (const [slot, hp] of Object.entries(r.hp)) if (hp) console.log(`  app hp ${slot}: ${hp.low}/${hp.average.toFixed(3)}/${hp.high} [${hp.min}–${hp.max}] ko ${hp.koChance} heals ${JSON.stringify(hp.heals)} losses ${JSON.stringify((hp as { losses?: unknown }).losses ?? null)}`);
      if (r.endOfTurn.status === "ready") for (const [slot, hp] of Object.entries(r.endOfTurn.hp)) if (hp) console.log(`  app eot ${slot}: ${hp.low}/${hp.average.toFixed(3)}/${hp.high} [${hp.min}–${hp.max}]`);
    }
    if (app.outcomes?.status === "ready") {
      for (const outcome of app.outcomes.outcomes) {
        console.log(`  app E2 outcome ${outcome.chance.toFixed(4)}: ${Object.entries(outcome.mons).map(([slot, mon]) => `${slot} ${JSON.stringify(mon!.build.boosts)} ${mon!.build.status || ""} [${(mon as { volatiles?: string[] }).volatiles?.join(",") ?? ""}]`).join(" | ")}`);
      }
    }
    if (o) {
      for (const slot of Object.keys(o.expected) as SlotId[]) {
        const e = o.expected[slot], s = o.walks.all.slots[slot], t = o.afterTurn?.[slot];
        console.log(`  oracle ${slot} ${s.species}: ${e.low}/${e.average.toFixed(3)}/${e.high} [${e.min}–${e.max}] ko ${e.koChance} boosts ${JSON.stringify(s.boosts ?? {})} status ${JSON.stringify(s.status ?? {})} vol ${JSON.stringify(s.volatiles ?? {})}${t ? ` | turn ${t.low}/${t.average.toFixed(3)}/${t.high} [${t.min}–${t.max}]` : ""}`);
      }
      for (const [slot, step] of Object.entries(o.walks.all.steps)) if (step) console.log(`  oracle step ${slot} ${step.moveId}: moved ${step.moved} cant ${JSON.stringify(step.cant)} lines ${JSON.stringify(step.lines)}`);
      for (const res of o.residuals ?? []) console.log(`  oracle residual ${res.slot} ${res.effect}${res.other ? ` (${res.other})` : ""}: ${res.chance} ${res.min}..${res.max} ${JSON.stringify(res.facts)}`);
      const mismatches = compareCase(c, o, r, () => false, app.outcomes ?? null);
      console.log(`  mismatches: ${mismatches.length}`);
      for (const m of mismatches.slice(0, 12)) console.log(`    ${m.where} ${m.field}: expected ${JSON.stringify(m.expected)} got ${JSON.stringify(m.got)}${m.note ? ` (${m.note})` : ""}`);
    }
  }
})();
