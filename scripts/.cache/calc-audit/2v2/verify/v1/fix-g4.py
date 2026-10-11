p = 'scripts/.cache/calc-audit/2v2/verify/cases-g4.ts'
s = open(p, encoding='utf8').read()
a = '''  slots: slots(idle(carried(mon("Venusaur", "Overgrow", { healBlock: undefined } as never), {})), idle(lax(4)),
    idle(carried(mon("Tentacruel", "Liquid Ooze", { ivs: { spe: 13 } }), { leechSeed: OL })), act(mon("Bronzong", "Levitate", { evs: { spe: 252 } }), "Heal Block")),'''
b = '''  slots: slots(idle(mon("Venusaur", "Overgrow", { evs: { spe: 36 } })), idle(lax(4)),
    idle(carried(mon("Tentacruel", "Liquid Ooze", { ivs: { spe: 0 } }), { leechSeed: OL })), act(mon("Bronzong", "Levitate", { evs: { spe: 252 } }), "Heal Block")),'''
assert a in s
s = s.replace(a, b)
open(p, 'w', encoding='utf8').write(s)
p = 'scripts/.cache/calc-audit/2v2/verify/cases-wave1a.ts'
s = open(p, encoding='utf8').read()
a = '''import { FS_CASES } from "./cases-fs";

export const WAVE1A_CASES: Case[] = [...IN_CASES, ...CQ_CASES, ...T2E_CASES, ...T2M_CASES, ...CR_CASES, ...SAT_CASES, ...F2_CASES, ...FS_CASES];'''
b = '''import { FS_CASES } from "./cases-fs";
import { G4_CASES } from "./cases-g4";

export const WAVE1A_CASES: Case[] = [...IN_CASES, ...CQ_CASES, ...T2E_CASES, ...T2M_CASES, ...CR_CASES, ...SAT_CASES, ...F2_CASES, ...FS_CASES, ...G4_CASES];'''
assert a in s
s = s.replace(a, b)
s = s.replace('''  [/^IN-ACC-02|^G4-/, "D"],''', '''  [/^G4-(HRV|PKP|LOZ|WHR|PER|STF-04|HBK-06|OPP-09)/, "E1"],
  [/^IN-ACC-02|^G4-/, "D"],''')
open(p, 'w', encoding='utf8').write(s)
print("ok")
