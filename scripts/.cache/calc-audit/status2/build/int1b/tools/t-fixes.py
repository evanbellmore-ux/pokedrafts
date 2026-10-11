from patchlib import rep, read
F = "tests/unit/doubles-turn-fixes.test.ts"
text, _ = read(F)
def line(key):
    return next(l for l in text.split("\n") if l.startswith(f'  {{id:"{key}",'))
moved = {k: line(k) for k in ["R09", "R10", "F21a", "F30d"]}
for k, l in moved.items():
    rep(F, l + "\n", "", f"{k} out of GUARDED")
for k, who in [("F14a", "Snorlax"), ("F14c", "Komala")]:
    l = line(k)
    assert l.count('reason:"Sleep Talk is not modelled in 2v2."') == 1
    rep(F, l, l.replace('reason:"Sleep Talk is not modelled in 2v2."', f'reason:"Sleep Talk needs {who}\'s moves."'), f"{k} reason")
f30d = moved["F30d"]
head = f30d[: f30d.index(',reason:"')]
ready = head + ',hp:{"own-left":{start:153,maximum:153,low:153,high:153,min:153,max:153,average:153,koChance:0},"own-right":{start:175,maximum:175,low:175,high:175,min:175,max:175,average:175,koChance:0},"opponent-left":{start:155,maximum:155,low:39,high:17,min:17,max:39,average:29.125,koChance:0},"opponent-right":{start:154,maximum:154,low:154,high:154,min:154,max:154,average:154,koChance:0}},steps:{"own-left":{moveId:"airslash",moves:1,order:[[1,1]],hits:[{slot:"opponent-left",reached:1,koChance:0,min:116,max:138}]}}},'
rep(F, """];
/** Guarded cases with the reason the turn is not estimated for. */""", "  // status2 K (Unnerve's stand-ins, T2M §3.6): ready; pinned Showdown's values (the stored F30d oracle agrees).\n" + ready + """
];
/** Guarded cases with the reason the turn is not estimated for. */""", "F30d READY")
mod = []
for k in ["R09", "R10", "F21a"]:
    l = moved[k]
    mod.append(l[: l.index(',reason:"')] + "},")
rep(F, """ * Round 1 guards that status-eot models (confusion from a Figy Berry and Dynamic Punch, Snore while asleep) and status2
 * wave 1a models (Protean, Double Shock and Burn Up's type changes: A2; Glaive Rush and Opportunist: D): each turn is ready
 * now; their exact values against pinned Showdown are rows of tests/unit/doubles-turn-showdown.test.ts (R01, R15, F14b, R02,
 * R03, R07, R14, F22a).
 */
const MODELLED: Setup[] = [
""", """ * Round 1 guards that status-eot models (confusion from a Figy Berry and Dynamic Punch, Snore while asleep), status2
 * wave 1a models (Protean, Double Shock and Burn Up's type changes: A2; Glaive Rush and Opportunist: D) and wave 1b models
 * (the Pledges: PR; Copycat and Me First: CL): each turn is ready now; their exact values against pinned Showdown are rows
 * of tests/unit/doubles-turn-showdown.test.ts (R01, R15, F14b, R02, R03, R07, R14, F22a, R09, R10, F21a).
 */
const MODELLED: Setup[] = [
""" + "\n".join(mod) + "\n", "MODELLED")
rep(F, """  it("a resist Berry the calculation would read otherwise is not estimated in the turn and in the Moves pane", async () => {
    // Calyrex-Shadow's As One stops Venusaur's Coba Berry; the calculation reads only the attacker's Unnerve.
    const asOne = await input(find(GUARDED, "F30d"));
    const turn = calculateDoublesTurn(asOne);
    expect(turn.status === "not-estimated" && turn.reason).toBe("As One (Spectrier) is not modelled in 2v2.");""",
 """  it("a resist Berry the calculation would read otherwise: the turn follows it (status2 K's stand-ins), the Moves pane does not", async () => {
    // Calyrex-Shadow's As One stops Venusaur's Coba Berry; the turn's calculation reads the same Unnerve (doubles-reactions.ts
    // calcStandIns), the Moves pane's reads only the attacker's.
    const asOne = await input(find(READY, "F30d"));
    expect(calculateDoublesTurn(asOne).status).toBe("ready");""", "resist berry test")
