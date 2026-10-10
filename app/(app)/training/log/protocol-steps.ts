import { nameText, type DoublesSlotId } from "@/app/lib/battle/doubles-types";
import type { BattleStatus } from "@/app/lib/battle/types";
import type { SideID } from "../model/showdown-types";
import type { HPView, PokemonView, StepSlot, TurnStep } from "../model/view-types";
import {
  effectKind, effectName, hasTag, idOf, IGNORED, POSITION_OF, positionNumber, PROTECTING_MOVES, SLOT_OF, STAT_NAMES, tag, teamSideWord,
  WEATHER_NAMES,
} from "./protocol-text";

// The board's playback of each turn (Training): the same p1 channel as the log (log/protocol-text.ts), read into steps in
// protocol order — one per move (its targets, HP before and after, stages, status, misses and Protect), per switch, per Mega
// Evolution and one for the end of turn when something changed there. Worker-only and pure: the page plays the steps and
// never parses protocol. Your HP is exact and the AI's the percentage the channel shows; nothing the channel hides is here.

export type StepBuilder = {
  /** The p1 channel's lines, in order (one drain at a time; a drain ends at a request, so no step spans two drains). */
  push(lines: readonly string[]): void;
  /** Index 0: before `|turn|1`; index n: turn n, up to `|turn|n+1`. Fresh copies. */
  turns(): TurnStep[][];
};

export type StepBuilderOptions = {
  /** Display name for a Pokémon from its side and Showdown ident name (as the log's). Default: the name. */
  names?: (side: SideID, name: string) => string;
  /** Each team's battle names (as the log's `teams`): a name on both teams carries its side word. Default: none. */
  teams?: Record<SideID, readonly string[]>;
  /** TrainingMember.key for a side's Showdown ident name (the board's PokemonView.key). Default: "p1:Name". */
  keyOf?: (side: SideID, name: string) => string;
  /** A move's type ("Rock Slide" → "Rock"; Pixilate's Hyper Voice → "Fairy"), for the colours; null when unknown. */
  moveType?: (move: string, user: StepUser | null) => string | null;
};

/** The move's user as the channel showed it: its species now (a Mega form) and the ability the channel last showed it with. */
export type StepUser = { side: SideID; name: string; species: string | null; ability: string | null };

type Stat = keyof PokemonView["boosts"];
type Mon = {
  ident: string; side: SideID; name: string; key: string; hp: HPView; status: BattleStatus; boosts: Partial<Record<Stat, number>>; position: string | null;
  species: string | null; ability: string | null;
};
type Change = {
  slot: DoublesSlotId; mon: Mon; entered: boolean; hpFrom: HPView; hpTouched: boolean; fainted: boolean;
  /** The lowest HP the step took it to (a hit before its Sitrus Berry). */
  hpLow: HPView | null;
  statusTouched: boolean; boostsTouched: boolean; mega: boolean;
  /** The card's facts in the step, in order ("Super effective", "Focus Sash", "Burned", "Attack −1"). */
  facts: string[];
};
type Open = {
  kind: TurnStep["kind"]; group: number; title: string; titles: string[]; type: string | null;
  actor: Mon | null; actorSlot: DoublesSlotId | null; self: boolean;
  /** The position the move's line named its user at ("p2a"), for its name. */
  actorPosition: string | null;
  /** Slots the move named (its target, a spread list) and the ones its effects reached (damage, a miss, Protect …). */
  declared: Set<DoublesSlotId>; reached: Set<DoublesSlotId>;
  changes: Change[];
  /** Results not tied to one card ("No target", "Failed", "Hit 3 times", "Snow ended"), in order. */
  results: string[];
  /** A switch step that so far holds only switch lines (more switch lines join it). */
  onlySwitches: boolean;
  ambient: boolean;
};

const STATUS_LABEL: Record<string, string> = {
  brn: "Burned", par: "Paralyzed", psn: "Poisoned", tox: "Badly poisoned", slp: "Asleep", frz: "Frozen",
};
/** A status ending, as the log says it ("woke up", "thawed", "is no longer burned"). */
const CURED_LABEL: Record<string, string> = {
  brn: "Burn cured", par: "Paralysis cured", psn: "Poison cured", tox: "Poison cured", slp: "Woke up", frz: "Thawed",
};
/** Lines a Pokémon's own action can open with (PS beforeMove: waking up, confusion) before its `move` or `cant` line. */
const OWN_ACTION_LINES: ReadonlySet<string> = new Set(["move", "cant", "-activate", "-end"]);
const STATUSES: ReadonlySet<string> = new Set(["brn", "par", "psn", "tox", "slp", "frz"]);
const CANT_TITLES: Record<string, string> = {
  par: "is fully paralyzed", slp: "is asleep", frz: "is frozen", flinch: "flinched", recharge: "must recharge", nopp: "has no PP left",
  ally: "is commanding",
};
/** HP-change sources as their card fact; null: no fact (a drain heal is the move's own effect). */
const SOURCE_FACTS: Record<string, string | null> = {
  brn: "Burn", psn: "Poison", tox: "Poison", confusion: "Confusion", recoil: "Recoil", drain: null,
};
/** Activations that stop a move at the target (PS/data/moves.ts protect … matblock, craftyshield). */
const PROTECTED_BY: ReadonlySet<string> = new Set([
  "protect", "detect", "spikyshield", "kingsshield", "banefulbunker", "silktrap", "burningbulwark", "obstruct", "maxguard",
  "wideguard", "quickguard", "matblock", "craftyshield",
]);
const TRAPS: ReadonlySet<string> = new Set(["bind", "wrap", "firespin", "whirlpool", "sandtomb", "magmastorm", "infestation", "snaptrap", "thundercage", "clamp"]);
const FIELD_NAMES: Record<string, string> = { ...WEATHER_NAMES };
/** Moves whose own name says the weather they start. */
const WEATHER_MOVES: ReadonlySet<string> = new Set(["raindance", "sunnyday", "sandstorm", "snowscape", "hail", "chillyreception"]);

function signed(value: number) {
  return value > 0 ? `+${value}` : value < 0 ? `−${-value}` : "±0";
}
/** HP for comparing two views of one Pokémon (both exact, or both the percentage). */
function hpValue(hp: HPView) {
  return hp.kind === "exact" ? hp.current : hp.percent;
}
function sameHP(a: HPView, b: HPView) {
  return a.kind === "exact" && b.kind === "exact" ? a.current === b.current && a.maximum === b.maximum
    : a.kind === "percent" && b.kind === "percent" ? a.percent === b.percent : false;
}
function nonZero(boosts: Partial<Record<Stat, number>>): PokemonView["boosts"] {
  return Object.fromEntries(Object.entries(boosts).filter(([, value]) => value !== 0)) as PokemonView["boosts"];
}

export function createStepBuilder(options: StepBuilderOptions = {}): StepBuilder {
  const display = options.names ?? ((_side: SideID, name: string) => name);
  const keyOf = options.keyOf ?? ((side: SideID, name: string) => `${side}:${name}`);
  const moveType = options.moveType ?? (() => null);
  const groups: TurnStep[][] = [[]];
  /** Pokémon by "p1: Name"; who stands at "p1a" etc. */
  const mons = new Map<string, Mon>();
  const positions = new Map<string, string>();
  let started = false;
  let open: Open | null = null;
  /** Field facts seen while no step was open (the end of turn's "Snow ended" comes before its damage lines). */
  let pendingField: string[] = [];
  /**
   * What a Pokémon showed as its own action began, before its move line ("Woke up", "No longer confused", "Confused"):
   * part of that action's step, not of the step before it.
   */
  let ownAction: { mon: Mon; facts: string[]; status: boolean } | null = null;
  /** The Pokémon whose Berry the previous line ate (a Lum Berry's cure is the Berry's, not a waking up). */
  let lastAte: Mon | null = null;

  function parseIdent(ident: string | undefined): { ident: string; side: SideID; name: string; position: string | null } | null {
    const match = /^(p[12])([ab])?:\s*(.*)$/.exec(ident?.trim() ?? "");
    if (!match) return null;
    const side = match[1] as SideID;
    return { ident: `${side}: ${match[3]}`, side, name: match[3], position: match[2] ? `${side}${match[2]}` : null };
  }
  function monOf(ident: string | undefined): Mon | null {
    const parsed = parseIdent(ident);
    if (!parsed) return null;
    let mon = mons.get(parsed.ident);
    if (!mon) {
      mon = {
        ident: parsed.ident, side: parsed.side, name: parsed.name, key: keyOf(parsed.side, parsed.name),
        hp: parsed.side === "p1" ? { kind: "exact", current: 0, maximum: 0 } : { kind: "percent", percent: 100 }, status: "", boosts: {}, position: null,
        species: null, ability: null,
      };
      mons.set(parsed.ident, mon);
    }
    return mon;
  }
  const slotOf = (mon: Mon | null): DoublesSlotId | null => (mon?.position ? SLOT_OF[mon.position] ?? null : null);
  const slotAt = (ident: string | undefined): DoublesSlotId | null => {
    const position = parseIdent(ident)?.position;
    return position ? SLOT_OF[position] ?? null : null;
  };
  /** The name shown at a position now ("p2a"), or null when no one stands there. */
  function nameAt(position: string) {
    const ident = positions.get(position);
    const mon = ident ? mons.get(ident) : undefined;
    return mon ? display(mon.side, mon.name) : null;
  }
  /**
   * "Garchomp"; "Gardevoir (yours)" when both teams have the name; "Garchomp (2)" while the other position on its side shows
   * the same name (an Illusion), numbered by `position` (the line's own ident, else where it stands).
   */
  function label(mon: Mon, position: string | null = mon.position) {
    const base = display(mon.side, mon.name);
    // A position it has left since (Ally Switch before its step closed) gives way to where it stands now.
    const at = position && positions.get(position) === mon.ident ? position : mon.position;
    return nameText({ base, side: teamSideWord(options.teams, mon.side, base), number: positionNumber(at, base, nameAt) });
  }
  /** The position a line's ident names ("p2a"), or where the Pokémon stands for an ident without one. */
  const positionOf = (ident: string | undefined, mon: Mon) => parseIdent(ident)?.position ?? mon.position;

  /** "17/100 brn" → HP and status on the p1 channel (your HP exact; the AI's `n/100` with a g/y/r suffix at 50 and 20). */
  function readHP(mon: Mon, token: string | undefined) {
    const [value, status] = (token ?? "").trim().split(" ");
    const match = /^(\d+)(?:\/(\d+))?([gyr])?$/.exec(value ?? "");
    if (!match) return;
    const fainted = status === "fnt" || match[1] === "0";
    const current = Number(match[1]);
    if (mon.side === "p1") {
      const maximum = Number(match[2] ?? 0) || (mon.hp.kind === "exact" ? mon.hp.maximum : 0);
      mon.hp = { kind: "exact", current: fainted ? 0 : current, maximum };
    } else {
      mon.hp = { kind: "percent", percent: fainted ? 0 : current, ...(match[3] ? { color: match[3] as "g" | "y" | "r" } : {}) };
    }
    if (!fainted) mon.status = (STATUSES.has(status ?? "") ? status : "") as BattleStatus;
  }

  // ---------- steps ----------
  function begin(kind: TurnStep["kind"], title: string, extra: Partial<Open> = {}): Open {
    close();
    const step: Open = {
      kind, group: groups.length - 1, title, titles: [title], type: null, actor: null, actorSlot: null, self: false, actorPosition: null,
      declared: new Set(), reached: new Set(), changes: [], results: [], onlySwitches: false, ambient: false, ...extra,
    };
    open = step;
    // Its user woke up (or snapped out of confusion) as this action began: on its card in this step.
    const before = ownAction;
    ownAction = null;
    if (before) {
      const change = touch(before.mon, step);
      if (change) {
        if (before.status) change.statusTouched = true;
        for (const text of before.facts) fact(change, text);
      }
    }
    return step;
  }
  /** `mon`'s own action starts with the next line (its move, can't-move, or confusion line): what it shows now joins that step. */
  function actsNext(mon: Mon | null, next: string | undefined): mon is Mon {
    const after = next?.startsWith("|") ? next.slice(1).split("|") : null;
    return !!mon && !!after && OWN_ACTION_LINES.has(after[0]) && monOf(after[1]) === mon
      && (after[0] === "move" || after[0] === "cant" || idOf(effectName(after[2] ?? "")) === "confusion");
  }
  function beforeOwnAction(mon: Mon, text: string, status: boolean) {
    if (ownAction && ownAction.mon !== mon) ownAction = null;
    ownAction ??= { mon, facts: [], status: false };
    if (!ownAction.facts.includes(text)) ownAction.facts.push(text);
    if (status) ownAction.status = true;
  }
  /** The step this line belongs to: the open one, or a new end-of-turn step when the line changes a card. */
  function current(): Open {
    if (open) { open.onlySwitches = false; return open; }
    const step = begin("end", "End of turn", { ambient: true });
    step.results.push(...pendingField);
    pendingField = [];
    return step;
  }
  /** The open step's entry for a Pokémon on the field (null on the bench). */
  function touch(mon: Mon | null, step: Open = current()): Change | null {
    const slot = slotOf(mon);
    if (!mon || !slot) return null;
    let change = step.changes.find((each) => each.slot === slot && each.mon === mon);
    if (!change) {
      change = {
        slot, mon, entered: false, hpFrom: { ...mon.hp }, hpTouched: false, hpLow: null, fainted: false, statusTouched: false, boostsTouched: false, mega: false,
        facts: [],
      };
      step.changes.push(change);
    }
    return change;
  }
  function fact(change: Change | null, text: string | null) {
    if (!change || !text) return;
    if (!change.facts.includes(text)) change.facts.push(text);
  }
  /** A line about a Pokémon the move reached: it is highlighted with the move's targets (never the user, unless the move is on itself). */
  function reach(step: Open, mon: Mon | null) {
    const slot = slotOf(mon);
    if (step.kind === "move" && slot && (mon !== step.actor || step.self)) step.reached.add(slot);
  }
  function stepResult(step: Open, text: string) {
    if (!step.results.includes(text)) step.results.push(text);
  }

  function close(reason?: "upkeep") {
    const step = open;
    open = null;
    if (!step) return;
    if (step.ambient && reason !== "upkeep") {
      step.kind = "effect";
      step.title = step.changes.flatMap((change) => change.facts)[0] ?? "Effects";
    }
    const slots: StepSlot[] = [];
    for (const change of step.changes) {
      const out: StepSlot = { slot: change.slot, key: change.mon.key, name: label(change.mon, POSITION_OF[change.slot]), facts: [...change.facts] };
      if (change.entered) out.entered = true;
      if (change.entered || (change.hpTouched && !sameHP(change.hpFrom, change.mon.hp))) {
        out.hp = { from: { ...change.hpFrom }, to: { ...change.mon.hp } };
        // Down and back up in one step (a hit, then its berry): the bar dips to the lowest HP first.
        if (change.hpLow && hpValue(change.hpLow) < Math.min(hpValue(change.hpFrom), hpValue(change.mon.hp))) out.hp.low = { ...change.hpLow };
      }
      if (change.fainted) out.fainted = true;
      // A Pokémon coming in brings its status as the channel shows it (not as the board shows it after the turn).
      if (change.statusTouched || change.entered) out.status = change.mon.status;
      if (change.boostsTouched) out.boosts = nonZero(change.mon.boosts);
      if (change.mega) out.mega = true;
      const visible = out.entered || out.hp || out.fainted || out.status !== undefined || out.boosts || out.mega || out.facts.length;
      if (visible) slots.push(out);
    }
    // The end of turn plays when a card changed or the field did ("Snow ended", "Tailwind ended (your side)").
    if (!slots.length && (step.kind === "effect" || (step.kind === "end" && !step.results.length))) return;
    // Highlighted cards: a move's targets (its user only for a move on itself, or when it reached nobody).
    let targets: DoublesSlotId[];
    if (step.kind === "move") {
      const all = new Set([...step.declared, ...step.reached]);
      if (step.actorSlot && !step.self) all.delete(step.actorSlot);
      if (step.self && step.actorSlot) all.add(step.actorSlot);
      targets = [...all];
      if (!targets.length && step.actorSlot) targets = [step.actorSlot];
    } else if (step.kind === "switch") {
      targets = step.changes.filter((change) => change.entered).map((change) => change.slot);
    } else if (step.kind === "mega" || step.kind === "cant") {
      targets = step.actorSlot ? [step.actorSlot] : [];
    } else {
      targets = slots.map((slot) => slot.slot);
    }
    targets = [...new Set(targets)];
    const by = step.kind === "move" && step.actor && !(targets.length === 1 && targets[0] === step.actorSlot) ? label(step.actor, step.actorPosition ?? step.actor.position) : null;
    groups[step.group].push({
      kind: step.kind, title: step.kind === "switch" ? step.titles.join(" · ") : step.title, by, results: [...step.results], type: step.type,
      targets, actor: step.kind === "move" ? step.actorSlot : null, slots,
    });
  }

  // ---------- lines ----------
  function setStages(mon: Mon | null, update: (boosts: Partial<Record<Stat, number>>) => Partial<Record<Stat, number>>, text: string | null) {
    if (!mon) return;
    mon.boosts = update({ ...mon.boosts });
    const step = current();
    const change = touch(mon, step);
    if (!change) return;
    change.boostsTouched = true;
    fact(change, text);
    reach(step, mon);
  }

  function line(raw: string, next: string | undefined) {
    if (!raw.startsWith("|")) return;
    const args = raw.slice(1).split("|");
    const command = args[0];
    if (command === "") { close(); pendingField = []; return; }
    if (command === "upkeep") {
      // Only the field changed at the end of turn (the weather ended): its own step all the same.
      if (!open && pendingField.length) current();
      close("upkeep");
      pendingField = [];
      return;
    }
    if (command === "turn") {
      close();
      pendingField = [];
      started = true;
      const turn = Number(args[1]);
      while (groups.length <= turn) groups.push([]);
      return;
    }
    noteAbility(command, args);
    if (IGNORED.has(command) || hasTag(args, "silent")) return;
    const ate = lastAte;
    lastAte = null;

    switch (command) {
      case "switch": case "drag": case "replace": {
        const parsed = parseIdent(args[1]);
        if (!parsed?.position) return;
        const position = parsed.position;
        const leaving = positions.get(position);
        const old = leaving && leaving !== parsed.ident ? mons.get(leaving) ?? null : null;
        // The Pokémon leaving is named as it stood there, before the switch.
        const oldName = old ? label(old, position) : null;
        const mon = monOf(args[1])!;
        if (old) { old.position = null; old.boosts = {}; }
        positions.set(position, mon.ident);
        mon.position = position;
        mon.boosts = {};
        // Its species as the channel shows it; an ability shown before may have been Trace's (it reverts on switching).
        mon.species = args[2]?.split(",")[0].trim() || mon.species;
        mon.ability = null;
        if (command === "replace") { if (old) { mon.hp = { ...old.hp }; mon.status = old.status; } } else readHP(mon, args[3]);
        const from = tag(args, "from");
        const prefix = from ? effectName(from) : command === "drag" && open?.kind === "move" ? open.title : null;
        const name = label(mon, position);
        const oldFainted = !!old && (old.hp.kind === "exact" ? old.hp.current === 0 : old.hp.percent === 0);
        const sentence = command === "replace" ? `Illusion ended: ${name}`
          : !old || !started ? `${name} comes in`
            : oldFainted ? `${name} replaces ${oldName}` : `${oldName} switches for ${name}`;
        // "U-turn: Staraptor switches for Venusaur", "Red Card: …", "Whirlwind: …".
        const title = prefix ? `${prefix}: ${sentence}` : sentence;
        let step: Open;
        if (open?.kind === "switch" && open.onlySwitches) { step = open; step.titles.push(title); }
        else step = begin("switch", title, { onlySwitches: true });
        step.changes = step.changes.filter((change) => change.slot !== SLOT_OF[position]);
        const change = touch(mon, step)!;
        change.entered = true;
        change.hpFrom = { ...mon.hp };
        return;
      }
      case "swap": {
        const subject = monOf(args[1]);
        const parsed = parseIdent(args[1]);
        if (!subject || !parsed?.position) return;
        const target = `${parsed.side}${Number(args[2]) === 0 ? "a" : "b"}`;
        const otherIdent = positions.get(target);
        const other = otherIdent && otherIdent !== subject.ident ? mons.get(otherIdent) ?? null : null;
        if (other) { other.position = parsed.position; positions.set(parsed.position, other.ident); } else positions.delete(parsed.position);
        subject.position = target;
        positions.set(target, subject.ident);
        const step = current();
        for (const mon of [subject, other]) {
          if (!mon) continue;
          step.changes = step.changes.filter((change) => change.slot !== slotOf(mon));
          const change = touch(mon, step)!;
          change.entered = true;
          // Ally Switch keeps its stages (a switch-in's are cleared).
          change.boostsTouched = true;
          fact(change, "Switched places");
          reach(step, mon);
        }
        return;
      }
      case "move": {
        const actor = monOf(args[1]);
        const move = args[2] ?? "";
        const user = actor ? { side: actor.side, name: actor.name, species: actor.species, ability: actor.ability } : null;
        const step = begin("move", move, { type: moveType(move, user), actor, actorSlot: slotOf(actor), actorPosition: parseIdent(args[1])?.position ?? null });
        const spread = args.find((arg) => arg.startsWith("[spread]"));
        const notarget = args.includes("[notarget]");
        if (spread) {
          for (const position of spread.slice("[spread]".length).trim().split(",")) {
            const slot = SLOT_OF[position.trim()];
            if (slot) step.declared.add(slot);
          }
        } else if (args[3] && !notarget) {
          const target = parseIdent(args[3]);
          if (target && actor && target.ident === actor.ident) step.self = true;
          const slot = slotAt(args[3]);
          if (slot) step.declared.add(slot);
        }
        if (notarget) stepResult(step, "No target");
        return;
      }
      case "cant": {
        const mon = monOf(args[1]);
        if (!mon) return;
        const reason = args[2] ?? "";
        const known = CANT_TITLES[idOf(reason)];
        // "Garchomp is asleep"; "Garchomp (2) is asleep" while the other position on its side shows the same name.
        const name = label(mon, positionOf(args[1], mon));
        const title = known ? `${name} ${known}` : args[3] ? `${name} can't use ${args[3]} (${effectName(reason)})` : `${name} can't move`;
        const step = begin("cant", title, { actor: mon, actorSlot: slotOf(mon) });
        touch(mon, step);
        return;
      }
      case "detailschange": case "-formechange": {
        // A Mega form, Primal Reversion or another forme: its species now (a permanent change also takes its new ability).
        const mon = monOf(args[1]);
        if (!mon || !args[2]) return;
        mon.species = args[2].split(",")[0].trim();
        if (command === "detailschange") mon.ability = null;
        return;
      }
      case "-mega": case "-primal": {
        const mon = monOf(args[1]);
        if (!mon) return;
        const step = begin("mega", `${label(mon, positionOf(args[1], mon))} ${command === "-mega" ? "Mega Evolves" : "undergoes Primal Reversion"}`, { actor: mon, actorSlot: slotOf(mon) });
        const change = touch(mon, step);
        if (change) change.mega = true;
        return;
      }
      case "-damage": case "-heal": case "-sethp": {
        const mon = monOf(args[1]);
        if (!mon) return;
        const step = current();
        const change = touch(mon, step);
        readHP(mon, args[2]);
        if (!change) return;
        change.hpTouched = true;
        if (!change.hpLow || hpValue(mon.hp) < hpValue(change.hpLow)) change.hpLow = { ...mon.hp };
        const from = tag(args, "from");
        if (from) {
          const id = idOf(from);
          fact(change, id in SOURCE_FACTS ? SOURCE_FACTS[id] : effectName(from));
          if (step.kind === "move" && effectKind(from) === "move") reach(step, mon);
        } else reach(step, mon);
        return;
      }
      case "faint": {
        const mon = monOf(args[1]);
        if (!mon) return;
        mon.hp = mon.hp.kind === "exact" ? { ...mon.hp, current: 0 } : { kind: "percent", percent: 0 };
        mon.boosts = {};
        const change = touch(mon);
        if (change) change.fainted = true;
        return;
      }
      case "-miss": {
        const step = current();
        const target = args[2] ? monOf(args[2]) : null;
        if (target && slotOf(target)) { fact(touch(target, step), "Missed"); reach(step, target); }
        else stepResult(step, "Missed");
        return;
      }
      case "-immune": {
        const mon = monOf(args[1]);
        const step = current();
        fact(touch(mon, step), "No effect");
        reach(step, mon);
        return;
      }
      case "-fail": {
        const mon = monOf(args[1]);
        if (!open) return;
        const step = current();
        if (step.kind === "move" && mon === step.actor && !step.self) {
          if (!step.results.includes("No target")) stepResult(step, "Failed");
          return;
        }
        fact(touch(mon, step), "Failed");
        reach(step, mon);
        return;
      }
      case "-block": {
        const mon = monOf(args[1]);
        if (!open) return;
        const step = current();
        fact(touch(mon, step), "Blocked");
        reach(step, mon);
        return;
      }
      case "-notarget": if (open) stepResult(current(), "No target"); return;
      case "-hitcount": if (open) stepResult(current(), `Hit ${args[2]} time${args[2] === "1" ? "" : "s"}`); return;
      case "-ohko": if (open) stepResult(current(), "One-hit KO"); return;
      case "-crit": { if (open) fact(touch(monOf(args[1])), "Critical hit"); return; }
      case "-supereffective": { if (open) fact(touch(monOf(args[1])), "Super effective"); return; }
      case "-resisted": { if (open) fact(touch(monOf(args[1])), "Not very effective"); return; }
      case "-activate": {
        const mon = monOf(args[1]);
        const effect = args[2] ?? "";
        const id = idOf(effectName(effect));
        if (PROTECTED_BY.has(id)) {
          const step = current();
          fact(touch(mon, step), "Protected");
          reach(step, mon);
        } else if (id === "confusion") {
          // Hurt in confusion: the next line is its damage. Otherwise "Confused" goes on its card in its move's step.
          const after = next?.slice(1).split("|");
          if (mon && after && after[0] === "-damage" && monOf(after[1]) === mon && idOf(tag(after, "from") ?? "") === "confusion") {
            const step = begin("effect", `${label(mon, positionOf(args[1], mon))} is confused`, { actor: mon, actorSlot: slotOf(mon) });
            touch(mon, step);
          } else if (actsNext(mon, next)) beforeOwnAction(mon, "Confused", false);
        } else if (open && effectKind(effect) === "move" && TRAPS.has(id)) {
          const step = current();
          fact(touch(mon, step), "Trapped");
          reach(step, mon);
        } else if (open?.kind === "move" && mon && mon !== open.actor && effectName(effect)) {
          // What else stopped or met the move on a Pokémon, as the log names it: "Psychic Terrain", "Substitute".
          const step = current();
          fact(touch(mon, step), effectName(effect));
          reach(step, mon);
        }
        return;
      }
      case "-status": {
        const mon = monOf(args[1]);
        if (!mon) return;
        mon.status = (STATUSES.has(args[2]) ? args[2] : "") as BattleStatus;
        const step = current();
        const change = touch(mon, step);
        if (!change) return;
        change.statusTouched = true;
        fact(change, STATUS_LABEL[args[2]] ?? args[2]);
        const from = tag(args, "from");
        if (from && effectKind(from) !== "move") fact(change, effectName(from));
        else reach(step, mon);
        return;
      }
      case "-curestatus": {
        const mon = monOf(args[1]);
        if (!mon) return;
        const cured = CURED_LABEL[args[2]] ?? "Status cured";
        mon.status = "";
        // Waking up or thawing as it moves (PS slp/frz onBeforeMove; its move line is next): part of its own action. A Lum
        // Berry's cure (after its [eat] line) is the Berry's, in the step that ate it.
        if ((args[2] === "slp" || args[2] === "frz") && !tag(args, "from") && ate !== mon && actsNext(mon, next)) {
          beforeOwnAction(mon, cured, true);
          return;
        }
        const step = current();
        const change = touch(mon, step);
        if (!change) return;
        change.statusTouched = true;
        fact(change, cured);
        return;
      }
      case "-boost": case "-unboost": {
        const mon = monOf(args[1]);
        const stat = args[2] as Stat;
        const amount = Number(args[3] ?? 0) * (command === "-unboost" ? -1 : 1);
        const name = STAT_NAMES[stat] ?? stat;
        setStages(mon, (boosts) => ({ ...boosts, [stat]: Math.max(-6, Math.min(6, (boosts[stat] ?? 0) + amount)) }), amount === 0 ? `${name} unchanged` : `${name} ${signed(amount)}`);
        return;
      }
      case "-setboost": {
        const stat = args[2] as Stat;
        const value = Number(args[3]);
        setStages(monOf(args[1]), (boosts) => ({ ...boosts, [stat]: value }), `${STAT_NAMES[stat] ?? stat} ${signed(value)}`);
        return;
      }
      case "-clearboost": setStages(monOf(args[1]), () => ({}), "Stat changes cleared"); return;
      case "-clearallboost": {
        for (const ident of positions.values()) setStages(mons.get(ident) ?? null, () => ({}), "Stat changes cleared");
        return;
      }
      case "-clearnegativeboost": setStages(monOf(args[1]), (boosts) => Object.fromEntries(Object.entries(boosts).map(([stat, value]) => [stat, Math.max(0, value ?? 0)])), "Lowered stats restored"); return;
      case "-clearpositiveboost": setStages(monOf(args[1]), (boosts) => Object.fromEntries(Object.entries(boosts).map(([stat, value]) => [stat, Math.min(0, value ?? 0)])), "Raised stats cleared"); return;
      case "-invertboost": setStages(monOf(args[1]), (boosts) => Object.fromEntries(Object.entries(boosts).map(([stat, value]) => [stat, -(value ?? 0)])), "Stat changes inverted"); return;
      case "-copyboost": {
        const source = monOf(args[2]);
        setStages(monOf(args[1]), () => ({ ...(source?.boosts ?? {}) }), "Stat changes copied");
        return;
      }
      case "-swapboost": {
        const a = monOf(args[1]);
        const b = monOf(args[2]);
        if (!a || !b) return;
        const first = { ...a.boosts };
        const second = { ...b.boosts };
        setStages(a, () => second, "Stat changes swapped");
        setStages(b, () => first, "Stat changes swapped");
        return;
      }
      case "-start": {
        if (!open) return;
        const mon = monOf(args[1]);
        const name = effectName(args[2] ?? "");
        const id = idOf(name);
        const text = id === "confusion" ? "Confused" : id === "typechange" ? `Type: ${args[3] ?? "changed"}` : /^perish\d$/.test(id) ? `Perish count ${id.slice(-1)}` : name;
        const step = current();
        fact(touch(mon, step), text);
        reach(step, mon);
        return;
      }
      case "-end": {
        const mon = monOf(args[1]);
        const id = idOf(effectName(args[2] ?? ""));
        // Snapping out of confusion as it moves: part of its own action (a Persim Berry's cure stays in the step that ate it).
        if (id === "confusion" && ate !== mon && actsNext(mon, next)) { beforeOwnAction(mon, "No longer confused", false); return; }
        if (!open) return;
        fact(touch(mon), id === "confusion" ? "No longer confused" : `${effectName(args[2] ?? "")} ended`);
        return;
      }
      case "-singleturn": {
        if (!open) return;
        const mon = monOf(args[1]);
        const name = effectName(args[2] ?? "");
        const step = current();
        // A move's own effect on its user or partner ("Protect" after Protect or Detect, "Helping Hand", "Follow Me") is its title.
        if (idOf(name) === idOf(step.title) || (step.kind === "move" && PROTECTING_MOVES.has(idOf(step.title)) && PROTECTED_BY.has(idOf(name)))) return;
        fact(touch(mon, step), name);
        return;
      }
      case "-item": {
        if (!open) return;
        const mon = monOf(args[1]);
        const item = args[2] ?? "";
        const from = tag(args, "from");
        fact(touch(mon), from && effectKind(from) === "move" ? `Got ${item}` : item);
        return;
      }
      case "-enditem": {
        const mon = monOf(args[1]);
        if (hasTag(args, "eat")) lastAte = mon;
        if (!open || hasTag(args, "weaken")) return;
        const item = args[2] ?? "";
        const from = tag(args, "from");
        const of = tag(args, "of");
        if (from && idOf(from) === "stealeat" && of) fact(touch(monOf(of)), `Ate ${item}`);
        else if (from && effectKind(from) === "move") fact(touch(mon), `${item} removed`);
        else fact(touch(mon), item);
        return;
      }
      case "-ability": {
        // An ability the channel shows (Intimidate, whose stages follow on the others' cards; Pressure; Trace): on its card.
        if (!args[2]) return;
        const from = tag(args, "from");
        fact(touch(monOf(args[1])), args[3] !== "boost" && from && idOf(effectName(from)) === "trace" ? `Traced ${args[2]}` : args[2]);
        return;
      }
      case "-prepare": {
        // A charging move's first turn (Solar Beam): only its user, unless a Power Herb fires it now.
        const mon = monOf(args[1]);
        if (open?.kind !== "move" || mon !== open.actor) return;
        open.declared.clear();
        fact(touch(mon, open), "Charging");
        return;
      }
      case "-weather": {
        if (hasTag(args, "upkeep")) return;
        const id = idOf(args[1] ?? "");
        const ended = !id || id === "none";
        // Rain Dance starts Rain: the move's name says it.
        const moveId = open?.kind === "move" ? idOf(open.title) : "";
        fieldFact(ended ? "Weather ended" : FIELD_NAMES[id] ?? args[1], !ended, WEATHER_MOVES.has(moveId) ? open!.title : undefined);
        return;
      }
      case "-fieldstart": fieldFact(effectName(args[1] ?? ""), true); return;
      case "-fieldend": fieldFact(`${effectName(args[1] ?? "")} ended`, false); return;
      case "-sidestart": case "-sideend": {
        const name = effectName(args[2] ?? "");
        const side = args[1]?.trim().startsWith("p1") ? "your side" : "opponent's side";
        fieldFact(`${name}${command === "-sideend" ? " ended" : ""} (${side})`, command === "-sidestart", name);
        return;
      }
      default:
        return;
    }
  }

  /** Abilities the channel shows (public): "-ability|p2a: X|Intimidate", "[from] ability: Rough Skin|[of] p1a: Garchomp". */
  function noteAbility(command: string, args: readonly string[]) {
    if (command === "-ability") {
      const mon = monOf(args[1]);
      if (mon && args[2]) mon.ability = args[2];
      return;
    }
    if (command === "-activate" && effectKind(args[2] ?? "") === "ability") {
      const mon = monOf(args[1]);
      if (mon) mon.ability = effectName(args[2]);
      return;
    }
    const from = tag(args, "from");
    if (!from || effectKind(from) !== "ability") return;
    const of = tag(args, "of");
    const owner = of ? monOf(of) : command.startsWith("-") ? monOf(args[1]) : null;
    if (owner) owner.ability = effectName(from);
  }

  /** A field fact joins the open step (unless its move's name already says it started) or waits for the end-of-turn step. */
  function fieldFact(text: string, started: boolean, effect: string = text) {
    if (!open) { pendingField.push(text); return; }
    if (started && open.kind === "move" && idOf(effect) === idOf(open.title)) return;
    stepResult(open, text);
  }

  return {
    push(lines) {
      for (let index = 0; index < lines.length; index++) line(lines[index], lines[index + 1]);
      close();
      pendingField = [];
    },
    turns() {
      return groups.map((group) => structuredClone(group));
    },
  };
}
