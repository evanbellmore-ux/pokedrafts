# Track V1: the proposed outcomeOf wiring (needsFromIntegrator), applied to a COPY of app/lib/battle (v1/wired/battle) only.
import sys
p = sys.argv[1]
s = open(p, encoding='utf8').read()
a = r'''    const a = statusHooks.outcomeMon(kernel, world, slot), b = eotHooks.outcomeMon(kernel, world, slot), e = positionHooks.outcomeMon(kernel, world, slot);
    const volatiles = [...new Set([...(a.volatiles ?? []), ...(b.volatiles ?? []), ...(e.volatiles ?? []), ...(mon.vol.substitute ? ["substitute"] : [])])].sort();'''
b = r'''    const a = statusHooks.outcomeMon(kernel, world, slot), b = eotHooks.outcomeMon(kernel, world, slot), e = positionHooks.outcomeMon(kernel, world, slot);
    // status2 wiring: A1's outcomeMon (volatiles, its build, fields: accuracy/evasion stages, a transformed Pokémon's moves),
    // A2's outcomeVolatiles, a charged move's twoturnmove with the move's own volatile, Glaive Rush.
    const s2 = mon.fainted ? null : abilityHooks.outcomeMon(kernel, world, slot), t = typingHooks.outcomeVolatiles(kernel, world, slot);
    if (s2?.build) entry.build = s2.build;
    if (s2) Object.assign(entry, s2.fields);
    const vol2 = [...(s2?.volatiles ?? []), ...t, ...(mon.vol.charging ? ["twoturnmove", mon.vol.charging] : []), ...(mon.vol.glaiveRush ? ["glaiverush"] : [])];
    const volatiles = [...new Set([...(a.volatiles ?? []), ...(b.volatiles ?? []), ...(e.volatiles ?? []), ...vol2, ...(mon.vol.substitute ? ["substitute"] : [])])].sort();'''
assert a in s, 'anchor'
s = s.replace(a, b)
open(p, 'w', encoding='utf8').write(s)
print('patched')
