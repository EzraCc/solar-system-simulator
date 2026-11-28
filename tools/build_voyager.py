#!/usr/bin/env python3
"""Builds the legs of the craft that leave the Solar System view -- Voyager 1
and 2 (Horizons -31, -32) and Pioneer 10 and 11 (-23, -24) -- from JPL Horizons.

Heliocentric path: Lambert legs between real Horizons positions
(ecliptic J2000, Sun-centred, fixedPos waypoints as in stereo_a.json).
Waypoints are placed by walking daily Horizons samples and dropping one
whenever the craft has swept --max-sweep degrees around the Sun or
--max-days days since the last, plus extra waypoints close to each planet
encounter (a heliocentric Lambert arc ignores the planet's pull, so the
pieces are kept short there).

Planet tours: for each (primary, start, stop) in TOURS the heliocentric
path stops at the craft's real position at `start`, the tour's
planetocentric legs follow (built by
`tools/build_planet_tour.py <flight> --primary P --start S --stop E
--flyby-km 250000 --max-days 1 --legs-out tools/.cache/voyager/<file>`),
and the heliocentric path resumes from the real position at `stop`.
Encounters without a tour yet (Voyager 2 at Uranus and Neptune, until
those system views exist) get dense heliocentric waypoints instead.

The path ends where the craft passes CUTOFF_AU = 1.1 x Pluto's aphelion
(Pluto's elements in app.js SMALL_BODIES.pluto: a = 39.5886 AU,
e = 0.25184, aphelion 49.558 AU, so 54.514 AU). Past that it is out of the
Solar System view; the heliosphere layer carries it on (heliospherePath,
tools/build_heliosphere_path.py; docs/outer-missions-plan.md section 1).

A craft whose contact ended before the cutoff (Pioneer 11, last contact
1995-09-30) gets a waypoint at its last contact; every leg after it is
flagged "estimate": true and drawn dashed, since Horizons past the last
tracking is a projection.

    python3 tools/build_voyager.py            # rewrite every flight's "legs"
    python3 tools/build_voyager.py pioneer_11 # just one
    python3 tools/build_voyager.py --report   # just print the plan
"""
import argparse
import datetime as dt
import json
import math
import os
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CACHE = os.path.join(HERE, ".cache", "voyager")
HZ = "https://ssd.jpl.nasa.gov/api/horizons.api"

PLUTO_A, PLUTO_E = 39.58862938517124, 0.2518378778576892  # app.js SMALL_BODIES.pluto
CUTOFF_AU = 1.1 * PLUTO_A * (1 + PLUTO_E)

CRAFT = {
    "voyager_1": {
        "id": "-31",
        "launch": "1977-09-05T12:56:01Z",   # Siddiqi, Beyond Earth; NSSDCA 1977-084A
        "tours": [("Jupiter", "1979-03-02", "1979-03-09", "v1_jupiter.json"),
                  ("Saturn", "1980-11-10", "1980-11-15", "v1_saturn.json")],
        "encounters": [],
    },
    "voyager_2": {
        "id": "-32",
        "launch": "1977-08-20T14:29:44Z",   # Siddiqi, Beyond Earth; NSSDCA 1977-076A
        "tours": [("Jupiter", "1979-07-06", "1979-07-13", "v2_jupiter.json"),
                  ("Saturn", "1981-08-22", "1981-08-29", "v2_saturn.json"),
                  ("Uranus", "1986-01-21", "1986-01-28", "v2_uranus.json"),
                  ("Neptune", "1989-08-22", "1989-08-29", "v2_neptune.json")],
        "encounters": [],
    },
    "pioneer_10": {
        "id": "-23",
        "launch": "1972-03-03T01:49:04Z",   # Horizons header 01:49:00; Siddiqi 01:49:04 (printed as 2 March, the US date)
        "tours": [("Jupiter", "1973-12-01", "1973-12-08", "p10_jupiter.json")],
        "encounters": [],
        "end_guess": "1995-01-01",
    },
    "pioneer_11": {
        "id": "-24",
        "launch": "1973-04-06T02:11:00Z",   # Horizons header; Siddiqi 02:11 UT
        "tours": [("Jupiter", "1974-11-30", "1974-12-06", "p11_jupiter.json"),
                  ("Saturn", "1979-08-29", "1979-09-04", "p11_saturn.json")],
        "encounters": [],
        "end_guess": "2005-01-01",
        # Last routine contact (NASA Ames; Siddiqi, Beyond Earth; Horizons header:
        # "Science operations and daily telemetry ceased on September 30, 1995").
        "last_contact": "1995-09-30T00:00:00",
    },
}
ENC_OFFSETS = [0.25, 0.5, 1, 2, 4, 8, 16]      # days either side of an encounter / tour edge


def parse(s):
    s = s.rstrip("Z")
    return dt.datetime.fromisoformat(s) if "T" in s else dt.datetime.fromisoformat(s + "T00:00:00")


def iso(t):
    return t.strftime("%Y-%m-%dT%H:%M:%SZ") if (t.hour or t.minute or t.second) else t.strftime("%Y-%m-%d")


def horizons(target, start, stop, step):
    os.makedirs(CACHE, exist_ok=True)
    key = f"{target}_{start}_{stop}_{step}".replace(":", "").replace(" ", "_")
    path = os.path.join(CACHE, key + ".txt")
    if not os.path.exists(path):
        p = {"format": "text", "COMMAND": f"'{target}'", "EPHEM_TYPE": "VECTORS", "CENTER": "'500@10'",
             "REF_PLANE": "ECLIPTIC", "REF_SYSTEM": "J2000", "VEC_TABLE": "1", "OUT_UNITS": "AU-D",
             "CSV_FORMAT": "YES", "OBJ_DATA": "NO", "TIME_TYPE": "UT",
             "START_TIME": f"'{start}'", "STOP_TIME": f"'{stop}'", "STEP_SIZE": f"'{step}'"}
        text = urllib.request.urlopen(HZ + "?" + urllib.parse.urlencode(p), timeout=180).read().decode()
        if "$$SOE" not in text:
            raise RuntimeError(text[-800:])
        open(path, "w").write(text)
    text = open(path).read()
    out = []
    for row in text.split("$$SOE")[1].split("$$EOE")[0].strip().splitlines():
        c = [x.strip() for x in row.split(",")]
        t = dt.datetime.strptime(c[1].replace("A.D. ", "").split(".")[0], "%Y-%b-%d %H:%M:%S")
        out.append((t, [float(c[2]), float(c[3]), float(c[4])]))
    return out


def at(target, t):
    s = t.strftime("%Y-%m-%d %H:%M")
    e = (t + dt.timedelta(minutes=1)).strftime("%Y-%m-%d %H:%M")
    return horizons(target, s, e, "1m")[0][1]


def norm(v):
    return math.sqrt(sum(c * c for c in v))


def angle(a, b):
    c = sum(x * y for x, y in zip(a, b)) / (norm(a) * norm(b))
    return math.degrees(math.acos(max(-1.0, min(1.0, c))))


def build(key, cfg, max_sweep, max_days):
    launch = parse(cfg["launch"])
    t0 = (launch + dt.timedelta(days=1)).replace(hour=0, minute=0, second=0)
    end_guess = parse(cfg.get("end_guess", "1999-01-01"))
    daily = horizons(cfg["id"], t0.strftime("%Y-%m-%d"), end_guess.strftime("%Y-%m-%d"), "1d")
    # cutoff crossing: first daily sample beyond CUTOFF_AU, refined hourly
    k = next(i for i, (_, p) in enumerate(daily) if norm(p) >= CUTOFF_AU)
    hourly = horizons(cfg["id"], daily[k - 1][0].strftime("%Y-%m-%d %H:%M"), daily[k][0].strftime("%Y-%m-%d %H:%M"), "1h")
    t_cut, p_cut = next((t, p) for t, p in hourly if norm(p) >= CUTOFF_AU)
    daily = [s for s in daily if s[0] < t_cut]

    tours = [(prim, parse(s), parse(e), f) for prim, s, e, f in cfg["tours"]]
    forced = set()
    for _, s, e, _ in tours:
        for d in ENC_OFFSETS:
            forced.add(s - dt.timedelta(days=d))
            forced.add(e + dt.timedelta(days=d))
    last_contact = parse(cfg["last_contact"]) if cfg.get("last_contact") else None
    if last_contact:
        forced.add(last_contact)
    for enc in cfg["encounters"]:
        c = parse(enc)
        forced.add(c)
        for d in ENC_OFFSETS:
            forced.add(c - dt.timedelta(days=d))
            forced.add(c + dt.timedelta(days=d))

    def in_tour(t):
        return any(s < t < e for _, s, e, _ in tours)

    # candidate samples: daily plus forced times (exact Horizons positions)
    samples = {t: p for t, p in daily if not in_tour(t)}
    for t in forced:
        if t0 <= t < t_cut and not in_tour(t):
            samples[t] = at(cfg["id"], t)
    for _, s, e, _ in tours:
        samples[s] = at(cfg["id"], s)
        samples[e] = at(cfg["id"], e)
    times = sorted(samples)

    # walk: keep forced times, tour edges, and sweep/day-limited daily points
    keep = []
    edges = {s for _, s, _, _ in tours} | {e for _, _, e, _ in tours}
    last_t, last_p = None, None
    for t in times:
        p = samples[t]
        must = t in forced or t in edges
        if last_t is None or must or (t - last_t).total_seconds() / 86400 >= max_days or angle(p, last_p) >= max_sweep:
            keep.append(t)
            last_t, last_p = t, p
    keep.append(t_cut)
    samples[t_cut] = p_cut

    legs = []
    prev_body, prev_t = "Earth", launch
    tour_iter = iter(tours)
    next_tour = next(tour_iter, None)
    for t in keep:
        if t <= prev_t:
            continue  # a tour's end time is already the current position
        if next_tour and t > next_tour[1]:
            raise RuntimeError("waypoint inside tour")
        fp = {"fixedPos": [round(c, 7) for c in samples[t]]}
        leg = {"type": "lambert", "fromBody": prev_body, "toBody": fp,
               "departDate": iso(prev_t), "arrivalDate": iso(t)}
        if last_contact and prev_t >= last_contact:
            leg["estimate"] = True
        legs.append(leg)
        prev_body, prev_t = fp, t
        if next_tour and t == next_tour[1]:
            prim, s, e, f = next_tour
            tl = json.load(open(os.path.join(CACHE, f)))
            assert tl[0]["departDate"] == iso(s) and tl[-1]["arrivalDate"] in (iso(e), e.strftime("%Y-%m-%dT%H:%M:%SZ")), (tl[0]["departDate"], tl[-1]["arrivalDate"])
            legs.extend(tl)
            prev_body = {"fixedPos": [round(c, 7) for c in samples[e]]}
            prev_t = e
            next_tour = next(tour_iter, None)
    # drop waypoints that fall inside a tour window (between s and e) -- none expected
    legs[0]["_comment"] = (
        f"Heliocentric path built {dt.date.today().isoformat()} by tools/build_voyager.py from JPL Horizons "
        f"(target {cfg['id']}): Lambert legs between real positions; planet tours spliced in; ends where the craft "
        f"passes {CUTOFF_AU:.3f} AU (1.1 x Pluto's aphelion), the edge of the Solar System view for now.")
    if last_contact:
        first_est = next(l for l in legs if l.get("estimate"))
        first_est["_comment"] = (f"Contact ended {iso(last_contact)}: from here the path is Horizons' projection "
                                 f"with no tracking behind it, drawn dashed.")
    legs[-1]["_comment"] = (f"{iso(t_cut)}: crosses {CUTOFF_AU:.3f} AU from the Sun (Horizons, hourly); the "
                            f"Solar System view stops the path here, and the heliosphere layer carries it on.")
    return legs, t_cut, norm(p_cut)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("keys", nargs="*", help="flights to build (default: all)")
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--max-sweep", type=float, default=8.0)
    ap.add_argument("--max-days", type=float, default=45.0)
    a = ap.parse_args()
    print(f"cutoff {CUTOFF_AU:.4f} AU (Pluto aphelion {PLUTO_A * (1 + PLUTO_E):.4f} AU)")
    for key, cfg in CRAFT.items():
        if a.keys and key not in a.keys:
            continue
        legs, t_cut, r_cut = build(key, cfg, a.max_sweep, a.max_days)
        n_pc = sum(1 for l in legs if l["type"] == "planetocentric")
        print(f"{key}: {len(legs)} legs ({n_pc} planetocentric), crosses cutoff {iso(t_cut)} at {r_cut:.4f} AU")
        if a.report:
            continue
        path = os.path.join(ROOT, "data", "flights", key + ".json")
        src = open(path, encoding="utf-8").read()
        data = json.loads(src)
        data["legs"] = legs
        open(path, "w", encoding="utf-8").write(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
        print(f"  wrote {path}")


if __name__ == "__main__":
    main()
