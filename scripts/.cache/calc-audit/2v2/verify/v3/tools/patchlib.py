# Track R-V: exact single-match replacements (each applies once or stops), keeping the file's line endings.
import sys
def patch(path, pairs):
    raw = open(path, 'rb').read()
    crlf = b'\r\n' in raw
    text = raw.decode('utf8').replace('\r\n', '\n')
    for old, new in pairs:
        n = text.count(old)
        if n != 1:
            sys.exit(f"{path}: {n} matches for:\n{old[:200]}")
        text = text.replace(old, new)
    if crlf: text = text.replace('\n', '\r\n')
    open(path, 'wb').write(text.encode('utf8'))
    print(f"{path}: {len(pairs)} replacements")
