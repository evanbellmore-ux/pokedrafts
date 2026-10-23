// A battle that begins mid-game (Situations, model/situation.ts): the pinned simulator has no position loader, so the host
// installs two one-shot hooks on its own Battle (only sim/battle-host.ts calls installSituationStart, boundary test: the real
// battle stays behind the host). Before the `start` action (pinned sim/battle.ts runAction case 'start') the brought Pokémon get their HP, status and
// faints silently, so the leads' switch lines carry them as any switch-in does; before the first endTurn (turn 0 → 1) the
// stat stages and Tailwind go in as public lines. Every channel reads the same lines, so both trackers, the log, the board
// and the AI learn the position as a player would have seen it. Replays and Resume re-run the same hooks from the setup.
import type { BoostId, SideID } from "../model/showdown-types";
import { situationIntro, situationProblem, type SituationSide, type TrainingSituation } from "../model/situation";
import type { TrainingSetup } from "../model/view-types";
import type { Battle, Pokemon } from "./sim";

export type StartMember = {
  /** Share of its maximum HP, 1–100; 0: it has fainted (only after every Pokémon still standing). */
  hp: number;
  status?: "brn" | "par" | "psn" | "tox";
  /** Its stat stages once it is in play (a lead), −6 to +6. */
  boosts?: Partial<Record<BoostId, number>>;
};
export type StartSide = {
  /** The brought Pokémon in battle order (the team choice's): leads first, fainted ones last. */
  members: readonly StartMember[];
  /** Tailwind on this side as the battle starts (its full 4 turns). */
  tailwind?: boolean;
};
export type SituationStart = {
  /** The log's first line ("Situation: Down one (Hard). You have 3 Pokémon left, the opponent 4."). */
  intro: string;
  p1: StartSide; p2: StartSide;
};

type Writable = {
  runAction(action: { choice: string }): unknown;
  endTurn(): void;
  add(...parts: unknown[]): void;
  initEffectState(state: Record<string, unknown>): Record<string, unknown>;
  actions: { switchIn(pokemon: Pokemon, pos: number, ...rest: unknown[]): unknown };
  sides: readonly WritableSide[];
};
type WritableSide = {
  id: "p1" | "p2";
  pokemon: WritablePokemon[]; active: (WritablePokemon | null)[];
  pokemonLeft: number; totalFainted: number; faintedThisTurn: WritablePokemon | null;
  addSideCondition(status: string, source: WritablePokemon | "debug" | null): boolean;
};
type WritablePokemon = {
  hp: number; readonly maxhp: number; fainted: boolean; status: string; statusState: Record<string, unknown>;
  boosts: Record<BoostId, number>; switchFlag: boolean | string; readonly isActive: boolean;
};

/**
 * A dealt situation as the host starts it: each side's team preview choice (1-based into its six, in battle order) and the
 * position by that order. Throws on a situation its setup's teams cannot hold (an import file is untrusted).
 */
export function hostSituation(setup: Pick<TrainingSetup, "own" | "opponent"> & { situation: TrainingSituation }): { start: SituationStart; order: Record<SideID, number[]> } {
  const problem = situationProblem(setup.situation, setup);
  if (problem) throw new Error(`The situation cannot start: ${problem}`);
  const sideOf = (dealt: SituationSide, keys: readonly string[]): { order: number[]; start: StartSide } => ({
    order: dealt.members.map((member) => keys.indexOf(member.key) + 1),
    start: {
      members: dealt.members.map((member) => ({ hp: member.hp, ...(member.status ? { status: member.status } : {}), ...(member.boosts ? { boosts: { ...member.boosts } } : {}) })),
      ...(dealt.tailwind ? { tailwind: true } : {}),
    },
  });
  const p1 = sideOf(setup.situation.own, setup.own.members.map((member) => member.key));
  const p2 = sideOf(setup.situation.opponent, setup.opponent.members.map((member) => member.key));
  return { start: { intro: situationIntro(setup.situation), p1: p1.start, p2: p2.start }, order: { p1: p1.order, p2: p2.order } };
}

/** HP at least `share` percent of `maxhp` as the game shows it (Champions shows ⌊100·hp/maxhp⌋), never below 1. */
export function startHP(maxhp: number, share: number): number {
  return Math.max(1, Math.min(maxhp, Math.ceil((maxhp * share) / 100)));
}

const STAGE = (value: number) => Math.max(-6, Math.min(6, Math.trunc(value)));

/** Installs the situation's hooks on a battle the host just made (before its players are set). */
export function installSituationStart(battle: Battle, situation: SituationStart): void {
  const target = battle as unknown as Writable;
  const sides = () => target.sides;
  const spec = (side: WritableSide) => situation[side.id];

  /** Before the start action: the intro, then each brought Pokémon's HP, status and faint (the latter in public). */
  function prepare() {
    target.add("-message", situation.intro);
    for (const side of sides()) {
      spec(side).members.forEach((member, index) => {
        const pokemon = side.pokemon[index];
        if (!pokemon) return;
        if (member.hp <= 0) {
          pokemon.hp = 0;
          pokemon.fainted = true;
          pokemon.status = "";
          pokemon.switchFlag = false;
          side.totalFainted++;
          // Fainted the turn before this one (Retaliate, the trackers' faintedLastTurn): the last of them.
          side.faintedThisTurn = pokemon;
          target.add("faint", pokemon);
          return;
        }
        pokemon.hp = startHP(pokemon.maxhp, member.hp);
        if (member.status) {
          pokemon.status = member.status;
          pokemon.statusState = target.initEffectState({ id: member.status, target: pokemon });
          if (member.status === "tox") pokemon.statusState.stage = 0;
        }
      });
    }
  }

  /** Before turn 1: the Pokémon left (the start action counted every brought one), the leads' stat stages, Tailwind. */
  function finish() {
    for (const side of sides()) {
      side.pokemonLeft = side.pokemon.filter((pokemon) => !pokemon.fainted).length;
      spec(side).members.forEach((member, index) => {
        const pokemon = side.pokemon[index];
        if (!pokemon || pokemon.fainted || !pokemon.isActive || !member.boosts) return;
        for (const [stat, value] of Object.entries(member.boosts) as [BoostId, number][]) {
          const stage = STAGE(value);
          if (!stage) continue;
          pokemon.boosts[stat] = stage;
          target.add("-setboost", pokemon, stat, stage);
        }
      });
      const setter = side.active.find((pokemon) => pokemon && !pokemon.fainted) ?? null;
      if (spec(side).tailwind && setter) side.addSideCondition("tailwind", setter);
    }
  }

  const runAction = target.runAction;
  const endTurn = target.endTurn;
  const own = target as unknown as Record<string, unknown>;
  own.runAction = function (this: Writable, action: { choice: string }) {
    if (action.choice !== "start") return runAction.call(this, action);
    delete own.runAction;
    prepare();
    // A side with one Pokémon left has a fainted one in its second slot, as the start action leaves a side that has none.
    const switchIn = target.actions.switchIn;
    target.actions.switchIn = function (this: unknown, pokemon: Pokemon, pos: number, ...rest: unknown[]) {
      const each = pokemon as unknown as WritablePokemon;
      if (!each.fainted) return switchIn.call(this, pokemon, pos, ...rest);
      const side = sides().find((entry) => entry.pokemon.includes(each));
      if (side) side.active[pos] = each;
      return true;
    };
    try {
      return runAction.call(this, action);
    } finally {
      target.actions.switchIn = switchIn;
    }
  };
  own.endTurn = function (this: Writable) {
    delete own.endTurn;
    finish();
    return endTurn.call(this);
  };
}
