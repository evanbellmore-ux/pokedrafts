// Everything the AI decides from (SPEC §9.1): its own seat's request, its own sets, your sheet as aiKnows allows, its
// channel's tracker, and the test reveals. No Battle crosses this line except into createTestOracle, which exists only
// when a test extra is on and reads those two facts alone (I10, leak tests).
import type { AiInputs } from "../model/ai-inputs";
import type { InfoView } from "../model/info";
import type { ExactHP, PublicMon, PublicState } from "../model/public-state";
import type { SheetView } from "../model/sheet";
import type { ShowdownRequest, SideID } from "../model/showdown-types";
import { identName, type MemberKeys } from "./choices";
import { teamKeyOf, type AdaptedTeam } from "./showdown-set";
import type { Battle } from "./sim";
import { shownPercent, toID, type PublicTracker } from "./tracker";

export type TestOracle = { exactHP(): Record<string, ExactHP>; brought(): string[] };

/** For the AI on `side`: the other side's brought members (actives by position, then the bench) and their exact HP. */
export function createTestOracle(battle: Battle, side: SideID, info: InfoView, keys: MemberKeys): TestOracle | null {
  if (!info.exactHP && !info.brought) return null;
  const other = side === "p1" ? battle.p2 : battle.p1;
  const keyOf = (name: string) => keys.keyOf(other.id, name);
  return {
    exactHP: () => Object.fromEntries(other.pokemon.map((pokemon) => [`${other.id}:${keyOf(pokemon.name)}`, { hp: pokemon.hp, maxhp: pokemon.maxhp }])),
    brought: () => other.pokemon.map((pokemon) => keyOf(pokemon.name)),
  };
}

const zeroBoosts = (): PublicMon["boosts"] => ({ atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 });

/**
 * The seat's own actives as its request names them. Illusion shows the disguise on every channel, its owner's too
 * (PS/sim/pokemon.ts:530-533, 544-553), so the seat's tracker files a disguised Zoroark under the member it imitates;
 * the request lists the real Pokémon in that position (sim/side.ts getRequestData). The stint's public state moves to
 * the real member and the imitated one goes back to the bench with the request's HP and status.
 */
function ownByRequest(state: PublicState, request: ShowdownRequest, side: SideID, own: AdaptedTeam): PublicState {
  if (!("active" in request) && !("forceSwitch" in request)) return state;
  const keyOf = teamKeyOf(own);
  request.side.pokemon.slice(0, 2).forEach((pokemon, position) => {
    if (!pokemon.active) return;
    const member = keyOf(identName(pokemon.ident));
    if (!member) return;
    const realKey = `${side}:${member}`;
    const shown = Object.values(state.mons).find((mon) => mon.side === side && mon.position === position);
    if (!shown || shown.key === realKey) return;
    const previous = state.mons[realKey];
    state.mons[realKey] = {
      ...shown, key: realKey, speciesId: toID(pokemon.details.split(",")[0]),
      mega: previous?.mega ?? false, item: previous?.item ?? { state: "not-shown" }, ability: previous?.ability ?? null,
      movesUsed: previous?.movesUsed ?? {}, switchIns: Math.max(1, previous?.switchIns ?? 0),
    };
    const imitated = request.side.pokemon.find((each) => keyOf(identName(each.ident)) === shown.key.slice(side.length + 1));
    const condition = imitated?.condition ?? "";
    const fainted = condition.endsWith(" fnt");
    const [hp, maxhp] = (condition.split(" ")[0] ?? "").split("/").map(Number);
    const exact = fainted ? { hp: 0, maxhp: shown.exact?.maxhp ?? 0 } : Number.isFinite(hp) && maxhp > 0 ? { hp, maxhp } : shown.exact;
    state.mons[shown.key] = {
      ...shown, position: null, fainted, exact, hp: exact && exact.maxhp > 0 ? shownPercent(exact.hp, exact.maxhp) : shown.hp,
      status: fainted ? "" : (condition.split(" ")[1] ?? "") as PublicMon["status"], statusElapsed: 0,
      boosts: zeroBoosts(), volatiles: [], lastMove: null, lastMoveTarget: null, lastResult: null, actions: 0, activeTurns: 0,
      protectStreak: 0, lock: null, transformedInto: null, switchIns: Math.max(0, shown.switchIns - 1),
    };
  });
  return state;
}

export function aiInputs(args: {
  side: SideID; requestId: number; request: ShowdownRequest; own: AdaptedTeam; sheet: SheetView;
  tracker: PublicTracker; info: InfoView; oracle: TestOracle | null;
}): AiInputs {
  const { side, requestId, request, own, sheet, tracker, info, oracle } = args;
  const state = ownByRequest(tracker.state(), request, side, own);
  // "Test: exact HP" covers the other side's members this seat has seen; the unseen ones only with "Test: brought
  // Pokémon" too (SPEC 4.1), so exact HP never names the brought four on its own.
  const exactHP = info.exactHP && oracle
    ? Object.fromEntries(Object.entries(oracle.exactHP()).filter(([key]) => info.brought || (state.mons[key]?.switchIns ?? 0) > 0))
    : null;
  return {
    perspective: side,
    requestId,
    request: structuredClone(request),
    own: own.sets.map(({ key, set }) => ({ key, set: structuredClone(set) })),
    sheet: structuredClone(sheet),
    public: state,
    observations: tracker.observations(),
    reveals: {
      exactHP,
      brought: info.brought && oracle ? oracle.brought() : null,
    },
    info: structuredClone(info),
  };
}
