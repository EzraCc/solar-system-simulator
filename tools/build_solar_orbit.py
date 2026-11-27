#!/usr/bin/env python3
"""Build an estimated heliocentric orbit for a craft with no destination.

For early probes that went into solar orbit without a target (Pioneer 5,
Mariner 3, Pioneer 7/9, Zond 3 ...) and have no measured trajectory, only
published orbit figures: perihelion q, aphelion Q (AU) and inclination i.

Construction (an estimate -- every leg is written with "estimate": true and
draws dashed):
  - The craft starts at Earth's heliocentric position at launch (JPL
    Horizons, ecliptic J2000).
  - Its orbit has the published q and Q. The starting true anomaly is where
    the orbit's radius equals Earth's distance at launch, on the outbound
    branch (r increasing) for orbits that reach beyond Earth and on the
    inbound branch (r decreasing) for orbits inside it; if Earth's distance
    is outside [q, Q] the nearer apsis is used.
  - The launch point lies in the ecliptic, so it is taken as the ascending
    node (inclination direction is unknown; ascending is assumed).
  - Two-body propagation from there; positions every --step days become
    fixedPos waypoints joined by Lambert legs (as in stereo_a.json and the
    Helios flights). A Lambert arc between two points of one two-body orbit
    reproduces that orbit.

Not known from q, Q, i alone: the true orientation of the line of apsides
and of the node, and the exact phase. They follow from the assumptions
above, so the drawn orbit has the right size and shape but only an
approximate orientation.

    python3 tools/build_solar_orbit.py pioneer_5 --launch 1960-03-11T13:00:07Z \
        --q 0.806 --Q 0.995 --i 3.35 --end 1960-06-26T11:31:00Z --step 10
    (add --write to replace the flight file's "legs"; without it, a report)
"""
import argparse
import datetime as dt
import json
import math
import os
import re
import urllib.parse
import urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
CACHE = os.path.join(ROOT, "tools", ".cache", "solar_orbit")
GM = 0.01720209895 ** 2          # AU^3 / day^2 (Gaussian constant)
J2000 = dt.datetime(2000, 1, 1, 12, tzinfo=dt.timezone.utc)
UA = "solar-simulator-catalog-check/1.0"


def parse_t(s):
    s = s.replace("Z", "+00:00")
    t = dt.datetime.fromisoformat(s if "T" in s else s + "T00:00:00+00:00")
    return t if t.tzinfo else t.replace(tzinfo=dt.timezone.utc)


def iso(t):
    return t.strftime("%Y-%m-%dT%H:%M:%SZ") if (t.hour or t.minute or t.second) else t.strftime("%Y-%m-%d")


def horizons_vec(target, t):
    """Heliocentric ecliptic J2000 position (AU) of a Horizons target at time t."""
    os.makedirs(CACHE, exist_ok=True)
    key = re.sub(r"\W", "_", f"{target}_{t.isoformat()}")
    path = os.path.join(CACHE, key + ".txt")
    if not os.path.exists(path):
        t1 = t + dt.timedelta(minutes=1)
        q = {"format": "text", "COMMAND": f"'{target}'", "EPHEM_TYPE": "VECTORS",
             "CENTER": "'500@10'", "REF_PLANE": "ECLIPTIC", "REF_SYSTEM": "J2000",
             "OUT_UNITS": "AU-D", "VEC_TABLE": "1", "CSV_FORMAT": "YES",
             "START_TIME": f"'{t.strftime('%Y-%m-%d %H:%M:%S')}'",
             "STOP_TIME": f"'{t1.strftime('%Y-%m-%d %H:%M:%S')}'", "STEP_SIZE": "'1m'"}
        url = "https://ssd.jpl.nasa.gov/api/horizons.api?" + urllib.parse.urlencode(q)
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=60) as r:
            open(path, "w").write(r.read().decode())
    text = open(path).read()
    row = text.split("$$SOE")[1].split("$$EOE")[0].strip().splitlines()[0]
    parts = [p.strip() for p in row.split(",")]
    return [float(parts[2]), float(parts[3]), float(parts[4])]


def kepler_E(M, e):
    E = M if e < 0.8 else math.pi
    for _ in range(50):
        d = (E - e * math.sin(E) - M) / (1 - e * math.cos(E))
        E -= d
        if abs(d) < 1e-14:
            break
    return E


def build(launch, q, Q, inc, r0vec, end, step):
    a = (q + Q) / 2
    e = (Q - q) / (Q + q)
    p = a * (1 - e * e)
    r0 = math.sqrt(sum(c * c for c in r0vec))
    outward = r0 <= (q + Q) / 2          # craft mostly outside Earth's distance -> heading out
    if r0 <= q:
        nu0 = 0.0
    elif r0 >= Q:
        nu0 = math.pi
    else:
        nu0 = math.acos(max(-1.0, min(1.0, (p / r0 - 1) / e)))
        if not outward:
            nu0 = 2 * math.pi - nu0       # inbound branch (r decreasing)
    E0 = 2 * math.atan2(math.sqrt(1 - e) * math.sin(nu0 / 2), math.sqrt(1 + e) * math.cos(nu0 / 2))
    M0 = E0 - e * math.sin(E0)
    n = math.sqrt(GM / a ** 3)
    Om = math.atan2(r0vec[1], r0vec[0])   # launch point = ascending node
    w = -nu0
    i = math.radians(inc)

    def pos(t):
        days = (t - launch).total_seconds() / 86400
        E = kepler_E((M0 + n * days) % (2 * math.pi), e)
        nu = 2 * math.atan2(math.sqrt(1 + e) * math.sin(E / 2), math.sqrt(1 - e) * math.cos(E / 2))
        r = a * (1 - e * math.cos(E))
        u = w + nu
        return [r * (math.cos(Om) * math.cos(u) - math.sin(Om) * math.sin(u) * math.cos(i)),
                r * (math.sin(Om) * math.cos(u) + math.cos(Om) * math.sin(u) * math.cos(i)),
                r * math.sin(u) * math.sin(i)]

    times, t = [], launch
    first = (launch + dt.timedelta(days=step)).replace(hour=0, minute=0, second=0, microsecond=0)
    t = first
    while t < end:
        times.append(t)
        t += dt.timedelta(days=step)
    times.append(end)
    legs, prev = [], "Earth"
    for k, tk in enumerate(times):
        fp = {"fixedPos": [round(c, 7) for c in pos(tk)]}
        legs.append({"type": "lambert", "fromBody": prev, "toBody": fp,
                     "departDate": iso(launch if k == 0 else times[k - 1]),
                     "arrivalDate": iso(tk), "estimate": True})
        prev = fp
    period = 2 * math.pi / n
    return legs, pos, {"a": a, "e": e, "period_days": period, "r_launch": r0,
                       "nu0_deg": math.degrees(nu0), "branch": "outbound" if outward else "inbound"}


def write_legs(key, legs):
    path = os.path.join(ROOT, "data", "flights", key + ".json")
    raw = json.load(open(path, encoding="utf-8"))
    raw["legs"] = legs
    for k in ("launchBody", "destinationBody", "launchDate", "arrival"):
        raw.pop(k, None)
    json.dump(raw, open(path, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    open(path, "a").write("\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("key")
    ap.add_argument("--launch", required=True)
    ap.add_argument("--q", type=float, required=True, help="perihelion, AU")
    ap.add_argument("--Q", type=float, required=True, help="aphelion, AU")
    ap.add_argument("--i", type=float, default=0.0, help="inclination to the ecliptic, deg")
    ap.add_argument("--end", required=True)
    ap.add_argument("--step", type=float, default=15)
    ap.add_argument("--check", nargs=2, metavar=("DATE", "KM"), action="append", default=[],
                    help="compare the craft-Earth distance at DATE with a published value")
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args()
    launch, end = parse_t(a.launch), parse_t(a.end)
    r0 = horizons_vec("399", launch)
    legs, pos, info = build(launch, a.q, a.Q, a.i, r0, end, a.step)
    print(json.dumps({**info, "legs": len(legs)}))
    for date, km in a.check:
        t = parse_t(date)
        p, ev = pos(t), horizons_vec("399", t)
        d = math.dist(p, ev) * 149597870.7
        print(f"  craft-Earth distance {date}: {d/1e6:.1f} million km (published {float(km)/1e6:.1f})")
    if a.write:
        write_legs(a.key, legs)
        print(f"  wrote {len(legs)} legs to data/flights/{a.key}.json")


if __name__ == "__main__":
    main()
