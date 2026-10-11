from patchlib import rep, read
F = "tests/unit/doubles-start-rows.test.ts"
text, _ = read(F)
lines = {}
for sr in ["SR41", "SR61", "SR62", "SR63"]:
    line = next(l for l in text.split("\n") if l.startswith(f'  {{id:"{sr}",'))
    lines[sr] = line
    rep(F, line + "\n", "", f"move {sr} out of GUARDED")
rep(F, """/** Guarded once, ready now (status2 wave 1a: A1's Skill Swap; A1-SR44-sv agrees with pinned Showdown); their start rows stay. */
const NOW_READY: typeof GUARDED = [
""", """/**
 * Guarded once, ready now (status2 wave 1a: A1's Skill Swap, A1-SR44-sv agrees with pinned Showdown; wave 1b: PR's Spotlight,
 * T2P-SPL-01…03 agree); their start rows stay.
 */
const NOW_READY: typeof GUARDED = [
""" + "\n".join(lines[sr] for sr in ["SR41", "SR61", "SR62", "SR63"]) + "\n", "NOW_READY")
rep(F, """  it("is ready where status2 wave 1a lifted the guard (SR44: Skill Swap)", async () => {""",
 """  it("is ready where status2 lifted the guard (SR44: Skill Swap; SR41, SR61-SR63: Spotlight)", async () => {""", "name")
N = "tests/unit/calculator-ngas-2v2.test.ts"
rep(N, """  it("still names Commander with Dondozo on its side under the gas", async () => {""", """  it("follows Commander with Dondozo on its side under the gas: the gas from the lead stops Commander (status2 PR, PR-CMD-02)", async () => {""", "ngas name")
rep(N, """    expect(calculateDoublesTurn(await input(c))).toMatchObject({ status: "not-estimated", reason: "Commander is not modelled in 2v2." });""",
 """    expect(calculateDoublesTurn(await input(c)).status).toBe("ready");""", "ngas value")
