from patchlib import rep, sub, read
F = "tests/unit/doubles-pairs.test.ts"
rep(F, 'import { WIRED, bandedLoss } from "@/app/lib/battle/doubles-pairs";', 'import { bandedLoss } from "@/app/lib/battle/doubles-pairs";', "import")
rep(F, """ * set (Champions: Stat Points). The parts behind a kernel line W asked the integrator for run once its flag is set
 * (doubles-pairs.ts WIRED); until then their fallback keeps today's text.
 */""", """ * set (Champions: Stat Points). The kernel lines W asked the integrator for are in since integration 1a (doubles-pairs.ts's WIRED
 * flags and their fallbacks went at integration 1b).
 */""", "header")
rep(F, "      if (WIRED.hurt) expect(facts(", "      expect(facts(", "hurt fact")
rep(F, """      if (!WIRED.selfHitBand) { expect(reason(input(runtime))).toBe("Focus Band is not modelled."); continue; }
""", "", "selfHitBand")
rep(F, """    if (!WIRED.attackerSafeguard) { expect(reason(input)).toBe("Spicy Spray with Safeguard is not modelled in 2v2."); return; }
""", "", "safeguard")
rep(F, """    if (!WIRED.hurt) {
      // Without the step's target the Pokémon's own record cannot tell: today's text.
      expect(reason(helmet)).toBe("Assurance is not modelled in 2v2.");
      expect(reason(drain)).toBe("Assurance is not modelled in 2v2.");
      return;
    }
""", "", "hurt")
rep(F, """    if (!WIRED.frozenContext) { expect(reason(shielded)).toBe("Gale Wings is not modelled in 2v2."); return; }
""", "", "frozen 1")
rep(F, """    if (!WIRED.frozenContext) return;
""", "", "frozen 2")
text, _ = read(F)
start = text.index('  it("is today\'s text until the continuation\'s kernel line is in", async () => {')
end = text.index('  it("Ganlon after hit 1', start)
rep(F, text[start:end], "", "continuation fallback test")
sub(F, r"    if \(!WIRED\.continuation\) return;\n", "", "continuation returns", count=5)
rep(F, """    if (!WIRED.faintedInHits) { expect(reason(lifeOrb)).toBe("Sparkling Aria's burn cure after Primarina faints in the move is not modelled in 2v2."); return; }
""", "", "faintedInHits")
