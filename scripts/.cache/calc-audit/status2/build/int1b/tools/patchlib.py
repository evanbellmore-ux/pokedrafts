# Integration 1b: exact single-match replacements (int1a/apply.py's rule): each applies once or the script stops; each file keeps its EOL.
import os, re, sys
ROOT = os.environ.get("INT_ROOT") or os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../../../.."))

def _path(file):
    if file.startswith(("app/", "tests/", "scripts/", "docs/")): return os.path.join(ROOT, file)
    return os.path.join(ROOT, "app/lib/battle", file)

def read(file):
    text = open(_path(file), encoding="utf8", newline="").read()
    return text.replace("\r\n", "\n"), "\r\n" in text

def write(file, text, crlf):
    if crlf: text = text.replace("\n", "\r\n")
    open(_path(file), "w", encoding="utf8", newline="").write(text)

def rep(file, old, new, why="", count=1):
    text, crlf = read(file)
    n = text.count(old)
    if n != count: raise SystemExit(f"{file}: {n} matches (want {count}) for {old[:140]!r} ({why})")
    text = text.replace(old, new)
    write(file, text, crlf)
    print(f"applied {file}: {why or old[:60]!r}")

def sub(file, pattern, new, why="", count=1, flags=0):
    text, crlf = read(file)
    found = len(re.findall(pattern, text, flags))
    if found != count: raise SystemExit(f"{file}: {found} regex matches (want {count}) for {pattern[:140]!r} ({why})")
    text = re.sub(pattern, new, text, flags=flags)
    write(file, text, crlf)
    print(f"applied {file}: {why or pattern[:60]!r}")
