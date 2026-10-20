# Race photos: the laptop tagging tool

`photos` reads the bib numbers in the race photographers' photos, fixes each camera's
clock, and makes the three stripped copies that are the only thing ever uploaded. It runs
on one laptop, before anything leaves it.

Why it works this way is in three decisions:

- [ADR-058](../../docs/architecture/decisions/adr-058-a-bib-number-is-the-only-link-to-a-runner.md):
  a bib number is the only link between a photo and a runner. No faces, ever.
- [ADR-059](../../docs/architecture/decisions/adr-059-photos-are-tagged-on-one-laptop.md):
  tagging happens on one laptop, and the work folder lives outside any repository.
- [ADR-060](../../docs/architecture/decisions/adr-060-only-stripped-copies-leave-the-laptop.md):
  only stripped copies leave the laptop.

The whole feature is planned in [the race photos brief](../../docs/delivery/nn-photos-brief.md).
This is slice 1 of it.

## What is not built yet

- **The real vision reader.** It waits on the choice of provider. Until then the tool
  reads bibs with a **fake reader** that answers from a file you write, so everything else
  can be rehearsed.
- **The real upload to R2, and the SQL file of every read.** Both come with slice 2.
  `photos upload` only does a dry run, to a folder on the laptop.

## Set it up once

You need Python 3.11 or newer. Check with `python3 --version`. Bindal's Mac is the tagging
laptop for 2026 and has 3.13; Andrew is the backup, on his own machine.

From the repository root:

```bash
cd tools/photos
```

```bash
python3 -m venv .venv
```

```bash
.venv/bin/python -m pip install -r requirements.txt
```

That installs Pillow, pinned in [requirements.txt](requirements.txt), into
`tools/photos/.venv/`, which git ignores. Then, in every new terminal before using the
tool:

```bash
source .venv/bin/activate
```

## The work folder

Everything the tool reads and writes is in one folder **outside any git repository**,
`~/nn-photos/` unless you pass `--work` with another. The tool refuses to run if the work
folder or the folder of originals is inside a repository, because a photo or, from slice 2,
a key there is one commit away from being published.

```
~/nn-photos/
  config.toml           settings: copy config.example.toml from this folder
  photographers.csv     one row per folder of originals
  bibs.csv              the race's bibs, one column
  originals/            the photographers' folders, copied from Drive
    Adrian/Finish/
    Adrian/Start/
    Ross/
  manifest.sqlite       what the tool has done (it writes this)
  copies/               the stripped copies (it writes these)
  dry-run/              what an upload would send (it writes this)
```

To start one:

```bash
mkdir -p ~/nn-photos/originals
```

```bash
cp config.example.toml ~/nn-photos/config.toml
```

### photographers.csv

Three columns, `folder,credit,spot`. The folder is a path under `originals/`. A
photographer who moves spot during the race splits their photos into one folder per spot:

```
folder,credit,spot
Adrian/Finish,Adrian,Finish
Adrian/Start,Adrian,Start
Ross,Ross,On the course
```

The credit and the spot are what a runner is told about the photo, so spell them as they
should appear. A folder inside another listed folder is refused, because its photos would
be read twice; list the inner folders or the outer one, not both.

### bibs.csv

**One column, headed `bib`, and nothing else.**

```
bib
101
102
0311
```

A file with any other column is refused, not trimmed: names and email addresses must never
reach this tool. Export the bib column on its own. Bibs are kept as text, so `0311` and
`311` stay different bibs.

### The fake reader

Until the real reader exists, `config.toml`'s `[reader]` section can name a JSON file of
answers: uncomment its `fake_reads` line. The file is keyed by each photo's path under
`originals/`:

```json
{
  "Adrian/Finish/IMG_0412.jpg": {"bibs": [{"text": "125", "confidence": 0.97}]},
  "Adrian/Finish/IMG_0413.jpg": {"bibs": [{"text": "12?", "confidence": 0.95}]},
  "Ross/DSC_0001.jpg": "the model said something that is not JSON"
}
```

A photo with no entry reads as no bib seen. A string is passed on exactly as written, so a
malformed answer can be rehearsed. The shape above, `{"bibs": [{"text", "confidence"}]}`,
is the only answer the real model will be allowed to give; anything else sends the photo
to a person.

## On the night

1. Copy each photographer's folder from Drive into `originals/`, and add a row to
   `photographers.csv` for it.
2. `./photos tag`. Run it again whenever another folder arrives; it only reads what is new.
3. `./photos review`, and fix every camera's clock.
4. Optionally, check the unsure reads on the same page. The team's main checking happens on
   the website, together.
5. `./photos upload --dry-run`.

### photos tag

```bash
./photos tag
```

For each new JPEG: reads when it was taken and which camera took it, makes the full
(2,400 px), medium (1,200 px) and thumbnail (480 px) copies with nothing but the picture in
them, sends **the medium copy only** to the reader, and checks each read against
`bibs.csv`:

- **Tagged**: a confident read of a bib on the list.
- **Part read**: a confident read with a `?` in it, such as `12?`, that fits at least one
  bib. It is "Could be you" to every runner it fits until a person confirms it.
- **To check**: everything else, including an answer from the reader that could not be
  used.
- **No bib seen**: the reader found none. The photo is still copied and uploaded.

`--confidence-threshold` sets how sure a read must be to count as tagged. It is 0.9 until
the first real run says otherwise.

Every photo is saved as soon as it is done, so if the run is stopped, running it again
carries on where it left off, and running it over the same folders adds nothing.

Anything that is not a JPEG is listed as skipped, per photographer, in the terminal and on
the Start screen: RAW, video, macOS `._` files, unreadable files and duplicates, and
**HEIC, which is what an iPhone sends by default**. Ask that photographer for JPEGs
(Settings, Camera, Formats, Most Compatible), or export theirs as JPEG, then tag again.

### photos review

```bash
./photos review
```

Then open the address it prints, `http://127.0.0.1:8765/`, on the same laptop. It only
ever listens on 127.0.0.1, so nothing else on the network can reach it. `--port` picks
another port if that one is busy. Ctrl-C stops it.

**Start** shows how far things have got, the next thing to do, and a row per photographer
with their photos, their skipped files and their photos with no bib seen.

**Camera clocks** is required before upload. Photographers are asked to photograph a phone
clock before anything else. For each camera, the page shows that photo beside the time the
camera recorded; type the time the phone shows, as London time, and every photo from that
camera, and only that camera, moves by the difference. If a camera has no phone photo,
choose **Keep this camera's time as recorded** instead. Upload waits until every camera has
one or the other.

A camera left on summer time reads an hour ahead on race day, because the clocks went back
the Sunday before. The phone photo is what catches it. A corrected time that lands in the
hour the clocks repeat or skip flags the camera; those photos go without a time.

**Check tags** shows one photo at a time, with these keys. Each is also a button.

| Key     | Does                                                    |
| ------- | ------------------------------------------------------- |
| Enter   | Confirms the guess                                      |
| 1 to 9  | Picks one of the bibs that fit                          |
| Digits  | Go into the "Type the bib" box, to correct the read     |
| U       | Keeps it part read                                      |
| N       | No bib visible                                          |
| S       | Skips, deciding nothing                                 |
| H       | Hides the photo, so it is never uploaded; on a hidden photo, shows it again |

After a bib is confirmed, the page offers it to the rest of that photo's burst: photos the
same camera took within two seconds of each other. The filters along the top narrow the
list to photos to check, part reads, no bib seen, or hidden photos, and the counts on
Start link to them, and to one photographer's.

### photos upload --dry-run

```bash
./photos upload --dry-run
```

Writes every visible photo's three copies to `dry-run/nn-2026/<photo id>/full.jpg`,
`medium.jpg` and `thumb.jpg`, the layout the bucket will have, with `dry-run/keys.tsv`
listing each key, its size and its checksum. Hidden photos are left out. Nothing leaves the
laptop. A dry run is kept apart from a real upload, so the real one, in slice 2, will
still send everything.

## When it says "Stopped"

Every refusal says why, and none prints a value from `bibs.csv`. The usual ones:

- **"inside the git repository"**: the work folder or `originals/` is in a repository.
  Move it, or pass `--work` with a folder outside one.
- **"must have exactly one column, named bib"**: export the bib column on its own.
- **"Upload waits until every camera's clock is decided"**: finish Camera clocks.
- **"could not be used"**, about a port: another program has it. Use
  `./photos review --port 8766`.

## The tests

```bash
cd tools/photos
```

```bash
.venv/bin/python -m unittest
```

Standard library `unittest`, no other dependency. Every test photo is synthetic, made by
the test that uses it; **no real race photo is ever added to this repository**, and
`.gitignore` refuses JPEGs, HEIC files, CSVs, manifests and configs anywhere under
`tools/photos/`. The tests do not run in CI yet; that comes at the start of slice 2.
