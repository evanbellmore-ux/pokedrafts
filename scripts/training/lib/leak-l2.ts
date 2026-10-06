// SPEC §14.4 L2 (your direction): drive the real worker message loop (worker/worker-handler.ts) with the engine provider
// as the AI and a random p1, youSee closed, and scan every posted `battle` message: the board's AI cards, the log turns'
// AI actions and the released read may name an AI item, ability or move only after the log (the p1 channel) named it;
// nature and Stat Points never; no AI member is marked brought. Moves are checked per member: an AI slot's move in the
// read or the turn's actions must be one the log showed the Pokémon in that slot use, and a read sentence may name an AI
// member only once the log showed it ("Zoroark" behind an Illusion is not shown). Every fifth battle forfeits on a turn
// the AI has locked in before your choice: that turn's read and actions never leave the worker (G5).
import { getMegaOptions, megaEntries } from "@/app/lib/battle/mega-forms";
import { championsRuntime as runtime } from "@/app/lib/battle/runtime";
import type { DecisionProvider, HabitsRecord } from "@/app/(app)/training/model/decision";
import type { InfoSettings } from "@/app/(app)/training/model/info";
import { createRandom, seedHex } from "@/app/(app)/training/model/random";
import type { ShowdownRequest } from "@/app/(app)/training/model/showdown-types";
import type { FromWorker, ToWorker } from "@/app/(app)/training/model/worker-protocol";
import type { BoardView, JointAction, LogTurn, PlayerChoice, TrainingRequest, TrainingSetup, TrainingTeam } from "@/app/(app)/training/model/view-types";
import { identName, legalJointActions, type MemberKeys } from "@/app/(app)/training/sim/choices";
import { createTrainingWorker } from "@/app/(app)/training/worker/worker-handler";
import { createSeat, ensureSeats, type SeatName } from "./providers";
import { parsePools, teamPair } from "./teams";

export type L2Result = { battles: number; messages: number; hits: string[]; ended: number; errors: string[]; forfeits: number };
/** Every FORFEIT_EVERY-th battle forfeits on turn FORFEIT_TURN (or the first later turn) once the AI has locked in. */
const FORFEIT_EVERY = 5, FORFEIT_TURN = 2;

const nameOf = {
  move: (id: string) => runtime.movesById.get(id)?.name ?? id,
  item: (id: string) => runtime.itemsById.get(id)?.name ?? id,
  ability: (id: string) => runtime.abilitiesById.get(id)?.name ?? id,
};

function playerKeys(team: TrainingTeam): MemberKeys {
  const byName = new Map(team.members.map((member) => [runtime.speciesById.get(member.speciesId)?.name ?? member.name, member.key]));
  return { keyOf: (_side, name) => byName.get(name) ?? `?${name}`, speciesOf: (_side, key) => team.members.find((member) => member.key === key)?.name ?? key };
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
/** Moves the log showed each of the AI's Pokémon use, by the name it showed ("Gyarados (opponent's left) used Protect."). */
function movesShown(text: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const match of text.matchAll(/^(.+?) \(opponent's (?:left|right)\) used ([^→.:]+?)(?: →|\.|:)/gm)) {
    const name = match[1].trim(), move = match[2].trim();
    if (!out.has(name)) out.set(name, new Set());
    out.get(name)!.add(move);
  }
  return out;
}
/** The log showed this AI Pokémon by name (sent out, switched in, an Illusion ending, or acting). */
const shownByName = (text: string, name: string) => text.includes(`${name} (opponent's`) || text.includes(`${name} switched in for`) || text.includes(`Illusion ended: ${name} (opponent's`);
const PROTECT_NAMES = ["Protect", "Detect", "King's Shield", "Spiky Shield", "Baneful Bunker", "Silk Trap", "Burning Bulwark", "Obstruct"];

function scan(message: Extract<FromWorker, { type: "battle" }>, ai: TrainingTeam, own: TrainingTeam, turns: Map<number, LogTurn>, hits: string[], label: string,
  boards: Map<number, BoardView>): void {
  for (const turn of message.log) turns.set(turn.turn, turn);
  // The board of each turn's decision (the AI's Pokémon your log showed in its slots then).
  if (message.request && message.request.kind !== "team-preview" && !boards.has(message.board.turn)) boards.set(message.board.turn, message.board);
  const text = logText(turns);
  const used = movesShown(text);
  // The log names a member as the species its set battles as (a Mega form is sent as its base holding the stone).
  const logName = (key: string) => {
    const member = ai.members.find((each) => each.key === key);
    if (!member) return null;
    const base = megaEntries(member.speciesId, runtime).find((entry) => entry.formId === member.speciesId)?.baseSpeciesId ?? member.speciesId;
    return runtime.speciesById.get(base)?.name ?? member.name;
  };
  const named = (name: string) => text.includes(name);
  const hit = (fact: string) => { if (hits.length < 200) hits.push(`${label} t${message.board.turn}: ${fact}`); };
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
  // Your own moves may be named freely (the read predicts your actions); only moves of the AI's alone are checked in its text.
  const ownMoves = new Set(own.members.flatMap((member) => member.moves.flatMap((slot) => slot.moveId ? [slot.moveId] : [])));
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
        if (mentioned && !shownByName(text, name)) hit(`turn ${turn.turn} read names ${name} before the log showed it`);
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

export async function runL2(options: { battles: number; seat: SeatName; info: InfoSettings; pools?: string }): Promise<L2Result> {
  await ensureSeats([options.seat]);
  const pools = parsePools(options.pools ?? "V,U");
  const out: L2Result = { battles: 0, messages: 0, hits: [], ended: 0, errors: [], forfeits: 0 };
  for (let index = 0; index < options.battles; index++) {
    const pair = teamPair("leak-l2", index, pools, runtime);
    const setup: TrainingSetup = { own: pair.p1.team, opponent: pair.p2.team, difficulty: "safe", showRead: true, info: options.info };
    const random = createRandom("leak-l2", index, "p1");
    const turns = new Map<number, LogTurn>();
    const boards = new Map<number, BoardView>();
    const forfeits = index % FORFEIT_EVERY === FORFEIT_EVERY - 1;
    let forfeitAt: { requestId: number; turn: number } | null = null;
    const inbox: FromWorker[] = [];
    let wake: (() => void) | null = null;
    let hexes = 0;
    const worker = createTrainingWorker({
      post: (message) => { inbox.push(structuredClone(message)); wake?.(); },
      createProvider: (habits: HabitsRecord | null): DecisionProvider => createSeat(options.seat, runtime, habits).provider,
      now: () => performance.now(),
      randomHex: () => seedHex("leak-l2", index, "worker", hexes++),
      deadlineMs: null,
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
    send({ type: "load" });
    send({ type: "start", battleId: index + 1, setup, habits: null });
    out.battles++;
    let board: BoardView | null = null;
    let lastRequest: TrainingRequest | null = null;
    try {
      for (let step = 0; step < 4000; step++) {
        const message = await next();
        if (message.type === "battle-error") { out.errors.push(`#${index}: ${message.message}`); break; }
        // The forfeit goes in once the AI has locked in this request, before your choice for it.
        if (message.type === "ai" && forfeitAt && message.requestId === forfeitAt.requestId && message.status !== "thinking") {
          send({ type: "forfeit", battleId: index + 1 });
          continue;
        }
        if (message.type === "choice-error") {
          const retry = lastRequest && playerChoice(message.request ?? lastRequest, board, setup.own, random);
          if (retry && lastRequest) send({ type: "choose", battleId: index + 1, requestId: lastRequest.id, choice: retry });
          continue;
        }
        if (message.type !== "battle") continue;
        out.messages++;
        board = message.board;
        scan(message, setup.opponent, setup.own, turns, out.hits, `#${index}`, boards);
        if (message.ended) {
          out.ended++;
          if (forfeitAt && message.ended.forfeited) {
            out.forfeits++;
            const unplayed = turns.get(forfeitAt.turn);
            if (unplayed?.read || unplayed?.actions) out.hits.push(`#${index} t${forfeitAt.turn}: the forfeited turn's ${unplayed.read ? "read" : "actions"} left the worker`);
          }
          break;
        }
        if (!message.request || message.request.kind === "wait") continue;
        lastRequest = message.request;
        if (forfeits && !forfeitAt && message.request.kind === "move" && message.board.turn >= FORFEIT_TURN) {
          forfeitAt = { requestId: message.request.id, turn: message.board.turn };
          continue;
        }
        const choice = playerChoice(message.request, board, setup.own, random);
        if (choice) send({ type: "choose", battleId: index + 1, requestId: message.request.id, choice });
      }
    } catch (error) {
      out.errors.push(`#${index}: ${(error as Error).message}`);
    }
    send({ type: "stop", battleId: index + 1 });
  }
  return out;
}
