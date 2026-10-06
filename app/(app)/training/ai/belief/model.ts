// SPEC 10.1 BeliefModel: priors at team preview (addendum A1.4: usage first), updates from the AI's own channel only, worlds.
// It reads AiInputs and the sheet alone (SPEC 10.1.4): never the player's choice, the real battle or hidden durations.
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild } from "@/app/lib/battle/types";
import type { AiInputs, BeliefWorld } from "../../model/ai-inputs";
import type { AIRandom } from "../../model/decision";
import type { InfoView } from "../../model/info";
import type { OrderObservation, TurnObservations } from "../../model/public-state";
import type { SheetMember, SheetView } from "../../model/sheet";
import { buildFromCandidate, buildFromSet, otherSide, outOfBattleForm, pointsKey, pointsText, toId } from "../battle-facts";
import { abilityPrior } from "./abilities";
import { itemPrior } from "./items";
import type { DamageMemo } from "./likelihood";
import { believedMoves } from "./moves";
import { spreadPrior } from "./prior";
import type { Belief, BeliefModel, SetCandidate } from "./types";
import {
  applyAbility, applyDamage, applyEntry, applyItem, applyItemClause, applyOrder, candidateId, memberOf, normaliseCandidates, prune,
  revealedItem, type LikelihoodBudget, type MemberState,
} from "./update";
import { usageSource, type UsageOptions, type UsageSource } from "./usage";
import { BROUGHT, beliefWorlds, revealedMembers } from "./worlds";

export type BeliefOptions = UsageOptions;

const toLog = (weight: number) => Math.log(Math.max(weight, 1e-300));

export function createBeliefModel(info: InfoView, options: BeliefOptions = { usage: null }): BeliefModel {
  let sheet: readonly SheetMember[] = [];
  let members: MemberState[] = [];
  let bring: Record<string, number> = {};
  let seenTurns = 0;
  let lastTurn = -Infinity;
  let skipped = 0;
  let side = "p1";
  let runtimeRef: BattleRuntime | null = null;
  let lastMoves = new Map<string, string[]>();
  const memo: DamageMemo = new Map();
  const sources = new Map<string, UsageSource>();

  /** The member's usage rows, narrowed to the ones its known item allows (a stone: that Mega row; another item: the base row). */
  const sourceOf = (member: SheetMember, item: string | null, runtime: BattleRuntime): UsageSource => {
    let source = sources.get(member.speciesId);
    if (!source) sources.set(member.speciesId, source = usageSource(member.speciesId, options, runtime));
    if (item === null) return source;
    const rows = source.rows.filter((row) => row.stone === (runtime.itemsById.get(item)?.megaStone ? item : null));
    if (!rows.length) return source;
    const total = rows.reduce((sum, row) => sum + row.share, 0);
    return { ...source, rows: rows.map((row) => ({ ...row, share: row.share / total })) };
  };
  const sheetHasTrickRoom = () => sheet.some((member) => (member.moves ?? []).includes("trickroom"));
  const movesOf = (state: MemberState, runtime: BattleRuntime) => believedMoves(sheetOf(state.key), state.seenMoves, sourceOf(sheetOf(state.key), state.hard.item, runtime), runtime);
  const sheetOf = (key: string) => sheet.find((member) => member.key === key)!;
  const takenBy = (state: MemberState) => new Set(members.filter((other) => other.key !== state.key && other.hard.item).map((other) => other.hard.item!).filter(Boolean));

  /** SPEC 10.1.1 joint candidates: spread × item × ability, weight the product, the CANDIDATES_KEPT heaviest. */
  function priorCandidates(state: MemberState, runtime: BattleRuntime): SetCandidate[] {
    const member = sheetOf(state.key);
    const source = sourceOf(member, state.hard.item, runtime);
    const moves = believedMoves(member, state.seenMoves, source, runtime);
    const spreads = spreadPrior(member, moves, sheetHasTrickRoom(), source, runtime);
    const form = outOfBattleForm(member.speciesId, runtime);
    const items = state.hard.item !== null ? [{ id: state.hard.item, weight: 1 }]
      : form.stone ? [{ id: form.stone, weight: 1 }]
      : itemPrior(member, moves, source, takenBy(state), runtime).filter((item) => !(state.hard.notChoice && runtime.itemsById.get(item.id)?.name.startsWith("Choice")));
    const abilities = state.hard.ability !== null ? [{ id: state.hard.ability, weight: 1 }] : abilityPrior(member, source, runtime);
    const out: SetCandidate[] = [];
    for (const spread of spreads) for (const item of items.length ? items : [{ id: "", weight: 1 }]) for (const ability of abilities) {
      const candidate = { archetype: spread.source, points: spread.points, nature: spread.nature, itemId: item.id, abilityId: ability.id, logWeight: toLog(spread.weight * item.weight * ability.weight) };
      out.push({ ...candidate, id: candidateId(candidate) });
    }
    return normaliseCandidates(out);
  }

  function start(view: SheetView, runtime: BattleRuntime) {
    runtimeRef = runtime;
    sheet = view.members;
    members = sheet.map((member) => ({
      key: member.key, speciesId: member.speciesId, publicKey: `${side}:${member.key}`, candidates: [], seenMoves: [], itemGone: false,
      hard: { item: member.itemId, ability: member.abilityId, notChoice: false, megaTurn: null },
    }));
    for (const state of members) state.candidates = priorCandidates(state, runtime);
    lastMoves = new Map(members.map((state) => [state.key, movesOf(state, runtime)]));
    bring = Object.fromEntries(sheet.map((member) => [member.key, Math.min(BROUGHT, sheet.length) / Math.max(1, sheet.length)]));
    seenTurns = 0;
    lastTurn = -Infinity;
    skipped = 0;
  }

  const stateOf = (key: string | null) => key === null ? null : members.find((member) => member.key === key) ?? null;
  const itemFallback = (state: MemberState, taken: ReadonlySet<string>, runtime: BattleRuntime) => {
    const member = sheetOf(state.key);
    const source = sourceOf(member, null, runtime);
    return itemPrior(member, movesOf(state, runtime), source, taken, runtime)[0]?.id ?? "";
  };

  /** Hard facts the public state shows (idempotent): items held or gone, announced or copied abilities, Mega forms, moves used. */
  function hardFacts(inputs: AiInputs, runtime: BattleRuntime) {
    for (const [publicKey, mon] of Object.entries(inputs.public.mons)) {
      const state = stateOf(memberOf(publicKey, side));
      if (!state) continue;
      const species = runtime.speciesById.get(state.speciesId);
      // Shown Mega with no record of when: it Mega Evolved in an earlier turn (Mega Evolution starts a turn).
      if (mon.mega && state.hard.megaTurn === null) state.hard.megaTurn = Math.max(0, inputs.public.turn - 1);
      if (mon.mega) {
        const stone = runtime.speciesById.get(mon.speciesId)?.requiredItem ?? null;
        if (stone && state.hard.item !== stone) applyItem(state, stone);
      }
      if (mon.item.state !== "not-shown" && state.hard.item === null && !mon.transformedInto) applyItem(state, toId(mon.item.itemId));
      if (mon.item.state === "gone") state.itemGone = true;
      if (mon.ability && state.hard.ability === null && !mon.transformedInto) {
        const id = toId(mon.ability.abilityId);
        if (mon.ability.how === "copied" && species?.abilities.includes("trace")) applyAbility(state, "trace");
        else if (mon.ability.how === "announced" && species?.abilities.includes(id) && !mon.mega) applyAbility(state, id);
      }
      for (const moveId of Object.keys(mon.movesUsed)) if (!state.seenMoves.includes(moveId)) state.seenMoves.push(moveId);
    }
  }

  function applyRecord(record: TurnObservations, inputs: AiInputs, runtime: BattleRuntime, budget: LikelihoodBudget) {
    for (const reveal of record.reveals) {
      const state = stateOf(memberOf(reveal.key, side));
      if (!state) continue;
      if (reveal.kind === "mega") state.hard.megaTurn = Math.min(state.hard.megaTurn ?? Infinity, record.turn);
      const item = revealedItem(reveal, state.speciesId, runtime);
      if (item !== null && (state.hard.item === null || reveal.kind === "mega")) applyItem(state, item);
      if (reveal.kind === "item-gone") state.itemGone = true;
      if (reveal.kind === "not-choice" && !state.hard.notChoice) {
        state.hard.notChoice = true;
        const choice = (candidate: SetCandidate) => !!runtime.itemsById.get(candidate.itemId)?.name.startsWith("Choice");
        if (state.hard.item === null && state.candidates.some(choice)) {
          const replacement = itemFallback(state, new Set([...takenBy(state), "choicescarf"]), runtime);
          state.candidates = normaliseCandidates(state.candidates.some((candidate) => !choice(candidate))
            ? state.candidates.filter((candidate) => !choice(candidate))
            : state.candidates.slice(0, 8).map((candidate) => { const next = { ...candidate, itemId: replacement }; return { ...next, id: candidateId(next) }; }));
        }
      }
      if (reveal.kind === "ability" && state.hard.ability === null) {
        const id = toId(reveal.id);
        if (runtime.speciesById.get(state.speciesId)?.abilities.includes(id)) applyAbility(state, id);
      }
      if (reveal.kind === "move" && !state.seenMoves.includes(toId(reveal.id))) state.seenMoves.push(toId(reveal.id));
    }
    applyItemClause(members, (state, taken) => itemFallback(state, taken, runtime));
    if (!info.open.abilities) {
      for (const entry of record.entries) {
        const state = stateOf(memberOf(entry.key, side));
        if (state && state.hard.ability === null) applyEntry(state, entry);
      }
    }
    const own = new Map(inputs.own.map((each) => [`${inputs.perspective}:${each.key}`, each.set]));
    const formNow = (publicKey: string) => inputs.public.mons[publicKey]?.speciesId ?? "";
    const aiBuild = (publicKey: string, form?: string) => {
      const set = own.get(publicKey);
      return set ? buildFromSet(set, runtime, form ?? formNow(publicKey)) : null;
    };
    const needsSpread = !info.open.statPoints || !info.open.natures || !info.open.items || !info.open.abilities;
    if (!needsSpread) return;
    for (const order of record.order) applyOrderRecord(order, record.turn, aiBuild, formNow, runtime, budget);
    for (const damage of record.damage) {
      const attacker = stateOf(memberOf(damage.attacker.key, side));
      const defender = stateOf(memberOf(damage.defender.key, side));
      if ((attacker === null) === (defender === null)) continue;
      const ai = aiBuild(attacker ? damage.defender.key : damage.attacker.key, attacker ? damage.defender.speciesId : damage.attacker.speciesId);
      if (!ai) continue;
      applyDamage((attacker ?? defender)!, damage, record.turn, !!attacker, ai, runtime, budget, memo);
    }
  }

  function applyOrderRecord(order: OrderObservation, turn: number, aiBuild: (key: string) => BattleBuild | null, formNow: (key: string) => string, runtime: BattleRuntime, budget: LikelihoodBudget) {
    const first = stateOf(memberOf(order.first.key, side));
    const second = stateOf(memberOf(order.second.key, side));
    if ((first === null) === (second === null)) return;
    const player = (first ?? second)!;
    const ai = aiBuild(first ? order.second.key : order.first.key);
    if (!ai) return;
    applyOrder(player, order, turn, !!first, ai, formNow(player.publicKey), runtime, budget);
  }

  function updateBring(inputs: AiInputs) {
    const { revealed } = revealedMembers(inputs);
    const size = Math.min(BROUGHT, sheet.length);
    if (inputs.reveals.brought) {
      const known = new Set(inputs.reveals.brought);
      bring = Object.fromEntries(sheet.map((member) => [member.key, known.has(member.key) ? 1 : 0]));
      return;
    }
    const left = Math.max(0, size - [...revealed].filter((key) => bring[key] !== undefined).length);
    const others = sheet.filter((member) => !revealed.has(member.key));
    const total = others.reduce((sum, member) => sum + (bring[member.key] ?? 0), 0);
    bring = Object.fromEntries(sheet.map((member) => [member.key, revealed.has(member.key) ? 1
      : total > 0 ? Math.min(1, (bring[member.key] ?? 0) * left / total) : left / Math.max(1, others.length)]));
  }

  const posterior = (candidates: readonly SetCandidate[]) => {
    const best = Math.max(...candidates.map((candidate) => candidate.logWeight));
    const masses = candidates.map((candidate) => Math.exp(candidate.logWeight - best));
    const total = masses.reduce((sum, mass) => sum + mass, 0);
    return masses.map((mass) => mass / total);
  };

  return {
    start(view, runtime) {
      start(view, runtime);
    },
    mapBuilds(runtime) {
      return Object.fromEntries(members.map((state) => [state.key, buildFromCandidate(state.speciesId, state.candidates[0], runtime)]));
    },
    setBring(next) {
      const size = Math.min(BROUGHT, sheet.length);
      const total = sheet.reduce((sum, member) => sum + Math.max(0, next[member.key] ?? 0), 0);
      bring = Object.fromEntries(sheet.map((member) => [member.key, total > 0 ? Math.min(1, Math.max(0, next[member.key] ?? 0) * size / total) : size / Math.max(1, sheet.length)]));
    },
    observe(inputs, runtime) {
      runtimeRef = runtime;
      side = otherSide(inputs.perspective);
      if (!members.length || members.some((state) => !state.publicKey.startsWith(`${side}:`))) {
        const keepBring = bring;
        start(inputs.sheet, runtime);
        if (Object.keys(keepBring).length) bring = { ...bring, ...keepBring };
      }
      // Each record carries its own reveals, applied before its likelihoods; the public state's facts come after, for
      // anything no record showed (they never undo a record's).
      const budget: LikelihoodBudget = { used: new Map(), skipped: 0 };
      for (const record of inputs.observations) {
        if (record.turn <= lastTurn) continue;
        budget.used.clear();
        applyRecord(record, inputs, runtime, budget);
        lastTurn = record.turn;
        seenTurns++;
      }
      skipped += budget.skipped;
      hardFacts(inputs, runtime);
      applyItemClause(members, (state, taken) => itemFallback(state, taken, runtime));
      for (const state of members) state.candidates = prune(state.candidates);
      lastMoves = new Map(members.map((state) => [state.key, movesOf(state, runtime)]));
      updateBring(inputs);
    },
    worlds(k, inputs, random: AIRandom, seedBase): BeliefWorld[] {
      if (!runtimeRef) throw new Error("The belief has no team sheet yet.");
      return beliefWorlds({ members, sheet, moves: Object.fromEntries(lastMoves), bring, inputs, k, random, seedBase, runtime: runtimeRef });
    },
    assumed(inputs, runtime) {
      if (info.open.statPoints) return [];
      const { actives } = revealedMembers(inputs);
      return actives.map((key) => stateOf(key)).filter((state): state is MemberState => !!state && !inputs.public.mons[state.publicKey]?.fainted).map((state) => {
        const masses = posterior(state.candidates);
        const spreads = new Map<string, { points: SetCandidate["points"]; nature: string; mass: number }>();
        state.candidates.forEach((candidate, index) => {
          const key = `${pointsKey(candidate.points)}|${candidate.nature}`;
          const known = spreads.get(key);
          if (known) known.mass += masses[index]; else spreads.set(key, { points: candidate.points, nature: candidate.nature, mass: masses[index] });
        });
        const best = [...spreads.values()].sort((a, b) => b.mass - a.mass)[0];
        const name = runtime.speciesById.get(state.speciesId)?.name ?? state.speciesId;
        return `${name}: ${pointsText(best.points)} · ${best.nature} (${Math.round(best.mass * 100)}%)`;
      });
    },
    snapshot(): Belief {
      return {
        members: Object.fromEntries(members.map((state) => [state.key, {
          key: state.key, speciesId: state.speciesId, candidates: state.candidates.map((candidate) => ({ ...candidate, points: { ...candidate.points } })),
          moves: [...(lastMoves.get(state.key) ?? state.seenMoves)], itemGone: state.itemGone,
        }])),
        bring: { ...bring }, seenTurns, skippedObservations: skipped,
      };
    },
  };
}
