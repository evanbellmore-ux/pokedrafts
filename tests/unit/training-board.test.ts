import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import BattleBoard from "@/app/(app)/training/board/BattleBoard";
import BenchStrip, { benchFacts } from "@/app/(app)/training/board/BenchStrip";
import { boardNames, boostLabel, boostText, hpText, hpTone, itemText, remaining } from "@/app/(app)/training/board/board-format";
import { fieldFacts } from "@/app/(app)/training/board/FieldBar";
import { boardView } from "../fixtures/training";

function card(html: string, slot: string) {
  const start = html.indexOf(`data-training-card="${slot}"`);
  expect(start).toBeGreaterThan(-1);
  const rest = html.slice(start + 1);
  const end = rest.search(/data-training-card="|data-training-controls=|data-training-field/);
  return end < 0 ? rest : rest.slice(0, end);
}

describe("board text", () => {
  it("words HP, tones, status, boosts, items and fields as facts", () => {
    expect(hpText({ kind: "exact", current: 143, maximum: 183 })).toBe("143 / 183 HP");
    expect(hpText({ kind: "percent", percent: 58 })).toBe("58% HP");
    // Pinned Champions getHealth: at exactly 20% / 50% the suffix says which side of the line the real HP is.
    expect(hpTone({ kind: "percent", percent: 20, color: "y" })).toBe("warning");
    expect(hpTone({ kind: "percent", percent: 20, color: "r" })).toBe("danger");
    expect(hpTone({ kind: "percent", percent: 50, color: "g" })).toBe("success");
    expect(hpTone({ kind: "percent", percent: 50 })).toBe("warning");
    expect(hpTone({ kind: "exact", current: 100, maximum: 183 })).toBe("success");
    expect(boostText({ atk: 1, spd: -1, spe: 0 })).toBe("Atk +1 · SpD −1");
    expect(boostLabel({ atk: 1, spd: -1 })).toBe("Attack +1, Sp. Def −1");
    expect(itemText({ state: "consumed", id: "sitrusberry", name: "Sitrus Berry" })).toBe("Item: Sitrus Berry (eaten)");
    expect(itemText({ state: "consumed", id: "focussash", name: "Focus Sash" })).toBe("Item: Focus Sash (used)");
    expect(itemText({ state: "removed", id: "choicescarf", name: "Choice Scarf" })).toBe("Item: Choice Scarf (removed)");
    expect(itemText({ state: "none" })).toBe("No item");
    expect(itemText({ state: "unknown" })).toBe("Item: not shown");
    expect(fieldFacts(boardView().field)).toEqual(["Snow · 3 turns", "Trick Room · 2 turns", "Tailwind (your side) · 1 turn"]);
    expect(remaining(boardView(), "own")).toBe(3);
    expect(remaining(boardView(), "opponent")).toBe(4);
    const same = boardView();
    same.active["own-right"] = { ...same.active["own-right"]!, name: "Garchomp" };
    expect(boardNames(same)["own-left"]).toBe("Garchomp (your left)");
  });
});

describe("battle board", () => {
  it("puts the opponent's side above yours and your controls after both of your cards", () => {
    const html = renderToStaticMarkup(createElement(BattleBoard, { board: boardView(), renderControls: (slot) => createElement("p", null, `controls ${slot}`) }));
    expect(html.indexOf('aria-label="Opponent&#x27;s side"')).toBeLessThan(html.indexOf('aria-label="Your side"'));
    expect(html.indexOf('data-training-card="opponent-left"')).toBeLessThan(html.indexOf('data-training-card="opponent-right"'));
    const ownRight = html.indexOf('data-training-card="own-right"');
    expect(html.indexOf("controls own-left")).toBeGreaterThan(ownRight);
    expect(html.indexOf("controls own-right")).toBeGreaterThan(html.indexOf("controls own-left"));
    expect(html).toContain("data-training-field");
  });

  it("shows your Pokémon exactly and the AI's as the game shows it", () => {
    const html = renderToStaticMarkup(createElement(BattleBoard, { board: boardView() }));
    const own = card(html, "own-left");
    expect(own).toContain('aria-valuetext="143 of 183 HP"');
    expect(own).toContain("143 / 183 HP");
    expect(own).toContain('aria-label="Attack +1, Sp. Def −1">Atk +1 · SpD −1');
    expect(own).toContain("Item: Life Orb");
    expect(own).toContain("Ability: Rough Skin");
    expect(own).toContain("SPs: 2 HP / 32 Atk / 32 Spe");
    expect(own).toMatch(/Earthquake<\/span><span class="shrink-0 tabular-nums">8\/8/);
    expect(card(html, "own-right")).toContain("Paralyzed");
    const foeRight = card(html, "opponent-right");
    expect(foeRight).toContain("Absol-Mega");
    expect(foeRight).toContain(">Mega<");
    expect(foeRight).toContain('aria-valuemax="100"');
    expect(foeRight).toContain('aria-valuetext="21% HP"');
    expect(foeRight).toContain("Item: Absolite");
    const foeLeft = card(html, "opponent-left");
    expect(foeLeft).toContain("bg-warning");
    expect(foeLeft).toContain("Item: Focus Sash (used)");
    expect(foeLeft).toContain("Ability: not shown");
    expect(foeLeft).toContain("3 moves not shown");
    expect(foeLeft).toContain("Def −1");
  });

  it("marks a fainted card and shows an empty slot", () => {
    const board = boardView();
    board.active["own-right"] = { ...board.active["own-right"]!, fainted: true, hp: { kind: "exact", current: 0, maximum: 202 } };
    board.active["opponent-left"] = null;
    const html = renderToStaticMarkup(createElement(BattleBoard, { board }));
    expect(card(html, "own-right")).toContain("Fainted");
    expect(card(html, "own-right")).toContain('aria-valuetext="Fainted"');
    expect(card(html, "opponent-left")).toContain("Empty");
  });

  it("lists the benches with how many of the AI's four are not seen, or Brought / Not brought under the test setting", () => {
    expect(benchFacts(boardView())).toEqual({ own: ["Incineroar 202 / 202 HP", "Aerodactyl Fainted"], opponent: ["Annihilape 58% HP"], unseen: 1 });
    const html = renderToStaticMarkup(createElement(BenchStrip, { board: boardView() }));
    expect(html).toContain("Annihilape 58% HP · 1 not seen");
    const tested = boardView();
    tested.team.opponent = tested.team.opponent.map((mon, index) => ({ ...mon, brought: index < 4 }));
    expect(benchFacts(tested).opponent).toEqual(["Annihilape 58% HP · Brought", "Altaria · Brought", "Appletun · Not brought", "Araquanid · Not brought"]);
  });
});
