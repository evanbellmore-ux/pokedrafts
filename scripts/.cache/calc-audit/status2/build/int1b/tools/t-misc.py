from patchlib import rep
M = "tests/unit/doubles-turn-mechanics.test.ts"
rep(M, """  it("the attacker that KOs the holder eats after the hit; with recoil after it, not estimated (M29e, M29f, M29c)", async () => {""",
 """  it("the attacker that KOs the holder eats after the hit, before its recoil (M29e, M29f, M29c; status2 K: endsOnKO)", async () => {""", "M29 name")
rep(M, """    const recoil = calculateDoublesTurn(turn(sv, {
      "own-left": { ...chomp, item: "sitrusberry", hp: 80, move: "doubleedge", target: "opponent-left" }, "own-right": venusaur(), "opponent-left": tyranitar({ hp: 30 }), "opponent-right": blastoise(),
    }));
    expect(recoil.status).toBe("not-estimated");
    if (recoil.status === "not-estimated") expect(recoil.reason).toBe("Unnerve is not modelled in 2v2.");""",
 """    // The knocking hit's Update eats the Berry (Unnerve's End), then Double-Edge's recoil: 80 + 45 - 10 (pinned Showdown, M29c).
    const recoil = ready(calculateDoublesTurn(turn(sv, {
      "own-left": { ...chomp, item: "sitrusberry", hp: 80, move: "doubleedge", target: "opponent-left" }, "own-right": venusaur(), "opponent-left": tyranitar({ hp: 30 }), "opponent-right": blastoise(),
    })));
    expect(recoil.hp["own-left"]).toMatchObject({ start: 80, low: 115, high: 115, min: 115, max: 115 });""", "M29c")
P = "tests/unit/doubles-moves-pane.test.ts"
rep(P, """  it("is the Pokémon that acts on it as the turn starts, and null when two different ones do", async () => {""",
 """  it("is the Pokémon that acts on it as the turn starts; when two different ones do, the foe across (status2 ST)", async () => {""", "pane name")
rep(P, """    expect(doublesRepresentative(two, "own-left")).toBeNull();""", """    expect(doublesRepresentative(two, "own-left")).toBe("opponent-left");""", "pane value")
I = "tests/unit/calculator-doubles-inputs.test.ts"
rep(I, """    expect([...EARLIER_TABLES.protecting].sort()).toEqual([...Object.keys(PROTECT_MOVES), "endure"].sort());""",
 """    // Max Guard is a protect kind of the engine (status2 M), not a move a player picks: no earlier-turn control lists it.
    expect([...EARLIER_TABLES.protecting].sort()).toEqual([...Object.keys(PROTECT_MOVES).filter((id) => id !== "maxguard"), "endure"].sort());""", "inputs")
S = "tests/unit/doubles-status.test.ts"
rep(S, """    expect(REASONS.withDynamax("Pain Split")).toBe("Pain Split with a Dynamaxed Pokémon is not modelled in 2v2.");
    expect(REASONS.landing("Future Sight")).toBe("Future Sight landing is not modelled in 2v2.");
    expect(REASONS.formChange("Zen Mode", "Darmanitan")).toBe("Zen Mode changing Darmanitan's form is not modelled in 2v2.");
    expect(REASONS.overTime("Salt Cure")).toBe("Salt Cure's damage over time is not modelled in 2v2.");""",
 """    expect(REASONS.formChange("Power Construct", "Zygarde")).toBe("Power Construct changing Zygarde's form is not modelled in 2v2.");""", "texts")
rep(S, """      ["Sleep Talk is not modelled in 2v2.", turn(sv, [act(lax({ status: "slp" }), "sleeptalk"), idle(toise()), act(chomp(), "dragonclaw", OL), idle(saur())])],
      ["Uproar is not modelled in 2v2.", turn(sv, [act(mon("noivern", "infiltrator"), "uproar"), idle(toise()), idle(lax({ status: "slp" })), idle(saur())])],
""", """      ["Sleep Talk needs Snorlax's moves.", turn(sv, [act(lax({ status: "slp" }), "sleeptalk"), idle(toise()), act(chomp(), "dragonclaw", OL), idle(saur())])],
""", "rows")
rep(S, """    // status2 wave 1a: modelled now (D's Encore rewrite of a spread move, S's Disguise self-hit, A2's Roost type change).
    for (const input of [""", """    // status2 wave 1a: modelled now (D's Encore rewrite of a spread move, S's Disguise self-hit, A2's Roost type change);
    // wave 1b: CL's Uproar (its hit wakes the sleeping Snorlax).
    for (const input of [
      turn(sv, [act(mon("noivern", "infiltrator"), "uproar"), idle(toise()), idle(lax({ status: "slp" })), idle(saur())]),""", "uproar ready")
rep(S, """    expect(reason(dynamax)).toBe("Pain Split with a Dynamaxed Pokémon is not modelled in 2v2.");""",
 """    // status2 M: Pain Split averages with the undynamaxed HP (doubles-max.ts painSplitHP).
    expect(calculateDoublesTurn(dynamax).status).toBe("ready");""", "dynamax")
