import type { ReactNode } from "react";
import type { BoardView } from "../model/view-types";
import type { DoublesSlotId } from "@/app/lib/battle/doubles-types";
import BattleCard, { type CardTarget } from "./BattleCard";
import FieldBar from "./FieldBar";
import styles from "./board.module.css";

export type BattleBoardProps = {
  board: BoardView;
  /** Your two slots' controls, placed under your cards. */
  renderControls?: (slot: "own-left" | "own-right") => ReactNode;
  /** Card frames that pick the target of the move being chosen. */
  cardTarget?: (slot: DoublesSlotId) => CardTarget | null;
};

/** The opponent's row on top and yours below, as the game shows them (SPEC D2). */
export default function BattleBoard({ board, renderControls, cardTarget }: BattleBoardProps) {
  return (
    <div data-training-board className="min-w-0 overflow-hidden rounded-xl border border-line bg-panel">
      <div role="group" aria-label="Opponent's side" className={styles.side}>
        <BattleCard mon={board.active["opponent-left"]} slot="opponent-left" target={cardTarget?.("opponent-left")} />
        <BattleCard mon={board.active["opponent-right"]} slot="opponent-right" target={cardTarget?.("opponent-right")} />
      </div>
      <FieldBar field={board.field} />
      <div role="group" aria-label="Your side" className={styles.own}>
        <div className={styles.left}><BattleCard mon={board.active["own-left"]} slot="own-left" target={cardTarget?.("own-left")} /></div>
        <div className={styles.right}><BattleCard mon={board.active["own-right"]} slot="own-right" target={cardTarget?.("own-right")} /></div>
        {renderControls && <div data-training-controls="own-left" className={styles.controlsLeft}>{renderControls("own-left")}</div>}
        {renderControls && <div data-training-controls="own-right" className={styles.controlsRight}>{renderControls("own-right")}</div>}
      </div>
    </div>
  );
}
