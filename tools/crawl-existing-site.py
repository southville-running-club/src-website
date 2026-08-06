"""Crawl the live Squarespace site and capture a structured inventory."""
import html as htmlmod
import json
import re
import time
import urllib.parse
import urllib.request

BASE = "https://www.southvillerunningclub.co.uk"
SITEMAP = BASE + "/sitemap.xml"

TAG = re.compile(r"<[^>]+>")
SCRIPTS = re.compile(r"<(script|style|noscript)[^>]*>.*?</\1>", re.S | re.I)
TITLE = re.compile(r"<title[^>]*>(.*?)</title>", re.S | re.I)
HREF = re.compile(r'href="([^"]+)"', re.I)
IMG = re.compile(r'<img[^>]+src="([^"]+)"', re.I)
WS = re.compile(r"\n\s*\n+")

DOC_EXT = (".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx")


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (SRC site inventory)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def page_text(raw):
    body = SCRIPTS.sub(" ", raw)
    body = re.sub(r"<br\s*/?>|</p>|</div>|</li>|</h[1-6]>", "\n", body, flags=re.I)
    body = TAG.sub(" ", body)
    body = htmlmod.unescape(body)
    body = "\n".join(ln.strip() for ln in body.splitlines())
    return WS.sub("\n\n", body).strip()


urls = sorted(set(re.findall(r"<loc>([^<]+)</loc>", fetch(SITEMAP))))
print(f"{len(urls)} urls in sitemap")

pages = []
for i, url in enumerate(urls):
    try:
        raw = fetch(url)
    except Exception as e:  # noqa: BLE001
        pages.append({"url": url, "error": str(e)})
        continue
    m = TITLE.search(raw)
    title = htmlmod.unescape(TAG.sub("", m.group(1)).strip()) if m else ""
    links = [urllib.parse.urljoin(url, h) for h in HREF.findall(raw)]
    docs = sorted({l.split("?")[0] for l in links if l.split("?")[0].lower().endswith(DOC_EXT)})
    ext = sorted({
        l for l in links
        if l.startswith("http") and "southvillerunningclub.co.uk" not in l
        and not l.split("?")[0].lower().endswith(DOC_EXT)
    })
    images = sorted({u.split("?")[0] for u in IMG.findall(raw)})
    pages.append({
        "url": url,
        "path": urllib.parse.urlparse(url).path,
        "title": title,
        "text": page_text(raw),
        "documents": docs,
        "external": ext,
        "image_count": len(images),
    })
    if i % 10 == 0:
        print(f"  {i}/{len(urls)}")
    time.sleep(0.4)

json.dump(pages, open("site-inventory.json", "w"), indent=1)
alldocs = sorted({d for p in pages for d in p.get("documents", [])})
allext = sorted({e for p in pages for e in p.get("external", [])})
print(f"pages={len(pages)} documents={len(alldocs)} external_links={len(allext)}")
