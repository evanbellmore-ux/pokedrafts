// VAL's oracle (SPEC §14.3, I10): the real battle's public facts, normalized as a seat's tracker should hold them, and the
// comparison with a tracker's PublicState. Only validation scripts read the real battle this way (boundary test).
import type { Battle } from "@pokedrafts/showdown-sim";
import type { PublicState } from "@/app/(app)/training/model/public-state";
import type { SideID } from "@/app/(app)/training/model/showdown-types";
import type { MemberKeys } from "@/app/(app)/training/sim/choices";

/** SPEC 9.6: the volatiles the board and MonView show (single-turn ones are gone at a decision). */
export const PUBLIC_VOLATILES: ReadonlySet<string> = new Set([
  "substitute", "confusion", "taunt", "encore", "disable", "torment", "leechseed", "yawn", "perishsong", "partiallytrapped",
  "magnetrise", "telekinesis", "smackdown", "saltcure", "tarshot", "focusenergy", "laserfocus", "charge", "stockpile",
]);
const BOOSTS = ["atk", "def", "spa", "spd", "spe", "accuracy", "evasion"] as const;

export type MonFacts = {
  key: string; species: string; position: number | null; fainted: boolean; status: string;
  /** The viewer's own: "hp/max"; the other side's: "percent" (and the colour when the line carries one). */
  hp: string;
  boosts: string; volatiles: string;
};
export type PublicFacts = {
  mons: Record<string, MonFacts>;
  sides: Record<SideID, string>;
  field: { weather: string; terrain: string; rooms: string };
};

const sortedIds = (ids: Iterable<string>) => [...new Set(ids)].sort().join(",");
const boostText = (boosts: Readonly<Record<string, number>>) => BOOSTS.map((stat) => `${stat}${boosts[stat] ?? 0}`).join(" ");

/** The public facts of `battle` as `viewer`'s channel shows them (members that have been active only). */
export function oracleFacts(battle: Battle, viewer: SideID, keys: MemberKeys): PublicFacts {
  const mons: Record<string, MonFacts> = {};
  for (const side of battle.sides) {
    for (const pokemon of side.pokemon) {
      if (pokemon.previouslySwitchedIn <= 0 && !pokemon.isActive) continue;
      const key = `${side.id}:${keys.keyOf(side.id, pokemon.name)}`;
      const health = pokemon.getHealth();
      const shown = side.id === viewer ? health.secret : health.shared;
      const [fraction] = shown.split(" ");
      const hp = pokemon.fainted || pokemon.hp <= 0 ? "0" : side.id === viewer ? fraction : fraction.replace(/\/100[gyr]?$/, "");
      mons[key] = {
        key, species: pokemon.species.id, position: pokemon.isActive ? pokemon.position : null,
        fainted: pokemon.fainted || pokemon.hp <= 0, status: pokemon.fainted ? "" : pokemon.status, hp,
        boosts: pokemon.isActive && !pokemon.fainted ? boostText(pokemon.boosts) : boostText({}),
        volatiles: pokemon.isActive && !pokemon.fainted ? sortedIds(Object.keys(pokemon.volatiles).filter((id) => PUBLIC_VOLATILES.has(id))) : "",
      };
    }
  }
  const sides = {} as Record<SideID, string>;
  for (const side of battle.sides) {
    sides[side.id] = Object.entries(side.sideConditions).map(([id, state]) => `${id}${typeof state.layers === "number" && state.layers > 1 ? `x${state.layers}` : ""}`).sort().join(",");
  }
  return {
    mons, sides,
    field: { weather: battle.field.weather, terrain: battle.field.terrain, rooms: sortedIds(Object.keys(battle.field.pseudoWeather)) },
  };
}

/** The same facts from a seat's tracker. */
export function trackerFacts(state: PublicState): PublicFacts {
  const mons: Record<string, MonFacts> = {};
  for (const mon of Object.values(state.mons)) {
    if (mon.switchIns <= 0 && mon.position === null) continue;
    const own = mon.side === state.viewer;
    const hp = mon.fainted ? "0" : own ? (mon.exact ? `${mon.exact.hp}/${mon.exact.maxhp}` : "?") : `${mon.hp.percent}`;
    mons[mon.key] = {
      key: mon.key, species: mon.speciesId, position: mon.fainted ? null : mon.position, fainted: mon.fainted, status: mon.fainted ? "" : mon.status, hp,
      boosts: mon.position !== null && !mon.fainted ? boostText(mon.boosts) : boostText({}),
      volatiles: mon.position !== null && !mon.fainted ? sortedIds(mon.volatiles.map((volatile) => volatile.id).filter((id) => PUBLIC_VOLATILES.has(id))) : "",
    };
  }
  const sides = {} as Record<SideID, string>;
  for (const side of ["p1", "p2"] as const) {
    sides[side] = state.sides[side].conditions.map((condition) => `${condition.id}${condition.layers > 1 ? `x${condition.layers}` : ""}`).sort().join(",");
  }
  return {
    mons, sides,
    field: { weather: state.field.weather?.id ?? "", terrain: state.field.terrain?.id ?? "", rooms: sortedIds(state.field.rooms.map((room) => room.id)) },
  };
}

/** Every differing fact, as "path: tracker ≠ oracle" (empty when equal). */
export function compareFacts(tracker: PublicFacts, oracle: PublicFacts): string[] {
  const out: string[] = [];
  const keys = new Set([...Object.keys(tracker.mons), ...Object.keys(oracle.mons)]);
  for (const key of [...keys].sort()) {
    const a = tracker.mons[key], b = oracle.mons[key];
    if (!a || !b) { out.push(`${key}: ${a ? "tracked" : "missing"} ≠ ${b ? "revealed" : "not revealed"}`); continue; }
    for (const field of ["species", "position", "fainted", "status", "hp", "boosts", "volatiles"] as const) {
      if (a[field] !== b[field]) out.push(`${key}.${field}: ${String(a[field])} ≠ ${String(b[field])}`);
    }
  }
  for (const side of ["p1", "p2"] as const) if (tracker.sides[side] !== oracle.sides[side]) out.push(`${side}.conditions: ${tracker.sides[side]} ≠ ${oracle.sides[side]}`);
  for (const field of ["weather", "terrain", "rooms"] as const) if (tracker.field[field] !== oracle.field[field]) out.push(`field.${field}: ${tracker.field[field]} ≠ ${oracle.field[field]}`);
  return out;
}

/**
 * VAL's one accessor of a host's real battle outside the runner (SPEC I10: VAL's oracles): conformance reads its public
 * facts and true sets, the leak tests change it (HP, dice) to prove the AI never reads it.
 */
export function realBattle(host: { readonly battle: Battle }): Battle {
  return host.battle;
}
