"use client";

import { useId } from "react";
import TypeBadge from "@/app/components/TypeBadge";
import { Button } from "@/app/components/ui";
import { movesById, speciesById } from "@/app/lib/battle/catalog";
import type { MoveDamageResult } from "@/app/lib/battle/types";
import { getBuildHealth, previewRemainingHP } from "./hp-preview";
import { formatRange, koChance } from "./result-format";
import type { BattleSide, PreparedMatchup } from "./roster-prep";

type Props = {
  attacker: PreparedMatchup["attacker"];
  defender: PreparedMatchup["defender"];
  selectedMoveId: string | null;
  selectedRow: MoveDamageResult | undefined;
  blockedReason?: string;
  controls: Record<BattleSide | "moves", string>;
  onEdit: (side: BattleSide, target: "pokemon" | "hp") => void;
  onShowMove: () => void;
};

export default function MatchupSummary({ attacker, defender, selectedMoveId, selectedRow, blockedReason, controls, onEdit, onShowMove }: Props) {
  const id = useId();
  const move = selectedMoveId ? movesById.get(selectedMoveId) : undefined;
  const preview = previewRemainingHP(defender.build, blockedReason ? undefined : selectedRow);
  const needsHits = selectedRow?.kind === "needs-context" && Array.isArray(move?.multihit);

  return (
    <section aria-labelledby={`${id}-heading`} className="min-w-0 overflow-hidden rounded-xl border border-line bg-panel shadow-sm">
      <h2 id={`${id}-heading`} className="sr-only">Active Pokémon and HP</h2>
      <div className="grid grid-cols-2 divide-x divide-line">
        {(["attacker", "defender"] as const).map((side) => {
          const slot = side === "attacker" ? attacker : defender;
          const species = speciesById.get(slot.build.speciesId);
          const health = getBuildHealth(slot.build);
          const ownership = slot.role === "own" ? "Your team" : "Opponent's team";
          const fraction = health ? health.current / health.maximum : 0;
          return (
            <div key={slot.key} className="min-w-0 px-3 py-3 sm:px-5">
              <p className="text-xs font-semibold text-muted">{side === "attacker" ? "Attacker" : "Defender"} · {slot.source ? ownership : "Manual"}</p>
              <h3 className="mt-1 wrap-anywhere text-base font-bold leading-snug text-text sm:text-xl">{species?.name ?? "Choose Pokémon"}</h3>
              <p className="mt-1 text-xs text-muted sm:hidden">{species?.types.join(" / ")}</p>
              <div className="mt-1 hidden flex-wrap gap-1 sm:flex">{species?.types.map((type) => <TypeBadge key={type} type={type} />)}</div>
              {health ? (
                <>
                  <p className="mt-2 tabular-nums"><span className="text-2xl font-bold text-text">{health.current}</span><span className="text-sm text-muted"> / {health.maximum} HP</span></p>
                  <div role="meter" aria-label={`${species?.name ?? side} ${side} current HP`} aria-valuemin={0} aria-valuemax={health.maximum} aria-valuenow={health.current} aria-valuetext={`${health.current} of ${health.maximum} HP`} className="mt-1 h-2 overflow-hidden rounded-full bg-panel-hover">
                    <div className={`h-full rounded-full ${fraction > 0.5 ? "bg-success" : fraction > 0.2 ? "bg-warning" : "bg-danger"}`} style={{ width: `${fraction * 100}%` }} />
                  </div>
                </>
              ) : <p className="mt-2 text-sm font-semibold text-danger">Check build settings to show HP</p>}
              <div className="mt-1 flex flex-wrap gap-x-3">
                <button type="button" aria-label={`Change ${side} Pokémon`} aria-controls={controls[side]} onClick={() => onEdit(side, "pokemon")} className="min-h-11 rounded text-xs font-semibold text-accent-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">Change<span className="sr-only sm:not-sr-only"> Pokémon</span></button>
                <button type="button" aria-label={`Edit ${side} HP`} aria-controls={controls[side]} onClick={() => onEdit(side, "hp")} className="min-h-11 rounded text-xs font-semibold text-accent-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">Edit HP</button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="border-t border-line bg-accent-soft px-3 py-3 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div aria-live="polite" aria-atomic="true" className="min-w-0 flex-1">
            {!selectedMoveId ? (
              <p className="text-sm font-medium text-accent-text">Choose a move below to preview damage and HP remaining.</p>
            ) : (
              <>
                <p className="wrap-anywhere text-sm font-bold text-text">{move?.name ?? selectedMoveId}</p>
                {blockedReason ? <p className="mt-1 text-sm text-muted">{blockedReason}</p> : (
                  <>
                    {selectedRow?.kind === "calculated" && <p className="mt-1 text-sm tabular-nums text-text">{formatRange(selectedRow.min, selectedRow.max)} damage · One-use KO: {koChance(selectedRow)}</p>}
                    {preview.status === "ready" ? (
                      <p className="mt-1 text-sm text-text">Defender HP remaining: <strong className="text-lg tabular-nums">{formatRange(preview.min, preview.max)} / {preview.maximum}</strong></p>
                    ) : <p className="mt-1 text-sm text-muted">{preview.reason}</p>}
                  </>
                )}
              </>
            )}
          </div>
          {selectedRow && !blockedReason && <Button size="sm" variant="secondary" aria-controls={controls.moves} onClick={onShowMove}>{needsHits ? "Set hits" : "Show move"}</Button>}
        </div>
        {selectedMoveId && preview.status === "ready" && !blockedReason && <p className="mt-1 text-xs text-muted">Damage-only estimate if it connects. Current HP is unchanged; recoil, healing and later turns are not included.</p>}
      </div>
    </section>
  );
}
