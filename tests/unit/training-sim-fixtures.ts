// Shared fixtures for the SIM track's Training tests (not a test file): the showdown-sim gate teams as TrainingMembers,
// and calculator-suggested members.
import { createBuild, withUsualAbility } from "@/app/lib/battle/model";
import { createMoveSlots, usualAbility, type MoveSlots } from "@/app/lib/battle/move-defaults";
import { championsRuntime as runtime } from "@/app/lib/battle/runtime";
import type { ChampionsBuild } from "@/app/lib/battle/types";
import { showdownNature } from "@/app/(app)/training/model/sets";
import type { TrainingMember, TrainingTeam } from "@/app/(app)/training/model/view-types";
import { AI, PLAYER } from "../../scripts/lib/showdown-sim/fixtures.mjs";
import { PERFECT_INFORMATION, type InfoView } from "@/app/(app)/training/model/info";
import { redactSheet } from "@/app/(app)/training/model/sheet";
import type { BeliefWorld } from "@/app/(app)/training/model/ai-inputs";
import type { ShowdownRequest, ShowdownSet } from "@/app/(app)/training/model/showdown-types";
import { aiInputs, createTestOracle } from "@/app/(app)/training/sim/inputs";
import { memberKeys, sheetFromSets, toShowdownTeam, type AdaptedTeam } from "@/app/(app)/training/sim/showdown-set";
import { Battle, extractChannelMessages } from "@/app/(app)/training/sim/sim";
import { createTracker } from "@/app/(app)/training/sim/tracker";

const toID = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");
type FixtureSet = (typeof PLAYER)[number];

export function memberFromSet(set: FixtureSet, key = toID(set.species)): TrainingMember {
  const speciesId = toID(set.species);
  const base = createBuild(speciesId, runtime) as ChampionsBuild;
  const build: ChampionsBuild = { ...base, nature: set.nature, abilityId: toID(set.ability), itemId: toID(set.item), points: { ...set.evs } };
  const ids = set.moves.map(toID);
  const moves = [0, 1, 2, 3].map((i) => ({ moveId: ids[i] ?? null, origin: ids[i] ? "imported" : "empty", gameType: null })) as MoveSlots;
  return { key, name: runtime.speciesById.get(speciesId)?.name ?? set.species, speciesId, build, moves, origin: "imported" };
}

export function suggestedMember(speciesId: string, key = speciesId): TrainingMember {
  const build = showdownNature(withUsualAbility(createBuild(speciesId, runtime), usualAbility(speciesId, "Doubles", runtime)));
  return { key, name: runtime.speciesById.get(speciesId)?.name ?? speciesId, speciesId, build, moves: createMoveSlots(speciesId, "Doubles", runtime), origin: "suggested" };
}

export const PLAYER_TEAM: TrainingTeam = { label: "Probe player", members: PLAYER.map((set) => memberFromSet(set)) };
export const AI_TEAM: TrainingTeam = { label: "Probe AI", members: AI.map((set) => memberFromSet(set)) };
export { AI, PLAYER, runtime };

// ---------- A seat-side battle for SIM-4 tests: the real battle, the AI's tracker (p2) and AiInputs ----------

export function seatBattle(seed: number[], teams: { own?: AdaptedTeam; opponent?: AdaptedTeam } = {}) {
  const own = teams.own ?? toShowdownTeam(PLAYER_TEAM.members, runtime);
  const opponent = teams.opponent ?? toShowdownTeam(AI_TEAM.members, runtime);
  const keys = memberKeys(own, opponent);
  const chunks: string[] = [];
  const battle = new Battle({ formatid: "gen9championsvgc2026regmc", seed, send: (type, data) => { if (type === "update") chunks.push(Array.isArray(data) ? data.join("\n") : data); } });
  battle.setPlayer("p1", { name: "You", team: structuredClone(own.sets.map((s) => s.set)) });
  battle.setPlayer("p2", { name: "Training", team: structuredClone(opponent.sets.map((s) => s.set)) });
  const tracker = createTracker("p2", keys.keyOf);
  const pump = () => { battle.sendUpdates(); tracker.push(extractChannelMessages(chunks.splice(0).join("\n"), [2])[2]); };
  pump();
  let requestId = 1;
  return {
    battle, keys, own, opponent, tracker,
    step(p1: string, p2: string) { battle.makeChoices(p1, p2); pump(); requestId++; },
    inputs(info: InfoView = PERFECT_INFORMATION) {
      const oracle = createTestOracle(battle, "p2", info, keys);
      return aiInputs({ side: "p2", requestId, request: battle.p2.activeRequest as ShowdownRequest, own: opponent, sheet: redactSheet(sheetFromSets(own), info), tracker, info, oracle });
    },
    /** The truth as one belief world: the brought four in side order and their real sets. */
    truthWorld(seedHex = "0".repeat(32), hp: BeliefWorld["hp"] = "midpoint"): BeliefWorld {
      return {
        weight: 1, brought: battle.p1.pokemon.map((p) => keys.keyOf("p1", p.name)), hp, seed: seedHex,
        sets: Object.fromEntries(battle.p1.pokemon.map((p) => [keys.keyOf("p1", p.name), { ...structuredClone(p.set), gender: p.gender } as ShowdownSet])),
      };
    },
  };
}
