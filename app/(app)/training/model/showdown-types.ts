// Structural mirror of the pinned Showdown shapes the page and the AI read (PS/sim/side.ts:64-164; sim/global-types.ts PokemonSet).
// The vendored package's index.d.ts must stay assignable to these (SIM-1 type test). Types only.
export type SideID = "p1" | "p2";
export type StatId = "hp" | "atk" | "def" | "spa" | "spd" | "spe";
export type BoostId = "atk" | "def" | "spa" | "spd" | "spe" | "accuracy" | "evasion";

export type ShowdownSet = {
  name: string; species: string; item: string; ability: string; moves: string[]; nature: string;
  /** Always fixed: an empty gender is rolled from the battle PRNG at construction (spec/belief-battle-probe.mjs). */
  gender: "M" | "F" | "N";
  evs: Record<StatId, number>; ivs: Record<StatId, number>; level: number;
};
export type ShowdownMoveData = { move: string; id: string; pp?: number; maxpp?: number; target?: string; disabled?: string | boolean };
export type ShowdownActiveData = {
  moves: ShowdownMoveData[]; trapped?: boolean; maybeTrapped?: boolean; maybeDisabled?: boolean; maybeLocked?: boolean | null;
  canMegaEvo?: boolean; canMegaEvoX?: boolean; canMegaEvoY?: boolean;
};
export type ShowdownSidePokemon = {
  ident: string; details: string; condition: string; active: boolean; stats: Record<Exclude<StatId, "hp">, number>;
  moves: string[]; baseAbility: string; item: string; pokeball?: string; ability?: string; commanding?: boolean; reviving?: boolean;
};
export type ShowdownSideData = { name: string; id: SideID; pokemon: ShowdownSidePokemon[] };
export type ShowdownRequest =
  | { wait: true; side: ShowdownSideData; noCancel?: boolean }
  | { teamPreview: true; maxChosenTeamSize?: number; side: ShowdownSideData; noCancel?: boolean }
  | { forceSwitch: boolean[]; side: ShowdownSideData; noCancel?: boolean }
  | { active: (ShowdownActiveData | null | undefined)[]; side: ShowdownSideData; noCancel?: boolean };
