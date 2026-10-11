from patchlib import rep, sub, read
T = "tests/unit/doubles-max.test.ts"
text, _ = read(T)
start = text.index('  it("keeps today\'s reasons until the kernel lines are in (WIRED false)", async () => {')
end = text.index("  });\n", start) + len("  });\n")
rep(T, text[start:end], "", "fallback test")
rep(T, "G-Max random effects (WIRED.worlds: maxEffects' worlds at its call sites)", "G-Max random effects (maxEffects' worlds at its call sites)", "d1")
rep(T, "Max Guard (WIRED.maxGuard: a Dynamaxed Pokémon's status move)", "Max Guard (a Dynamaxed Pokémon's status move)", "d2")
rep(T, "Pain Split into a Dynamaxed Pokémon (WIRED.painSplit)", "Pain Split into a Dynamaxed Pokémon", "d3")
