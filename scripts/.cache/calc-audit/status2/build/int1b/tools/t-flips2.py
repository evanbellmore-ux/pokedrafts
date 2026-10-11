from patchlib import rep
F = "tests/unit/doubles-fieldchange.test.ts"
rep(F, 'import { readFileSync } from "node:fs";\n', '', "FC import")
rep(F, """    {
      expect(stepTexts(ready(input), OL)).toEqual(expect.arrayContaining(["Hawlucha's Grassy Seed is used up on Grassy Terrain: +1 Defense.", "Snorlax (yours)'s Grassy Seed is used up on Grassy Terrain: +1 Defense."]));
    }
""", """    expect(stepTexts(ready(input), OL)).toEqual(expect.arrayContaining(["Hawlucha's Grassy Seed is used up on Grassy Terrain: +1 Defense.", "Snorlax (yours)'s Grassy Seed is used up on Grassy Terrain: +1 Defense."]));
""", "FC block")
