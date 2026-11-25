#!/usr/bin/env python3
"""Builds a flight's `planetOrbit` block -- fitted orbit phases around a planet
-- from JPL Horizons, for orbiters whose orbits are too many and too short to
draw arc by arc the way tools/build_planet_tour.py does (a Mars orbiter makes
~12 revolutions a day for decades).

Each phase is one time window with mean elements in exactly the model app.js's
computeSatelliteOffset evaluates (the same one the moons use), with t measured
from the phase's own epochDays:

    Om(t) = OmDeg0 - 360 t / nodalPeriodDays
    w(t)  = wDeg0  + 360 t / apsidalPeriodDays
    M(t)  = M0Deg  + 360 t / periodSiderealDays
    Keplerian ellipse (aKm, e, iDeg), ecliptic J2000, planet-centered.

How:
  1. Finds orbit capture: the first time near the given arrival date when the
     spacecraft's energy relative to the planet goes negative.
  2. Walks capture -> stop in windows (default 30 days). For each window it
     fetches ~600 Horizons samples at a step deliberately incommensurate with
     the orbital period, then least-squares fits the 9 parameters, growing the
     fit span from a few revolutions to the whole window so the mean motion
     can't slip a revolution.
  3. If the fit's worst position error exceeds max(--tol-km, --tol-frac * a),
     the window is halved (down to --min-days) -- aerobraking and maneuvers
     end up in short windows automatically.

Needs numpy (tools/.venv). Horizons responses are cached in tools/.horizons_cache/.

    tools/.venv/bin/python3 tools/build_orbit_phases.py mro --primary Mars \\
        --arrival 2006-03-10 --stop 2026-11-17 --dry-run
"""

import argparse
import datetime as dt
import hashlib
import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(HERE)
CACHE_DIR = os.path.join(HERE, ".horizons_cache")
HZ = "https://ssd.jpl.nasa.gov/api/horizons.api"
J2000_JD = 2451545.0

PRIMARIES = {  # Horizons center, GM km^3/s^2, mean radius km
    "Mercury": ("199", 22031.868551, 2439.4),
    "Venus": ("299", 324858.592, 6051.8),
    "Mars": ("499", 42828.375816, 3389.5),
    "Jupiter": ("599", 126686531.9, 69911),
    "Saturn": ("699", 37931206.23, 58232),
    "Pluto": ("999", 869.6, 1188.3),
}


def hz_get(params):
    key = hashlib.sha1(json.dumps(params, sort_keys=True).encode()).hexdigest()
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, "orb_" + key + ".txt")
    if os.path.exists(path):
        return open(path).read()
    last = None
    for _ in range(5):
        try:
            with urllib.request.urlopen(HZ + "?" + urllib.parse.urlencode(params), timeout=180) as r:
                text = r.read().decode()
            break
        except Exception as e:  # noqa: BLE001 -- retry any transport error
            last = e
            time.sleep(10 * (_ + 1))  # Horizons answers 503 when busy
    else:
        raise last
    if "$$SOE" in text:
        open(path, "w").write(text)
    return text


def jd_str(jd):
    return f"JD{jd:.6f}"


def states(target, center, jd0, jd1, step):
    """(N,7) array: t (days since J2000, TDB), x,y,z km, vx,vy,vz km/s."""
    text = hz_get({"format": "text", "COMMAND": f"'{target}'", "EPHEM_TYPE": "VECTORS",
                   "CENTER": f"'500@{center}'", "START_TIME": f"'{jd_str(jd0)}'",
                   "STOP_TIME": f"'{jd_str(jd1)}'", "STEP_SIZE": f"'{step}'", "CSV_FORMAT": "YES",
                   "OUT_UNITS": "KM-S", "OBJ_DATA": "NO", "VEC_TABLE": "2",
                   "REF_PLANE": "ECLIPTIC", "REF_SYSTEM": "J2000"})
    if "$$SOE" not in text:
        raise RuntimeError(f"Horizons: no data for {target} {jd0}..{jd1}:\n{text[-600:]}")
    rows = []
    for line in text.split("$$SOE")[1].split("$$EOE")[0].strip().splitlines():
        p = [x.strip() for x in line.split(",")]
        rows.append([float(p[0]) - J2000_JD] + [float(v) for v in p[2:8]])
    return np.array(rows)


def osculating(r, v, gm):
    """a, e, i, Om, w, M (deg) from a state (km, km/s)."""
    h = np.cross(r, v)
    rn, vn = np.linalg.norm(r), np.linalg.norm(v)
    a = 1 / (2 / rn - vn * vn / gm)
    ev = np.cross(v, h) / gm - r / rn
    e = np.linalg.norm(ev)
    i = math.degrees(math.acos(h[2] / np.linalg.norm(h)))
    nvec = np.array([-h[1], h[0], 0.0])
    nn = np.linalg.norm(nvec)
    Om = math.degrees(math.atan2(nvec[1], nvec[0])) if nn > 1e-9 else 0.0
    if nn > 1e-9 and e > 1e-7:
        w = math.degrees(math.acos(max(-1, min(1, np.dot(nvec, ev) / (nn * e)))))
        if ev[2] < 0:
            w = 360 - w
    else:
        w = 0.0
    if e > 1e-7:
        nu = math.acos(max(-1, min(1, np.dot(ev, r) / (e * rn))))
        if np.dot(r, v) < 0:
            nu = 2 * math.pi - nu
    else:  # circular: measure from the node (or x axis)
        ref = nvec / nn if nn > 1e-9 else np.array([1.0, 0, 0])
        nu = math.acos(max(-1, min(1, np.dot(ref, r) / rn)))
        if r[2] < 0:
            nu = 2 * math.pi - nu
    E = 2 * math.atan2(math.sqrt(1 - e) * math.sin(nu / 2), math.sqrt(1 + e) * math.cos(nu / 2))
    M = math.degrees(E - e * math.sin(E))
    return a, e, i, Om % 360, w % 360, M % 360


def model(p, t):
    a, e, i, Om0, Omr, w0, wr, M0, n = p
    e = min(max(e, 0.0), 0.999)
    Om = np.radians(Om0 - Omr * t)
    w = np.radians(w0 + wr * t)
    M = np.radians(M0 + n * t)
    E = M.copy()
    for _ in range(30):
        E = E - (E - e * np.sin(E) - M) / (1 - e * np.cos(E))
    nu = 2 * np.arctan2(np.sqrt(1 + e) * np.sin(E / 2), np.sqrt(1 - e) * np.cos(E / 2))
    r = a * (1 - e * np.cos(E))
    x, y = r * np.cos(nu), r * np.sin(nu)
    cw, sw, ci, si, cO, sO = np.cos(w), np.sin(w), np.cos(np.radians(i)), np.sin(np.radians(i)), np.cos(Om), np.sin(Om)
    xw, yw = x * cw - y * sw, x * sw + y * cw
    xi, yi, zi = xw, yw * ci, yw * si
    return np.stack([xi * cO - yi * sO, xi * sO + yi * cO, zi], axis=1)


def from_hk(q):
    """[a, k, h, i, Om0, Omr, L0, wr, n] -> model params; k = e cos w0,
    h = e sin w0, L0 = M0 + w0 (smooth through e = 0)."""
    a, k, h, i, Om0, Omr, L0, wr, n = q
    e = math.hypot(k, h)
    w0 = math.degrees(math.atan2(h, k))
    return np.array([a, e, i, Om0, Omr, w0, wr, L0 - w0, n])


def to_hk(p):
    a, e, i, Om0, Omr, w0, wr, M0, n = p
    return np.array([a, e * math.cos(math.radians(w0)), e * math.sin(math.radians(w0)), i, Om0, Omr,
                     M0 + w0, wr, n], dtype=float)


def lm(t, pos, p, iters=80):
    """Levenberg-Marquardt on the hk form; takes and returns model params."""
    p = to_hk(p)
    lam = 1e-3

    def res(q):
        return (model(from_hk(q), t) - pos).ravel()

    r = res(p)
    cost = r @ r
    scale = np.array([1e-7, 1e-7, 1e-7, 1e-6, 1e-6, 1e-6, 1e-6, 1e-6, 1e-8])
    for _ in range(iters):
        J = np.empty((r.size, 9))
        for k in range(9):
            d = np.zeros(9)
            d[k] = scale[k] * max(1.0, abs(p[k]))
            J[:, k] = (res(p + d) - r) / d[k]
        A = J.T @ J
        g = J.T @ r
        improved = False
        for _ in range(12):
            try:
                step = np.linalg.solve(A + lam * np.diag(np.diag(A) + 1e-12), -g)
            except np.linalg.LinAlgError:
                lam *= 10
                continue
            q = p + step
            rq = res(q)
            cq = rq @ rq
            if cq < cost:
                p, r, cost = q, rq, cq
                lam = max(lam / 3, 1e-9)
                improved = True
                break
            lam *= 4
        if not improved or np.abs(step).max() < 1e-12:
            break
    p = from_hk(p)
    return p, np.sqrt(((model(p, t) - pos) ** 2).sum(axis=1))


def incommensurate_step_minutes(period_days, span_days, n_samples):
    """Integer-minute step near span/n_samples whose ratio to the orbital
    period has a fractional part near the golden ratio (no aliasing)."""
    target = span_days * 1440 / n_samples
    P = period_days * 1440
    best, best_score = max(1, round(target)), 1e9
    for s in range(max(1, int(target * 0.7)), int(target * 1.3) + 2):
        f = (s / P) % 1.0
        score = abs(f - 0.618) + abs(s - target) / target * 0.2
        if score < best_score:
            best, best_score = s, score
    return best


def fit_window(sc, center, gm, jd0, jd1, tol_km, tol_frac, n_samples):
    st0 = states(sc, center, jd0, jd0 + 1 / 1440, "1")[0]
    a0, e0, i0, Om0, w0, M0 = osculating(st0[1:4], st0[4:7], gm)
    if a0 <= 0:
        return None, None, "unbound"
    P = 2 * math.pi * math.sqrt(a0 ** 3 / gm) / 86400
    step = incommensurate_step_minutes(P, jd1 - jd0, n_samples)
    data = states(sc, center, jd0, jd1, f"{step} m")
    t = data[:, 0] - (jd0 - J2000_JD)
    pos = data[:, 1:4]
    p = [a0, e0, i0, Om0, 0.0, w0, 0.0, M0, 360 / P]
    # Grow the fit span: a few revolutions first, so the mean motion locks.
    span = jd1 - jd0
    for frac_span in (min(span, 4 * P), min(span, 20 * P), min(span, 100 * P), span):
        sel = t <= frac_span + 1e-9
        if sel.sum() < 15:
            continue
        p, err = lm(t[sel], pos[sel], p)
    p, err = lm(t, pos, p)
    tol = max(tol_km, tol_frac * p[0])
    return p, err, ("ok" if err.max() <= tol else f"err {err.max():.0f} km > {tol:.0f}")


def find_capture(sc, center, gm, arrival_jd):
    data = states(sc, center, arrival_jd - 6, arrival_jd + 10, "30 m")
    for row in data:
        r = np.linalg.norm(row[1:4])
        v = np.linalg.norm(row[4:7])
        if v * v / 2 - gm / r < 0:
            return row[0] + J2000_JD
    raise RuntimeError("no capture found within -6..+10 days of arrival")


# TT - UTC (s) = 32.184 + leap seconds; TDB ~= TT. Horizons vector times are
# TDB, the app's clock is UTC: a phase's epoch is shifted by this so the app,
# evaluating at UTC, lands on the same point (69 s is ~3 deg of a 2-h orbit).
LEAP_SECONDS = [  # (UTC JD from which it applies, TAI-UTC)
    (2451179.5, 32), (2453736.5, 33), (2454832.5, 34), (2456109.5, 35), (2457204.5, 36), (2457754.5, 37)]


def tt_minus_utc_days(jd):
    leaps = 32
    for start, n in LEAP_SECONDS:
        if jd >= start:
            leaps = n
    return (32.184 + leaps) / 86400


def iso(jd):
    d = dt.datetime(2000, 1, 1, 12) + dt.timedelta(days=jd - J2000_JD)
    return d.strftime("%Y-%m-%dT%H:%M:%SZ")


def to_jd(s):
    d = dt.datetime.fromisoformat(s.replace("Z", ""))
    return J2000_JD + (d - dt.datetime(2000, 1, 1, 12)).total_seconds() / 86400


def dump_flight(data, ascii_only=False):
    """json.dumps(indent=2), but with each planetOrbit phase on one line: a
    long orbiter has thousands of phases and every flight file loads at
    startup, so this keeps the file about half the size and diffs readable."""
    phases = (data.get("planetOrbit") or {}).get("phases")
    if not phases:
        return json.dumps(data, indent=2, ensure_ascii=ascii_only)
    marks = [f"@@PHASE{i}@@" for i in range(len(phases))]
    data = dict(data, planetOrbit=dict(data["planetOrbit"], phases=marks))
    out = json.dumps(data, indent=2, ensure_ascii=ascii_only)
    for m, ph in zip(marks, phases):
        out = out.replace(json.dumps(m), json.dumps(ph, ensure_ascii=ascii_only), 1)
    return out


def old_fit_date(block):
    m = re.search(r"fitted (\d{4}-\d{2}-\d{2})", block.get("_comment", ""))
    return m.group(1) if m else "earlier"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("flight")
    ap.add_argument("--primary", required=True)
    ap.add_argument("--arrival", help="approximate arrival (UTC); capture is found near it")
    ap.add_argument("--start", help="explicit phase start (UTC), skips capture search")
    ap.add_argument("--stop", required=True, help="end of the modeled orbit (UTC)")
    ap.add_argument("--window-days", type=float, default=30)
    ap.add_argument("--min-days", type=float, default=0.25)
    ap.add_argument("--tol-km", type=float, default=30)
    ap.add_argument("--tol-frac", type=float, default=0.01)
    ap.add_argument("--samples", type=int, default=600)
    ap.add_argument("--note", default="", help="extra text for the block's _comment")
    ap.add_argument("--append", action="store_true",
                    help="keep the flight's existing phases and fit only from the last phase's end to --stop")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    with open(os.path.join(HERE, "horizons_ids.json")) as f:
        sc = json.load(f)[args.flight]["id"]
    center, gm, radius = PRIMARIES[args.primary]
    path = os.path.join(REPO_ROOT, "data", "flights", args.flight + ".json")
    existing = []
    if args.append:
        with open(path) as f:
            old = json.load(f).get("planetOrbit") or {}
        existing = old.get("phases", [])
        if not existing:
            sys.exit("--append: flight has no planetOrbit phases to extend")
        # Phase ends are stored in UTC; the fit runs in TDB.
        last_end = to_jd(existing[-1]["end"].rstrip("Z").replace("T", " "))
        jd_start = last_end + tt_minus_utc_days(last_end)
    elif args.start:
        jd_start = to_jd(args.start)
    else:
        jd_start = find_capture(sc, center, gm, to_jd(args.arrival))
    jd_stop = to_jd(args.stop)
    print(f"{args.flight}: orbit {iso(jd_start)} -> {iso(jd_stop)}", flush=True)

    phases, worst = [], 0.0
    jd = jd_start
    while jd < jd_stop - 1e-6:
        w = min(args.window_days, jd_stop - jd)
        while True:
            p, err, status = fit_window(sc, center, gm, jd, jd + w, args.tol_km, args.tol_frac, args.samples)
            if status == "ok" or w <= args.min_days:
                break
            w = max(args.min_days, w / 2)
        if p is None:
            print(f"  {iso(jd)}: {status}; skipping {w:g} d", flush=True)
            jd += w
            continue
        a, e, i, Om0, Omr, w0, wr, M0, n = p
        phases.append({
            "start": iso(jd - tt_minus_utc_days(jd)), "end": iso(jd + w - tt_minus_utc_days(jd + w)),
            "epochDays": round(jd - tt_minus_utc_days(jd) - J2000_JD, 8),
            "elements": {
                "aKm": round(a, 2), "e": round(min(max(e, 0), 0.999), 6), "iDeg": round(i, 4),
                "OmDeg0": round(Om0 % 360, 4), "wDeg0": round(w0 % 360, 4), "M0Deg": round(M0 % 360, 4),
                "periodSiderealDays": float(f"{360 / n:.10g}"),
                "nodalPeriodDays": float(f"{360 / Omr:.6g}") if abs(Omr) > 1e-9 else 0,
                "apsidalPeriodDays": float(f"{360 / wr:.6g}") if abs(wr) > 1e-9 else 0,
            },
        })
        worst = max(worst, float(err.max()))
        flag = "" if status == "ok" else f"  ({status})"
        print(f"  {iso(jd)[:16]} +{w:6.2f} d  a={a:9.1f} e={e:.4f} i={i:6.2f}  max err {err.max():7.1f} km{flag}",
              flush=True)
        jd += w

    print(f"{args.flight}: {len(phases)} phases, worst fit error {worst:,.0f} km")
    if args.append:
        old_worst = 0.0
        m = re.search(r"worst position error ([\d,]+) km", old.get("_comment", ""))
        if m:
            old_worst = float(m.group(1).replace(",", ""))
        worst = max(worst, old_worst)
        phases = existing + phases
        if not args.note:  # keep the old block's own notes
            m = re.search(r"worst position error [\d,]+ km\.\s*(.*)$", old.get("_comment", ""), re.S)
            args.note = m.group(1) if m else ""
    block = {
        "primaryBody": args.primary,
        "timeScale": "UTC",
        "_comment": (f"Orbit phases fitted {dt.date.today().isoformat() if not args.append else old_fit_date(old)}"
                     f"{f' and extended {dt.date.today().isoformat()}' if args.append else ''} by tools/build_orbit_phases.py to JPL "
                     f"Horizons (target {sc}, center {center}): mean elements per window, worst position error "
                     f"{worst:,.0f} km. {args.note}").strip(),
        "phases": phases,
    }
    if args.dry_run:
        return 0
    src = open(path).read()
    data = json.loads(src)
    data["planetOrbit"] = block
    out = dump_flight(data, ascii_only=("\\u" in src)) + ("\n" if src.endswith("\n") else "")
    open(path, "w").write(out)
    print(f"wrote {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
