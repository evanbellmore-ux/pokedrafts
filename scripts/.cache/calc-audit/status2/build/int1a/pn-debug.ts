// Integration 1a: Psychic Noise then the target's Recover (SPEC2 §8.4 step 5's live-check item), the turn's steps.
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import { calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
(async () => {
  const rt = await loadBattleRuntime("scarlet_violet");
  for (const ability of [undefined, "sweetveil", "aromaveil"]) {
    const mk = (id: string, moveId: string | null, target: any = null, extra: any = {}) => ({ build: { ...createBuild(id, rt), ...extra }, contexts: {}, charged: false, action: { moveId, target } });
    const input: any = { runtime: rt, field: { ...createConditions(), gameType: "Doubles" }, pokemon: {
      "own-left": mk("espeon", "psychicnoise", "opponent-left"), "own-right": mk("gardevoir", null),
      "opponent-left": mk("alcremie", "recover", null, { currentHP: 80, ...(ability ? { abilityId: ability } : {}) }), "opponent-right": mk("garchomp", null) } };
    const t: any = calculateDoublesTurn(input);
    console.log(`ability ${input.pokemon["opponent-left"].build.abilityId}: ${t.status} ${t.reason ?? ""}`);
    if (t.status === "ready") for (const s of t.steps) console.log(`  ${s.slot} ${s.moveId} facts ${JSON.stringify(s.facts.map((f: any) => f.text))} skipped ${JSON.stringify(s.skipped.map((f: any) => f.text))} hits ${JSON.stringify(s.hits.map((h: any) => [h.slot, h.kind, h.min, h.max, h.change, (h.facts ?? []).map((f: any) => f.text)]))}`);
  }
})();
