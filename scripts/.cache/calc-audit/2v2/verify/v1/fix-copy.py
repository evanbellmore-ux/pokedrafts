V = 'scripts/.cache/calc-audit/2v2/verify/'
p = V + 'compare.ts'
s = open(p, encoding='utf8').read()
a = '''    const species = c?.slots[target]?.species;
    const facts = [
      ...(hits.get(target)?.facts ?? []), ...(target === slot ? s.facts.filter((f) => !copyFact(f.text)) : []),
      ...(species ? s.facts.filter((f) => copyFact(f.text) && f.text.includes(species)) : []),
    ];'''
b = '''    // The copier's name ("Espathra (opponent's)", "Espathra (yours)" across sides) against the target's species and side.
    const species = c?.slots[target]?.species;
    const copiedBy = (t: string) => {
      const name = /: (.+?) copies [+−]/.exec(t)?.[1];
      if (!name || !species) return false;
      const side = /\((yours|opponent's)\b/.exec(name)?.[1];
      return name.split(" (")[0] === species && (!side || (side === "yours") === target.startsWith("own"));
    };
    const facts = [
      ...(hits.get(target)?.facts ?? []), ...(target === slot ? s.facts.filter((f) => !copyFact(f.text)) : []),
      ...s.facts.filter((f) => copyFact(f.text) && copiedBy(f.text)),
    ];'''
assert a in s
s = s.replace(a, b)
open(p, 'w', encoding='utf8').write(s)
print('ok')
