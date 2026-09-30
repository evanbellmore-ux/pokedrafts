import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import * as pokemonSprite from "@/app/components/PokemonSprite";
import { RosterPicker } from "@/app/(app)/calculator/LeagueMatchupPicker";
import type { CalculatorRosterState } from "@/app/(app)/calculator/roster-data";
import { createMatchup, getRosterPanel, reconcileRosters, rosterChoices, selectRosterPokemon } from "@/app/(app)/calculator/roster-prep";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createMoveSlots, usualAbility } from "@/app/lib/battle/move-defaults";
import { BATTLE_GAMES } from "@/app/lib/battle/profiles";
import { LEGACY_ROSTER_ALIASES, POOL_BUILDER_ROSTER_ALIASES, POOL_BUILDER_SLUG_NAMES, resolveRosterName } from "@/app/lib/battle/roster-identity";
import { championsRuntime, resolveRuntimeSpecies, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleGame } from "@/app/lib/battle/types";
import type { TeamRoster } from "@/app/(app)/leagues/[leagueId]/team/roster";

/**
 * League rosters store Pool Builder display names. For every Pool Builder row this
 * test derives the exact Showdown form from the row's PokéAPI slug (the test-side
 * map below, independent of the display-name table in roster-identity.ts), and
 * checks the resolved form's base stats and types against the row's own data.
 */

type Row = {
  slug: string; display_name: string; games: string[];
  hp: number; attack: number; defense: number; special_attack: number; special_defense: number; speed: number;
  type1: string; type2: string | null;
};
const rows = JSON.parse(readFileSync(join(process.cwd(), "data/pokemon/pokemon.json"), "utf8")) as Row[];

const toID = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/** PokéAPI slugs whose hyphen-stripped form is not the Showdown species id. */
const SLUG_TO_SHOWDOWN: Readonly<Record<string, string>> = {
  "aegislash-shield": "aegislash", "basculegion-female": "basculegionf", "basculegion-male": "basculegion",
  "basculin-red-striped": "basculin", "darmanitan-galar-standard": "darmanitangalar", "darmanitan-standard": "darmanitan",
  "deoxys-normal": "deoxys", "dudunsparce-two-segment": "dudunsparce", "eiscue-ice": "eiscue",
  "enamorus-incarnate": "enamorus", "floette-eternal": "floetteeternal", "frillish-male": "frillish",
  "giratina-altered": "giratina", "gourgeist-average": "gourgeist", "greninja-battle-bond": "greninjabond",
  "groudon-primal": "groudonprimal", "indeedee-female": "indeedeef", "indeedee-male": "indeedee",
  "jellicent-male": "jellicent", "keldeo-ordinary": "keldeo", "kyogre-primal": "kyogreprimal",
  "landorus-incarnate": "landorus", "lycanroc-midday": "lycanroc",
  // PokéAPI's default Maushold is Family of Four; Showdown's plain Maushold is Family of Three (2.3 vs 2.8 kg).
  "maushold-family-of-four": "mausholdfour",
  "meloetta-aria": "meloetta", "meowstic-female": "meowsticf", "meowstic-female-mega": "meowsticfmega",
  "meowstic-male": "meowstic", "meowstic-male-mega": "meowsticmmega", "mimikyu-disguised": "mimikyu",
  // PokéAPI's default Minior is the Meteor Form; Showdown's plain Minior is a Core.
  "minior-red": "minior", "minior-red-meteor": "miniormeteor",
  "morpeko-full-belly": "morpeko", "necrozma-dawn": "necrozmadawnwings", "necrozma-dusk": "necrozmaduskmane",
  "ogerpon-cornerstone-mask": "ogerponcornerstone", "ogerpon-hearthflame-mask": "ogerponhearthflame",
  "ogerpon-wellspring-mask": "ogerponwellspring", "oinkologne-female": "oinkolognef", "oinkologne-male": "oinkologne",
  "oricorio-baile": "oricorio", "palafin-zero": "palafin", "pumpkaboo-average": "pumpkaboo", "pyroar-male": "pyroar",
  "rockruff-own-tempo": "rockruffdusk", "shaymin-land": "shaymin",
  "squawkabilly-green-plumage": "squawkabilly", "squawkabilly-yellow-plumage": "squawkabillyyellow",
  "tatsugiri-curly": "tatsugiri",
  "tauros-paldea-aqua-breed": "taurospaldeaaqua", "tauros-paldea-blaze-breed": "taurospaldeablaze",
  "tauros-paldea-combat-breed": "taurospaldeacombat", "thundurus-incarnate": "thundurus",
  "tornadus-incarnate": "tornadus", "toxtricity-amped": "toxtricity", "urshifu-single-strike": "urshifu",
  "wishiwashi-solo": "wishiwashi", "wormadam-plant": "wormadam",
  "zygarde-10-power-construct": "zygarde10", "zygarde-50": "zygarde", "zygarde-50-power-construct": "zygarde",
};
const expectedId = (slug: string) => SLUG_TO_SHOWDOWN[slug] ?? toID(slug);

/**
 * Pool Builder rows whose game availability has no calculator form: only the
 * Eternal Flower Floette exists in Champions, and USUM has no Eternal Flower.
 * These must stay unresolved rather than map to another Floette.
 */
const NO_CALCULATOR_FORM: Readonly<Record<string, readonly string[]>> = {
  champions: ["Floette"],
  ultra_sun_ultra_moon: ["Floette (Eternal Flower)"],
};

/**
 * The Pool Builder carries current-generation stats. These species' stats changed
 * after the older game: Cresselia (Gen 9), Zacian and Zamazenta (Gen 9), Aegislash (Gen 8).
 */
const OLDER_GAME_STATS: Readonly<Record<string, readonly string[]>> = {
  sword_shield: ["cresselia", "zacian", "zaciancrowned", "zamazenta", "zamazentacrowned"],
  ultra_sun_ultra_moon: ["aegislash", "cresselia"],
};

const runtimes = {} as Record<BattleGame, BattleRuntime>;
beforeAll(async () => {
  for (const game of BATTLE_GAMES) runtimes[game] = await loadBattleRuntime(game);
});

function team(names: string[]): TeamRoster {
  return {
    id: "team-a", member_id: "member-a", total_points: names.length * 15, team_name: null, role: null,
    pokemon: names.map((name, index) => ({ name, points: 15, tier: 1, pick_number: index + 1, acquired: "draft" })),
  };
}

function rosterState(names: string[]): CalculatorRosterState {
  return {
    status: "ready", userId: "user-account", selectedLeagueId: "league-a", opponentId: "member-other",
    leagues: [{ id: "league-a", name: "Alpha", memberId: "member-a", teamName: "Home", draftStarted: true, draftCompleted: true }],
    teamsStatus: "ready", message: null, teamsMessage: null,
    data: {
      leagueId: "league-a",
      members: [
        { id: "member-a", role: "coach", team_name: "Home", draft_position: 1 },
        { id: "member-other", role: "coach", team_name: "Away", draft_position: 2 },
      ],
      teams: [team(names), { ...team(["Charizard"]), id: "team-other", member_id: "member-other" }],
    },
  };
}

describe("league roster names from the Pool Builder", () => {
  it.each(BATTLE_GAMES)("resolve every %s Pool Builder row to its exact form, with the row's stats and types", (game) => {
    const runtime = runtimes[game];
    const offered = rows.filter((row) => row.games.includes(game));
    expect(offered.length).toBeGreaterThan(300);
    const wrong: string[] = [];
    const unmatched: string[] = [];
    const statMismatches: string[] = [];
    // Every row, offered for this game or not: a name that resolves must land on its exact form.
    for (const row of rows) {
      const want = expectedId(row.slug);
      const got = resolveRosterName(runtime, row.display_name);
      const has = runtime.speciesById.has(want);
      if (got.status === "resolved") {
        if (!has || got.speciesId !== want) wrong.push(`${row.display_name} [${row.slug}] -> ${got.speciesId}, want ${has ? want : "no form"}`);
        const species = runtime.speciesById.get(got.speciesId)!;
        const stats = species.baseStats;
        const same = [stats.hp, stats.atk, stats.def, stats.spa, stats.spd, stats.spe].join("/")
          === [row.hp, row.attack, row.defense, row.special_attack, row.special_defense, row.speed].join("/")
          && species.types.join("/") === [row.type1, row.type2].filter(Boolean).join("/");
        if (!same && !(OLDER_GAME_STATS[game] ?? []).includes(species.id)) statMismatches.push(`${row.display_name} -> ${species.id}`);
      } else if (row.games.includes(game)) {
        if (has) wrong.push(`${row.display_name} [${row.slug}] -> ${got.status}, want ${want}`);
        else unmatched.push(row.display_name);
      }
    }
    expect(wrong).toEqual([]);
    expect(statMismatches).toEqual([]);
    expect(unmatched.sort()).toEqual([...(NO_CALCULATOR_FORM[game] ?? [])].sort());
    void offered;
  });

  it.each(BATTLE_GAMES)("resolve every %s Pool Builder row's slug like its display name, as the Pool Builder finds it", (game) => {
    const runtime = runtimes[game];
    const differ = rows.flatMap((row) => {
      const display = resolveRosterName(runtime, row.display_name);
      return display.status === "resolved" && JSON.stringify(resolveRosterName(runtime, row.slug)) !== JSON.stringify(display) ? [row.slug] : [];
    });
    expect(differ).toEqual([]);
  });

  it("maps each listed slug to its Pool Builder row's display name, only where the slug alone fails", () => {
    const bySlug = new Map(rows.map((row) => [row.slug, row.display_name]));
    for (const [slug, name] of Object.entries(POOL_BUILDER_SLUG_NAMES)) {
      expect(bySlug.get(slug), slug).toBe(name);
      expect(BATTLE_GAMES.some((game) => resolveRuntimeSpecies(runtimes[game], slug).status !== "resolved"), `${slug} resolves by itself`).toBe(true);
    }
  });

  it("keeps a table form for a slug typed with stray punctuation or without separators", () => {
    const sv = runtimes.scarlet_violet;
    expect(resolveRosterName(sv, "Minior`")).toEqual({ status: "resolved", speciesId: "miniormeteor" });
    expect(resolveRosterName(championsRuntime, "Maushold`")).toEqual({ status: "resolved", speciesId: "mausholdfour" });
    expect(resolveRosterName(championsRuntime, "Minior`").status).toBe("unavailable");
    expect(resolveRosterName(championsRuntime, "MeowsticMale")).toEqual({ status: "resolved", speciesId: "meowstic" });
    expect(resolveRosterName(championsRuntime, "TaurosPaldeaBlazeBreed")).toEqual({ status: "resolved", speciesId: "taurospaldeablaze" });
    // Gender words and Mega typed without separators, as the Pool Builder reads them.
    expect(resolveRosterName(championsRuntime, "MeowsticFemale")).toEqual({ status: "resolved", speciesId: "meowsticf" });
    expect(resolveRosterName(championsRuntime, "meowsticfemale")).toEqual({ status: "resolved", speciesId: "meowsticf" });
    expect(resolveRosterName(championsRuntime, "MeowsticFemaleMega")).toEqual({ status: "resolved", speciesId: "meowsticfmega" });
    expect(resolveRosterName(championsRuntime, "MeowsticMaleMega")).toEqual({ status: "resolved", speciesId: "meowsticmmega" });
    expect(resolveRosterName(sv, "IndeedeeFemale")).toEqual({ status: "resolved", speciesId: "indeedeef" });
  });

  it("accepts the other spellings the Pool Builder accepts for its rows", () => {
    const spellings: Record<string, string> = {
      "Ninetales-Alolan": "ninetalesalola", "Arcanine-Hisuian": "arcaninehisui", "Slowbro-Galarian": "slowbrogalar",
      "Meowstic (Male)": "meowstic", "Indeedee Male": "indeedee", "Basculegion (Male)": "basculegion",
      "Tauros-Paldea-Blaze-Breed": "taurospaldeablaze", "Paldean Tauros Aqua Breed": "taurospaldeaaqua",
      "Floette-Eternal-Flower": "floetteeternal", "lycanroc-midday": "lycanroc", "toxtricity-amped": "toxtricity",
    };
    for (const [name, speciesId] of Object.entries(spellings)) {
      expect(resolveRosterName(championsRuntime, name), name).toEqual({ status: "resolved", speciesId });
    }
    expect(rosterChoices("league-a", team(["Ninetales-Alolan"]), championsRuntime)[0]).toMatchObject({ speciesId: "ninetalesalola", reason: null });
    // A name the tables give a form keeps meaning that form: Champions has no Meteor Minior.
    expect(resolveRosterName(championsRuntime, "Minior").status).toBe("unavailable");
    expect(resolveRosterName(championsRuntime, "Not A Pokemon").status).toBe("unavailable");
  });

  it("keeps every alias in use and pointing at a real calculator form", () => {
    const names = new Set(rows.map((row) => row.display_name));
    for (const [name, alias] of Object.entries(POOL_BUILDER_ROSTER_ALIASES)) {
      const id = typeof alias === "string" ? alias : alias.speciesId;
      expect(names.has(name), `${name} is not a Pool Builder display name`).toBe(true);
      expect(BATTLE_GAMES.some((game) => runtimes[game].speciesById.has(id)), `${id} exists in no calculator catalog`).toBe(true);
      if (typeof alias !== "string") {
        const forms = BATTLE_GAMES.map((game) => runtimes[game].speciesById.get(id)).filter(Boolean);
        expect(forms.every((form) => form!.abilities.includes(alias.abilityId)), `${id} lacks ${alias.abilityId}`).toBe(true);
      }
    }
    for (const name of Object.keys(LEGACY_ROSTER_ALIASES)) expect(names.has(name), `${name} is a current display name`).toBe(false);
  });

  it("picks the five Reg M-C Pokémon that league rosters could not select", () => {
    const names = ["Paldean Tauros (Combat Breed)", "Paldean Tauros (Blaze Breed)", "Paldean Tauros (Aqua Breed)", "Floette (Eternal Flower)", "Mega Meowstic"];
    const choices = rosterChoices("league-a", team(names), championsRuntime);
    expect(choices.map((choice) => [choice.name, choice.speciesId, choice.reason])).toEqual([
      ["Paldean Tauros (Combat Breed)", "taurospaldeacombat", null],
      ["Paldean Tauros (Blaze Breed)", "taurospaldeablaze", null],
      ["Paldean Tauros (Aqua Breed)", "taurospaldeaaqua", null],
      ["Floette (Eternal Flower)", "floetteeternal", null],
      ["Mega Meowstic", "meowsticmmega", null],
    ]);
    expect(choices.every((choice) => choice.source?.kind === "league")).toBe(true);
  });

  it("resolves the legacy Paldean Tauros spelling to the Combat Breed, as the Pool Builder does", () => {
    for (const name of ["Paldean Tauros", "Tauros-Paldea"]) {
      expect(resolveRosterName(championsRuntime, name)).toEqual({ status: "resolved", speciesId: "taurospaldeacombat" });
    }
  });

  it("gives roster Minior and Maushold the Pool Builder's forms, while PokéPaste names keep Showdown's", () => {
    const sv = runtimes.scarlet_violet;
    expect(resolveRosterName(sv, "Minior")).toEqual({ status: "resolved", speciesId: "miniormeteor" });
    expect(resolveRosterName(sv, "Minior (Core)")).toEqual({ status: "resolved", speciesId: "minior" });
    expect(resolveRuntimeSpecies(sv, "Minior")).toEqual({ status: "resolved", speciesId: "minior" });
    expect(resolveRosterName(championsRuntime, "Minior").status).toBe("unavailable");

    expect(resolveRosterName(championsRuntime, "Maushold")).toEqual({ status: "resolved", speciesId: "mausholdfour" });
    expect(resolveRuntimeSpecies(championsRuntime, "Maushold")).toEqual({ status: "resolved", speciesId: "maushold" });
    expect(championsRuntime.speciesById.get("mausholdfour")!.weightkg).toBe(2.8);
  });

  it("keeps Maushold's usage-based quick moves for Family of Four", () => {
    for (const gameType of ["Doubles", "Singles"] as const) {
      const four = createMoveSlots("mausholdfour", gameType);
      expect(four).toEqual(createMoveSlots("maushold", gameType));
      expect(four.some((slot) => slot.origin === "usage")).toBe(true);
    }
  });

  it("builds the Power Construct Zygarde rows with Power Construct", () => {
    for (const game of ["sword_shield", "ultra_sun_ultra_moon"] as const) {
      const runtime = runtimes[game];
      const names = ["Zygarde (50% Power Construct)", "Zygarde (10% Power Construct)", "Zygarde"];
      const state = rosterState(names);
      const own = getRosterPanel(state, "own", runtime).choices;
      let matchup = reconcileRosters(createMatchup(0, runtime), state);
      const abilities = own.map((choice) => {
        matchup = selectRosterPokemon(matchup, "attacker", choice);
        return [choice.name, matchup.attacker.build.speciesId, matchup.attacker.build.abilityId];
      });
      expect(abilities).toEqual([
        ["Zygarde (50% Power Construct)", "zygarde", "powerconstruct"],
        ["Zygarde (10% Power Construct)", "zygarde10", "powerconstruct"],
        ["Zygarde", "zygarde", "aurabreak"],
      ]);
      // The plain row names Aura Break, so it stays apart where the usual ability (Random Battle's) is Power Construct.
      expect(usualAbility("zygarde", "Doubles", runtime)).toBe("powerconstruct");
    }
  });

  it("never falls back to a same-named base form when an aliased form is absent from the game", () => {
    const usum = runtimes.ultra_sun_ultra_moon;
    expect(resolveRosterName(usum, "Floette (Eternal Flower)")).toMatchObject({ status: "unavailable" });
    expect(resolveRosterName(usum, "Floette")).toEqual({ status: "resolved", speciesId: "floette" });
    expect(resolveRosterName(championsRuntime, "Floette")).toMatchObject({ status: "unavailable" });
  });

  it("shows a pasted cosmetic form with its family's sprite, and other forms with their own", () => {
    const sprite = vi.spyOn(pokemonSprite, "default");
    try {
      const choice = (speciesId: string) => ({ key: speciesId, name: championsRuntime.speciesById.get(speciesId)!.name, speciesId, source: null, reason: null });
      renderToStaticMarkup(createElement(RosterPicker, {
        panel: { status: "ready", teamName: "Pasted team", message: null, choices: [choice("florgeswhite"), choice("alcremiesaltedcream"), choice("charizardmegax"), choice("vivillonfancy")] },
        role: "own", side: "attacker", activeSource: null, onSelect: () => undefined, variant: "rail", runtime: championsRuntime,
      }));
      expect(sprite.mock.calls.map(([props]) => props.name)).toEqual(["Florges", "Alcremie", "Charizard-Mega-X", "Vivillon-Fancy"]);
      // Minior's cores keep their own artwork: the family's plain Minior is the Meteor Form's.
      sprite.mockClear();
      const sv = runtimes.scarlet_violet;
      renderToStaticMarkup(createElement(RosterPicker, {
        panel: { status: "ready", teamName: "Pasted team", message: null, choices: [
          { key: "miniorblue", name: "Minior-Blue", speciesId: "miniorblue", source: null, reason: null },
          { key: "minior", name: "Minior", speciesId: "minior", source: null, reason: null },
        ] },
        role: "own", side: "attacker", activeSource: null, onSelect: () => undefined, variant: "rail", runtime: sv,
      }));
      // Showdown's plain Minior is the Red Core.
      expect(sprite.mock.calls.map(([props]) => props.name)).toEqual(["Minior-Blue", "Minior-Red"]);
    } finally {
      sprite.mockRestore();
    }
  });

  it("shows native-game roster shortcuts with that game's types and the roster name's sprite", () => {
    const sv = runtimes.scarlet_violet;
    const state = rosterState(["Calyrex (Shadow Rider)", "Minior"]);
    const sprite = vi.spyOn(pokemonSprite, "default");
    try {
      const html = renderToStaticMarkup(createElement(RosterPicker, {
        state, role: "own", side: "attacker", activeSource: null, onSelect: () => undefined, variant: "rail", runtime: sv,
      }));
      expect(sprite.mock.calls.map(([props]) => props.name)).toEqual(["Calyrex (Shadow Rider)", "Minior"]);
      sprite.mockClear();
      // Duplicate league names are not selectable but still show the roster name's sprite.
      renderToStaticMarkup(createElement(RosterPicker, {
        state: rosterState(["Maushold", "Maushold", "Mega Meowstic"]), role: "own", side: "attacker", activeSource: null,
        onSelect: () => undefined, variant: "rail", runtime: championsRuntime,
      }));
      expect(sprite.mock.calls.map(([props]) => props.name)).toEqual(["Maushold", "Maushold", "Mega Meowstic"]);
      expect(html).toContain("Psychic");
      expect(html).toContain("Ghost");
      expect(html).toContain("Rock");
      expect(html).not.toContain("Unsupported");
    } finally {
      sprite.mockRestore();
    }
  });
});
