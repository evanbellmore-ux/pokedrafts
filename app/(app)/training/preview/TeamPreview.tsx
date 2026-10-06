"use client";

import { useId, useState } from "react";
import PokemonSprite from "@/app/components/PokemonSprite";
import TypeBadge from "@/app/components/TypeBadge";
import { Alert, Button } from "@/app/components/ui";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import { redactSheet, sheetFromTeam } from "../model/sheet";
import type { AIStatus, PlayerChoice, PreviewRequest, TrainingSetup } from "../model/view-types";
import { movesFact, setFacts } from "../setup/TeamMemberRow";
import AIStatusPill from "../board/AIStatusPill";
import OpponentSheet from "./OpponentSheet";
import { BRING, buildTeamOrder, fromTeamOrder, orderLabel, previewSummary, swapLeads, toggleBrought } from "./preview-order";

export type TeamPreviewProps = {
  runtime: BattleRuntime;
  setup: TrainingSetup;
  /** null while the battle starts. */
  request: PreviewRequest | null;
  lastPreview: number[] | null;
  error?: string;
  ai: AIStatus;
  onConfirm(choice: PlayerChoice): void;
};

export default function TeamPreview({ runtime, setup, request, lastPreview, error, ai, onConfirm }: TeamPreviewProps) {
  const id = useId();
  const members = setup.own.members;
  const max = request?.maxChosenTeamSize ?? BRING;
  const [state, setState] = useState<{ requestId: number | null; order: number[] }>({ requestId: request?.id ?? null, order: [] });
  // A new request starts empty; a rejected choice keeps the same request id and so the order (adjust during render).
  if ((request?.id ?? null) !== state.requestId) setState({ requestId: request?.id ?? null, order: [] });
  const order = state.order;
  const setOrder = (next: number[]) => setState({ requestId: request?.id ?? null, order: next });
  const starting = !request;
  const names = members.map((member) => member.name);
  const last = fromTeamOrder(lastPreview, members.length);
  const sheet = redactSheet(sheetFromTeam(setup.opponent), setup.info.youSee);

  return (
    <section data-training-screen="preview" aria-labelledby={`${id}-heading`} className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${id}-heading`} tabIndex={-1} className="rounded text-xl font-semibold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">Team preview</h2>
        <AIStatusPill ai={ai} />
      </div>
      {starting && <p role="status" className="text-sm text-muted">Starting battle…</p>}
      {error && <Alert variant="error" title="Choice not accepted">{error}</Alert>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-text">Bring {max} · {order.length} of {max} chosen</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" className="min-h-11" disabled={starting || order.length < 2} onClick={() => setOrder(swapLeads(order))}>Swap leads</Button>
          {last.length === max && <Button variant="secondary" size="sm" className="min-h-11" disabled={starting} onClick={() => setOrder(last)}>Same as last battle</Button>}
        </div>
      </div>
      <ul className="grid gap-2 lg:grid-cols-2">
        {members.map((member, index) => {
          const species = runtime.speciesById.get(member.speciesId);
          const brought = order.includes(index);
          const full = !brought && order.length >= max;
          const label = orderLabel(order, index);
          return (
            <li key={member.key} data-training-preview-member={index} className="min-w-0">
              <button type="button" aria-pressed={brought} aria-label={`Bring ${member.name}`} aria-describedby={`${id}-place-${index}`}
                disabled={starting || full} onClick={() => setOrder(toggleBrought(order, index, max))}
                className={`flex min-h-11 w-full min-w-0 items-start gap-2 rounded-lg border px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed ${brought ? "border-accent-border bg-accent-soft" : "border-line bg-panel enabled:hover:bg-panel-hover"}`}>
                {species && <span aria-hidden="true" className="shrink-0"><PokemonSprite name={member.spriteName ?? species.name} size="md" /></span>}
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="wrap-anywhere font-semibold text-text">{member.name}</span>
                    <span className="hidden flex-wrap gap-1 sm:flex">{species?.types.map((type) => <TypeBadge key={type} type={type} />)}</span>
                  </span>
                  <span className="mt-0.5 block wrap-anywhere text-xs text-text">{setFacts(member, runtime, null)}</span>
                  <span className="block wrap-anywhere text-xs text-muted">{movesFact(member, runtime, null)}</span>
                </span>
                <span id={`${id}-place-${index}`} className={`shrink-0 text-xs font-semibold ${brought ? "text-accent-text" : "text-muted"}`}>{full ? `${label} · ${max} chosen` : label}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p role="status" className="wrap-anywhere text-sm text-text">{previewSummary(order, names)}</p>
      <Button data-training-confirm className="min-h-11" disabled={starting || order.length !== max} onClick={() => onConfirm({ kind: "team", order: buildTeamOrder(order) })}>Confirm</Button>
      <section aria-labelledby={`${id}-sheet`} className="min-w-0 space-y-2">
        <h3 id={`${id}-sheet`} className="text-base font-semibold text-text">Opponent&apos;s team sheet</h3>
        <OpponentSheet sheet={sheet} runtime={runtime} />
      </section>
    </section>
  );
}
