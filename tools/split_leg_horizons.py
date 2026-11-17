#!/usr/bin/env python3
"""Splits one Lambert leg of a flight JSON into a chain of shorter Lambert
legs through real JPL Horizons waypoints ({"fixedPos": [x,y,z]} endpoints)
-- the established fix for a leg whose two-point solve has the wrong shape
(see solar_orbiter.json leg 0's _comment), automated.

Waypoints are placed by walking Horizons' heliocentric positions (6-hour
steps by default, so fast perihelion passages are resolved)
across the leg and dropping a waypoint whenever the real spacecraft has
swept --max-sweep degrees of heliocentric angle (default 90) or --max-days
days (default 150) since the previous one, whichever comes first. Keeping
every piece well under 180 degrees of sweep is what makes the app's
zero-revolution Lambert solver unambiguous; the day cap keeps slow outer-
system coasts and thrusting (ion/SEP) arcs from drifting between anchors.

Always re-run tools/check_horizons.py on the flight afterwards.

Usage:
    python3 tools/split_leg_horizons.py psp 10            # rewrites data/flights/psp.json
    python3 tools/split_leg_horizons.py psp 10 --dry-run  # just print the plan
    python3 tools/split_leg_horizons.py psp 10 --max-sweep 60 --max-days 90
"""

import argparse
import datetime as dt
import json
import math
import re
import os
import sys
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(HERE)
HORIZONS_URL = "https://ssd.jpl.nasa.gov/api/horizons.api"


def horizons_daily(target, start, stop, step_hours=6, _retry=False, _retry_end=False):
    params = {
        "format": "text", "COMMAND": f"'{target}'", "EPHEM_TYPE": "VECTORS",
        "CENTER": "'500@10'", "REF_PLANE": "ECLIPTIC", "REF_SYSTEM": "J2000",
        "VEC_TABLE": "1", "OUT_UNITS": "AU-D", "CSV_FORMAT": "YES", "OBJ_DATA": "NO",
        "START_TIME": f"'{start}'", "STOP_TIME": f"'{stop}'", "STEP_SIZE": f"'{step_hours} h'",
    }
    with urllib.request.urlopen(HORIZONS_URL + "?" + urllib.parse.urlencode(params), timeout=120) as r:
        text = r.read().decode()
    m = re.search(r"prior to A\.D\. (\d{4}-[A-Z]{3}-\d{2} \d{2}:\d{2})", text)
    m_after = re.search(r"after A\.D\. (\d{4}-[A-Z]{3}-\d{2} \d{2}:\d{2})", text)
    if "$$SOE" not in text and m_after and not _retry_end:
        # Predicted ephemeris ends before this leg does (e.g. an active
        # mission's published cruise trajectory stops at approach). Sample
        # what exists; main() anchors a waypoint at the last available point.
        last = dt.datetime.strptime(m_after.group(1).title(), "%Y-%b-%d %H:%M") - dt.timedelta(minutes=5)
        return horizons_daily(target, start, last.strftime("%Y-%m-%d %H:%M"), step_hours, _retry, True)
    if "$$SOE" not in text and m and not _retry:
        # Spacecraft ephemeris typically starts minutes-to-hours after launch;
        # begin sampling just after that instead. (The first piece still
        # departs from the leg's own fromBody at its own departDate.)
        first = dt.datetime.strptime(m.group(1).title(), "%Y-%b-%d %H:%M") + dt.timedelta(minutes=5)
        return horizons_daily(target, first.strftime("%Y-%m-%d %H:%M"), stop, step_hours, True, _retry_end)
    if "$$SOE" not in text:
        raise RuntimeError(f"Horizons returned no data for {target} {start}..{stop}:\n{text[-1200:]}")
    out = []
    for line in text.split("$$SOE")[1].split("$$EOE")[0].strip().splitlines():
        p = [x.strip() for x in line.split(",")]
        # p[1] like "A.D. 2021-Oct-16 06:00:00.0000"
        _, day, clock = p[1].split()
        d = dt.datetime.strptime(day + " " + clock[:8], "%Y-%b-%d %H:%M:%S")
        out.append((d, [float(p[2]), float(p[3]), float(p[4])]))
    return out


def fmt_when(d):
    """Bare date at midnight UTC (the catalog's convention), else a full
    ISO timestamp -- parseFlightDate in app.js accepts both."""
    if d.hour == 0 and d.minute == 0 and d.second == 0:
        return d.date().isoformat()
    return d.strftime("%Y-%m-%dT%H:%M:%SZ")


def to_horizons_time(s):
    return s.replace("T", " ").rstrip("Z") if "T" in s else s + " 00:00"


def angle_deg(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    return math.degrees(math.acos(max(-1.0, min(1.0, dot / (na * nb)))))


def plan_waypoints(daily, max_sweep, max_days, min_tail_days):
    picks = []
    acc, last_day = 0.0, daily[0][0]
    end_day = daily[-1][0]
    for (d0, p0), (d1, p1) in zip(daily, daily[1:]):
        acc += angle_deg(p0, p1)
        if (acc >= max_sweep or (d1 - last_day).total_seconds() >= max_days * 86400) and \
                (end_day - d1).total_seconds() >= min_tail_days * 86400:
            picks.append((d1, p1))
            acc, last_day = 0.0, d1
    return picks


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("flight")
    ap.add_argument("leg", type=int)
    ap.add_argument("--max-sweep", type=float, default=90.0)
    ap.add_argument("--max-days", type=int, default=150)
    ap.add_argument("--min-tail-days", type=int, default=5,
                    help="don't drop a waypoint closer than this to the leg's own end")
    ap.add_argument("--step-hours", type=int, default=6, help="Horizons sampling step (default 6 h)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--note", default="", help="extra sentence for the generated _comment")
    args = ap.parse_args()

    with open(os.path.join(HERE, "horizons_ids.json")) as f:
        target = json.load(f)[args.flight]["id"]
    path = os.path.join(REPO_ROOT, "data", "flights", args.flight + ".json")
    with open(path) as f:
        src = f.read()
    data = json.loads(src)
    leg = data["legs"][args.leg]
    if leg.get("type") != "lambert":
        sys.exit(f"leg {args.leg} is {leg.get('type')!r}, not lambert")

    daily = horizons_daily(target, to_horizons_time(leg["departDate"]), to_horizons_time(leg["arrivalDate"]),
                           args.step_hours)
    picks = plan_waypoints(daily, args.max_sweep, args.max_days, args.min_tail_days)
    leg_end = dt.datetime.strptime(to_horizons_time(leg["arrivalDate"])[:16], "%Y-%m-%d %H:%M")
    if (leg_end - daily[-1][0]).total_seconds() > args.min_tail_days * 86400:
        # Horizons coverage ended early: anchor on its last real point (snapped
        # back to a whole day so the catalog keeps its usual date style).
        last_whole = [x for x in daily if x[0].hour == 0 and x[0].minute == 0]
        end_pt = last_whole[-1] if last_whole else daily[-1]
        print(f"  (Horizons coverage ends {fmt_when(daily[-1][0])}, before the leg's "
              f"{leg['arrivalDate']} arrival -- anchoring a waypoint at {fmt_when(end_pt[0])})")
        picks = [p for p in picks if p[0] < end_pt[0]] + [end_pt]
    total_sweep = sum(angle_deg(a[1], b[1]) for a, b in zip(daily, daily[1:]))
    print(f"{args.flight} leg {args.leg}: {leg['departDate']} -> {leg['arrivalDate']}, "
          f"real heliocentric sweep {total_sweep:.0f} deg; {len(picks)} waypoint(s):")
    for d, p in picks:
        print(f"  {fmt_when(d):20s}  [{p[0]:+.4f}, {p[1]:+.4f}, {p[2]:+.4f}]  r={math.sqrt(sum(c*c for c in p)):.3f} AU")
    if not picks:
        print("nothing to split")
        return 0
    if args.dry_run:
        return 0

    today = dt.date.today().isoformat()
    comment = (f"Split through {len(picks)} real JPL Horizons waypoint(s) (target {target}, fetched "
               f"{today} by tools/split_leg_horizons.py, max {args.max_sweep:g} deg / {args.max_days} d "
               f"per piece): the original single {leg['departDate']} -> {leg['arrivalDate']} leg's real "
               f"path sweeps ~{total_sweep:.0f} deg around the Sun, and its rendered shape strayed far from "
               f"Horizons (tools/check_horizons.py). Each piece stays well under 180 deg so the app's "
               f"zero-revolution Lambert solver can't pick the wrong orbit.")
    if args.note:
        comment += " " + args.note
    if leg.get("_comment"):
        comment = leg["_comment"] + " | " + comment

    endpoints = [leg["fromBody"]] + [{"fixedPos": p} for _, p in picks] + [leg["toBody"]]
    dates = [leg["departDate"]] + [fmt_when(d) for d, _ in picks] + [leg["arrivalDate"]]
    new_legs = []
    for k in range(len(endpoints) - 1):
        nl = {}
        if k == 0:
            nl["_comment"] = comment
        nl.update({"type": "lambert", "fromBody": endpoints[k], "toBody": endpoints[k + 1],
                   "departDate": dates[k], "arrivalDate": dates[k + 1]})
        # Carry over any other fields of the original leg (none expected).
        for key, val in leg.items():
            if key not in nl and key not in ("_comment",):
                nl[key] = val
        new_legs.append(nl)
    data["legs"][args.leg:args.leg + 1] = new_legs

    ensure_ascii = "\\u" in src
    out = json.dumps(data, indent=2, ensure_ascii=ensure_ascii)
    if src.endswith("\n"):
        out += "\n"
    with open(path, "w") as f:
        f.write(out)
    print(f"wrote {path} ({len(new_legs)} legs replace leg {args.leg})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
