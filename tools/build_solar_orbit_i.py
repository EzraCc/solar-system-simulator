#!/usr/bin/env python3
"""Builds an estimated heliocentric orbit for a craft with no trajectory data.

For early solar-orbit probes (Pioneer 9 here) the only published orbit is
its size and tilt: perihelion and aphelion distance, period, inclination.
The orientation and phase come from the launch: the craft starts at Earth's
position on the launch date, at the apside nearest Earth's distance (an
inward-bound probe like Pioneer 9 leaves Earth at aphelion), moving
prograde. The semi-major axis is set from the published period, so the
craft's place along the orbit doesn't drift from the period over the years;
the far apside is then 2a minus Earth's distance at launch. The
inclination (Pioneer 9: 0.086 deg, node unpublished) is too small to see and
is left out.

The result is written as Lambert legs between fixedPos waypoints, each
a tenth of the period long (--per-orbit) (ecliptic J2000 heliocentric AU, as in stereo_a.json), all
flagged "estimate": true so the app draws them dashed. Two-body motion only:
planetary perturbations over many years shift the real orbit somewhat,
which is part of why it's an estimate.

    python3 tools/build_solar_orbit_i.py pioneer_9 --launch 1968-11-08T09:46:29 \\
        --period 297.60 --end 1983-05-19 [--per-orbit 10]

Earth's position at launch comes from JPL Horizons (one query).
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
J2000 = dt.datetime(2000, 1, 1, 12)
GM = 2.959122082855911e-4  # Sun, AU^3/day^2 (k^2)


def earth_state(t):
    q = {"format": "text", "COMMAND": "'399'", "EPHEM_TYPE": "VECTORS", "CENTER": "'500@10'",
         "REF_PLANE": "ECLIPTIC", "REF_SYSTEM": "J2000", "OUT_UNITS": "AU-D", "VEC_TABLE": "2",
         "TLIST": f"'{t.strftime('%Y-%m-%d %H:%M:%S')}'", "TLIST_TYPE": "CAL", "CSV_FORMAT": "NO"}
    url = "https://ssd.jpl.nasa.gov/api/horizons.api?" + urllib.parse.urlencode(q)
    txt = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "solar-simulator/1.0"}),
                                 timeout=60).read().decode()
    blk = txt.split("$$SOE")[1].split("$$EOE")[0]
    nums = [float(x) for x in re.findall(r"[-+]?\d\.\d+E[-+]\d+", blk)]
    return nums[0:3], nums[3:6]


def kepler(M, e):
    E = M
    for _ in range(50):
        E -= (E - e * math.sin(E) - M) / (1 - e * math.cos(E))
    return E


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("key")
    ap.add_argument("--launch", required=True)
    ap.add_argument("--period", type=float, required=True, help="published period, days")
    ap.add_argument("--end", required=True)
    ap.add_argument("--per-orbit", type=int, default=10, help="legs per orbit (default 10)")
    a = ap.parse_args()

    t0 = dt.datetime.fromisoformat(a.launch)
    t_end = dt.datetime.fromisoformat(a.end)
    r_e, v_e = earth_state(t0)
    R = math.hypot(r_e[0], r_e[1])
    ang = math.atan2(r_e[1], r_e[0])
    sma = (GM * (a.period / (2 * math.pi)) ** 2) ** (1 / 3)
    inward = sma < R                       # starts at aphelion (inward probe) or perihelion
    far = 2 * sma - R
    e = abs(R - far) / (R + far)
    n = 2 * math.pi / a.period
    # perihelion direction: opposite Earth for an inward probe, along Earth otherwise
    w = ang + (math.pi if inward else 0.0)
    M0 = math.pi if inward else 0.0

    def pos(t):
        days = (t - t0).total_seconds() / 86400
        E = kepler(M0 + n * days, e)
        x = sma * (math.cos(E) - e)
        y = sma * math.sqrt(1 - e * e) * math.sin(E)
        return [x * math.cos(w) - y * math.sin(w), x * math.sin(w) + y * math.cos(w), 0.0]

    def iso(t):
        return t.strftime("%Y-%m-%dT%H:%M:%SZ") if (t.hour or t.minute or t.second) else t.strftime("%Y-%m-%d")

    # Legs are exactly period/N long, starting at launch, so the leg
    # boundaries fall on the same points of the (strictly periodic) orbit on
    # every loop. Each leg restarts the dash pattern, so this keeps the
    # dashes of the overlapping loops in step; with arbitrary boundaries the
    # loops' dashes fill each other's gaps and the path looks solid.
    step = a.period / a.per_orbit
    times, k = [], 0
    while True:
        t = t0 + dt.timedelta(days=k * step)
        if t >= t_end:
            break
        times.append(t.replace(microsecond=0))
        k += 1
    times.append(t_end)
    legs, prev = [], "Earth"
    for t1, t2 in zip(times, times[1:]):
        p = {"fixedPos": [round(c, 7) for c in pos(t2)]}
        legs.append({"type": "lambert", "fromBody": prev, "toBody": p,
                     "departDate": iso(t1), "arrivalDate": iso(t2), "estimate": True})
        prev = p

    path = os.path.join(ROOT, "data", "flights", a.key + ".json")
    raw = json.load(open(path, encoding="utf-8"))
    raw["legs"] = legs
    open(path, "w", encoding="utf-8").write(json.dumps(raw, indent=2, ensure_ascii=False) + "\n")
    q, Q = (far, R) if inward else (R, far)
    print(json.dumps({"key": a.key, "a_AU": round(sma, 5), "e": round(e, 5), "perihelion_AU": round(q, 4),
                      "aphelion_AU": round(Q, 4), "earth_r_AU": round(R, 5), "legs": len(legs)}))


if __name__ == "__main__":
    main()
