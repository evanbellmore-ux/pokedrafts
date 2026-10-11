# Runs the part of a patch record file after a marker line (for records appended after their first run).
import sys
sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
from apply import apply
J = "\n".join
src = open(sys.argv[1], encoding="utf8").read()
F = "tests/unit/doubles-turn-guards.test.ts"
exec(src[src.index(sys.argv[2]):])
