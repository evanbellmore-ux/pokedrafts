import type { DoublesSlotId } from "@/app/lib/battle/doubles-types";
import type { BattleBuild } from "@/app/lib/battle/types";
import { championsRuntime } from "@/app/lib/battle/runtime";
import { DEFAULT_INFO } from "@/app/(app)/training/model/info";
import type { StatPoints } from "@/app/(app)/training/model/sheet";
import type { SuggestedSet } from "@/app/(app)/training/model/usage";
import type {
  BoardView, DecisionReport, LogTurn, MoveRequest, PokemonView, PreviewRequest, RequestPokemon, SwitchRequest, TrainingMember,
  TrainingSetup, TrainingTeam,
} from "@/app/(app)/training/model/view-types";
import type { FromWorker, ToWorker, TrainingTransport } from "@/app/(app)/training/model/worker-protocol";
import { memberFromSuggestion } from "@/app/(app)/training/setup/team-draft";

// Training UI fixtures: two six-member teams of suggested sets, p1 requests in the shapes pinned Showdown sends
// (scripts/.cache/training/design/ui-probe.out, probe-midturn.out), a board, log turns and a read.

export const runtime = championsRuntime;

const ZERO: StatPoints = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

export function suggestedSet(key: string, speciesId: string, moves: string[], extra: Partial<SuggestedSet> = {}): SuggestedSet {
  const species = runtime.speciesById.get(speciesId)!;
  return {
    key, speciesId, source: "usage", moves, itemId: "", abilityId: species.abilities[0], nature: "Hardy", points: ZERO, protectAdded: false,
    ...extra,
  };
}

function member(key: string, speciesId: string, moves: string[], extra: Partial<SuggestedSet> = {}): TrainingMember {
  return memberFromSuggestion(suggestedSet(key, speciesId, moves, extra), { key, name: runtime.speciesById.get(speciesId)!.name }, runtime);
}

export const OWN_MEMBERS: TrainingMember[] = [
  member("own-garchomp", "garchomp", ["earthquake", "dragonclaw", "rockslide", "protect"], { itemId: "lifeorb", abilityId: "roughskin", nature: "Jolly", points: { ...ZERO, hp: 2, atk: 32, spe: 32 }, protectAdded: true }),
  member("own-gyarados", "gyarados", ["waterfall", "protect"], { itemId: "sitrusberry", abilityId: "intimidate" }),
  member("own-incineroar", "incineroar", ["fakeout", "partingshot", "flareblitz", "protect"], { itemId: "leftovers", abilityId: "intimidate" }),
  member("own-aerodactyl", "aerodactyl", ["rockslide", "protect"], { itemId: "focussash" }),
  member("own-aegislash", "aegislash", ["poltergeist", "protect"], { itemId: "lumberry" }),
  member("own-aggron", "aggron", ["bodypress", "protect"], { itemId: "choicescarf" }),
];
export const OPPONENT_MEMBERS: TrainingMember[] = [
  member("ai-absol", "absol", ["suckerpunch", "nightslash", "protect", "closecombat"], { itemId: "absolite", abilityId: "pressure", nature: "Adamant", points: { ...ZERO, atk: 32, spe: 32, hp: 2 } }),
  member("ai-altaria", "altaria", ["firespin", "protect"], { itemId: "sitrusberry" }),
  member("ai-ampharos", "ampharos", ["risingvoltage", "protect"], { itemId: "focussash" }),
  member("ai-annihilape", "annihilape", ["ragefist", "protect"], { itemId: "leftovers" }),
  member("ai-appletun", "appletun", ["appleacid", "protect"], { itemId: "lumberry" }),
  member("ai-araquanid", "araquanid", ["liquidation", "protect"], { itemId: "lifeorb" }),
];

export function team(label: string, members: TrainingMember[]): TrainingTeam {
  return { label, members };
}

export function trainingSetup(overrides: Partial<TrainingSetup> = {}): TrainingSetup {
  return {
    own: team("Your team", OWN_MEMBERS), opponent: team("Rival", OPPONENT_MEMBERS), difficulty: "safe", showRead: true, info: DEFAULT_INFO,
    ...overrides,
  };
}

function pokemon(ident: string, condition: string, active: boolean, moves: string[], item = ""): RequestPokemon {
  return {
    ident, details: `${ident.replace(/^p1: /, "")}, L50`, condition, active, stats: { atk: 100, def: 100, spa: 100, spd: 100, spe: 100 },
    moves, baseAbility: "", item,
  };
}

export const REQUEST_SIDE: RequestPokemon[] = [
  pokemon("p1: Garchomp", "183/183", true, ["earthquake", "dragonclaw", "rockslide", "protect"], "lifeorb"),
  pokemon("p1: Gyarados", "171/202", true, ["waterfall", "protect"], "sitrusberry"),
  pokemon("p1: Incineroar", "202/202", false, ["fakeout", "partingshot", "flareblitz", "protect"], "leftovers"),
  pokemon("p1: Aerodactyl", "0 fnt", false, ["rockslide", "protect"], "focussash"),
];

export const PREVIEW_REQUEST: PreviewRequest = {
  kind: "team-preview", id: 1, maxChosenTeamSize: 4,
  side: OWN_MEMBERS.map((each) => pokemon(`p1: ${each.name}`, "100/100", false, each.moves.flatMap((slot) => slot.moveId ? [slot.moveId] : []))),
};

export function moveRequest(overrides: Partial<MoveRequest> = {}): MoveRequest {
  return {
    kind: "move", id: 7,
    active: [
      {
        moves: [
          { move: "Earthquake", id: "earthquake", pp: 8, maxpp: 8, target: "allAdjacent", disabled: false },
          { move: "Dragon Claw", id: "dragonclaw", pp: 0, maxpp: 12, target: "normal", disabled: false },
          { move: "Rock Slide", id: "rockslide", pp: 8, maxpp: 8, target: "allAdjacentFoes", disabled: false },
          { move: "Protect", id: "protect", pp: 8, maxpp: 8, target: "self", disabled: true },
        ],
        canMegaEvo: true,
      },
      {
        moves: [
          { move: "Waterfall", id: "waterfall", pp: 12, maxpp: 12, target: "normal", disabled: false },
          { move: "Protect", id: "protect", pp: 8, maxpp: 8, target: "self", disabled: false },
        ],
        canMegaEvo: true,
      },
    ],
    side: REQUEST_SIDE,
    ...overrides,
  };
}

export function switchRequest(forceSwitch: boolean[], midTurn = false, side: RequestPokemon[] = REQUEST_SIDE): SwitchRequest {
  return { kind: "switch", id: 9, forceSwitch, midTurn, side };
}

function view(key: string, slot: DoublesSlotId | null, overrides: Partial<PokemonView> = {}): PokemonView {
  const own = slot ? slot.startsWith("own") : key.startsWith("own");
  const source = (own ? OWN_MEMBERS : OPPONENT_MEMBERS).find((each) => each.key === key)!;
  const species = runtime.speciesById.get(source.speciesId)!;
  return {
    key, ident: `${own ? "p1" : "p2"}: ${species.name}`, side: own ? "own" : "opponent", slot,
    speciesId: species.id, name: species.name, types: species.types,
    hp: own ? { kind: "exact", current: 143, maximum: 183 } : { kind: "percent", percent: 58 },
    fainted: false, status: "", boosts: {}, volatiles: [],
    item: own ? { state: "held", id: source.build.itemId, name: runtime.itemsById.get(source.build.itemId)?.name ?? "" } : { state: "unknown" },
    ability: own ? { id: source.build.abilityId, name: runtime.abilitiesById.get(source.build.abilityId)?.name ?? "" } : null,
    nature: own ? source.build.nature : null,
    points: own && source.build.game === "champions" ? { hp: source.build.points.hp ?? 0, atk: source.build.points.atk ?? 0, def: source.build.points.def ?? 0, spa: source.build.points.spa ?? 0, spd: source.build.points.spd ?? 0, spe: source.build.points.spe ?? 0 } : null,
    moves: source.moves.flatMap((each) => each.moveId ? [{ id: each.moveId, name: runtime.movesById.get(each.moveId)?.name ?? each.moveId, ...(own ? { pp: 8, maxpp: 8 } : {}) }] : []),
    mega: false, revealed: true, brought: own ? true : null,
    ...overrides,
  };
}

export function boardView(overrides: Partial<BoardView> = {}): BoardView {
  const ownLeft = view("own-garchomp", "own-left", { boosts: { atk: 1, spd: -1 } });
  const ownRight = view("own-gyarados", "own-right", { hp: { kind: "exact", current: 171, maximum: 202 }, status: "par" });
  const foeLeft = view("ai-ampharos", "opponent-left", { hp: { kind: "percent", percent: 20, color: "y" }, status: "par", boosts: { def: -1 }, item: { state: "consumed", id: "focussash", name: "Focus Sash" }, moves: [{ id: "risingvoltage", name: "Rising Voltage" }], unseenMoves: 3, ability: null });
  const foeRight = view("ai-absol", "opponent-right", { name: "Absol-Mega", mega: true, hp: { kind: "percent", percent: 21 }, item: { state: "held", id: "absolite", name: "Absolite" }, ability: { id: "magicbounce", name: "Magic Bounce" } });
  return {
    turn: 3,
    active: { "own-left": ownLeft, "own-right": ownRight, "opponent-left": foeLeft, "opponent-right": foeRight },
    team: {
      own: [ownLeft, ownRight, view("own-incineroar", null, { hp: { kind: "exact", current: 202, maximum: 202 } }), view("own-aerodactyl", null, { fainted: true, hp: { kind: "exact", current: 0, maximum: 187 } })],
      opponent: [foeRight, foeLeft, view("ai-annihilape", null, { revealed: true }), ...["ai-altaria", "ai-appletun", "ai-araquanid"].map((key) => view(key, null, { revealed: false }))],
    },
    field: {
      weather: { id: "snowscape", name: "Snow", turns: 3 }, terrain: null,
      rooms: [{ id: "trickroom", name: "Trick Room", turns: 2 }],
      sides: { own: [{ id: "tailwind", name: "Tailwind", turns: 1 }], opponent: [] },
    },
    megaUsed: { own: false, opponent: true },
    mirrored: [],
    ...overrides,
  };
}

/** The fixture board's members in each slot (LogTurn.occupants). */
export const OCCUPANTS: NonNullable<LogTurn["occupants"]> = { "own-left": "own-garchomp", "own-right": "own-gyarados", "opponent-left": "ai-ampharos", "opponent-right": "ai-absol" };

export function report(overrides: Partial<DecisionReport> = {}): DecisionReport {
  return {
    turn: 2, provider: "engine", difficulty: "safe",
    predicted: [
      { action: { "own-left": { kind: "move", moveId: "rockslide", target: null }, "own-right": { kind: "move", moveId: "protect", target: null } }, chance: 0.45 },
      { action: { "own-left": { kind: "move", moveId: "rockslide", target: null }, "own-right": { kind: "move", moveId: "waterfall", target: "opponent-right" } }, chance: 0.3 },
    ],
    strategy: [
      { action: { "opponent-right": { kind: "switch", to: "ai-annihilape" }, "opponent-left": { kind: "move", moveId: "protect", target: null } }, chance: 0.6 },
      { action: null, chance: 0.4 },
    ],
    chosen: 0,
    actual: { chance: 0.45 },
    reason: "Predicted Rock Slide into Absol (45%), so it switched to Annihilape.",
    mega: null,
    assumed: ["Garchomp: 2 HP / 32 Atk / 32 Spe · Jolly (64%)"],
    elapsedMs: 412,
    evaluated: { yours: 6, its: 10 },
    ...overrides,
  };
}

export function logTurns(): LogTurn[] {
  return [
    { turn: 0, lines: [{ text: "Garchomp sent out.", kind: "switch", slots: ["own-left"] }], actions: null, read: null },
    {
      turn: 1,
      lines: [
        { text: "Absol Mega Evolved (Absolite).", kind: "form", slots: ["opponent-right"] },
        { text: "Garchomp used Rock Slide → both foes.", kind: "move", slots: ["own-left", "opponent-left", "opponent-right"] },
      ],
      actions: { own: { "own-left": { kind: "move", moveId: "rockslide", target: null } }, opponent: {} },
      read: report({ turn: 1 }),
      occupants: { ...OCCUPANTS },
    },
    {
      turn: 2,
      lines: [{ text: "Ampharos fainted.", kind: "faint", slots: ["opponent-left"] }],
      actions: { own: { "own-left": { kind: "move", moveId: "rockslide", target: null }, "own-right": { kind: "move", moveId: "protect", target: null } }, opponent: {} },
      read: report(),
      occupants: { ...OCCUPANTS },
    },
  ];
}

/** A transport the test drives: records every message to the worker and emits worker messages on demand. */
export function fakeTransport() {
  const posted: ToWorker[] = [];
  const listeners = new Set<(message: FromWorker) => void>();
  let terminated = 0;
  const transport: TrainingTransport = {
    post: (message) => { posted.push(message); },
    onMessage: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    terminate: () => { terminated += 1; },
  };
  return {
    transport, posted,
    emit(message: FromWorker) { for (const listener of [...listeners]) listener(message); },
    get terminated() { return terminated; },
    of<T extends ToWorker["type"]>(type: T) { return posted.filter((message): message is Extract<ToWorker, { type: T }> => message.type === type); },
  };
}

export function memoryStorage(initial: Record<string, string> = {}): Storage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => { data.delete(key); },
    setItem: (key, value) => { data.set(key, String(value)); },
  };
}

export function throwingStorage(): Storage {
  const fail = () => { throw new Error("SecurityError"); };
  return { length: 0, clear: fail, getItem: fail, key: fail, removeItem: fail, setItem: fail };
}

export function buildOf(speciesId: string, patch: Partial<BattleBuild> = {}): BattleBuild {
  return { ...member(`build-${speciesId}`, speciesId, ["protect"]).build, ...patch } as BattleBuild;
}

/** A ready league roster state: your team and one opponent, by Pool Builder names (calculator-rosters.test.ts shape). */
export function rosterState(ownNames: string[], opponentNames: string[]): import("@/app/(app)/calculator/roster-data").CalculatorRosterState {
  const roster = (id: string, memberId: string, names: string[]) => ({
    id, member_id: memberId, total_points: names.length * 15, team_name: null, role: null,
    pokemon: names.map((name, index) => ({ name, points: 15, tier: 1, pick_number: index + 1, acquired: "draft" as const })),
  });
  return {
    status: "ready", userId: "user-1", selectedLeagueId: "league-a", opponentId: "member-other",
    leagues: [{ id: "league-a", name: "Alpha", memberId: "member-own", teamName: "Home", draftStarted: true, draftCompleted: true }],
    teamsStatus: "ready", message: null, teamsMessage: null,
    data: {
      leagueId: "league-a",
      members: [
        { id: "member-own", role: "coach", team_name: "Home", draft_position: 1 },
        { id: "member-other", role: "coach", team_name: "Away", draft_position: 2 },
      ],
      teams: [roster("team-own", "member-own", ownNames), roster("team-other", "member-other", opponentNames)],
    },
  };
}

export const OWN_ROSTER = ["Garchomp", "Gyarados", "Incineroar", "Aerodactyl", "Aegislash", "Aggron", "Alakazam"];
export const OPPONENT_ROSTER = ["Absol", "Altaria", "Ampharos", "Annihilape", "Appletun", "Araquanid"];

export const PASTE_TEXT = `Garchomp @ Life Orb
Ability: Rough Skin
Level: 50
SPs: 2 HP / 32 Atk / 32 Spe
Jolly Nature
- Earthquake
- Dragon Claw
- Rock Slide
- Protect

Gyarados @ Sitrus Berry
Ability: Intimidate
Level: 50
Adamant Nature
- Waterfall
- Protect

Incineroar @ Leftovers
Ability: Intimidate
Level: 50
SPs: 32 HP / 32 Atk / 2 Def
Adamant Nature
- Fake Out
- Parting Shot
- Flare Blitz
- Protect

Aerodactyl @ Focus Sash
Ability: Unnerve
Level: 50
Jolly Nature
- Rock Slide
- Protect

Aegislash @ Lum Berry
Ability: Stance Change
Level: 50
Quiet Nature
- Poltergeist
- Protect

Aggron @ Choice Scarf
Ability: Sturdy
Level: 50
Impish Nature
- Body Press
- Heavy Slam`;
