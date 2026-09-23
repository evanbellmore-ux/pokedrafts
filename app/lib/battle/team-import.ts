import {
  createBuild, defaultAbilityActive, getBuildStats, NATURES, parseIntegerInput, STATS, validateBuild,
} from "./model";
import type { MoveSlots } from "./move-defaults";
import { TERA_TYPES } from "./profiles";
import { championsRuntime, resolveRuntimeSpecies, type BattleRuntime } from "./runtime";
import { createSpeciesResolver, type SpeciesResolution } from "./species-identity";
import type { BattleBuild, BattleGame, BattleStat, SetConfiguration, StatTable } from "./types";

export type ImportFormat = "champions" | "traditional";
export type ImportDiagnostic = { line: number; severity: "error" | "warning" | "info"; message: string };
type SourceLine = { text: string; line: number };
/** Source values are separate copies, never the converted or subsequently edited build. */
export type ImportedSetSource = {
  format: ImportFormat;
  lines: SourceLine[];
  level?: number | null;
  training?: { label: string; values: StatTable<number | null> };
  ivs?: StatTable<number | null>;
  configuration: SetConfiguration;
};
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
  gender?: "M" | "F" | "N";
  shiny?: boolean;
  source?: ImportedSetSource;
};
export type ImportedTeam = {
  /** Source spread encoding, not the target game's rules. */
  format: ImportFormat;
  game?: BattleGame;
  runtimeIdentity?: string;
  /** An exported heading is a hint only; it never selects a game or encoding. */
  formatHint?: string;
  title: string | null;
  members: ImportedMember[];
  diagnostics: ImportDiagnostic[];
};

export const MAX_TEAM_IMPORT_BYTES = 64 * 1024;
export const MAX_TEAM_IMPORT_MEMBERS = 24;

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
const hiddenPowerTypes = TERA_TYPES.filter((type) => !["Normal", "Fairy", "Stellar"].includes(type));

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

type ImportResolution = SpeciesResolution & { gigantamax?: true };
type ImportResolver = (name: string) => ImportResolution;

function createImportResolver(runtime: BattleRuntime): ImportResolver {
  // Gmax placeholder rows are not battle species. Only source-verified aliases
  // can attach a factor to their actual species; never strip an arbitrary suffix.
  const resolveGmax = createSpeciesResolver(runtime.catalog.species.flatMap((species) =>
    species.canGigantamax ? (species.gmaxNames ?? []).map((name) => ({ id: species.id, name, calcName: name })) : []
  ), runtime.profile.label);
  return (name) => {
    const exact = resolveRuntimeSpecies(runtime, name);
    if (exact.status !== "unavailable") return exact;
    const gmax = resolveGmax(name);
    return gmax.status === "resolved" ? { ...gmax, gigantamax: true }
      : gmax.status === "ambiguous" ? gmax : exact;
  };
}

function headerIdentity(text: string, resolve: ImportResolver): { resolution: ImportResolution; speciesName: string; nickname?: string } {
  const group = finalGroup(text);
  // An explicit nickname (species) wins over punctuation aliases such as Mega (Blastoise).
  if (group?.prefix) {
    const resolution = resolve(group.value);
    if (resolution.status !== "unavailable") return { resolution, speciesName: group.value, nickname: group.prefix };
  }
  return { resolution: resolve(text), speciesName: text };
}

function resolveHeader(text: string, resolve: ImportResolver) {
  let identity = headerIdentity(text, resolve);
  let gender: SetConfiguration["gender"];
  // Keep a complete form alias (Indeedee (F)/(Female)) intact. Only then try an
  // individual gender suffix; it never chooses or changes the species/form.
  if (identity.resolution.status === "unavailable") {
    const match = text.match(/\s+\(([MFN])\)$/i);
    if (match) {
      gender = match[1].toUpperCase() as "M" | "F" | "N";
      identity = headerIdentity(text.slice(0, match.index).trim(), resolve);
    }
  }
  return { ...identity, gender };
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

function boundedInteger(value: string, label: string, minimum: number, maximum: number, line: number, report: Report) {
  const number = parseIntegerInput(value);
  if (number === null || number < minimum || number > maximum) {
    report(line, "error", `${label} must be a whole number from ${minimum} to ${maximum}, not "${value}".`);
    return null;
  }
  return number;
}

/** Bounded syntax only: target rules and availability are applied afterwards. */
function parseSetSyntax(lines: SourceLine[], format: ImportFormat, report: Report) {
  const first = lines[0];
  const parts = first.text.split("@");
  if (parts.length > 2) report(first.line, "error", "A set header can contain only one held item (@).");
  let item = parts.length > 1 ? parts[1].trim() : null;
  if (item === "") report(first.line, "error", "A held item name is required after @; omit @ for no item.");
  const fields = new Map<string, number>();
  if (item !== null) fields.set("item", first.line);
  const source: ImportedSetSource = { format, lines: lines.map((line) => ({ ...line })), configuration: {} };
  let ability: string | null = null;
  let nature: string | null = null;
  let shiny: boolean | undefined;
  let training = statTable(0);
  let ivs = statTable(31);
  const moves = emptyMoves();
  const moveLines = new Map<string, SourceLine>();
  let moveCount = 0;
  let typedHiddenPower: { type: string; line: number } | null = null;
  const configuration = source.configuration;

  for (const line of lines.slice(1)) {
    // The pinned Showdown exported-set parser accepts both - and ~ move prefixes.
    const moveLine = line.text.match(/^[-~]\s*(.*)$/);
    if (moveLine) {
      const slot = moveCount++;
      if (slot >= 4) {
        report(line.line, "error", "A set can contain at most four moves.");
        continue;
      }
      const name = moveLine[1];
      let id = catalogId(name);
      if (!id) {
        report(line.line, "error", "A move name is required after - or ~.");
        continue;
      }
      if (id.startsWith("hiddenpower") && id !== "hiddenpower") {
        // Showdown exports brackets but also accepts its unbracketed typed name.
        const type = hiddenPowerTypes.find((type) => catalogId(type) === id.slice("hiddenpower".length));
        const bracketsValid = !/[\[\]]/.test(name) || /^hidden\s+power\s+\[[a-z]+\]$/i.test(name);
        if (!type || !bracketsValid) report(line.line, "error", `Invalid Hidden Power type in "${name}". Use Hidden Power [Ice], for example.`);
        else if (typedHiddenPower && typedHiddenPower.type !== type) report(line.line, "error", "Conflicting Hidden Power move types.");
        else typedHiddenPower = { type, line: line.line };
        id = "hiddenpower";
      } else if (id === "hiddenpower" && /[\[\]]/.test(name)) {
        report(line.line, "error", "A typed Hidden Power move needs a valid type inside its brackets.");
      }
      moves[slot] = { moveId: id, origin: "imported", gameType: null };
      if (moveLines.has(id)) report(line.line, "error", `Duplicate move "${name}".`);
      else moveLines.set(id, { text: name, line: line.line });
      continue;
    }

    const property = line.text.match(/^([^:]+):\s*(.*)$/);
    const natureLine = line.text.match(/^(.+?)\s+nature$/i);
    const originalField = property?.[1].trim() ?? (natureLine ? "nature" : "");
    let field = originalField.toLowerCase().replace(/\s+/g, " ");
    const value = property?.[2].trim() ?? natureLine?.[1].trim() ?? "";
    const explicitPoints = ["sps", "stat points"].includes(field);
    const incompatiblePoints = format === "traditional" && explicitPoints;
    if (["evs", "sps", "stat points"].includes(field)) field = "training";
    if (field === "trait") field = "ability";
    if (!["item", "ability", "nature", "level", "training", "ivs", "shiny", "gender", "tera type", "gigantamax", "dynamax level", "happiness", "hidden power"].includes(field)) {
      report(line.line, "error", `Unsupported or unknown set line "${line.text}". Correct or remove it; only recognized Showdown set fields are imported.`);
      continue;
    }
    if (fields.has(field)) {
      report(line.line, "error", `Duplicate ${field === "training" ? "training (EVs/SPs/Stat Points)" : field} field (first supplied on line ${fields.get(field)}).`);
      continue;
    }
    fields.set(field, line.line);
    if (field === "item") item = value;
    else if (field === "ability") ability = value;
    else if (field === "nature") nature = value;
    else if (field === "level") source.level = boundedInteger(value, "Level", 1, 100, line.line, report);
    else if (field === "training") {
      const points = explicitPoints || format === "champions";
      const values = parseStats(line, value, points ? 32 : 252, points ? 66 : 510, 0, report);
      source.training = { label: originalField, values: { ...values } };
      training = incompatiblePoints ? statTable(null) : values;
      if (incompatiblePoints) report(line.line, "error", "Explicit Stat Points are incompatible with traditional EV/IV mode. Choose Champions mode only when targeting Champions; native games require original EVs/IVs, not reverse-converted points.");
    } else if (field === "ivs") {
      ivs = parseStats(line, value, 31, null, 31, report);
      source.ivs = { ...ivs };
      if (format === "champions") report(line.line, "error", "IV fields are incompatible with Champions Stat Points. Choose traditional mode for EV/IV conversion.");
    } else if (field === "shiny" || field === "gigantamax") {
      if (!/^(yes|no)$/i.test(value)) report(line.line, "error", `${field === "shiny" ? "Shiny" : "Gigantamax"} must be Yes or No.`);
      else if (field === "shiny") shiny = value.toLowerCase() === "yes";
      else configuration.gigantamax = value.toLowerCase() === "yes";
    } else if (field === "gender") {
      if (/^(m|male)$/i.test(value)) configuration.gender = "M";
      else if (/^(f|female)$/i.test(value)) configuration.gender = "F";
      else if (/^n$/i.test(value)) configuration.gender = "N";
      else report(line.line, "error", "Gender must be M, F, N, Male or Female.");
    } else if (field === "tera type" || field === "hidden power") {
      const types = field === "tera type" ? TERA_TYPES : hiddenPowerTypes;
      const type = types.find((type) => type.toLowerCase() === value.toLowerCase());
      if (!type) report(line.line, "error", `${field === "tera type" ? "Tera Type" : "Hidden Power"} needs a valid type${field === "hidden power" ? " other than Normal, Fairy or Stellar" : " (including Stellar)"}, not "${value}".`);
      else if (field === "tera type") configuration.teraType = type;
      else configuration.hiddenPowerType = type;
    } else if (field === "dynamax level" || field === "happiness") {
      const number = boundedInteger(value, field === "dynamax level" ? "Dynamax Level" : "Happiness", 0, field === "dynamax level" ? 10 : 255, line.line, report);
      if (number !== null) {
        if (field === "dynamax level") configuration.dynamaxLevel = number;
        else configuration.happiness = number;
      }
    }
  }
  if (typedHiddenPower) {
    if (configuration.hiddenPowerType && configuration.hiddenPowerType !== typedHiddenPower.type) {
      report(typedHiddenPower.line, "error", `Hidden Power move type ${typedHiddenPower.type} conflicts with Hidden Power: ${configuration.hiddenPowerType}.`);
    } else configuration.hiddenPowerType = typedHiddenPower.type;
    if (!fields.has("hidden power")) fields.set("hidden power", typedHiddenPower.line);
  }
  return { headerText: parts[0].trim(), item, ability, nature, shiny, training, ivs, moves, moveLines, moveCount, fields, source };
}

function parseMember(lines: SourceLine[], index: number, format: ImportFormat, runtime: BattleRuntime, resolve: ImportResolver): ImportedMember {
  const diagnostics: ImportDiagnostic[] = [];
  const report: Report = (line, severity, message) => diagnostics.push({ line, severity, message });
  const first = lines[0];
  const parsed = parseSetSyntax(lines, format, report);
  const { item, ability, nature, shiny, training, ivs, moves, fields, source } = parsed;
  const { speciesById, abilitiesById, itemsById, movesById, profile } = runtime;
  const label = profile.id === "champions" ? "Champions" : profile.label;
  const header = resolveHeader(parsed.headerText, resolve);
  if (header.resolution.status !== "resolved") report(first.line, "error", `${header.speciesName || "Missing species"}: ${header.resolution.reason}`);
  if (header.gender) {
    if (fields.has("gender")) report(fields.get("gender")!, "error", `Duplicate gender field (first supplied on line ${first.line}).`);
    else { source.configuration.gender = header.gender; fields.set("gender", first.line); }
  }
  if (header.resolution.gigantamax) {
    if (source.configuration.gigantamax === false) report(fields.get("gigantamax") ?? first.line, "error", "Gigantamax: No conflicts with the explicit Gmax species alias.");
    else source.configuration.gigantamax = true;
    if (!fields.has("gigantamax")) fields.set("gigantamax", first.line);
  }
  const speciesId = header.resolution.status === "resolved" ? header.resolution.speciesId : null;
  const species = speciesId ? speciesById.get(speciesId)! : null;
  const build = speciesId ? createBuild(speciesId, runtime) : null;
  const configuration = { ...source.configuration };
  // Match the pinned Showdown import default, but do not pretend it was explicit.
  if (!fields.has("happiness") && parsed.moveLines.has("frustration")) {
    configuration.happiness = 0;
    report(parsed.moveLines.get("frustration")!.line, "info", "Happiness omitted: using Showdown's Frustration default of 0.");
  }
  if (profile.training === "native" && format !== "traditional") {
    report(fields.get("training") ?? first.line, "error", `${label} requires traditional EV/IV source format. Champions Stat Points cannot be reverse-converted to a guessed native spread.`);
  }
  if (profile.training === "points" && fields.has("level") && source.level !== 50) {
    report(fields.get("level")!, "error", `Only explicit Level: 50 is supported in Champions, not "${source.level ?? "invalid"}".`);
  }

  for (const [id, line] of parsed.moveLines) {
    const move = movesById.get(id);
    if (!move) report(line.line, "error", `Move "${line.text}" is unavailable in the ${label} catalog.`);
    else if (species && !species.moves.includes(id)) report(line.line, "error", `${species.name} cannot learn ${move.name} in ${label}.`);
    else for (const reason of move.unsupported) report(line.line, "warning", `${move.name}: calculation unavailable. ${reason}`);
  }
  const itemId = item === null ? "" : catalogId(item);
  if (item !== null && (!itemId || !itemsById.has(itemId))) {
    report(fields.get("item") ?? first.line, "error", `Item "${item}" is unavailable in the ${label} catalog; omit the item for an empty slot.`);
  }
  if (ability !== null && !abilitiesById.has(catalogId(ability))) {
    report(fields.get("ability")!, "error", `Ability "${ability}" is unavailable in the ${label} catalog.`);
  }
  const selectedNature = nature === null ? null : NATURES.find((entry) => entry.name.toLowerCase() === nature.toLowerCase());
  if (nature !== null && !selectedNature) report(fields.get("nature")!, "error", `Unknown nature "${nature}".`);

  if (build && species) {
    // Manual creation may equip a required stone. Import never supplies one.
    build.itemId = itemId;
    if (ability !== null) build.abilityId = catalogId(ability);
    build.abilityActive = defaultAbilityActive(build.abilityId);
    if (nature !== null) build.nature = selectedNature?.name ?? nature;
    if (Object.keys(configuration).length) build.configuration = { ...build.configuration, ...configuration };
    // Import stores configuration and move prerequisites, never an active mechanic.
    if (build.game === "champions") {
      build.points = { ...training };
      if (format === "traditional") {
        for (const stat of STATS) {
          const ev = training[stat];
          const iv = ivs[stat];
          const points = ev === null || iv === null ? null : Math.floor((iv + Math.floor(ev / 4)) / 2) - 15;
          build.points[stat] = points;
          if (points !== null && points < 0) report(fields.get("ivs") ?? fields.get("training") ?? first.line, "error", `${stat.toUpperCase()} would require ${points} Stat Points. These level-50 EV/IV stats are below the Champions minimum; no clamping is applied.`);
        }
      }
    } else {
      build.native = {
        level: fields.has("level") ? source.level ?? null : 100,
        evs: format === "traditional" ? { ...training } : statTable(null),
        ivs: { ...ivs },
      };
      build.preparedMoves = moves.flatMap((slot) => slot.moveId ? [slot.moveId] : []);
    }

    const configFields: Record<string, string> = {
      teraType: "tera type", gigantamax: "gigantamax", dynamaxLevel: "dynamax level",
      happiness: "happiness", gender: "gender", hiddenPowerType: "hidden power",
    };
    for (const issue of validateBuild(build, runtime)) {
      const reasons = issue.field === "speciesId" ? species.unsupported
        : issue.field === "abilityId" && species.abilities.includes(build.abilityId) ? abilitiesById.get(build.abilityId)?.unsupported
          : issue.field === "itemId" ? itemsById.get(build.itemId)?.unsupported : undefined;
      const unsupported = reasons?.includes(issue.message) ?? false;
      const trainingIssue = issue.field.startsWith("points") || issue.field.startsWith("native.evs") || issue.field.startsWith("native.ivs");
      const sourceField = issue.field.startsWith("points") || issue.field.startsWith("native.evs") ? "training"
        : issue.field.startsWith("native.ivs") ? "ivs" : issue.field === "native.level" ? "level"
          : issue.field === "itemId" ? "item" : issue.field.startsWith("ability") ? "ability"
            : issue.field.startsWith("configuration.") ? configFields[issue.field.slice("configuration.".length)] : issue.field;
      const line = fields.get(sourceField) ?? first.line;
      // Do not hide required-item errors behind an item's coverage annotation.
      const alreadyReported = !unsupported && (
        (trainingIssue && diagnostics.some((entry) => entry.severity === "error" && [fields.get("training"), fields.get("ivs")].includes(entry.line)))
        || (issue.field === "nature" && nature !== null && !selectedNature)
        || (issue.field === "abilityId" && !abilitiesById.has(build.abilityId))
        || (issue.field === "itemId" && build.itemId && !itemsById.has(build.itemId) && !species.requiredItem && !species.requiredItems?.length)
      );
      if (!alreadyReported) report(line, unsupported ? "warning" : "error", unsupported ? `Calculation paused: ${issue.message}` : issue.message);
    }
    if (ability === null) report(first.line, "info", `Ability omitted: using ${abilitiesById.get(build.abilityId)?.name ?? build.abilityId}.`);
    if (nature === null) report(first.line, "info", `Nature omitted: using ${build.nature} (neutral).`);
  }

  if (configuration.teraType) report(fields.get("tera type") ?? first.line, "info", `Tera Type: ${configuration.teraType} retained; ${profile.tera ? "not activated by import" : `inactive in ${label}`}.`);
  if (configuration.gigantamax !== undefined) report(fields.get("gigantamax") ?? first.line, "info", `Gigantamax: ${configuration.gigantamax ? "Yes" : "No"} retained; ${profile.dynamax ? "not activated by import" : `inactive in ${label}`}.`);
  if (configuration.dynamaxLevel !== undefined) report(fields.get("dynamax level")!, "info", `Dynamax Level: ${configuration.dynamaxLevel} retained; ${profile.dynamax ? "not activated by import" : `inactive in ${label}`}.`);
  if (source.configuration.happiness !== undefined) report(fields.get("happiness")!, "info", `Happiness: ${configuration.happiness} retained${profile.generation === 7 ? " for Return/Frustration" : `; inactive in ${label}`}.`);
  if (configuration.hiddenPowerType) report(fields.get("hidden power")!, "info", `Hidden Power: ${configuration.hiddenPowerType} retained${profile.generation === 7 ? "; effective IVs are unchanged. A different innate-IV type requires explicit context before calculating Hidden Power" : `; inactive in ${label}`}.`);
  if (!fields.has("level")) report(first.line, "info", profile.training === "points" ? "Level omitted: targeting Champions level 50." : "Level omitted: using Showdown's native level 100 default, not level 50.");
  if (!fields.has("training")) report(first.line, "info", `Training omitted: using zero ${format === "champions" ? "Stat Points" : "EVs"}.`);
  else report(fields.get("training")!, "info", `Unlisted stats use zero ${format === "champions" ? "Stat Points" : "EVs"}.`);
  if (format === "traditional") report(fields.get("ivs") ?? first.line, "info", profile.training === "points"
    ? "Unlisted IVs default to 31. Traditional level-50 stats are converted to Stat Points without clamping or an extra point."
    : "Unlisted IVs default to 31. Native levels, EVs and IVs are retained without conversion or inferred hyper-training history.");
  if (item === null) report(first.line, "info", "Item omitted: no held item is equipped, including for Mega forms.");
  report(first.line, "info", "Full HP, healthy status and zero stat stages assumed. Rivalry requires known individual genders for both Pokémon.");
  if (header.nickname || shiny !== undefined) report(first.line, "info", "Nickname and shiny are cosmetic metadata only; they do not alter battle calculations.");
  if (parsed.moveCount < 4) report(first.line, "info", `${4 - parsed.moveCount} move slot${parsed.moveCount === 3 ? " remains" : "s remain"} empty; no suggested moves are added.`);

  const selectable = Boolean(build) && !diagnostics.some((entry) => entry.severity === "error");
  diagnostics.sort((a, b) => a.line - b.line);
  return {
    index, name: header.nickname ?? species?.name ?? header.speciesName, speciesId, build, moves,
    stats: selectable && build ? getBuildStats(build, runtime) : null,
    diagnostics, selectable, source,
    ...(header.nickname ? { nickname: header.nickname } : {}),
    ...(configuration.gender ? { gender: configuration.gender } : {}),
    ...(shiny !== undefined ? { shiny } : {}),
  };
}

/** Local-only Showdown/PokePaste text. Source format and target game are explicit and independent. */
export function parseTeamImport(text: string, format: ImportFormat, runtime: BattleRuntime = championsRuntime): ImportedTeam {
  const team: ImportedTeam = { format, game: runtime.profile.id, runtimeIdentity: runtime.identity, title: null, members: [], diagnostics: [] };
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
        const hint = heading[1].match(/^\[([^\]]+)\]\s*/);
        if (hint) team.formatHint = hint[1];
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
  const resolve = createImportResolver(runtime);
  team.members = blocks.map((lines, index) => parseMember(lines, index, format, runtime, resolve));
  if (team.diagnostics.some((entry) => entry.severity === "error")) team.members = team.members.map((member) => ({ ...member, selectable: false }));
  return team;
}
