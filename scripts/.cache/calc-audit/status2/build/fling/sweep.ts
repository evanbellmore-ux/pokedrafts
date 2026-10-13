// Track F (SPEC2 §4.7, guards.md §4.5 step 7): the verification sweep. Every catalog item of a game (with Fling data or not)
// thrown by two attackers (Weavile with Pressure; Hawlucha with Unburden) into
// - a Ghost type holding a resist Berry (Gengar, Colbur Berry: Fling is Dark),
// - a Shield Dust holder (Vivillon or Ribombee),
// - a Snorlax at a fifth of its HP in a sandstorm (its end of turn reads a burn or poison Fling gives, and a heal a Berry gives),
// - and for the Berries a Cheek Pouch Dedenne at two fifths of its HP,
// each row against the exact oracle (check.ts): the first use's rolls, its KO chance, its outcome and Uses to KO.
//   npx --no-install tsx scripts/.cache/calc-audit/status2/build/fling/sweep.ts <game> [item filter]
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, defaultAbilityActive, getBuildStats } from "@/app/lib/battle/model";
import type { BattleBuild, BattleConditions, BattleGame } from "@/app/lib/battle/types";
import { checkRow } from "./check";

const game = process.argv[2] as BattleGame;
const filter = process.argv[3];
(async () => {
  const R = await loadBattleRuntime(game);
  const build = (species: string, ability: string, item: string, part?: number, hp?: number): BattleBuild | null => {
    if (!R.speciesById.has(species)) return null;
    const base = createBuild(species, R);
    const b = { ...base, nature: "Serious", abilityId: ability, abilityActive: defaultAbilityActive(ability), itemId: item, currentHP: null, status: "", boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } } as BattleBuild;
    if (hp) return { ...b, currentHP: hp };
    return part ? { ...b, currentHP: Math.max(1, Math.floor((getBuildStats(b, R)?.hp ?? 1) * part)) } : b;
  };
  const shieldDust = R.speciesById.has("vivillon") ? "vivillon" : "ribombee";
  const attackers = [["weavile", "pressure", undefined], ["hawlucha", "unburden", undefined], ["weavile", "pressure", 10]] as const;
  let ok = 0, bad = 0, skipped = 0;
  for (const item of R.catalog.items) {
    if (item.unsupported.length || (filter && !item.id.includes(filter))) continue;
    const berry = item.id.endsWith("berry");
    const defenders: [string, BattleBuild | null, BattleConditions][] = [
      ["gengar-colbur", build("gengar", "cursedbody", "colburberry"), { ...createConditions(), gameType: "Singles" }],
      [`${shieldDust}-shielddust`, build(shieldDust, "shielddust", ""), { ...createConditions(), gameType: "Singles" }],
      ["snorlax-20%-sand", build("snorlax", "thickfat", "", 0.2), { ...createConditions(), gameType: "Singles", weather: "Sand" }],
      ...(berry ? [["dedenne-40%-cheekpouch", build("dedenne", "cheekpouch", "", 0.4), { ...createConditions(), gameType: "Singles" }] as [string, BattleBuild | null, BattleConditions]] : []),
    ];
    for (const [species, ability, hp] of attackers) {
      const attacker = build(species, ability, item.id, undefined, hp);
      if (!attacker) continue;
      // The attacker at 10 HP: its item's effects after the hit (none, it is thrown) against a target its end of turn can finish.
      const against: typeof defenders = hp ? [["snorlax-55hp-sand", build("snorlax", "thickfat", "", undefined, 55), { ...createConditions(), gameType: "Singles", weather: "Sand" }]] : defenders;
      for (const [label, defender, field] of against) {
        if (!defender) continue;
        const id = `${game}|${item.id}|${species}${hp ? `-${hp}hp` : ""}|${label}`;
        const out = calculateMatchup(attacker, defender, field, {}, R);
        if (Object.values(out.issues).some((list) => list.length)) { skipped++; console.log(`SKIP ${id}: build issues ${JSON.stringify(out.issues)}`); continue; }
        const row = out.results.find((r) => r.moveId === "fling");
        if (!row) { skipped++; console.log(`SKIP ${id}: no Fling row`); continue; }
        const check = checkRow(id, game as never, attacker, defender, field, R, row);
        if (check.skipped) { skipped++; console.log(`SKIP ${id}: ${check.skipped}`); continue; }
        if (check.ok) ok++; else bad++;
        console.log(`${check.ok ? "OK  " : "DIFF"} ${id}\n     app    ${check.app}${check.ok ? "" : `\n     oracle ${check.oracle}`}${check.diffs.map((d) => `\n     ! ${d}`).join("")}`);
      }
    }
  }
  console.log(`sweep ${game}: ${ok} agree, ${bad} differ, ${skipped} skipped`);
})();
