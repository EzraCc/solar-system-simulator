#!/usr/bin/env python3
"""Builds estimated solar-orbit paths from published orbit figures (chunk H:
Pioneer 6, 7 and 8).

These craft have no usable ephemeris for their mission years. Horizons
covers Pioneer 6 only 1996-1999 and Pioneer 8 only 1997-1999 (a 1996
reconstruction for the SETI Institute); run back 30 years on two-body
motion, those states miss Earth at launch by 1.8 AU and 0.12 AU, so they
can't pin the 1960s paths. Nothing for Pioneer 7. What is published is the
size of each orbit: perihelion and aphelion distance (and inclination).
This tool turns that into a path:

  - Start: Earth at launch, position from JPL Horizons.
  - Orbit: the published perihelion q and aphelion Q fix the size and shape.
    The craft starts at the body's distance r0. If r0 matches one apsis
    (Pioneers 6/7/8 left Earth tangentially, at aphelion or perihelion),
    the launch point is that apsis; otherwise the radial direction
    (outbound or inbound) is given per flight.
  - Plane: inclined by the published inclination, with the node at the
    start point (the inclinations are 0.06-0.5 deg, so this barely matters).
  - Two-body propagation (no planetary perturbations), sampled every
    period/10 days as fixedPos waypoints, every leg "estimate": true (dashed).

The orientation of each orbit therefore rests on an assumption (tangential
departure at the start point), so these are estimates. CHECKS lists dated
events from the mission record that test the result (e.g. Pioneer 6 behind
the Sun in November 1968); --check prints them.

    python3 tools/build_solar_orbit_h.py --check     # report only
    python3 tools/build_solar_orbit_h.py             # write legs into the flights
"""
import argparse
import datetime as dt
import json
import math
import os

import sys
import urllib.request

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_helios import propagate, MU_SUN, J2000  # noqa: E402

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
CACHE = os.path.join(ROOT, "tools", ".cache", "solar_orbit")
UA = "solar-simulator-orbit-build/1.0"
LEGS_PER_ORBIT = 10  # waypoints are exactly period/10 apart, starting at launch, so the
                     # laps line up and their dashes coincide (with arbitrary leg
                     # boundaries each lap restarts the dash pattern somewhere else
                     # and the overlapping laps fill each other's gaps)
AU_KM = 1.495978707e8

# Published orbit figures. Sources are cited in each flight's dataSources.
FLIGHTS = {
    # NSSDCA trajectory page: 0.81 x 0.98 AU, 310.77 d, i 0.169 deg;
    # Siddiqi: 0.814 x 0.985 AU, 311.3 d. Left Earth inward: aphelion at launch.
    "pioneer_6": {"start": ("399", "1965-12-16T07:31:21"), "q": 0.814, "Q": None, "inc": 0.169,
                  "end": "1969-01-01", "period_pub": 311.3},
    # NSSDCA: 1.01 x 1.12 AU, 402.90 d, i 0.098 deg; Siddiqi 1.01 x 1.125 AU,
    # 402.95 d. Left Earth outward: perihelion at launch.
    "pioneer_7": {"start": ("399", "1966-08-17T15:20:17"), "q": None, "Q": 1.125, "inc": 0.098,
                  "end": "1968-10-01", "period_pub": 402.95},
    # NSSDCA: 0.99 x 1.09 AU, 387.50 d, i 0.057 deg (Siddiqi's "1.0080 x
    # 0.9892" is a misprint). Launched "ahead of Earth" to move outward:
    # perihelion at launch.
    "pioneer_8": {"start": ("399", "1967-12-13T14:08:00"), "q": None, "Q": 1.09, "inc": 0.057,
                  "end": "1970-01-01", "period_pub": 387.5},
}
# Zond 3 was tried and dropped. The only published solar-orbit figures
# (Wikipedia: 0.9 x 1.56 AU, i 0.5 deg, ~500 d, from the Moon after the
# 1965-07-20 flyby) contradict the Earth distances Siddiqi reports
# (ZOND3_DISTANCES) under every departure assumption: outbound gives 5.7 /
# 90.8 / 285 million km, inbound 5.3 / 57.9 / 87, against 2.2 / 31.5 / 153.5.
# Its path ends at the lunar flyby. Rerun with --zond3 to see the test.
ZOND3 = {"start": ("301", "1965-07-20T02:00:00"), "q": 0.9, "Q": 1.56, "inc": 0.5,
         "end": "1966-03-03", "branch": "outbound", "period_pub": 500}

# (date, kind, expected, source). kind "earth_km": distance from Earth (km);
# "elong": Sun-centred angle Earth-Sun-craft (deg, 180 = behind the Sun,
# 0 = anti-sunward of Earth on the same line).
CHECKS = {
    "pioneer_6": [("1968-11-22", "elong", 180, "solar occultation 21-24 Nov 1968 (Siddiqi)")],
    # Pioneer 7: Siddiqi's "aligned with the Sun and Earth on 7 September
    # 1968" can't hold: with the published 403-day period the craft trails
    # Earth by ~70 deg by then, whatever the orbit's orientation. No check.
    "pioneer_8": [("1968-01-18", "elong", 0, "Sun, Earth and craft aligned, 18 Jan 1968 (Siddiqi)")],
    "zond3_test": [("1965-07-29", "earth_km", 2.2e6, "photos sent from 2.2 million km (Siddiqi)"),
               ("1965-10-23", "earth_km", 31.5e6, "session at 31.5 million km (Siddiqi)"),
               ("1966-03-03", "earth_km", 153.5e6, "last contact at 153.5 million km, early March 1966 (Siddiqi)")],
}


def days(iso):
    return (dt.datetime.fromisoformat(iso) - J2000).total_seconds() / 86400


def iso(d):
    t = J2000 + dt.timedelta(days=d)
    return t.strftime("%Y-%m-%dT%H:%M:%SZ") if (t.hour or t.minute or t.second) else t.strftime("%Y-%m-%d")


def horizons_state(cmd, t):
    """Heliocentric ecliptic J2000 position and velocity (AU, AU/day)."""
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f"{cmd}_{t.replace(':', '')}.json")
    if os.path.exists(path):
        r, v = json.load(open(path))
        return np.array(r), np.array(v)
    t2 = (dt.datetime.fromisoformat(t) + dt.timedelta(hours=1)).isoformat()
    url = ("https://ssd.jpl.nasa.gov/api/horizons.api?format=text&EPHEM_TYPE=VECTORS&CENTER=%27500@10%27"
           "&REF_PLANE=ECLIPTIC&OUT_UNITS=AU-D&VEC_TABLE=2&CSV_FORMAT=YES&TIME_TYPE=UT"
           f"&START_TIME=%27{t}%27&STOP_TIME=%27{t2}%27&STEP_SIZE=%271h%27&COMMAND=%27{cmd}%27")
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    text = urllib.request.urlopen(req, timeout=60).read().decode()
    row = text.split("$$SOE")[1].split("$$EOE")[0].strip().splitlines()[0].split(",")
    vals = [float(x) for x in row[2:8]]
    json.dump([vals[:3], vals[3:]], open(path, "w"))
    return np.array(vals[:3]), np.array(vals[3:])


def initial_state(cfg):
    body, t0 = cfg["start"]
    r0v, vb = horizons_state(body, t0)
    r0 = np.linalg.norm(r0v)
    q, Q = cfg["q"], cfg["Q"]
    if q is None:
        q = r0          # starts at perihelion
    if Q is None:
        Q = r0          # starts at aphelion
    if cfg.get("branch") is None:
        # tangential departure: the start point is an apsis
        q, Q = min(q, r0), max(Q, r0)
    a = (q + Q) / 2
    e = (Q - q) / (Q + q)
    h = math.sqrt(MU_SUN * a * (1 - e * e))
    v = math.sqrt(MU_SUN * (2 / r0 - 1 / a))
    vt = h / r0
    vr = math.sqrt(max(v * v - vt * vt, 0.0))
    if cfg.get("branch") == "inbound":
        vr = -vr
    elif cfg.get("branch") is None:
        vr = 0.0
    rhat = r0v / r0
    # orbit normal: ecliptic north tilted by inc about the start radius
    # (node at the start point), keeping the body's own sense of motion
    n_ecl = np.cross(r0v, vb)
    n_ecl /= np.linalg.norm(n_ecl)
    inc = math.radians(cfg["inc"])
    k = n_ecl * math.cos(inc) + np.cross(rhat, n_ecl) * math.sin(inc)
    that = np.cross(k, rhat)
    return days(t0), r0v, vt * that + vr * rhat, (q, Q, a, e)


def path(cfg):
    t0, r0, v0, shape = initial_state(cfg)
    t_end = days(cfg["end"])
    step = 2 * math.pi * math.sqrt(shape[2] ** 3 / MU_SUN) / LEGS_PER_ORBIT
    ts = [t0 + step * i for i in range(1, int((t_end - t0) // step) + 1)]
    if not ts or t_end - ts[-1] > 1:
        ts.append(t_end)
    return t0, r0, v0, shape, [(t, propagate(r0, v0, t - t0)) for t in ts]


def checks(key, t0, r0, v0):
    out = []
    for date, kind, want, label in CHECKS.get(key, []):
        r = propagate(r0, v0, days(date) - t0)
        re_, _ = horizons_state("399", date + "T00:00:00")
        if kind == "earth_km":
            got = np.linalg.norm(r - re_) * AU_KM
            out.append(f"    {date}  Earth distance {got / 1e6:.1f} million km (record: {want / 1e6:.1f})  -- {label}")
        else:
            c = r @ re_ / (np.linalg.norm(r) * np.linalg.norm(re_))
            got = math.degrees(math.acos(max(-1, min(1, c))))
            out.append(f"    {date}  Earth-Sun-craft angle {got:.0f} deg (record: {want})  -- {label}")
    return out


def write(key, cfg, t0, pts):
    p = os.path.join(ROOT, "data", "flights", key + ".json")
    raw = json.load(open(p, encoding="utf-8"))
    start_body = {"399": "Earth", "301": "Moon"}[cfg["start"][0]]
    legs = []
    prev, prev_t = start_body, iso(t0)
    for t, r in pts:
        fp = {"fixedPos": [round(float(c), 7) for c in r]}
        legs.append({"type": "lambert", "fromBody": prev, "toBody": fp,
                     "departDate": prev_t, "arrivalDate": iso(t), "estimate": True})
        prev, prev_t = fp, iso(t)
    raw["legs"] = legs
    text = json.dumps(raw, indent=2, ensure_ascii=False) + "\n"
    open(p, "w", encoding="utf-8").write(text)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--zond3", action="store_true", help="rerun the rejected Zond 3 test")
    ap.add_argument("keys", nargs="*")
    a = ap.parse_args()
    if a.zond3:
        for branch in ("outbound", "inbound"):
            t0, r0, v0, _ = initial_state(dict(ZOND3, branch=branch))
            print(f"zond 3, 0.9 x 1.56 AU, {branch}:")
            print("\n".join(checks("zond3_test", t0, r0, v0)))
        return
    for key in a.keys or FLIGHTS:
        cfg = FLIGHTS[key]
        t0, r0, v0, (q, Q, sa, e), pts = path(cfg)
        period = 2 * math.pi * math.sqrt(sa ** 3 / MU_SUN)
        print(f"{key}: q={q:.3f} Q={Q:.3f} AU, period {period:.1f} d (published {cfg['period_pub']}), "
              f"{len(pts)} waypoints to {cfg['end']}")
        for line in checks(key, t0, r0, v0):
            print(line)
        if not a.check:
            write(key, cfg, t0, pts)


if __name__ == "__main__":
    sys.exit(main())
