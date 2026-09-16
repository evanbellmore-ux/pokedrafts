"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeftRight, RotateCcw } from "lucide-react";
import { Alert, Button, EmptyState, PageHeader } from "@/app/components/ui";
import { champions, speciesById } from "@/app/lib/battle/catalog";
import { createBuild, createConditions, getBuildStats, validateBuild, validateConditions } from "@/app/lib/battle/model";
import type { BattleBuild, MoveContext } from "@/app/lib/battle/types";
import { linkClassName } from "@/app/lib/theme";
import BattleConditions from "./BattleConditions";
import MoveResults from "./MoveResults";
import PokemonPanel from "./PokemonPanel";

type CalculateMatchup = typeof import("@/app/lib/battle/calculate").calculateMatchup;
type EngineState =
  | { status: "loading" }
  | { status: "ready"; calculate: CalculateMatchup }
  | { status: "error"; message: string };

export function createMatchup(revision = 0) {
  return {
    revision,
    attacker: { key: revision * 2, build: createBuild("charizard") },
    defender: { key: revision * 2 + 1, build: createBuild("blastoise") },
    field: createConditions(),
    contexts: {} as Record<string, MoveContext>,
  };
}

export function swapMatchup(current: ReturnType<typeof createMatchup>) {
  return {
    ...current,
    attacker: current.defender,
    defender: current.attacker,
    field: { ...current.field, attackerSide: current.field.defenderSide, defenderSide: current.field.attackerSide },
    contexts: {},
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "An unexpected calculator error occurred.";
}

export default function CalculatorClient() {
  const [matchup, setMatchup] = useState(() => createMatchup());
  const [engine, setEngine] = useState<EngineState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState("");
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

  function updateBuild(side: "attacker" | "defender", build: BattleBuild) {
    setMatchup((current) => ({
      ...current,
      [side]: { ...current[side], build },
      contexts: current[side].build.speciesId === build.speciesId ? current.contexts : {},
    }));
  }

  function swap() {
    setMatchup(swapMatchup);
    setNotice("Attacker and defender swapped with their side conditions. Shared field settings are unchanged; move hit counts cleared.");
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
            <Button variant="secondary" onClick={() => { setMatchup((current) => createMatchup(current.revision + 1)); setNotice("Reset to Charizard versus Blastoise, full HP, zero Stat Points and stages, and the default Doubles field."); }}><RotateCcw className="h-4 w-4" aria-hidden="true" />Reset</Button>
          </>
        }
      />
      <p role="status" className="sr-only">{notice}</p>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {/* Keys travel with builds so raw numeric edits also survive a Swap. */}
        <PokemonPanel key={matchup.attacker.key} side="attacker" build={attacker} issues={issues.attacker} onChange={(build) => updateBuild("attacker", build)} />
        <PokemonPanel key={matchup.defender.key} side="defender" build={defender} issues={issues.defender} onChange={(build) => updateBuild("defender", build)} />
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
