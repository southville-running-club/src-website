# The Nightingale Nightmare fonts, and how they got here

The event theme sets three faces. All three are **self-hosted** from
`platform/apps/main/public/fonts/`, and that is the whole point of this note: the obvious
way to get them — a `<link>` to `fonts.googleapis.com` — is not available to this
repository, so the manual step that replaces it is written down here rather than left to be
rediscovered.

## Why not link Google Fonts

Two reasons, and either one is enough.

**It is a third party the club has not assessed.** A remote font link means every visitor's
browser tells Google's servers that somebody just opened the race page, along with their IP
address and user agent. The club is the data controller for that, it is not covered by
anything on `/nn/privacy/`, and a German court has already found the practice unlawful
under GDPR without consent. Adding a third-party service is a *stop and ask* trigger in
[the principles](../architecture/principles.md); a font is not an exception to it.

**It is slower on the connection that matters.** A cross-origin link costs a DNS lookup, a
TLS handshake and a round trip to a second host before the first byte of the CSS that names
the font files, then the same again for `fonts.gstatic.com`. Self-hosted, the files come
from the connection the browser already has open. 70% of visitors are on a phone.

## What is here

| File | Face | Weights | Bytes |
| --- | --- | --- | --- |
| `nosifer-latin.woff2` | Nosifer | 400 | 15,048 |
| `inter-latin-var.woff2` | Inter (variable) | 400–700 | 48,432 |
| `jetbrains-mono-latin-var.woff2` | JetBrains Mono (variable) | 500–700 | 31,340 |

94 kB in total, fetched only by `/nn/` and `/nn/privacy/`, and only once — they are
immutable and cached by filename.

**Latin subset only.** Google's `latin` subset is `U+0000–00FF` plus the general
punctuation block, which covers every character these two pages set, the em dash and the
ellipsis included. The `latin-ext`, `greek`, `cyrillic` and `vietnamese` subsets are
deliberately not shipped; if a page ever needs one, add that subset's file with its own
`unicode-range` rather than widening these.

**Inter and JetBrains Mono are variable fonts**, so one file each covers the whole weight
range the theme asks for. That is why `@font-face` declares `font-weight: 400 700` rather
than four separate files. Nosifer has one weight and is not variable.

## Licensing

All three are **SIL Open Font Licence 1.1**, which permits redistribution as long as the
licence travels with the font. It does: `OFL-Inter.txt`, `OFL-JetBrainsMono.txt` and
`OFL-Nosifer.txt` sit beside the `.woff2` files in `public/fonts/`, so they are served from
the same origin as the fonts they cover. Do not delete them to save four kilobytes.

Copyright holders, as stated in those files: Inter — the Inter Project Authors; JetBrains
Mono — the JetBrains Mono Project Authors; Nosifer — Typomondo, with the reserved font name
"Nosifer".

## How to fetch them again

Google's CSS API returns different files to different user agents — an old one gets TTF,
and only a recent one gets the woff2 these commands assume. Hence the explicit `-A`.

```bash
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

# 1. Ask for the stylesheet, and read the URLs out of the `/* latin */` blocks.
curl -A "$UA" "https://fonts.googleapis.com/css2\
?family=Inter:wght@400..700&family=JetBrains+Mono:wght@500..700&family=Nosifer&display=swap"

# 2. Fetch the three `latin` files it names, into platform/apps/main/public/fonts/.
curl -A "$UA" "<the latin URL for Inter>"          -o inter-latin-var.woff2
curl -A "$UA" "<the latin URL for JetBrains Mono>" -o jetbrains-mono-latin-var.woff2
curl -A "$UA" "<the latin URL for Nosifer>"        -o nosifer-latin.woff2

# 3. And the licences, which must ship with them.
for f in inter jetbrainsmono nosifer; do
  curl "https://raw.githubusercontent.com/google/fonts/main/ofl/$f/OFL.txt" -o "OFL-$f.txt"
done
```

The URLs contain a version hash and change when Google republishes a family, so copy them
out of step 1 rather than out of this document. Versions in use when these were fetched, on
**12 August 2026**, by the sign-up form's design pass: Inter `v20`, JetBrains Mono `v24`,
Nosifer `v23`.

Nothing checks these files automatically. If a face ever goes missing the pages still
render — `font-display: swap` leaves the fallback stack in place — which is the failure
mode to prefer, but it also means the loss is quiet. The one thing that would catch it is
looking at the page.
