import type { InfoView } from "./info";
import type { ExactHP, PublicState, TurnObservations } from "./public-state";
import type { SheetView } from "./sheet";
import type { ShowdownRequest, ShowdownSet, SideID } from "./showdown-types";

/** Filled only under a test setting (InfoView.exactHP / .brought); otherwise both null. */
export type TestReveals = {
  exactHP: Record<string, ExactHP> | null;      // by PublicMon key, the other side's brought members
  brought: readonly string[] | null;            // the other side's four SheetMember keys, side order
};
/** Everything the AI decides from. Plain JSON: no Battle, no functions. */
export type AiInputs = {
  perspective: SideID;
  requestId: number;
  /** The AI's own request (pinned Showdown sends a side only its own data). */
  request: ShowdownRequest;
  /** Its six sets, exact; request.side.pokemon gives the brought four and their order. */
  own: readonly { key: string; set: ShowdownSet }[];
  /** The other side's six as `info` allows (redactSheet). */
  sheet: SheetView;
  /** From the AI's own channel. */
  public: PublicState;
  /** One record per resolved turn, oldest first. */
  observations: readonly TurnObservations[];
  reveals: TestReveals;
  info: InfoView;
};
/** The other side switching to a brought member the AI has not seen (one option at most). */
export const UNSEEN_MEMBER = "?unseen";

/** One sample of what the AI does not know about the other side; sim/belief-battle.ts builds a battle from it and AiInputs. */
export type BeliefWorld = {
  weight: number;
  /** The other side's brought four (SheetMember keys): actives by position first, then the bench. Revealed members are always included. */
  brought: readonly string[];
  /** The believed set of each brought member, by SheetMember key (species and gender from the sheet; the rest believed or open). */
  sets: Readonly<Record<string, ShowdownSet>>;
  /** HP inside the shown band: its midpoint (world 0) or a uniform draw. Exact under TestReveals.exactHP. */
  hp: "midpoint" | "sample";
  /** 32 hex digits for the builder's own draws: HP in band, hidden durations, a charging move's target. */
  seed: string;
};
