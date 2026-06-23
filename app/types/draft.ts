export type DraftPokemon = {
  name: string;
  points: number;
  tier: number;
};

export type DraftFormat = {
  version: string;
  leagueName: string;
  pokemon: DraftPokemon[];
};

export function pointsToTier(points: number) {
  return 21 - points;
}