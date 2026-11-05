"""Measure what the recorder saw: how late and how bunched each feed is.

For every recorded game: each play's lag (first seen minus when it happened,
ESPN's `wallclock`), how often the feed changes and how many plays arrive
at once, how often a play is revised after it first appears (and how long
after), and how far the scoreboard's score runs ahead of the play-by-play.
Usage: python3 measure.py [sport_dir ...]   (default: every sport recorded)
"""
import glob, gzip, json, os, re, sys
from datetime import datetime

# Recordings live beside the repo (../scoreline-recordings), or wherever
# SCORELINE_RECORDINGS points.
ROOT = os.environ.get("SCORELINE_RECORDINGS") or os.path.normpath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "scoreline-recordings"))


def pct(xs, p):
    if not xs:
        return float("nan")
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(p / 100 * (len(xs) - 1))))]


def stamp(s):
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except Exception:
        return None


def plays_in(node, out):
    """Every dict with an id and a wallclock, anywhere in the snapshot."""
    if isinstance(node, dict):
        if "id" in node and "wallclock" in node:
            out[str(node["id"])] = node
        for v in node.values():
            plays_in(v, out)
    elif isinstance(node, list):
        for v in node:
            plays_in(v, out)
    return out


# Kinds that belong to stoppages: they routinely arrive minutes late, and the presentation delay
# deliberately ignores them (they attach to the stoppage harmlessly). Everything else is live-ball.
DEAD = re.compile(r"foul|substitution|timeout|review|challenge|ejection|technical|official|injury|delay|"
                  r"end (of )?(period|quarter|half|game|regulation)|start (of )?(period|quarter|half)|"
                  r"halftime|end period|coach|instant replay|var|offside|card", re.I)


def kind(p):
    t = p.get("type")
    return " ".join(((t.get("text") if isinstance(t, dict) else None) or p.get("shortDescription") or "?").split())


def fingerprint(p):
    return (p.get("text"), p.get("homeScore"), p.get("awayScore"), p.get("scoreValue"),
            json.dumps(p.get("type"), sort_keys=True), p.get("wallclock"))


def summarize(label, xs, unit="s"):
    if not xs:
        return f"{label}: none"
    return (f"{label}: n={len(xs)} p10={pct(xs, 10):.1f}{unit} p50={pct(xs, 50):.1f}{unit} "
            f"p90={pct(xs, 90):.1f}{unit} p99={pct(xs, 99):.1f}{unit} max={max(xs):.1f}{unit}")


def scored(plays, pid):
    """On soccer's core lane: does this entry change the score from the entry before it in sequence?"""
    p = plays[pid]
    seq = str(p.get("sequenceNumber") or "")
    if not seq.isdigit():
        return False
    before = [q for q in plays.values() if str(q.get("sequenceNumber") or "").isdigit() and int(q["sequenceNumber"]) < int(seq)]
    if not before:
        return False
    prev = max(before, key=lambda q: int(q["sequenceNumber"]))
    return (p.get("homeScore"), p.get("awayScore")) != (prev.get("homeScore"), prev.get("awayScore"))


def snapshots(path):
    """The lane the app reads: soccer's core plays when recorded (core/), otherwise the summaries."""
    core = os.path.join(path, "core")
    return sorted(glob.glob(os.path.join(core if os.path.isdir(core) else path, "*.json.gz")))


def game(path):
    files = snapshots(path)
    if len(files) < 3:
        return None
    first_seen, last_fp, lags, revisions, removed = {}, {}, [], [], []
    windowed, prev_pos, pos, by_pos = os.path.isdir(os.path.join(path, "core")), {}, {}, {}
    plays_meta = {}  # id -> (kind, wallclock, first seen) for plays that arrived while recording
    gaps, batch, scoring_seen = [], [], {}
    prev_at, prev_ids = None, set()
    for f in files:
        at = int(os.path.basename(f).split(".")[0]) / 1000
        with gzip.open(f) as fh:
            snap = json.load(fh)
        plays = plays_in(snap, {})
        ids = set(plays)
        if windowed:
            pos = {str(it["id"]): snap.get("offset", 0) + i for i, it in enumerate(snap.get("items", []))}
            by_pos.update({n: plays[p] for p, n in pos.items() if p in plays})
        new = ids - set(first_seen)
        if prev_at is not None:
            gaps.append(at - prev_at)
            batch.append(len(new))
        for pid in new:
            first_seen[pid] = at
            # Plays already there when recording began say nothing about lag.
            if prev_at is None:
                continue
            w = stamp(plays[pid].get("wallclock") or "")
            if w:
                lags.append(at - w)
                plays_meta[pid] = (kind(plays[pid]), w, at)
            before = by_pos.get(pos.get(pid, -1) - 1) if windowed else None
            if plays[pid].get("scoringPlay") or (before and (plays[pid].get("homeScore"), plays[pid].get("awayScore"))
                                                 != (before.get("homeScore"), before.get("awayScore"))):
                scoring_seen[(plays[pid].get("awayScore"), plays[pid].get("homeScore"))] = at
        for pid in ids & set(last_fp):
            if fingerprint(plays[pid]) != last_fp[pid]:
                revisions.append(at - first_seen[pid])
        if windowed:
            # Only the newest pages were read: a play that slid out of the window wasn't removed.
            removed += [at - first_seen[p] for p in prev_ids - ids if p in first_seen and prev_pos.get(p, -1) >= snap.get("offset", 0)]
            prev_pos = dict(pos)
        else:
            removed += [at - first_seen[p] for p in prev_ids - ids if p in first_seen]
        for pid in ids:
            last_fp[pid] = fingerprint(plays[pid])
        prev_at, prev_ids = at, ids
    span = (int(os.path.basename(files[-1]).split(".")[0]) - int(os.path.basename(files[0]).split(".")[0])) / 60000
    # A game the recorder only polled now and then (it caps games per sport): its "lag" is the gaps.
    if span > 20 and len(files) / span < 0.5:
        print(f"  {os.path.basename(path.rstrip('/'))}: skipped, polled only {len(files)} times in {span:.0f} min")
        return None
    return dict(files=len(files), minutes=span, plays=len(first_seen), lags=lags, gaps=gaps,
                batch=[b for b in batch if b], revisions=revisions, removed=removed, scoring_seen=scoring_seen,
                meta=plays_meta, order=order_stats(files[-1]))


def order_stats(last_file):
    """Wallclock ties and backward steps in the final snapshot's play order (sequence order)."""
    with gzip.open(last_file) as fh:
        plays = list(plays_in(json.load(fh), {}).values())
    plays.sort(key=lambda p: int(p.get("sequenceNumber") or 0) if str(p.get("sequenceNumber") or "0").isdigit() else 0)
    ws = [stamp(p.get("wallclock") or "") for p in plays]
    ws = [w for w in ws if w]
    ties = sum(1 for a, b in zip(ws, ws[1:]) if a == b)
    back = [a - b for a, b in zip(ws, ws[1:]) if b < a]
    # A wallclock is trustworthy only while the game clock runs. Plays at a stopped clock after a stoppage
    # (free throws after a timeout or a challenge) carry the stoppage's start stamp, minutes early.
    # Soccer's clock always runs, and its display is whole minutes, so every entry counts.
    soccer = "soccer" in last_file
    def at_clock(p):
        return ((p.get("period") or {}).get("number"), (p.get("clock") or {}).get("displayValue"))
    running = {str(p["id"]) for i, p in enumerate(plays)
               if soccer or i == 0 or at_clock(p) != at_clock(plays[i - 1]) or not any(
                   DEAD.search(kind(q)) for q in plays[max(0, i - 6):i] if at_clock(q) == at_clock(p))}
    return dict(n=len(ws), ties=ties, back=back, running=running)


def coverage(meta, horizons=(0.0, 2.5, 6.0), delays=(30, 35, 40, 45, 50, 55, 60, 70)):
    """For each presentation delay D and binding horizon h: the share of live-ball plays whose details
    arrive after the director must bind them (wallclock + D - h), and the share of tightly linked next
    plays (within 10 s) still unknown when the current play binds."""
    live = sorted((w, at) for k, w, at in meta.values() if not DEAD.search(k))
    # meta here is already limited to trustworthy (running-clock) plays by the caller.
    rows = []
    for h in horizons:
        for d in delays:
            late = sum(1 for w, at in live if at > w + d - h)
            linked = [(cur, nxt) for cur, nxt in zip(live, live[1:]) if nxt[0] - cur[0] <= 10]
            unknown_next = sum(1 for cur, nxt in linked if nxt[1] > cur[0] + d - h)
            rows.append((h, d, late / max(len(live), 1), unknown_next / max(len(linked), 1), len(live)))
    return rows


def score_skew(sport_dir, event, scoring_seen):
    """Scoreboard score change arrival minus the play-by-play's scoring play arrival (positive: the score was first)."""
    path = os.path.join(sport_dir, "scores.jsonl")
    if not os.path.exists(path):
        return []
    board = {}
    with open(path) as fh:
        for line in fh:
            r = json.loads(line)
            if r["event"] != event or r["state"] != "in":
                continue
            key = (int(r["score"].get("away") or 0), int(r["score"].get("home") or 0))
            board.setdefault(key, r["at"])
    return [scoring_seen[k] - board[k] for k in scoring_seen if k in board]


def main():
    sports = sys.argv[1:] or sorted(d for d in os.listdir(ROOT) if os.path.isdir(os.path.join(ROOT, d)))
    for sport in sports:
        sport_dir = os.path.join(ROOT, sport)
        all_lags, all_gaps, all_batch, all_rev, all_skew = [], [], [], [], []
        all_meta, all_board_lag, ties, steps, ordered, trusted = {}, [], 0, [], 0, set()
        print(f"\n== {sport}")
        for event in sorted(os.listdir(sport_dir)):
            path = os.path.join(sport_dir, event)
            if not os.path.isdir(path):
                continue
            g = game(path)
            if not g:
                continue
            skew = score_skew(sport_dir, event, g["scoring_seen"])
            print(f"  {event}: {g['files']} changes over {g['minutes']:.0f} min, {g['plays']} plays")
            print("    " + summarize("lag (seen - happened)", g["lags"]))
            print("    " + summarize("gap between changes", g["gaps"]))
            print("    " + summarize("new plays per change", g["batch"], ""))
            print("    " + summarize("revised after first seen", g["revisions"]) + f" (of {g['plays']} plays)")
            if g["removed"]:
                print("    " + summarize("removed after first seen", g["removed"]))
            if skew:
                print("    " + summarize("score ahead of plays", skew))
            all_lags += g["lags"]; all_gaps += g["gaps"]; all_batch += g["batch"]; all_rev += g["revisions"]; all_skew += skew
            all_meta.update({(event, k): v for k, v in g["meta"].items()})
            trusted.update((event, k) for k in g["order"]["running"])
            all_board_lag += board_lag(sport_dir, event, path)
            ties += g["order"]["ties"]; steps += g["order"]["back"]; ordered += g["order"]["n"]
        print("  all games:")
        for label, xs, unit in [("lag", all_lags, "s"), ("gap", all_gaps, "s"), ("batch", all_batch, ""),
                                ("revised after", all_rev, "s"), ("score ahead of plays", all_skew, "s")]:
            print("    " + summarize(label, xs, unit))
        if not all_meta:
            continue
        print(f"    wallclock order: {ordered} plays, {ties} ties with the previous play, {len(steps)} backward steps"
              + (f" (p50 {pct(steps, 50):.0f}s, max {max(steps):.0f}s)" if steps else ""))
        print("    " + summarize("today's score on screen (scoreboard arrival - wallclock)", all_board_lag))
        by_kind = {}
        for k, w, at in all_meta.values():
            by_kind.setdefault(k, []).append(at - w)
        print("  lag by kind (live-ball kinds marked *):")
        for k, xs in sorted(by_kind.items(), key=lambda kv: -len(kv[1]))[:18]:
            print(f"    {'' if DEAD.search(k) else '*'}{k[:34]:34} n={len(xs):4} p50={pct(xs, 50):5.1f}s p90={pct(xs, 90):5.1f}s max={max(xs):5.1f}s")
        live = [at - w for k, w, at in all_meta.values() if not DEAD.search(k)]
        print("    " + summarize("live-ball lag, by wallclock", live))
        run_meta = all_meta if sport.startswith("soccer") else {k: v for k, v in all_meta.items() if k in trusted}
        stopped = [] if sport.startswith("soccer") else [at - w for key, (k, w, at) in all_meta.items() if key not in trusted and not DEAD.search(k)]
        print("    " + summarize("live-ball lag, running clock (trustworthy)", [at - w for k, w, at in run_meta.values() if not DEAD.search(k)]))
        print("    " + summarize("live-ball at a stopped clock after a stoppage (stamp too early)", stopped))
        print("  running-clock live-ball plays late at bind time, by delay D and binding horizon h (late / next-play unknown):")
        cov = coverage(run_meta)
        for h in sorted({r[0] for r in cov}):
            cells = "  ".join(f"D{d}:{late:4.0%}/{nxt:4.0%}" for hh, d, late, nxt, n in cov if hh == h)
            print(f"    h={h:3.1f}s  {cells}")
        if all_board_lag:
            base = pct(all_board_lag, 50)
            for h in (2.5,):
                ok = [d for hh, d, late, nxt, n in cov if hh == h and late <= 0.01]
                if ok:
                    print(f"    smallest D with <=1% late at h={h}s: {ok[0]}s, about {ok[0] - base:+.0f}s over today's score")


def board_lag(sport_dir, event, game_dir):
    """How far behind the play today's page shows its score: the scoreboard's first arrival of each scoring
    play's score, minus that play's wallclock."""
    path = os.path.join(sport_dir, "scores.jsonl")
    files = snapshots(game_dir)
    if not os.path.exists(path) or not files:
        return []
    board = {}
    with open(path) as fh:
        for line in fh:
            r = json.loads(line)
            if r["event"] == event and r["state"] == "in":
                board.setdefault((int(r["score"].get("away") or 0), int(r["score"].get("home") or 0)), r["at"])
    with gzip.open(files[-1]) as fh:
        plays = plays_in(json.load(fh), {}).values()
    first = int(os.path.basename(files[0]).split(".")[0]) / 1000
    out = []
    for p in plays:
        w = stamp(p.get("wallclock") or "")
        key = (p.get("awayScore"), p.get("homeScore"))
        if (p.get("scoringPlay") or ("core" in files[-1] and scored(dict((str(q["id"]), q) for q in plays), str(p["id"])))) and w and w > first and key in board:
            out.append(board[key] - w)
    return out


main()
