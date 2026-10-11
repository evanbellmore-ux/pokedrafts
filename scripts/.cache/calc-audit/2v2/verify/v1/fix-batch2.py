import re
V = 'scripts/.cache/calc-audit/2v2/verify/'


def sub(path, pairs):
    s = open(V + path, encoding='utf8').read()
    for a, b in pairs:
        assert a in s, (path, a[:100])
        s = s.replace(a, b)
    open(V + path, 'w', encoding='utf8').write(s)


sub('cases-g4.ts', [
    ('''  slots: slots(act(mon("Lapras", "Shell Armor"), "Sheer Cold", PR), idle(lax(0)), idle(lax(8)), { ...lax(16, { choice: "dynamax" }), action: { move: null } }),''',
     '''  slots: slots(act(mon("Lapras", "Shell Armor"), "Sheer Cold", PR), idle(lax(0)), idle(lax(8)), act(lax(16, { choice: "dynamax" }), "Body Slam", OR)),'''),
    ('''  title: "SwSh: Sheer Cold into a Dynamaxed Snorlax: fails",''', '''  title: "SwSh: Sheer Cold into a Snorlax that Dynamaxes this turn (its Max Strike at Lapras's ally): fails",'''),
])
sub('cases-fs.ts', [
    ('''  title: "SwSh: Mist on the side of a Mirror Armor Corviknight; a foe's Snarl (Mirror Armor reflects first) (F40)",
  slots: slots(act(fast("swsh", mon("Altaria", "Natural Cure")), "Mist"), idle(mon("Corviknight", "Mirror Armor")), act(mon("Arcanine", "Intimidate"), "Snarl"), idle(lax(8))),''',
     '''  title: "SwSh: Mist on the side of a Mirror Armor Corviknight; a foe Arcanine's Scary Face into it (Mirror Armor reflects first) (F40)",
  slots: slots(act(fast("swsh", mon("Altaria", "Natural Cure")), "Mist"), idle(mon("Corviknight", "Mirror Armor")), act(mon("Arcanine", "Intimidate"), "Scary Face", OR), idle(lax(8))),'''),
    ('''  notEstimated: "A weather or terrain change this turn would change Iron Hands.",''', '''  notEstimated: "A weather or terrain change this turn would change Quark Drive.",'''),
])
sub('cases-f2.ts', [
    ('''  notEstimated: "Attract needs Snorlax's gender.",
  slots: slots(act(mon("Alcremie", "Sweet Veil", { gender: "F" }), "Attract", PR), idle(lax(0)), idle(lax(16)), act(lax(8), "Body Slam", OL)),''',
     '''  notEstimated: "Attract needs Arcanine's gender.",
  slots: slots(act(mon("Alcremie", "Sweet Veil", { gender: "F" }), "Attract", PR), idle(lax(0)), idle(lax(16)), act(mon("Arcanine", "Intimidate"), "Flamethrower", OL)),'''),
    ('''  slots: slots(act(mon("Porygon2", "Download", { moves: ["Thunderbolt"] }), "Conversion"), idle(lax(0)), act(mon("Garchomp", "Rough Skin", { nature: "Brave" }), "Earthquake"), idle(lax(8))),''',
     '''  // Download's lead +1 Atk: Showdown's start has it (boosts); the app input is before the start settle, which adds it (appBoosts).
  slots: slots(act(mon("Porygon2", "Download", { moves: ["Thunderbolt"], boosts: { atk: 1 }, appBoosts: {} }), "Conversion"), idle(lax(0)), act(mon("Garchomp", "Rough Skin", { nature: "Brave" }), "Earthquake"), idle(lax(8))),'''),
])
sub('cases-sat.ts', [
    ('''    slots: slots(act(mon("Espeon", "Synchronize", { evs: { spe: 252 } }), "Skill Swap", OR), idle(mon("Porygon2", "Download")), idle(lax(16, { boosts: { def: 6 } })), idle(lax(8))),''',
     '''    // Download's lead +1 Atk: in Showdown's start (boosts); the app's start settle adds it (appBoosts: before it).
    slots: slots(act(mon("Espeon", "Synchronize", { evs: { spe: 252 } }), "Skill Swap", OR), idle(mon("Porygon2", "Download", { boosts: { atk: 1 }, appBoosts: {} })), idle(lax(16, { boosts: { def: 6 } })), idle(lax(8))),'''),
    ('''    act(game === "sv" ? mon("Grumpig", "Thick Fat", { evs: { spe: 252 } }) : mon("Audino", "Healer", { evs: { spe: 32 } }), "Simple Beam", OR)''',
     '''    act(game === "sv" ? mon("Grumpig", "Thick Fat", { evs: { spe: 252 } }) : mon("Sirfetch’d", "Steadfast", { evs: { spe: 32 } }), "Simple Beam", OR)'''),
    ('''    slots: slots(act(game === "sv" ? mon("Grumpig", "Thick Fat", { evs: { spe: 252 }, item: "Sitrus Berry", hp: 60 }) : mon("Audino", "Healer", { evs: { spe: 32 }, item: "Sitrus Berry", hp: 60 }), "Simple Beam", PR)''',
     '''    slots: slots(act(game === "sv" ? mon("Grumpig", "Thick Fat", { evs: { spe: 252 }, item: "Sitrus Berry", hp: 60 }) : mon("Sirfetch’d", "Steadfast", { evs: { spe: 32 }, item: "Sitrus Berry", hp: 60 }), "Simple Beam", PR)'''),
])
# SAT-ACU-4b: an aimed-at empty slot is an app input issue by design (doubles-targets.ts lists present slots only): dropped.
s = open(V + 'cases-sat.ts', encoding='utf8').read()
start = s.index('  add("SAT-ACU-4b", game, {')
end = s.index('  });\n', start) + len('  });\n')
s = s[:start] + '  // SAT-ACU-4b (the ally fainted: Acupressure falls on its user) is not built: the app input cannot aim a move at an\n  // empty slot (doubles-targets.ts lists the present slots only), so the turn is an input issue there by design.\n' + s[end:]
open(V + 'cases-sat.ts', 'w', encoding='utf8').write(s)
print('ok')
