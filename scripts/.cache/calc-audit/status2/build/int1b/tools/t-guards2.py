from patchlib import rep
F = "tests/unit/doubles-turn-guards.test.ts"
rep(F, """      expect(result.status, `${g} ${move}: ${result.status === "not-estimated" ? result.reason : ""}`).toBe("ready");""",
"""      // Beat Up's row needs its party (T2P §3.5: its own needs-context text while the party is not given); the rest are ready.
      if (move === "beatup") expect(result.status === "not-estimated" && result.reason).toBe("Beat Up: party needed.");
      else expect(result.status, `${g} ${move}: ${result.status === "not-estimated" ? result.reason : ""}`).toBe("ready");""", "beat up")
