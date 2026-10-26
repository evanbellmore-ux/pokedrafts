import { act, createElement } from "react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { installFakeDom, reactProps, type FakeDocument, type FakeElement } from "../fixtures/fake-dom";
import type PokemonSpriteType from "@/app/components/PokemonSprite";

// A given src stands for its own picture (the calculator's and Training's slots, app/lib/battle/sprites.ts): a new src
// replaces the image even under the same name, and one that failed to load leaves the next free to load. Client-rendered
// in the fake DOM; react-dom/client loads after it is installed (canUseDOM).

const CHARIZARD = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/6.png";
const MEGA_X = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/10034.png";

let document: FakeDocument;
let root: { render(node: unknown): void; unmount(): void };
let PokemonSprite: typeof PokemonSpriteType;

beforeAll(async () => {
  document = installFakeDom();
  const { createRoot } = await import("react-dom/client");
  PokemonSprite = (await import("@/app/components/PokemonSprite")).default;
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container as unknown as Element) as unknown as typeof root;
});
afterAll(async () => { await act(async () => { root?.unmount(); }); });

const show = async (src: string | null) => {
  await act(async () => { root.render(createElement(PokemonSprite, { name: "Charizard", src, decorative: true })); });
};
const image = (): FakeElement | undefined => document.querySelectorAll("img")[0];

describe("a sprite with a given src", () => {
  it("shows a new src under the same name, and loads the next one after a failure", async () => {
    await show(CHARIZARD);
    expect(image()?.getAttribute("src")).toBe(CHARIZARD);
    expect(image()?.getAttribute("alt")).toBe("");
    await show(MEGA_X);
    expect(image()?.getAttribute("src")).toBe(MEGA_X);
    await act(async () => { (reactProps(image()!).onError as () => void)(); });
    expect(image()).toBeUndefined();
    const tile = document.querySelectorAll("[aria-hidden]")[0];
    expect(tile.textContent).toBe("C");
    expect(tile.getAttribute("role")).toBeNull();
    await show(CHARIZARD);
    expect(image()?.getAttribute("src")).toBe(CHARIZARD);
    // null: no sprite, and no lookup either.
    await show(null);
    expect(image()).toBeUndefined();
    expect(document.querySelectorAll("[aria-hidden]")[0].textContent).toBe("C");
  });
});
