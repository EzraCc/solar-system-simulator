#!/usr/bin/env python3
"""Fits OUTER_MOONS-style mean elements for a moon to JPL Horizons ephemeris,
in exactly the model app.js's computeSatelliteOffset evaluates:

    Om(t) = OmDeg0 - 360 * t / nodalPeriodDays      (t = days since J2000)
    w(t)  = wDeg0  + 360 * t / apsidalPeriodDays
    M(t)  = M0Deg  + 360 * t / periodSiderealDays
    Keplerian ellipse (aKm, e, iDeg) in the ecliptic J2000 frame, planet-centered.

Least-squares on planet-centered position over a span (default 1990-2040), so
the fit absorbs secular precession and the average effect of resonances.
M0 is shifted from Horizons' TDB to the app's UTC clock. Prints a ready-to-paste `elements: {...}` object and the residual (max/RMS
position error in km and degrees of orbital longitude).

Needs numpy only (tools/.venv has it):

    tools/.venv/bin/python3 tools/fit_moon_elements.py 501 599       # Io about Jupiter
    tools/.venv/bin/python3 tools/fit_moon_elements.py 503 599 --start 1995-01-01 --stop 2036-01-01
"""

import argparse
import json
import math
import urllib.parse
import urllib.request

import numpy as np

HZ = "https://ssd.jpl.nasa.gov/api/horizons.api"
J2000_JD = 2451545.0


def horizons(params):
    with urllib.request.urlopen(HZ + "?" + urllib.parse.urlencode(params), timeout=180) as r:
        return r.read().decode()


def vectors(target, center, start, stop, step):
    t = horizons({"format": "text", "COMMAND": f"'{target}'", "EPHEM_TYPE": "VECTORS",
                  "CENTER": f"'500@{center}'", "START_TIME": f"'{start}'", "STOP_TIME": f"'{stop}'",
                  "STEP_SIZE": f"'{step}'", "CSV_FORMAT": "YES", "OUT_UNITS": "KM-S", "OBJ_DATA": "NO",
                  "VEC_TABLE": "1", "REF_PLANE": "ECLIPTIC", "REF_SYSTEM": "J2000"})
    rows = []
    for line in t.split("$$SOE")[1].split("$$EOE")[0].strip().splitlines():
        p = [x.strip() for x in line.split(",")]
        rows.append([float(p[0]) - J2000_JD, float(p[2]), float(p[3]), float(p[4])])
    return np.array(rows)


def model(params, t):
    a, e, i, Om0, Omrate, w0, wrate, M0, n = params
    Om = np.radians(Om0 - Omrate * t)
    w = np.radians(w0 + wrate * t)
    M = np.radians(M0 + n * t)
    E = M.copy()
    for _ in range(12):
        E = E - (E - e * np.sin(E) - M) / (1 - e * np.cos(E))
    nu = 2 * np.arctan2(np.sqrt(1 + e) * np.sin(E / 2), np.sqrt(1 - e) * np.cos(E / 2))
    r = a * (1 - e * np.cos(E))
    x, y = r * np.cos(nu), r * np.sin(nu)
    ci, si = math.cos(math.radians(i)), math.sin(math.radians(i))
    xw = x * np.cos(w) - y * np.sin(w)
    yw = x * np.sin(w) + y * np.cos(w)
    yi, zi = yw * ci, yw * si
    X = xw * np.cos(Om) - yi * np.sin(Om)
    Y = xw * np.sin(Om) + yi * np.cos(Om)
    return np.stack([X, Y, zi], axis=1)


def pole_basis(ra_deg, dec_deg):
    """Rows X, Y, Z (ecliptic J2000 components): Z = pole, X = its equator's
    ascending node on the ecliptic. Must match app.js refPoleBasis()."""
    ra, dec, eps = math.radians(ra_deg), math.radians(dec_deg), math.radians(23.4392911)
    xq, yq, zq = math.cos(dec) * math.cos(ra), math.cos(dec) * math.sin(ra), math.sin(dec)
    p = np.array([xq, yq * math.cos(eps) + zq * math.sin(eps), -yq * math.sin(eps) + zq * math.cos(eps)])
    X = np.array([-p[1], p[0], 0.0]) / math.hypot(p[0], p[1])
    return np.array([X, np.cross(p, X), p])


def from_hk(q):
    """Fit vector [a, k, h, i, Om0, Omrate, L0, wrate, n] -> model params.
    k = e cos w0, h = e sin w0, L0 = M0 + w0: smooth through e = 0, where
    fitting e and w directly gets stuck (Titan's e=0.029 came out 0)."""
    a, k, h, i, Om0, Omr, L0, wr, n = q
    e = math.hypot(k, h)
    w0 = math.degrees(math.atan2(h, k))
    return np.array([a, e, i, Om0, Omr, w0, wr, L0 - w0, n])


def to_hk(p):
    a, e, i, Om0, Omr, w0, wr, M0, n = p
    return np.array([a, e * math.cos(math.radians(w0)), e * math.sin(math.radians(w0)), i, Om0, Omr,
                     M0 + w0, wr, n], dtype=float)


def levenberg_marquardt(resid, x, iters=60):
    """Small dense LM with a forward-difference Jacobian in plain numpy (written
    when the old tools/.venv scipy silently returned its starting guess; kept
    since it works and has no scipy dependency). Works on the to_hk vector."""
    lam = 1e-3
    r = resid(x)
    cost = r @ r
    steps = np.array([1.0, 1e-6, 1e-6, 1e-5, 1e-5, 1e-9, 1e-5, 1e-7, 1e-9])
    for _ in range(iters):
        J = np.empty((r.size, x.size))
        for k in range(x.size):
            xk = x.copy()
            xk[k] += steps[k]
            J[:, k] = (resid(xk) - r) / steps[k]
        A = J.T @ J
        g = J.T @ r
        improved = False
        for _ in range(12):
            dx = np.linalg.solve(A + lam * np.diag(np.diag(A)), -g)
            xn = x + dx
            rn = resid(xn)
            cn = rn @ rn
            if cn < cost:
                x, r, cost, lam, improved = xn, rn, cn, max(lam / 3, 1e-12), True
                break
            lam *= 4
        if not improved or abs(dx).max() < 1e-12:
            break
    return x


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("target")
    ap.add_argument("center")
    ap.add_argument("--start", default="1990-01-01")
    ap.add_argument("--stop", default="2040-01-01")
    ap.add_argument("--step", default="533 m", help="Horizons step (default 533 min ~ 0.37 d, deliberately incommensurate with the moons)")
    ap.add_argument("--pole", nargs=2, type=float, metavar=("RA", "DEC"),
                    help="fit in the frame of this pole (ICRF RA/Dec deg, e.g. the planet's equator) "
                         "instead of the ecliptic; output carries refPoleRaDec")
    ap.add_argument("--nodal-guess", type=float, help="starting nodalPeriodDays (fast precessors like Phobos)")
    ap.add_argument("--apsidal-guess", type=float, help="starting apsidalPeriodDays")
    args = ap.parse_args()

    d = vectors(args.target, args.center, args.start, args.stop, args.step)
    t_all, P_all = d[:, 0], d[:, 1:]
    if args.pole:
        B = pole_basis(*args.pole)
        P_all = P_all @ B.T   # ecliptic -> pole frame (rows of B are the frame axes)
    # Initial estimates from the first ~2000 samples (plenty for pole, node
    # and a starting mean motion; the fit itself then uses the whole span).
    # Arrays are also kept small/chunked because an older tools/.venv numpy
    # (1.26 on Python 3.14) corrupted large-array results; fixed by the
    # 2026-11-17 venv rebuild, but harmless to keep.
    t, P = t_all[:2000], P_all[:2000]
    r = np.linalg.norm(P, axis=1)

    # Orbit pole -> inclination and node (mean over span).
    h = np.cross(P[:-1], P[1:]).mean(axis=0)
    h /= np.linalg.norm(h)
    i0 = math.degrees(math.acos(h[2]))
    Om0 = math.degrees(math.atan2(h[0], -h[1])) % 360
    # Mean motion from unwrapped in-plane longitude.
    node = np.array([math.cos(math.radians(Om0)), math.sin(math.radians(Om0)), 0])
    q = np.cross(h, node)
    raw = np.arctan2(P @ q, P @ node)
    steps = (np.diff(raw) + np.pi) % (2 * np.pi) - np.pi   # needs < 180 deg per sample step
    lon = np.concatenate([[raw[0]], raw[0] + np.cumsum(steps)])
    # Plain closed-form linear regression (np.polyfit returned a flat line
    # under the old numpy 1.26 venv; kept for robustness).
    L = np.degrees(lon)
    tm, Lm = t.mean(), L.mean()
    n0 = float(((t - tm) * (L - Lm)).sum() / ((t - tm) ** 2).sum())
    u0 = float(Lm - n0 * tm)
    a0 = r.mean()

    print(f"# initial: a={a0:.0f} i={i0:.3f} Om={Om0:.2f} n={n0:.6f} deg/day")
    Omr0 = 360 / args.nodal_guess if args.nodal_guess else 0.0
    wr0 = 360 / args.apsidal_guess if args.apsidal_guess else 0.0
    # The measured longitude rate n0 is node + perigee + mean-anomaly rate
    # (node rate is -Omr0 in this model), so the mean anomaly gets the rest.
    x0 = [a0, 0.005, i0, Om0, Omr0, 0.0, wr0, u0 % 360, n0 - wr0 + Omr0]
    # Random (not strided) subsample: a regular stride aliases against the
    # moon's period and lets the fit lock onto a wrong mean motion.
    sub = np.sort(np.random.default_rng(0).choice(len(t_all), size=min(6000, len(t_all)), replace=False))
    ts, Ps = t_all[sub], P_all[sub]
    best = from_hk(levenberg_marquardt(lambda q: (model(from_hk(q), ts) - Ps).ravel(), to_hk(x0)))
    a, e, i, OmD, Omrate, wD, wrate, M0, n = best
    t, P = t_all, P_all
    err = np.concatenate([np.linalg.norm(model(best, t[k:k + 8000]) - P[k:k + 8000], axis=1)
                          for k in range(0, len(t), 8000)])
    ang = np.degrees(err / a)

    # Horizons times are TDB; the app's clock is UTC. Shift M0 by the mean
    # motion over TT-UTC at mid-span (~64-69 s; leap seconds through 2017).
    mid_jd = J2000_JD + (t_all[0] + t_all[-1]) / 2
    leaps = 32 + sum(mid_jd >= j for j in (2453736.5, 2454832.5, 2456109.5, 2457204.5, 2457754.5))
    M0_utc = M0 + n * (32.184 + leaps) / 86400
    el = {"aKm": round(a, 1), "e": round(e, 6), "iDeg": round(i, 5),
          "OmDeg0": round(OmD % 360, 5), "wDeg0": round(wD % 360, 5), "M0Deg": round(M0_utc % 360, 5),
          "periodSiderealDays": round(360 / n, 8)}
    if args.pole:
        el["refPoleRaDec"] = [args.pole[0], args.pole[1]]
    if abs(Omrate) > 1e-9:
        el["nodalPeriodDays"] = round(360 / Omrate, 2)
    if abs(wrate) > 1e-9:
        el["apsidalPeriodDays"] = round(360 / wrate, 2)
    print(json.dumps(el))
    print(f"# fit {args.start}..{args.stop}, {len(t)} samples: max {err.max():,.0f} km "
          f"({ang.max():.3f} deg), rms {math.sqrt((err**2).mean()):,.0f} km ({math.sqrt((ang**2).mean()):.3f} deg)")


if __name__ == "__main__":
    main()
