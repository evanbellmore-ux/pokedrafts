// status2 wave 1b (Track V2): helpers for the 1b case files, beside case-kit.ts. Showdown names; level 50, 31 IVs, Serious
// nature and 0 EVs unless set (Champions: Stat Points, each +1 at level 50).
import type { CaseMon, Game } from "./case-types";
import { lax } from "./case-kit";

/** Speed EVs for +n Speed at level 50 (native: 8 EVs a point; Champions: one Stat Point a point). */
export const pts = (game: Game, n: number) => (game === "champions" ? n : n * 8);
/** A Snorlax (Thick Fat) at Speed 50 + n: the probes' lax(n). */
export const L = (game: Game, n: number, extra: Partial<CaseMon> = {}) => lax(pts(game, n), extra);
/** An EV figure for the game: native as given, Champions in Stat Points (8 EVs a point, at most 32). */
export const ev = (game: Game, n: number) => (game === "champions" ? Math.min(32, Math.round(n / 8)) : n);
export const evs = (game: Game, e: Record<string, number>): CaseMon["evs"] => Object.fromEntries(Object.entries(e).map(([s, n]) => [s, ev(game, n)]));
/** 252 Speed EVs (32 Stat Points). */
export const fastEvs = (game: Game, extra: Record<string, number> = {}): CaseMon["evs"] => evs(game, { ...extra, spe: 252 });
/** No Speed at all (0 EVs and, natively, 0 IVs) with a Speed-lowering nature: the slowest of a species. */
export const slowest = (game: Game): Partial<CaseMon> => ({ nature: "Brave", ...(game === "champions" ? {} : { ivs: { spe: 0 } }) });
