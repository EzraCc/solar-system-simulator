#!/usr/bin/env python3
"""Builds Helios 1 and Helios 2 trajectory legs from NASA SPDF data.

JPL Horizons has no Helios ephemeris. NASA's Space Physics Data Facility
(SPDF) keeps the mission's own daily orbit files:

  https://spdf.gsfc.nasa.gov/pub/data/helios/helios1/traj/day/helorb1.asc
  https://spdf.gsfc.nasa.gov/pub/data/helios/helios2/traj/day/helorb2.asc
  format: https://spdf.gsfc.nasa.gov/pub/data/helios/helios1/traj/day/helorb.txt

Each row gives the Helios–Sun distance (AU), ecliptic longitude "from the
Mean Equinox" and ecliptic latitude (degrees). The equinox is B1950: the
file's longitude of Earth at each launch is 0.70 deg less than Horizons'
J2000 value (77.52 vs 78.22 on 1974-12-10; 113.87 vs 114.57 on
1976-01-15), which is exactly the 1950-to-2000 precession. Conversion:

  B1950 ecliptic (lon, lat, r) -> B1950 equatorial (rotate by the B1950
  obliquity, 23.4457889 deg) -> J2000 equatorial (standard FK4->FK5
  rotation matrix; the E-terms of aberration, ~0.3", don't apply to these
  heliocentric positions) -> J2000 ecliptic (rotate by 23.4392911 deg).

Legs: a Lambert leg from Earth at launch to the first waypoint, then
Lambert legs between real positions every --step days (fixedPos waypoints,
ecliptic J2000 heliocentric AU, as in stereo_a.json). Helios coasted on a
pure two-body solar orbit, so a Lambert arc between two real positions
reproduces the path between them.

Helios 1's file ends 1981-09-30, but contact lasted until 1986-02-10. For
that stretch the orbit is fitted (6 Keplerian state parameters, least
squares on the last two orbits of data) and propagated forward; those
legs carry "estimate": true and are drawn dashed (no data behind them).

Usage:
  tools/.venv/bin/python tools/build_helios.py            # writes both flights' legs
  tools/.venv/bin/python tools/build_helios.py --check    # report fit/accuracy only
"""
import argparse
import datetime as dt
import json
import math
import os
import urllib.request

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CACHE = os.path.join(HERE, ".helios_cache")
UA = "solar-sim-helios-build/1.0 (educational)"
SRC = {
    1: "https://spdf.gsfc.nasa.gov/pub/data/helios/helios1/traj/day/helorb1.asc",
    2: "https://spdf.gsfc.nasa.gov/pub/data/helios/helios2/traj/day/helorb2.asc",
}
MU_SUN = 2.9591220828559115e-4  # AU^3 / day^2
J2000 = dt.datetime(2000, 1, 1, 12)

EPS_B1950 = math.radians(23.4457889)
EPS_J2000 = math.radians(23.4392911)
FK4_TO_FK5 = np.array([
    [0.9999256782, -0.0111820611, -0.0048579477],
    [0.0111820610, 0.9999374784, -0.0000271765],
    [0.0048579479, -0.0000271474, 0.9999881997],
])


def rot_x(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


# ecliptic(B1950) -> equatorial(B1950) -> equatorial(J2000) -> ecliptic(J2000)
B1950_ECL_TO_J2000_ECL = rot_x(-EPS_J2000) @ FK4_TO_FK5 @ rot_x(EPS_B1950)


def fetch(url):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, os.path.basename(url))
    if not os.path.exists(path):
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=60) as r, open(path, "wb") as f:
            f.write(r.read())
    return open(path).read()


def load(n):
    """[(days since J2000, xyz J2000 ecliptic AU)] from the SPDF daily file."""
    out = []
    for line in fetch(SRC[n]).splitlines():
        p = line.split()
        if len(p) < 12:
            continue
        yy, mo, dd, hh, mi, ss = map(int, p[1:7])
        t = dt.datetime(1900 + yy, mo, dd, hh, mi, ss)
        r, lon, lat = float(p[7]), math.radians(float(p[10])), math.radians(float(p[12]))
        v = r * np.array([math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat)])
        out.append(((t - J2000).total_seconds() / 86400, B1950_ECL_TO_J2000_ECL @ v))
    return out


# --- two-body propagation (universal variables) ---------------------------

def stumpff(z):
    if z > 1e-8:
        s = math.sqrt(z)
        return (1 - math.cos(s)) / z, (s - math.sin(s)) / (s ** 3)
    if z < -1e-8:
        s = math.sqrt(-z)
        return (math.cosh(s) - 1) / (-z), (math.sinh(s) - s) / (s ** 3)
    return 0.5, 1 / 6


def propagate(r0, v0, dt_days):
    r0n = np.linalg.norm(r0)
    vr0 = r0 @ v0 / r0n
    alpha = 2 / r0n - v0 @ v0 / MU_SUN
    sq = math.sqrt(MU_SUN)
    x = sq * abs(alpha) * dt_days if alpha > 0 else sq * dt_days / r0n
    for _ in range(60):
        z = alpha * x * x
        C, S = stumpff(z)
        F = r0n * vr0 / sq * x * x * C + (1 - alpha * r0n) * x ** 3 * S + r0n * x - sq * dt_days
        dF = r0n * vr0 / sq * x * (1 - alpha * x * x * S) + (1 - alpha * r0n) * x * x * C + r0n
        step = F / dF
        x -= step
        if abs(step) < 1e-12:
            break
    z = alpha * x * x
    C, S = stumpff(z)
    f = 1 - x * x / r0n * C
    g = dt_days - x ** 3 / sq * S
    return f * r0 + g * v0


def fit_state(samples, t0):
    """Least-squares (r, v) at t0 that best reproduces the samples."""
    near = min(samples, key=lambda s: abs(s[0] - t0))
    i = samples.index(near)
    v = (samples[i + 1][1] - samples[i - 1][1]) / (samples[i + 1][0] - samples[i - 1][0])
    x = np.concatenate([near[1], v])
    t0 = near[0]
    for _ in range(15):
        res, J = [], []
        base = [propagate(x[:3], x[3:], t - t0) for t, _ in samples]
        for (t, p), b in zip(samples, base):
            res.extend(p - b)
        for k in range(6):
            dx = np.zeros(6)
            dx[k] = 1e-7 if k < 3 else 1e-9
            pert = [propagate((x + dx)[:3], (x + dx)[3:], t - t0) for t, _ in samples]
            J.append(np.concatenate([(q - b) / dx[k] for q, b in zip(pert, base)]))
        J = np.array(J).T
        delta = np.linalg.lstsq(J, np.array(res), rcond=None)[0]
        x = x + delta
        if np.linalg.norm(delta) < 1e-12:
            break
    rms = math.sqrt(np.mean(np.array(res) ** 2))
    return t0, x, rms


def iso(days):
    t = J2000 + dt.timedelta(days=days)
    return t.strftime("%Y-%m-%dT%H:%M:%SZ") if (t.hour or t.minute) else t.strftime("%Y-%m-%d")


# Launch times (UTC). The orbit files start shortly after launch, so their
# first row is not the launch time. Helios 1: NASA, "50 Years Ago: Launch of
# Helios 1" (2:11 a.m. EST) and Siddiqi, Beyond Earth (07:11:02 UT, misprinted
# there as 10 November). Helios 2: Siddiqi, Beyond Earth (05:34:00 UT).
LAUNCH = {1: "1974-12-10T07:11:02Z", 2: "1976-01-15T05:34:00Z"}


def build(n, step, end_contact):
    data = load(n)
    legs = []
    picks = [data[0]] + data[step::step]
    if picks[-1] is not data[-1]:
        picks.append(data[-1])
    prev_body = "Earth"
    for t, p in picks[1:]:
        legs.append({"type": "lambert", "fromBody": prev_body,
                     "toBody": {"fixedPos": [round(float(c), 7) for c in p]},
                     "departDate": iso(picks[picks.index((t, p)) - 1][0]) if legs else LAUNCH[n],
                     "arrivalDate": iso(t)})
        prev_body = {"fixedPos": [round(float(c), 7) for c in p]}
    info = {"data_start": iso(data[0][0]), "data_end": iso(data[-1][0]), "n": len(data)}
    if end_contact:
        t_end = (dt.datetime.fromisoformat(end_contact) - J2000).total_seconds() / 86400
        last = data[-1][0]
        span = [s for s in data if s[0] >= last - 380]
        t0, x, rms = fit_state(span, span[len(span) // 2][0])
        info["fit_rms_au"] = rms
        # Check: back-propagate over the previous orbits to see the drift.
        older = [s for s in data if last - 1200 <= s[0] < last - 380]
        info["backcheck_max_au"] = max(np.linalg.norm(propagate(x[:3], x[3:], t - t0) - p) for t, p in older)
        # Legs a tenth of the fitted period long, so the projected laps line
        # up and their dashes coincide instead of filling each other's gaps.
        rr, vv = np.linalg.norm(x[:3]), np.linalg.norm(x[3:])
        sma = 1 / (2 / rr - vv * vv / MU_SUN)
        est_step = 2 * math.pi * math.sqrt(sma ** 3 / MU_SUN) / 10
        t = last
        while t < t_end - 1e-6:
            t1 = min(t + est_step, t_end)
            p = propagate(x[:3], x[3:], t1 - t0)
            legs.append({"type": "lambert", "fromBody": prev_body,
                         "toBody": {"fixedPos": [round(float(c), 7) for c in p]},
                         "departDate": iso(t), "arrivalDate": iso(t1), "estimate": True})
            prev_body = {"fixedPos": [round(float(c), 7) for c in p]}
            t = t1
        info["estimate_end"] = iso(t_end)
    return legs, data, info


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--step", type=int, default=15, help="days between waypoints")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--out", default=os.path.join(HERE, ".helios_cache"))
    args = ap.parse_args()
    for n, end_contact in ((1, "1986-02-10"), (2, None)):
        legs, data, info = build(n, args.step, end_contact)
        dmin = min(data, key=lambda s: np.linalg.norm(s[1]))
        info["perihelion_min"] = (iso(dmin[0]), round(float(np.linalg.norm(dmin[1])), 5))
        info["legs"] = len(legs)
        print(f"Helios {n}:", json.dumps(info))
        if not args.check:
            os.makedirs(args.out, exist_ok=True)
            with open(os.path.join(args.out, f"helios{n}_legs.json"), "w") as f:
                json.dump(legs, f, indent=2)


if __name__ == "__main__":
    main()
