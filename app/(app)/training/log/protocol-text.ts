import { nameText, type DoublesSlotId, type NameParts } from "@/app/lib/battle/doubles-types";
import type { SideID } from "../model/showdown-types";
import type { LogLine, LogLineKind } from "../model/view-types";

// The battle log in our own words, from the p1 channel of the pinned Showdown protocol (sim/battle.ts:33-56: a `|split|p1`
// pair gives p1 its secret half, so your HP is exact and the AI's reads `n/100`, sim/pokemon.ts:2060-2073). Worker-only and
// pure: the page renders the LogLines it returns and never parses protocol. No Showdown flavour text (data/text/*.ts).

export type LogFormatter = {
  /** The p1 channel's lines, in order (one drain at a time). */
  push(lines: readonly string[]): void;
  /** Index 0: before `|turn|1` (Start: leads, entry abilities); index n: turn n, up to `|turn|n+1`. Fresh copies. */
  turns(): LogLine[][];
};

export type LogFormatterOptions = {
  /** Display name for a Pokémon from its side and Showdown ident name (Nickname Clause: the species name). Default: the name. */
  names?: (side: SideID, name: string) => string;
  /**
   * Each team's battle names (both sixes, as the team preview shows them). A name on both teams carries its side word
   * ("Incineroar (yours)", "Incineroar (opponent's)") in every line. Default: none.
   */
  teams?: Record<SideID, readonly string[]>;
};

/** Engine slot of a Showdown position for the page (you are p1): p2a stands across from own-right (SHOWDOWN_POSITION). */
export const SLOT_OF: Record<string, DoublesSlotId> = { p1a: "own-left", p1b: "own-right", p2a: "opponent-right", p2b: "opponent-left" };
/** The Showdown position of an engine slot (SLOT_OF reversed). */
export const POSITION_OF: Record<DoublesSlotId, string> = { "own-left": "p1a", "own-right": "p1b", "opponent-right": "p2a", "opponent-left": "p2b" };

/** "yours" / "opponent's" for a battle name both teams have (`teams`), else null: fixed for the whole battle. */
export function teamSideWord(teams: Record<SideID, readonly string[]> | undefined, side: SideID, name: string): NameParts["side"] {
  if (!teams || !teams.p1.includes(name) || !teams.p2.includes(name)) return null;
  return side === "p1" ? "yours" : "opponent's";
}
/**
 * The number of a Pokémon at `position` ("p2a") when the other position on its side shows the same name: its slot's place in
 * the side's slot order (own-left / opponent-left 1, the right slots 2; p2b is opponent-left, so 1). Else null.
 */
export function positionNumber(position: string | null, name: string, nameAt: (position: string) => string | null): 1 | 2 | null {
  const slot = position ? SLOT_OF[position] : undefined;
  if (!position || !slot) return null;
  const other = `${position.slice(0, 2)}${position[2] === "a" ? "b" : "a"}`;
  return nameAt(other) === name ? (slot.endsWith("left") ? 1 : 2) : null;
}
/**
 * The same Pokémon inside parentheses, so parentheses never nest: "Arcanine", "the opponent's Arcanine", "your Arcanine",
 * "Garchomp 2", "the opponent's Garchomp 1".
 */
export function innerName(parts: NameParts): string {
  const owner = parts.side === "yours" ? "your " : parts.side === "opponent's" ? "the opponent's " : "";
  return `${owner}${parts.base}${parts.number ? ` ${parts.number}` : ""}`;
}
export const STAT_NAMES: Record<string, string> = {
  atk: "Attack", def: "Defense", spa: "Sp. Atk", spd: "Sp. Def", spe: "Speed", accuracy: "Accuracy", evasion: "Evasion",
};
export const WEATHER_NAMES: Record<string, string> = {
  sunnyday: "Sun", raindance: "Rain", sandstorm: "Sandstorm", snowscape: "Snow", snow: "Snow", hail: "Hail",
  desolateland: "Harsh sunshine", primordialsea: "Heavy rain", deltastream: "Strong winds",
};
const STATUS_GAINED: Record<string, string> = {
  brn: "was burned", par: "was paralyzed", psn: "was poisoned", tox: "was badly poisoned", slp: "fell asleep", frz: "was frozen",
};
const STATUS_CURED: Record<string, string> = {
  brn: "is no longer burned", par: "is no longer paralyzed", psn: "is no longer poisoned", tox: "is no longer poisoned", slp: "woke up", frz: "thawed",
};
const DAMAGE_SOURCES: Record<string, string> = { brn: "burn", psn: "poison", tox: "poison", confusion: "confusion", recoil: "recoil" };
const CANT_REASONS: Record<string, string> = {
  par: "is fully paralyzed", slp: "is asleep", frz: "is frozen", flinch: "flinched", recharge: "must recharge",
  nopp: "has no PP left", ally: "is commanding",
};
/** Lines that carry no battle fact for the log (protocol bookkeeping, animations, team preview). */
export const IGNORED = new Set([
  "", "t:", "upkeep", "split", "request", "uhtml", "uhtmlchange", "gametype", "player", "teamsize", "gen", "tier", "rule",
  "clearpoke", "poke", "teampreview", "start", "raw", "-center", "debug", "j", "c", "l", "n", "inactive", "inactiveoff",
  "timer", "-anim", "seed", "rated", "title", "join", "leave", "chat", "html", "badge", "bigerror", "sentchoice", "error",
]);

type Mon = { side: SideID; name: string; slot: DoublesSlotId | null };
type HP = { current: number; maximum: number; exact: boolean };

/** "Life Orb" from "[from] item: Life Orb"; null without that tag. */
export function tag(args: readonly string[], name: "from" | "of"): string | null {
  const prefix = `[${name}]`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : null;
}
export function hasTag(args: readonly string[], name: string) {
  return args.some((arg) => arg === `[${name}]` || arg.startsWith(`[${name}]`));
}
/** "move: Protect", "ability: Intimidate", "item: Sitrus Berry" → the effect's name. */
export function effectName(effect: string): string {
  return effect.replace(/^(move|ability|item|pokemon):\s*/i, "").trim();
}
export function effectKind(effect: string): "move" | "ability" | "item" | null {
  const match = /^(move|ability|item):/i.exec(effect.trim());
  return match ? (match[1].toLowerCase() as "move" | "ability" | "item") : null;
}
/** Moves that protect their user this turn (stallingMove; PS/data/moves.ts protect, detect, kingsshield, spikyshield, banefulbunker, silktrap, burningbulwark, obstruct, maxguard, endure). */
export const PROTECTING_MOVES: ReadonlySet<string> = new Set(["protect", "detect", "kingsshield", "spikyshield", "banefulbunker", "silktrap", "burningbulwark", "obstruct", "maxguard", "endure"]);

export function idOf(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
export function parseHP(token: string | undefined): { current: number; maximum: number } | null {
  if (!token) return null;
  const first = token.trim().split(" ")[0];
  if (first === "0" || token.includes("fnt")) {
    const match = /^(\d+)\/(\d+)/.exec(first);
    return { current: 0, maximum: match ? Number(match[2]) : 0 };
  }
  const match = /^(\d+)\/(\d+)[gyr]?$/.exec(first);
  return match ? { current: Number(match[1]), maximum: Number(match[2]) } : null;
}
function signed(value: number) {
  return value > 0 ? `+${value}` : value < 0 ? `−${-value}` : "±0";
}
function joinAnd(parts: string[]) {
  return parts.length <= 2 ? parts.join(" and ") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

export function createLogFormatter(options: LogFormatterOptions = {}): LogFormatter {
  const display = options.names ?? ((_side: SideID, name: string) => name);
  const groups: LogLine[][] = [[]];
  /** Pokémon by "p1: Name". */
  const mons = new Map<string, Mon>();
  /** Who stands at "p1a" etc. */
  const positions = new Map<string, string>();
  const hp = new Map<string, HP>();
  const stages = new Map<string, Record<string, number>>();
  let started = false;
  let intimidate: { line: LogLine; parts: string[]; prefix: string } | null = null;

  const current = () => groups[groups.length - 1];
  function add(text: string, kind: LogLineKind, slots: (DoublesSlotId | null)[] = []) {
    const line: LogLine = { text, kind, slots: [...new Set(slots.filter((slot): slot is DoublesSlotId => !!slot))] };
    current().push(line);
    return line;
  }

  /** "p2a: Absol" → its key "p2: Absol", side, position key "p2a" (null for "p2: Absol"). */
  function parseIdent(ident: string | undefined): { key: string; side: SideID; name: string; position: string | null } | null {
    const match = /^(p[12])([ab])?:\s*(.*)$/.exec(ident?.trim() ?? "");
    if (!match) return null;
    const side = match[1] as SideID;
    return { key: `${side}: ${match[3]}`, side, name: match[3], position: match[2] ? `${side}${match[2]}` : null };
  }
  function monOf(ident: string | undefined): Mon | null {
    const parsed = parseIdent(ident);
    if (!parsed) return null;
    const known = mons.get(parsed.key);
    const slot = parsed.position ? SLOT_OF[parsed.position] ?? null : known?.slot ?? null;
    if (known) return { ...known, slot: parsed.position ? slot : known.slot };
    return { side: parsed.side, name: parsed.name, slot };
  }
  function nameOf(mon: Pick<Mon, "side" | "name">) {
    return display(mon.side, mon.name);
  }
  /** The name shown at a position now ("p2a"), or null when no one stands there. */
  function nameAt(position: string) {
    const key = positions.get(position);
    const mon = key ? mons.get(key) : undefined;
    return mon ? nameOf(mon) : null;
  }
  /**
   * A Pokémon's name parts: its display name, its team's side word when both teams have that name, and its number when the
   * other position on its side shows the same name (an Illusion), from `position` (the line's own ident; an Illusion twin
   * shares one entry in `mons`, so its slot there is only the last one written).
   */
  function partsOf(mon: Pick<Mon, "side" | "name">, position: string | null): NameParts {
    const base = nameOf(mon);
    return { base, side: teamSideWord(options.teams, mon.side, base), number: positionNumber(position, base, nameAt) };
  }
  /** "Garchomp", "Garchomp (yours)", "Garchomp (2)"; inner: the same inside parentheses ("the opponent's Arcanine"). */
  function who(ident: string | undefined): { text: string; inner: string; slot: DoublesSlotId | null } {
    const mon = monOf(ident);
    if (!mon) return { text: ident?.trim() || "Unknown", inner: ident?.trim() || "Unknown", slot: null };
    const parsed = parseIdent(ident);
    // A line naming it without a position ("p2: Absol") numbers it by the slot it stands in, if it still stands there.
    const fallback = !parsed?.position && mon.slot && parsed && positions.get(POSITION_OF[mon.slot]) === parsed.key ? POSITION_OF[mon.slot] : null;
    const parts = partsOf(mon, mon.slot ? parsed?.position ?? fallback : null);
    return { text: nameText(parts), inner: innerName(parts), slot: mon.slot };
  }
  function sideWords(sideIdent: string | undefined) {
    return sideIdent?.trim().startsWith("p1") ? "your side" : "the opponent's side";
  }
  function stageOf(key: string) {
    let table = stages.get(key);
    if (!table) { table = {}; stages.set(key, table); }
    return table;
  }
  function clearStages(key: string) {
    stages.delete(key);
  }
  function hpText(before: HP | undefined, after: HP) {
    if (after.exact) return `${before && before.exact ? before.current : after.maximum} → ${after.current} / ${after.maximum} HP`;
    const prior = before ? (before.exact ? Math.floor(100 * before.current / before.maximum) : before.current) : 100;
    return `${prior}% → ${after.current}%`;
  }
  /** " (Life Orb)", " (Rough Skin, Garchomp)", " (Rough Skin, the opponent's Garchomp)", " (Sandstorm)", " (burn)" from the line's [from]/[of]. */
  function sourceText(args: readonly string[]) {
    const from = tag(args, "from");
    if (!from) return "";
    const name = DAMAGE_SOURCES[idOf(from)] ?? effectName(from);
    const of = tag(args, "of");
    return of ? ` (${name}, ${who(of).inner})` : ` (${name})`;
  }
  function setHP(ident: string | undefined, token: string | undefined): { before: HP | undefined; after: HP } | null {
    const parsed = parseIdent(ident);
    const value = parseHP(token);
    if (!parsed || !value) return null;
    const before = hp.get(parsed.key);
    // On the p1 channel your HP is exact (`hp/maxhp`) and the AI's a percentage (`n/100`); `0 fnt` keeps the last maximum.
    const exact = parsed.side === "p1";
    const after: HP = exact
      ? { current: value.current, maximum: value.maximum || before?.maximum || 0, exact: true }
      : { current: value.current, maximum: 100, exact: false };
    hp.set(parsed.key, after);
    return { before, after };
  }
  function closeIntimidate() {
    if (!intimidate) return;
    intimidate.line.text = intimidate.parts.length ? `${intimidate.prefix}: ${intimidate.parts.join(", ")}.` : `${intimidate.prefix}.`;
    intimidate = null;
  }

  function placeAt(position: string, key: string, side: SideID, name: string) {
    const previous = positions.get(position);
    if (previous && previous !== key) {
      const old = mons.get(previous);
      if (old) mons.set(previous, { ...old, slot: null });
      clearStages(previous);
    }
    positions.set(position, key);
    mons.set(key, { side, name, slot: SLOT_OF[position] ?? null });
    return previous && previous !== key ? mons.get(previous) ?? null : null;
  }

  /** The previous protocol line's command, Pokémon and move: a protect move's own "-singleturn" repeats its "move" line. */
  let previous: { command: string; key: string | null; move: string } = { command: "", key: null, move: "" };

  function line(raw: string, next: string | undefined) {
    if (!raw.startsWith("|")) return;
    const args = raw.slice(1).split("|");
    const command = args[0];
    const before = previous;
    if (!IGNORED.has(command)) previous = { command, key: parseIdent(args[1])?.key ?? null, move: idOf(args[2] ?? "") };
    if (intimidate && command !== "-unboost" && command !== "-boost" && command !== "-fail" && command !== "-immune" && command !== "-item" && command !== "-activate") closeIntimidate();
    if (IGNORED.has(command)) return;
    if (hasTag(args, "silent")) return;

    switch (command) {
      case "turn": {
        closeIntimidate();
        started = true;
        const turn = Number(args[1]);
        while (groups.length <= turn) groups.push([]);
        return;
      }
      case "switch": case "drag": case "replace": {
        const parsed = parseIdent(args[1]);
        if (!parsed?.position) return;
        const slot = SLOT_OF[parsed.position];
        const leaving = command === "replace" ? null : positions.get(parsed.position);
        const old = leaving && leaving !== parsed.key ? mons.get(leaving) : null;
        const oldFainted = old ? hp.get(leaving!)?.current === 0 : false;
        // The Pokémon leaving is named as it stood there, before the switch.
        const oldName = old ? nameText(partsOf(old, parsed.position)) : null;
        placeAt(parsed.position, parsed.key, parsed.side, parsed.name);
        const value = parseHP(args[3]);
        if (value) setHP(args[1], args[3]);
        const name = nameText(partsOf(parsed, parsed.position));
        const from = tag(args, "from");
        const reason = from ? ` (${effectName(from)})` : "";
        if (command === "replace") add(`Illusion ended: ${name}.`, "form", [slot]);
        else if (command === "drag") add(`${name} was dragged in${reason}.`, "switch", [slot]);
        else if (old && !oldFainted && started) add(`${name} switched in for ${oldName}${reason}.`, "switch", [slot]);
        else add(`${name} sent out${reason}.`, "switch", [slot]);
        return;
      }
      case "swap": {
        const subject = parseIdent(args[1]);
        if (!subject?.position) return;
        const target = `${subject.side}${Number(args[2]) === 0 ? "a" : "b"}`;
        const other = positions.get(target);
        // Both are named as they stood before the swap (their numbers, for look-alikes, follow the slot afterwards).
        const mover = who(args[1]);
        const otherMon = other ? mons.get(other) : undefined;
        const otherText = other ? nameText(partsOf(otherMon ?? { side: subject.side, name: other }, target)) : null;
        if (other && other !== subject.key) {
          positions.set(subject.position, other);
          if (otherMon) mons.set(other, { ...otherMon, slot: SLOT_OF[subject.position] });
        } else positions.delete(subject.position);
        positions.set(target, subject.key);
        mons.set(subject.key, { side: subject.side, name: subject.name, slot: SLOT_OF[target] });
        // Without a partner (unreachable: Ally Switch fails alone) it only moved.
        add(otherText ? `${mover.text} and ${otherText} switched places.` : `${mover.text} moved.`, "info", [mover.slot, SLOT_OF[target]]);
        return;
      }
      case "move": {
        const actor = who(args[1]);
        const move = args[2] ?? "a move";
        const spread = args.find((arg) => arg.startsWith("[spread]"));
        if (args.some((arg) => arg === "[notarget]")) {
          add(`${actor.text} used ${move}: no target.`, "move", [actor.slot]);
          return;
        }
        if (spread) {
          const slots = spread.slice("[spread]".length).trim().split(",").map((position) => SLOT_OF[position.trim()]).filter(Boolean);
          const foes = slots.filter((slot) => actor.slot ? slot.startsWith(actor.slot.startsWith("own") ? "opponent" : "own") : true);
          const allies = slots.filter((slot) => !foes.includes(slot));
          const names = [
            ...(foes.length === 2 ? ["both foes"] : foes.map((slot) => whoAt(slot))),
            ...allies.map((slot) => whoAt(slot)),
          ];
          add(`${actor.text} used ${move}${names.length ? ` → ${joinAnd(names)}` : ""}.`, "move", [actor.slot, ...slots]);
          return;
        }
        const target = args[3] ? who(args[3]) : null;
        const self = target && parseIdent(args[3])?.key === parseIdent(args[1])?.key;
        add(`${actor.text} used ${move}${target && !self ? ` → ${target.text}` : ""}.`, "move", [actor.slot, self ? null : target?.slot ?? null]);
        return;
      }
      case "cant": {
        const subject = who(args[1]);
        const reason = args[2] ?? "";
        const kind = effectKind(reason);
        const known = CANT_REASONS[idOf(reason)];
        if (known) add(`${subject.text} ${known}.`, "fail", [subject.slot]);
        else if (args[3]) add(`${subject.text} can't use ${args[3]} (${effectName(reason)}).`, "fail", [subject.slot]);
        else add(`${subject.text} can't move (${kind ? effectName(reason) : reason || "no reason given"}).`, "fail", [subject.slot]);
        return;
      }
      case "-damage": case "-heal": case "-sethp": {
        const subject = who(args[1]);
        const change = setHP(args[1], args[2]);
        if (!change) return;
        const kind: LogLineKind = command === "-heal" || (command === "-sethp" && change.before && change.after.current > change.before.current) ? "heal" : "damage";
        add(`${subject.text}: ${hpText(change.before, change.after)}${sourceText(args)}.`, kind, [subject.slot, tag(args, "of") ? who(tag(args, "of")!).slot : null]);
        return;
      }
      case "faint": {
        const subject = who(args[1]);
        const parsed = parseIdent(args[1]);
        if (parsed) {
          const before = hp.get(parsed.key);
          hp.set(parsed.key, { current: 0, maximum: before?.maximum ?? 100, exact: before?.exact ?? false });
          clearStages(parsed.key);
        }
        add(`${subject.text} fainted.`, "faint", [subject.slot]);
        return;
      }
      case "-supereffective": add(`Super effective on ${who(args[1]).text}.`, "info", [who(args[1]).slot]); return;
      case "-resisted": add(`Not very effective on ${who(args[1]).text}.`, "info", [who(args[1]).slot]); return;
      case "-crit": add(`Critical hit on ${who(args[1]).text}.`, "info", [who(args[1]).slot]); return;
      case "-immune": {
        const subject = who(args[1]);
        const from = tag(args, "from");
        if (intimidate && from) { intimidate.parts.push(`${nameOfIdent(args[1])} unaffected (${effectName(from)})`); return; }
        add(`${subject.text} is immune${from ? ` (${effectName(from)})` : ""}.`, "info", [subject.slot]);
        return;
      }
      case "-miss": {
        const source = who(args[1]);
        const target = args[2] ? who(args[2]) : null;
        add(target ? `Missed ${target.text}.` : `${source.text} missed.`, "info", [source.slot, target?.slot ?? null]);
        return;
      }
      case "-fail": {
        const subject = who(args[1]);
        if (intimidate) { const from = tag(args, "from"); intimidate.parts.push(`${nameOfIdent(args[1])} unaffected${from ? ` (${effectName(from)})` : ""}`); return; }
        const effect = args[2] && !args[2].startsWith("[") ? ` (${effectName(args[2])})` : "";
        add(`It failed${effect}: ${subject.text}.`, "fail", [subject.slot]);
        return;
      }
      case "-block": {
        const subject = who(args[1]);
        const move = args[3] ? effectName(args[3]) : "the move";
        add(`${subject.text} blocked ${move} (${effectName(args[2] ?? "")}).`, "fail", [subject.slot]);
        return;
      }
      case "-notarget": add(args[1] ? `${who(args[1]).text}: no target.` : "No target.", "fail", [args[1] ? who(args[1]).slot : null]); return;
      case "-nothing": add("Nothing happened.", "info"); return;
      case "-ohko": add("One-hit KO.", "info"); return;
      case "-hitcount": add(`Hit ${args[2]} time${args[2] === "1" ? "" : "s"}.`, "info", [who(args[1]).slot]); return;
      case "-prepare": add(`${who(args[1]).text} is preparing ${args[2]}.`, "info", [who(args[1]).slot]); return;
      case "-mustrecharge": add(`${who(args[1]).text} must recharge.`, "info", [who(args[1]).slot]); return;
      case "-singleturn": {
        const subject = who(args[1]);
        const effect = effectName(args[2] ?? "");
        const of = tag(args, "of");
        if (/^(protect|detect|spikyshield|kingsshield|banefulbunker|silktrap|burningbulwark|obstruct|maxguard|endure)$/.test(idOf(effect))) {
          // "-singleturn|X|Protect" right after X's own protecting move line ("used Protect.", "used Detect.": Detect sets the
          // same Protect volatile, PS/data/moves.ts detect volatileStatus) says the same thing once more.
          if (before.command === "move" && before.key === parseIdent(args[1])?.key && PROTECTING_MOVES.has(before.move)) return;
          add(`${subject.text}: ${effect}.`, "status", [subject.slot]);
        } else if (idOf(effect) === "helpinghand" && of) {
          add(`Helping Hand: ${who(of).text} helps ${subject.text}.`, "status", [subject.slot, who(of).slot]);
        } else add(`${subject.text}: ${effect}.`, "status", [subject.slot]);
        return;
      }
      case "-activate": {
        const subject = who(args[1]);
        const effect = args[2] ?? "";
        const name = effectName(effect);
        const kind = effectKind(effect);
        const of = tag(args, "of");
        const id = idOf(name);
        if (intimidate && kind === "ability") { intimidate.parts.push(`${nameOfIdent(args[1])} unaffected (${name})`); return; }
        if (["protect", "detect", "spikyshield", "kingsshield", "banefulbunker", "silktrap", "burningbulwark", "obstruct", "maxguard"].includes(id)) {
          add(`${subject.text} protected itself (${name}).`, "fail", [subject.slot]);
        } else if (id === "confusion") add(`${subject.text} is confused.`, "status", [subject.slot]);
        else if (id === "poltergeist" && args[3]) add(`${name}: ${subject.text} holds ${effectName(args[3])}.`, "item", [subject.slot]);
        else if (kind === "move" && of && ["bind", "wrap", "firespin", "whirlpool", "sandtomb", "magmastorm", "infestation", "snaptrap", "thundercage", "clamp"].includes(id)) {
          add(`${subject.text} is trapped by ${name} (${who(of).inner}).`, "status", [subject.slot, who(of).slot]);
        } else if (kind === "ability" || kind === "item") add(`${name} (${subject.inner}).`, kind, [subject.slot]);
        else {
          const details = args.slice(3).filter((arg) => arg && !arg.startsWith("[")).map(effectName);
          add(`${name}: ${subject.text}${details.length ? ` · ${details.join(" · ")}` : ""}.`, "info", [subject.slot, of ? who(of).slot : null]);
        }
        return;
      }
      case "-status": {
        const subject = who(args[1]);
        add(`${subject.text} ${STATUS_GAINED[args[2]] ?? `has ${args[2]}`}${sourceText(args)}.`, "status", [subject.slot]);
        return;
      }
      case "-curestatus": {
        const subject = who(args[1]);
        add(`${subject.text} ${STATUS_CURED[args[2]] ?? `is cured of ${args[2]}`}${sourceText(args)}.`, "status", [subject.slot]);
        return;
      }
      case "-cureteam": add(`${who(args[1]).text}'s team was cured${sourceText(args)}.`, "status", [who(args[1]).slot]); return;
      case "-boost": case "-unboost": {
        const subject = who(args[1]);
        const parsed = parseIdent(args[1]);
        const stat = args[2];
        const amount = Number(args[3] ?? 0) * (command === "-unboost" ? -1 : 1);
        const table = parsed ? stageOf(parsed.key) : {};
        const now = Math.max(-6, Math.min(6, (table[stat] ?? 0) + amount));
        table[stat] = now;
        const label = STAT_NAMES[stat] ?? stat;
        if (intimidate) { intimidate.parts.push(`${nameOfIdent(args[1])} ${label} ${signed(amount)}${sourceText(args)}`); return; }
        add(`${subject.text}: ${label} ${signed(amount)} (now ${signed(now)})${sourceText(args)}.`, "boost", [subject.slot]);
        return;
      }
      case "-setboost": {
        const subject = who(args[1]);
        const parsed = parseIdent(args[1]);
        if (parsed) stageOf(parsed.key)[args[2]] = Number(args[3]);
        add(`${subject.text}: ${STAT_NAMES[args[2]] ?? args[2]} set to ${signed(Number(args[3]))}${sourceText(args)}.`, "boost", [subject.slot]);
        return;
      }
      case "-clearboost": {
        const parsed = parseIdent(args[1]);
        if (parsed) clearStages(parsed.key);
        add(`${who(args[1]).text}: stat changes cleared${sourceText(args)}.`, "boost", [who(args[1]).slot]);
        return;
      }
      case "-clearallboost": stages.clear(); add("Every Pokémon's stat changes were cleared.", "boost"); return;
      case "-clearnegativeboost": {
        const parsed = parseIdent(args[1]);
        if (parsed) { const table = stageOf(parsed.key); for (const key of Object.keys(table)) if (table[key] < 0) table[key] = 0; }
        add(`${who(args[1]).text}: lowered stats restored${sourceText(args)}.`, "boost", [who(args[1]).slot]);
        return;
      }
      case "-clearpositiveboost": {
        const parsed = parseIdent(args[1]);
        if (parsed) { const table = stageOf(parsed.key); for (const key of Object.keys(table)) if (table[key] > 0) table[key] = 0; }
        add(`${who(args[1]).text}: raised stats cleared${args[3] ? ` (${effectName(args[3])})` : ""}.`, "boost", [who(args[1]).slot]);
        return;
      }
      case "-invertboost": {
        const parsed = parseIdent(args[1]);
        if (parsed) { const table = stageOf(parsed.key); for (const key of Object.keys(table)) table[key] = -table[key]; }
        add(`${who(args[1]).text}: stat changes inverted.`, "boost", [who(args[1]).slot]);
        return;
      }
      case "-copyboost": {
        const subject = parseIdent(args[1]);
        const source = parseIdent(args[2]);
        if (subject && source) stages.set(subject.key, { ...stageOf(source.key) });
        add(`${who(args[1]).text} copied ${who(args[2]).text}'s stat changes.`, "boost", [who(args[1]).slot, who(args[2]).slot]);
        return;
      }
      case "-swapboost": {
        const a = parseIdent(args[1]);
        const b = parseIdent(args[2]);
        if (a && b) { const first = { ...stageOf(a.key) }; stages.set(a.key, { ...stageOf(b.key) }); stages.set(b.key, first); }
        add(`${who(args[1]).text} and ${who(args[2]).text} swapped stat changes.`, "boost", [who(args[1]).slot, who(args[2]).slot]);
        return;
      }
      case "-weather": {
        if (hasTag(args, "upkeep")) return;
        const id = idOf(args[1] ?? "");
        if (!id || id === "none") { add("The weather ended.", "field"); return; }
        const from = tag(args, "from");
        const of = tag(args, "of");
        const source = [from ? effectName(from) : null, of ? who(of).inner : null].filter(Boolean).join(", ");
        add(`${WEATHER_NAMES[id] ?? args[1]} started${source ? ` (${source})` : ""}.`, "field", [of ? who(of).slot : null]);
        return;
      }
      case "-fieldstart": case "-fieldend": {
        const name = effectName(args[1] ?? "");
        const from = tag(args, "from");
        const of = tag(args, "of");
        const source = [from ? effectName(from) : null, of ? who(of).inner : null].filter(Boolean).join(", ");
        add(command === "-fieldstart" ? `${name} started${source ? ` (${source})` : ""}.` : `${name} ended.`, "field", [of ? who(of).slot : null]);
        return;
      }
      case "-sidestart": add(`${effectName(args[2] ?? "")} started on ${sideWords(args[1])}.`, "field"); return;
      case "-sideend": add(`${effectName(args[2] ?? "")} ended on ${sideWords(args[1])}.`, "field"); return;
      case "-swapsideconditions": add("Side conditions swapped.", "field"); return;
      case "-start": {
        const subject = who(args[1]);
        const effect = args[2] ?? "";
        const id = idOf(effectName(effect));
        if (id === "confusion") add(`${subject.text} is confused${hasTag(args, "fatigue") ? " (fatigue)" : ""}.`, "status", [subject.slot]);
        else if (id === "substitute") add(`${subject.text} put up a Substitute.`, "status", [subject.slot]);
        else if (id === "typechange") add(`${subject.text}'s type is now ${args[3] ?? "changed"}${sourceText(args)}.`, "status", [subject.slot]);
        else if (/^perish\d$/.test(id)) add(`${subject.text}: Perish count ${id.slice(-1)}.`, "status", [subject.slot]);
        else add(`${subject.text}: ${effectName(effect)} started${sourceText(args)}.`, "status", [subject.slot]);
        return;
      }
      case "-end": {
        const subject = who(args[1]);
        const id = idOf(effectName(args[2] ?? ""));
        if (id === "confusion") add(`${subject.text} is no longer confused.`, "status", [subject.slot]);
        else if (id === "substitute") add(`${subject.text}'s Substitute faded.`, "status", [subject.slot]);
        else add(`${subject.text}: ${effectName(args[2] ?? "")} ended.`, "status", [subject.slot]);
        return;
      }
      case "-item": {
        const subject = who(args[1]);
        const item = args[2] ?? "an item";
        const from = tag(args, "from");
        const of = tag(args, "of");
        if (intimidate) { intimidate.parts.push(`${nameOfIdent(args[1])} ${item}`); return; }
        if (from && effectKind(from) === "ability" && of) add(`${effectName(from)} (${who(of).inner}): ${subject.text} holds ${item}.`, "item", [subject.slot, who(of).slot]);
        else if (from && effectKind(from) === "move") add(`${subject.text} received ${item} (${effectName(from)}).`, "item", [subject.slot]);
        else add(`${subject.text} holds ${item}${from ? ` (${effectName(from)})` : ""}.`, "item", [subject.slot]);
        return;
      }
      case "-enditem": {
        const subject = who(args[1]);
        const item = args[2] ?? "its item";
        const from = tag(args, "from");
        const of = tag(args, "of");
        if (hasTag(args, "eat")) add(`${subject.text} ate its ${item}.`, "item", [subject.slot]);
        // A resist berry: the [eat] line comes first, then this one as the hit is halved (PS/data/items.ts habanberry …).
        else if (hasTag(args, "weaken")) add(`${item} weakened the hit on ${subject.text}.`, "item", [subject.slot]);
        else if (from && idOf(from) === "stealeat" && of) add(`${who(of).text} ate ${subject.text}'s ${item}.`, "item", [subject.slot, who(of).slot]);
        else if (from && effectKind(from) === "move") add(`${effectName(from)} removed ${subject.text}'s ${item}.`, "item", [subject.slot, of ? who(of).slot : null]);
        else add(`${subject.text} used its ${item}${from ? ` (${effectName(from)})` : ""}.`, "item", [subject.slot]);
        return;
      }
      case "-ability": {
        const subject = who(args[1]);
        const ability = args[2] ?? "";
        const from = tag(args, "from");
        const of = tag(args, "of");
        if (args[3] === "boost") {
          const line = add(`${ability} (${subject.inner})`, "ability", [subject.slot]);
          intimidate = { line, parts: [], prefix: `${ability} (${subject.inner})` };
          return;
        }
        if (from && idOf(effectName(from)) === "trace" && of) add(`${subject.text} traced ${ability} from ${who(of).text}.`, "ability", [subject.slot, who(of).slot]);
        else add(`${ability} (${subject.inner})${from && idOf(effectName(from)) !== idOf(ability) ? ` · ${effectName(from)}` : ""}.`, "ability", [subject.slot]);
        return;
      }
      case "-endability": add(`${who(args[1]).text}'s ability was suppressed${sourceText(args)}.`, "ability", [who(args[1]).slot]); return;
      case "detailschange": {
        const nextArgs = next?.slice(1).split("|");
        if (nextArgs && (nextArgs[0] === "-mega" || nextArgs[0] === "-primal") && parseIdent(nextArgs[1])?.key === parseIdent(args[1])?.key) return;
        add(`${who(args[1]).text} changed form: ${(args[2] ?? "").split(",")[0]}.`, "form", [who(args[1]).slot]);
        return;
      }
      case "-mega": add(`${who(args[1]).text} Mega Evolved${args[3] ? ` (${args[3]})` : ""}.`, "form", [who(args[1]).slot]); return;
      case "-primal": add(`${who(args[1]).text} underwent Primal Reversion.`, "form", [who(args[1]).slot]); return;
      case "-formechange": add(`${who(args[1]).text} changed form: ${args[2]}.`, "form", [who(args[1]).slot]); return;
      // With its source when one is shown ("[from] ability: Imposter"), as the board's card then shows that ability.
      case "-transform": add(`${who(args[1]).text} transformed into ${who(args[2]).text}${sourceText(args)}.`, "form", [who(args[1]).slot, who(args[2]).slot]); return;
      case "-terastallize": add(`${who(args[1]).text} Terastallized: ${args[2]}.`, "form", [who(args[1]).slot]); return;
      case "win": add(args[1] === "You" ? "You won." : "The AI won.", "result"); return;
      case "tie": add("Tie.", "result"); return;
      case "message": case "-message": case "-hint": if (args[1]) add(args.slice(1).join(" "), "info"); return;
      default:
        add(`${command}: ${args.slice(1).filter(Boolean).join(" · ")}`, "info");
    }
  }
  /** The Pokémon standing in `slot` by name ("—" when no one does). */
  function whoAt(slot: DoublesSlotId) {
    const position = POSITION_OF[slot];
    const key = positions.get(position);
    const mon = key ? mons.get(key) : undefined;
    return mon ? nameText(partsOf(mon, position)) : "—";
  }
  /** A list entry or subject by name (Intimidate's targets: "Incineroar (yours) Attack −1"). */
  function nameOfIdent(ident: string) {
    return who(ident).text;
  }

  return {
    push(lines) {
      for (let index = 0; index < lines.length; index++) line(lines[index], lines[index + 1]);
      closeIntimidate();
    },
    turns() {
      return groups.map((group) => group.map((each) => ({ ...each, slots: [...each.slots] })));
    },
  };
}
