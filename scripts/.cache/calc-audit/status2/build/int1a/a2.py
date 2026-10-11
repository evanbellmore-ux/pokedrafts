# Integration 1a, A2's P1-P3, P6, P7, P9-P11 (W1A-A2.md; a2/integrator-patches.py). P4/P5 went in by hand with A1's I2/I3
# (one outcomeOf / conditionFacts edit for every track).
import importlib.util, os, sys
here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("a2p", os.path.join(here, "../a2/integrator-patches.py"))
a2p = importlib.util.module_from_spec(spec); spec.loader.exec_module(a2p)
sys.path.insert(0, here)
from apply import apply
skip = ("A2's condition facts", "A2's E2 volatiles")
patches = [p for p in a2p.PATCHES if not p[3].startswith(skip)]
assert len(patches) == len(a2p.PATCHES) - 2
apply(patches)
