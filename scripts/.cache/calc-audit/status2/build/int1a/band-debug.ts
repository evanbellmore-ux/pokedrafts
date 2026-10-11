// Integration 1a: the render's Bullet Seed into a 10 HP Mimikyu with a Focus Band (Disguise intact), the turn's details.
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import { calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
(async () => {
  const rt = await loadBattleRuntime("scarlet_violet");
  for (const [hp, item] of [[10, "focusband"], [10, ""], [100, "focusband"]] as const) {
    const mk = (id: string, moveId: string | null, target: any = null, extra: any = {}) => ({ build: { ...createBuild(id, rt), ...extra }, contexts: {}, charged: false, action: { moveId, target } });
    const input: any = { runtime: rt, field: { ...createConditions(), gameType: "Doubles" }, pokemon: {
      "own-left": mk("hitmonlee", null), "own-right": mk("breloom", "bulletseed", "opponent-right"),
      "opponent-left": mk("snorlax", null), "opponent-right": mk("mimikyu", null, null, { currentHP: hp, itemId: item }) } };
    const t: any = calculateDoublesTurn(input);
    console.log(`hp ${hp} item ${item || "-"}: ${t.status} ${t.reason ?? ""}`);
    if (t.status !== "ready") continue;
    for (const s of t.steps) console.log(`  ${s.slot} ${s.moveId} facts ${JSON.stringify(s.facts.map((f: any) => [f.text, f.chance]))} hits ${JSON.stringify(s.hits.map((h: any) => [h.slot, h.kind, h.min, h.max, h.koChance, (h.facts ?? []).map((f: any) => [f.text, f.chance])]))}`);
    console.log(`  hp`, JSON.stringify(t.hp["opponent-right"]).slice(0, 400));
  }
})();
