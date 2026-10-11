from patchlib import rep, sub
F = "tests/source/doubles-status-moves.test.ts"
rep(F, """/** The build's kinds (scripts/.cache/calc-audit/status-eot/design/spec-classify.md with ADDENDUM §2.2: Ally Switch, Trick and Switcheroo are M). */""",
 """/**
 * The build's kinds (scripts/.cache/calc-audit/status-eot/design/spec-classify.md with ADDENDUM §2.2: Ally Switch, Trick and
 * Switcheroo are M; status2 integration 1b: Defog and Magic Room are M (ADDENDUM2 §2.2), Spotlight is M (PR)).
 */""", "comment")
rep(F, "    craftyshield curse darkvoid decorate defendorder defensecurl destinybond doubleteam",
       "    craftyshield curse darkvoid decorate defendorder defensecurl defog destinybond doubleteam", "defog M")
rep(F, "    junglehealing kinesis leechseed leer lifedew lovelykiss luckychant lunarblessing lunardance magiccoat magicpowder magneticflux matblock meditate",
       "    junglehealing kinesis leechseed leer lifedew lovelykiss luckychant lunarblessing lunardance magiccoat magicpowder magicroom magneticflux matblock meditate", "magicroom M")
rep(F, "    slackoff sleeppowder smokescreen snatch soak softboiled speedswap spicyextract spore stockpile",
       "    slackoff sleeppowder smokescreen snatch soak softboiled speedswap spicyextract spore spotlight stockpile", "spotlight M")
rep(F, """  C: `attract captivate conversion conversion2 defog disable doodle encore entrainment gastroacid imprison ingrain magicroom magnetrise recycle roleplay""",
       """  C: `attract captivate conversion conversion2 disable doodle encore entrainment gastroacid imprison ingrain magnetrise recycle roleplay""", "C list")
rep(F, """    reflect sandstorm silktrap sleeptalk snowscape spikyshield spotlight sunnyday tailwind trickroom wideguard`,""",
       """    reflect sandstorm silktrap sleeptalk snowscape spikyshield sunnyday tailwind trickroom wideguard`,""", "X list")
rep(F, """  it("gives each the build's kind: 183 M, 20 N, 21 C, 0 L, 7 S, 1 P, 39 X (status2: no L move is left)", () => {""",
       """  it("gives each the build's kind: 186 M, 20 N, 19 C, 0 L, 7 S, 1 P, 38 X (status2: no L move is left)", () => {""", "count name")
rep(F, """    expect(counts).toEqual({ M: 183, N: 20, C: 21, S: 7, P: 1, X: 39 });""", """    expect(counts).toEqual({ M: 186, N: 20, C: 19, S: 7, P: 1, X: 38 });""", "counts")
rep(F, """    // only makes a Poison type's use hit a semi-invulnerable target (every move hits; a semi-invulnerable Pokémon is a guard).
    const GENERIC = new Set(["defensecurl", "toxic"]);""", """    // only makes a Poison type's use hit a semi-invulnerable target (every move hits; a semi-invulnerable Pokémon is a guard);
    // Spotlight's condition is dispatched by its volatile key (doubles-status.ts volatile: the centre of attention, PR).
    const GENERIC = new Set(["defensecurl", "toxic", "spotlight"]);""", "generic")
