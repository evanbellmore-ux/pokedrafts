from patchlib import rep, sub, read
F = "tests/unit/doubles-calling.test.ts"
rep(F, """ * A model that needs an integrator line (build/W1B-CL.md CL-1 … CL-6; doubles-calling.ts WIRED) is `needs(...)`: it.fails on
 * this tree, where the line is not in and its guard gives a reason instead, and it() on the scratch tree that has the lines
 * (CL_INT=1 with scripts/.cache/calc-audit/status2/build/cl/int.config.mts). The integrator flips them to it() with the lines.
""", """ * The models that needed an integrator line (build/W1B-CL.md CL-1 … CL-7; doubles-calling.ts WIRED) are plain tests since
 * integration 1b put the lines in.
""", "header")
rep(F, """const wired = process.env.CL_INT === "1";
/** A case that needs integrator lines (`lines`, for the report): it() where they are in, it.fails here. */
const needs = (lines: string) => { void lines; return wired ? it : it.fails; };
""", "", "needs helper")
sub(F, r'needs\("[^"]*"\)\(', 'it(', "needs -> it", count=15)
text, _ = read(F)
start = text.index('  (wired ? it.skip : it)("a called Uproar (Copycat\'s) waits for CL-1 and CL-2: the reason"')
end = text.index('  it("into awake foes only: followed today', start)
rep(F, text[start:end], "", "unwired-only Uproar test")
rep(F, """    // Unwired (CL-1 / CL-2 not in) a turn with no sleep at all is followed already; its assumption stands either way.
""", "", "unwired comment")
rep(F, """  it("Instruct by a Protean or Libero user (its PrepareHit changes the type, which doubles-typing.ts leaves out): the reason", async () => {""",
 """  it("Instruct by a Protean or Libero user: no reason (CL-7: Instruct is no callsMove move, so doubles-typing.ts proteanGuard acts on it)", async () => {""", "Protean test name")
rep(F, """    expect(() => callingGuard(instruct, w, OL)).toThrow("Instruct with Protean is not modelled in 2v2.");
    w.mons[OL]!.build = { ...w.mons[OL]!.build, abilityActive: false };
    expect(() => callingGuard(instruct, w, OL)).not.toThrow();""", """    expect(() => callingGuard(instruct, w, OL)).not.toThrow();
    w.mons[OL]!.build = { ...w.mons[OL]!.build, abilityActive: false };
    expect(() => callingGuard(instruct, w, OL)).not.toThrow();""", "Protean test body")
