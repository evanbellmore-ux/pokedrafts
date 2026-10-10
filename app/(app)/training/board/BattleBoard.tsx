import type { ReactNode, Ref } from "react";
import type { BoardView } from "../model/view-types";
import type { DoublesSlotId } from "@/app/lib/battle/doubles-types";
import BattleCard, { type CardPlay, type CardTarget } from "./BattleCard";
import { boardNameParts } from "./board-format";
import FieldBar from "./FieldBar";
import styles from "./board.module.css";

export type BattleBoardProps = {
  board: BoardView;
  /** The board with its popup layer (BattleScreen scrolls it into view when a turn starts playing). */
  ref?: Ref<HTMLDivElement>;
  /** Your controls under each of your Pokémon; omitted when the battle ended. */
  renderControls?: (slot: "own-left" | "own-right") => ReactNode;
  /** Card frames that pick the target of the move being chosen. */
  cardTarget?: (slot: DoublesSlotId) => CardTarget | null;
  /** A turn playback step on each card (highlight, labels, sliding HP bar). */
  cardPlay?: (slot: DoublesSlotId) => CardPlay | null;
  /** The playback step's popup, floating over the board above every other element. */
  popup?: ReactNode;
  /** In place of your controls while a turn plays (its progress and Skip). */
  playbackBar?: ReactNode;
};

/** The opponent's row on top and yours below, as the game shows them (SPEC D2). */
export default function BattleBoard({ board, ref, renderControls, cardTarget, cardPlay, popup, playbackBar }: BattleBoardProps) {
  // Keyed by the Pokémon: one that comes in gets a fresh card (its HP bar does not slide from the one it replaced).
  // Each card's name: the side word when both teams (or both sides now) show it, the number for two of one name on a side.
  const names = boardNameParts(board);
  const card = (slot: DoublesSlotId) => (
    <BattleCard key={`${slot}:${board.active[slot]?.key ?? ""}`} mon={board.active[slot]} slot={slot} name={names[slot]} target={cardTarget?.(slot)} play={cardPlay?.(slot)} />
  );
  return (
    <div ref={ref} className={styles.boardWrap}>
      <div data-training-board className="min-w-0 overflow-hidden rounded-xl border border-line bg-panel">
        <div role="group" aria-label="Opponent's side" className={styles.side}>
          {card("opponent-left")}
          {card("opponent-right")}
        </div>
        <FieldBar field={board.field} />
        <div role="group" aria-label="Your side" className={styles.own}>
          <div className={styles.left}>{card("own-left")}</div>
          <div className={styles.right}>{card("own-right")}</div>
          {playbackBar && <div className={styles.playback}>{playbackBar}</div>}
          {renderControls && <div data-training-controls="own-left" className={styles.controlsLeft}>{renderControls("own-left")}</div>}
          {renderControls && <div data-training-controls="own-right" className={styles.controlsRight}>{renderControls("own-right")}</div>}
        </div>
      </div>
      {/* Outside the board's clipped frame, so the popup can float over everything around it. */}
      {popup && <div data-training-popup-layer className={styles.popupLayer}>{popup}</div>}
    </div>
  );
}
