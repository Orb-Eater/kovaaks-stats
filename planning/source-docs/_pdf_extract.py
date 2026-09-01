import re, sys, io, zlib

sys.path.insert(0, '.')
import pdftxt2 as P


def build(path):
    data = P.load(path)
    objs = P.objects(data)

    # /Fname -> object number
    name2obj = {}
    for m in re.finditer(b'/Font\\s*<<(.*?)>>', data, re.S):
        for mm in re.finditer(b'/(F\\d+)\\s+(\\d+)\\s+0\\s+R', m.group(1)):
            name2obj[mm.group(1).decode()] = int(mm.group(2))

    # font object -> ToUnicode cmap
    cmaps = {}
    for name, n in name2obj.items():
        body = objs.get(n, b'')
        mm = re.search(b'/ToUnicode\\s+(\\d+)\\s+0\\s+R', body)
        cm = {}
        if mm:
            s = P.stream_of(objs.get(int(mm.group(1)), b''))
            if s:
                cm = P.parse_cmap(s)
        cmaps[name] = cm
    return objs, cmaps


TOK = re.compile(
    b'/(F\\d+)\\s+[\\d.]+\\s+Tf'
    b'|(\\[[^\\]]*\\]\\s*TJ)'
    b'|(<[0-9A-Fa-f\\s]*>\\s*Tj)'
    b'|(T\\*)|(ET)|(BT)'
)


def text(path):
    objs, cmaps = build(path)
    out = []
    for n in sorted(objs):
        s = P.stream_of(objs[n])
        if not s or (b'Tj' not in s and b'TJ' not in s):
            continue
        cur = {}
        buf = []
        for m in TOK.finditer(s):
            if m.group(1):
                cur = cmaps.get(m.group(1).decode(), {})
                continue
            tok = m.group(0)
            if tok.endswith(b'TJ') or tok.endswith(b'Tj'):
                for h in P.HEXSTR.findall(tok):
                    h = b''.join(h.split()).decode('ascii')
                    for j in range(0, len(h) - 3, 4):
                        buf.append(cur.get(int(h[j:j + 4], 16), '�'))
            else:
                buf.append('\n')
        t = ''.join(buf)
        if t.strip():
            out.append(t)
    return '\n'.join(out)


if __name__ == '__main__':
    for p in sys.argv[1:]:
        outp = p.split('/')[-1].replace('.pdf', '.txt')
        io.open(outp, 'w', encoding='utf-8').write(text(p))
        print(outp)
