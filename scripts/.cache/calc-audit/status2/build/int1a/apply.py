# Integration 1a: applies (file, old, new, why) replacements to the repo, each matching exactly once; keeps each file's EOL.
import os, sys
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../../.."))
def apply(patches, base="app/lib/battle"):
  for file, old, new, why in patches:
    path = os.path.join(ROOT, base, file) if not file.startswith(("app/", "tests/", "scripts/", "docs/")) else os.path.join(ROOT, file)
    text = open(path, encoding="utf8", newline="").read()
    crlf = "\r\n" in text
    if crlf: text = text.replace("\r\n", "\n")
    n = text.count(old)
    if n != 1: raise SystemExit(f"{file}: {n} matches ({why})")
    text = text.replace(old, new, 1)
    if crlf: text = text.replace("\n", "\r\n")
    open(path, "w", encoding="utf8", newline="").write(text)
    print(f"applied {file}: {why}")
