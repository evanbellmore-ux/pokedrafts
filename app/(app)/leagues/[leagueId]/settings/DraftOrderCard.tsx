"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, ListOrdered } from "lucide-react";
import { Alert, Button, StatusPill } from "@/app/components/ui";
import { pluralize, roleLabel, teamNameLabel } from "@/app/lib/league/labels";
import { rpc } from "@/app/lib/rpc";
import type { League } from "@/app/types/league";
import {
  membersKey,
  positionedMembers,
  shuffle,
  spectatorMembers,
  type SettingsMember,
} from "./helpers";

type DraftOrderCardProps = {
  league: League;
  members: SettingsMember[];
  currentUserId: string;
  /** Called after the order was saved; the parent reloads and reports. */
  onSaved: () => Promise<void>;
};

type OrderEntry = { member: SettingsMember; included: boolean };

type MoveDirection = "up" | "down";

/** The move button to focus once the render that applied a move is done. */
type FocusRequest = { memberId: string; direction: MoveDirection };

function moveButtonKey(memberId: string, direction: MoveDirection) {
  return `${memberId}:${direction}`;
}

/** Positioned coaches first (by position), then spectators by team name. */
function initialOrder(members: SettingsMember[]): OrderEntry[] {
  return [
    ...positionedMembers(members).map((member) => ({ member, included: true })),
    ...spectatorMembers(members).map((member) => ({ member, included: false })),
  ];
}

function savedIds(members: SettingsMember[]): string[] {
  return positionedMembers(members).map((member) => member.id);
}

/**
 * Draft order editor for the commissioner (`set_draft_order`): every coach
 * can be moved up or down and included in the draft or left as a spectator.
 * Read-only once the draft has started. The Move up / Move down buttons stay
 * rendered (disabled) at the ends of the list, and focus follows a move:
 * React relocates the moved row's node, which would otherwise drop focus.
 */
export default function DraftOrderCard({
  league,
  members,
  currentUserId,
  onSaved,
}: DraftOrderCardProps) {
  const key = membersKey(members);
  const [seedKey, setSeedKey] = useState(key);
  const [order, setOrder] = useState(() => initialOrder(members));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const moveButtons = useRef(new Map<string, HTMLButtonElement>());
  const focusRequest = useRef<FocusRequest | null>(null);

  // After a move has rendered, put focus back on the button that was pressed
  // (its row moved, so the browser dropped it), or on the sibling button when
  // the row reached an end and that button is disabled now.
  useEffect(() => {
    const request = focusRequest.current;
    if (!request) return;
    focusRequest.current = null;
    const { memberId, direction } = request;
    const pressed = moveButtons.current.get(moveButtonKey(memberId, direction));
    const sibling = moveButtons.current.get(
      moveButtonKey(memberId, direction === "up" ? "down" : "up")
    );
    (pressed && !pressed.disabled ? pressed : sibling)?.focus();
  }, [order]);

  // Start again from the saved order when a coach, position or name changed
  // (own save, a coach joining or leaving), but not on a reload that returns
  // the same rows, so unsaved reordering survives other actions on the page.
  if (seedKey !== key) {
    setSeedKey(key);
    setOrder(initialOrder(members));
    setError(null);
  }

  const locked = Boolean(league.draft_started);
  const includedIds = order.filter((entry) => entry.included).map((entry) => entry.member.id);
  const saved = savedIds(members);
  const dirty =
    includedIds.length !== saved.length ||
    includedIds.some((id, index) => id !== saved[index]);
  const tooFew = includedIds.length < 2;

  function move(index: number, delta: -1 | 1) {
    const entry = order[index];
    const target = index + delta;
    if (!entry || target < 0 || target >= order.length) return;
    focusRequest.current = {
      memberId: entry.member.id,
      direction: delta === -1 ? "up" : "down",
    };
    setOrder((previous) => {
      if (target >= previous.length) return previous;
      const next = [...previous];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function registerMoveButton(memberId: string, direction: MoveDirection) {
    return (node: HTMLButtonElement | null) => {
      const key = moveButtonKey(memberId, direction);
      if (node) moveButtons.current.set(key, node);
      else moveButtons.current.delete(key);
    };
  }

  function setIncluded(memberId: string, included: boolean) {
    setOrder((previous) =>
      previous.map((entry) =>
        entry.member.id === memberId ? { ...entry, included } : entry
      )
    );
  }

  function includeEveryone() {
    setOrder((previous) => previous.map((entry) => ({ ...entry, included: true })));
  }

  function clear() {
    setOrder((previous) => previous.map((entry) => ({ ...entry, included: false })));
  }

  function randomize() {
    setOrder((previous) => shuffle(previous));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || tooFew || !dirty) return;

    setError(null);
    setPending(true);
    const { error: rpcError } = await rpc.setDraftOrder(league.id, includedIds);
    if (rpcError !== null) {
      setError(rpcError);
      setPending(false);
      return;
    }

    await onSaved();
    setPending(false);
  }

  const heading = (
    <div className="flex items-center gap-2">
      <ListOrdered className="h-5 w-5 text-accent-text" aria-hidden="true" />
      <h2 id="draft-order-heading" className="text-lg font-semibold text-text">
        Draft order
      </h2>
    </div>
  );

  if (locked) {
    const drafting = positionedMembers(members);
    const spectators = spectatorMembers(members);
    return (
      <section
        aria-labelledby="draft-order-heading"
        className="rounded-xl border border-line bg-panel p-5"
      >
        {heading}
        <Alert variant="info" className="mt-4">
          The draft order is locked once the draft starts. Reset the draft to
          change it.
        </Alert>
        <ol className="mt-4 flex flex-col gap-2">
          {drafting.map((member, index) => (
            <li
              key={member.id}
              className="flex items-center gap-3 rounded-lg border border-line bg-bg px-3 py-2"
            >
              <span className="w-8 shrink-0 text-center text-sm font-semibold text-accent-text">
                #{index + 1}
              </span>
              <span className="min-w-0 truncate font-semibold text-text">
                {teamNameLabel(member.team_name)}
              </span>
              {member.user_id === currentUserId && <StatusPill tone="accent">You</StatusPill>}
            </li>
          ))}
        </ol>
        {spectators.length > 0 && (
          <p className="mt-3 text-sm text-muted">
            Watching as spectators:{" "}
            {spectators.map((member) => teamNameLabel(member.team_name)).join(", ")}.
          </p>
        )}
      </section>
    );
  }

  // Draft position of each included coach, derived from the current order.
  const positions = new Map<string, number>();
  for (const entry of order) {
    if (entry.included) positions.set(entry.member.id, positions.size + 1);
  }

  return (
    <section
      aria-labelledby="draft-order-heading"
      className="rounded-xl border border-line bg-panel p-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {heading}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={includeEveryone} disabled={pending || order.length === 0}>
            Include everyone
          </Button>
          <Button size="sm" variant="secondary" onClick={randomize} disabled={pending || order.length < 2}>
            Randomize
          </Button>
          <Button size="sm" variant="secondary" onClick={clear} disabled={pending || includedIds.length === 0}>
            Clear
          </Button>
        </div>
      </div>
      <p className="mt-2 text-sm text-muted">
        Position 1 picks first; the order snakes each round. Coaches who are
        not in the draft watch as spectators and do not get a team.
      </p>

      <form onSubmit={handleSubmit} noValidate className="mt-4 flex flex-col gap-4">
        {order.length === 0 ? (
          <p className="text-sm text-muted">No coaches have joined yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {order.map((entry, index) => {
              const { member, included } = entry;
              const teamName = teamNameLabel(member.team_name);
              const label = included ? `#${positions.get(member.id) ?? 0}` : "—";
              return (
                <li
                  key={member.id}
                  className="flex flex-col gap-3 rounded-lg border border-line bg-bg p-3 sm:flex-row sm:items-center"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span
                      aria-hidden="true"
                      className={`w-8 shrink-0 text-center text-sm font-semibold ${included ? "text-accent-text" : "text-faint"}`}
                    >
                      {label}
                    </span>
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate font-semibold text-text">{teamName}</span>
                        {member.user_id === currentUserId && (
                          <StatusPill tone="accent">You</StatusPill>
                        )}
                      </p>
                      <p className="text-xs text-muted">
                        {included ? `Picks ${label}` : "Spectator"} · {roleLabel(member.role)}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                    <label className="flex items-center gap-2 text-sm text-text">
                      <input
                        type="checkbox"
                        checked={included}
                        onChange={(event) => setIncluded(member.id, event.target.checked)}
                        disabled={pending}
                        aria-label={`Include ${teamName} in the draft`}
                        className="h-4 w-4 rounded border-line-strong accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                      />
                      In the draft
                    </label>
                    <Button
                      ref={registerMoveButton(member.id, "up")}
                      size="sm"
                      variant="secondary"
                      onClick={() => move(index, -1)}
                      disabled={pending || index === 0}
                      aria-label={`Move ${teamName} up`}
                    >
                      <ArrowUp className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button
                      ref={registerMoveButton(member.id, "down")}
                      size="sm"
                      variant="secondary"
                      onClick={() => move(index, 1)}
                      disabled={pending || index === order.length - 1}
                      aria-label={`Move ${teamName} down`}
                    >
                      <ArrowDown className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {tooFew && order.length > 0 && (
          <p role="status" className="text-sm text-warning">
            At least two coaches must be in the draft.
          </p>
        )}

        {error && <Alert variant="error">{error}</Alert>}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted">
            {pluralize(includedIds.length, "coach", "coaches")} in the draft
          </p>
          <Button
            type="submit"
            pending={pending}
            pendingText="Saving..."
            disabled={!dirty || tooFew}
          >
            Save draft order
          </Button>
        </div>
      </form>
    </section>
  );
}
