import re, os, pathlib

root = pathlib.Path('.')
files = [p for p in root.rglob('*.md') if '.git/' not in str(p)]


def slug(h):
    h = h.strip()
    h = re.sub(r'`', '', h)
    h = re.sub(r'\*\*?', '', h)
    h = re.sub(r'\[([^\]]*)\]\([^)]*\)', r'\1', h)
    h = h.lower()
    h = re.sub(r'[^\w\s-]', '', h, flags=re.UNICODE)
    return h.replace(' ', '-')


anchors = {}
for f in files:
    t = f.read_text()
    anchors[str(f)] = {slug(m.group(2)) for m in re.finditer(r'^(#{1,6})\s+(.*)$', t, re.M)}

bad = []
for f in files:
    t = f.read_text()
    for m in re.finditer(r'\[([^\]]*)\]\(([^)\s]+)\)', t):
        target = m.group(2)
        if target.startswith(('http://', 'https://', 'mailto:')):
            continue
        path, _, frag = target.partition('#')
        if path == '':
            resolved = str(f)
        else:
            resolved = os.path.normpath(str(f.parent / path))
            if os.path.isdir(resolved):
                cand = os.path.join(resolved, 'README.md')
                resolved = cand if os.path.exists(cand) else resolved
            if not os.path.exists(resolved):
                bad.append(f'{f}: missing file -> {target}')
                continue
        if frag:
            a = anchors.get(resolved)
            if a is None:
                bad.append(f'{f}: no anchors parsed for {resolved}')
            elif frag not in a:
                bad.append(f'{f}: bad anchor -> {target}')

print('\n'.join(bad) if bad else 'ALL LINKS OK')
print(f'{len(files)} markdown files checked')
