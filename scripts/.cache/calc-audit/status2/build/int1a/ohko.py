# Integration 1a, D's uses-to-ko.ts ask 1 with F's calculate.ts row (W1A-D.md "For the integrator" 1; G4-OHK-01/03/05..09,
# RE01b): in the 2v2 turn a one-hit KO move that reaches a target (D's ohkoStep ruled out the immunities) is a fixed hit of
# the target's maximum HP (PS/sim/battle-actions.ts getDamage: `if (move.ohko) return target.maxhp` from generation 4), then
# the Damage events (Focus Sash, Endure, Focus Band, a Substitute, Disguise) as any fixed hit. MoveContext.ohko (set only by
# the turn's contextFor) asks for the row; 1v1 keeps "One-hit KO move: no damage range.".
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apply import apply

OHKO_BRANCH = '''    if (metadata.ohko && context?.ohko) {
      // status2 (2v2 only): a probe at power 1 under a neutral name for the engine result the next use reads; the hit itself is
      // the target's maximum HP (PS/sim/battle-actions.ts getDamage: `if (move.ohko) return target.maxhp`).
      const probe = resolveWith(1, { name: "Fixed-damage probe" as MoveName });
      if (probe.kind) return emptyRow(metadata, probe.kind, probe.reason);
      const run = (target: Pokemon) => calculate(generation, attacker, target, probe.move, makeField(conditions));
      const probed = run(defender);
      trace.result = probed;
      trace.fixedHP = true;
      trace.ohko = true;
      return ohkoDamage(metadata, probed, assumptions, () => {
        const bare = defender.clone();
        bare.ability = "Run Away" as AbilityName;
        return run(bare).range()[1] > 0;
      }, intactFace(metadata.category));
    }
'''

OHKO_FN = '''/**
 * status2 (2v2 only): a one-hit KO move's hit into a target it reaches (doubles-guards.ts ohkoStep took Sturdy, Wonder Guard,
 * the type immunity, Dynamax and the level first): the target's maximum HP, as fixedHPDamage's rows (Focus Sash, Endure, a
 * Substitute, Disguise and Focus Band act on it in the turn's step).
 */
function ohkoDamage(move: ChampionsMove, probe: Result, assumptions: string[], connectsWithoutDefenderAbility: () => boolean, intactFace: string | null): MoveDamageResult {
  const { defender } = probe;
  if (!probe.range()[1]) {
    const type = probe.move.type === move.type ? "" : `${probe.move.type}-type `;
    return { ...zeroDamage(move, MOVE_BLOCKING_ABILITIES.has(defender.ability ?? "") && connectsWithoutDefenderAbility()
      ? `${defender.ability} blocks ${type}${move.name}.` : `${type}${move.name} does not affect the defender's type.`), effectiveType: probe.move.type };
  }
  if (intactFace) return emptyRow(move, "needs-context", intactFace);
  const damage = defender.maxHP();
  const lines = ["One-hit KO move: its damage is the target's maximum HP."];
  if (probe.move.type !== move.type) lines.push(`Effective move type: ${probe.move.type}.`);
  if (defender.hasItem("Focus Band")) lines.push(FOCUS_BAND_NOTE);
  probe.damage = damage;
  return {
    moveId: move.id, effectiveName: move.name, effectiveType: probe.move.type, effectivePower: move.power, effectiveCategory: move.category,
    kind: "calculated", min: damage, max: damage, minPercent: 100, maxPercent: 100,
    rolls: damage, ohkoChance: directKOChance(probe, 1),
    description: `${move.name}: ${damage}–${damage} HP (100.0–100.0% of maximum HP).`,
    assumptions: [...assumptions, ...lines], reason: null, hits: 1, ...survivalEffect(probe, damage),
  };
}

'''

FIXED_FN = "function fixedHPDamage(move: ChampionsMove, probe: Result, assumptions: string[], connectsWithoutDefenderAbility: () => boolean, intactFace: string | null): MoveDamageResult {"
FIXED_BRANCH = '''    if (FIXED_HP_MOVES[metadata.id]) {
      // A neutral name keeps name-keyed engine branches'''

apply([
 ("types.ts",
  "  /** Set only by the 2v2 turn: a two-turn move charged last turn released now (carried.charging): no Power Herb, no pre-hit rise. */\n  released?: true;",
  "  /** Set only by the 2v2 turn: a two-turn move charged last turn released now (carried.charging): no Power Herb, no pre-hit rise. */\n  released?: true;\n"
  "  /** Set only by the 2v2 turn: a one-hit KO move that reaches its target (its damage the target's maximum HP). */\n  ohko?: true;",
  "MoveContext.ohko"),
 ("doubles-turn.ts",
  "  if (!info.transformed && user.vol.locked === id) context.released = true;",
  "  if (!info.transformed && user.vol.locked === id) context.released = true;\n"
  "  // A one-hit KO move's hit: the target's maximum HP (D's ohkoStep took the immunities first; integration 1a).\n"
  "  if (!info.transformed && info.effective.ohko) context.ohko = true;",
  "contextFor: ohko"),
 ("uses-to-ko.ts",
  "  result?: Result; fixedHP?: boolean; engine?: { attacker: Pokemon; defender: Pokemon; move: Move; conditions: BattleConditions };",
  "  result?: Result; fixedHP?: boolean; engine?: { attacker: Pokemon; defender: Pokemon; move: Move; conditions: BattleConditions };\n"
  "  /** status2 (2v2 only, with fixedHP): a one-hit KO move's hit, the target's maximum HP (calculate.ts ohkoDamage). */\n  ohko?: true;",
  "CalcTrace.ohko"),
 ("uses-to-ko.ts",
  "    const fixedDamage = endeavor ? endeavorDamage(targetHP, state) : Math.max(1, Math.floor(Math.ceil(targetHP * state.def.baseMaxHP / state.def.maxHP) / 2));",
  "    const fixedDamage = run.trace.ohko ? state.def.maxHP : endeavor ? endeavorDamage(targetHP, state) : Math.max(1, Math.floor(Math.ceil(targetHP * state.def.baseMaxHP / state.def.maxHP) / 2));",
  "turnCases: OHKO"),
 ("uses-to-ko.ts",
  "              const damage = endeavor ? endeavorDamage(hp, state) : Math.max(1, Math.floor(Math.ceil(hp * state.def.baseMaxHP / maxHP) / 2));",
  "              const damage = run.trace.ohko ? maxHP : endeavor ? endeavorDamage(hp, state) : Math.max(1, Math.floor(Math.ceil(hp * state.def.baseMaxHP / maxHP) / 2));",
  "turn rows: OHKO"),
 ("uses-to-ko.ts",
  "                  let damage = endeavor ? endeavorDamage(hp, state) : fixed ? Math.max(1, Math.floor(Math.ceil(hp * state.def.baseMaxHP / maxHP) / 2)) : values[roll];",
  "                  let damage = endeavor ? endeavorDamage(hp, state) : fixed ? (run.trace.ohko ? maxHP : Math.max(1, Math.floor(Math.ceil(hp * state.def.baseMaxHP / maxHP) / 2))) : values[roll];",
  "hits: OHKO"),
 ("uses-to-ko.ts",
  "                  let rolled = endeavor ? endeavorDamage(hp, state) : fixed ? Math.max(1, Math.floor(Math.ceil(hp * state.def.baseMaxHP / maxHP) / 2)) : values[roll];",
  "                  let rolled = endeavor ? endeavorDamage(hp, state) : fixed ? (run.trace.ohko ? maxHP : Math.max(1, Math.floor(Math.ceil(hp * state.def.baseMaxHP / maxHP) / 2))) : values[roll];",
  "extended hits: OHKO"),
 ("calculate.ts",
  '  if (metadata.ohko) return emptyRow(metadata, "unsupported", "One-hit KO move: no damage range.");',
  "  // status2 (2v2 only, MoveContext.ohko): the turn's hit of a one-hit KO move is calculated (ohkoDamage below).\n"
  '  if (metadata.ohko && !context?.ohko) return emptyRow(metadata, "unsupported", "One-hit KO move: no damage range.");',
  "calculate: OHKO in the turn"),
 ("calculate.ts", FIXED_BRANCH, OHKO_BRANCH + FIXED_BRANCH, "calculate: the OHKO branch"),
 ("calculate.ts", FIXED_FN, OHKO_FN + FIXED_FN, "calculate: ohkoDamage"),
])
# The zero-power check lets the turn's OHKO through (its power is 0 in the dex).
apply([("calculate.ts",
  "  if (metadata.power === 0 && !ZERO_POWER_IMPLEMENTED.has(metadata.id) && !FIXED_HP_MOVES[metadata.id] && !(beatUp && !resolved.transformed)) {",
  "  if (metadata.power === 0 && !ZERO_POWER_IMPLEMENTED.has(metadata.id) && !FIXED_HP_MOVES[metadata.id] && !(metadata.ohko && context?.ohko) && !(beatUp && !resolved.transformed)) {",
  "calculate: OHKO's zero power")])
