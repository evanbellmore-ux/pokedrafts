import { abilitiesById, itemsById, movesById, speciesById } from "./catalog";
import {
  createBuild, defaultAbilityActive, getBuildStats, NATURES, parseIntegerInput, STATS, validateBuild,
} from "./model";
import type { MoveSlots } from "./move-defaults";
import { resolveRosterSpecies, type SpeciesResolution } from "./species-identity";
import type { BattleBuild, BattleStat, StatTable } from "./types";

export type ImportFormat = "champions" | "traditional";
export type ImportDiagnostic = { line: number; severity: "error" | "warning" | "info"; message: string };
export type ImportedMember = {
  index: number;
  name: string;
  speciesId: string | null;
  build: BattleBuild | null;
  moves: MoveSlots;
  stats: StatTable | null;
  diagnostics: ImportDiagnostic[];
  selectable: boolean;
  nickname?: string;
  gender?: "M" | "F";
  shiny?: boolean;
};
export type ImportedTeam = {
  format: ImportFormat;
  title: string | null;
  members: ImportedMember[];
  diagnostics: ImportDiagnostic[];
};

export const MAX_TEAM_IMPORT_BYTES = 64 * 1024;
export const MAX_TEAM_IMPORT_MEMBERS = 24;

type SourceLine = { text: string; line: number };
type Report = (line: number, severity: ImportDiagnostic["severity"], message: string) => void;
const statTable = (value: number | null): StatTable<number | null> => ({ hp: value, atk: value, def: value, spa: value, spd: value, spe: value });
const emptyMoves = (): MoveSlots => [
  { moveId: null, origin: "empty", gameType: null }, { moveId: null, origin: "empty", gameType: null },
  { moveId: null, origin: "empty", gameType: null }, { moveId: null, origin: "empty", gameType: null },
];

// Only items, moves, abilities and stat labels use punctuation-insensitive IDs.
// Species identity must go through the gender-preserving, exact alias resolver.
function catalogId(value: string): string {
  return value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");
}

const statNames = new Map<string, BattleStat>([
  ["hp", "hp"], ["atk", "atk"], ["attack", "atk"], ["def", "def"], ["defense", "def"],
  ["spa", "spa"], ["spatk", "spa"], ["specialattack", "spa"],
  ["spd", "spd"], ["spdef", "spd"], ["specialdefense", "spd"], ["spe", "spe"], ["speed", "spe"],
]);

/** The final balanced group may contain a form name with its own parentheses. */
function finalGroup(text: string): { prefix: string; value: string } | null {
  if (!text.endsWith(")")) return null;
  let depth = 0;
  for (let i = text.length - 1; i >= 0; i--) {
    if (text[i] === ")") depth++;
    if (text[i] === "(" && --depth === 0) {
      return { prefix: text.slice(0, i).trim(), value: text.slice(i + 1, -1).trim() };
    }
  }
  return null;
}

function headerIdentity(text: string): { resolution: SpeciesResolution; speciesName: string; nickname?: string } {
  const group = finalGroup(text);
  // An explicit nickname (species) wins over punctuation aliases such as Mega (Blastoise).
  if (group?.prefix) {
    const resolution = resolveRosterSpecies(group.value);
    if (resolution.status !== "unavailable") return { resolution, speciesName: group.value, nickname: group.prefix };
  }
  return { resolution: resolveRosterSpecies(text), speciesName: text };
}

function parseHeader(source: SourceLine, report: Report) {
  const parts = source.text.split("@");
  if (parts.length > 2) report(source.line, "error", "A set header can contain only one held item (@).");
  const item = parts.length > 1 ? parts[1].trim() : null;
  if (item === "") report(source.line, "error", "A held item name is required after @; omit @ for no item.");
  let text = parts[0].trim();
  let identity = headerIdentity(text);
  let gender: "M" | "F" | undefined;
  // Keep a complete form alias (Indeedee (F)/(Female)) intact. Only then try an
  // individual gender suffix; it never chooses or changes the species/form.
  if (identity.resolution.status === "unavailable") {
    const match = text.match(/\s+\(([MF])\)$/i);
    if (match) {
      gender = match[1].toUpperCase() as "M" | "F";
      text = text.slice(0, match.index).trim();
      identity = headerIdentity(text);
    }
  }
  if (identity.resolution.status !== "resolved") {
    report(source.line, "error", `${identity.speciesName || "Missing species"}: ${identity.resolution.reason}`);
  }
  return { ...identity, item, gender };
}

function parseStats(source: SourceLine, value: string, maximum: number, totalLimit: number | null, initial: number, report: Report): StatTable<number | null> {
  const values = statTable(initial);
  const seen = new Set<BattleStat>();
  for (const segment of value.split("/")) {
    const match = segment.trim().match(/^(\S+)\s+(.+)$/);
    const stat = match ? statNames.get(catalogId(match[2])) : undefined;
    if (!match || !stat) {
      report(source.line, "error", `Invalid stat entry "${segment.trim()}". Use a whole number followed by HP, Atk, Def, SpA, SpD or Spe.`);
      continue;
    }
    if (seen.has(stat)) {
      report(source.line, "error", `Duplicate ${stat.toUpperCase()} stat entry.`);
      values[stat] = null;
      continue;
    }
    seen.add(stat);
    const number = parseIntegerInput(match[1]);
    if (number === null || number < 0 || number > maximum) {
      report(source.line, "error", `${stat.toUpperCase()} must be a whole number from 0 to ${maximum}, not "${match[1]}".`);
      values[stat] = null;
    } else values[stat] = number;
  }
  const total = STATS.reduce((sum, stat) => sum + (values[stat] ?? 0), 0);
  if (totalLimit !== null && total > totalLimit) {
    report(source.line, "error", `Use at most ${totalLimit} ${maximum === 32 ? "Stat Points" : "EVs"} (${total} allocated).`);
  }
  return values;
}

function parseMember(lines: SourceLine[], index: number, format: ImportFormat): ImportedMember {
  const diagnostics: ImportDiagnostic[] = [];
  const report: Report = (line, severity, message) => diagnostics.push({ line, severity, message });
  const first = lines[0];
  const header = parseHeader(first, report);
  const speciesId = header.resolution.status === "resolved" ? header.resolution.speciesId : null;
  const species = speciesId ? speciesById.get(speciesId)! : null;
  const build = speciesId ? createBuild(speciesId) : null;
  // createBuild intentionally equips required stones for manual entry. A paste
  // must explicitly supply its own item, even when the selected form is Mega.
  if (build) build.itemId = "";
  const moves = emptyMoves();
  const fields = new Map<string, number>();
  if (header.item !== null) fields.set("item", first.line);
  if (header.gender) fields.set("gender", first.line);
  let item = header.item;
  let ability: string | null = null;
  let nature: string | null = null;
  let gender = header.gender;
  let shiny: boolean | undefined;
  let training = statTable(0);
  let ivs = statTable(31);
  let moveCount = 0;
  const selectedMoves = new Set<string>();

  for (const source of lines.slice(1)) {
    const moveLine = source.text.match(/^-\s*(.*)$/);
    if (moveLine) {
      const slot = moveCount++;
      if (slot >= 4) {
        report(source.line, "error", "A set can contain at most four moves.");
        continue;
      }
      const id = catalogId(moveLine[1]);
      if (!id) {
        report(source.line, "error", "A move name is required after -.");
        continue;
      }
      moves[slot] = { moveId: id, origin: "imported", gameType: null };
      if (selectedMoves.has(id)) report(source.line, "error", `Duplicate move "${moveLine[1]}".`);
      selectedMoves.add(id);
      const move = movesById.get(id);
      if (!move) report(source.line, "error", `Move "${moveLine[1]}" is unavailable in the Champions catalog.`);
      else if (species && !species.moves.includes(id)) report(source.line, "error", `${species.name} cannot learn ${move.name} in Champions.`);
      else for (const reason of move.unsupported) report(source.line, "warning", `${move.name}: calculation unavailable. ${reason}`);
      continue;
    }

    const property = source.text.match(/^([^:]+):\s*(.*)$/);
    const natureLine = source.text.match(/^(.+?)\s+nature$/i);
    let field = property?.[1].trim().toLowerCase().replace(/\s+/g, " ") ?? (natureLine ? "nature" : "");
    const value = property?.[2].trim() ?? natureLine?.[1].trim() ?? "";
    const incompatiblePoints = format === "traditional" && ["sps", "stat points"].includes(field);
    if (["evs", "sps", "stat points"].includes(field)) {
      if (incompatiblePoints) {
        report(source.line, "error", "Explicit Stat Points are incompatible with traditional EV/IV mode. Choose Champions mode instead.");
      }
      field = "training";
    }
    if (!["item", "ability", "nature", "level", "training", "ivs", "shiny", "gender"].includes(field)) {
      report(source.line, "error", `Unsupported or unknown set line "${source.text}". Correct or remove it; battle mechanics such as Tera, Gigantamax and Happiness are not imported.`);
      continue;
    }
    if (fields.has(field)) {
      report(source.line, "error", `Duplicate ${field === "training" ? "training (EVs/SPs/Stat Points)" : field} field (first supplied on line ${fields.get(field)}).`);
      continue;
    }
    fields.set(field, source.line);
    if (field === "item") item = value;
    else if (field === "ability") ability = value;
    else if (field === "nature") nature = value;
    else if (field === "level") {
      if (parseIntegerInput(value) !== 50) report(source.line, "error", `Only explicit Level: 50 is supported, not "${value}".`);
    } else if (field === "training") {
      training = incompatiblePoints ? statTable(null)
        : parseStats(source, value, format === "champions" ? 32 : 252, format === "champions" ? 66 : 510, 0, report);
    } else if (field === "ivs") {
      if (format === "champions") report(source.line, "error", "IV fields are incompatible with Champions Stat Points. Choose traditional mode for EV/IV conversion.");
      else ivs = parseStats(source, value, 31, null, 31, report);
    } else if (field === "shiny") {
      if (!/^(yes|no)$/i.test(value)) report(source.line, "error", "Shiny must be Yes or No.");
      else shiny = value.toLowerCase() === "yes";
    } else if (field === "gender") {
      if (/^(m|male)$/i.test(value)) gender = "M";
      else if (/^(f|female)$/i.test(value)) gender = "F";
      else report(source.line, "error", "Gender must be M, F, Male or Female; gender is cosmetic metadata only.");
    }
  }

  const itemId = item === null ? "" : catalogId(item);
  if (item !== null && (!itemId || !itemsById.has(itemId))) {
    report(fields.get("item") ?? first.line, "error", `Item "${item}" is unavailable in the Champions catalog; omit the item for an empty slot.`);
  }
  if (ability !== null && !abilitiesById.has(catalogId(ability))) {
    report(fields.get("ability")!, "error", `Ability "${ability}" is unavailable in the Champions catalog.`);
  }
  const selectedNature = nature === null ? null : NATURES.find((entry) => entry.name.toLowerCase() === nature.toLowerCase());
  if (nature !== null && !selectedNature) report(fields.get("nature")!, "error", `Unknown nature "${nature}".`);

  if (build && species) {
    build.itemId = itemId;
    if (ability !== null) build.abilityId = catalogId(ability);
    build.abilityActive = defaultAbilityActive(build.abilityId);
    if (nature !== null) build.nature = selectedNature?.name ?? nature;
    build.points = { ...training };
    if (format === "traditional") {
      for (const stat of STATS) {
        const ev = training[stat];
        const iv = ivs[stat];
        const points = ev === null || iv === null ? null : Math.floor((iv + Math.floor(ev / 4)) / 2) - 15;
        build.points[stat] = points;
        if (points !== null && points < 0) {
          report(fields.get("ivs") ?? fields.get("training") ?? first.line, "error", `${stat.toUpperCase()} would require ${points} Stat Points. These level-50 EV/IV stats are below the Champions minimum; no clamping is applied.`);
        }
      }
    }

    for (const issue of validateBuild(build)) {
      const reasons = issue.field === "speciesId" ? species.unsupported
        : issue.field === "abilityId" && species.abilities.includes(build.abilityId) ? abilitiesById.get(build.abilityId)?.unsupported
          : issue.field === "itemId" ? itemsById.get(build.itemId)?.unsupported : undefined;
      const unsupported = reasons?.includes(issue.message) ?? false;
      const sourceField = issue.field.startsWith("points") ? "training"
        : issue.field === "itemId" ? "item" : issue.field.startsWith("ability") ? "ability" : issue.field;
      const line = fields.get(sourceField) ?? first.line;
      // Parser diagnostics already identify malformed training/nature values.
      // Keep required-stone errors even if the same item has a support warning.
      const alreadyReported = !unsupported && (
        (issue.field.startsWith("points") && diagnostics.some((entry) => entry.severity === "error" && [fields.get("training"), fields.get("ivs")].includes(entry.line)))
        || (issue.field === "nature" && nature !== null && !selectedNature)
        || (issue.field === "abilityId" && !abilitiesById.has(build.abilityId))
        || (issue.field === "itemId" && build.itemId && !itemsById.has(build.itemId) && !species.requiredItem)
      );
      if (!alreadyReported) report(line, unsupported ? "warning" : "error", unsupported ? `Calculation paused: ${issue.message}` : issue.message);
    }
    if (ability === null) report(first.line, "info", `Ability omitted: using ${abilitiesById.get(build.abilityId)?.name ?? build.abilityId}.`);
    if (nature === null) report(first.line, "info", `Nature omitted: using ${build.nature} (neutral).`);
  }

  if (!fields.has("level")) report(first.line, "info", "Level omitted: targeting Champions level 50.");
  if (!fields.has("training")) report(first.line, "info", `Training omitted: using zero ${format === "champions" ? "Stat Points" : "EVs"}.`);
  else report(fields.get("training")!, "info", `Unlisted stats use zero ${format === "champions" ? "Stat Points" : "EVs"}.`);
  if (format === "traditional") {
    report(fields.get("ivs") ?? first.line, "info", "Unlisted IVs default to 31. Traditional level-50 stats are converted to Stat Points without clamping or an extra point.");
  }
  if (item === null) report(first.line, "info", "Item omitted: no held item is equipped, including for Mega forms.");
  report(first.line, "info", "Full HP, healthy status and zero stat stages assumed. Gender metadata does not supply Rivalry battle context.");
  if (header.nickname || shiny !== undefined || gender !== undefined) report(first.line, "info", "Nickname, shiny and individual gender are cosmetic metadata only; they do not alter battle calculations.");
  if (moveCount < 4) report(first.line, "info", `${4 - moveCount} move slot${moveCount === 3 ? " remains" : "s remain"} empty; no suggested moves are added.`);

  const selectable = Boolean(build) && !diagnostics.some((entry) => entry.severity === "error");
  diagnostics.sort((a, b) => a.line - b.line);
  return {
    index, name: header.nickname ?? species?.name ?? header.speciesName, speciesId, build, moves,
    stats: selectable && build ? getBuildStats(build) : null,
    diagnostics, selectable,
    ...(header.nickname ? { nickname: header.nickname } : {}),
    ...(gender ? { gender } : {}),
    ...(shiny !== undefined ? { shiny } : {}),
  };
}

/** Bounded, local-only Showdown/PokePaste text. The caller explicitly chooses the training format. */
export function parseTeamImport(text: string, format: ImportFormat): ImportedTeam {
  const team: ImportedTeam = { format, title: null, members: [], diagnostics: [] };
  const report: Report = (line, severity, message) => team.diagnostics.push({ line, severity, message });
  if (text.length > MAX_TEAM_IMPORT_BYTES || new TextEncoder().encode(text).byteLength > MAX_TEAM_IMPORT_BYTES) {
    report(1, "error", "Team text exceeds the 64 KiB UTF-8 limit. Paste a smaller team.");
    return team;
  }
  if (format !== "champions" && format !== "traditional") {
    report(1, "error", "Choose Champions Stat Points or traditional EV/IV format explicitly.");
    return team;
  }
  const normalized = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const nonPlain = lines.findIndex((line) => /\||^\s*(?:[\[{]|```)/.test(line) || [...line].some((character) => {
    const code = character.charCodeAt(0);
    return (code < 32 && code !== 9) || code === 127;
  }));
  if (nonPlain !== -1) {
    report(nonPlain + 1, "error", "Only plain Showdown/PokePaste set text is supported, not JSON, packed teams, code fences or control characters.");
    return team;
  }
  const blocks: SourceLine[][] = [];
  let block: SourceLine[] = [];
  let headings = 0;
  const flush = () => { if (block.length) blocks.push(block); block = []; };
  for (let i = 0; i < lines.length; i++) {
    const value = lines[i].trim();
    if (!value) { flush(); continue; }
    if (value.startsWith("===")) {
      flush();
      headings++;
      const heading = value.match(/^===\s*(.*?)\s*===$/);
      if (headings > 1 || blocks.length) report(i + 1, "error", "Multiple team sections are not supported. Use one optional heading before all sets.");
      else if (!heading || !heading[1]) report(i + 1, "error", "Use an exported-team heading such as === Team name ===.");
      else {
        team.title = heading[1].replace(/^\[[^\]]+\]\s*/, "").trim() || null;
        if (!team.title) report(i + 1, "error", "The exported-team heading needs a team title.");
      }
      continue;
    }
    block.push({ text: value, line: i + 1 });
  }
  flush();
  if (!blocks.length) report(1, "error", "Paste at least one Pokémon set.");
  if (blocks.length > MAX_TEAM_IMPORT_MEMBERS) {
    report(blocks[MAX_TEAM_IMPORT_MEMBERS][0].line, "error", "Import at most 24 members at a time.");
    return team;
  }
  team.members = blocks.map((lines, index) => parseMember(lines, index, format));
  if (team.diagnostics.some((entry) => entry.severity === "error")) {
    team.members = team.members.map((member) => ({ ...member, selectable: false }));
  }
  return team;
}
