import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import BattleBoard from "@/app/(app)/training/board/BattleBoard";
import BenchStrip from "@/app/(app)/training/board/BenchStrip";
import TeamPanels from "@/app/(app)/training/board/TeamPanels";
import type { BoardView } from "@/app/(app)/training/model/view-types";
import TeamPreview from "@/app/(app)/training/preview/TeamPreview";
import { createSetupDraft, emptySource, resolveTeam } from "@/app/(app)/training/setup/team-draft";
import TeamSourcePanel from "@/app/(app)/training/setup/TeamSourcePanel";
import { DOUBLES_SLOTS } from "@/app/lib/battle/doubles-types";
import { battleSpriteUrl } from "@/app/lib/battle/sprites";
import { boardView, OPPONENT_ROSTER, PREVIEW_REQUEST, rosterState, runtime, suggestionsFor, trainingSetup } from "../fixtures/training";

// Every Pokémon box on the Training screens shows its sprite from the bundled table (app/lib/battle/sprites.ts), decorative
// beside the name: the board's cards, the bench, the team panels, team preview and Choose 6.

/** Each decorative sprite in the markup, in order: its URL and its size, "faded" when it is grey. */
function sprites(html: string) {
  return [...html.matchAll(/<img src="([^"]+)" alt="" width="(\d+)"[^>]*class="([^"]*)"/g)]
    .map(([, src, size, classes]) => `${src.replace(/^.*\/sprites\/pokemon\/|\.png$/g, "")} ${size}${classes.includes("grayscale") ? " faded" : ""}`);
}
const file = (speciesId: string) => battleSpriteUrl(speciesId)!.replace(/^.*\/sprites\/pokemon\/|\.png$/g, "");
/** One part of the markup: from the element with `attribute` up to the next one with it, or to `end`. */
function part(html: string, attribute: string, value: string, end?: string) {
  const rest = html.slice(html.indexOf(`${attribute}="${value}"`)).split(`${attribute}=`)[1];
  return end ? rest.slice(0, rest.indexOf(end)) : rest;
}

describe("Training's Pokémon boxes", () => {
  it("show each active Pokémon's form on its board card, faded once it has fainted, and nothing in an empty slot", () => {
    const base = boardView();
    // The AI's Absol has Mega Evolved: its card shows the Mega's sprite.
    const board: BoardView = {
      ...base,
      active: { ...base.active, "opponent-right": { ...base.active["opponent-right"]!, speciesId: "absolmega" }, "own-right": { ...base.active["own-right"]!, fainted: true } },
    };
    const html = renderToStaticMarkup(createElement(BattleBoard, { board }));
    expect(DOUBLES_SLOTS.map((slot) => sprites(part(html, "data-training-card", slot)))).toEqual([
      [`${file("garchomp")} 48`], [`${file("gyarados")} 48 faded`], [`${file("ampharos")} 48`], [`${file("absolmega")} 48`],
    ]);
    expect(file("absolmega")).not.toBe(file("absol"));
    // The sprite sits beside the name, which stays the card's heading.
    expect(part(html, "data-training-card", "own-left")).toMatch(/<div class="flex min-w-0 items-center gap-2"><img [^>]*><h3 [^>]*>Garchomp<\/h3><\/div>/);
    const empty = renderToStaticMarkup(createElement(BattleBoard, { board: { ...board, active: { ...board.active, "own-left": null } } }));
    expect(sprites(part(empty, "data-training-card", "own-left"))).toEqual([]);
  });

  it("show each benched Pokémon's sprite, faded once it has fainted, and none for the ones not seen", () => {
    const html = renderToStaticMarkup(createElement(BenchStrip, { board: boardView() }));
    expect(sprites(html)).toEqual([`${file("incineroar")} 32`, `${file("aerodactyl")} 32 faded`, `${file("annihilape")} 32`]);
  });

  it("show your brought Pokémon and the opponent's sheet with their sprites in the team panels", () => {
    const board = boardView();
    const html = renderToStaticMarkup(createElement(TeamPanels, { board, setup: trainingSetup(), runtime }));
    // In play, in the back, then fainted.
    expect(sprites(part(html, "data-training-own-summary", "true", "data-training-opponent-sheet"))).toEqual(
      [`${file("garchomp")} 40`, `${file("gyarados")} 40`, `${file("incineroar")} 40`, `${file("aerodactyl")} 40`].map((each, index) => index === 3 ? `${each} faded` : each),
    );
    expect(sprites(part(html, "data-training-opponent-sheet", "true"))).toEqual(OPPONENT_ROSTER.map((name) => `${file(name.toLowerCase())} 40`));
  });

  it("show your six and the opponent's sheet at team preview", () => {
    const setup = trainingSetup();
    const html = renderToStaticMarkup(createElement(TeamPreview, {
      runtime, setup, request: PREVIEW_REQUEST, lastPreview: null, ai: { status: "idle" }, onConfirm: () => undefined,
    }));
    expect(sprites(html)).toEqual([...setup.own.members, ...setup.opponent.members].map((member) => `${file(member.speciesId)} 40`));
  });

  it("show each Choose 6 row and the folded line's six; a league Mega shows the base form it battles as", () => {
    const names = ["Mega Charizard X", "Garchomp", "Gyarados", "Incineroar", "Aerodactyl", "Aegislash"];
    const state = rosterState(names, OPPONENT_ROSTER);
    const source = emptySource();
    const team = resolveTeam(source, state, "own", suggestionsFor(createSetupDraft(), state).own, runtime);
    const html = renderToStaticMarkup(createElement(TeamSourcePanel, {
      role: "own", team, source, ownMode: source.mode, runtime, visibility: null, problems: null, moveOptions: {}, shared: new Set<string>(), reveal: 0,
      rosters: { state, selectLeague() {}, selectOpponent() {}, refresh() {} },
      onSource() {}, onRetrySuggest() {}, onLoadMoves() {},
    }));
    const six = ["charizard", "garchomp", "gyarados", "incineroar", "aerodactyl", "aegislash"].map(file);
    expect(sprites(part(html, "data-training-chosen", "own", "data-training-member"))).toEqual(six.map((each) => `${each} 32`));
    // The rows in the list's order (their keys are JSON, escaped in the markup).
    expect(html.split("data-training-member=").slice(1).map(sprites)).toEqual(six.map((each) => [`${each} 40`]));
  });
});
