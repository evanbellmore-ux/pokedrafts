from patchlib import rep
G = "tests/unit/doubles-guards-fling.test.ts"
rep(G, """  it("D-FLG-18-sv: a flung Berry eaten by a Cud Chew holder counts for its Cud Chew (the end of turn's guard)", async () => {
    const runtime = await game("scarlet_violet");
    const result = ready(turn(runtime, [sneasler("sitrusberry", { target: "own-right" }), { species: "farigiraf", ability: "cudchew", hp: 60, move: null }, lax(4), lax(8)]));
    expect(result.endOfTurn.status === "not-estimated" && result.endOfTurn.reason).toBe("Cud Chew is not modelled in 2v2.");
  });""", """  it("D-FLG-18-sv: a flung Berry eaten by a Cud Chew holder counts for its Cud Chew (due at the next end of turn: status2 E2)", async () => {
    const runtime = await game("scarlet_violet");
    const input = turn(runtime, [sneasler("sitrusberry", { target: "own-right" }), { species: "farigiraf", ability: "cudchew", hp: 60, move: null }, lax(4), lax(8)]);
    expect(ready(input).endOfTurn.status).toBe("ready");
    const out = calculateDoublesOutcomes(input);
    expect(out.status === "ready" && out.outcomes.every((o) => o.mons["own-right"]!.cudChew === "sitrusberry")).toBe(true);
  });""", "D-FLG-18")
A = "tests/unit/doubles-field-side-items.test.ts"
rep(A, """    expect(ids.filter((id) => STATUS_MOVE_TABLE[id].kind === "C").sort()).toEqual(["defog", "magicroom", "recycle"]);""",
 """    // Integration 1b flipped Defog and Magic Room to M (FC's terrain re-settle and Booster Energy path, ADDENDUM2 §2.2).
    expect(ids.filter((id) => STATUS_MOVE_TABLE[id].kind === "C").sort()).toEqual(["recycle"]);""", "classification")
rep(A, """  it("A3-DF-04, -05: behind a Substitute no evasion drop but the screen goes (F56); a terrain-settled holder keeps today's reason until FC", async () => {""",
 """  it("A3-DF-04, -05: behind a Substitute no evasion drop but the screen goes (F56); a terrain-settled holder re-settles (status2 FC)", async () => {""", "DF name")
rep(A, """    expect(quark).toMatchObject({ status: "not-estimated", reason: REASONS.fieldChange("Quark Drive") });""",
 """    // Defog ends the Electric Terrain: Iron Hands's Quark Drive from the terrain ends before its Drain Punch (FS08e; doubles-fieldchange.test.ts).
    expect(quark.status).toBe("ready");""", "DF value")
rep(A, """  it("A3-MR-06: Magic Room ending with a Booster Energy holder whose field is down (it came in under the room): not estimated until FC", async () => {""",
 """  it("A3-MR-06: Magic Room ending with a Booster Energy holder whose field is down (it came in under the room): the Booster Energy is used (status2 FC)", async () => {""", "MR name")
rep(A, """    expect(calculateDoublesTurn(input)).toMatchObject({ status: "not-estimated", reason: REASONS.boosterAfterRoom });""",
 """    expect(calculateDoublesTurn(input).status).toBe("ready");
    expect(share(outcomes(input), (o) => o.mons[OR]!.build.itemId === "")).toBeCloseTo(1, 9);""", "MR value")
