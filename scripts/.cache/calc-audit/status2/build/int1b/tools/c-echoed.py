# Integration 1b (FC's ask of PR, W1B-FC.md needsFromOthers): Echoed Voice's TryMove adds its pseudo-weather, which with Trick
# Room up uses a held Room Service (sim/field.ts addPseudoWeather: PseudoWeatherChange for a new one only).
from patchlib import rep
W = "doubles-world.ts"
rep(W, """  fieldSet?: Partial<Record<"magicRoom" | "wonderRoom" | "trickRoom" | "gravity" | "mudSport" | "waterSport", true>>;""",
 """  fieldSet?: Partial<Record<"magicRoom" | "wonderRoom" | "trickRoom" | "gravity" | "mudSport" | "waterSport" | "echoedVoice", true>>;""", "fieldSet echoedVoice")
P = "doubles-presence.ts"
rep(P, 'import * as historyNs from "./doubles-history";\n', 'import * as fieldChangeNs from "./doubles-fieldchange";\nimport * as historyNs from "./doubles-history";\n', "import")
rep(P, """export function tryMove(kernel: TurnKernel, w: World, action: PendingAction, move: ChampionsMove, target: DoublesSlotId, priority: number, info: TurnMoveInfo): string | null {
  void target; void priority;
  if (info.transformed) return null;
  const name = kernel.names[action.slot];""", """export function tryMove(kernel: TurnKernel, w: World, action: PendingAction, move: ChampionsMove, target: DoublesSlotId, priority: number, info: TurnMoveInfo): string | null {
  void target; void priority;
  if (info.transformed) return null;
  const name = kernel.names[action.slot];
  // status2 integration 1b (FC's ask): Echoed Voice's onTryMove adds the echoedvoice pseudo-weather (PS/data/moves.ts
  // echoedvoice; sim/field.ts addPseudoWeather runs PseudoWeatherChange for a new one only, none on a restart): new with none
  // from last turn (echoedVoice 0) and none earlier this turn (World.fieldSet, kept only while a Room Service holder is in the
  // turn: the readers rule), when, with Trick Room up, each held Room Service is used (doubles-fieldchange.ts).
  if (move.id === "echoedvoice" && kernel.input.echoedVoice === 0 && !w.fieldSet?.echoedVoice
    && DOUBLES_SLOTS.some((slot) => kernel.input.pokemon[slot]?.build.itemId === "roomservice")) {
    w.fieldSet = { ...w.fieldSet, echoedVoice: true };
    fieldChangeHooks.pseudoWeatherChanged(kernel, w, "echoedvoice", action);
  }""", "Echoed Voice")
rep(P, "const historyHooks = { ...historyNs };", "const historyHooks = { ...historyNs };\nconst fieldChangeHooks = { ...fieldChangeNs };", "hooks object")
