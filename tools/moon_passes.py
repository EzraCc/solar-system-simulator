#!/usr/bin/env python3
"""Closest approach of a spacecraft to a planet and each of its modelled moons.

Uses JPL Horizons vectors of the spacecraft relative to each body (30-minute
steps over the window, then 1-minute steps around the minimum). Used to list
a flyby craft in every passed moon's mission list (timeline flybys) and to
check planet closest approaches against published values.

    python3 tools/moon_passes.py -24 Saturn 1979-08-25 1979-09-08
    python3 tools/moon_passes.py -31 Jupiter 1979-02-28 1979-03-12 --json out.json

Distances are from the body's centre, in km. Responses are cached in
tools/.cache/moon_passes/.
"""
import argparse
import datetime as dt
import hashlib
import json
import math
import os
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, ".cache", "moon_passes")
UA = "solar-simulator-catalog-check/1.0"

# Planet Horizons ID, then the moons modelled in app.js OUTER_MOONS.
SYSTEMS = {
    "Jupiter": ("599", {"Io": "501", "Europa": "502", "Ganymede": "503", "Callisto": "504"}),
    "Saturn": ("699", {"Enceladus": "602", "Tethys": "603", "Dione": "604", "Rhea": "605",
                       "Titan": "606", "Iapetus": "608"}),
    "Uranus": ("799", {"Ariel": "701", "Umbriel": "702", "Titania": "703", "Oberon": "704", "Miranda": "705"}),
    "Neptune": ("899", {"Triton": "801", "Nereid": "802"}),
}


def vectors(target, center, start, stop, step):
    p = {"format": "text", "COMMAND": f"'{target}'", "EPHEM_TYPE": "VECTORS", "CENTER": f"'500@{center}'",
         "REF_PLANE": "ECLIPTIC", "VEC_TABLE": "2", "OUT_UNITS": "KM-S", "CSV_FORMAT": "YES", "OBJ_DATA": "NO",
         "TIME_TYPE": "UT", "START_TIME": f"'{start}'", "STOP_TIME": f"'{stop}'", "STEP_SIZE": f"'{step}'"}
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, hashlib.sha1(json.dumps(p, sort_keys=True).encode()).hexdigest())
    if not os.path.exists(path):
        req = urllib.request.Request("https://ssd.jpl.nasa.gov/api/horizons.api?" + urllib.parse.urlencode(p),
                                     headers={"User-Agent": UA})
        open(path, "w").write(urllib.request.urlopen(req, timeout=120).read().decode())
    text = open(path).read()
    out = []
    for r in text.split("$$SOE")[1].split("$$EOE")[0].strip().splitlines():
        c = r.split(",")
        t = dt.datetime.strptime(c[1].strip()[5:22], "%Y-%b-%d %H:%M")
        x, y, z = map(float, c[2:5])
        out.append((t, math.sqrt(x * x + y * y + z * z)))
    return out


def closest(target, center, start, stop):
    coarse = vectors(target, center, start, stop, "30 m")
    t0, _ = min(coarse, key=lambda r: r[1])
    fine = vectors(target, center, (t0 - dt.timedelta(minutes=40)).strftime("%Y-%m-%d %H:%M"),
                   (t0 + dt.timedelta(minutes=40)).strftime("%Y-%m-%d %H:%M"), "1 m")
    t, d = min(fine, key=lambda r: r[1])
    edge = coarse[0][0] == t0 or coarse[-1][0] == t0
    return t, d, edge


def passes(target, planet, start, stop):
    pid, moons = SYSTEMS[planet]
    out = []
    for name, bid in [(planet, pid)] + list(moons.items()):
        t, d, edge = closest(target, bid, start, stop)
        out.append({"body": name, "t": t.strftime("%Y-%m-%dT%H:%M:00Z"), "km": round(d), "edge": edge})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("target", help="Horizons spacecraft ID, e.g. -24")
    ap.add_argument("planet", choices=sorted(SYSTEMS))
    ap.add_argument("start")
    ap.add_argument("stop")
    ap.add_argument("--json", default=None)
    a = ap.parse_args()
    res = passes(a.target, a.planet, a.start, a.stop)
    for r in res:
        print(f"{r['body']:10s} {r['t']}  {r['km']:>12,} km{'  (window edge)' if r['edge'] else ''}")
    if a.json:
        json.dump(res, open(a.json, "w"), indent=1)


if __name__ == "__main__":
    main()
