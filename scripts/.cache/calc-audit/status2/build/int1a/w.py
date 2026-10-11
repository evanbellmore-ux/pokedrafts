# Integration 1a, W's kernel lines L1-L4, L6-L12 and the WIRED flags (W1A-W.md; w1a-w/make-tree.py LINES), with F's Spicy
# Spray line in calculate.ts. The doubles-spread.ts line went in with s-spread.py.
import os, sys, re, types
here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, here)
from apply import apply
src = open(os.path.join(here, "../w1a-w/make-tree.py"), encoding="utf8").read()
src = src[:src.index("def main():")]
mod = types.ModuleType("mk"); exec(src.replace('ROOT = ', 'ROOT = None and ').replace('SRC = ', 'SRC = None and ').replace('DST = ', 'DST = None and '), mod.__dict__)
patches = []
for name, pairs in mod.LINES.items():
  if name == "doubles-spread.ts": continue
  for old, new in pairs: patches.append((name, old, new, f"W {name}"))
apply(patches)
