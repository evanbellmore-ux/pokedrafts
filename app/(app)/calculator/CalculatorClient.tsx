"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeftRight, RotateCcw } from "lucide-react";
import { Alert, Button, EmptyState, PageHeader } from "@/app/components/ui";
import { champions, speciesById } from "@/app/lib/battle/catalog";
import { getBuildStats, validateBuild, validateConditions } from "@/app/lib/battle/model";
import type { BattleBuild } from "@/app/lib/battle/types";
import { linkClassName } from "@/app/lib/theme";
import BattleConditions from "./BattleConditions";
import MoveResults from "./MoveResults";
import PokemonPanel from "./PokemonPanel";
import LeagueMatchupPicker, { RosterPicker } from "./LeagueMatchupPicker";
import useCalculatorRosters from "./useCalculatorRosters";
import type { CalculatorRosterState } from "./roster-data";
import { createMatchup, reconcileRosters, resetMatchup, selectRosterPokemon, swapMatchup, updateMatchupBuild, type BattleSide, type RosterChoice } from "./roster-prep";

export { createMatchup, swapMatchup };

type CalculateMatchup = typeof import("@/app/lib/battle/calculate").calculateMatchup;
type EngineState =
  | { status: "loading" }
  | { status: "ready"; calculate: CalculateMatchup }
  | { status: "error"; message: string };

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "An unexpected calculator error occurred.";
}

export default function CalculatorClient() {
  const [matchup, setMatchup] = useState(() => createMatchup());
  const [engine, setEngine] = useState<EngineState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const receiveRosters = useCallback((state: CalculatorRosterState) => {
    setMatchup((current) => reconcileRosters(current, state));
  }, []);
  const rosters = useCalculatorRosters(receiveRosters);
  const attacker = matchup.attacker.build;
  const defender = matchup.defender.build;

  useEffect(() => {
    let current = true;
    import("@/app/lib/battle/calculate").then(
      ({ calculateMatchup }) => { if (current) setEngine({ status: "ready", calculate: calculateMatchup }); },
      (error: unknown) => { if (current) setEngine({ status: "error", message: errorMessage(error) }); },
    );
    return () => { current = false; };
  }, [attempt]);

  const calculation = useMemo(() => {
    if (engine.status !== "ready") return null;
    try {
      return { result: engine.calculate(attacker, defender, matchup.field, matchup.contexts), error: null };
    } catch (error) {
      return { result: null, error: errorMessage(error) };
    }
  }, [engine, attacker, defender, matchup.field, matchup.contexts]);

  const issues = calculation?.result?.issues ?? {
    attacker: validateBuild(attacker),
    defender: validateBuild(defender),
    field: validateConditions(matchup.field),
  };
  const invalid = issues.attacker.length > 0 || issues.defender.length > 0 || issues.field.length > 0;
  const attackerSpecies = speciesById.get(attacker.speciesId);
  const defenderSpecies = speciesById.get(defender.speciesId);
  const maxHP = getBuildStats(defender)?.hp ?? null;
  const currentHP = defender.currentHP === null ? maxHP : Number.isFinite(defender.currentHP) ? defender.currentHP : null;

  function retry() {
    setEngine({ status: "loading" });
    setAttempt((value) => value + 1);
  }

  function updateBuild(side: BattleSide, build: BattleBuild) {
    setMatchup((current) => updateMatchupBuild(current, side, build));
  }

  function chooseRosterPokemon(side: BattleSide, choice: RosterChoice) {
    setMatchup((current) => selectRosterPokemon(current, side, choice));
  }

  function swap() {
    setMatchup(swapMatchup);
  }

  let feedback: ReactNode;
  if (engine.status === "loading") {
    feedback = <Alert variant="info" title="Loading the Champions engine">You can edit builds while the calculator loads. Calculations run locally once loaded.</Alert>;
  } else if (engine.status === "error" || calculation?.error) {
    feedback = (
      <Alert variant="error" title="Calculator unavailable">
        <p>{engine.status === "error" ? engine.message : calculation?.error}</p>
        <Button variant="secondary" size="sm" className="mt-3" onClick={retry}>Retry calculator</Button>
      </Alert>
    );
  } else if (invalid) {
    feedback = (
      <div>
        <p role="status" className="sr-only">Results paused. Check the highlighted build or field settings.</p>
        <EmptyState title="Check the highlighted settings" description="Invalid or unsupported builds cannot produce damage results. Resolve the messages in the Pokémon panels or field conditions first." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Pokémon Champions · Level 50"
        title="Damage Calculator"
        description="Compare the attacker’s source-listed moves against one defender. Edit either build to recalculate locally; no team or regulation legality is implied."
        actions={
          <>
            <Button variant="secondary" onClick={swap}><ArrowLeftRight className="h-4 w-4" aria-hidden="true" />Swap</Button>
            <Button variant="secondary" onClick={() => setMatchup(resetMatchup)}><RotateCcw className="h-4 w-4" aria-hidden="true" />Reset</Button>
          </>
        }
      />
      <p role="status" className="sr-only">{matchup.notice}</p>
      <LeagueMatchupPicker state={rosters.state} onLeagueChange={rosters.selectLeague} onOpponentChange={rosters.selectOpponent} onRefresh={rosters.refresh} />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {/* Keys travel with builds so raw numeric edits also survive a Swap. */}
        {(["attacker", "defender"] as const).map((side) => {
          const slot = matchup[side];
          const ownership = slot.role === "own" ? "Your team" : "Opponent's team";
          return (
            <PokemonPanel
              key={slot.key}
              side={side}
              build={slot.build}
              issues={issues[side]}
              editorRevision={slot.editorRevision}
              provenance={slot.source ? `${ownership} · ${slot.source.name}` : undefined}
              onChange={(build) => updateBuild(side, build)}
              roster={<RosterPicker state={rosters.state} role={slot.role} side={side} activeSource={slot.source} onSelect={(choice) => chooseRosterPokemon(side, choice)} />}
            />
          );
        })}
      </div>
      <BattleConditions value={matchup.field} issues={issues.field} onChange={(field) => setMatchup((current) => ({ ...current, field }))} />
      <MoveResults
        key={matchup.revision}
        rows={invalid ? [] : calculation?.result?.results ?? []}
        contexts={matchup.contexts}
        onContextChange={(moveId, context) => setMatchup((current) => ({ ...current, contexts: { ...current.contexts, [moveId]: context } }))}
        sourceMoveCount={attackerSpecies?.moves.length ?? 0}
        abilityId={attacker.abilityId}
        itemId={attacker.itemId}
        attackerName={attackerSpecies?.name ?? "Attacker"}
        defenderName={defenderSpecies?.name ?? "Defender"}
        defenderHP={currentHP}
        feedback={feedback}
      />
      <details className="rounded-xl border border-line bg-panel">
        <summary className="cursor-pointer rounded-xl px-4 py-4 text-sm font-semibold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus sm:px-5">Coverage and v1 assumptions</summary>
        <div className="space-y-4 px-4 pb-4 text-sm text-muted sm:px-5 sm:pb-5">
          <p>Catalog snapshot: {champions.coverage.species} Pokémon/forms and {champions.coverage.moves} moves. {champions.coverage.unsupportedSpecies} Pokémon/forms and {champions.coverage.unsupportedMoves} moves have source or engine data gaps. Further mechanics limitations are reported on builds and individual moves.</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>Source availability is not a regulation or team-legality check. Unsupported catalog entries remain selectable and explain why they cannot be calculated.</li>
            <li>Champions only, fixed level 50. Stats use Stat Points and nature; displayed training stats do not include in-battle stages, abilities or items.</li>
            <li>Select a Mega form directly to supply its required stone. This does not simulate transformation timing.</li>
            <li>Weather and terrain must be set explicitly. Conditional ability switches apply only the named condition; do not manually apply the same entry-stage change twice.</li>
            <li>One move use only. Variable multihit moves need an explicit hit count unless Skill Link fixes it; fixed multihit moves are handled automatically. State-dependent mechanics without supported context are not reported as zero damage.</li>
            <li>KO chances, when available, are conditional on hitting and use the selected current HP. Move details retain the engine’s roll groups and assumptions, without guessed future-turn chances.</li>
          </ul>
          <div className="space-y-2 text-xs">
            <p>Engine revision: <a href={champions.sources.engine.url} target="_blank" rel="noreferrer" className={`${linkClassName} break-all text-accent-text underline`}>{champions.sources.engine.revision}</a></p>
            <p>Champions data revision: <a href={champions.sources.showdown.url} target="_blank" rel="noreferrer" className={`${linkClassName} break-all text-accent-text underline`}>{champions.sources.showdown.revision}</a></p>
          </div>
          <details>
            <summary className="cursor-pointer rounded py-2 font-medium text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">Source coverage notes</summary>
            <ul className="mt-2 list-disc space-y-2 wrap-anywhere pl-5 text-xs">{champions.coverage.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>
          </details>
        </div>
      </details>
    </div>
  );
}
