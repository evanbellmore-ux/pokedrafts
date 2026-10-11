from patchlib import rep, sub, read
R = "tests/unit/doubles-reactions.test.ts"
for name in ["sv: a third Pokémon's Unnerve stops the target's Haban Berry (K-UN-01)", "sv: the user's own Unnerve does not stop its ally's Shuca Berry in a spread move (K-UN-02)",
             "sv: Thief into the Berry under a third Pokémon's Unnerve: the narrow reason (K-UN-03)", "the user's faint names Innards Out and Aftermath (K-IO-07, K-AF-06)"]:
    rep(R, f'  it.fails("{name}"', f'  it("{name}"', "K flip")
rep(R, "  // The stand-ins need the integrator's searchFor line (W1B-K.md needsFromIntegrator 1): until then the reason stands.\n",
    "  // The stand-ins read the integrator's searchFor line (W1B-K.md needsFromIntegrator 1, in since integration 1b).\n", "K comment 1")
rep(R, "  // The self-faint fact's sources (doubles-turn.ts selfFaintFact) need the integrator's line (W1B-K.md needsFromIntegrator 2).\n",
    "  // The self-faint fact's sources (doubles-turn.ts selfFaintFact: W1B-K.md needsFromIntegrator 2, in since integration 1b).\n", "K comment 2")
S = "tests/unit/doubles-start.test.ts"
sub(S, r'  it\.fails\("\(integrator ST-', '  it("(integrator ST-', "ST flips", count=4)
rep(S, """ * Tests named "(integrator ST-n)" read a doubles-turn.ts line this track asks the integrator for (W1B-ST.md): they are
 * `it.fails` until that line is in, and pass on the scratch engine with the lines applied (w1b-st/patch-int.cjs), which is
 * the signal to flip them to `it`.
""", """ * Tests named "(integrator ST-n)" read a doubles-turn.ts line this track asked the integrator for (W1B-ST.md), in since
 * integration 1b.
""", "ST header")
E = "tests/unit/doubles-eot.test.ts"
rep(E, """// status2 E2's asks of the integrator (status2/build/W1B-E2.md, "For the integrator"): each test fails until its kernel lines
// land (it.fails), then flips to it(). Numbers: E2's own oracle cases (status2/build/e2/e2-extra-cases.ts), pinned Showdown.
""", """// status2 E2's asks of the integrator (status2/build/W1B-E2.md, "For the integrator"), in since integration 1b. Numbers: E2's
// own oracle cases (status2/build/e2/e2-extra-cases.ts), pinned Showdown.
""", "E2 comment")
sub(E, r'  it\.fails\("(a landing whose user|Taunt, Encore and Disable used this turn)', r'  it("\1', "E2 flips", count=2)
U = "tests/unit/calculator-doubles-ui.test.ts"
rep(U, """  // Needs the integrator's line in doubles-turn.ts afterHit (W1B-U2.md): the ×2 itself is exact today (416–492 against
  // 208–246 without Minimize, pinned Showdown's onSourceModifyDamage chainModify(2)); the hit says so once it lands.
  it.fails("Body Slam""", """  // The integrator's line in doubles-turn.ts afterHit (W1B-U2.md, in since integration 1b): the ×2 itself is exact (416–492
  // against 208–246 without Minimize, pinned Showdown's onSourceModifyDamage chainModify(2)); the hit says so.
  it("Body Slam""", "U2 flip")
F = "tests/unit/doubles-fieldchange.test.ts"
text, _ = read(F)
start = text.index("/** The lines FC asks of the integrator and of E2 (W1B-FC.md), as they read once in. */")
end = text.index('describe("status2 FC: a field move', start)
rep(F, text[start:end], "", "FC source gates")
sub(F, r'  it\.skipIf\(!with[A-Za-z]+\)\(', '  it(', "FC skipIf", count=5)
sub(F, r'if \(with(Action|Room)\) ', '', "FC inline ifs", count=5)
