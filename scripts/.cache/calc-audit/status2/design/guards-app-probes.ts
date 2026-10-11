// FAMILY 4: the app's engine as it is now against the pinned 2v2 oracle on cases this design needs (read-only use of
// app/lib/battle; nothing in the app is changed). Each case runs through 2v2/verify/sim-dfs.ts oracle(), app-turn.ts appTurn()
// and compare.ts compareCase(); the output lists the mismatches and the fields each question reads.
// Run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/status2/design/guards-app-probes.ts > scripts/.cache/calc-audit/status2/design/guards-app-probes.out
import { oracle } from "../../2v2/verify/sim-dfs";
import { appTurn, preflight, runtimeFor } from "../../2v2/verify/app-turn";
import { compareCase } from "../../2v2/verify/compare";
import type { Case, CaseAction, CaseMon, SlotId } from "../../2v2/verify/case-types";

type Slot = CaseMon & { action: CaseAction };
const act = (m: CaseMon, move: string | null, target?: SlotId): Slot => ({ ...m, action: { move, ...(target ? { target } : {}) } });
const slots = (a: Slot, b: Slot, c: Slot, d: Slot): Case["slots"] => ({ "own-left": a, "own-right": b, "opponent-left": c, "opponent-right": d });

const CASES: Case[] = [
  {
    id: "GA1", title: "A paralysed Trace holder that copied Limber (tracedAbility), with a move", game: "sv", checks: "the cure at the turn's start (FINAL.md open item)",
    slots: slots(
      act({ species: "Gardevoir", ability: "Trace", status: "par", evs: { spe: 252 }, appBuild: { tracedAbility: "limber" } }, "Psychic", "opponent-left"),
      act({ species: "Snorlax", ability: "Thick Fat", evs: { spe: 4 } }, null),
      act({ species: "Persian", ability: "Limber" }, null),
      act({ species: "Persian", ability: "Limber", evs: { spe: 8 } }, null),
    ),
  },
  {
    id: "GA1b", title: "An asleep Trace holder that copied Insomnia (tracedAbility), no carried sleep", game: "sv", checks: "the turn facts read the input's ability (trace)",
    slots: slots(
      act({ species: "Gardevoir", ability: "Trace", status: "slp", evs: { spe: 252 }, appBuild: { tracedAbility: "insomnia" } }, "Psychic", "opponent-left"),
      act({ species: "Snorlax", ability: "Thick Fat", evs: { spe: 4 } }, null),
      act({ species: "Hypno", ability: "Insomnia" }, null),
      act({ species: "Hypno", ability: "Insomnia", evs: { spe: 8 } }, null),
    ),
  },
  {
    id: "GA5", title: "Bulldoze into the user's own Defiant partner (an ally's drop: no Defiant)", game: "sv", outcomes: true,
    checks: "data/abilities.ts defiant onAfterEachBoost returns for an ally's drop; the pairwise step reads its target as a foe",
    slots: slots(
      act({ species: "Garchomp", ability: "Rough Skin", evs: { spe: 252 } }, "Bulldoze"),
      act({ species: "Kingambit", ability: "Defiant" }, null),
      act({ species: "Snorlax", ability: "Thick Fat", evs: { spe: 4 } }, null),
      act({ species: "Snorlax", ability: "Thick Fat", evs: { spe: 12 } }, null),
    ),
  },
  {
    id: "GA5b", title: "Bulldoze into the user's own Defiant partner, which moves later (Kowtow Cleave)", game: "sv",
    checks: "a Defiant rise the step gives an ally would change its later damage",
    slots: slots(
      act({ species: "Garchomp", ability: "Rough Skin", evs: { spe: 252 } }, "Bulldoze"),
      act({ species: "Kingambit", ability: "Defiant" }, "Kowtow Cleave", "opponent-left"),
      act({ species: "Snorlax", ability: "Thick Fat", evs: { spe: 4 } }, null),
      act({ species: "Snorlax", ability: "Thick Fat", evs: { spe: 12 } }, null),
    ),
  },
  {
    id: "GA2", title: "Champions: a Sheer Force Crunch on a Berserk Sitrus holder, then a later hit on it (no confusion)", game: "champions",
    checks: "Champions' Berserk onDamage has no Sheer Force clause: the Sheer Force hit locks the Berry (no AfterMoveSecondary)",
    slots: slots(
      act({ species: "Drampa", ability: "Berserk", item: "Sitrus Berry", hp: 140 }, "Dragon Pulse", "opponent-right"),
      act({ species: "Venusaur", ability: "Overgrow", evs: { spe: 4 } }, null),
      act({ species: "Feraligatr", ability: "Sheer Force", evs: { atk: 32, spe: 32 } }, "Crunch", "own-left"),
      act({ species: "Snorlax", ability: "Thick Fat" }, "Body Slam", "own-left"),
    ),
  },
  {
    id: "GA2b", title: "Champions: the same, the Berserk holder's own No move (Splash) after the Sheer Force hit", game: "champions",
    checks: "a self-targeting status move runs AfterMoveSecondary on its user: the lock resets, the Berry at that Update",
    slots: slots(
      act({ species: "Drampa", ability: "Berserk", item: "Sitrus Berry", hp: 140 }, null),
      act({ species: "Venusaur", ability: "Overgrow", evs: { spe: 4 } }, null),
      act({ species: "Feraligatr", ability: "Sheer Force", evs: { atk: 32, spe: 32 } }, "Crunch", "own-left"),
      act({ species: "Snorlax", ability: "Thick Fat" }, null),
    ),
  },
  {
    id: "GA3", title: "Flame Charge into the user's own Opportunist partner, no foe copier", game: "sv", outcomes: true,
    checks: "an ally's rise is not copied (onFoeAfterBoost); the pairwise step copies the attacker's rise onto its target",
    slots: slots(
      act({ species: "Arcanine", ability: "Intimidate", evs: { spe: 252 } }, "Flame Charge", "own-right"),
      act({ species: "Espathra", ability: "Opportunist" }, null),
      act({ species: "Snorlax", ability: "Thick Fat", evs: { spe: 4 } }, null),
      act({ species: "Snorlax", ability: "Thick Fat", evs: { spe: 12 } }, null),
    ),
  },
  ...([["GA4a", 252, 0], ["GA4b", 0, 252]] as const).map(([id, oozeSpe, seederSpe]): Case => ({
    id, title: `Leech Seed from a heal-blocked seeder into Liquid Ooze (Ooze holder ${oozeSpe ? "faster" : "slower"})`, game: "sv",
    checks: "TryHeal's handlers: the gainer's Heal Block and the seeded's Liquid Ooze (doubles-eot.ts:668 guard)",
    slots: slots(
      act({ species: "Venusaur", ability: "Overgrow", evs: { spe: seederSpe } }, null),
      act({ species: "Snorlax", ability: "Thick Fat", evs: { spe: 4 } }, null),
      act({ species: "Tentacruel", ability: "Liquid Ooze", evs: { spe: oozeSpe }, carried: { leechSeed: "own-left" } }, null),
      act({ species: "Farigiraf", ability: "Armor Tail", evs: { spe: 252 } }, "Psychic Noise", "own-left"),
    ),
  })),
];

(async () => {
  for (const c of CASES) {
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
      for (const [slot, hp] of Object.entries(r.hp)) if (hp) console.log(`  app hp ${slot}: ${hp.low}/${hp.average.toFixed(3)}/${hp.high} [${hp.min}–${hp.max}] ko ${hp.koChance} heals ${JSON.stringify(hp.heals)}`);
      if (r.endOfTurn.status === "ready") for (const [slot, hp] of Object.entries(r.endOfTurn.hp)) if (hp) console.log(`  app eot ${slot}: ${hp.low}/${hp.average.toFixed(3)}/${hp.high} [${hp.min}–${hp.max}]`);
    }
    if (app.outcomes?.status === "ready") {
      for (const outcome of app.outcomes.outcomes) {
        console.log(`  app E2 outcome ${outcome.chance.toFixed(4)}: ${Object.entries(outcome.mons).map(([slot, mon]) => `${slot} ${JSON.stringify(mon!.build.boosts)}`).join(" | ")}`);
      }
    }
    if (o) {
      for (const slot of Object.keys(o.expected) as SlotId[]) {
        const e = o.expected[slot], s = o.walks.all.slots[slot], t = o.afterTurn?.[slot];
        console.log(`  oracle ${slot} ${s.species}: ${e.low}/${e.average.toFixed(3)}/${e.high} [${e.min}–${e.max}] ko ${e.koChance} boosts ${JSON.stringify(s.boosts ?? {})} items ${JSON.stringify(s.item ?? {})} status ${JSON.stringify(s.status ?? {})}${t ? ` | turn ${t.low}/${t.average.toFixed(3)}/${t.high} [${t.min}–${t.max}]` : ""}`);
      }
      for (const [slot, step] of Object.entries(o.walks.all.steps)) if (step) console.log(`  oracle step ${slot} ${step.moveId}: moved ${step.moved} cant ${JSON.stringify(step.cant)} lines ${JSON.stringify(step.lines)}`);
      for (const res of o.residuals ?? []) console.log(`  oracle residual ${res.slot} ${res.effect}${res.other ? ` (${res.other})` : ""}: ${res.chance} ${res.min}..${res.max} ${JSON.stringify(res.facts)}`);
      const mismatches = compareCase(c, o, r, () => false, app.outcomes ?? null);
      console.log(`  mismatches: ${mismatches.length}`);
      for (const m of mismatches.slice(0, 12)) console.log(`    ${m.where} ${m.field}: expected ${JSON.stringify(m.expected)} got ${JSON.stringify(m.got)}${m.note ? ` (${m.note})` : ""}`);
    }
  }
})();
