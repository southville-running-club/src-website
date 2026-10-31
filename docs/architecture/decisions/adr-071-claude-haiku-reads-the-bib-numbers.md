# ADR-071: Claude Haiku 5.5 reads the bib numbers

**Status:** Accepted
**Date:** 31 October 2026
**Answers:** the provider half of the first open question in the
[race photos brief](../../delivery/nn-photos-brief.md#15-open-questions-and-who-answers), §15:
_which vision model provider, and whose account pays_. The account half stays open; see
Consequences.

## Context

Slices 1 to 5 were built against a **fake reader**, because the brief made the provider a
stop-and-ask (§4: build against a fake reader until told otherwise). With nothing reading,
`photos tag` marks every photo "No bib seen" and a person types every bib on the one
tagging laptop. The shared check page ([ADR-065](adr-065-unsure-photos-are-checked-together-on-the-website.md))
never sees a photo either, because its queue holds only part reads and photos to check, and
a photo with no reads is neither. The race is on 1 November 2026.

Bindal holds Claude API credit and chose to use it. He also chose the **cheapest model that
does the job** rather than the most capable one: reading two or three digits off a vest is
a narrow task, and the photos number in the thousands.

## Decision

**`[reader] kind = "claude"` sends each photo's medium copy to Claude, which reads the
bibs. The model is `claude-haiku-5-5` unless `[reader] model` names another.**

- **What is sent is unchanged from the brief:** the medium copy, already stripped of
  everything but the picture ([ADR-060](adr-060-only-stripped-copies-leave-the-laptop.md)),
  and a fixed instruction. Never the fingerprint, the file name, the photographer, the
  camera or the time.
- **What is asked is [ADR-058](adr-058-a-bib-number-is-the-only-link-to-a-runner.md)'s
  rule:** the digits on any race bibs, `?` for a digit it cannot read, a confidence for
  each, and nothing about the people. When every bib on `bibs.csv` has the same number of
  digits, the instruction says so, because `7` fits no bib on a list of `001` to `250`.
- **The answer is held to `reader.py`'s one shape twice**: by a JSON schema on the request,
  and by `parse_reads()`, which still checks every answer as though the schema were not
  there.
- **Low effort.** Effort is most of what a request costs, and this is not a hard problem.
- **The official Python SDK, `anthropic`, pinned at 1.15.0** in `requirements.txt` by the
  tool's rule: the newest release at least two weeks old.
- **The key is `ANTHROPIC_API_KEY`, in the environment of the terminal that runs `tag`**,
  never in `config.toml`, never on disk and never in this repository. `photos tag` refuses
  to start without it, before anything is read.
- **A failure is about the photo or about the reader, and the two are handled differently**
  (`ReaderStopped`, `reader.py`). A photo the model declines, or an answer cut short, goes to
  a person and the run goes on, exactly as a malformed answer always has. Anything the API
  itself refuses (the key, the credit, the model's name, the network once the SDK has
  retried six times) **stops the run with that photo unrecorded**, so running `tag` again
  carries on from it. No message quotes the provider's own error text.

**This reverses one rule in `tag.py`**: _a reader that fails sends the photo to review; it
never stops the run._ That was written when the only reader was the fake, which cannot fail
for any reason outside the photo. Applied to a network reader it is the wrong way round. A
photo already in the manifest is never read again, so a revoked key or a spent balance at
photo 12 would have filed every remaining photo as "To check", for good, with nothing on
the screen to say why.

## Consequences

- **Cost, estimated rather than measured**: about $0.30 per 1,000 photos at Claude Haiku
  5.5's published prices ($0.10 per million input tokens and $0.50 per million output), for
  roughly 1,600 tokens in and a couple of hundred out per photo. What was actually spent is
  on the Claude Console's usage page.
- **Speed**: one request per photo, one photo at a time. Unmeasured, but a couple of
  thousand photos is likely to take an hour or more. It saves after every photo, as it
  always has.
- **A confident wrong read is tagged with no person seeing it**, and puts a photo on the
  wrong runner's private page. The 0.9 threshold is still the brief's provisional figure.
  The first real run is spot-checked on the review page before the rest, and if Haiku
  misreads too often, `model = "claude-sonnet-5-5"` is a one-line change. Photos already
  read stay read, so the check is done on a first folder rather than on the whole race.
- **A wrong confident read is taken off, not typed over.** On the laptop's review page,
  typing a number adds a bib beside whatever is there, which was harmless while nothing was
  ever tagged without a person and is not now: typed over a wrong read, the photo goes to
  both runners. So every number on a photo has a **Not 130: take it off** button (**X** when
  there is only one), which rejects that read alone and leaves any other runner in the
  photo alone. The next SQL file then deletes the bib row from the website, unless a checker
  decided it there.
- **The medium copies go to Anthropic**, which handles them under its commercial terms.
  This change does not review those terms.
- **Still open: whose account.** For 2026 the key is on Bindal's own Anthropic account, paid
  from his own credit. That puts the agreement with Anthropic with him rather than with the
  club, which is the controller for runners' photos. The brief gives this question to the
  treasurer and Bindal together, and the treasurer has not been asked.
- **Still open: the privacy wording.** Mark is still to supply the photography wording for
  the privacy notice (brief §15), and it should be written knowing the photos are sent to
  Anthropic to be read. `/nn/privacy/` is the committee's document and this change does not
  touch it.
- **The website's check page has work again**: part reads and photos to check reach it, so
  the four checkers share them as ADR-065 intended.
- **No test calls the API.** Every test replaces the client with a stand-in, so CI needs no
  key and spends nothing.
- **Rehearsing still costs nothing**: `kind = "fake"` with `fake_reads` is unchanged.

## Alternatives considered

- **Claude Opus 5.5 or Claude Sonnet 5.5 by default.** More capable, and at about $10 and $5
  per 1,000 photos, around thirty and fifteen times Haiku's cost. Sonnet stays the
  one-line fallback rather than the default.
- **The Batch API.** Half the price, but answers can take hours, and the tag loop reads and
  saves one photo at a time. Not worth restructuring the loop to save fifteen cents a
  thousand.
- **Raw HTTP from the standard library instead of the SDK.** One dependency fewer, but the
  SDK's retries and its typed errors are what make the split between "stop" and "carry on"
  reliable, and a third volunteer will already know it.
- **Go on typing every bib by hand.** Free, and one person on one laptop for every photo,
  with the shared check page idle.

## References

- [Race photos brief](../../delivery/nn-photos-brief.md), §4, §9 and §15
- [ADR-058](adr-058-a-bib-number-is-the-only-link-to-a-runner.md): a bib number is the only
  link to a runner
- [ADR-059](adr-059-photos-are-tagged-on-one-laptop.md): photos are tagged on one laptop
- [ADR-060](adr-060-only-stripped-copies-leave-the-laptop.md): only stripped copies leave
  the laptop
- [ADR-065](adr-065-unsure-photos-are-checked-together-on-the-website.md): unsure photos are
  checked together on the website
- `tools/photos/racephotos/claude_reader.py`, `reader.py` and `tag.py`
