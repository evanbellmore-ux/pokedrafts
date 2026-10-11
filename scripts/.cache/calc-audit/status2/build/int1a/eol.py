# Restores each file's line endings to those of a snapshot (CRLF where the snapshot was CRLF).
import os, sys
src, pre = sys.argv[1], sys.argv[2]
for f in sorted(os.listdir(src)):
  p, q = os.path.join(src, f), os.path.join(pre, f)
  if not os.path.isfile(p) or not os.path.exists(q): continue
  a, b = open(q, "rb").read(), open(p, "rb").read()
  want = a.count(b"\r\n") > 0
  have = b.count(b"\r\n") > 0
  if want and not have:
    open(p, "wb").write(b.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")); print("CRLF", f)
  elif have and not want:
    open(p, "wb").write(b.replace(b"\r\n", b"\n")); print("LF", f)
