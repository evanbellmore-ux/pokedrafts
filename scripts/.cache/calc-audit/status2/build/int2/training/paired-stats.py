import json, statistics, sys
SP='/tmp/claude-0/-home-user-pokedrafts/1fff6e15-9f52-5b3b-bbb9-2b51ed040eae/scratchpad'
trees={'main':SP+'/maintree/scripts/.cache/training/eval','now':'/home/user/pokedrafts/scripts/.cache/training/eval'}
def q(xs,p):
  xs=sorted(xs); 
  if not xs: return float('nan')
  i=(len(xs)-1)*p; lo=int(i); hi=min(lo+1,len(xs)-1); return xs[lo]+(xs[hi]-xs[lo])*(i-lo)
for run in ['safe-random-closed','safe-maxdamage-perfect','safe-maxdamage-suggested']:
  for tree,base in trees.items():
    for r in (1,2):
      d=json.load(open(f'{base}/int2-paired-{tree}-r{r}/{run}.json'))
      turns=[x for b in d for x in b['decisions'] if x['side']=='p2' and x['kind']=='turn']
      ms=[x['ms'] for x in turns]
      st=[x['stats'] for x in turns if x['stats']]
      meth={}
      for s in st:
        for k,v in s['byMethod'].items(): meth[k]=meth.get(k,0)+v
      print(f"{run:26s} {tree} r{r} n={len(ms)} p50={q(ms,.5):.0f} p95={q(ms,.95):.0f} max={max(ms):.0f} | engineCalls mean {statistics.mean(s['engineCalls'] for s in st):.1f} rollouts mean {statistics.mean(s['rolloutSamples'] for s in st):.1f} builds {statistics.mean(s['builds'] for s in st):.2f} preludes {statistics.mean(s['preludes'] for s in st):.2f} | methods {meth}")
