# Integration 1a, compare.ts (S's and W's asks of V1): a confusion self-hit Disguise takes (the oracle's activate:disguise with
# damage:confusion:0) is the skip or loss fact "... hurts itself in confusion; Disguise takes the hit." with no range; and a
# No-move self-hit whose HP delta the oracle caps at the Pokemon's HP (it fainted, or Focus Band left 1) is checked by its
# chance only (the app gives getConfusionDamage's raw range, which the delta cannot show).
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apply import apply
F = "scripts/.cache/calc-audit/2v2/verify/compare.ts"
apply([
 (F, '''function selfHitOf(keys: Record<string, number>) {
  let mass = 0, min = Infinity, max = -Infinity;
  for (const [k, v] of Object.entries(keys)) {
    const m = /^damage:confusion:-(\d+)$/.exec(k);
    if (!m) continue;
    mass += v;
    min = Math.min(min, Number(m[1]));
    max = Math.max(max, Number(m[1]));
  }
  return { mass, min, max };
}''', '''function selfHitOf(keys: Record<string, number>) {
  let mass = 0, min = Infinity, max = -Infinity;
  for (const [k, v] of Object.entries(keys)) {
    const m = /^damage:confusion:-(\d+)$/.exec(k);
    if (!m) continue;
    mass += v;
    min = Math.min(min, Number(m[1]));
    max = Math.max(max, Number(m[1]));
  }
  // status2 (integration 1a, S): a self-hit Disguise takes (damage:confusion:0 beside activate:disguise): no HP lost.
  const disguised = keys["activate:disguise"] ? keys["damage:confusion:0"] ?? 0 : 0;
  return { mass, min, max, disguised };
}
/** The self-hit facts Disguise took (doubles-faces.ts selfHit: "... hurts itself in confusion; Disguise takes the hit."). */
const disguiseSelfHit = (text: string) => /hurts itself in confusion; Disguise takes the hit/i.test(text);''', "selfHitOf: Disguise's self-hit"),
 (F, '''    if (o.selfHit && o.selfHit.mass > 0) {
      const facts = s.skipped.filter((f) => /hurts itself in confusion/i.test(f.text));
      const got = facts.reduce((x, f) => x + f.chance, 0);
      if (!near(got, o.selfHit.mass)) push(slot, "confusion self-hit (skipped)", o.selfHit.mass, got, JSON.stringify(s.skipped));
      else if (!facts.some((f) => f.text.includes(rangeText(o.selfHit!.min, o.selfHit!.max)))) push(slot, "confusion self-hit range", rangeText(o.selfHit.min, o.selfHit.max), facts.map((f) => f.text));''', '''    if (o.selfHit && o.selfHit.mass > 0) {
      const facts = s.skipped.filter((f) => /hurts itself in confusion/i.test(f.text));
      const got = facts.reduce((x, f) => x + f.chance, 0);
      // status2 (integration 1a): the share Disguise took has its own fact and no range.
      const disguised = selfHitOf(o.effects?.[slot] ?? {}).disguised;
      const ranged = facts.filter((f) => !disguiseSelfHit(f.text));
      if (!near(got, o.selfHit.mass)) push(slot, "confusion self-hit (skipped)", o.selfHit.mass, got, JSON.stringify(s.skipped));
      else if (!near(chanceOf(facts, disguiseSelfHit), disguised)) push(slot, "confusion self-hit (Disguise)", disguised, chanceOf(facts, disguiseSelfHit), facts.map((f) => f.text));
      else if (o.selfHit.mass - disguised > 1e-9 && !ranged.some((f) => f.text.includes(rangeText(o.selfHit!.min, o.selfHit!.max)))) push(slot, "confusion self-hit range", rangeText(o.selfHit.min, o.selfHit.max), facts.map((f) => f.text));''', "the step's Disguise self-hit"),
 (F, '''    if (noMove) {
      const selfHit = selfHitOf(noMove);
      const losses = (hp.losses ?? []).filter((f) => /hurts itself in confusion/i.test(f.text));
      const chance = losses.reduce((s, f) => s + f.chance, 0);
      if (selfHit.mass > 0 || chance > 0) {
        if (!near(chance, selfHit.mass)) push(slot, "losses (confusion self-hit)", selfHit.mass, chance, JSON.stringify(hp.losses ?? []));
        else if (selfHit.mass > 0 && !losses.some((f) => f.text.includes(rangeText(selfHit.min, selfHit.max)))) push(slot, "losses (confusion self-hit range)", rangeText(selfHit.min, selfHit.max), losses.map((f) => f.text));
      }
    }''', '''    if (noMove) {
      const selfHit = selfHitOf(noMove);
      const losses = (hp.losses ?? []).filter((f) => /hurts itself in confusion/i.test(f.text));
      const chance = losses.reduce((s, f) => s + f.chance, 0);
      // status2 (integration 1a): Disguise's share (its own fact, no HP lost); a delta the oracle capped at the Pokémon's HP
      // (it fainted, or Focus Band left 1 HP: W) shows no raw range, so only the chance is checked there.
      const all = selfHit.mass + selfHit.disguised;
      const capped = selfHit.mass > 0 && selfHit.max >= hp.start - 1;
      if (all > 0 || chance > 0) {
        if (!near(chance, all)) push(slot, "losses (confusion self-hit)", all, chance, JSON.stringify(hp.losses ?? []));
        else if (!near(chanceOf(losses, disguiseSelfHit), selfHit.disguised)) push(slot, "losses (confusion self-hit, Disguise)", selfHit.disguised, chanceOf(losses, disguiseSelfHit), losses.map((f) => f.text));
        else if (selfHit.mass > 0 && !capped && !losses.some((f) => f.text.includes(rangeText(selfHit.min, selfHit.max)))) push(slot, "losses (confusion self-hit range)", rangeText(selfHit.min, selfHit.max), losses.map((f) => f.text));
      }
    }''', "the No-move Disguise self-hit and a capped delta"),
])
