"use client";

import { memo, useMemo, useState } from "react";
import PokemonSprite from "@/app/components/PokemonSprite";
import PokemonTypes from "@/app/components/PokemonTypes";
import {
  Button,
  EmptyState,
  Field,
  Input,
  TableWrap,
  tableClassName,
  tdClassName,
  thClassName,
  theadClassName,
  trClassName,
} from "@/app/components/ui";
import type { DraftPokemon } from "@/app/types/draft";
import { useMinWidthMd } from "../useMinWidthMd";
import {
  PICK_BLOCK_LABELS,
  POOL_ROW_CAP,
  matchesSearch,
  type PickBlock,
} from "./draft-room";
import type { DraftAction } from "./useDraftRoom";

export type DraftPoolProps = {
  /** Undrafted pool entries, best value first. */
  undrafted: DraftPokemon[];
  /** Size of the whole pool, drafted or not. */
  poolSize: number;
  /** Why each undrafted entry is blocked for the viewer (absent = legal). */
  blocks: Map<string, PickBlock>;
  /** Undrafted entries the viewer could draft right now (search-independent). */
  legalCount: number;
  isDrafting: boolean;
  isMyTurn: boolean;
  /** True while the viewer may pick right now (their turn, draft running). */
  canPick: boolean;
  pendingAction: DraftAction | null;
  onPick: (name: string) => void;
  loading: boolean;
  className?: string;
};

/**
 * The undrafted pool: a search box, an "Affordable only" toggle for drafting
 * coaches (on by default while they are on the clock), a table from `md` up
 * and card rows below it. Only one of the two is mounted (`useMinWidthMd`,
 * docs section 8.5), so the capped list of sprite rows is laid out once, not
 * twice; the server and hydration render the cards and the client corrects
 * itself right after. Blocked rows stay visible with the reason beside (or,
 * on phones, under) the name at full text contrast; only the sprite is
 * dimmed, so a coach can still scout what the other teams may take.
 */
const DraftPool = memo(function DraftPool({
  undrafted,
  poolSize,
  blocks,
  legalCount,
  isDrafting,
  isMyTurn,
  canPick,
  pendingAction,
  onPick,
  loading,
  className = "",
}: DraftPoolProps) {
  const isMd = useMinWidthMd();
  const [search, setSearch] = useState("");
  /** null = follow the default (on while it is the viewer's turn). */
  const [affordableOnly, setAffordableOnly] = useState<boolean | null>(null);
  const affordableOn = isDrafting && (affordableOnly ?? isMyTurn);

  const visible = useMemo(() => {
    const matches = undrafted.filter((entry) => matchesSearch(entry.name, search));
    return affordableOn
      ? matches.filter((entry) => !blocks.has(entry.name))
      : matches;
  }, [undrafted, search, affordableOn, blocks]);

  const rows = visible.length > POOL_ROW_CAP ? visible.slice(0, POOL_ROW_CAP) : visible;
  const anyPending = pendingAction !== null;

  function blockFor(entry: DraftPokemon): PickBlock | null {
    return isDrafting ? (blocks.get(entry.name) ?? null) : null;
  }

  /** The Draft button for a legal entry, or null while the viewer cannot pick. */
  function renderDraftButton(entry: DraftPokemon) {
    if (!canPick) return null;
    return (
      <Button
        size="sm"
        pending={pendingAction === `pick:${entry.name}`}
        pendingText="Drafting..."
        disabled={anyPending}
        onClick={() => onPick(entry.name)}
        aria-label={`Draft ${entry.name}`}
      >
        Draft
      </Button>
    );
  }

  /** Blocked rows keep full-contrast text (section 8.6); only the sprite fades. */
  function spriteClass(block: PickBlock | null) {
    return block ? "opacity-60" : "";
  }

  function nameClass(block: PickBlock | null) {
    return block ? "text-muted" : "text-text";
  }

  const summary =
    poolSize === 0
      ? "No draft pool"
      : isDrafting
        ? `${undrafted.length} of ${poolSize} undrafted · ${legalCount} within your budget`
        : `${undrafted.length} of ${poolSize} undrafted`;

  return (
    <section
      aria-labelledby="draft-pool-heading"
      className={`flex flex-col gap-4 ${className}`.trim()}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 id="draft-pool-heading" className="text-lg font-bold text-text">
            Draft pool
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            {summary}
            {visible.length > POOL_ROW_CAP &&
              ` · showing the first ${POOL_ROW_CAP} matches, search to narrow the list`}
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field label="Search Pokémon" hideLabel className="sm:w-64">
            <Input
              type="search"
              name="pool-search"
              autoComplete="off"
              placeholder="Search Pokémon..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </Field>
          {isDrafting && (
            <Button
              variant="secondary"
              aria-pressed={affordableOn}
              onClick={() => setAffordableOnly(!affordableOn)}
              className="aria-pressed:border-accent-border aria-pressed:bg-accent-soft aria-pressed:text-accent-text"
            >
              Affordable only
            </Button>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        !loading && (
          <EmptyState
            title={
              poolSize === 0
                ? "This league has no draft pool"
                : undrafted.length === 0
                  ? "Every Pokémon has been drafted"
                  : affordableOn && search.trim() === ""
                    ? "Nothing in the pool fits your budget"
                    : "No Pokémon match"
            }
            description={
              poolSize === 0
                ? "The commissioner chooses a draft format or a custom pool in Settings."
                : undrafted.length === 0
                  ? "The pool is empty, so remaining turns will be skipped."
                  : affordableOn
                    ? "Turn off \"Affordable only\" to browse the whole pool."
                    : "Try a shorter search."
            }
          />
        )
      ) : isMd ? (
        <TableWrap>
          <table className={tableClassName} aria-label="Undrafted Pokémon">
            <thead className={theadClassName}>
              <tr>
                <th scope="col" className={thClassName}>
                  Pokémon
                </th>
                <th scope="col" className={`${thClassName} text-right`}>
                  Points
                </th>
                <th scope="col" className={`${thClassName} text-right`}>
                  Tier
                </th>
                <th scope="col" className={`${thClassName} text-right`}>
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => {
                const block = blockFor(entry);
                return (
                  <tr key={entry.name} className={trClassName}>
                    <td className={tdClassName}>
                      <div className="flex items-center gap-3">
                        <PokemonSprite name={entry.name} className={spriteClass(block)} />
                        <div className="min-w-0">
                          <p className={`font-semibold ${nameClass(block)}`}>
                            {entry.name}
                          </p>
                          <PokemonTypes name={entry.name} className="mt-1" />
                        </div>
                      </div>
                    </td>
                    <td className={`${tdClassName} text-right tabular-nums text-text`}>
                      {entry.points}
                    </td>
                    <td className={`${tdClassName} text-right tabular-nums text-muted`}>
                      {entry.tier}
                    </td>
                    <td className={`${tdClassName} text-right`}>
                      {block !== null ? (
                        <span className="text-xs text-muted">
                          {PICK_BLOCK_LABELS[block]}
                        </span>
                      ) : (
                        renderDraftButton(entry)
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Undrafted Pokémon">
          {rows.map((entry) => {
            const block = blockFor(entry);
            return (
              <li
                key={entry.name}
                className="flex items-center gap-3 rounded-xl border border-line bg-panel p-3"
              >
                <PokemonSprite name={entry.name} className={spriteClass(block)} />
                <div className="min-w-0 flex-1">
                  <p className={`truncate font-semibold ${nameClass(block)}`}>
                    {entry.name}
                  </p>
                  <PokemonTypes name={entry.name} className="mt-1" />
                  <p className="mt-1 text-xs text-muted">
                    {entry.points} pts · Tier {entry.tier}
                  </p>
                  {block !== null && (
                    <p className="mt-1 text-xs text-muted">{PICK_BLOCK_LABELS[block]}</p>
                  )}
                </div>
                {block === null && canPick && (
                  <div className="shrink-0">{renderDraftButton(entry)}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
});

export default DraftPool;
