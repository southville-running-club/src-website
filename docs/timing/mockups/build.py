#!/usr/bin/env python3
"""Phase 2 mockups for the NN timing redesign. Static HTML, fake data, no app logic.

Run from anywhere:  python3 docs/timing/mockups/build.py
It writes one .html per mockup next to itself. `shoot.mjs` screenshots them.

Every page loads the real club-chrome.css and club.css from platform/packages/shared/styles,
then timing-mock.css. Names, emails and counts are invented. The race's own published facts
(name, date, 11:00 start) are the only real data, and NN's own sentences are quoted where NN
already has them, because the redesign changes layout, not wording.
"""

from pathlib import Path

HERE = Path(__file__).resolve().parent
STYLES = '../../../platform/packages/shared/styles'
LOGO = (HERE / 'logo.svg.html').read_text().strip()

RACE = 'Nightingale Nightmare 2026'
RACE_SHORT = 'NN 2026'
SLUG = 'nn-2026'
BASE = f'/timing/events/{SLUG}'


def page(title, body, extra_head='', body_class=''):
    return f"""<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#16301f" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#eaf3e7" media="(prefers-color-scheme: dark)">
<title>{title} — Southville Running Club</title>
<link rel="stylesheet" href="{STYLES}/club-chrome.css">
<link rel="stylesheet" href="{STYLES}/club.css">
<link rel="stylesheet" href="timing-mock.css">
{extra_head}
<script type="module">
  // Slice B: the current tab scrolls into view on a phone. With scripting off the bar simply
  // starts at its first tab, as it does today.
  document.querySelector('.timing-area-bar [aria-current="page"]')
    ?.scrollIntoView({{ block: 'nearest', inline: 'center' }});
</script>
</head>
<body class="{body_class}">
<a class="club-skip" href="#main">Skip to content</a>
{body}
</body>
</html>
"""


# --------------------------------------------------------------------------------------------
# The shell
# --------------------------------------------------------------------------------------------
AREAS = {
    'account': ('Your account', '/account/'),
    'timing': ('Race timing', '/timing'),
    'admin': ('Club admin', '/admin/'),
}

ROLES = {
    'none': {'areas': ['account'], 'name': 'Casey Norole'},
    'marshal': {'areas': ['account', 'timing'], 'name': 'Sam Marshal'},
    'timing-admin': {'areas': ['account', 'timing'], 'name': 'Alex Timing'},
    'src-admin': {'areas': ['account', 'timing', 'admin'], 'name': 'Jo Director'},
}


def app_header(role, current):
    r = ROLES[role]
    items = ''.join(
        f'<li><a href="{AREAS[a][1]}"{" aria-current=\"page\"" if a == current else ""}>'
        f'{AREAS[a][0]}</a></li>'
        for a in r['areas']
    )
    return f"""<header class="app-header" data-areas="{len(r['areas'])}">
  <div class="club-wrap app-header-inner">
    <a class="club-mark" href="/" aria-label="Southville Running Club, club website">{LOGO}</a>
    <p class="app-area-name">{AREAS[current][0]}</p>
    <nav class="app-areas" aria-label="Areas"><ul>{items}</ul></nav>
    <div class="app-user">
      <p class="app-user-name">Signed in as {r['name']}</p>
    </div>
    <details class="club-menu">
      <summary class="club-btn club-btn-secondary">Menu</summary>
      <nav aria-label="Areas, menu">
        <ul>{items}</ul>
        <p class="app-menu-user">Signed in as {r['name']}</p>
      </nav>
    </details>
  </div>
</header>"""


def short_name(name):
    if name != RACE:
        return name
    return f'<span class="timing-wide">{RACE}</span><span class="timing-narrow">{RACE_SHORT}</span>'


def area_bar(name, tabs, current=None):
    if not tabs:
        return ''
    lis = ''.join(
        f'<li><a href="{href}"{" aria-current=\"page\"" if label == current else ""}>{label}</a></li>'
        for label, href in tabs
    )
    return f"""<nav class="club-section timing-area-bar" aria-label="{name}">
  <div class="club-wrap club-section-inner">
    <p class="club-section-name"><a href="/timing">{short_name(name)}</a></p>
    <ul>{lis}</ul>
  </div>
</nav>"""


def app_footer():
    return """<footer class="app-footer">
  <div class="club-wrap">
    <ul>
      <li><a href="/privacy/">Privacy notice</a></li>
      <li><a href="/">Club website</a></li>
    </ul>
  </div>
</footer>"""


# Race tabs in race-day order (D1 default). Record crossings is never a tab (HALT 1 decision 6).
RACE_TABS_ADMIN = [
    ('Overview', BASE),
    ('Race console', f'{BASE}/console'),
    ('Live leaderboard', f'{BASE}/leaderboard'),
    ('Results', f'{BASE}/results'),
    ('Entry list', f'{BASE}/registration'),
    ('Marshals', f'{BASE}/marshals'),
]
TIMING_TABS_ADMIN = [('Overview', '/timing'), ('Races', '/timing/events')]


def shell(title, role, area, bar, main):
    return page(
        title,
        f"""{app_header(role, area)}
{bar}
<main id="main" class="app-main">
{main}
</main>
{app_footer()}""",
    )


def focus(screen, extra='', leave='Leave this screen', leave_href=BASE):
    return f"""<header class="club-focus">
  <div class="club-wrap club-focus-inner">
    <p class="club-focus-title">
      <span class="club-focus-club timing-wide">Southville RC<span aria-hidden="true"> · </span></span><strong>{screen}</strong>
      <span class="club-focus-race"><span class="timing-wide">{RACE}</span><span class="timing-narrow">{RACE_SHORT}</span></span>
    </p>
    {extra}
    <a class="club-focus-leave" href="{leave_href}">{leave}</a>
  </div>
</header>"""


# --------------------------------------------------------------------------------------------
# Pages
# --------------------------------------------------------------------------------------------
def account_none():
    main = """<div class="club-wrap">
  <div class="club-phead">
    <h1>Your account</h1>
    <p class="club-lede">Your entries and your details.</p>
  </div>
  <div class="club-card">
    <h2>Your entries</h2>
    <p>Illustrative only: the account pages are not redesigned before the race (ADR-054 §5).
    This mock shows the app header somebody with no staff role sees — one area, so no switcher.</p>
  </div>
</div>"""
    return shell('Your account', 'none', 'account', '', main)


def timing_home_marshal():
    main = f"""<div class="club-wrap">
  <div class="club-phead">
    <h1>Race timing</h1>
    <p class="club-lede">The races you are marshalling.</p>
  </div>
  <section class="club-card" aria-labelledby="marshalling">
    <h2 id="marshalling">Marshalling</h2>
    <ul class="club-events">
      <li>
        <p class="club-event-when" aria-hidden="true"><b>1</b><span>Nov</span></p>
        <div>
          <h3><a href="/timing/marshal/{SLUG}">{RACE}</a></h3>
          <p class="club-small">Sunday 1 November 2026 · Start 11:00 GMT · <span class="club-badge timing-state" data-state="queued">Not started</span></p>
          <p><a class="club-btn club-btn-primary" href="/timing/marshal/{SLUG}">Record crossings</a></p>
        </div>
      </li>
    </ul>
    <p class="club-small">Keep this phone signed in on race morning. If the screen says “Not found”, your session has ended: sign in again at Your account and come back here.</p>
  </section>
</div>"""
    return shell('Race timing', 'marshal', 'timing', '', main)


def timing_home_admin():
    main = f"""<div class="club-wrap">
  <div class="club-phead">
    <h1>Race timing</h1>
    <p class="club-lede">One race this season.</p>
  </div>
  <p class="club-btns"><a class="club-btn club-btn-primary" href="{BASE}">Open {RACE}</a></p>
  <h2 class="timing-section-title">Races</h2>
  <ul class="club-events">
    <li>
      <p class="club-event-when" aria-hidden="true"><b>1</b><span>Nov</span></p>
      <div>
        <h3><a href="{BASE}">{RACE}</a></h3>
        <p class="club-small">Sunday 1 November 2026 · 11:00 GMT · 10 km · <span class="club-badge timing-state" data-state="queued">Not started</span></p>
      </div>
    </li>
  </ul>
  <section class="club-card" aria-labelledby="marshalling">
    <h2 id="marshalling">Marshalling</h2>
    <p>You are not on any race's roster, so there is nothing to record crossings for. Somebody holding Marshals can add you.</p>
  </section>
</div>"""
    bar = area_bar('Race timing', TIMING_TABS_ADMIN, 'Overview')
    return shell('Race timing', 'timing-admin', 'timing', bar, main)


def launchpad():
    cards_raceday = [
        ('Race console', f'{BASE}/console', 'Start the race, finish it, mark DNS, DNF and DQ, and resolve captures.', '2 anomalies'),
        ('Record crossings', f'/timing/marshal/{SLUG}', 'You are on this race’s roster. Open the capture screen on this phone.', 'You’re rostered'),
        ('Live leaderboard', f'{BASE}/leaderboard', 'The provisional order, for staff, as crossings arrive.', None),
        ('Results', f'{BASE}/results', 'Check the preview, publish, and run the prize giving.', None),
    ]
    cards_before = [
        ('Entry list', f'{BASE}/registration', 'Import the club’s entries, upload a file, add walk-ins and assign bibs.', '212 entries'),
        ('Marshals', f'{BASE}/marshals', 'Who may record crossings on this race.', '6 rostered'),
    ]

    def grid(cards, cls):
        lis = ''
        for title, href, text, badge in cards:
            b = f'<span class="club-badge">{badge}</span>' if badge else ''
            lis += f'<li><a class="club-card club-link-card timing-link-card" href="{href}"><h3>{title}</h3><p>{text}</p>{b}</a></li>'
        return f'<ul class="{cls}">{lis}</ul>'

    main = f"""<div class="club-wrap">
  <div class="club-phead">
    <h1>{RACE}</h1>
    <p class="club-lede">Not started. Starts Sunday 1 November at 11:00 GMT.</p>
  </div>
  <p class="club-btns">
    <a class="club-btn club-btn-primary" href="{BASE}/console">Open the race console</a>
    <a class="club-btn club-btn-secondary" href="{BASE}/registration">Entry list</a>
  </p>
</div>
<section class="club-facts timing-facts" aria-labelledby="facts">
  <div class="club-wrap">
    <h2 id="facts" class="club-visually-hidden">This race at a glance</h2>
    <ul>
      <li><b>Starts</b> Sun 1 Nov, <span class="club-num">11:00 GMT</span></li>
      <li><b>State</b> Not started</li>
      <li><b>Entries</b> <span class="club-num">212</span> (<span class="club-num">214</span> runners)</li>
      <li><b>Marshals rostered</b> <span class="club-num">6</span></li>
      <li><b>Crossings</b> <span class="club-num">0</span></li>
      <li><b>Anomalies</b> <span class="club-num">0</span></li>
    </ul>
  </div>
</section>
<div class="club-wrap">
  <h2 class="timing-section-title">Race day</h2>
  {grid(cards_raceday, 'club-g2')}
  <h2 class="timing-section-title">Before the race</h2>
  {grid(cards_before, 'club-g2')}
  <dl class="club-meta club-small">
    <div><dt>Slug</dt><dd>{SLUG}</dd></div>
    <div><dt>Distance</dt><dd>10 km</dd></div>
  </dl>
  <h2 class="timing-section-title">Starting again</h2>
  <p><a class="timing-danger-link" href="{BASE}/danger-zone">Wipe this race and start again</a></p>
  <p class="club-small">Removes every crossing and every entry. Used between rehearsals, never on race day.</p>
</div>"""
    bar = area_bar(RACE, RACE_TABS_ADMIN, 'Overview')
    return shell(f'Overview — {RACE}', 'src-admin', 'timing', bar, main)


# ---- Record crossings ----------------------------------------------------------------------
def capture(state):
    online = state != 'offline'
    if state == 'empty':
        waiting, cards = 0, ''
    else:
        waiting = 3
        open_card = """<li class="timing-qcard" data-state="open">
  <div class="timing-qcard-row">
    <p class="timing-time"><small>Crossed at</small>11:42:31</p>
    <span class="timing-bib" aria-live="polite">214</span>
    <span class="club-badge timing-state" data-state="flagged">Check</span>
  </div>
  <p class="timing-warn">Duplicate bib 214 — already captured at 11:41:07. Confirm it anyway if that is what you saw — somebody will check it afterwards.</p>
  <div class="timing-keypad">
    <button class="timing-key" type="button">1</button><button class="timing-key" type="button">2</button><button class="timing-key" type="button">3</button>
    <button class="timing-key" type="button">4</button><button class="timing-key" type="button">5</button><button class="timing-key" type="button">6</button>
    <button class="timing-key" type="button">7</button><button class="timing-key" type="button">8</button><button class="timing-key" type="button">9</button>
    <button class="timing-key" type="button">0</button><button class="timing-key timing-key-wide" type="button">Delete a digit</button>
  </div>
  <div class="timing-qcard-actions">
    <button class="club-btn club-btn-primary" type="button">Confirm bib</button>
    <button class="timing-danger-link" type="button">Discard this tap</button>
  </div>
</li>"""
        queued = """<li class="timing-qcard" data-state="queued">
  <div class="timing-qcard-row">
    <p class="timing-time"><small>Crossed at</small>11:42:18</p>
    <span class="timing-bib">147</span>
    <span class="club-badge timing-state" data-state="queued">Waiting to be sent</span>
  </div>
</li>"""
        if state == 'offline':
            third = """<li class="timing-qcard" data-state="queued">
  <div class="timing-qcard-row">
    <p class="timing-time"><small>Crossed at</small>11:41:55</p>
    <span class="timing-bib">88</span>
    <span class="club-badge timing-state" data-state="queued">Waiting to be sent</span>
  </div>
</li>"""
        else:
            third = """<li class="timing-qcard" data-state="failed">
  <div class="timing-qcard-row">
    <p class="timing-time"><small>Crossed at</small>11:41:55</p>
    <span class="timing-bib">88</span>
    <span class="club-badge timing-state" data-state="failed">Not sent</span>
  </div>
  <p class="timing-fail">Not sent. It is still on this phone and will be tried again.</p>
  <div class="timing-qcard-actions"><button class="club-btn club-btn-secondary" type="button">Retry now</button></div>
</li>"""
        cards = open_card + queued + third

    conn = (
        '<span class="timing-conn" data-online="true">Online</span>'
        if online
        else '<span class="timing-conn" data-online="false">No signal</span>'
    )
    extra = f'<p class="timing-focus-extra" aria-live="polite"><span class="club-num">{waiting} waiting</span>{conn}</p>'
    heading = 'Nothing waiting' if waiting == 0 else f'{waiting} crossings on this phone'
    empty = (
        '<div class="club-card"><p>Every crossing recorded on this phone has been sent to the club. '
        'Crossings recorded while there is no signal stay here until it comes back.</p></div>'
        if waiting == 0
        else ''
    )
    offline_note = (
        '<p class="timing-warn">No signal. Keep recording — crossings stay on this phone and are sent when the signal comes back.</p>'
        if not online
        else ''
    )
    body = f"""{focus('Record crossings', extra, 'Leave', '/timing')}
<main id="main" class="club-wrap timing-tool">
  <button class="timing-capture" type="button">Crossed now</button>
  <div class="timing-tool-hints club-small">
    <p>Press the moment a runner crosses. The time is recorded straight away — type the bib afterwards.</p>
    <p>Saved for use without signal — this screen will still open if the page reloads.</p>
  </div>
  <div class="timing-queue-wrap">
    {offline_note}
    <h1 class="club-visually-hidden">Record crossings</h1>
    <h2>{heading}</h2>
    {empty}
    <ul class="timing-queue">{cards}</ul>
  </div>
</main>"""
    return page(f'Record crossings — {RACE}', body, body_class='timing-tool-page')


# ---- The race console ------------------------------------------------------------------------
def console(state):
    if state == 'before':
        go = f"""<p class="timing-go-race">{RACE} · Scheduled start 11:00 GMT</p>
<p class="timing-clock club-num" aria-label="Starts in 4 minutes 12 seconds">−04:12</p>
<h1 id="state">Runners to the start</h1>
<p class="timing-go-caption">A clock reaching zero starts nothing. Pressing the button below is what records the moment, and every time in the race is measured from it.</p>
<form method="post" action="{BASE}/start/update"><button class="club-btn timing-btn-dark" type="submit">Start the race</button></form>
<hr class="timing-go-rule">
<p class="timing-go-caption">Pressing it twice does not move the clock. If somebody else has already started this race, this page will say so and show their time rather than overwriting it.</p>"""
    elif state == 'running':
        go = f"""<p class="timing-go-race">{RACE} · Started <span class="club-num">11:00:04 GMT</span></p>
<p class="timing-clock club-num" aria-label="Elapsed 42 minutes 31 seconds">00:42:31</p>
<h1 id="state">Race in progress</h1>
<form method="post" action="{BASE}/finish/update"><button class="club-btn timing-btn-dark" type="submit">Finish this race</button></form>
<p class="timing-go-caption">Finishing is a <strong>label, not a cut-off</strong>. Crossings can still be recorded and corrected afterwards, which is what happens every time — the last runner crosses after somebody has called the race. It can be undone here too.</p>
<hr class="timing-go-rule">
<p class="timing-go-links"><a href="#anomalies">2 anomalies to resolve</a><a href="#crossings">Timing log</a></p>"""
    else:
        go = f"""<p class="timing-go-race">{RACE}</p>
<p class="timing-clock club-num" aria-label="Finished at 12:31:40">12:31:40</p>
<h1 id="state">Race finished</h1>
<p class="timing-go-caption">Started <span class="club-num">11:00:04 GMT</span> · Finished <span class="club-num">12:31:40 GMT</span>. Marshals can still record crossings, and captures can still be corrected.</p>
<p class="timing-go-links"><a href="{BASE}/results">Results</a><a href="{BASE}/leaderboard">Live leaderboard</a></p>
<hr class="timing-go-rule">
<form method="post" action="{BASE}/finish/update"><button class="club-btn club-btn-secondary" type="submit">This race is not finished after all</button></form>"""

    log_cards = """<li class="club-card">
  <div class="timing-qcard-row">
    <span class="timing-bib">214</span>
    <div><p><strong>Alex Example</strong></p><p class="club-small">Women's Vet 40</p></div>
    <span class="club-badge timing-state" data-state="flagged">Flagged</span>
  </div>
  <p class="club-small"><span class="club-num">11:42:31</span> · Sunday 1 November · recorded by Sam Marshal</p>
  <p class="timing-qcard-actions"><a class="club-btn club-btn-secondary" href="#">Edit</a><button class="timing-danger-link" type="button">Discard</button></p>
</li>
<li class="club-card">
  <div class="timing-qcard-row">
    <span class="timing-bib">147</span>
    <div><p><strong>Pat Demo</strong></p><p class="club-small">Men's Senior</p></div>
    <span class="club-badge timing-state" data-state="ok">Counted</span>
  </div>
  <p class="club-small"><span class="club-num">11:42:18</span> · Sunday 1 November · recorded by Sam Marshal</p>
  <p class="timing-qcard-actions"><a class="club-btn club-btn-secondary" href="#">Edit</a><button class="timing-danger-link" type="button">Discard</button></p>
</li>
<li class="club-card">
  <div class="timing-qcard-row">
    <span class="timing-bib">999</span>
    <div><p><strong>No runner with this bib</strong></p><p class="club-small">Counts towards nobody until it is corrected</p></div>
    <span class="club-badge timing-state" data-state="discarded">Discarded</span>
  </div>
  <p class="club-small"><span class="club-num">11:40:02</span> · Sunday 1 November · recorded by Chris Mock</p>
  <p class="timing-qcard-actions"><a class="club-btn club-btn-secondary" href="#">Restore</a></p>
</li>"""

    jump = f"""<nav class="timing-jump" aria-label="Race console sections">
  <div class="club-wrap"><ul>
    <li><a href="#state" aria-current="true">Start and finish</a></li>
    <li><a href="#status">Race status</a></li>
    <li><a href="#anomalies">Anomalies <span class="club-badge">2</span></a></li>
    <li><a href="#crossings">Timing log</a></li>
  </ul></div>
</nav>"""

    below = f"""{jump}
<div class="club-wrap">
  <section id="status" aria-labelledby="status-h">
    <h2 id="status-h" class="timing-section-title">Race status</h2>
    <form class="club-form club-card" role="search">
      <div class="club-field">
        <label class="club-label" for="status_q">Search by bib or name</label>
        <input class="club-input" id="status_q" name="status_q" inputmode="search">
      </div>
      <p class="club-form-actions"><button class="club-btn club-btn-secondary" type="submit">Search</button></p>
    </form>
  </section>
  <section id="anomalies" aria-labelledby="anomalies-h">
    <h2 id="anomalies-h" class="timing-section-title">Anomalies</h2>
    <div class="timing-status"><span class="timing-count club-num">2 open</span><span class="club-badge">Updated 11:42:40</span><a class="club-btn club-btn-secondary" href="?section=anomalies">Refresh</a></div>
    <p class="club-small">A capture is here because a marshal’s screen flagged it, or because its bib matches nobody. An anomaly is a question, not an error.</p>
  </section>
  <section id="crossings" aria-labelledby="crossings-h">
    <h2 id="crossings-h" class="timing-section-title">Timing log</h2>
    <div class="timing-status"><span class="timing-count club-num">3 captures</span><span class="club-badge">Updated 11:42:40</span><a class="club-btn club-btn-secondary" href="?section=crossings">Refresh</a></div>
    <form class="club-form" role="search">
      <div class="club-field">
        <label class="club-label" for="log_q">Search by bib or name</label>
        <input class="club-input" id="log_q" name="log_q" inputmode="search">
      </div>
    </form>
    <p class="club-small">Every recorded crossing, newest first. Times are Europe/London.</p>
    <ul class="timing-stack">{log_cards}</ul>
  </section>
</div>"""

    body = f"""{focus('Race console', '', 'Leave the console', BASE)}
<main id="main" class="timing-control-main">
<section class="timing-go" aria-labelledby="state">
{go}
</section>
{below}
</main>"""
    return page(f'Race console — {RACE}', body, body_class='timing-control-page')


# ---- Live leaderboard ------------------------------------------------------------------------
ROWS = [
    (1, 101, 'Jordan Placeholder', "Men's Senior", '00:36:12'),
    (2, 214, 'Alex Example', "Women's Vet 40", '00:38:47'),
    (3, 147, 'Pat Demo', "Men's Senior", '00:39:05'),
    (4, 66, 'Robin Sample', "Women's Senior", '00:39:58'),
    (5, 88, 'Chris Mock', "Men's Vet 50", '00:41:20'),
    (6, 152, 'Morgan Fixture', "Women's Vet 60", '00:44:09'),
]


def leaderboard():
    podium = ''
    for label, (_, bib, name, _, t) in [
        ('Men · 1st', ROWS[0]),
        ('Women · 1st', ROWS[1]),
        ("Women's Vet 60 · 1st", ROWS[5]),
    ]:
        podium += f"""<li class="club-card"><p class="club-small">{label}</p><p class="timing-podium-name">{name}</p><p class="club-small">Bib <span class="club-num">{bib}</span></p><p class="timing-podium-time">{t}</p></li>"""

    trs = ''.join(
        f'<tr><td class="club-num">{p}</td><td><span class="timing-bib">{b}</span></td><td>{n}</td><td>{c}</td><td class="club-num timing-num-right">{t}</td></tr>'
        for p, b, n, c, t in ROWS
    )
    cards = ''.join(
        f'<li class="timing-row-card"><span class="timing-place">{p}</span><span class="timing-bib">{b}</span><div><p><strong>{n}</strong></p><p class="club-small">{c}</p></div><span class="club-num">{t}</span></li>'
        for p, b, n, c, t in ROWS
    )
    main = f"""<div class="club-wrap">
  <div class="club-phead">
    <h1>Live leaderboard</h1>
    <p class="club-lede">Provisional, for staff. Race in progress.</p>
  </div>
  <div class="timing-status"><span class="timing-count club-num">6 finishers</span><span class="club-badge" aria-live="polite">Updated 11:52:26</span></div>
  <ul class="club-g3" aria-label="Leading in each category">{podium}</ul>
  <ul class="timing-sort" aria-label="Sort by">
    <li><a href="?sort=total" aria-current="true">Total time</a></li>
    <li><a href="?sort=category">Category</a></li>
    <li><a href="?sort=bib">Bib</a></li>
  </ul>
  <div class="timing-board-table club-table-wrap">
    <table class="club-table">
      <caption class="club-visually-hidden">Provisional order</caption>
      <thead><tr><th scope="col">Place</th><th scope="col">Bib</th><th scope="col">Runner</th><th scope="col">Category</th><th scope="col" class="timing-num-right">Time</th></tr></thead>
      <tbody>{trs}</tbody>
    </table>
  </div>
  <ol class="timing-board-cards timing-stack">{cards}</ol>
</div>"""
    bar = area_bar(RACE, RACE_TABS_ADMIN, 'Live leaderboard')
    return shell(f'Live leaderboard — {RACE}', 'timing-admin', 'timing', bar, main)


# ---- Danger zone -----------------------------------------------------------------------------
def danger_zone():
    main = f"""<div class="club-wrap club-wrap-narrow">
  <div class="club-phead">
    <h1>Wipe this race</h1>
    <p class="club-lede">{RACE}</p>
  </div>
  <section class="timing-danger-card" aria-labelledby="danger-h">
    <h2 id="danger-h">This cannot be undone</h2>
    <p>Wiping this race removes <strong>every crossing and every entry</strong> recorded against it and puts it back to not started and not finished. It is how the field is cleared between two runs of the same rehearsal. It cannot be undone, and there is no export of what it removes.</p>
    <h3>What would be removed</h3>
    <dl class="club-meta">
      <div><dt>Entries</dt><dd class="club-num">212</dd></div>
      <div><dt>Runners</dt><dd class="club-num">214</dd></div>
      <div><dt>Crossings recorded</dt><dd class="club-num">37</dd></div>
      <div><dt>Anomalies needing a human</dt><dd class="club-num">2</dd></div>
    </dl>
    <h3>What would be kept</h3>
    <dl class="club-meta">
      <div><dt>Marshals rostered</dt><dd class="club-num">6</dd></div>
      <div><dt>Actually started</dt><dd>Tuesday 27 October 2026 at 19:00 GMT</dd></div>
      <div><dt>Finished</dt><dd>—</dd></div>
    </dl>
    <p>The race itself, its name, its start time and its marshals are kept. The two times above are cleared. What has been done to this race stays recorded, and wiping it is recorded too.</p>
    <form class="club-form" method="post" action="{BASE}/danger-zone/update">
      <div class="club-field">
        <label class="club-label" for="confirmation">Type <strong>{SLUG}</strong> to confirm</label>
        <p class="club-hint" id="confirmation-hint">Exactly as it appears above, in lower case.</p>
        <input class="club-input" id="confirmation" name="confirmation" aria-describedby="confirmation-hint" autocomplete="off" spellcheck="false">
      </div>
      <p class="club-form-actions">
        <button class="club-btn timing-btn-danger" type="submit" disabled aria-describedby="wipe-why">Wipe this race</button>
        <span class="club-small" id="wipe-why">Stays disabled until the box says {SLUG}.</span>
      </p>
    </form>
  </section>
  <p class="club-btns" style="margin-top:1.5rem"><a class="club-btn club-btn-secondary" href="{BASE}">Back to this race</a></p>
</div>"""
    bar = area_bar(RACE, RACE_TABS_ADMIN, None)
    return shell(f'Wipe this race — {RACE}', 'timing-admin', 'timing', bar, main)


PAGES = {
    'shell-none-account': account_none,
    'shell-marshal-timing-home': timing_home_marshal,
    'shell-admin-timing-home': timing_home_admin,
    'launchpad': launchpad,
    'capture-empty': lambda: capture('empty'),
    'capture-queue': lambda: capture('queue'),
    'capture-offline': lambda: capture('offline'),
    'console-before': lambda: console('before'),
    'console-running': lambda: console('running'),
    'console-finished': lambda: console('finished'),
    'leaderboard': leaderboard,
    'danger-zone': danger_zone,
}

if __name__ == '__main__':
    for name, fn in PAGES.items():
        (HERE / f'{name}.html').write_text(fn())
    print(f'{len(PAGES)} mockups written to {HERE}')
