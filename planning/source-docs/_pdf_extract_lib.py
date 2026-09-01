import re, sys, zlib

def load(path):
    return open(path, 'rb').read()

OBJ = re.compile(b'(\\d+)\\s+(\\d+)\\s+obj(.*?)endobj', re.S)

def objects(data):
    d = {}
    for m in OBJ.finditer(data):
        d[int(m.group(1))] = m.group(3)
    return d

def stream_of(body):
    m = re.search(b'stream\r?\n', body)
    if not m:
        return None
    end = body.rfind(b'endstream')
    raw = body[m.end():end]
    try:
        return zlib.decompress(raw)
    except Exception:
        return raw

HEXSTR = re.compile(b'<([0-9A-Fa-f\\s]*)>')

def _u(h):
    h = h.decode('ascii') if isinstance(h, bytes) else h
    h = ''.join(h.split())
    if len(h) % 4:
        h = h.zfill(((len(h) // 4) + 1) * 4)
    return ''.join(chr(int(h[j:j + 4], 16)) for j in range(0, len(h), 4))

RANGE_ARR = re.compile(b'<([0-9A-Fa-f]+)>\\s*<([0-9A-Fa-f]+)>\\s*\\[(.*?)\\]', re.S)
RANGE_BASE = re.compile(b'<([0-9A-Fa-f]+)>\\s*<([0-9A-Fa-f]+)>\\s*<([0-9A-Fa-f]+)>')

def parse_cmap(s):
    cmap = {}
    for m in re.finditer(b'beginbfchar(.*?)endbfchar', s, re.S):
        toks = HEXSTR.findall(m.group(1))
        for i in range(0, len(toks) - 1, 2):
            cmap[int(b''.join(toks[i].split()), 16)] = _u(toks[i + 1])
    for m in re.finditer(b'beginbfrange(.*?)endbfrange', s, re.S):
        body = m.group(1)
        used = []
        for mm in RANGE_ARR.finditer(body):
            used.append((mm.start(), mm.end()))
            lo = int(mm.group(1), 16)
            for i, h in enumerate(HEXSTR.findall(mm.group(3))):
                cmap[lo + i] = _u(h)
        for mm in RANGE_BASE.finditer(body):
            if any(a <= mm.start() < b for a, b in used):
                continue
            lo = int(mm.group(1), 16); hi = int(mm.group(2), 16)
            base = mm.group(3).decode('ascii')
            for k in range(lo, hi + 1):
                if len(base) <= 4:
                    cmap[k] = chr(int(base, 16) + (k - lo))
                else:
                    cmap[k] = _u(base[:-4] + '%04X' % (int(base[-4:], 16) + (k - lo)))
    return cmap
