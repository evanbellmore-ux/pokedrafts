# Integration 1a: the lines other tracks asked of A3's doubles-field.ts (needsFromOthers): A2's Gravity start, H's Teatime user.
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apply import apply
apply([
 ("doubles-field.ts",
  '''import * as presenceNs from "./doubles-presence";\n''',
  '''import * as presenceNs from "./doubles-presence";\nimport * as typingNs from "./doubles-typing";\n''',
  "A2: import doubles-typing"),
 ("doubles-field.ts",
  '''    for (const each of DOUBLES_SLOTS) if (w.mons[each]?.eot.hidden && kernel.alive(w, each)) hiddenHooks.land(kernel, w, each);\n''',
  '''    for (const each of DOUBLES_SLOTS) if (w.mons[each]?.eot.hidden && kernel.alive(w, each)) hiddenHooks.land(kernel, w, each);\n'''
  '''    // Gravity's onFieldStart also ends Magnet Rise and Telekinesis (A2's doubles-typing.ts gravityGrounds; integration 1a).\n'''
  '''    for (const each of DOUBLES_SLOTS) if (kernel.alive(w, each)) typingNs.gravityGrounds(kernel, w, each);\n''',
  "A2: Gravity ends Magnet Rise and Telekinesis"),
])
apply([
 ("doubles-field.ts",
  '''    if (label || hiddenHooks.missesField(kernel, at, slot, move)) {''',
  '''    if (label || hiddenHooks.missesField(kernel, at, slot, move, user)) {''',
  "H: Teatime passes its user to missesField (No Guard, Lock-On)"),
])
