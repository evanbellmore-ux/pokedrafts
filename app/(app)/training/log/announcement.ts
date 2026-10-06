import { replaceSlots } from "../actions/choice-builder";
import type { LogTurn, TrainingBattle } from "../model/view-types";

/** "Replace Abomasnow (your left)" at the end of a turn; "Switch in for Incineroar (your left)" mid-turn (U-turn, Eject Button). */
export function replaceLegend(label: string, midTurn: boolean) {
  return midTurn ? `Switch in for ${label}` : `Replace ${label}`;
}

// The single live region's text (one sr-only aria-live="polite" region per battle screen) and the plain-text log.

/** The latest turn that has resolved: every turn before the board's current one, or all of them once the battle ended. */
export function resolvedTurns(battle: Pick<TrainingBattle, "log" | "board" | "phase">): LogTurn[] {
  const ended = battle.phase.kind === "ended";
  const current = battle.board?.turn ?? 0;
  return battle.log.filter((turn) => ended || turn.turn < current);
}

export function latestResolved(battle: Pick<TrainingBattle, "log" | "board" | "phase">): LogTurn | null {
  const turns = resolvedTurns(battle).filter((turn) => turn.lines.length > 0 || turn.read);
  return turns.at(-1) ?? null;
}

export function resultHeading(phase: Extract<TrainingBattle["phase"], { kind: "ended" }>) {
  if (phase.forfeited) return "You forfeited";
  return phase.result === "win" ? "You won" : phase.result === "loss" ? "The AI won" : "Tie";
}

function turnTitle(turn: number) {
  return turn === 0 ? "Start" : `Turn ${turn}`;
}

export function announcement(battle: TrainingBattle): string {
  const phase = battle.phase;
  const last = latestResolved(battle);
  const recap = last ? [`${turnTitle(last.turn)}.`, ...last.lines.map((line) => line.text), ...(last.read?.reason ? [`AI's read: ${last.read.reason}`] : [])].join(" ") : "";
  const join = (...parts: string[]) => parts.filter(Boolean).join(" ");
  switch (phase.kind) {
    case "starting": return "Starting battle…";
    case "preview": return phase.error ? `Choice not accepted: ${phase.error}` : "Team preview. Bring 4.";
    case "choose": return phase.error ? `Choice not accepted: ${phase.error}` : join(recap, `Turn ${battle.board?.turn ?? 1}.`);
    case "switch": {
      if (phase.error) return `Choice not accepted: ${phase.error}`;
      const flagged = battle.board ? replaceSlots(phase.request, battle.board).filter((slot) => slot.flagged).map((slot) => replaceLegend(slot.label, phase.request.midTurn)) : [];
      return join(recap, ...flagged.map((text) => `${text}.`));
    }
    case "waiting": return phase.reason === "opponent-switch" ? join(recap, "Opponent choosing a replacement…") : `Simulating turn ${Math.max(1, battle.board?.turn ?? 1)}…`;
    case "ended": return join(recap, `${resultHeading(phase)}.`);
  }
}

/** The whole log as plain text, for Copy log. */
export function logText(log: readonly LogTurn[]): string {
  return log.filter((turn) => turn.lines.length).map((turn) => [turnTitle(turn.turn), ...turn.lines.map((line) => `- ${line.text}`)].join("\n")).join("\n\n");
}
