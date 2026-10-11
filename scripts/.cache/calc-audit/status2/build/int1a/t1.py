# Integration 1a, T1's model.ts line (W1A-T1.md needsFromIntegrator): a used Protean or Libero with its types given is valid
# (the 2v2 turn and Training pass BuildBase.types; no 1v1 build sets types, so 1v1 is unchanged).
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apply import apply
apply([("model.ts",
  '''  if (["protean", "libero"].includes(build.abilityId) && !build.abilityActive) {''',
  '''  // status2 (integration 1a, T1): a used Protean or Libero is calculated when its types are given (BuildBase.types).
  if (["protean", "libero"].includes(build.abilityId) && !build.abilityActive && build.types === undefined) {''',
  "a used Protean / Libero with its types")])
