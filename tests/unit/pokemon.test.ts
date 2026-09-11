import { describe, expect, it } from "vitest";
import {
  getBaseSpeciesName,
  getPokemonTypes,
  getSpriteUrl,
  normalizePokemonName,
  toPokeApiSlug,
  type DexMap,
} from "@/app/lib/pokemon";

describe("normalizePokemonName", () => {
  it.each([
    ["Mr. Mime", "mrmime"],
    ["mr-mime", "mrmime"],
    ["MrMime", "mrmime"],
    ["Farfetch'd", "farfetchd"],
    ["Farfetch’d", "farfetchd"],
    ["Nidoran♀", "nidoranf"],
    ["Nidoran-F", "nidoranf"],
    ["Nidoran F", "nidoranf"],
    ["Nidoran♂", "nidoranm"],
    ["Flabébé", "flabebe"],
    ["Ho-Oh", "hooh"],
    ["Type: Null", "typenull"],
    ["  Alolan   Raichu ", "alolanraichu"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizePokemonName(input)).toBe(expected);
  });
});

describe("toPokeApiSlug", () => {
  it.each([
    ["Alolan Raichu", "raichu-alola"],
    ["raichu-alola", "raichu-alola"],
    ["Alola Raichu", "raichu-alola"],
    ["Galarian Slowbro", "slowbro-galar"],
    ["Hisuian Zoroark", "zoroark-hisui"],
    ["Paldean Wooper", "wooper-paldea"],
    ["Mega Charizard X", "charizard-mega-x"],
    ["Mega Charizard Y", "charizard-mega-y"],
    ["Mega Gyarados", "gyarados-mega"],
    ["Paldean Tauros Blaze", "tauros-paldea-blaze-breed"],
    ["Paldean Tauros Aqua", "tauros-paldea-aqua-breed"],
    ["Paldean Tauros", "tauros-paldea-combat-breed"],
    ["tauros-paldea-blaze", "tauros-paldea-blaze-breed"],
    ["Mr. Mime", "mr-mime"],
    ["Mime Jr.", "mime-jr"],
    ["Galarian Mr. Mime", "mr-mime-galar"],
    ["Nidoran♀", "nidoran-f"],
    ["Nidoran♂", "nidoran-m"],
    ["Nidoran F", "nidoran-f"],
    ["Nidoran-M", "nidoran-m"],
    ["Farfetch'd", "farfetchd"],
    ["Type: Null", "type-null"],
    ["Porygon-Z", "porygon-z"],
    ["Ho-Oh", "ho-oh"],
    ["Tapu Koko", "tapu-koko"],
    ["Flabébé", "flabebe"],
    ["Rotom Wash", "rotom-wash"],
    ["Pikachu", "pikachu"],
  ])("maps %s to %s", (input, expected) => {
    expect(toPokeApiSlug(input)).toBe(expected);
  });
});

describe("getBaseSpeciesName", () => {
  it("strips Mega/Primal prefixes and X/Y suffixes", () => {
    expect(getBaseSpeciesName("Mega Charizard X")).toBe("Charizard");
    expect(getBaseSpeciesName("Mega Gyarados")).toBe("Gyarados");
    expect(getBaseSpeciesName("Primal Groudon")).toBe("Groudon");
    expect(getBaseSpeciesName("Raichu")).toBe("Raichu");
  });
});

const dex: DexMap = new Map([
  ["raichu", { name: "Raichu", sprite_url: "https://x/raichu.png", type1: "Electric", type2: null }],
  ["charizard", { name: "Charizard", sprite_url: "https://x/charizard.png", type1: "Fire", type2: "Flying" }],
  ["tauros", { name: "Tauros", sprite_url: "https://x/tauros.png", type1: "Normal", type2: null }],
  ["mrmime", { name: "Mr. Mime", sprite_url: "https://x/mr-mime.png", type1: "Psychic", type2: "Fairy" }],
  ["nidoranf", { name: "Nidoran♀", sprite_url: "https://x/nidoran-f.png", type1: "Poison", type2: null }],
]);

describe("getPokemonTypes", () => {
  it.each([
    ["Alolan Raichu", { type1: "Electric", type2: "Psychic" }],
    ["raichu-alola", { type1: "Electric", type2: "Psychic" }],
    ["Mega Charizard X", { type1: "Fire", type2: "Dragon" }],
    ["Mega Charizard Y", { type1: "Fire", type2: "Flying" }],
    ["Paldean Tauros Blaze", { type1: "Fighting", type2: "Fire" }],
    ["Paldean Tauros", { type1: "Fighting", type2: null }],
    ["Mr. Mime", { type1: "Psychic", type2: "Fairy" }],
    ["mr-mime", { type1: "Psychic", type2: "Fairy" }],
    ["Galarian Mr. Mime", { type1: "Ice", type2: "Psychic" }],
    ["Nidoran-F", { type1: "Poison", type2: null }],
    ["Raichu", { type1: "Electric", type2: null }],
  ])("resolves %s", (name, expected) => {
    expect(getPokemonTypes(name, dex)).toEqual(expected);
  });

  it("returns null for unknown names", () => {
    expect(getPokemonTypes("Missingno", dex)).toBeNull();
  });

  it("answers from the override table without a dex", () => {
    expect(getPokemonTypes("Hisuian Zoroark", null)).toEqual({
      type1: "Normal",
      type2: "Ghost",
    });
    expect(getPokemonTypes("Raichu", null)).toBeNull();
  });
});

describe("getSpriteUrl", () => {
  it("uses the exact entry, then the base species for Mega forms", () => {
    expect(getSpriteUrl("Raichu", dex)).toBe("https://x/raichu.png");
    expect(getSpriteUrl("Mega Charizard X", dex)).toBe("https://x/charizard.png");
    expect(getSpriteUrl("Nidoran♀", dex)).toBe("https://x/nidoran-f.png");
    expect(getSpriteUrl("Missingno", dex)).toBeNull();
    expect(getSpriteUrl("Raichu", null)).toBeNull();
  });
});
