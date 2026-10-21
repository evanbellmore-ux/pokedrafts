import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PokemonSprite from "@/app/components/PokemonSprite";

/**
 * Game sprites (96px) leave wide transparent margins around the Pokémon, so a
 * tile drops its padding for them; the official artwork, used when a form has
 * no game sprite (Mega Zygarde), fills its image and keeps the padding.
 */

const GAME = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png";
const ARTWORK = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/10301.png";

function imgClass(src: string, bare = false): string {
  const html = renderToStaticMarkup(createElement(PokemonSprite, { name: "Pikachu", src, bare }));
  const match = html.match(/<img[^>]*class="([^"]*)"/);
  if (!match) throw new Error(`no <img> in ${html}`);
  return match[1];
}

describe("sprite tile padding", () => {
  it("fills the tile with a game sprite", () => {
    const classes = imgClass(GAME).split(" ");
    expect(classes).toContain("bg-panel-hover");
    expect(classes).not.toContain("p-1");
  });

  it("keeps the padding around official artwork", () => {
    const classes = imgClass(ARTWORK).split(" ");
    expect(classes).toContain("bg-panel-hover");
    expect(classes).toContain("p-1");
  });

  it("draws no tile when the parent frames the sprite", () => {
    for (const src of [GAME, ARTWORK]) {
      const classes = imgClass(src, true).split(" ");
      expect(classes).not.toContain("bg-panel-hover");
      expect(classes).not.toContain("p-1");
    }
  });
});
