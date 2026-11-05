"""Scoreline feed recorder: what the app would have seen, and when.

Polls ESPN's public scoreboard and game summaries for live games in the
sports Scoreline animates, saving every *changed* response (gzip) with the
time it arrived. Used to measure feed lag and burstiness, and as a replay
bench (play a recorded game back through the real pipeline at real speed).

Layout: <sport>/<event>/<arrival-epoch-ms>.json.gz, plus scores.jsonl per
sport (the scoreboard's score and clock per event, each change, with arrival).
Also, as the app reads them: <sport>/<event>/status.jsonl (the core status, the
game clock the app polls every 5 s, each change) and, for soccer, whose theater
reads ESPN's core plays rather than the summary, <sport>/<event>/core/<arrival-ms>.json.gz
({"count", "offset", "items"}: the newest ~100–200 core plays, each time they change).
Polite by design: one summary request per game every few seconds, a cap on
games per sport, the default user agent, no retry loops. A failed fetch is
recorded in gaps.jsonl (per sport, and per event), so a replay can tell our
own holes from the feed's lag; after a failed scoreboard the live games keep
being polled rather than idling. Runs until the
hours given on the command line have passed (default 3), then stops.
"""
import gzip, hashlib, json, os, sys, time, urllib.request
from datetime import datetime

# Recordings live beside the repo (../scoreline-recordings), or wherever
# SCORELINE_RECORDINGS points.
ROOT = os.environ.get("SCORELINE_RECORDINGS") or os.path.normpath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "scoreline-recordings"))
BASE = "https://site.api.espn.com/apis/site/v2/sports/"
SPORTS = {"basketball/nba": 3, "football/nfl": 3, "football/college-football": 2,
          "soccer/usa.1": 2, "soccer/eng.1": 2, "basketball/wnba": 1}
CORE = "https://sports.core.api.espn.com/v2/sports/"
SUMMARY_EVERY, BOARD_EVERY, IDLE_EVERY, STATUS_EVERY, CORE_EVERY, CORE_PAGE = 3.0, 5.0, 300.0, 5.0, 5.0, 100
# What the replay bench needs; the rest (box score, news, odds) is bulk.
KEEP = {"header", "plays", "drives", "keyEvents", "commentary", "winprobability", "format", "gameInfo", "scoringPlays"}
END = time.time() + float(sys.argv[1] if len(sys.argv) > 1 else 3) * 3600


def log(msg):
    print(f"{datetime.now().isoformat(timespec='seconds')} {msg}", flush=True)


def get(url):
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            return json.load(r)
    except Exception as e:
        log(f"fetch failed {url}: {e}")
        return None


last_hash, last_score, last_summary = {}, {}, {}
last_status, last_status_at, last_core_at, core_count, core_hash = {}, {}, {}, {}, {}
last_live = {}


def gap(sport, event, what):
    """A fetch that failed: our hole, not the feed's. Replays read gaps.jsonl so a hole isn't taken for lag."""
    d = os.path.join(ROOT, sport.replace("/", "_"), *( [event] if event else []))
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "gaps.jsonl"), "a") as f:
        f.write(json.dumps({"at": time.time(), "what": what}) + "\n")


def save(sport, event, name, payload):
    d = os.path.join(ROOT, sport.replace("/", "_"), event, *name.split("/")[:-1])
    os.makedirs(d, exist_ok=True)
    with gzip.open(os.path.join(d, name.split("/")[-1]), "wb") as f:
        f.write(payload)


def record_status(sport, event):
    """The core status (clock, period, state): what the app polls every 5 s between scoreboards."""
    if time.time() - last_status_at.get(event, 0) < STATUS_EVERY:
        return
    last_status_at[event] = time.time()
    league = sport.split("/")
    s = get(f"{CORE}{league[0]}/leagues/{league[1]}/events/{event}/competitions/{event}/status")
    if not s:
        gap(sport, event, "status")
        return
    row = {"clock": s.get("clock"), "displayClock": s.get("displayClock"), "period": s.get("period"),
           "state": (s.get("type") or {}).get("state"), "detail": (s.get("type") or {}).get("detail")}
    if last_status.get(event) != row:
        last_status[event] = row
        d = os.path.join(ROOT, sport.replace("/", "_"), event)
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "status.jsonl"), "a") as f:
            f.write(json.dumps({"at": time.time(), **row}) + "\n")


def record_core(sport, event):
    """Soccer's core plays, the newest one or two pages: enough to see each entry arrive and be revised."""
    if time.time() - last_core_at.get(event, 0) < CORE_EVERY:
        return
    last_core_at[event] = time.time()
    league = sport.split("/")
    base = f"{CORE}{league[0]}/leagues/{league[1]}/events/{event}/competitions/{event}/plays"
    if event not in core_count:
        head = get(f"{base}?limit=1")
        if not head:
            return
        core_count[event] = head.get("count") or 0
    last_page = max(1, -(-core_count[event] // CORE_PAGE))
    pages = [p for p in (last_page - 1, last_page) if p >= 1]
    items, count = [], core_count[event]
    for p in pages:
        r = get(f"{base}?limit={CORE_PAGE}&page={p}")
        if not r:
            gap(sport, event, "core")
            return
        items += r.get("items") or []
        count = r.get("count") or count
    arrived = time.time()
    # A page that filled up since the last read: read the next one at once next time.
    core_count[event] = count
    raw = json.dumps({"count": count, "offset": (pages[0] - 1) * CORE_PAGE, "items": items}, sort_keys=True).encode()
    h = hashlib.sha1(raw).hexdigest()
    if core_hash.get(event) != h:
        core_hash[event] = h
        save(sport, event, f"core/{int(arrived * 1000)}.json.gz", raw)
log("recording")
while time.time() < END:
    now = time.time()
    live, board_failed = [], False
    for sport in SPORTS:
        board = get(BASE + sport + "/scoreboard")
        if not board:
            # A failed fetch isn't "nothing live": keep polling what was live, and say there was a hole.
            board_failed = True
            gap(sport, None, "scoreboard")
            live += last_live.get(sport, [])
            continue
        rows = []
        sport_live = []
        for e in board.get("events", []):
            state = e["status"]["type"]["state"]
            comp = e["competitions"][0]
            sit = comp.get("situation") or {}
            last = sit.get("lastPlay") or {}
            snap = {"state": state, "score": {c["homeAway"]: c.get("score") for c in comp["competitors"]},
                    "clock": e["status"].get("displayClock"), "period": e["status"].get("period"),
                    # The scoreboard's own view of the latest play (and football's down and distance):
                    # is it faster than the play-by-play?
                    "lastPlay": {k: last.get(k) for k in ("id", "text", "scoreValue")} if last else None,
                    "situation": {k: sit.get(k) for k in ("possession", "downDistanceText", "isRedZone")} if sit else None}
            key = (sport, e["id"])
            if last_score.get(key) != snap:
                last_score[key] = snap
                rows.append(json.dumps({"at": now, "event": e["id"], **snap}))
            if state == "in":
                sport_live.append((sport, e["id"]))
        last_live[sport] = sport_live
        live += sport_live
        if rows:
            d = os.path.join(ROOT, sport.replace("/", "_"))
            os.makedirs(d, exist_ok=True)
            with open(os.path.join(d, "scores.jsonl"), "a") as f:
                f.write("\n".join(rows) + "\n")
    picked = []
    for sport, cap in SPORTS.items():
        picked += [g for g in live if g[0] == sport][:cap]
    if not picked:
        # Idle only when the boards answered and nothing's on; after a failure, try again soon.
        time.sleep(min(BOARD_EVERY if board_failed else IDLE_EVERY, max(END - time.time(), 0)))
        continue
    round_end = time.time() + BOARD_EVERY * 2
    while time.time() < round_end:
        for sport, event in picked:
            record_status(sport, event)
            if sport.startswith("soccer/"):
                record_core(sport, event)
            if time.time() - last_summary.get(event, 0) < SUMMARY_EVERY:
                continue
            last_summary[event] = time.time()
            s = get(f"{BASE}{sport}/summary?event={event}")
            if not s:
                gap(sport, event, "summary")
                continue
            arrived = time.time()
            raw = json.dumps({k: v for k, v in s.items() if k in KEEP}, sort_keys=True).encode()
            h = hashlib.sha1(raw).hexdigest()
            if last_hash.get(event) == h:
                continue
            last_hash[event] = h
            d = os.path.join(ROOT, sport.replace("/", "_"), event)
            os.makedirs(d, exist_ok=True)
            with gzip.open(os.path.join(d, f"{int(arrived * 1000)}.json.gz"), "wb") as f:
                f.write(raw)
        time.sleep(0.5)
log("done")
