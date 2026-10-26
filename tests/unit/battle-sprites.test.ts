import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import data from "@/data/battle/sprites.json";
import { fixture } from "../fixtures/doubles-turn";
import DoublesSummary from "@/app/(app)/calculator/DoublesSummary";
import MatchupSummary from "@/app/(app)/calculator/MatchupSummary";
import { createMatchup, getMoveOwner, toggleMatchupMega, type PreparedMatchup } from "@/app/(app)/calculator/roster-prep";
import BattleSprite from "@/app/components/BattleSprite";
import { DOUBLES_SLOTS, type DoublesSlotId } from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { BATTLE_GAMES } from "@/app/lib/battle/profiles";
import { resolveRosterName } from "@/app/lib/battle/roster-identity";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import { battleSpriteUrl } from "@/app/lib/battle/sprites";
import { contentSecurityPolicy } from "@/app/lib/content-security-policy";
import { POKEAPI_SLUGS } from "@/scripts/build-battle-sprites";

/**
 * The calculator's and Training's slots show each Pokémon's sprite from data/battle/sprites.json (app/lib/battle/sprites.ts),
 * so neither reads the Pokémon dex (the database) or asks PokeAPI for a picture.
 */

const sprites: Readonly<Record<string, string>> = data.sprites;
const rows = JSON.parse(readFileSync(join(process.cwd(), "data/pokemon/pokemon.json"), "utf8")) as { display_name: string; sprite_url: string | null }[];
const fileOf = (url: string | null | undefined) => url?.replace(data.base, "").replace(/\.png$/, "");

let runtimes: BattleRuntime[] = [];
beforeAll(async () => {
  runtimes = await Promise.all(BATTLE_GAMES.map((game) => loadBattleRuntime(game)));
});
const allSpecies = () => runtimes.flatMap((runtime) => runtime.catalog.species);

describe("the battle sprite table", () => {
  it("has one PokeAPI sprite file for every species of the four battle catalogs, and no other", () => {
    expect(data.base).toBe("https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/");
    expect(Object.keys(sprites).sort()).toEqual([...new Set(allSpecies().map((species) => species.id))].sort());
    for (const [id, file] of Object.entries(sprites)) expect(file, id).toMatch(/^(\d+|\d+-[a-z0-9-]+|other\/official-artwork\/\d+)$/);
  });

  it("gives a league roster name its Pool Builder row's sprite, so it looks as it does in the league", () => {
    const different: string[] = [];
    for (const row of rows) {
      for (const runtime of runtimes) {
        const resolved = resolveRosterName(runtime, row.display_name);
        if (resolved.status === "resolved" && sprites[resolved.speciesId] !== fileOf(row.sprite_url)) different.push(`${row.display_name}: ${sprites[resolved.speciesId]}`);
      }
    }
    // Two Zygarde rows share their form with an earlier row: the same picture under another PokeAPI id.
    expect([...new Set(different)]).toEqual(["Zygarde (50% Power Construct): 718", "Zygarde (10%): 10118"]);
  });

  it("gives every Mega Evolution and regional form a sprite of its own", () => {
    const forms = allSpecies().filter((species) => /-Mega(-[XYZ])?$|-(Alola|Galar|Hisui|Paldea)/.test(species.name));
    expect(forms.length).toBeGreaterThan(150);
    for (const species of forms) expect(sprites[species.id], species.name).not.toBe(sprites[species.baseSpecies]);
  });

  it("gives battle-only and cosmetic forms their own sprites, and Ogerpon's Tera forms their mask's", () => {
    expect(Object.fromEntries(["aegislashblade", "mimikyubusted", "palafinhero", "morpekohangry", "castformsunny", "zygardecomplete", "arceusfire",
      "vivillonfancy", "alcremierubycream", "minior", "miniormeteor", "maushold", "mausholdfour"].map((id) => [id, sprites[id]]))).toEqual({
      aegislashblade: "10026", mimikyubusted: "10143", palafinhero: "10256", morpekohangry: "10187", castformsunny: "10013", zygardecomplete: "10120",
      arceusfire: "493-fire", vivillonfancy: "666-fancy", alcremierubycream: "869-ruby-cream-strawberry-sweet",
      // Showdown's plain Minior is the Red Core, its plain Maushold the Family of Three.
      minior: "10136", miniormeteor: "774", maushold: "10257", mausholdfour: "925",
    });
    expect([sprites.ogerpontealtera, sprites.ogerponwellspringtera, sprites.ogerponhearthflametera, sprites.ogerponcornerstonetera])
      .toEqual([sprites.ogerpon, sprites.ogerponwellspring, sprites.ogerponhearthflame, sprites.ogerponcornerstone]);
  });

  it("files a form's own sprite under its species' number", () => {
    const species = new Map(allSpecies().map((entry) => [entry.id, entry]));
    for (const [id, file] of Object.entries(sprites)) {
      const number = file.match(/^(\d+)-/)?.[1];
      if (number) expect(sprites[species.get(id)!.baseSpecies], id).toBe(number);
    }
  });

  it("names only catalog species in its PokeAPI name table, each with a sprite of its own", () => {
    const species = new Map(allSpecies().map((entry) => [entry.id, entry]));
    for (const id of Object.keys(POKEAPI_SLUGS)) {
      const entry = species.get(id);
      expect(entry, id).toBeDefined();
      if (entry!.baseSpecies !== id) expect(sprites[id], id).not.toBe(sprites[entry!.baseSpecies]);
    }
  });

  it("builds the URL from the file, and none for an id no catalog has", () => {
    expect(battleSpriteUrl("charizardmegax")).toBe("https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/10034.png");
    expect(battleSpriteUrl("vivillonfancy")).toBe("https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/666-fancy.png");
    expect(battleSpriteUrl("missingno")).toBeNull();
    expect(battleSpriteUrl("constructor")).toBeNull();
  });

  it("loads from a host the Content-Security-Policy allows for images", () => {
    const policy = contentSecurityPolicy({ nonce: "n", supabaseUrl: "https://example.supabase.co", development: false, https: true });
    const images = policy.split("; ").find((directive) => directive.startsWith("img-src "))!.split(" ");
    expect(images).toContain(new URL(data.base).origin);
  });
});

describe("BattleSprite", () => {
  it("is a decorative image of the species' sprite with a fixed size", () => {
    const html = renderToStaticMarkup(createElement(BattleSprite, { speciesId: "garchompmega", name: "Garchomp-Mega", size: "card" }));
    expect(html).toBe(`<img src="${battleSpriteUrl("garchompmega")}" alt="" width="48" height="48" loading="lazy" decoding="async" class="h-12 w-12 shrink-0 rounded-md object-contain bg-panel-hover"/>`);
    expect(renderToStaticMarkup(createElement(BattleSprite, { speciesId: "garchomp", name: "Garchomp", fainted: true }))).toContain('class="h-10 w-10 shrink-0 rounded-md opacity-50 grayscale object-contain');
  });

  it("shows the hidden letter tile for an id no catalog has, with no lookup", () => {
    const html = renderToStaticMarkup(createElement(BattleSprite, { speciesId: "missingno", name: "MissingNo." }));
    expect(html).toBe('<div aria-hidden="true" class="h-10 w-10 shrink-0 rounded-md flex items-center justify-center bg-panel-hover text-sm font-bold uppercase text-muted">M</div>');
  });
});

const IMG = /<img src="([^"]+)" alt="" width="48" height="48"[^>]*>/;

describe("the calculator's Pokémon cards", () => {
  function summary(matchup: PreparedMatchup) {
    return renderToStaticMarkup(createElement(MatchupSummary, {
      attacker: matchup.attacker, defender: matchup.defender, attack: matchup.attack, replacement: matchup.replacement,
      selectedRow: undefined, rollMode: "average", issues: { attacker: [], defender: [] }, movesControl: "moves",
      onBuildChange: vi.fn(), onHPChange: vi.fn(), onRosterSelect: vi.fn(), onShowMove: vi.fn(), onRollModeChange: vi.fn(),
      onActivateMove: vi.fn(), onToggleMega: vi.fn(), runtime: championsRuntime,
    }));
  }
  const cardOf = (html: string, side: "attacker" | "defender") => html.slice(html.indexOf(`data-summary-combatant="${side}"`)).split("data-summary-combatant=")[1];

  it("show each 1v1 Pokémon's sprite beside its name, and the Mega's once it Mega Evolves", () => {
    let matchup = createMatchup(0, championsRuntime);
    let html = summary(matchup);
    for (const side of ["attacker", "defender"] as const) {
      const card = cardOf(html, side);
      expect(card.match(IMG)?.[1], side).toBe(battleSpriteUrl(matchup[side].build.speciesId));
      // The sprite and the name share a line of their own; the Mega buttons wrap below them.
      expect(card).toMatch(/<div class="flex min-w-0 items-center gap-2"><img [^>]*><h3 /);
    }
    matchup = toggleMatchupMega(matchup, getMoveOwner(matchup.attacker), "charizardmegax");
    html = summary(matchup);
    expect(cardOf(html, "attacker").match(IMG)?.[1]).toBe(battleSpriteUrl("charizardmegax"));
  });

  it("show each 2v2 Pokémon's sprite on its card, faded once it has fainted", () => {
    const view = fixture({ species: { "own-left": "charizardmegay", "opponent-right": "rotomwash" } });
    view.cards["opponent-left"] = { ...view.cards["opponent-left"], fainted: true };
    const html = renderToStaticMarkup(createElement(DoublesSummary, {
      runtime: championsRuntime, cards: view.cards, names: view.names, turn: null, rollMode: "average", onRollModeChange: vi.fn(),
      replacement: null, movesControl: "moves-list", magicRoom: false, terrain: "",
      onBuildChange: vi.fn(), onHPChange: vi.fn(), onRosterSelect: vi.fn(), onToggleMega: vi.fn(), onToggleMechanic: vi.fn(),
      onActivateMove: vi.fn(), onChooseMove: vi.fn(), onShowMoves: vi.fn(), onTargetChange: vi.fn(), onShowStep: vi.fn(), onFixSettings: vi.fn(),
    }));
    const card = (slot: DoublesSlotId) => html.slice(html.indexOf(`data-doubles-slot="${slot}"`)).split("data-doubles-slot=")[1];
    for (const slot of DOUBLES_SLOTS) expect(card(slot).match(IMG)?.[1], slot).toBe(battleSpriteUrl(view.cards[slot].slot.build.speciesId));
    expect(card("own-left").match(IMG)?.[1]).toBe(battleSpriteUrl("charizardmegay"));
    expect(card("opponent-right").match(IMG)?.[1]).toBe(battleSpriteUrl("rotomwash"));
    expect(card("opponent-left").match(IMG)?.[0]).toContain("opacity-50 grayscale");
    expect(card("own-left").match(IMG)?.[0]).not.toContain("grayscale");
  });
});
