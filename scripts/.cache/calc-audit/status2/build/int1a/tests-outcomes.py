# Integration 1a: tests/unit/doubles-outcomes.test.ts reads the generated doubles-turn-showdown.test.ts, whose case table V1
# split into parts of 400 (CASES_1 ... CASES_n) and whose input builder gained status2's inputs (gender, types, last item,
# earlier this turn, switched in, first turn, the carried charge / Encore / Disable, the sides' Safeguard, Mist and Lucky
# Chant, Mud Sport, Water Sport, entryOrder, fieldTurns). The builder section is the generated file's, as its comment says.
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../../.."))
p = os.path.join(ROOT, "tests/unit/doubles-outcomes.test.ts")
raw = open(p, encoding="utf8", newline="").read()
crlf = "\r\n" in raw
s = raw.replace("\r\n", "\n")
start = s.index('type Stat = "hp" | "atk" | "def" | "spa" | "spd" | "spe";')
end = s.index("// ---------- The perf test's typical turns (the same generator, other seeds) ----------")
NEW = '''type Stat = "hp" | "atk" | "def" | "spa" | "spd" | "spe";
type Carried = Omit<DoublesCarried, "trap" | "futureMove" | "cudChew"> & { trap?: { source: DoublesSlotId; bindingBand: boolean; move?: string }; futureMove?: string; cudChew?: true };
type Mon = {
  species: string; appSpecies?: string; ability: string; item?: string; nature?: string; evs?: Partial<Record<Stat, number>>;
  ivs?: Partial<Record<Stat, number>>; level?: number; hp?: number; status?: BattleBuild["status"];
  boosts?: Partial<Record<Exclude<Stat, "hp">, number>>; teraType?: string; choice?: "mega" | "terastallize" | "dynamax" | "zmove";
  charged?: boolean; appBuild?: Record<string, unknown>; absent?: boolean; gender?: string;
  carried?: Carried; substitute?: number; moves?: string[]; lastMove?: string | null;
  move: string | null; target?: DoublesSlotId; context?: MoveContext;
  // status2: as doubles-turn-showdown.test.ts (verify/gen-tests.ts).
  earlierThisTurn?: { statsRaised?: true; statsLowered?: true; usedItem?: true }; switchIn?: true;
  appBoosts?: Partial<Record<Exclude<Stat, "hp">, number>>;
  types?: string[]; addedType?: "Grass" | "Ghost"; lastItem?: string | null; firstTurn?: boolean;
};
type SideField = { tailwind?: boolean; reflect?: boolean; lightScreen?: boolean; auroraVeil?: boolean; safeguard?: boolean; mist?: boolean; luckyChant?: boolean };
type Field = Partial<Pick<BattleConditions, "weather" | "terrain" | "trickRoom" | "gravity" | "wonderRoom" | "magicRoom" | "critical" | "mudSport" | "waterSport">> & { own?: SideField; opponent?: SideField };
type Case = {
  id: string; game: "sv" | "swsh" | "usum" | "champions"; field?: Field; slots: Record<DoublesSlotId, Mon>;
  weatherTurns?: number; canSwitch?: Partial<Record<"own" | "opponent", boolean>>;
  entryOrder?: DoublesTurnInput["entryOrder"]; fieldTurns?: DoublesTurnInput["fieldTurns"];
};
const GAMES: Record<Case["game"], BattleGame> = { sv: "scarlet_violet", swsh: "sword_shield", usum: "ultra_sun_ultra_moon", champions: "champions" };
const toId = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");
const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

/** The generated file's case table: one literal, or (status2 V1) parts `const CASES_n: Case[] = [ ... ];` of 400 rows. */
function showdownCases(): Case[] {
  const text = readFileSync("tests/unit/doubles-turn-showdown.test.ts", "utf8").replace(/\\r\\n/g, "\\n");
  const heads = [...text.matchAll(/const CASES(?:_\\d+)?: Case\\[\\] = \\[\\n/g)];
  const cases: Case[] = [];
  for (const head of heads) {
    const start = head.index! + head[0].length - 2;
    const end = text.indexOf("\\n];", start);
    if (end < 0) break;
    cases.push(...(new Function(`return ${text.slice(start, end + 3).replace(/;$/, "")}`)() as Case[]));
  }
  if (!cases.length) throw new Error("The Showdown cases were not found.");
  return cases;
}
function caseBuild(m: Mon, runtime: BattleRuntime): BattleBuild {
  const base = createBuild(m.appSpecies ?? toId(m.species), runtime);
  const abilityId = toId(m.ability);
  const shared = {
    nature: m.nature ?? "Serious", abilityId, abilityActive: defaultAbilityActive(abilityId), itemId: toId(m.item ?? ""),
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...(m.appBoosts ?? m.boosts) }, currentHP: m.hp ?? null, status: m.status ?? "",
  };
  const configuration = { ...base.configuration, ...(m.teraType ? { teraType: m.teraType } : {}), ...(m.gender === "M" || m.gender === "F" ? { gender: m.gender } : {}) };
  const mechanic = m.choice === "terastallize" ? { mechanic: "tera" as const } : m.choice === "dynamax" ? { mechanic: "dynamax" as const } : {};
  const trained = base.game === "champions"
    ? { ...base, ...shared, points: { ...ZERO, ...m.evs } }
    : { ...base, ...shared, native: { level: m.level ?? 50, evs: { ...ZERO, ...m.evs }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31, ...m.ivs } } };
  const typed = { ...(m.types ? { types: [...m.types] } : {}), ...(m.addedType ? { addedType: m.addedType } : {}) };
  return { ...trained, ...(Object.keys(configuration).length ? { configuration } : {}), ...mechanic, ...typed, ...m.appBuild } as BattleBuild;
}
/** The state from earlier turns (doubles-turn-showdown.test.ts carried). */
function carriedOf(m: Mon): DoublesCarried | undefined {
  const { trap, futureMove, charging, encore, disable, ...rest } = m.carried ?? {};
  const out: DoublesCarried = {
    ...rest, ...(trap ? { trap: { source: trap.source, bindingBand: trap.bindingBand, move: toId(trap.move ?? "Fire Spin") } } : {}), ...(futureMove ? { futureMove: toId(futureMove) } : {}),
    ...(charging ? { charging: toId(charging) } : {}), ...(encore ? { encore: { move: toId(encore.move), turns: encore.turns } } : {}), ...(disable ? { disable: { move: toId(disable.move), turns: disable.turns } } : {}),
    ...(m.substitute !== undefined ? { substitute: m.substitute } : {}),
  };
  return Object.keys(out).length ? out : undefined;
}
const sideOf = (s: SideField | undefined) => ({
  ...createSide(), tailwind: !!s?.tailwind, reflect: !!s?.reflect, lightScreen: !!s?.lightScreen, auroraVeil: !!s?.auroraVeil,
  ...(s?.safeguard ? { safeguard: true } : {}), ...(s?.mist ? { mist: true } : {}), ...(s?.luckyChant ? { luckyChant: true } : {}),
});
async function caseInput(c: Case): Promise<DoublesTurnInput> {
  const runtime = await loadBattleRuntime(GAMES[c.game]);
  const f = c.field ?? {};
  const field: BattleConditions = {
    ...createConditions(), gameType: "Doubles", weather: f.weather ?? "", terrain: f.terrain ?? "", critical: !!f.critical,
    trickRoom: !!f.trickRoom, gravity: !!f.gravity, wonderRoom: !!f.wonderRoom, magicRoom: !!f.magicRoom,
    attackerSide: sideOf(f.own), defenderSide: sideOf(f.opponent),
    ...(f.mudSport ? { mudSport: true } : {}), ...(f.waterSport ? { waterSport: true } : {}),
  };
  const pokemon = Object.fromEntries(SLOTS.map((slot) => {
    const m = c.slots[slot];
    if (m.absent) return [slot, null];
    const moveId = m.move === null ? null : toId(m.move);
    const context: MoveContext = { ...(m.choice === "zmove" ? { useZ: true } : {}), ...m.context };
    const state = carriedOf(m);
    const entry: DoublesPokemonInput = {
      build: caseBuild(m, runtime), contexts: moveId && Object.keys(context).length ? { [moveId]: context } : {}, charged: !!m.charged,
      action: { moveId, target: m.target ?? null },
      ...(state ? { carried: state } : {}),
      ...(m.lastMove !== undefined ? { lastMove: m.lastMove === null ? null : toId(m.lastMove) } : {}),
      ...(m.moves ? { moves: [...new Set([...(moveId ? [moveId] : []), ...m.moves.map(toId)])] } : {}),
      ...(m.switchIn ? { switchedIn: true as const } : {}),
      ...(m.earlierThisTurn && Object.keys(m.earlierThisTurn).length ? { earlierThisTurn: { ...m.earlierThisTurn } } : {}),
      ...(m.lastItem !== undefined ? { lastItem: m.lastItem === null ? null : toId(m.lastItem) } : {}),
      ...(m.firstTurn !== undefined ? { firstTurn: m.firstTurn } : {}),
    };
    return [slot, entry];
  })) as Record<DoublesSlotId, DoublesPokemonInput | null>;
  const turn: DoublesTurnInput = {
    runtime, field, pokemon, ...(c.weatherTurns !== undefined ? { weatherTurns: c.weatherTurns } : {}),
    canSwitch: { own: c.canSwitch?.own ?? true, opponent: c.canSwitch?.opponent ?? true },
    ...(c.entryOrder ? { entryOrder: { ...c.entryOrder } } : {}), ...(c.fieldTurns ? { fieldTurns: { ...c.fieldTurns } } : {}),
  };
  // A move the app takes no chosen target for gets none, whatever Showdown's choice aims at (as the Showdown test does).
  for (const slot of SLOTS) {
    const entry = pokemon[slot];
    if (entry?.action.moveId && entry.action.target && doublesTargetRule(turn, slot, entry.action.moveId).kind !== "choose") entry.action = { ...entry.action, target: null };
  }
  return turn;
}

'''
s = s[:start] + NEW + s[end:]
if crlf: s = s.replace("\n", "\r\n")
open(p, "w", encoding="utf8", newline="").write(s)
print("rewrote the builder section")
