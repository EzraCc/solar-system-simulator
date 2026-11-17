#!/usr/bin/env python3
"""Builds a planetocentric tour from a PUBLISHED FLYBY SCHEDULE (dates +
target moons) when no ephemeris exists -- e.g. JUICE, whose JPL Horizons
trajectory stops at Jupiter orbit insertion. Companion to
build_planet_tour.py, which uses real/predicted ephemeris instead.

Physics, anchored to events:
  * Each leg between consecutive flybys is a Keplerian conic around the
    primary through the two moons' positions (the app's own moon model, so
    endpoints land exactly on the moons as drawn) in the scheduled time.
  * Weeks-to-months gaps often contain several orbits, so every leg is
    solved for 0..N revolutions (both branches) with hapsira's Izzo
    multi-revolution Lambert solver.
  * Which candidate is real is chosen by flyby physics: an unpowered
    gravity assist conserves the spacecraft's speed relative to the moon
    (|v_inf| in = |v_inf| out) and can only bend the path by a limited angle
    for the given flyby altitude. A dynamic program picks the sequence of
    candidates minimizing the total v_inf mismatch and excess bend.
  * The chosen conics are written as `planetocentric` legs through relPos
    waypoints every <= --max-sweep degrees (pure Keplerian, so the app's
    zero-revolution pieces reproduce the multi-rev conic exactly).

Schedule dates carry no time of day, so each flyby is placed at 00:00 UTC
on its date: the spacecraft still meets the moon as drawn, but the clock
time of each encounter can be off by up to a day, and the v_inf matching
is correspondingly approximate. Report per-flyby mismatch is printed.

    tools/.venv/bin/python3 tools/build_tour_from_flybys.py tools/tours/juice_crema52.json --dry-run
    tools/.venv/bin/python3 tools/build_tour_from_flybys.py tools/tours/juice_crema52.json
"""

import argparse
import datetime as dt
import json
import math
import os
import re
import sys

import numpy as np
from hapsira.core.iod import izzo

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(HERE)
APP_JS = os.path.join(REPO_ROOT, "src", "js", "app.js")
AU_KM = 149597870.7
D2R = math.pi / 180
J2000 = dt.datetime(2000, 1, 1, 12, 0, 0)

PRIMARY = {"Jupiter": {"gm": 1.26686534e8, "radius": 69911.0}}
MOON_GM = {"Io": 5959.9, "Europa": 3202.7, "Ganymede": 9887.8, "Callisto": 7179.3}
MOON_R = {"Io": 1821.6, "Europa": 1560.8, "Ganymede": 2634.1, "Callisto": 2410.3}


def load_moon_elements(primary):
    """Parse OUTER_MOONS[primary] element objects out of app.js, so this tool
    uses exactly the moon positions the app draws."""
    src = open(APP_JS).read()
    block = src[src.index("const OUTER_MOONS = {"):]
    block = block[block.index(primary + ": ["):]
    block = block[:block.index("],")]
    out = {}
    for m in re.finditer(r"\{ name: '(\w+)',\s+elements: \{([^}]*)\}", block):
        el = {}
        for kv in m.group(2).split(","):
            if ":" in kv:
                k, v = kv.split(":")
                el[k.strip()] = float(v)
        out[m.group(1)] = el
    return out


def moon_pos_km(el, t):
    """Mirror of app.js computeSatelliteOffset (km, primary-centered)."""
    Om = (el["OmDeg0"] - 360 * t / el["nodalPeriodDays"]) * D2R if el.get("nodalPeriodDays") else el["OmDeg0"] * D2R
    w = (el["wDeg0"] + 360 * t / el["apsidalPeriodDays"]) * D2R if el.get("apsidalPeriodDays") else el["wDeg0"] * D2R
    n = 2 * math.pi / el["periodSiderealDays"]
    M = el["M0Deg"] * D2R + n * t
    e = el["e"]
    E = M
    for _ in range(30):
        E = E - (E - e * math.sin(E) - M) / (1 - e * math.cos(E))
    nu = 2 * math.atan2(math.sqrt(1 + e) * math.sin(E / 2), math.sqrt(1 - e) * math.cos(E / 2))
    r = el["aKm"] * (1 - e * math.cos(E))
    x, y = r * math.cos(nu), r * math.sin(nu)
    i = el["iDeg"] * D2R
    xw = x * math.cos(w) - y * math.sin(w)
    yw = x * math.sin(w) + y * math.cos(w)
    yi, zi = yw * math.cos(i), yw * math.sin(i)
    return np.array([xw * math.cos(Om) - yi * math.sin(Om), xw * math.sin(Om) + yi * math.cos(Om), zi])


def moon_vel_kms(el, t):
    h = 30.0 / 86400
    return (moon_pos_km(el, t + h) - moon_pos_km(el, t - h)) / (2 * h * 86400)


def elements_from_state(r, v, mu):
    h = np.cross(r, v)
    rn, vn = np.linalg.norm(r), np.linalg.norm(v)
    energy = vn * vn / 2 - mu / rn
    a = -mu / (2 * energy)
    evec = np.cross(v, h) / mu - r / rn
    return a, np.linalg.norm(evec)


def kepler_propagate(r0, v0, mu, dtsec):
    """Universal-variable propagation (Vallado), returns r at t0+dt."""
    r0n = np.linalg.norm(r0)
    vr0 = np.dot(r0, v0) / r0n
    alpha = 2 / r0n - np.dot(v0, v0) / mu
    chi = math.sqrt(mu) * abs(alpha) * dtsec
    for _ in range(80):
        z = alpha * chi * chi
        if z > 1e-8:
            C, S = (1 - math.cos(math.sqrt(z))) / z, (math.sqrt(z) - math.sin(math.sqrt(z))) / z ** 1.5
        elif z < -1e-8:
            C, S = (math.cosh(math.sqrt(-z)) - 1) / (-z), (math.sinh(math.sqrt(-z)) - math.sqrt(-z)) / (-z) ** 1.5
        else:
            C, S = 0.5, 1 / 6
        F = r0n * vr0 / math.sqrt(mu) * chi * chi * C + (1 - alpha * r0n) * chi ** 3 * S + r0n * chi - math.sqrt(mu) * dtsec
        dF = r0n * vr0 / math.sqrt(mu) * chi * (1 - alpha * chi * chi * S) + (1 - alpha * r0n) * chi * chi * C + r0n
        step = F / dF
        chi -= step
        if abs(step) < 1e-9:
            break
    z = alpha * chi * chi
    if z > 1e-8:
        C, S = (1 - math.cos(math.sqrt(z))) / z, (math.sqrt(z) - math.sin(math.sqrt(z))) / z ** 1.5
    elif z < -1e-8:
        C, S = (math.cosh(math.sqrt(-z)) - 1) / (-z), (math.sinh(math.sqrt(-z)) - math.sqrt(-z)) / (-z) ** 1.5
    else:
        C, S = 0.5, 1 / 6
    f = 1 - chi * chi / r0n * C
    g = dtsec - chi ** 3 / math.sqrt(mu) * S
    return f * r0 + g * v0


def t_of(d):
    return (d - J2000).total_seconds() / 86400


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("schedule")
    ap.add_argument("--max-revs", type=int, default=14)
    ap.add_argument("--min-peri-rp", type=float, default=3.0, help="minimum periapsis, primary radii")
    ap.add_argument("--max-sweep", type=float, default=60.0)
    ap.add_argument("--min-vinf", type=float, default=1.5, help="km/s; slower 'flybys' are penalized")
    ap.add_argument("--sweeps", type=int, default=4)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    sched = json.load(open(args.schedule))
    primary = sched["primary"]
    mu, Rp = PRIMARY[primary]["gm"], PRIMARY[primary]["radius"]
    moons = load_moon_elements(primary)
    ev = sched["events"]
    times = [dt.datetime.fromisoformat(e["date"]) for e in ev]
    ts = [t_of(d) for d in times]
    R = [moon_pos_km(moons[e["moon"]], t) for e, t in zip(ev, ts)]
    V = [moon_vel_kms(moons[e["moon"]], t) for e, t in zip(ev, ts)]

    def solve_leg(k, M, low, t_a, t_b):
        ra, rb = moon_pos_km(moons[ev[k]["moon"]], t_a), moon_pos_km(moons[ev[k + 1]["moon"]], t_b)
        tof = (t_b - t_a) * 86400
        if tof <= 0:
            return None
        try:
            v1, v2 = izzo(mu, ra, rb, tof, M, True, low, 60, 1e-9)
        except Exception:
            return None
        v1, v2 = np.array(v1), np.array(v2)
        a, e = elements_from_state(ra, v1, mu)
        if not (a > 0 and e < 1) or a * (1 - e) < args.min_peri_rp * Rp:
            return None
        return {"M": M, "low": low, "v1": v1, "v2": v2, "a": a, "e": e, "ra": ra}

    def candidates(k, t_a, t_b):
        out = []
        for M in range(0, args.max_revs + 1):
            for low in ((True,) if M == 0 else (True, False)):
                c = solve_leg(k, M, low, t_a, t_b)
                if c:
                    out.append(c)
        return out

    # Flyby cost at event k between arriving leg k-1 and departing leg k.
    def flyby_cost(k, cin, cout, tk):
        moon = ev[k]["moon"]
        Vm = moon_vel_kms(moons[moon], tk)
        vin, vout = cin["v2"] - Vm, cout["v1"] - Vm
        a_, b_ = np.linalg.norm(vin), np.linalg.norm(vout)
        vinf = (a_ + b_) / 2
        rp = MOON_R[moon] + max(ev[k]["closestApproachKm"], 0)
        dmax = 2 * math.asin(1 / (1 + rp * vinf * vinf / MOON_GM[moon]))
        bend = math.acos(max(-1, min(1, np.dot(vin, vout) / (a_ * b_))))
        excess = max(0.0, bend - dmax) * vinf
        slow = max(0.0, args.min_vinf - vinf)   # co-orbiting "flybys" aren't real gravity assists
        return (a_ - b_) ** 2 + excess ** 2 + 10 * slow ** 2, a_ - b_, math.degrees(bend), math.degrees(dmax)

    def dp(ts):
        cands = [candidates(k, ts[k], ts[k + 1]) for k in range(len(ev) - 1)]
        for k, c in enumerate(cands):
            if not c:
                return None, None, float("inf")
        best = [[(0.0, None) for _ in cands[0]]]
        for k in range(1, len(cands)):
            row = []
            for cout in cands[k]:
                row.append(min((best[k - 1][i][0] + flyby_cost(k, cin, cout, ts[k])[0], i)
                               for i, cin in enumerate(cands[k - 1])))
            best.append(row)
        j = min(range(len(best[-1])), key=lambda x: best[-1][x][0])
        total = best[-1][j][0]
        choice = [0] * len(cands)
        for k in range(len(cands) - 1, -1, -1):
            choice[k] = j
            j = best[k][j][1] if best[k][j][1] is not None else 0
        return [cands[k][choice[k]] for k in range(len(cands))], cands, total

    # Alternate: (1) choose revolution counts for the current flyby times
    # (dynamic program), (2) move each flyby's time of day within its date
    # (the schedule gives no times) to reduce the local mismatch, keeping each
    # leg's revolution count/branch. Repeat.
    ts = list(ts)
    chosen, _, total = dp(ts)
    if chosen is None:
        sys.exit("no feasible conic for some leg at 00:00 flyby times")
    grid = [h / 24 for h in range(0, 24)]
    for sweep in range(args.sweeps):
        for k in range(1, len(ev)):
            day0 = t_of(times[k])
            best_t, best_c = ts[k], None
            for frac in grid:
                tk = day0 + frac
                legs_new = {}
                ok = True
                for kk in (k - 1, k):
                    if kk < 0 or kk >= len(chosen):
                        continue
                    c = chosen[kk]
                    ta = tk if kk == k else ts[kk]
                    tb = tk if kk == k - 1 else ts[kk + 1]
                    sol = solve_leg(kk, c["M"], c["low"], ta, tb)
                    if not sol:
                        ok = False
                        break
                    legs_new[kk] = sol
                if not ok:
                    continue
                trial = dict(enumerate(chosen))
                trial.update(legs_new)
                tt = list(ts)
                tt[k] = tk
                cost = 0.0
                for q in (k - 1, k, k + 1):
                    if 1 <= q < len(chosen):
                        cost += flyby_cost(q, trial[q - 1], trial[q], tt[q])[0]
                if best_c is None or cost < best_c:
                    best_c, best_t, best_legs = cost, tk, legs_new
            ts[k] = best_t
            for kk, sol in best_legs.items():
                chosen[kk] = sol
        chosen, _, total = dp(ts)
        print(f"  sweep {sweep + 1}: total cost {total:.2f}")
    times = [J2000 + dt.timedelta(days=t) for t in ts]
    times = [d.replace(microsecond=0) for d in times]
    R = [moon_pos_km(moons[e["moon"]], t) for e, t in zip(ev, ts)]

    print(f"{sched['flight']}: {len(chosen)} flyby-to-flyby legs")
    for k, c in enumerate(chosen):
        period = 2 * math.pi * math.sqrt(c["a"] ** 3 / mu) / 86400
        line = (f"  {ev[k]['name']:>5s} -> {ev[k + 1]['name']:<5s} {times[k]:%Y-%m-%d %H:%M} -> {times[k + 1]:%m-%d %H:%M}  "
                f"revs {c['M']}{'' if c['M'] == 0 else ('L' if c['low'] else 'H')}  P={period:6.1f} d  "
                f"rp={c['a'] * (1 - c['e']) / Rp:5.1f} RJ  ra={c['a'] * (1 + c['e']) / Rp:6.1f} RJ")
        if k + 1 < len(chosen):
            _, dv, bend, dmax = flyby_cost(k + 1, c, chosen[k + 1], ts[k + 1])
            line += f"   | at {ev[k + 1]['name']}: |vinf| mismatch {dv:+.2f} km/s, bend {bend:.0f}/{dmax:.0f} deg"
        print(line)
    if args.dry_run:
        return 0

    # Sample each conic into <= max_sweep pieces.
    def iso(d):
        return d.strftime("%Y-%m-%dT%H:%M:%SZ")

    legs = []
    for k, c in enumerate(chosen):
        t0, t1 = times[k], times[k + 1]
        tof = (t1 - t0).total_seconds()
        N = max(200, int(tof / 1800))
        samples = [(tof * s / N, kepler_propagate(R[k], c["v1"], mu, tof * s / N)) for s in range(1, N)]
        rr = [np.linalg.norm(p) for _, p in samples]
        peri_idx = {q for q in range(1, len(rr) - 1) if rr[q] < rr[q - 1] and rr[q] <= rr[q + 1]}
        pts = [(0.0, R[k], None)]
        acc, prev = 0.0, R[k]
        for q, (tt, p) in enumerate(samples):
            acc += math.degrees(math.acos(max(-1, min(1, np.dot(prev, p) / (np.linalg.norm(prev) * np.linalg.norm(p))))))
            prev = p
            if (tof - tt) <= 3600:
                continue
            if q in peri_idx:
                pts.append((tt, p, rr[q]))
                acc = 0.0
            elif acc >= args.max_sweep:
                pts.append((tt, p, None))
                acc = 0.0
        nodes = [{"moon": ev[k]["moon"], "offsetKm": [0, 0, 0]}] + \
                [{"relPos": [round(float(x), 1) for x in p]} for _, p, _ in pts[1:]] + \
                [{"moon": ev[k + 1]["moon"], "offsetKm": [0, 0, 0]}]
        when = [t0] + [t0 + dt.timedelta(seconds=round(tt)) for tt, _, _ in pts[1:]] + [t1]
        peri_at = [None] + [rp for _, _, rp in pts[1:]] + [None]
        for q in range(len(nodes) - 1):
            leg = {"type": "planetocentric", "primaryBody": primary, "fromBody": nodes[q], "toBody": nodes[q + 1],
                   "departDate": iso(when[q]), "arrivalDate": iso(when[q + 1])}
            if peri_at[q + 1] is not None:
                leg["periapsisAltKm"] = round(peri_at[q + 1] - Rp)
            if q == len(nodes) - 2:
                leg["flybyAltKm"] = ev[k + 1]["closestApproachKm"]
                leg["flybyName"] = ev[k + 1]["name"]
            legs.append(leg)
    legs[0]["departDate"] = ev[0]["date"]  # tour starts at the heliocentric arrival date
    legs[0]["_comment"] = (
        f"{primary} tour built {dt.date.today().isoformat()} by tools/build_tour_from_flybys.py from a PUBLISHED "
        f"FLYBY SCHEDULE ({os.path.basename(args.schedule)}; {sched['_source']}), not ephemeris: one Keplerian conic "
        f"per flyby-to-flyby leg through the moons' modeled positions at 00:00 UTC on each flyby date, revolution "
        f"count chosen by gravity-assist physics (|v_inf| conserved, bend within the altitude limit), sampled into "
        f"<= {args.max_sweep:g} deg pieces. Encounter clock times are approximate (dates only in the source).")
    path = os.path.join(REPO_ROOT, "data", "flights", sched["flight"] + ".json")
    src = open(path).read()
    data = json.loads(src)
    data["legs"] = [l for l in data["legs"] if l.get("type") != "planetocentric"] + legs
    open(path, "w").write(json.dumps(data, indent=2, ensure_ascii=("\\u" in src)) + ("\n" if src.endswith("\n") else ""))
    print(f"wrote {path} ({len(legs)} planetocentric legs)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
