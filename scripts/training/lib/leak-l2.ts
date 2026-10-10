// SPEC §14.4 L2 (your direction): drive the real worker message loop (worker/worker-handler.ts) with the engine provider
// as the AI and a random p1, youSee closed, and scan every posted `battle` message: the board's AI cards, the log turns'
// AI actions and the released read may name an AI item, ability or move only after the log (the p1 channel) named it;
// nature and Stat Points never; no AI member is marked brought. Moves are checked per member: an AI slot's move in the
// read or the turn's actions must be one the log showed the Pokémon in that slot use, and a read sentence may name an AI
// member only once the log showed it ("Zoroark" behind an Illusion is not shown). Every fifth battle forfeits on a turn
// the AI has locked in before your choice: that turn's read and actions never leave the worker (G5). Every board and step
// shows the AI's HP as a percentage (youSee.exactHP off) and its unrevealed members alike (its bench: brought or not).
// Saved battles: each checkpoint leaves sealed; the replay's boards equal the boards the battle posted at the same points
// (each turn's start, the end), so a replay shows no more than the battle did; a Resume posts no more than the battle did
// (every fourth battle is resumed from its middle checkpoint and played on).
import { DOUBLES_SLOTS, slotSide, type DoublesSlotId } from "@/app/lib/battle/doubles-types";
import { getMegaOptions, megaEntries } from "@/app/lib/battle/mega-forms";
import { championsRuntime as runtime } from "@/app/lib/battle/runtime";
import { occupantNames } from "@/app/(app)/training/log/report-format";
import type { DecisionProvider, HabitsRecord } from "@/app/(app)/training/model/decision";
import type { InfoSettings } from "@/app/(app)/training/model/info";
import { createRandom, seedHex } from "@/app/(app)/training/model/random";
import type { ShowdownRequest } from "@/app/(app)/training/model/showdown-types";
import type { FromWorker, ToWorker } from "@/app/(app)/training/model/worker-protocol";
import type { BoardView, JointAction, LogLine, LogTurn, PlayerChoice, TrainingRequest, TrainingSetup, TrainingTeam } from "@/app/(app)/training/model/view-types";
import { identName, legalJointActions, type MemberKeys } from "@/app/(app)/training/sim/choices";
import { memberKeys, toShowdownTeam } from "@/app/(app)/training/sim/showdown-set";
import { createMemorySealer, type Sealer } from "@/app/(app)/training/worker/sealer";
import { createTrainingWorker } from "@/app/(app)/training/worker/worker-handler";
import { createSeat, ensureSeats, forcedProvider, type ForcedChoices, type SeatName } from "./providers";
import { canonicalJson } from "@/app/(app)/training/model/saved-battle";
import { replayBattle } from "./saved-check";
import { parsePools, teamPair, type TeamPair } from "./teams";

export type L2Result = {
  battles: number; messages: number; hits: string[]; ended: number; errors: string[]; forfeits: number;
  /** Saved battles: replays re-run and their boards scanned, Resumes played on, checkpoints checked sealed. */
  replays: number; replayBoards: number; resumes: number; checkpoints: number;
  /** Replay boards equal to the board the battle posted at the same point (each turn's start, the end). */
  replayBoardsEqual: number;
  /**
   * What the battles showed (the Illusion and Transform slice requires them): battles whose log ended an Illusion, battles
   * whose log showed a Transform, and decisions whose two AI slots held one member's look-alikes (an Illusion beside the
   * Pokémon it copies).
   */
  illusions: number; transforms: number; lookAlikes: number;
};
/** Every FORFEIT_EVERY-th battle forfeits on turn FORFEIT_TURN (or the first later turn) once the AI has locked in. */
const FORFEIT_EVERY = 5, FORFEIT_TURN = 2;
/** Every RESUME_EVERY-th battle (from the second) is also resumed from its middle checkpoint in a fresh worker. */
const RESUME_EVERY = 4;

const nameOf = {
  move: (id: string) => runtime.movesById.get(id)?.name ?? id,
  item: (id: string) => runtime.itemsById.get(id)?.name ?? id,
  ability: (id: string) => runtime.abilitiesById.get(id)?.name ?? id,
};

/** Your members' keys by Showdown ident name, as the worker maps them (a regional form battles under its base name: Arcanine-Hisui is "Arcanine"). */
function playerKeys(team: TrainingTeam): MemberKeys {
  const adapted = toShowdownTeam(team.members, runtime);
  return memberKeys(adapted, adapted);
}

/** A random legal p1 choice for a normalized request (engine orientation: p1 = own). */
function playerChoice(request: TrainingRequest, board: BoardView | null, team: TrainingTeam, random: { int(n: number): number }): PlayerChoice | null {
  if (request.kind === "wait") return null;
  if (request.kind === "team-preview") {
    const order = [1, 2, 3, 4, 5, 6];
    for (let i = order.length - 1; i > 0; i--) { const j = random.int(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    return { kind: "team", order: order.slice(0, request.maxChosenTeamSize) };
  }
  const keys = playerKeys(team);
  const side = { name: "You", id: "p1" as const, pokemon: request.side };
  const raw: ShowdownRequest = request.kind === "move" ? { active: request.active, side } : { forceSwitch: request.forceSwitch, side };
  const bench = request.side.filter((pokemon) => !pokemon.active && !pokemon.condition.endsWith(" fnt")).map((pokemon) => keys.keyOf("p1", identName(pokemon.ident)));
  const firstTurn = [board?.turn === 1, board?.turn === 1];
  const legal = legalJointActions({ side: "p1", aiSide: "p2", request: raw, bench, firstTurn, megaUsed: board?.megaUsed.own ?? false, keys });
  const action: JointAction = legal[random.int(legal.length)] ?? {};
  return { kind: "action", action };
}

/** Facts named so far by the log (the p1 channel's lines as the worker worded them). */
function logText(turns: ReadonlyMap<number, LogTurn>): string {
  return [...turns.values()].flatMap((turn) => turn.lines.map((line) => line.text)).join("\n");
}
/** Every line of the log so far, in order. */
function logLines(turns: ReadonlyMap<number, LogTurn>): LogLine[] {
  return [...turns.values()].sort((a, b) => a.turn - b.turn).flatMap((turn) => turn.lines);
}
/** A line whose subject (its first slot) is one of the AI's Pokémon. */
const aiSubject = (line: LogLine) => !!line.slots[0] && slotSide(line.slots[0]) === "opponent";
/** A name's words for a side ("(opponent's)", "(yours, 2)") or a number ("(2)"): the log's names carry them (naming rules §1.4). */
const NAME_WORDS = / \((?:yours|opponent's)(?:, [12])?\)$| \([12]\)$/;
/**
 * Moves the log showed each of the AI's Pokémon use, by the name it showed: its `move` lines whose subject (slots[0]) is an
 * AI slot ("Gyarados used Protect.", "Garchomp (opponent's) used Earthquake → both foes."), the name without its words.
 * When an Illusion ends ("Illusion ended: Zoroark."), the moves its slot's Pokémon used since it came in count for the
 * revealed member too: the log has then shown they were its moves. `unparsed`: move lines the pattern did not read (the
 * gate counts each as a hit, so it never passes on lines it skipped).
 */
function movesShown(lines: readonly LogLine[]): { used: Map<string, Set<string>>; lines: number; unparsed: string[] } {
  const used = new Map<string, Set<string>>();
  const unparsed: string[] = [];
  const add = (name: string, move: string) => { if (!used.has(name)) used.set(name, new Set()); used.get(name)!.add(move); };
  // The moves each AI slot's Pokémon used since it came in (Ally Switch moves them with it).
  const stint = new Map<DoublesSlotId, string[]>();
  let count = 0;
  for (const line of lines) {
    const subject = line.slots[0];
    if (subject && aiSubject(line)) {
      if (line.kind === "switch") stint.set(subject, []);
      const revealed = line.kind === "form" ? /^Illusion ended: (.+?)\.$/.exec(line.text)?.[1] : undefined;
      if (revealed) for (const move of stint.get(subject) ?? []) add(revealed.replace(NAME_WORDS, ""), move);
      const other = line.slots[1];
      if (line.kind === "info" && other && slotSide(other) === "opponent" && / switched places\.$/.test(line.text)) {
        const [a, b] = [stint.get(subject) ?? [], stint.get(other) ?? []];
        stint.set(subject, b); stint.set(other, a);
      }
    }
    if (line.kind !== "move" || !aiSubject(line)) continue;
    count++;
    const match = /^(.+?) used ([^→.:]+?)(?: →|\.|:)/.exec(line.text);
    if (!match) { unparsed.push(line.text); continue; }
    const name = match[1].trim().replace(NAME_WORDS, ""), move = match[2].trim();
    add(name, move);
    stint.set(subject, [...(stint.get(subject) ?? []), move]);
  }
  return { used, lines: count, unparsed };
}
/**
 * The log showed this AI Pokémon by name: a line whose subject is an AI slot and whose text starts with the name (every shown
 * AI Pokémon first appears in a switch line it is the subject of: sent out, switched in for, dragged in), or an Illusion
 * ending on it. A line of yours that names it (Fake Out → Incineroar (opponent's)) does not count.
 */
const shownByName = (lines: readonly LogLine[], name: string) => lines.some((line) => aiSubject(line)
  && (line.text.startsWith(`${name} `) || line.text.startsWith(`Illusion ended: ${name}.`) || line.text.startsWith(`Illusion ended: ${name} (`)));
/**
 * The name your log last showed in each AI slot, from its lines in order: a switch line's subject ("Garchomp (opponent's, 1)
 * sent out.", "… switched in for …", "… was dragged in."), an Illusion ending ("Illusion ended: Zoroark."), Ally Switch
 * ("… switched places."); the words removed.
 */
function namesShownAt(lines: readonly LogLine[]): Partial<Record<DoublesSlotId, string>> {
  const shown: Partial<Record<DoublesSlotId, string>> = {};
  for (const line of lines) {
    const subject = line.slots[0];
    if (!subject || !aiSubject(line)) continue;
    const entered = line.kind === "switch" ? /^(.+?) (?:sent out|switched in for|was dragged in)\b/.exec(line.text)?.[1] : undefined;
    const revealed = line.kind === "form" ? /^Illusion ended: (.+?)\.$/.exec(line.text)?.[1] : undefined;
    if (entered ?? revealed) shown[subject] = (entered ?? revealed)!.replace(NAME_WORDS, "");
    const other = line.slots[1];
    if (line.kind === "info" && other && slotSide(other) === "opponent" && / switched places\.$/.test(line.text)) [shown[subject], shown[other]] = [shown[other], shown[subject]];
  }
  return shown;
}
const PROTECT_NAMES = ["Protect", "Detect", "King's Shield", "Spiky Shield", "Baneful Bunker", "Silk Trap", "Burning Bulwark", "Obstruct"];

/**
 * The AI's HP and bench as you see them: a percentage on every board and step unless youSee.exactHP; brought never set
 * unless youSee.brought; and its unrevealed members (brought or not) look alike on the board.
 */
export function infoLeaks(board: BoardView, log: readonly LogTurn[], youSee: InfoSettings["youSee"], label: string): string[] {
  const hits: string[] = [];
  const opponents = [...board.team.opponent, ...Object.values(board.active).filter((mon): mon is NonNullable<typeof mon> => !!mon && mon.side === "opponent")];
  for (const mon of opponents) {
    if (!youSee.exactHP && mon.hp.kind === "exact") hits.push(`${label} t${board.turn}: ${mon.name} exact HP on the board`);
    if (!youSee.brought && mon.brought !== null) hits.push(`${label} t${board.turn}: ${mon.name} brought=${mon.brought}`);
  }
  if (!youSee.brought) {
    const hidden = new Set(board.team.opponent.filter((mon) => !mon.revealed).map((mon) => canonicalJson([mon.hp, mon.fainted, mon.status, mon.boosts, mon.volatiles, mon.slot, mon.mega, mon.brought])));
    if (hidden.size > 1) hits.push(`${label} t${board.turn}: the AI's unrevealed members differ (${[...hidden].join(" / ")})`);
  }
  if (!youSee.exactHP) {
    for (const turn of log) for (const step of turn.steps ?? []) for (const each of step.slots) {
      if (slotSide(each.slot) !== "opponent" || !each.hp) continue;
      if ([each.hp.from, each.hp.to, each.hp.low].some((hp) => hp?.kind === "exact")) hits.push(`${label} turn ${turn.turn} step ${step.title}: ${each.name} exact HP`);
    }
  }
  return hits;
}

/** Member keys (both teams) whose battle name (the Showdown set's name) is on both teams: what BoardView.mirrored may hold. */
function mirroredKeys(ai: TrainingTeam, own: TrainingTeam): Set<string> {
  const ownSets = toShowdownTeam(own.members, runtime).sets, aiSets = toShowdownTeam(ai.members, runtime).sets;
  const ownNames = new Set(ownSets.map((entry) => entry.set.name)), aiNames = new Set(aiSets.map((entry) => entry.set.name));
  return new Set([...ownSets.filter((entry) => aiNames.has(entry.set.name)), ...aiSets.filter((entry) => ownNames.has(entry.set.name))].map((entry) => entry.key));
}

/**
 * One posted battle message checked against the log so far (`turns`) and each turn's decision board (`boards`); hits are
 * pushed. `requested`: the move ids your requests have listed so far (a Transform gives your Pokémon the moves of the one it
 * copies, which you then see), filled from each message's request.
 */
export function scan(message: Extract<FromWorker, { type: "battle" }>, ai: TrainingTeam, own: TrainingTeam, turns: Map<number, LogTurn>, hits: string[], label: string,
  boards: Map<number, BoardView>, youSee?: InfoSettings["youSee"], requested: Set<string> = new Set()): void {
  for (const turn of message.log) turns.set(turn.turn, turn);
  if (message.request?.kind === "move") for (const active of message.request.active) for (const move of active?.moves ?? []) requested.add(move.id);
  // The board of each turn's decision (the AI's Pokémon your log showed in its slots then).
  if (message.request && message.request.kind !== "team-preview" && !boards.has(message.board.turn)) boards.set(message.board.turn, message.board);
  const text = logText(turns);
  const lines = logLines(turns);
  const shown = movesShown(lines);
  const used = shown.used;
  // The log names a member as the species its set battles as (a Mega form is sent as its base holding the stone).
  const logName = (key: string) => {
    const member = ai.members.find((each) => each.key === key);
    if (!member) return null;
    const base = megaEntries(member.speciesId, runtime).find((entry) => entry.formId === member.speciesId)?.baseSpeciesId ?? member.speciesId;
    return runtime.speciesById.get(base)?.name ?? member.name;
  };
  const named = (name: string) => text.includes(name);
  const hit = (fact: string) => { if (hits.length < 200) hits.push(`${label} t${message.board.turn}: ${fact}`); };
  if (youSee) for (const fact of infoLeaks(message.board, message.log, youSee, label)) if (hits.length < 200) hits.push(fact);
  // Every AI move line is read by name (a line the pattern skips would hide a move the read names): none may be left over.
  for (const line of shown.unparsed) hit(`AI move line not parsed: ${line}`);
  if (shown.lines > 0 && used.size === 0) hit(`none of ${shown.lines} AI move lines parsed`);
  // The side words come only from the two public sixes, and from all of them: one set for the whole battle, which never
  // depends on what the AI brought.
  const mirrored = mirroredKeys(ai, own);
  const shownMirrored = new Set(message.board.mirrored);
  for (const key of shownMirrored) if (!mirrored.has(key)) hit(`board.mirrored holds ${key}, whose battle name is not on both teams`);
  for (const key of mirrored) if (!shownMirrored.has(key)) hit(`board.mirrored lacks ${key}, whose battle name is on both teams`);
  // Each turn's AI occupants are the Pokémon your log showed in those slots at the decision. A Pokémon that came in beside
  // one shown under the same name (an Illusion) stands in a slot the board leaves empty (the tracker's placeholder): there
  // the occupant is the member the log last named in that slot. Each turn's names are its occupants as the board of the
  // decision named them.
  for (const turn of message.log) {
    const decision = boards.get(turn.turn);
    if (!turn.occupants || !decision) continue;
    const before = namesShownAt(logLines(new Map([...turns].filter(([each]) => each < turn.turn))));
    for (const slot of ["opponent-left", "opponent-right"] as const) {
      const occupant = turn.occupants[slot];
      const asNamed = !decision.active[slot] && occupant !== undefined && !!before[slot] && logName(occupant) === before[slot];
      if (occupant !== undefined && occupant !== decision.active[slot]?.key && !asNamed) hit(`turn ${turn.turn} occupants: ${slot} is ${occupant}, the board showed ${decision.active[slot]?.key ?? "no one"}`);
    }
    if (turn.names) {
      const expected = occupantNames(turn.occupants, decision);
      for (const slot of DOUBLES_SLOTS) {
        const name = turn.names[slot];
        if (name !== undefined && name !== expected[slot]) hit(`turn ${turn.turn} names: ${slot} is ${name}, the board named ${expected[slot]}`);
      }
    }
  }
  for (const view of message.board.team.opponent) {
    const member = ai.members.find((each) => each.key === view.key);
    if (!member) continue;
    if (view.nature !== null) hit(`${view.name} nature ${view.nature}`);
    if (view.points !== null) hit(`${view.name} Stat Points`);
    if (view.brought !== null) hit(`${view.name} brought=${view.brought}`);
    if (view.item.state !== "unknown" && view.item.state !== "none" && !named(view.item.name)) hit(`${view.name} item ${view.item.name} not in the log`);
    // A Mega form's ability is its species' only one (every catalog Mega has one): public once the log shows the Mega.
    const megaOwn = view.mega && named(`${view.name.split("-Mega")[0]}`) && /Mega Evolved/.test(text)
      && (runtime.speciesById.get(view.speciesId)?.abilities ?? []).length === 1 && runtime.speciesById.get(view.speciesId)?.abilities[0] === view.ability?.id;
    if (view.ability && !named(view.ability.name) && !megaOwn) hit(`${view.name} ability ${view.ability.name} not in the log`);
    for (const move of view.moves) if (!named(move.name)) hit(`${view.name} move ${move.name} not in the log`);
  }
  // Your own moves may be named freely (the read predicts your actions), those of a Pokémon your Transformed one copied too
  // (your request listed them); only moves of the AI's alone are checked in its text.
  const ownMoves = new Set([...own.members.flatMap((member) => member.moves.flatMap((slot) => slot.moveId ? [slot.moveId] : [])), ...requested]);
  const aiMoves = new Set(ai.members.flatMap((member) => member.moves.flatMap((slot) => slot.moveId && !ownMoves.has(slot.moveId) ? [slot.moveId] : [])));
  const checkAction = (action: JointAction | null, where: string, turn: number) => {
    if (!action) return;
    for (const [slot, each] of Object.entries(action) as [keyof JointAction, JointAction[keyof JointAction]][]) {
      if (!each) continue;
      if (each.kind === "move" && !named(nameOf.move(each.moveId))) hit(`${where}: move ${nameOf.move(each.moveId)} not in the log`);
      // Per member: the Pokémon your log showed in that slot at the decision used this move in the log.
      const shown = boards.get(turn)?.active[slot];
      const shownName = shown ? logName(shown.key) : null;
      if (each.kind === "move" && shownName && !used.get(shownName)?.has(nameOf.move(each.moveId))) hit(`${where}: ${shownName} never used ${nameOf.move(each.moveId)} in the log`);
      if (each.kind === "switch") {
        const member = ai.members.find((entry) => entry.key === each.to);
        if (member && !named(runtime.speciesById.get(member.speciesId)?.name ?? member.name)) hit(`${where}: switch to unrevealed ${member.name}`);
      }
      if (each.kind === "move" && each.mega) {
        const stone = ai.members.map((member) => member.build.itemId).find((id) => runtime.itemsById.get(id)?.megaStone);
        if (stone && !named(nameOf.item(stone))) hit(`${where}: Mega without the stone shown`);
      }
    }
  };
  const ownNames = new Set(own.members.map((member) => runtime.speciesById.get(member.speciesId)?.name ?? member.name));
  // The read's names (the form shown, a Mega form included) → the log's name of that member.
  const readToLog = new Map<string, string>();
  for (const member of ai.members) {
    const log = logName(member.key) ?? member.name;
    readToLog.set(log, log);
    const base = megaEntries(member.speciesId, runtime).find((entry) => entry.formId === member.speciesId)?.baseSpeciesId ?? member.speciesId;
    for (const option of getMegaOptions(base, runtime)) readToLog.set(runtime.speciesById.get(option.formId)?.name ?? option.formId, log);
  }
  for (const turn of message.log) {
    checkAction(turn.actions?.opponent ?? null, `turn ${turn.turn} actions`, turn.turn);
    const read = turn.read;
    if (!read) continue;
    for (const option of read.strategy) checkAction(option.action, `turn ${turn.turn} read`, turn.turn);
    for (const id of aiMoves) {
      const name = nameOf.move(id);
      if (!named(name) && (read.reason?.includes(name) || read.mega?.text.includes(name))) hit(`turn ${turn.turn} read text names ${name}`);
    }
    const sentences = [read.reason, read.mega?.text].filter((each): each is string => !!each);
    for (const sentence of sentences) {
      // A member it names is one the log showed (an Illusion's real Pokémon is not, until it ends).
      for (const member of ai.members) {
        const name = logName(member.key) ?? member.name;
        const mentioned = ownNames.has(name) ? sentence.includes(`its ${name}`) : sentence.includes(name);
        if (mentioned && !shownByName(lines, name)) hit(`turn ${turn.turn} read names ${name} before the log showed it`);
      }
      // "so X protected": X used a protecting move in the log (moves your team shares included).
      // The read names a Mega Evolved Pokémon by its form ("Floette-Mega"); the log by the species it battles as ("Floette-Eternal").
      const named = /so (?:its )?(.+?) protected\./.exec(sentence)?.[1];
      const protecting = named ? readToLog.get(named) ?? named : undefined;
      if (protecting && !PROTECT_NAMES.some((move) => used.get(protecting)?.has(move))) hit(`turn ${turn.turn} read: ${protecting} protected, not in the log`);
    }
    if (read.mega && !read.mega.evolved) {
      const stone = ai.members.find((member) => member.key === read.mega!.memberKey)?.build.itemId;
      if (stone && !named(nameOf.item(stone))) hit(`turn ${turn.turn} read: kept-Mega fact before the stone was shown`);
    }
  }
}

type Drive = {
  index: number; setup: TrainingSetup; seat: SeatName; sealer: Sealer; first: ToWorker; random: { int(n: number): number };
  /** The move ids your requests listed so far (scan). */
  requested?: Set<string>;
  /** The AI's forced choices (aiOrder, aiReplaceWith: the Illusion and Transform slice). */
  aiOrder?: ForcedChoices["aiOrder"]; aiReplaceWith?: ForcedChoices["aiReplaceWith"];
  forfeits: boolean; turns: Map<number, LogTurn>; boards: Map<number, BoardView>; label: string; out: L2Result;
  /** The first board posted as each turn began (what a replay's board of that turn must equal). */
  starts?: Map<number, BoardView>;
};
/** One battle in a fresh worker (started, or resumed from a checkpoint), every battle message scanned; its end and checkpoints. */
async function drive(run: Drive): Promise<{ ended: Extract<FromWorker, { type: "battle" }> | null; checkpoints: { turn: number; sealed: string }[] }> {
  const { index, setup, out, turns, boards, random, label } = run;
  const inbox: FromWorker[] = [];
  let wake: (() => void) | null = null;
  let hexes = 0;
  const worker = createTrainingWorker({
    post: (message) => { inbox.push(structuredClone(message)); wake?.(); },
    createProvider: (habits: HabitsRecord | null): DecisionProvider => forcedProvider(createSeat(run.seat, runtime, habits).provider, run),
    now: () => performance.now(),
    randomHex: () => seedHex("leak-l2", index, "worker", hexes++),
    deadlineMs: null,
    sealer: run.sealer,
  });
  const send = (message: ToWorker) => worker.receive(message);
  const next = async (): Promise<FromWorker> => {
    for (let wait = 0; !inbox.length; wait++) {
      if (wait > 2000) throw new Error("worker idle");
      await new Promise<void>((resolve) => { wake = resolve; setTimeout(resolve, 5); });
      wake = null;
    }
    return inbox.shift()!;
  };
  const battleId = index + 1;
  const checkpoints: { turn: number; sealed: string }[] = [];
  const aiMoves = [...new Set(setup.opponent.members.flatMap((member) => member.moves.flatMap((slot) => slot.moveId ? [slot.moveId] : [])))];
  /** A checkpoint leaves the worker sealed: four fields, base64, and no plaintext of the seed, the choices or the AI's moves. */
  const checkSealed = (message: Extract<FromWorker, { type: "checkpoint" }>) => {
    if (Object.keys(message).sort().join() !== "battleId,sealed,turn,type") out.hits.push(`${label} checkpoint ${message.turn}: fields ${Object.keys(message).join()}`);
    if (!message.sealed) { out.errors.push(`${label} checkpoint ${message.turn} not sealed`); return; }
    const bytes = Buffer.from(message.sealed, "base64").toString("latin1");
    // ">p2 " with its space, as every choice line has it: the 3-byte ">p2" matched AES-GCM output by chance (3 hits in 13 runs).
    const plain = ["sodium", "events", "aiBase", "\"choose\"", ">p2 ", ...aiMoves].find((text) => bytes.includes(text));
    if (plain || !/^[A-Za-z0-9+/]+=*$/.test(message.sealed)) out.hits.push(`${label} checkpoint ${message.turn}: readable (${plain ?? "not base64"})`);
    checkpoints.push({ turn: message.turn, sealed: message.sealed });
  };
  send({ type: "load" });
  send(run.first);
  let board: BoardView | null = null;
  let lastRequest: TrainingRequest | null = null;
  let forfeitAt: { requestId: number; turn: number } | null = null;
  let ended: Extract<FromWorker, { type: "battle" }> | null = null;
  try {
    for (let step = 0; step < 4000; step++) {
      const message = await next();
      if (message.type === "battle-error") { out.errors.push(`${label}: ${message.message}`); break; }
      if (message.type === "checkpoint") { checkSealed(message); continue; }
      // The forfeit goes in once the AI has locked in this request, before your choice for it.
      if (message.type === "ai" && forfeitAt && message.requestId === forfeitAt.requestId && message.status !== "thinking") {
        send({ type: "forfeit", battleId });
        continue;
      }
      if (message.type === "choice-error") {
        const retry = lastRequest && playerChoice(message.request ?? lastRequest, board, setup.own, random);
        if (retry && lastRequest) send({ type: "choose", battleId, requestId: lastRequest.id, choice: retry });
        continue;
      }
      if (message.type !== "battle") continue;
      out.messages++;
      board = message.board;
      if (!message.ended && message.board.turn >= 1 && !run.starts?.has(message.board.turn)) run.starts?.set(message.board.turn, message.board);
      scan(message, setup.opponent, setup.own, turns, out.hits, label, boards, setup.info.youSee, run.requested ??= new Set());
      if (message.ended) {
        out.ended++;
        ended = message;
        if (forfeitAt && message.ended.forfeited) {
          out.forfeits++;
          const unplayed = turns.get(forfeitAt.turn);
          if (unplayed?.read || unplayed?.actions) out.hits.push(`${label} t${forfeitAt.turn}: the forfeited turn's ${unplayed.read ? "read" : "actions"} left the worker`);
        }
        break;
      }
      if (!message.request || message.request.kind === "wait") continue;
      lastRequest = message.request;
      if (run.forfeits && !forfeitAt && message.request.kind === "move" && message.board.turn >= FORFEIT_TURN) {
        forfeitAt = { requestId: message.request.id, turn: message.board.turn };
        continue;
      }
      const choice = playerChoice(message.request, board, setup.own, random);
      if (choice) send({ type: "choose", battleId, requestId: message.request.id, choice });
    }
  } catch (error) {
    out.errors.push(`${label}: ${(error as Error).message}`);
  }
  if (!ended && !out.errors.some((error) => error.startsWith(`${label}:`))) out.errors.push(`${label}: did not end`);
  send({ type: "stop", battleId });
  // Checkpoints are sealed asynchronously: collect the last ones.
  for (let wait = 0; wait < 40; wait++) await new Promise((resolve) => setTimeout(resolve, 5));
  for (const message of inbox.splice(0)) if (message.type === "checkpoint") checkSealed(message);
  return { ended, checkpoints: checkpoints.sort((a, b) => a.turn - b.turn) };
}

/**
 * Saved battles: the replay's boards (each turn's start and the end) are scanned against the log up to that point, as a
 * battle board is. Then (every RESUME_EVERY-th battle) the middle checkpoint is resumed in a fresh worker and played on:
 * its messages are scanned as the battle's.
 */
export async function runL2(options: {
  battles: number; seat: SeatName; info: InfoSettings; pools?: string;
  /**
   * Fixed teams for every battle (the Illusion and Transform slice) in place of pairs from the pools, the AI's preview order,
   * the member it sends in when it replaces one Pokémon (when on its bench) and the run's name.
   */
  teams?: { pair: () => TeamPair; run: string } & ForcedChoices;
}): Promise<L2Result> {
  await ensureSeats([options.seat]);
  const pools = parsePools(options.pools ?? "V,U");
  const run = options.teams?.run ?? "leak-l2";
  const out: L2Result = {
    battles: 0, messages: 0, hits: [], ended: 0, errors: [], forfeits: 0, replays: 0, replayBoards: 0, resumes: 0, checkpoints: 0, replayBoardsEqual: 0,
    illusions: 0, transforms: 0, lookAlikes: 0,
  };
  const sealer = createMemorySealer();
  for (let index = 0; index < options.battles; index++) {
    const pair = options.teams ? options.teams.pair() : teamPair("leak-l2", index, pools, runtime);
    const setup: TrainingSetup = { own: pair.p1.team, opponent: pair.p2.team, difficulty: "safe", showRead: true, info: options.info };
    const turns = new Map<number, LogTurn>();
    const starts = new Map<number, BoardView>();
    // The moves your requests listed (the resumed battle saw the same requests up to its checkpoint).
    const requested = new Set<string>();
    out.battles++;
    const played = await drive({
      index, setup, seat: options.seat, sealer, first: { type: "start", battleId: index + 1, setup, habits: null }, random: createRandom(run, index, "p1"),
      forfeits: index % FORFEIT_EVERY === FORFEIT_EVERY - 1, turns, boards: new Map(), label: `#${index}`, out, starts, aiOrder: options.teams?.aiOrder, aiReplaceWith: options.teams?.aiReplaceWith, requested,
    });
    out.checkpoints += played.checkpoints.length;
    const lines = logLines(turns).map((line) => line.text);
    if (lines.some((text) => text.startsWith("Illusion ended: "))) out.illusions++;
    if (lines.some((text) => / transformed into /.test(text))) out.transforms++;
    out.lookAlikes += [...turns.values()].filter((turn) => turn.occupants?.["opponent-left"] && turn.occupants["opponent-left"] === turn.occupants["opponent-right"]).length;
    if (played.ended) {
      const replay = await replayBattle(setup, played.ended);
      if (!replay.ok) out.errors.push(`#${index} replay: ${replay.error}`);
      else {
        out.replays++;
        const views: [string, BoardView, Map<number, LogTurn>][] = Object.entries(replay.message.starts).map(([turn, board]) =>
          [`#${index} replay turn ${turn}`, board, new Map([...turns].filter(([each]) => each < Number(turn)))]);
        views.push([`#${index} replay end`, replay.message.end, new Map(turns)]);
        for (const [label, board, shown] of views) {
          out.replayBoards++;
          scan({ type: "battle", battleId: index + 1, seed: null, request: null, board, log: [], ended: null }, setup.opponent, setup.own, shown, out.hits, label, new Map(), setup.info.youSee);
        }
        // Each replay board is the board the battle itself posted at that point: a replay shows no more than the battle did.
        const live = new Map([...starts].map(([turn, board]) => [turn, canonicalJson(board)]));
        const replayed = new Map(Object.entries(replay.message.starts).map(([turn, board]) => [Number(turn), canonicalJson(board)]));
        const differs = [...new Set([...live.keys(), ...replayed.keys()])].sort((a, b) => a - b).find((turn) => live.get(turn) !== replayed.get(turn));
        if (differs !== undefined) out.hits.push(`#${index} replay turn ${differs}: the board differs from the one the battle posted`);
        else if (canonicalJson(replay.message.end) !== canonicalJson(played.ended.board)) out.hits.push(`#${index} replay end: the board differs from the battle's last board`);
        else out.replayBoardsEqual++;
      }
    }
    if (index % RESUME_EVERY === 1 && played.checkpoints.length) {
      const at = played.checkpoints[Math.floor(played.checkpoints.length / 2)];
      const stored = [...turns.values()].filter((turn) => turn.turn < at.turn);
      out.resumes++;
      await drive({
        index, setup, seat: options.seat, sealer, first: { type: "resume", battleId: index + 1, setup, sealed: at.sealed, log: stored },
        random: createRandom(run, index, "p1-resumed"), forfeits: false, turns: new Map(stored.map((turn) => [turn.turn, turn])), boards: new Map(),
        label: `#${index} resumed at ${at.turn}`, out, aiOrder: options.teams?.aiOrder, aiReplaceWith: options.teams?.aiReplaceWith, requested,
      });
    }
  }
  return out;
}
