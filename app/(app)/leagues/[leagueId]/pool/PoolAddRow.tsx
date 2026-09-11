"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import PokemonSprite from "@/app/components/PokemonSprite";
import PokemonTypes from "@/app/components/PokemonTypes";
import { Button, Field, Input, NumberInput } from "@/app/components/ui";
import { LEAGUE_LIMITS } from "@/app/types/league";
import { POOL_NAME_MAX } from "./poolEditing";

export type PoolAddRowProps = {
  /** Returns a problem to show, or null once the row was added. */
  onAdd: (name: string, points: number) => string | null;
  disabled?: boolean;
};

const PREVIEW_DELAY_MS = 350;

/**
 * Adds one Pokémon to the pool being edited. The sprite preview follows
 * the name after a short pause so partial names do not hit the sprite
 * sources on every keystroke.
 */
export default function PoolAddRow({ onAdd, disabled = false }: PoolAddRowProps) {
  const [name, setName] = useState("");
  const [points, setPoints] = useState<number | null>(10);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState("");

  useEffect(() => {
    const trimmed = name.trim();
    const timer = window.setTimeout(() => setPreview(trimmed), PREVIEW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [name]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;

    const clean = name.trim();
    if (!clean) {
      setError("Enter a Pokémon name.");
      return;
    }
    if (points === null) {
      setError(
        `Points are whole numbers from ${LEAGUE_LIMITS.poolPoints.min} to ${LEAGUE_LIMITS.poolPoints.max}.`
      );
      return;
    }

    const problem = onAdd(clean, points);
    if (problem) {
      setError(problem);
      return;
    }

    setError(null);
    setName("");
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-labelledby="add-pokemon-heading"
      className="rounded-xl border border-line bg-panel p-4"
    >
      <h3 id="add-pokemon-heading" className="text-sm font-semibold text-text">
        Add a Pokémon
      </h3>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="flex shrink-0 flex-col items-center gap-1 pt-6">
            {preview ? (
              <>
                <PokemonSprite name={preview} />
                <PokemonTypes name={preview} />
              </>
            ) : (
              <div aria-hidden="true" className="h-10 w-10 rounded-md bg-panel-hover" />
            )}
          </div>
          <Field label="Name" error={error} className="min-w-0 flex-1">
            <Input
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (error) setError(null);
              }}
              maxLength={POOL_NAME_MAX}
              autoComplete="off"
              spellCheck={false}
              disabled={disabled}
              placeholder="e.g. Garchomp"
            />
          </Field>
        </div>
        <Field label="Points" className="sm:w-28">
          <NumberInput
            value={points}
            onValueChange={setPoints}
            min={LEAGUE_LIMITS.poolPoints.min}
            max={LEAGUE_LIMITS.poolPoints.max}
            disabled={disabled}
          />
        </Field>
        <div className="sm:pt-7">
          <Button type="submit" variant="secondary" disabled={disabled}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add
          </Button>
        </div>
      </div>
    </form>
  );
}
