import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import usage from "@/data/champions/training-usage.json";
import provenance from "@/vendor/showdown-sim.provenance.json";
import { Battle, TeamValidator, type ChoiceRequest, type PokemonSet } from "@pokedrafts/showdown-sim";
import { championsRuntime as runtime } from "@/app/lib/battle/runtime";
import { createMoveSlots } from "@/app/lib/battle/move-defaults";
import { FORMAT_FACTS } from "@/app/(app)/training/model/format-facts";
import { OPEN_TEAM_SHEETS } from "@/app/(app)/training/model/info";
import { USAGE_SOURCE_FACT } from "@/app/(app)/training/model/usage";
import { TRAINING_FORMAT_ID } from "@/app/(app)/training/model/view-types";
import { CACHE, SHOWDOWN_SOURCE } from "../../scripts/lib/champions-data/sources.mjs";

/**
 * Training's format facts (model/format-facts.ts) and information model against pinned Showdown c23d2e94 (SPEC §14.6
 * source test): the hash-checked source archive's text, and the bundled simulator built from it. Offline: a missing or
 * corrupt archive is a failure (`npm run data:champions` fetches it).
 */
const NAME = `${SHOWDOWN_SOURCE.repo}-${SHOWDOWN_SOURCE.revision}`;
const ARCHIVE = join(CACHE, `${NAME}.tar.gz`);
const PS = join(CACHE, NAME);
function source(file: string): string {
  if (!existsSync(ARCHIVE)) throw new Error(`The pinned Showdown archive is missing (${ARCHIVE}); run npm run data:champions.`);
  return readFileSync(join(PS, file), "utf8");
}
const fact = (term: string) => FORMAT_FACTS.find((entry) => entry.term === term)?.value;
/** The text of the object literal or function that starts at the first match of `start` (balanced braces). */
function block(text: string, start: string | RegExp): string {
  const at = typeof start === "string" ? text.indexOf(start) : text.search(start);
  if (at < 0) throw new Error(`Not found: ${start}`);
  const open = text.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(at, i + 1);
  }
  throw new Error(`Unbalanced: ${start}`);
}

const IVS = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
function set(speciesId: string, extra: Partial<PokemonSet> = {}): PokemonSet {
  const species = runtime.speciesById.get(speciesId)!;
  const moves = createMoveSlots(speciesId, "Doubles", runtime).flatMap((slot) => slot.moveId ? [runtime.movesById.get(slot.moveId)!.name] : []);
  return { name: species.name, species: species.name, item: "", ability: runtime.abilitiesById.get(species.abilities[0])!.name,
    moves, nature: "Hardy", gender: "M", evs: { ...ZERO }, ivs: { ...IVS }, level: 50, ...extra };
}
const FILLER = ["garchomp", "venusaur", "whimsicott", "sneasler", "archaludon", "farigiraf"];
function battle(p1: PokemonSet[], p2: PokemonSet[]): { battle: Battle; log: () => string[] } {
  const lines: string[] = [];
  const instance = new Battle({ formatid: TRAINING_FORMAT_ID, seed: [1, 2, 3, 4], send: (type, data) => { if (type === "update") lines.push(...(Array.isArray(data) ? data : [data]).flatMap((chunk) => chunk.split("\n"))); } });
  instance.setPlayer("p1", { name: "You", team: p1 });
  instance.setPlayer("p2", { name: "Training", team: p2 });
  return { battle: instance, log: () => { instance.sendUpdates(); return lines; } };
}

describe("pinned source archive", () => {
  it("is the hash-checked c23d2e94 archive the simulator package was built from", () => {
    const sha = createHash("sha256").update(readFileSync(ARCHIVE)).digest("hex");
    expect(sha).toBe(SHOWDOWN_SOURCE.sha256);
    expect(provenance.revision).toBe(SHOWDOWN_SOURCE.revision);
    expect(provenance.sourceArchiveSha256).toBe(SHOWDOWN_SOURCE.sha256);
    expect(fact("Rules")).toBe(`Pokémon Showdown ${SHOWDOWN_SOURCE.revision.slice(0, 8)}`);
  });
});

describe("FORMAT_FACTS against pinned Showdown (SPEC §5.10, §14.6)", () => {
  it("Format: config/formats.ts:288-293", () => {
    const entry = block(source("config/formats.ts"), `name: "${fact("Format")}"`);
    expect(entry).toContain("mod: 'champions'");
    expect(entry).toContain("gameType: 'doubles'");
    expect(entry).toContain("ruleset: ['Flat Rules', 'VGC Timer', 'Open Team Sheets']");
    expect(TRAINING_FORMAT_ID).toBe("gen9championsvgc2026regmc");
  });

  it("Battle, Teams and Clauses: data/mods/champions/rulesets.ts:28-32 Flat Rules", () => {
    const flat = block(source("data/mods/champions/rulesets.ts"), "flatrules: {");
    for (const rule of ["'Team Preview'", "'Species Clause'", "'Item Clause = 1'", "'Adjust Level = 50'", "'Picked Team Size = Auto'", "'Min Team Size = 6'"]) expect(flat).toContain(rule);
    expect(flat).toContain("banlist: ['Mythical', 'Restricted Legendary']");
    expect(fact("Battle")).toBe("Doubles · Level 50");
    expect(fact("Teams")).toBe("Bring 6, pick 4");
    expect(fact("Clauses")).toBe("Species Clause · Item Clause (1 each) · No Mythical or Restricted Legendary");
    // Picked Team Size = Auto is 4 in doubles (sim/dex-formats.ts:336-341).
    expect(source("sim/dex-formats.ts")).toMatch(/\['doubles', 'rotation'\]\.includes\(format\.gameType\) \? 4 :/);
  });

  it("Battle, Teams and Clauses as the bundled simulator plays them", () => {
    const { battle: instance } = battle(FILLER.map((id) => set(id)), FILLER.map((id) => set(id)));
    expect(instance.gameType).toBe("doubles");
    const request = instance.p1.activeRequest as Extract<ChoiceRequest, { teamPreview: true }>;
    expect(request.teamPreview).toBe(true);
    expect(request.maxChosenTeamSize).toBe(4);
    instance.makeChoices("team 1234", "team 1234");
    // Adjust Level = 50: the validator writes level 50 back into every set (sim/team-validator.ts:1136).
    const high = FILLER.map((id) => set(id, { level: 100 }));
    expect(new TeamValidator(TRAINING_FORMAT_ID).validateTeam(high)).toBeNull();
    expect(high.map((entry) => entry.level)).toEqual([50, 50, 50, 50, 50, 50]);
    const validator = new TeamValidator(TRAINING_FORMAT_ID);
    const legal = FILLER.map((id) => set(id));
    expect(validator.validateTeam(structuredClone(legal))).toBeNull();
    expect((validator.validateTeam(structuredClone(legal.slice(0, 5))) ?? []).join(" ")).toMatch(/at least 6/);
    expect((validator.validateTeam(structuredClone([...legal.slice(0, 5), legal[0]])) ?? []).join(" ")).toMatch(/Species Clause/);
    const items = legal.map((entry) => ({ ...entry, item: "Sitrus Berry" }));
    expect((validator.validateTeam(structuredClone(items)) ?? []).join(" ")).toMatch(/Item Clause/);
  });

  it("Mega Evolution: once per battle (sim/side.ts:779-781, sim/battle-actions.ts:1898-1916)", () => {
    expect(fact("Mega Evolution")).toBe("Once per battle");
    expect(source("sim/side.ts")).toContain("You can only mega-evolve once per battle");
    const megas = [set("charizard", { item: "Charizardite Y", moves: ["Heat Wave", "Protect"] }), set("gyarados", { item: "Gyaradosite", moves: ["Waterfall", "Protect"] }), ...FILLER.slice(2).map((id) => set(id))];
    const both = battle(megas, FILLER.map((id) => set(id)));
    both.battle.makeChoices("team 1234", "team 1234");
    expect(both.battle.choose("p1", "move 2 mega, move 2 mega")).toBe(false);
    both.battle.makeChoices("move 2 mega, move 2", "default");
    const request = both.battle.p1.activeRequest as Extract<ChoiceRequest, { active: unknown }>;
    expect(request.active.some((active) => active?.canMegaEvo)).toBe(false);
    expect(both.log().some((line) => line.startsWith("|-mega|p1a: Charizard|"))).toBe(true);
  });

  it("Terastallization: none in Champions (data/mods/champions/scripts.ts:180-181)", () => {
    expect(fact("Terastallization")).toBe("Not in Champions");
    expect(block(source("data/mods/champions/scripts.ts"), "canTerastallize(pokemon) {")).toContain("return null;");
    const { battle: instance } = battle(FILLER.map((id) => set(id)), FILLER.map((id) => set(id)));
    instance.makeChoices("team 1234", "team 1234");
    const request = instance.p1.activeRequest as Extract<ChoiceRequest, { active: unknown }>;
    expect(request.active.every((active) => !active.canTerastallize)).toBe(true);
  });

  it("Usage: data/champions/training-usage.json's Smogon source (addendum A1.1)", () => {
    expect(fact("Usage")).toBe(USAGE_SOURCE_FACT);
    expect(usage.source.format).toBe("gen9championsvgc2026regmb");
    const [year, month] = usage.source.month.split("-");
    expect(USAGE_SOURCE_FACT).toBe(`Smogon ${year}-${month} VGC Reg M-B`);
  });
});

describe("information model against pinned Showdown", () => {
  it("Stat Points: at most 32 per stat and 66 in total (sim/team-validator.ts:1306-1311, sim/dex-formats.ts:343-345)", () => {
    expect(source("sim/team-validator.ts")).toContain("has more than 32 Stat Points in");
    expect(source("sim/dex-formats.ts")).toMatch(/format\.mod\.startsWith\('champions'\)\)\s*\{\s*this\.evLimit = 66;/);
  });

  it("open team sheets show every category but Stat Points (sim/battle.ts:3184-3222): OPEN_TEAM_SHEETS", () => {
    const sheet = block(source("sim/battle.ts"), "showOpenTeamSheets() {");
    expect(sheet).toContain("item: set.item,");
    expect(sheet).toContain("ability: set.ability,");
    expect(sheet).toContain("moves: set.moves,");
    expect(sheet).toContain("nature: this.format.mod.startsWith('champions') ? set.nature : '',");
    expect(sheet).toContain("evs: null!,");
    expect(sheet).toContain("ivs: null!,");
    expect(OPEN_TEAM_SHEETS.open).toEqual({ statPoints: false, natures: true, items: true, abilities: true, moves: true });
    expect(OPEN_TEAM_SHEETS.exactHP).toBe(false);
    expect(OPEN_TEAM_SHEETS.brought).toBe(false);
  });

  // SPEC 10.1.2 entry silence: each of these abilities always shows a line when its holder enters (with a foe present and
  // its weather or terrain not up yet), so an entry without one rules it out.
  const ANNOUNCED: readonly [abilityId: string, speciesId: string, line: RegExp][] = [
    ["intimidate", "arcanine", /^\|-ability\|p1a: Arcanine\|Intimidate\|boost/],
    ["pressure", "kingambit", /^\|-ability\|p1a: Kingambit\|Pressure/],
    ["unnerve", "houndoom", /^\|-ability\|p1a: Houndoom\|Unnerve/],
    ["moldbreaker", "excadrill", /^\|-ability\|p1a: Excadrill\|Mold Breaker/],
    ["cloudnine", "altaria", /^\|-ability\|p1a: Altaria\|Cloud Nine/],
    ["supersweetsyrup", "hydrapple", /^\|-ability\|p1a: Hydrapple\|Supersweet Syrup/],
    ["drought", "torkoal", /^\|-weather\|SunnyDay\|\[from\] ability: Drought\|\[of\] p1a: Torkoal/],
    ["drizzle", "pelipper", /^\|-weather\|RainDance\|\[from\] ability: Drizzle\|\[of\] p1a: Pelipper/],
    ["sandstream", "tyranitar", /^\|-weather\|Sandstorm\|\[from\] ability: Sand Stream\|\[of\] p1a: Tyranitar/],
    ["snowwarning", "abomasnow", /^\|-weather\|Snowscape\|\[from\] ability: Snow Warning\|\[of\] p1a: Abomasnow/],
    ["grassysurge", "rillaboom", /^\|-fieldstart\|move: Grassy Terrain\|\[from\] ability: Grassy Surge\|\[of\] p1a: Rillaboom/],
    ["electricsurge", "pincurchin", /^\|-fieldstart\|move: Electric Terrain\|\[from\] ability: Electric Surge\|\[of\] p1a: Pincurchin/],
    ["psychicsurge", "indeedeef", /^\|-fieldstart\|move: Psychic Terrain\|\[from\] ability: Psychic Surge\|\[of\] p1a: Indeedee/],
  ];
  it.each(ANNOUNCED)("%s announces on entry", (abilityId, speciesId, line) => {
    const ability = runtime.abilitiesById.get(abilityId)!;
    expect(runtime.speciesById.get(speciesId)!.abilities).toContain(abilityId);
    const lead = set(speciesId, { ability: ability.name });
    const team = [lead, ...FILLER.filter((id) => id !== speciesId).slice(0, 5).map((id) => set(id))];
    const run = battle(team, FILLER.map((id) => set(id)));
    run.battle.makeChoices("team 1234", "team 1234");
    const lines = run.log();
    const start = lines.indexOf("|start");
    const turn = lines.indexOf("|turn|1");
    expect(lines.slice(start, turn).some((entry) => line.test(entry)), lines.slice(start, turn).join("\n")).toBe(true);
  });
});
