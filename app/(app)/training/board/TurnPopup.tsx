import type { TurnStep } from "../model/view-types";
import { ANNOUNCE_MS, popupOf } from "./playback";
import styles from "./board.module.css";

/**
 * A playback step's popup, floating over the board above every other element: a move's name in large letters in its type
 * colour ("Blizzard" in Ice), its user underneath when the cards do not show it; a switch, a Mega Evolution or the end of
 * turn as a sentence. The live region reads the step, so the popup is hidden from assistive technology.
 */
export default function TurnPopup({ step, actorName }: { step: TurnStep; actorName: string | null }) {
  const popup = popupOf(step, actorName);
  const o = popup.outline;
  return (
    <div data-training-popup={step.kind} aria-hidden="true" className={styles.popup}
      style={{ borderColor: popup.move ? popup.colour : undefined, animationDuration: `${ANNOUNCE_MS}ms` }}>
      <p data-training-popup-title className={popup.move ? styles.popupMove : styles.popupSentence}
        style={{ color: popup.colour, textShadow: `0 0 2px ${o}, 1px 1px 0 ${o}, -1px -1px 0 ${o}, 1px -1px 0 ${o}, -1px 1px 0 ${o}, 0 3px 12px rgb(0 0 0 / 0.5)` }}>
        {popup.title}
      </p>
      {popup.sub && <p data-training-popup-sub className={styles.popupSub}>{popup.sub}</p>}
    </div>
  );
}
