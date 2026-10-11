// status2 wave 1a (Track V1): shared helpers for the new case files (cases-in.ts, cases-cq.ts, cases-t2m.ts, cases-t2e.ts,
// cases-sat.ts, cases-f2.ts, cases-fs.ts, cases-g4.ts, cases-cr.ts). Showdown names; level 50, 31 IVs, Serious nature and
// 0 EVs unless set (Champions: Stat Points, each +1 at level 50).
import type { Case, CaseAction, CaseCarried, CaseMon, Game, SlotId } from "./case-types";

export type Slot = CaseMon & { action: CaseAction };
export const OL: SlotId = "own-left", OR: SlotId = "own-right", PL: SlotId = "opponent-left", PR: SlotId = "opponent-right";
export const mon = (species: string, ability: string, extra: Partial<CaseMon> = {}): CaseMon => ({ species, ability, ...extra });
export const act = (m: CaseMon, move: string | null, target?: SlotId, context?: Record<string, unknown>): Slot =>
  ({ ...m, action: { move, ...(target ? { target } : {}), ...(context ? { context } : {}) } });
export const idle = (m: CaseMon): Slot => act(m, null);
export const slots = (ownLeft: Slot, ownRight: Slot, oppLeft: Slot, oppRight: Slot): Case["slots"] =>
  ({ "own-left": ownLeft, "own-right": ownRight, "opponent-left": oppLeft, "opponent-right": oppRight });
/** A Snorlax (Thick Fat) with Speed EVs (native: +1 Speed per 8 from 4; Champions: the Stat Points). */
export const lax = (spe: number, extra: Partial<CaseMon> = {}): CaseMon => mon("Snorlax", "Thick Fat", { evs: { spe }, ...extra });
/** Speed EVs for a native game, Stat Points for Champions (a fast setter: 252 / 32). */
export const fast = (game: Game, extra: Partial<CaseMon> = {}): Partial<CaseMon> => ({ ...extra, evs: { ...(extra.evs ?? {}), spe: game === "champions" ? 32 : 252 } });
export const carried = (m: CaseMon, c: CaseCarried): CaseMon => ({ ...m, carried: { ...m.carried, ...c } });
/** One case per game: `make(game)` returns the case without its id suffix; the id gets `-<game>`. */
export function perGame(id: string, games: Game[], make: (game: Game) => Omit<Case, "id" | "game">): Case[] {
  return games.map((game) => ({ id: `${id}-${game}`, game, ...make(game) }));
}
