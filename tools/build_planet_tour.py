#!/usr/bin/env python3
"""Builds a flight's planetocentric tour legs (e.g. Juno's orbits of Jupiter)
from JPL Horizons, and writes them into data/flights/<flight>.json after the
flight's heliocentric legs.

What it does:
  1. Fetches the spacecraft's primary-centered position (ecliptic J2000, UT
     time scale) hourly across the tour, plus each of the primary's modeled
     moons over the same times.
  2. Finds every periapsis (local minimum of distance to the primary) and
     every moon flyby (closest approach under --flyby-km), refining each at
     1-2 minute resolution.
  3. Walks the path and places a waypoint at every periapsis and flyby, plus
     filler waypoints so no piece sweeps more than --max-sweep degrees around
     the primary or lasts more than --max-days. Each piece becomes one
     `planetocentric` leg; a flyby endpoint is {moon, offsetKm} (the moon's own modeled
     position plus the real spacecraft-minus-moon offset), anything else a
     {relPos: [km]}.

Pure Python (no numpy dependency), so it runs with the system python3. Horizons responses are cached in
tools/.horizons_cache/.

Usage:
    python3 tools/build_planet_tour.py juno --primary Jupiter \\
        --start 2016-07-04 --stop 2026-11-17 --dry-run
    python3 tools/build_planet_tour.py juno --primary Jupiter --start 2016-07-04 --stop 2026-11-17

Afterwards: python3 tools/check_horizons.py <flight>  (checks planetocentric
legs in the primary's frame too).
"""

import argparse
import datetime as dt
import hashlib
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(HERE)
CACHE_DIR = os.path.join(HERE, ".horizons_cache")
HZ = "https://ssd.jpl.nasa.gov/api/horizons.api"

PRIMARIES = {
    # Horizons body ID, mean radius km, moons modeled in app.js OUTER_MOONS
    # (name -> (Horizons ID, radius km))
    "Jupiter": ("599", 69911, {"Io": ("501", 1821.6), "Europa": ("502", 1560.8),
                                "Ganymede": ("503", 2634.1), "Callisto": ("504", 2410.3)}),
    "Saturn": ("699", 58232, {"Enceladus": ("602", 252.1), "Tethys": ("603", 536.3), "Dione": ("604", 561.7),
                              "Rhea": ("605", 764.3), "Titan": ("606", 2574.7), "Iapetus": ("608", 735.6)}),
    "Pluto": ("999", 1188.3, {"Charon": ("901", 606.0)}),
}


def hz_get(params):
    key = hashlib.sha1(json.dumps(params, sort_keys=True).encode()).hexdigest()
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, "tour_" + key + ".txt")
    if os.path.exists(path):
        return open(path).read()
    for attempt in range(4):
        try:
            with urllib.request.urlopen(HZ + "?" + urllib.parse.urlencode(params), timeout=180) as r:
                text = r.read().decode()
            break
        except Exception:
            if attempt == 3:
                raise
            time.sleep(10 * (attempt + 1))  # Horizons answers 503 when busy
    if "$$SOE" in text:
        open(path, "w").write(text)
    return text


def fmt_hz(d):
    return d.strftime("%Y-%m-%d %H:%M")


def vectors(target, center, start, stop, step):
    """[(datetime_utc, (x,y,z) km)] -- chunked so each request stays small."""
    out = []
    span = dt.timedelta(days=250) if step.endswith("h") else (dt.timedelta(days=30) if step.endswith("m") else stop - start)
    a = start
    while a < stop:
        b = min(a + span, stop)
        text = hz_get({"format": "text", "COMMAND": f"'{target}'", "EPHEM_TYPE": "VECTORS",
                       "CENTER": f"'500@{center}'", "START_TIME": f"'{fmt_hz(a)}'",
                       "STOP_TIME": f"'{fmt_hz(b)}'", "STEP_SIZE": f"'{step}'", "TIME_TYPE": "UT",
                       "CSV_FORMAT": "YES", "OUT_UNITS": "KM-S", "OBJ_DATA": "NO", "VEC_TABLE": "1",
                       "REF_PLANE": "ECLIPTIC", "REF_SYSTEM": "J2000"})
        if "$$SOE" not in text:
            raise RuntimeError(f"Horizons: no data for {target} {a}..{b}:\n{text[-800:]}")
        for line in text.split("$$SOE")[1].split("$$EOE")[0].strip().splitlines():
            p = [x.strip() for x in line.split(",")]
            day, clock = p[1].split()[1], p[1].split()[2]
            when = dt.datetime.strptime(day + " " + clock[:8], "%Y-%b-%d %H:%M:%S")
            if out and when <= out[-1][0]:
                continue
            out.append((when, (float(p[2]), float(p[3]), float(p[4]))))
        a = b
    return out


def norm(v):
    return math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def angle(a, b):
    c = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (norm(a) * norm(b))
    return math.degrees(math.acos(max(-1.0, min(1.0, c))))


def local_minima(series):
    return [k for k in range(1, len(series) - 1) if series[k] < series[k - 1] and series[k] <= series[k + 1]]


def iso(d):
    return d.strftime("%Y-%m-%dT%H:%M:%SZ")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("flight")
    ap.add_argument("--primary", default="Jupiter")
    ap.add_argument("--start", required=True, help="tour start (UTC), normally the heliocentric arrival date")
    ap.add_argument("--stop", required=True)
    ap.add_argument("--max-sweep", type=float, default=60.0)
    ap.add_argument("--max-days", type=float, default=8.0)
    ap.add_argument("--flyby-km", type=float, default=25000.0,
                    help="closest approach (center-to-center) below which a moon pass counts as a flyby")
    ap.add_argument("--merge-min", type=float, default=30.0,
                    help="drop a periapsis within this many minutes of a moon flyby (the flyby is the waypoint)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    with open(os.path.join(HERE, "horizons_ids.json")) as f:
        sc = json.load(f)[args.flight]["id"]
    center, prim_radius, moons = PRIMARIES[args.primary]
    start = dt.datetime.fromisoformat(args.start.replace("Z", ""))
    stop = dt.datetime.fromisoformat(args.stop.replace("Z", ""))

    coarse = vectors(sc, center, start, stop, "1h")
    times = [w for w, _ in coarse]
    pos = {w: p for w, p in coarse}
    r = [norm(p) for _, p in coarse]

    fine = {}  # extra samples near events
    events = []  # (datetime, kind, info)

    # Periapses.
    for k in local_minima(r):
        lo, hi = times[k] - dt.timedelta(hours=3), times[k] + dt.timedelta(hours=3)
        f = vectors(sc, center, lo, hi, "2m")
        fine.update(dict(f))
        w, p = min(f, key=lambda x: norm(x[1]))
        events.append((w, "peri", {"rKm": norm(p)}))

    # Moon flybys.
    for name, (mid, mrad) in moons.items():
        mc = dict(vectors(mid, center, start, stop, "1h"))
        d = [norm(sub(pos[w], mc[w])) for w in times]
        for k in local_minima(d):
            # Hourly samples can miss closest approach by up to ~half an hour
            # of relative motion (~30,000 km at 15 km/s), so only passes whose
            # hourly minimum is within that margin of --flyby-km get refined.
            if d[k] > args.flyby_km + 30000:
                continue
            lo, hi = times[k] - dt.timedelta(hours=2), times[k] + dt.timedelta(hours=2)
            fs, fm = vectors(sc, center, lo, hi, "1m"), dict(vectors(mid, center, lo, hi, "1m"))
            best = min(((w, norm(sub(p, fm[w]))) for w, p in fs if w in fm), key=lambda x: x[1])
            if best[1] < args.flyby_km:
                # Second pass at 1 s: relative speeds of 10-25 km/s make a
                # 1-minute grid overestimate closest approach by up to ~1,000 km.
                lo2, hi2 = best[0] - dt.timedelta(minutes=3), best[0] + dt.timedelta(minutes=3)
                fs2 = vectors(sc, center, lo2, hi2, "360")
                fm2 = dict(vectors(mid, center, lo2, hi2, "360"))
                best = min([best] + [(w, norm(sub(p, fm2[w]))) for w, p in fs2 if w in fm2],
                           key=lambda x: x[1])
                fs = fs + [x for x in fs2 if x[0] == best[0]]
                fine.update(dict(fs))
                mpos = fm2.get(best[0]) or fm.get(best[0])
                spos = dict(fs).get(best[0])
                off = [round(a - b, 1) for a, b in zip(spos, mpos)] if (mpos and spos) else [0, 0, 0]
                events.append((best[0], "flyby", {"moon": name, "altKm": round(best[1] - mrad), "offsetKm": off}))

    events.sort()
    # Drop a periapsis that coincides (within --merge-min) with a flyby -- the flyby wins.
    flyby_times = [e[0] for e in events if e[1] == "flyby"]
    events = [e for e in events if e[1] == "flyby" or
              all(abs((e[0] - ft).total_seconds()) > args.merge_min * 60 for ft in flyby_times)]
    pos.update(fine)
    samples = sorted(pos)
    event_at = {e[0]: e for e in events}

    # Walk and place waypoints.
    nodes = [(samples[0], None)]
    acc, last = 0.0, samples[0]
    next_events = sorted(event_at)
    ei = 0
    for a, b in zip(samples, samples[1:]):
        acc += angle(pos[a], pos[b])
        while ei < len(next_events) and next_events[ei] < b:
            ei += 1
        if b in event_at:
            nodes.append((b, event_at[b]))
            acc, last = 0.0, b
            continue
        upcoming = next_events[ei] if ei < len(next_events) else None
        if upcoming and (upcoming - b).total_seconds() < 1800:
            continue  # let the event itself be the next waypoint
        if acc >= args.max_sweep or (b - last).total_seconds() >= args.max_days * 86400:
            if (samples[-1] - b).total_seconds() > 3600:
                nodes.append((b, None))
                acc, last = 0.0, b
    if nodes[-1][0] != samples[-1]:
        nodes.append((samples[-1], None))

    def endpoint(node):
        w, ev = node
        if ev and ev[1] == "flyby":
            return {"moon": ev[2]["moon"], "offsetKm": ev[2]["offsetKm"]}
        return {"relPos": [round(c, 1) for c in pos[w]]}

    legs = []
    for k in range(len(nodes) - 1):
        leg = {"type": "planetocentric", "primaryBody": args.primary,
               "fromBody": endpoint(nodes[k]), "toBody": endpoint(nodes[k + 1]),
               "departDate": iso(nodes[k][0]) if k else args.start,
               "arrivalDate": iso(nodes[k + 1][0])}
        ev = nodes[k + 1][1]
        if ev and ev[1] == "flyby":
            leg["flybyAltKm"] = ev[2]["altKm"]
        if ev and ev[1] == "peri":
            leg["periapsisAltKm"] = round(ev[2]["rKm"] - prim_radius)
        legs.append(leg)
    legs[0]["_comment"] = (
        f"{args.primary} tour built {dt.date.today().isoformat()} by tools/build_planet_tour.py from JPL "
        f"Horizons (target {sc}, {args.start} -> {args.stop}): one planetocentric Lambert arc per piece "
        f"between real periapses, moon flybys (pinned to the moon's modeled position) and filler "
        f"waypoints keeping each piece under {args.max_sweep:g} deg / {args.max_days:g} d.")

    n_peri = sum(1 for e in events if e[1] == "peri")
    flybys = [e for e in events if e[1] == "flyby"]
    print(f"{args.flight}: {len(legs)} legs, {n_peri} periapses, {len(flybys)} flybys")
    for w, _, info in flybys:
        print(f"  {w:%Y-%m-%d %H:%M}  {info['moon']:9s} {info['altKm']:>8,} km altitude")
    if args.dry_run:
        return 0

    path = os.path.join(REPO_ROOT, "data", "flights", args.flight + ".json")
    src = open(path).read()
    data = json.loads(src)
    data["legs"] = [l for l in data["legs"] if l.get("type") != "planetocentric"] + legs
    out = json.dumps(data, indent=2, ensure_ascii=("\\u" in src)) + ("\n" if src.endswith("\n") else "")
    open(path, "w").write(out)
    print(f"wrote {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
