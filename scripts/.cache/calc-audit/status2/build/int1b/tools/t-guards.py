from patchlib import rep, read
F = "tests/unit/doubles-turn-guards.test.ts"
rep(F, """  it("names each move not modelled in 2v2", async () => {""", """  it("follows each presence move (status2 PR: Beat Up, Round, Beak Blast, Fusion Bolt and Flare, Spotlight, Shell Trap, Counter)", async () => {""", "presence name")
rep(F, """      expectReason(turn(runtime, {
        "own-left": { id, move, ...(target ? { target } : {}) }, "own-right": { id: "garchomp", move: "dragonclaw", target: "opponent-left" },
        "opponent-left": idle("venusaur"), "opponent-right": idle("blastoise"),
      }), `${runtime.movesById.get(move)!.name} is not modelled in 2v2.`, ["own-right"]);""", """      const result = calculateDoublesTurn(turn(runtime, {
        "own-left": { id, move, ...(target ? { target } : {}) }, "own-right": { id: "garchomp", move: "dragonclaw", target: "opponent-left" },
        "opponent-left": idle("venusaur"), "opponent-right": idle("blastoise"),
      }));
      expect(result.status, `${g} ${move}: ${result.status === "not-estimated" ? result.reason : ""}`).toBe("ready");""", "presence body")
rep(F, """  it("names Imposter and Commander with Dondozo on its side; Neutralizing Gas is modelled", async () => {""",
 """  it("follows Imposter (status2 ST, Q8), Commander with Dondozo on its side (PR) and Neutralizing Gas", async () => {""", "imposter name")
rep(F, """    expectReason(turn(sv, { "own-left": idle("ditto", { ability: "imposter" }), "own-right": idle("charizard"), ...base }), "Imposter is not modelled in 2v2.");
    expectReason(turn(sv, { "own-left": idle("tatsugiri", { ability: "commander" }), "own-right": idle("dondozo", { ability: "unaware" }), ...base }), "Commander is not modelled in 2v2.");""",
 """    // Ditto transforms into the Pokémon across from it as both entered (USER-DECISIONS Q8; doubles-start.test.ts).
    expect(calculateDoublesTurn(turn(sv, { "own-left": idle("ditto", { ability: "imposter" }), "own-right": idle("charizard"), ...base })).status).toBe("ready");
    // Tatsugiri goes inside Dondozo (doubles-presence.test.ts).
    expect(calculateDoublesTurn(turn(sv, { "own-left": idle("tatsugiri", { ability: "commander" }), "own-right": idle("dondozo", { ability: "unaware" }), ...base })).status).toBe("ready");""", "imposter body")
rep(F, """  it("Dancer when a dance move is used", async () => {
    const sv = await game("scarlet_violet");
    expectReason(turn(sv, {
      "own-left": idle("oricorio", { ability: "dancer" }), "own-right": idle("snorlax"),
      "opponent-left": { id: "volcarona", ability: "flamebody", move: "fierydance", target: "own-right" }, "opponent-right": idle("blastoise"),
    }), "Dancer is not modelled.", ["opponent-left"]);""", """  it("Dancer when a dance move is used (modelled: status2 PR, doubles-presence.test.ts)", async () => {
    const sv = await game("scarlet_violet");
    expect(calculateDoublesTurn(turn(sv, {
      "own-left": idle("oricorio", { ability: "dancer" }), "own-right": idle("snorlax"),
      "opponent-left": { id: "volcarona", ability: "flamebody", move: "fierydance", target: "own-right" }, "opponent-right": idle("blastoise"),
    })).status).toBe("ready");""", "dancer")
rep(F, """  it("Trace with a random source or copying Intimidate; Download with a foe's entry boost", async () => {
    // Trace unset: the foes' copyable abilities differ (Overgrow, Torrent).
    expectReason(turn(championsRuntime, {""", """  it("Trace with a random source or copying Intimidate; Download with a foe's entry boost (modelled: status2 ST, doubles-start.test.ts)", async () => {
    // Trace unset: the foes' copyable abilities differ (Overgrow, Torrent): one start per copy, 1/2 each.
    expect(calculateDoublesTurn(turn(championsRuntime, {""", "trace 1")
rep(F, """      "opponent-left": idle("venusaur", { ability: "overgrow" }), "opponent-right": idle("blastoise", { ability: "torrent" }),
    }), "Trace copies a random foe's ability.");
    expectReason(turn(championsRuntime, {
      "own-left": idle("gardevoir", { ability: "trace", build: { tracedAbility: "intimidate" } }), "own-right": { id: "garchomp", move: "dragonclaw", target: "opponent-left" },
      "opponent-left": idle("incineroar", { ability: "intimidate" }), "opponent-right": idle("blastoise"),
    }), "Trace copying Intimidate is not modelled in 2v2.");
    const swsh = await game("sword_shield");
    expectReason(turn(swsh, {
      "own-left": { id: "porygon2", ability: "download", move: "triattack", target: "opponent-right" }, "own-right": idle("charizard"),
      "opponent-left": idle("venusaur"), "opponent-right": idle("zamazenta", { ability: "dauntlessshield" }),
    }), "Download is not modelled with Zamazenta's entry boost.");""", """      "opponent-left": idle("venusaur", { ability: "overgrow" }), "opponent-right": idle("blastoise", { ability: "torrent" }),
    })).status).toBe("ready");
    expect(calculateDoublesTurn(turn(championsRuntime, {
      "own-left": idle("gardevoir", { ability: "trace", build: { tracedAbility: "intimidate" } }), "own-right": { id: "garchomp", move: "dragonclaw", target: "opponent-left" },
      "opponent-left": idle("incineroar", { ability: "intimidate" }), "opponent-right": idle("blastoise"),
    })).status).toBe("ready");
    const swsh = await game("sword_shield");
    expect(calculateDoublesTurn(turn(swsh, {
      "own-left": { id: "porygon2", ability: "download", move: "triattack", target: "opponent-right" }, "own-right": idle("charizard"),
      "opponent-left": idle("venusaur"), "opponent-right": idle("zamazenta", { ability: "dauntlessshield" }),
    })).status).toBe("ready");""", "trace 2")
rep(F, """    // 40/183 is at or under a quarter: the Starf Berry is eaten at the turn's first Update.
    expectReason(turn(sv, {
      "own-left": { id: "garchomp", item: "starfberry", hp: 40, move: "dragonclaw", target: "opponent-right" }, "own-right": idle("charizard"),
      "opponent-left": idle("venusaur"), "opponent-right": idle("blastoise"),
    }), "Starf Berry raises a random stat");""", """    // 40/183 is at or under a quarter: the Starf Berry is eaten at the turn's first Update, one start per stat (status2 ST).
    expect(calculateDoublesTurn(turn(sv, {
      "own-left": { id: "garchomp", item: "starfberry", hp: 40, move: "dragonclaw", target: "opponent-right" }, "own-right": idle("charizard"),
      "opponent-left": idle("venusaur"), "opponent-right": idle("blastoise"),
    })).status).toBe("ready");""", "starf")
rep(F, """  it("two Pokémon acting on one as the turn starts", async () => {
    // Tyranitar's Unnerve keeps Flutter Mane's Sitrus Berry (50/130) uneaten; Altaria's Cloud Nine keeps the sun from its Protosynthesis.
    const sv = await game("scarlet_violet");
    expectReason(turn(sv, {
      "own-left": { id: "fluttermane", item: "sitrusberry", hp: 50, move: "moonblast", target: "opponent-left" }, "own-right": idle("charizard"),
      "opponent-left": idle("tyranitar", { ability: "unnerve" }), "opponent-right": idle("altaria", { ability: "cloudnine" }),
    }, { weather: "Sun" }), ["Tyranitar and Altaria both act on Flutter Mane as the turn starts.", "Altaria and Tyranitar both act on Flutter Mane as the turn starts."]);""",
 """  it("two Pokémon acting on one as the turn starts (modelled: status2 ST's SettleReads)", async () => {
    // Tyranitar's Unnerve keeps Flutter Mane's Sitrus Berry (50/130) uneaten; Altaria's Cloud Nine keeps the sun from its Protosynthesis.
    const sv = await game("scarlet_violet");
    expect(calculateDoublesTurn(turn(sv, {
      "own-left": { id: "fluttermane", item: "sitrusberry", hp: 50, move: "moonblast", target: "opponent-left" }, "own-right": idle("charizard"),
      "opponent-left": idle("tyranitar", { ability: "unnerve" }), "opponent-right": idle("altaria", { ability: "cloudnine" }),
    }, { weather: "Sun" })).status).toBe("ready");""", "two act")
rep(F, """  it("Focus Band when a hit into it can knock out (modelled: status2 W), and Max Guard", async () => {""", """  it("Focus Band when a hit into it can knock out (modelled: status2 W), and Max Guard (status2 M)", async () => {""", "max guard name")
rep(F, """    expectReason(turn(swsh, {
      "own-left": { id: "charizard", move: "protect", build: { mechanic: "dynamax" } }, "own-right": { id: "garchomp", move: "dragonclaw", target: "opponent-right" },
      "opponent-left": idle("venusaur"), "opponent-right": idle("blastoise"),
    }), "Max Guard is not modelled.", ["own-right"]);""", """    expect(calculateDoublesTurn(turn(swsh, {
      "own-left": { id: "charizard", move: "protect", build: { mechanic: "dynamax" } }, "own-right": { id: "garchomp", move: "dragonclaw", target: "opponent-right" },
      "opponent-left": idle("venusaur"), "opponent-right": idle("blastoise"),
    })).status).toBe("ready");""", "max guard")
rep(F, """    // Breaking Swipe makes contact: Gooey lowers Garchomp's Speed from Goodra, not from Blastoise.
    expectReason(turn(sv, {
      "own-left": { id: "garchomp", move: "breakingswipe" }, "own-right": idle("charizard"),
      "opponent-left": idle("goodra", { ability: "gooey" }), "opponent-right": idle("blastoise"),
    }), "Breaking Swipe's effect on Garchomp from more than one target is not modelled.", ["own-left"]);
    // Spicy Spray burns the attacker that hits it (Mega Scovillain, Champions).
    expectReason(turn(championsRuntime, {
      "own-left": { id: "garchomp", move: "rockslide" }, "own-right": idle("charizard"),
      "opponent-left": idle("scovillainmega"), "opponent-right": idle("blastoise"),
    }), "Rock Slide's effect on Garchomp from more than one target is not modelled.", ["own-left"]);""", """    // Breaking Swipe makes contact: Gooey lowers Garchomp's Speed from Goodra, not from Blastoise (status2 K: replayed in hit order).
    expect(calculateDoublesTurn(turn(sv, {
      "own-left": { id: "garchomp", move: "breakingswipe" }, "own-right": idle("charizard"),
      "opponent-left": idle("goodra", { ability: "gooey" }), "opponent-right": idle("blastoise"),
    })).status).toBe("ready");
    // Spicy Spray burns the attacker that hits it (Mega Scovillain, Champions).
    expect(calculateDoublesTurn(turn(championsRuntime, {
      "own-left": { id: "garchomp", move: "rockslide" }, "own-right": idle("charizard"),
      "opponent-left": idle("scovillainmega"), "opponent-right": idle("blastoise"),
    })).status).toBe("ready");""", "spread K")
rep(F, """  it("a weather, terrain, Tailwind or Trick Room change that would change an ability or item", async () => {
    const sv = await game("scarlet_violet");
    expectReason(turn(sv, {
      "own-left": { id: "charizard", move: "sunnyday" }, "own-right": idle("garchomp"),
      "opponent-left": { id: "fluttermane", move: "moonblast", target: "own-right" }, "opponent-right": idle("blastoise"),
    }), "A weather or terrain change this turn would change Protosynthesis.", ["opponent-left"]);
    expectReason(turn(sv, {
      "own-left": { id: "whimsicott", ability: "prankster", move: "tailwind" }, "own-right": idle("brambleghast", { ability: "windrider" }),
      "opponent-left": { id: "garchomp", move: "dragonclaw", target: "own-left" }, "opponent-right": idle("blastoise"),
    }), "Tailwind would activate Wind Rider.", ["opponent-left"]);
    expectReason(turn(sv, {
      "own-left": { id: "hatterene", ability: "magicbounce", move: "trickroom" }, "own-right": idle("garchomp", { item: "roomservice" }),
      "opponent-left": { id: "garchomp", move: "dragonclaw", target: "own-right" }, "opponent-right": idle("blastoise"),
    }), "Trick Room would activate Room Service.", ["opponent-left"]);""", """  it("a weather, terrain, Tailwind or Trick Room change that would change an ability or item (modelled: status2 FC)", async () => {
    const sv = await game("scarlet_violet");
    expect(calculateDoublesTurn(turn(sv, {
      "own-left": { id: "charizard", move: "sunnyday" }, "own-right": idle("garchomp"),
      "opponent-left": { id: "fluttermane", move: "moonblast", target: "own-right" }, "opponent-right": idle("blastoise"),
    })).status).toBe("ready");
    expect(calculateDoublesTurn(turn(sv, {
      "own-left": { id: "whimsicott", ability: "prankster", move: "tailwind" }, "own-right": idle("brambleghast", { ability: "windrider" }),
      "opponent-left": { id: "garchomp", move: "dragonclaw", target: "own-left" }, "opponent-right": idle("blastoise"),
    })).status).toBe("ready");
    expect(calculateDoublesTurn(turn(sv, {
      "own-left": { id: "hatterene", ability: "magicbounce", move: "trickroom" }, "own-right": idle("garchomp", { item: "roomservice" }),
      "opponent-left": { id: "garchomp", move: "dragonclaw", target: "own-right" }, "opponent-right": idle("blastoise"),
    })).status).toBe("ready");""", "FC weather")
rep(F, """  it("a Max Move's terrain changing a third Pokémon's Mimicry or Electric Seed (M24i, M24j)", async () => {
    const swsh = await game("sword_shield");
    const jolteon = { id: "jolteon", ability: "voltabsorb", move: "thunderbolt", target: "opponent-right" as const, build: { mechanic: "dynamax" as const } };
    expectReason(turn(swsh, {
      "own-left": jolteon, "own-right": { id: "toxtricity", ability: "punkrock", move: "thunderbolt", target: "opponent-left" },
      "opponent-left": idle("stunfiskgalar", { ability: "mimicry" }), "opponent-right": idle("snorlax"),
    }), "A weather or terrain change this turn would change Mimicry.", ["own-left"]);
    expectReason(turn(swsh, {
      "own-left": jolteon, "own-right": { id: "snorlax", move: "bodyslam", target: "opponent-left" },
      "opponent-left": idle("blastoise", { item: "electricseed" }), "opponent-right": idle("venusaur"),
    }), "A weather or terrain change this turn would change Electric Seed.", ["own-left"]);""", """  it("a Max Move's terrain changing a third Pokémon's Mimicry or Electric Seed (M24i, M24j; modelled: status2 FC)", async () => {
    const swsh = await game("sword_shield");
    const jolteon = { id: "jolteon", ability: "voltabsorb", move: "thunderbolt", target: "opponent-right" as const, build: { mechanic: "dynamax" as const } };
    expect(calculateDoublesTurn(turn(swsh, {
      "own-left": jolteon, "own-right": { id: "toxtricity", ability: "punkrock", move: "thunderbolt", target: "opponent-left" },
      "opponent-left": idle("stunfiskgalar", { ability: "mimicry" }), "opponent-right": idle("snorlax"),
    })).status).toBe("ready");
    expect(calculateDoublesTurn(turn(swsh, {
      "own-left": jolteon, "own-right": { id: "snorlax", move: "bodyslam", target: "opponent-left" },
      "opponent-left": idle("blastoise", { item: "electricseed" }), "opponent-right": idle("venusaur"),
    })).status).toBe("ready");""", "M24")
rep(F, """  it("an ability out in 2v2 when it triggers, and a G-Max move's random status", async () => {
    const swsh = await game("sword_shield");
    expectReason(turn(swsh, {
      "own-left": { id: "charizard", move: "flamethrower", target: "opponent-right" }, "own-right": idle("garchomp"),
      "opponent-left": idle("venusaur"), "opponent-right": idle("eldegoss", { ability: "cottondown" }),
    }), "Cotton Down is not modelled in 2v2.", ["own-left"]);
    expectReason(turn(swsh, {
      "own-left": { id: "butterfree", move: "bugbuzz", target: "opponent-right", build: { mechanic: "gigantamax", configuration: { gigantamax: true } } },
      "own-right": idle("garchomp"), "opponent-left": { id: "snorlax", move: "bodyslam", target: "own-right" }, "opponent-right": idle("blastoise"),
    }), "G-Max Befuddle's random status is not modelled in 2v2.", ["own-left"]);""", """  it("Cotton Down when it triggers (status2 K), and a G-Max move's random status (status2 M)", async () => {
    const swsh = await game("sword_shield");
    expect(calculateDoublesTurn(turn(swsh, {
      "own-left": { id: "charizard", move: "flamethrower", target: "opponent-right" }, "own-right": idle("garchomp"),
      "opponent-left": idle("venusaur"), "opponent-right": idle("eldegoss", { ability: "cottondown" }),
    })).status).toBe("ready");
    expect(calculateDoublesTurn(turn(swsh, {
      "own-left": { id: "butterfree", move: "bugbuzz", target: "opponent-right", build: { mechanic: "gigantamax", configuration: { gigantamax: true } } },
      "own-right": idle("garchomp"), "opponent-left": { id: "snorlax", move: "bodyslam", target: "own-right" }, "opponent-right": idle("blastoise"),
    })).status).toBe("ready");""", "cotton/gmax")
