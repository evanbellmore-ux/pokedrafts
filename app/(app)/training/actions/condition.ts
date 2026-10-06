import type { BattleStatus } from "@/app/lib/battle/types";
import { statusLabel } from "../board/board-format";

/** A request Pokémon's condition ("177/177", "88/177 par", "0 fnt") as "177 / 177 HP", "88 / 177 HP · Paralyzed", "Fainted". */
export function conditionText(condition: string) {
  const [hp, status] = condition.trim().split(" ");
  if (status === "fnt" || hp === "0") return "Fainted";
  const match = /^(\d+)\/(\d+)$/.exec(hp ?? "");
  const health = match ? `${match[1]} / ${match[2]} HP` : hp ?? "";
  return status ? `${health} · ${statusLabel(status as BattleStatus)}` : health;
}
