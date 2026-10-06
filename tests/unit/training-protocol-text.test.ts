import { describe, expect, it } from "vitest";
import { createLogFormatter } from "@/app/(app)/training/log/protocol-text";

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

function texts(lines: readonly string[][]) {
  const formatter = createLogFormatter();
  for (const batch of lines) formatter.push(batch);
  return formatter.turns().map((turn) => turn.map((line) => line.text));
}

describe("protocol text (p1 channel)", () => {
  it("words the probe's turns as our own facts", () => {
    const turns = texts([START, TURN_1, SWITCH_1, TURN_2, SWITCH_2, TURN_3]);
    expect(turns[0]).toEqual([
      "Abomasnow (your left) sent out.", "Aegislash (your right) sent out.",
      "Absol (opponent's right) sent out.", "Altaria (opponent's left) sent out.",
      "Snow started (Snow Warning, Abomasnow).",
    ]);
    expect(turns[1]).toEqual([
      "Absol (opponent's right) Mega Evolved (Absolite).",
      "Abomasnow (your left) Mega Evolved (Abomasite).",
      "Absol (opponent's right) used Close Combat → Abomasnow (your left).",
      "Super effective on Abomasnow (your left).",
      "Abomasnow (your left): 197 → 75 / 197 HP.",
      "Absol (opponent's right): Defense −1 (now −1).",
      "Absol (opponent's right): Sp. Def −1 (now −1).",
      "Altaria (opponent's left) used Fire Spin → Aegislash (your right).",
      "Super effective on Aegislash (your right).",
      "Aegislash (your right): 167 → 151 / 167 HP.",
      "Aegislash (your right) is trapped by Fire Spin (Altaria, opponent's left).",
      "Aegislash (your right) changed form: Aegislash-Blade.",
      "Aegislash (your right) used Poltergeist → Altaria (opponent's left).",
      "Missed Altaria (opponent's left).",
      "Abomasnow (your left) used Blizzard → both foes.",
      "Super effective on Altaria (opponent's left).",
      "Absol (opponent's right): 100% → 21%.",
      "Altaria (opponent's left): 100% → 0%.",
      "Altaria (opponent's left) fainted.",
      "Ampharos (opponent's left) sent out.",
    ]);
    expect(turns[2]).toContain("Abomasnow (your left): 75 → 0 / 197 HP.");
    expect(turns[2]).toContain("Poltergeist: Ampharos (opponent's left) holds Focus Sash.");
    expect(turns[2]).toContain("Ampharos (opponent's left): 100% → 24%.");
    expect(turns[2]).toContain("Aegislash (your right) ate its Sitrus Berry.");
    expect(turns[2]).toContain("Aegislash (your right): 69 → 110 / 167 HP (Sitrus Berry).");
    expect(turns[2].at(-1)).toBe("Aerodactyl (your left) sent out.");
    expect(turns[3]).toEqual([
      "Aerodactyl (your left) used Rock Slide → both foes.",
      "Absol (opponent's right): 21% → 0%.",
      "Ampharos (opponent's left): 24% → 0%.",
      "Absol (opponent's right) fainted.",
      "Ampharos (opponent's left) fainted.",
      "Aegislash (your right) used Poltergeist: no target.",
      "It failed: Aegislash (your right).",
    ]);
  });

  it("keeps slots on each line, subject first", () => {
    const formatter = createLogFormatter();
    formatter.push(START);
    formatter.push(TURN_1);
    const lines = formatter.turns()[1];
    expect(lines.find((line) => line.text.startsWith("Abomasnow (your left) used Blizzard"))).toMatchObject({ kind: "move", slots: ["own-left", "opponent-right", "opponent-left"] });
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
    expect(turns[0]).toContain("Intimidate (Arcanine, opponent's left): Incineroar Attack −1, Garchomp Attack −1.");
    expect(turns[0]).toContain("Sandstorm started (Sand Stream, Tyranitar).");
    expect(turns[0]).toContain("Intimidate (Incineroar, your left): Tyranitar Attack −1, Arcanine Attack −1.");
    expect(turns[1]).toEqual([
      "Metagross switched in for Tyranitar (opponent's right).",
      // A protect move's own -singleturn line repeats its move line: one line each.
      "Garchomp (your right) used Protect.",
      "Arcanine (opponent's left) used Detect.",
      "Incineroar (your left) used Parting Shot → Metagross (opponent's right).",
      "Metagross (opponent's right): Attack −1 (now −1).",
      "Metagross (opponent's right): Sp. Atk −1 (now −1).",
      "Gyarados switched in for Incineroar (your left) (Parting Shot).",
      "Intimidate (Gyarados, your left): Metagross Attack −1, Arcanine Attack −1.",
      "Arcanine (opponent's left): 100% → 93% (Sandstorm).",
      "Gyarados (your left): 202 → 190 / 202 HP (Sandstorm).",
      "Gyarados (your left): 190 → 202 / 202 HP (Leftovers).",
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
    expect(turns[1]).toContain("Altaria (your right) ate its Haban Berry.");
    expect(turns[1]).toContain("Haban Berry weakened the hit on Altaria (your right).");
    expect(turns[1].filter((line) => line.includes("Haban Berry"))).toHaveLength(2);
  });

  it("never copies Showdown's flavour text", () => {
    const all = texts([START, TURN_1, SWITCH_1, TURN_2, SWITCH_2, TURN_3]).flat().join("\n");
    expect(all).not.toMatch(/It's super effective|The opposing|A critical hit|fainted!/);
  });
});
