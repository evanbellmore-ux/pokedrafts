// The AI's view of one decision (SPEC §9.4 "view"): builds read from belief world 0, counts from the public state
// (never the belief battles' redrawn counters), legal options for both sides, and the player's revealed members in every
// world (speed-order particles). Engine orientation: the player is "own", the AI is "opponent".
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild } from "@/app/lib/battle/types";
import { UNSEEN_MEMBER, type AiInputs, type BeliefWorld } from "../model/ai-inputs";
import type { AiRequest, AiView, MonKey, MonView } from "../model/ai-view";
import type { PublicMon } from "../model/public-state";
import type { SideID, ShowdownRequest } from "../model/showdown-types";
import type { BeliefBattle } from "./belief-battle";
import { fieldClock, fieldConditions, liveBuild, monKey, slotOfPokemon } from "./bridge";
import { identName, legalJointActions } from "./choices";
import { createBuild } from "@/app/lib/battle/model";
import type { DoublesSlotId } from "@/app/lib/battle/doubles-types";
import type { Pokemon } from "./sim";

/** MonView.volatiles: the board's whitelist (SPEC 9.6), as public effect ids. */
const VIEW_VOLATILES: ReadonlySet<string> = new Set([
  "substitute", "confusion", "taunt", "encore", "disable", "torment", "leechseed", "yawn", "perishsong", "partiallytrapped",
  "magnetrise", "telekinesis", "smackdown", "saltcure", "tarshot", "focusenergy", "laserfocus", "charge", "stockpile", "protect",
  "followme", "ragepowder",
]);
/** Picked Team Size = Auto: 4 in doubles (PS/sim/dex-formats.ts:336-341). */
const BROUGHT = 4;

export const otherSide = (side: SideID): SideID => (side === "p1" ? "p2" : "p1");

/** The player's members the AI has seen: active now, ever switched in, or fainted (by SheetMember key). */
export function revealedKeys(inputs: AiInputs): Set<string> {
  const other = otherSide(inputs.perspective);
  const out = new Set<string>();
  for (const mon of Object.values(inputs.public.mons)) {
    if (mon.side === other && (mon.position !== null || mon.switchIns > 0 || mon.fainted)) out.add(mon.key.slice(3));
  }
  return out;
}

export function buildOf(pokemon: Pokemon, runtime: BattleRuntime): BattleBuild {
  return liveBuild(pokemon, runtime) ?? createBuild(pokemon.species.id, runtime);
}

export type ObserveArgs = {
  inputs: AiInputs; worlds: readonly BeliefWorld[]; battles: readonly BeliefBattle[]; runtime: BattleRuntime; midTurn: boolean;
};

export function observe({ inputs, worlds, battles, runtime, midTurn }: ObserveArgs): AiView {
  const ai = inputs.perspective;
  const other = otherSide(ai);
  const world0 = battles[0];
  const battle = world0.battle;
  const pub = inputs.public;
  const revealed = revealedKeys(inputs);
  const publicOf = (side: SideID, memberKey: string): PublicMon | undefined => pub.mons[`${side}:${memberKey}`];

  const view = (pokemon: Pokemon, side: SideID): MonView => {
    const memberKey = world0.keys.keyOf(side, pokemon.name);
    const mon = publicOf(side, memberKey);
    const active = pokemon.side.active.includes(pokemon as never);
    const status = pokemon.status;
    return {
      key: monKey(side, ai, memberKey), side: side === ai ? "opponent" : "own", memberKey,
      slot: active ? slotOfPokemon(pokemon, ai) : null,
      revealed: side === ai || revealed.has(memberKey),
      fainted: pokemon.fainted,
      build: buildOf(pokemon, runtime),
      hp: pokemon.hp, maxHp: pokemon.maxhp,
      hpExact: side === ai || !!inputs.reveals.exactHP?.[`${side}:${memberKey}`],
      accuracyStage: pokemon.boosts.accuracy, evasionStage: pokemon.boosts.evasion,
      moves: pokemon.moveSlots.map((slot) => slot.id),
      firstTurn: active && !pokemon.fainted && (mon?.actions ?? 0) === 0,
      protectStreak: mon?.protectStreak ?? 0,
      sleepElapsed: status === "slp" ? mon?.statusElapsed ?? 0 : null,
      freezeElapsed: status === "frz" ? mon?.statusElapsed ?? 0 : null,
      lastMove: mon?.lastMove ?? null,
      volatiles: (mon?.volatiles ?? []).map((each) => each.id).filter((id) => VIEW_VOLATILES.has(id)),
      canMega: !pub.sides[side].megaUsed && !!pokemon.canMegaEvo,
    };
  };
  const mons: MonView[] = [
    ...battle[ai].pokemon.map((pokemon) => view(pokemon, ai)),
    ...battle[other].pokemon.filter((pokemon) => revealed.has(world0.keys.keyOf(other, pokemon.name))).map((pokemon) => view(pokemon, other)),
  ];

  // The player's brought members not seen yet, and which sheet members they can be (share of worlds bringing them).
  const unrevealed = Math.max(0, Math.min(BROUGHT, inputs.sheet.members.length) - revealed.size);
  const candidates = inputs.sheet.members.filter((member) => !revealed.has(member.key)).map((member) => ({
    memberKey: member.key,
    chance: worlds.reduce((sum, world) => sum + (world.brought.includes(member.key) ? world.weight : 0), 0),
  })).filter((each) => each.chance > 0);

  const request: AiRequest = "forceSwitch" in inputs.request
    ? { kind: "switch", forceSwitch: [...inputs.request.forceSwitch], midTurn }
    : { kind: "move", active: "active" in inputs.request ? inputs.request.active.map((each) => each ?? null) : [] };

  const present: Partial<Record<DoublesSlotId, boolean>> = {};
  for (const side of [ai, other]) battle[side].active.forEach((pokemon) => { if (pokemon) present[slotOfPokemon(pokemon, ai)] = !pokemon.fainted; });
  const firstTurn = (side: SideID, request: ShowdownRequest) => request.side.pokemon.slice(0, 2).map((each) => {
    const mon = publicOf(side, world0.keys.keyOf(side, identName(each.ident)));
    return each.active && (mon?.actions ?? 0) === 0;
  });
  const ownRequest = inputs.request;
  // A trap the AI's seat can see (a shown Shadow Tag, Arena Trap or Magnet Pull) is a hidden one in its own request
  // ("maybeTrapped": tryTrap(true) sets trapped "hidden", PS/sim/pokemon.ts:1607-1612, 1118-1130); belief world 0's
  // upkeep ran the same trap events (sim/battle.ts endTurn TrapPokemon), so its trapped flag drops those switches.
  const trappedSlots = new Set(ownRequest.side.pokemon.slice(0, 2).flatMap((each, position) => {
    const pokemon = battle[ai].active[position];
    return "active" in ownRequest && ownRequest.active[position]?.maybeTrapped && pokemon && !pokemon.fainted && pokemon.trapped ? [slotOfPokemon(pokemon, ai)] : [];
  }));
  const allOpponent = legalJointActions({
    side: ai, aiSide: ai, request: ownRequest, keys: world0.keys,
    bench: ownRequest.side.pokemon.map((each) => world0.keys.keyOf(ai, identName(each.ident))),
    firstTurn: firstTurn(ai, ownRequest), megaUsed: pub.sides[ai].megaUsed, present,
  });
  const untrapped = allOpponent.filter((joint) => ![...trappedSlots].some((slot) => joint[slot]?.kind === "switch"));
  const opponent = untrapped.length ? untrapped : allOpponent;
  const playerRequest = battle[other].activeRequest as ShowdownRequest | null;
  let own: AiView["legal"]["own"] = [];
  if (playerRequest && !("wait" in playerRequest) && !("teamPreview" in playerRequest)) {
    const benchKeys = battle[other].pokemon.filter((pokemon) => !pokemon.fainted && !pokemon.isActive).map((pokemon) => world0.keys.keyOf(other, pokemon.name));
    const bench = benchKeys.filter((key) => revealed.has(key));
    if (unrevealed > 0 && benchKeys.some((key) => !revealed.has(key))) bench.push(UNSEEN_MEMBER);
    own = legalJointActions({
      side: other, aiSide: ai, request: playerRequest, keys: world0.keys, bench,
      firstTurn: firstTurn(other, playerRequest), megaUsed: pub.sides[other].megaUsed, present,
    });
  }

  const particles = battles.map((world, index) => {
    const builds: Partial<Record<MonKey, BattleBuild>> = {};
    for (const pokemon of world.battle[other].pokemon) {
      const memberKey = world.keys.keyOf(other, pokemon.name);
      if (revealed.has(memberKey)) builds[monKey(other, ai, memberKey)] = buildOf(pokemon, runtime);
    }
    return { weight: worlds[index]?.weight ?? 1 / battles.length, builds };
  });

  return {
    perspective: ai, turn: pub.turn, requestId: inputs.requestId,
    field: fieldConditions(battle, ai), clock: fieldClock(battle, ai),
    mons, hidden: { unrevealed, candidates },
    megaUsed: { own: pub.sides[other].megaUsed, opponent: pub.sides[ai].megaUsed },
    request, legal: { opponent, own }, particles, history: [],
  };
}
