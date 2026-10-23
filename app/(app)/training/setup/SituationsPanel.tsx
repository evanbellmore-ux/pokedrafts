"use client";

import { useId } from "react";
import { Alert, Button } from "@/app/components/ui";
import {
  ANY_FACT, CUSTOM_HP, LEVEL_LABEL, RANDOM_FACT, requestLabel, SITUATION_BROUGHT, SITUATION_LEVELS, SITUATION_STATS, SPOTS, spotFact, STAT_LABEL,
  type CustomSide, type SituationLevel, type SituationRequest, type SituationStat,
} from "../model/situation";
import { USAGE_SOURCE_FACT } from "../model/usage";
import type { TrainingSnapshot } from "../model/view-types";
import type { TrainingSession } from "../training-session";
import styles from "./setup.module.css";

export type SituationsPanelProps = {
  snapshot: Pick<TrainingSnapshot, "engine" | "situations">;
  session: Pick<TrainingSession, "updateSituations" | "startSituation" | "retryEngine">;
};

/** Looks unavailable while it stays focusable (aria-disabled), as Start battle does. */
const UNAVAILABLE = "aria-disabled:cursor-not-allowed aria-disabled:opacity-60";
const STAGES = Array.from({ length: 13 }, (_, index) => index - 6);
const stageText = (stage: number) => (stage > 0 ? `+${stage}` : stage < 0 ? `−${-stage}` : "±0");
const SIDE_NAME = { own: "Your side", opponent: "AI's side" } as const;
const SHORT_STAT: Readonly<Record<SituationStat, string>> = { atk: "Atk", def: "Def", spa: "SpA", spd: "SpD", spe: "Spe" };

/** Hard | Very hard, for the named, random and fully random situations (a custom one sets its own). */
function LevelSwitch({ level, onChange }: { level: SituationLevel; onChange(level: SituationLevel): void }) {
  return (
    <div role="group" aria-label="Situation difficulty" data-training-situation-level className="inline-grid grid-cols-2 gap-1 rounded-lg border border-line bg-bg/40 p-1">
      {SITUATION_LEVELS.map((entry) => {
        const pressed = entry === level;
        return (
          <button key={entry} type="button" data-training-level={entry} aria-pressed={pressed} onClick={() => onChange(entry)}
            className={`min-h-11 rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${pressed ? "bg-panel-hover text-text shadow-sm" : "text-muted hover:text-text"}`}>
            {LEVEL_LABEL[entry]}
          </button>
        );
      })}
    </div>
  );
}

/** One side of a custom situation: Pokémon left, their HP, and each lead's stat stages. */
function CustomSideFields({ role, side, onChange }: { role: "own" | "opponent"; side: CustomSide; onChange(side: CustomSide): void }) {
  const id = useId();
  const name = SIDE_NAME[role];
  const select = "min-h-11 w-full min-w-0 rounded-lg border border-line bg-panel px-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";
  const leads = side.left >= 2 ? [0, 1] : [0];
  const setStage = (lead: number, stat: SituationStat, stage: number) => {
    const next: CustomSide["leads"] = [{ ...side.leads[0] }, { ...side.leads[1] }];
    if (stage) next[lead][stat] = stage; else delete next[lead][stat];
    onChange({ ...side, leads: next });
  };
  return (
    <fieldset data-training-custom-side={role} className={`${styles.customSide} min-w-0`}>
      <legend className="text-sm font-semibold text-text">{role === "own" ? "You" : "AI"}</legend>
      <div className="grid grid-cols-2 gap-2">
        <label htmlFor={`${id}-left`} className="min-w-0 text-sm text-text">
          <span className="block font-medium">Pokémon left</span>
          <select id={`${id}-left`} value={side.left} className={`${select} mt-1`} aria-label={`${name}: Pokémon left`}
            onChange={(event) => onChange({ ...side, left: Number(event.target.value) })}>
            {Array.from({ length: SITUATION_BROUGHT }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count}</option>)}
          </select>
        </label>
        <label htmlFor={`${id}-hp`} className="min-w-0 text-sm text-text">
          <span className="block font-medium">HP</span>
          <select id={`${id}-hp`} value={side.hp} className={`${select} mt-1`} aria-label={`${name}: HP of each Pokémon left`}
            onChange={(event) => onChange({ ...side, hp: Number(event.target.value) })}>
            {CUSTOM_HP.map((hp) => <option key={hp} value={hp}>{hp}%</option>)}
          </select>
        </label>
      </div>
      {leads.map((lead) => {
        const leadName = side.left === 1 ? "Lead" : lead === 0 ? "Left lead" : "Right lead";
        return (
          <fieldset key={lead} data-training-custom-lead={lead} className="mt-2 min-w-0">
            <legend className="text-sm font-medium text-text">{leadName} stat stages</legend>
            <div className="mt-1 grid grid-cols-5 gap-1">
              {SITUATION_STATS.map((stat) => (
                <label key={stat} className="min-w-0 text-center text-xs text-muted">
                  <span aria-hidden="true">{SHORT_STAT[stat]}</span>
                  <select value={side.leads[lead]?.[stat] ?? 0} aria-label={`${name}: ${leadName.toLowerCase()} ${STAT_LABEL[stat]} stage`}
                    className={`${select} mt-0.5 px-1 tabular-nums`} onChange={(event) => setStage(lead, stat, Number(event.target.value))}>
                    {STAGES.map((stage) => <option key={stage} value={stage}>{stageText(stage)}</option>)}
                  </select>
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}
    </fieldset>
  );
}

/**
 * Situations on Setup: a battle dealt partway through with ready-made teams, started by one press (Random situation, a
 * named situation, Fully random, or the custom one). One status line says what it waits on or deals.
 */
export default function SituationsPanel({ snapshot, session }: SituationsPanelProps) {
  const id = useId();
  const { engine } = snapshot;
  const { settings, deal } = snapshot.situations;
  const { level, custom } = settings;
  const loading = engine.status === "idle" || engine.status === "loading";
  const dealing = deal.status === "dealing";
  const available = engine.status === "ready" && !dealing;
  const start = (request: SituationRequest) => { if (available) session.startSituation(request); };
  const setLevel = (next: SituationLevel) => session.updateSituations((current) => (current.level === next ? current : { ...current, level: next }));
  const setCustom = (role: "own" | "opponent", side: CustomSide) => session.updateSituations((current) => ({ ...current, custom: { ...current.custom, [role]: side } }));
  const status = loading ? "Loading battle rules…" : dealing ? `Dealing ${requestLabel(deal.request)}…` : null;
  const describedBy = `${id}-status`;
  return (
    <section data-training-situations aria-labelledby={`${id}-heading`} className="min-w-0 space-y-4 rounded-xl border border-line bg-panel p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${id}-heading`} data-training-situations-heading tabIndex={-1}
          className="rounded text-lg font-semibold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">Situations</h2>
        <LevelSwitch level={level} onChange={setLevel} />
      </div>
      <p className="text-sm text-muted">A battle already in progress, with ready-made teams: six Pokémon a side from {USAGE_SOURCE_FACT} usage, with their usage sets. No team preview.</p>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button data-training-situation="any" size="lg" className={`min-h-11 ${UNAVAILABLE}`} aria-disabled={!available || undefined}
          aria-describedby={`${id}-any ${describedBy}`} onClick={() => start({ kind: "any", level })}>Random situation</Button>
        <span id={`${id}-any`} className="text-sm text-muted">{ANY_FACT}</span>
      </div>

      <ul aria-label="Named situations" className="divide-y divide-line border-y border-line">
        {SPOTS.map((spot) => (
          <li key={spot.id} className={styles.situationRow}>
            <Button data-training-situation={spot.id} variant="secondary" className={`min-h-11 justify-start ${UNAVAILABLE}`} aria-disabled={!available || undefined}
              aria-describedby={`${id}-${spot.id} ${describedBy}`} onClick={() => start({ kind: "spot", spot: spot.id, level })}>{spot.label}</Button>
            <span id={`${id}-${spot.id}`} className="min-w-0 text-sm text-muted">{spotFact(spot.id, level)}</span>
          </li>
        ))}
        <li className={styles.situationRow}>
          <Button data-training-situation="random" variant="secondary" className={`min-h-11 justify-start ${UNAVAILABLE}`} aria-disabled={!available || undefined}
            aria-describedby={`${id}-random ${describedBy}`} onClick={() => start({ kind: "random", level })}>Fully random</Button>
          <span id={`${id}-random`} className="min-w-0 text-sm text-muted">{RANDOM_FACT}</span>
        </li>
      </ul>

      <section data-training-custom aria-labelledby={`${id}-custom`} className="min-w-0 space-y-3">
        <h3 id={`${id}-custom`} className="text-base font-semibold text-text">Custom situation</h3>
        <p className="text-sm text-muted">Pokémon left, their HP and the leads&apos; stat stages; the teams and who plays are dealt. The first two lead, the rest wait in the back, the others have fainted.</p>
        <div className={styles.customSides}>
          <CustomSideFields role="own" side={custom.own} onChange={(side) => setCustom("own", side)} />
          <CustomSideFields role="opponent" side={custom.opponent} onChange={(side) => setCustom("opponent", side)} />
        </div>
        <Button data-training-situation="custom" className={`min-h-11 ${UNAVAILABLE}`} aria-disabled={!available || undefined} aria-describedby={describedBy}
          onClick={() => start({ kind: "custom", custom })}>Start custom situation</Button>
      </section>

      <div className="space-y-2">
        {engine.status === "error" && (
          <Alert variant="error" title={`Battle rules unavailable: ${engine.message ?? "the battle engine did not load."}`}
            action={<Button variant="secondary" size="sm" className="min-h-11" onClick={() => session.retryEngine()}>Retry</Button>} />
        )}
        {deal.status === "error" && <Alert variant="error" title="Situation not dealt">{deal.message}</Alert>}
        <p id={describedBy} role="status" data-training-situation-status className="text-sm text-muted">{status}</p>
      </div>
    </section>
  );
}
