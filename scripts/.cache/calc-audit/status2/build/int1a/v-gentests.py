# Integration 1a, gen-tests.ts: the compare.ts conventions of v-compare3.py and v-compare4.py in the generated rows: the
# share of a confusion self-hit Disguise took is its own skip fact ("Hurts itself in confusion; Disguise takes the hit."),
# the rest keeps its range; a target that ate a Ganlon, Apicot, Starf or Lansat Berry between two hits fixes the hit's kind
# only (the realized sums against the calculations met, as `truncated`).
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apply import apply
G = "scripts/.cache/calc-audit/2v2/verify/gen-tests.ts"
apply([
 (G, '''      const dealt = h!.landed > 0 && h!.dmgMax !== null && h!.dmgMax > 0;
      return { slot: target, reached: num(h!.reached), koChance: num(h!.ko), ...(dealt && (h!.truncated ?? 0) > 0 ? { kind: "calculated" } : dealt ? { min: h!.dmgMin, max: h!.dmgMax } : h!.landed === 0 ? { kind: immune ? "no-damage" : "blocked" } : {}) };''',
  '''      const dealt = h!.landed > 0 && h!.dmgMax !== null && h!.dmgMax > 0;
      // status2 (integration 1a): a Berry the target ate between two hits (W's continuation): the kind only, as truncated.
      const ident = { "own-left": "p1a", "own-right": "p1b", "opponent-left": "p2b", "opponent-right": "p2a" }[target as SlotId];
      const between = Object.keys(s!.lines).some((l) => l.startsWith(`|-enditem|${ident}: `) && /\\|(Ganlon|Apicot|Starf|Lansat) Berry\\|\\[eat\\]$/.test(l));
      return { slot: target, reached: num(h!.reached), koChance: num(h!.ko), ...(dealt && ((h!.truncated ?? 0) > 0 || between) ? { kind: "calculated" } : dealt ? { min: h!.dmgMin, max: h!.dmgMax } : h!.landed === 0 ? { kind: immune ? "no-damage" : "blocked" } : {}) };''',
  "hits: a Berry between hits"),
 (G, '''      if (s.selfHit && s.selfHit.mass > 0) effects.push({ slot, on: "skipped", match: `hurts itself in confusion: ${s.selfHit.min === s.selfHit.max ? s.selfHit.min : `${s.selfHit.min}–${s.selfHit.max}`} HP`, chance: num(s.selfHit.mass), flags: "i" });''',
  '''      // status2 (integration 1a): the share Disguise took (activate:disguise with damage:confusion:0) has its own fact, no range.
      const own = s.effects?.[slot] ?? {};
      const disguised = own["activate:disguise"] ? own["damage:confusion:0"] ?? 0 : 0;
      if (s.selfHit && s.selfHit.mass - disguised > 1e-9) effects.push({ slot, on: "skipped", match: `hurts itself in confusion: ${s.selfHit.min === s.selfHit.max ? s.selfHit.min : `${s.selfHit.min}–${s.selfHit.max}`} HP`, chance: num(s.selfHit.mass - disguised), flags: "i" });
      if (disguised > 0) effects.push({ slot, on: "skipped", match: "hurts itself in confusion; disguise takes the hit", chance: num(disguised), flags: "i" });''',
  "skipped: Disguise's self-hit"),
])
