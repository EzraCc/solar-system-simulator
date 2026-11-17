#!/usr/bin/env python3
"""Fits OUTER_MOONS-style mean elements for a moon to JPL Horizons ephemeris,
in exactly the model app.js's computeSatelliteOffset evaluates:

    Om(t) = OmDeg0 - 360 * t / nodalPeriodDays      (t = days since J2000)
    w(t)  = wDeg0  + 360 * t / apsidalPeriodDays
    M(t)  = M0Deg  + 360 * t / periodSiderealDays
    Keplerian ellipse (aKm, e, iDeg) in the ecliptic J2000 frame, planet-centered.

Least-squares on planet-centered position over a span (default 1990-2040), so
the fit absorbs secular precession and the average effect of resonances.
Prints a ready-to-paste `elements: {...}` object and the residual (max/RMS
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


def levenberg_marquardt(resid, x, iters=60):
    """Small dense LM with a forward-difference Jacobian -- plain numpy, so it
    doesn't depend on scipy (whose build in tools/.venv silently returned the
    starting guess unchanged). e is clamped to [0, 0.2) after each step."""
    lam = 1e-3
    r = resid(x)
    cost = r @ r
    steps = np.array([1.0, 1e-6, 1e-5, 1e-5, 1e-9, 1e-4, 1e-7, 1e-5, 1e-9])
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
            xn[1] = min(max(xn[1], 0.0), 0.199)
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
    args = ap.parse_args()

    d = vectors(args.target, args.center, args.start, args.stop, args.step)
    t_all, P_all = d[:, 0], d[:, 1:]
    # Initial estimates from the first ~2000 samples only. Keep every numpy
    # array op small: the numpy 1.26 build in tools/.venv (which predates
    # Python 3.14) was verified on 2026-11-17 to return corrupted,
    # nondeterministic results for elementwise ops on ~49k-element arrays,
    # while identical work in 10k chunks is exact.
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
    # Plain closed-form linear regression (np.polyfit returned a flat line on
    # this numpy/Python-3.14 combination for these magnitudes).
    L = np.degrees(lon)
    tm, Lm = t.mean(), L.mean()
    n0 = float(((t - tm) * (L - Lm)).sum() / ((t - tm) ** 2).sum())
    u0 = float(Lm - n0 * tm)
    a0 = r.mean()

    print(f"# initial: a={a0:.0f} i={i0:.3f} Om={Om0:.2f} n={n0:.6f} deg/day")
    x0 = [a0, 0.005, i0, Om0, 0.0, 0.0, 0.0, u0 % 360, n0]
    # Random (not strided) subsample: a regular stride aliases against the
    # moon's period and lets the fit lock onto a wrong mean motion.
    sub = np.sort(np.random.default_rng(0).choice(len(t_all), size=min(6000, len(t_all)), replace=False))
    ts, Ps = t_all[sub], P_all[sub]
    best = levenberg_marquardt(lambda p: (model(p, ts) - Ps).ravel(), np.array(x0, dtype=float))
    a, e, i, OmD, Omrate, wD, wrate, M0, n = best
    t, P = t_all, P_all
    err = np.concatenate([np.linalg.norm(model(best, t[k:k + 8000]) - P[k:k + 8000], axis=1)
                          for k in range(0, len(t), 8000)])
    ang = np.degrees(err / a)

    el = {"aKm": round(a, 1), "e": round(e, 6), "iDeg": round(i, 5),
          "OmDeg0": round(OmD % 360, 5), "wDeg0": round(wD % 360, 5), "M0Deg": round(M0 % 360, 5),
          "periodSiderealDays": round(360 / n, 8)}
    if abs(Omrate) > 1e-9:
        el["nodalPeriodDays"] = round(360 / Omrate, 2)
    if abs(wrate) > 1e-9:
        el["apsidalPeriodDays"] = round(360 / wrate, 2)
    print(json.dumps(el))
    print(f"# fit {args.start}..{args.stop}, {len(t)} samples: max {err.max():,.0f} km "
          f"({ang.max():.3f} deg), rms {math.sqrt((err**2).mean()):,.0f} km ({math.sqrt((ang**2).mean()):.3f} deg)")


if __name__ == "__main__":
    main()
