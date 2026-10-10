import { describe, expect, it } from "vitest";
import { createLogFormatter, type LogFormatterOptions } from "@/app/(app)/training/log/protocol-text";
import { POSITIONAL } from "../fixtures/naming";

// p1-channel lines recorded by scripts/.cache/training/design/ui-probe.ts (ui-probe.out) and probe-midturn.ts
// (probe-midturn.out), pinned Showdown c23d2e94. A `|split|p1` pair keeps its secret half on p1's channel, a `|split|p2`
// pair its shared half (sim/battle.ts:33-56).
const START = [
  "|switch|p1a: Abomasnow|Abomasnow, L50, M|197/197", "|switch|p1b: Aegislash|Aegislash, L50, F|167/167",
  "|switch|p2a: Absol|Absol, L50, F|100/100", "|switch|p2b: Altaria|Altaria, L50, F|100/100",
  "|-weather|Snowscape|[from] ability: Snow Warning|[of] p1a: Abomasnow", "|turn|1",
];
const TURN_1 = ["|", "|t:|1791224883", "|detailschange|p2a: Absol|Absol-Mega, L50, F", "|-mega|p2a: Absol|Absol|Absolite", "|detailschange|p1a: Abomasnow|Abomasnow-Mega, L50, M", "|-mega|p1a: Abomasnow|Abomasnow|Abomasite", "|move|p2a: Absol|Close Combat|p1a: Abomasnow", "|-supereffective|p1a: Abomasnow|1", "|-damage|p1a: Abomasnow|75/197", "|-unboost|p2a: Absol|def|1", "|-unboost|p2a: Absol|spd|1", "|move|p2b: Altaria|Fire Spin|p1b: Aegislash", "|-supereffective|p1b: Aegislash|1", "|-damage|p1b: Aegislash|151/167", "|-activate|p1b: Aegislash|move: Fire Spin|[of] p2b: Altaria", "|-formechange|p1b: Aegislash|Aegislash-Blade|", "|move|p1b: Aegislash|Poltergeist|p2b: Altaria|[miss]", "|-miss|p1b: Aegislash|p2b: Altaria", "|move|p1a: Abomasnow|Blizzard|p2b: Altaria|[spread] p2a,p2b", "|-supereffective|p2b: Altaria|2", "|-damage|p2a: Absol|21/100", "|-damage|p2b: Altaria|0 fnt", "|faint|p2b: Altaria", "|", "|-weather|Snowscape|[upkeep]", "|-end|p1b: Aegislash|Fire Spin|[partiallytrapped]|[silent]", "|upkeep"];
const SWITCH_1 = ["|", "|t:|1791224883", "|switch|p2b: Ampharos|Ampharos, L50, M|100/100", "|turn|2"];
const TURN_2 = ["|", "|t:|1791224883", "|move|p2a: Absol|Close Combat|p1a: Abomasnow", "|-supereffective|p1a: Abomasnow|1", "|-damage|p1a: Abomasnow|0 fnt", "|-unboost|p2a: Absol|def|1", "|-unboost|p2a: Absol|spd|1", "|faint|p1a: Abomasnow", "|move|p1b: Aegislash|Poltergeist|p2b: Ampharos", "|-activate|p2b: Ampharos|move: Poltergeist|Focus Sash", "|-damage|p2b: Ampharos|24/100", "|move|p2b: Ampharos|Rising Voltage|p1b: Aegislash", "|-damage|p1b: Aegislash|69/167", "|-enditem|p1b: Aegislash|Sitrus Berry|[eat]", "|-heal|p1b: Aegislash|110/167|[from] item: Sitrus Berry", "|", "|-weather|Snowscape|[upkeep]", "|upkeep"];
const SWITCH_2 = ["|", "|t:|1791224883", "|switch|p1a: Aerodactyl|Aerodactyl, L50, F|187/187", "|turn|3"];
const TURN_3 = ["|", "|t:|1791224883", "|move|p1a: Aerodactyl|Rock Slide|p2b: Ampharos|[spread] p2a,p2b", "|-damage|p2a: Absol|0 fnt", "|-damage|p2b: Ampharos|0 fnt", "|faint|p2a: Absol", "|faint|p2b: Ampharos", "|move|p1b: Aegislash|Poltergeist|p2: Absol|[notarget]", "|-fail|p1b: Aegislash", "|", "|-weather|Snowscape|[upkeep]", "|upkeep"];

function texts(lines: readonly string[][], options: LogFormatterOptions = {}) {
  const formatter = createLogFormatter(options);
  for (const batch of lines) formatter.push(batch);
  return formatter.turns().map((turn) => turn.map((line) => line.text));
}

describe("protocol text (p1 channel)", () => {
  it("words the probe's turns as our own facts", () => {
    const turns = texts([START, TURN_1, SWITCH_1, TURN_2, SWITCH_2, TURN_3]);
    expect(turns[0]).toEqual([
      "Abomasnow sent out.", "Aegislash sent out.",
      "Absol sent out.", "Altaria sent out.",
      "Snow started (Snow Warning, Abomasnow).",
    ]);
    expect(turns[1]).toEqual([
      "Absol Mega Evolved (Absolite).",
      "Abomasnow Mega Evolved (Abomasite).",
      "Absol used Close Combat → Abomasnow.",
      "Super effective on Abomasnow.",
      "Abomasnow: 197 → 75 / 197 HP.",
      "Absol: Defense −1 (now −1).",
      "Absol: Sp. Def −1 (now −1).",
      "Altaria used Fire Spin → Aegislash.",
      "Super effective on Aegislash.",
      "Aegislash: 167 → 151 / 167 HP.",
      "Aegislash is trapped by Fire Spin (Altaria).",
      "Aegislash changed form: Aegislash-Blade.",
      "Aegislash used Poltergeist → Altaria.",
      "Missed Altaria.",
      "Abomasnow used Blizzard → both foes.",
      "Super effective on Altaria.",
      "Absol: 100% → 21%.",
      "Altaria: 100% → 0%.",
      "Altaria fainted.",
      "Ampharos sent out.",
    ]);
    expect(turns[2]).toContain("Abomasnow: 75 → 0 / 197 HP.");
    expect(turns[2]).toContain("Poltergeist: Ampharos holds Focus Sash.");
    expect(turns[2]).toContain("Ampharos: 100% → 24%.");
    expect(turns[2]).toContain("Aegislash ate its Sitrus Berry.");
    expect(turns[2]).toContain("Aegislash: 69 → 110 / 167 HP (Sitrus Berry).");
    expect(turns[2].at(-1)).toBe("Aerodactyl sent out.");
    expect(turns[3]).toEqual([
      "Aerodactyl used Rock Slide → both foes.",
      "Absol: 21% → 0%.",
      "Ampharos: 24% → 0%.",
      "Absol fainted.",
      "Ampharos fainted.",
      "Aegislash used Poltergeist: no target.",
      "It failed: Aegislash.",
    ]);
  });

  it("keeps slots on each line, subject first", () => {
    const formatter = createLogFormatter();
    formatter.push(START);
    formatter.push(TURN_1);
    const lines = formatter.turns()[1];
    expect(lines.find((line) => line.text.startsWith("Abomasnow used Blizzard"))).toMatchObject({ kind: "move", slots: ["own-left", "opponent-right", "opponent-left"] });
    expect(lines.find((line) => line.text.endsWith("fainted."))).toMatchObject({ kind: "faint", slots: ["opponent-left"] });
    expect(lines.find((line) => line.text.includes("Mega Evolved"))).toMatchObject({ kind: "form" });
  });

  it("drops upkeep weather and silent lines, keeps a mid-turn replacement in its turn and groups Intimidate", () => {
    const start = [
      "|switch|p1a: Incineroar|Incineroar, L50, M|202/202", "|switch|p1b: Garchomp|Garchomp, L50, F|183/183",
      "|switch|p2a: Tyranitar|Tyranitar, L50, F|100/100", "|switch|p2b: Arcanine|Arcanine, L50, M|100/100",
      "|-ability|p2b: Arcanine|Intimidate|boost", "|-unboost|p1a: Incineroar|atk|1", "|-unboost|p1b: Garchomp|atk|1",
      "|-weather|Sandstorm|[from] ability: Sand Stream|[of] p2a: Tyranitar",
      "|-ability|p1a: Incineroar|Intimidate|boost", "|-unboost|p2a: Tyranitar|atk|1", "|-unboost|p2b: Arcanine|atk|1",
      "|turn|1",
    ];
    const turn = ["|", "|t:|1791225276", "|switch|p2a: Metagross|Metagross, L50|100/100", "|move|p1b: Garchomp|Protect|p1b: Garchomp", "|-singleturn|p1b: Garchomp|Protect", "|move|p2b: Arcanine|Detect|p2b: Arcanine", "|-singleturn|p2b: Arcanine|Protect", "|move|p1a: Incineroar|Parting Shot|p2a: Metagross", "|-unboost|p2a: Metagross|atk|1", "|-unboost|p2a: Metagross|spa|1"];
    const replacement = ["|", "|t:|1791225276", "|switch|p1a: Gyarados|Gyarados, L50, F|202/202|[from] Parting Shot", "|-ability|p1a: Gyarados|Intimidate|boost", "|-unboost|p2a: Metagross|atk|1", "|-unboost|p2b: Arcanine|atk|1", "|", "|-weather|Sandstorm|[upkeep]", "|-damage|p2b: Arcanine|93/100|[from] Sandstorm", "|-damage|p1a: Gyarados|190/202|[from] Sandstorm", "|-heal|p1a: Gyarados|202/202|[from] item: Leftovers", "|upkeep", "|turn|2"];
    const turns = texts([start, turn, replacement]);
    expect(turns[0]).toContain("Intimidate (Arcanine): Incineroar Attack −1, Garchomp Attack −1.");
    expect(turns[0]).toContain("Sandstorm started (Sand Stream, Tyranitar).");
    expect(turns[0]).toContain("Intimidate (Incineroar): Tyranitar Attack −1, Arcanine Attack −1.");
    expect(turns[1]).toEqual([
      "Metagross switched in for Tyranitar.",
      // A protect move's own -singleturn line repeats its move line: one line each.
      "Garchomp used Protect.",
      "Arcanine used Detect.",
      "Incineroar used Parting Shot → Metagross.",
      "Metagross: Attack −1 (now −1).",
      "Metagross: Sp. Atk −1 (now −1).",
      "Gyarados switched in for Incineroar (Parting Shot).",
      "Intimidate (Gyarados): Metagross Attack −1, Arcanine Attack −1.",
      "Arcanine: 100% → 93% (Sandstorm).",
      "Gyarados: 202 → 190 / 202 HP (Sandstorm).",
      "Gyarados: 190 → 202 / 202 HP (Leftovers).",
    ]);
    expect(turns[2]).toEqual([]);
    expect(turns.flat().join(" ")).not.toMatch(/upkeep|Snowscape|Fire Spin ended/);
  });

  it("states the result and falls back to a generic fact for an unknown command", () => {
    const turns = texts([["|-zbroken|p2a: Absol", "|win|You"], ["|win|Training"], ["|tie"]]);
    expect(turns[0]).toEqual(["-zbroken: p2a: Absol", "You won.", "The AI won.", "Tie."]);
  });

  it("words a resist berry's two lines as two facts (eaten, then the halved hit)", () => {
    // PS/data/items.ts habanberry onSourceModifyDamage: eatItem() writes the [eat] line, then -enditem [weaken].
    const turn = ["|", "|move|p2b: Garchomp|Dragon Claw|p1b: Altaria", "|-enditem|p1b: Altaria|Haban Berry|[eat]", "|-enditem|p1b: Altaria|Haban Berry|[weaken]", "|-supereffective|p1b: Altaria", "|-damage|p1b: Altaria|107/182", "|turn|2"];
    const turns = texts([START, turn]);
    expect(turns[1]).toContain("Altaria ate its Haban Berry.");
    expect(turns[1]).toContain("Haban Berry weakened the hit on Altaria.");
    expect(turns[1].filter((line) => line.includes("Haban Berry"))).toHaveLength(2);
  });

  it("never copies Showdown's flavour text", () => {
    const all = texts([START, TURN_1, SWITCH_1, TURN_2, SWITCH_2, TURN_3]).flat().join("\n");
    expect(all).not.toMatch(/It's super effective|The opposing|A critical hit|fainted!/);
  });
});

describe("protocol text names Pokémon, never positions", () => {
  // Both teams' battle names (the team preview's sixes): Incineroar, Garchomp and Tyranitar are on both.
  const TEAMS = {
    p1: ["Incineroar", "Farigiraf", "Garchomp", "Tyranitar", "Gyarados", "Aegislash"],
    p2: ["Incineroar", "Ampharos", "Garchomp", "Tyranitar", "Arcanine", "Zoroark"],
  };

  it("gives a name on both teams its side word in every line, and the inner form inside parentheses", () => {
    const start = [
      "|switch|p1a: Incineroar|Incineroar, L50, M|202/202", "|switch|p1b: Farigiraf|Farigiraf, L50, M|190/190",
      "|switch|p2a: Incineroar|Incineroar, L50, M|100/100", "|switch|p2b: Tyranitar|Tyranitar, L50, F|100/100",
      "|-ability|p2a: Incineroar|Intimidate|boost", "|-unboost|p1a: Incineroar|atk|1", "|-unboost|p1b: Farigiraf|atk|1",
      "|-weather|Sandstorm|[from] ability: Sand Stream|[of] p2b: Tyranitar", "|turn|1",
    ];
    const turn = [
      "|", "|move|p1a: Incineroar|Fake Out|p2a: Incineroar", "|-damage|p2a: Incineroar|88/100", "|cant|p2a: Incineroar|flinch",
      "|switch|p1b: Garchomp|Garchomp, L50, F|183/183", "|turn|2",
    ];
    const turn2 = [
      "|", "|switch|p2a: Garchomp|Garchomp, L50, F|100/100", "|-item|p2a: Garchomp|Focus Sash|[from] ability: Frisk|[of] p1b: Garchomp",
      "|move|p1a: Incineroar|Flare Blitz|p2a: Garchomp", "|-damage|p2a: Garchomp|40/100",
      "|-damage|p1a: Incineroar|172/202|[from] ability: Rough Skin|[of] p2a: Garchomp", "|turn|3",
    ];
    const turns = texts([start, turn, turn2], { teams: TEAMS });
    expect(turns[0]).toEqual([
      "Incineroar (yours) sent out.", "Farigiraf sent out.", "Incineroar (opponent's) sent out.", "Tyranitar (opponent's) sent out.",
      "Intimidate (the opponent's Incineroar): Incineroar (yours) Attack −1, Farigiraf Attack −1.",
      "Sandstorm started (Sand Stream, the opponent's Tyranitar).",
    ]);
    expect(turns[1]).toEqual([
      "Incineroar (yours) used Fake Out → Incineroar (opponent's).", "Incineroar (opponent's): 100% → 88%.", "Incineroar (opponent's) flinched.",
      "Garchomp (yours) switched in for Farigiraf.",
    ]);
    expect(turns[2]).toEqual([
      "Garchomp (opponent's) switched in for Incineroar (opponent's).",
      "Frisk (your Garchomp): Garchomp (opponent's) holds Focus Sash.",
      "Incineroar (yours) used Flare Blitz → Garchomp (opponent's).", "Garchomp (opponent's): 100% → 40%.",
      "Incineroar (yours): 202 → 172 / 202 HP (Rough Skin, the opponent's Garchomp).",
    ]);
    // Without the teams option (or when only one team has the name) there is no side word.
    expect(texts([start, turn])[1][0]).toBe("Incineroar used Fake Out → Incineroar.");
    for (const line of turns.flat()) expect(line).not.toMatch(POSITIONAL);
  });

  // Fixer (naming review T3): the board's card shows an Imposter it was shown to have; the line names it too.
  it("names a Transform's source when one is shown (Imposter on entry), with both Pokémon's names", () => {
    const start = [
      "|switch|p1a: Garchomp|Garchomp, L50, F|183/183", "|switch|p1b: Farigiraf|Farigiraf, L50, M|190/190",
      "|switch|p2a: Ditto|Ditto, L50|100/100", "|-transform|p2a: Ditto|p1b: Farigiraf|[from] ability: Imposter",
      "|switch|p2b: Garchomp|Garchomp, L50, F|100/100", "|turn|1",
    ];
    const turn = ["|", "|move|p1a: Garchomp|Transform|p2b: Garchomp", "|-transform|p1a: Garchomp|p2b: Garchomp", "|turn|2"];
    const turns = texts([start, turn], { teams: TEAMS });
    expect(turns[0]).toContain("Ditto transformed into Farigiraf (Imposter).");
    expect(turns[1]).toContain("Garchomp (yours) transformed into Garchomp (opponent's).");
  });

  it("names Ally Switch by the two Pokémon (their names as they stood before it)", () => {
    const start = [
      "|switch|p1a: Incineroar|Incineroar, L50, M|202/202", "|switch|p1b: Farigiraf|Farigiraf, L50, M|190/190",
      "|switch|p2a: Ampharos|Ampharos, L50, M|100/100", "|switch|p2b: Arcanine|Arcanine, L50, M|100/100", "|turn|1",
    ];
    const turn = ["|", "|move|p1b: Farigiraf|Ally Switch|p1b: Farigiraf", "|swap|p1b: Farigiraf|0|[from] move: Ally Switch", "|move|p2a: Ampharos|Discharge|p1a: Farigiraf|[spread] p1a,p1b,p2b", "|turn|2"];
    const turns = texts([start, turn]);
    expect(turns[1]).toEqual(["Farigiraf used Ally Switch.", "Farigiraf and Incineroar switched places.", "Ampharos used Discharge → both foes and Arcanine."]);
    // A Pokémon alone on its side only moves (Ally Switch fails without a partner; the line never names a place).
    const alone = texts([["|switch|p1a: Incineroar|Incineroar, L50, M|202/202", "|switch|p2a: Ampharos|Ampharos, L50, M|100/100", "|turn|1"], ["|", "|swap|p1a: Incineroar|1", "|turn|2"]]);
    expect(alone[1]).toEqual(["Incineroar moved."]);
  });

  it("numbers two of one name on a side by slot (an Illusion: p2b is opponent-left, 1; p2a is opponent-right, 2)", () => {
    const start = [
      "|switch|p1a: Incineroar|Incineroar, L50, M|202/202", "|switch|p1b: Gyarados|Gyarados, L50, M|202/202",
      "|switch|p2a: Garchomp|Garchomp, L50, F|100/100", "|switch|p2b: Garchomp|Garchomp, L50, F|100/100", "|turn|1",
    ];
    const turn = [
      "|", "|move|p1a: Incineroar|Flare Blitz|p2a: Garchomp", "|-damage|p2a: Garchomp|60/100",
      "|-damage|p1a: Incineroar|172/202|[from] ability: Rough Skin|[of] p2a: Garchomp",
      "|move|p2b: Garchomp|Dragon Claw|p1b: Gyarados", "|-damage|p1b: Gyarados|150/202",
      "|replace|p2b: Zoroark|Zoroark, L50, M", "|-end|p2b: Zoroark|Illusion",
      "|move|p2a: Garchomp|Earthquake|p1a: Incineroar|[spread] p1a,p1b,p2b", "|turn|2",
    ];
    const turns = texts([start, turn]);
    expect(turns[0]).toEqual(["Incineroar sent out.", "Gyarados sent out.", "Garchomp sent out.", "Garchomp (1) sent out."]);
    expect(turns[1]).toEqual([
      "Incineroar used Flare Blitz → Garchomp (2).", "Garchomp (2): 100% → 60%.", "Incineroar: 202 → 172 / 202 HP (Rough Skin, Garchomp 2).",
      "Garchomp (1) used Dragon Claw → Gyarados.", "Gyarados: 202 → 150 / 202 HP.",
      "Illusion ended: Zoroark.", "Zoroark: Illusion ended.",
      "Garchomp used Earthquake → both foes and Zoroark.",
    ]);
  });
});
