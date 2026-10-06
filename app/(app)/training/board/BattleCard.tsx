import { useId } from "react";
import TypeBadge from "@/app/components/TypeBadge";
import { SLOT_POSITION, type DoublesSlotId } from "@/app/lib/battle/doubles-types";
import type { PokemonView } from "../model/view-types";
import { pointsText } from "../setup/team-export";
import { boostLabel, boostText, capitalize, hpFraction, hpText, hpTone, hpValueText, itemText, statusLabel } from "./board-format";

// One active Pokémon as you can see it: yours exactly; the AI's per "You see" and what the battle showed (BoardView).

const TONE_CLASS = { success: "bg-success", warning: "bg-warning", danger: "bg-danger" } as const;

/** Your pending move can aim at this Pokémon: the card frame picks it (the Target radios stay for the keyboard). */
export type CardTarget = {
  /** The active slot's move can be aimed here; clicking the frame picks it. */
  eligible: boolean;
  selected: boolean;
  /** "Target Blastoise (left foe) with Garchomp's Dragon Claw". */
  label: string;
  /** "Target of Garchomp's Dragon Claw", one per of your moves aimed here. */
  chips: string[];
  onPick(): void;
};

export function abilityText(mon: PokemonView) {
  return mon.ability ? `Ability: ${mon.ability.name}` : "Ability: not shown";
}

export default function BattleCard({ mon, slot, target }: { mon: PokemonView | null; slot: DoublesSlotId; target?: CardTarget | null }) {
  const id = useId();
  const position = capitalize(SLOT_POSITION[slot]);
  if (!mon) {
    return (
      <article data-training-card={slot} aria-label={`${position}: empty`} className="min-w-0 p-2 sm:p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{position}</p>
        <p className="mt-1 text-sm text-muted">Empty</p>
      </article>
    );
  }
  const tone = hpTone(mon.hp);
  const fraction = mon.fainted ? 0 : hpFraction(mon.hp);
  const boosts = boostText(mon.boosts);
  const facts = [mon.status ? statusLabel(mon.status) : null, ...mon.volatiles].filter((fact): fact is string => !!fact);
  const maximum = mon.hp.kind === "exact" ? mon.hp.maximum : 100;
  const value = mon.fainted ? 0 : mon.hp.kind === "exact" ? mon.hp.current : mon.hp.percent;
  const spread = mon.points ? pointsText(mon.points) : null;
  const pickable = !!target?.eligible && !mon.fainted;
  const frame = pickable ? (target!.selected ? "bg-accent-soft outline-2 -outline-offset-4 outline-accent" : "outline-2 outline-dashed -outline-offset-4 outline-accent hover:bg-panel-hover")
    : target?.chips.length ? "bg-accent-soft/60" : "";
  return (
    <article data-training-card={slot} data-training-card-target={pickable ? (target!.selected ? "selected" : "eligible") : undefined} aria-labelledby={`${id}-name`}
      className={`relative min-w-0 p-2 sm:p-3 ${frame}`}>
      {/* The whole frame is the click target; the card's own content sits above it and lets clicks through, except Set. */}
      {pickable && (
        <button type="button" data-training-card-pick={slot} aria-label={target!.label} aria-pressed={target!.selected} onClick={target!.onPick}
          className="absolute inset-0 z-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus" />
      )}
      <div className={pickable ? "pointer-events-none relative z-10" : undefined}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{position}</p>
      <div className="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 id={`${id}-name`} className="min-w-0 wrap-anywhere font-semibold text-text">{mon.name}<span className="sr-only"> ({SLOT_POSITION[slot]})</span></h3>
        {mon.mega && <span className="rounded border border-accent-border px-1.5 text-xs font-semibold text-accent-text">Mega</span>}
      </div>
      {!!target?.chips.length && <p data-training-card-chips className="mt-0.5 wrap-anywhere text-xs font-semibold text-accent-text">{target.chips.join(" · ")}</p>}
      <p className="text-xs text-muted sm:hidden">{mon.types.join(" / ")}</p>
      <div className="mt-1 hidden flex-wrap gap-1 sm:flex">{mon.types.map((type) => <TypeBadge key={type} type={type} />)}</div>
      {mon.fainted ? (
        <p data-training-fainted className="mt-1 text-sm font-semibold text-danger">Fainted</p>
      ) : (
        <p className="mt-1 tabular-nums text-sm text-text">{hpText(mon.hp)}</p>
      )}
      <div role="meter" aria-label={`${mon.name} (${SLOT_POSITION[slot]}) HP`} aria-valuemin={0} aria-valuemax={maximum} aria-valuenow={value}
        aria-valuetext={mon.fainted ? "Fainted" : hpValueText(mon.hp)} className="mt-1 h-2 overflow-hidden rounded-full bg-panel-hover">
        <div className={`h-full rounded-full ${TONE_CLASS[tone]}`} style={{ width: `${fraction * 100}%` }} />
      </div>
      {!mon.fainted && !!facts.length && <p className="mt-1 wrap-anywhere text-xs text-text">{facts.join(" · ")}</p>}
      {!mon.fainted && boosts && <p className="mt-1 wrap-anywhere text-xs text-text" aria-label={boostLabel(mon.boosts)}>{boosts}</p>}
      <p className="mt-1 wrap-anywhere text-xs text-muted">{itemText(mon.item)}</p>
      <details className="pointer-events-auto mt-1 text-xs">
        <summary className="min-h-11 cursor-pointer rounded py-2 font-semibold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">Set</summary>
        <ul className="space-y-0.5 text-muted">
          <li className="wrap-anywhere">{abilityText(mon)}</li>
          {mon.nature && <li>{mon.nature}</li>}
          {spread !== null && <li className="wrap-anywhere">SPs: {spread || "0"}</li>}
          {mon.moves.map((move) => (
            <li key={move.id} className="flex justify-between gap-2"><span className="min-w-0 wrap-anywhere text-text">{move.name}</span>{typeof move.pp === "number" && <span className="shrink-0 tabular-nums">{move.pp}/{move.maxpp ?? move.pp}</span>}</li>
          ))}
          {!!mon.unseenMoves && <li>{mon.unseenMoves} move{mon.unseenMoves === 1 ? "" : "s"} not shown</li>}
        </ul>
      </details>
      </div>
    </article>
  );
}
