import re, os, pathlib, sys

# Directories that are not this repository's own documentation: dependencies, generated
# build output, and vendored/scratch state the Supabase CLI writes. Without excluding
# these, a stray broken link in a third-party package's README fails a check that exists
# to catch mistakes in *this* repository's own cross-references — and node_modules alone
# outnumbers the repository's own markdown by two orders of magnitude, which is what makes
# a real failure invisible in the noise.
EXCLUDED_DIRS = {
    'node_modules', '.git', 'dist', '.next', '.open-next', '.wrangler', '.astro',
    'coverage', 'playwright-report', 'test-results', '.temp', '.branches',
}

root = pathlib.Path('.')
files = [
    p for p in root.rglob('*.md')
    if not EXCLUDED_DIRS & set(p.parts)
]


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

# A broken cross-reference is exactly the failure this script exists to catch, so it must
# not exit 0 while reporting one — that would make it decoration in a CI log rather than a
# gate. See docs/architecture/principles.md#documentation-ships-with-the-change-it-describes.
sys.exit(1 if bad else 0)
