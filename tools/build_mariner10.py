#!/usr/bin/env python3
"""Builds Mariner 10's trajectory legs (Earth -> Venus -> Mercury x3).

JPL Horizons has no Mariner 10 ephemeris, so the path is calculated from
the published encounter times (Siddiqi, Beyond Earth, NASA SP-2018-4041;
NASA NSSDCA record 1973-085A):

  launch       1973-11-03 05:45 UT
  Venus        1974-02-05 17:01 UT, 5,768 km altitude (gravity assist)
  Mercury I    1974-03-29 20:47 UT, 703 km
  Mercury II   1974-09-21 20:59 UT, 48,069 km
  Mercury III  1975-03-16 22:39 UT, 327 km

Earth->Venus and Venus->Mercury are ordinary single-revolution Lambert
legs the app solves itself. After Mercury I, Mariner 10 was on a
176-day solar orbit (two Mercury years), so each Mercury->Mercury leg is
one full lap around the Sun. The app's Lambert solver is zero-revolution
only, so (as for Giotto) each lap is solved here as a one-revolution
Lambert transfer between Mercury's positions at the two flybys, then
propagated (two-body) and split into sub-orbit arcs at fixedPos
waypoints that the app can draw.

A one-revolution transfer has two solutions. The flyby can turn the
spacecraft's velocity relative to Mercury but not change its size, so
the solution whose Mercury-relative speed best matches the incoming one
is used; the turn angle then implies a flyby distance, reported against
the published one as a check.

Mercury and Venus positions come from the app itself (headless Chrome,
window.__VERIFY__.getBodyPositionAtDays), so the waypoints line up with
the planets as drawn. All legs carry "estimate": true (drawn dashed).

    tools/.venv/bin/python tools/build_mariner10.py           # write legs
    tools/.venv/bin/python tools/build_mariner10.py --check   # report only
"""
import argparse
import datetime as dt
import json
import math
import mimetypes
import os

import numpy as np

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
FLIGHT = os.path.join(ROOT, "data", "flights", "mariner_10.json")
J2000 = dt.datetime(2000, 1, 1, 12, tzinfo=dt.timezone.utc)
MU_SUN = 2.959122082855911e-4            # AU^3/day^2
AU_KM = 149597870.7
DAY_S = 86400.0
MU_MERCURY = 22031.86855                 # km^3/s^2
R_MERCURY = 2439.7                       # km

LAUNCH = "1973-11-03T05:45:00Z"
VENUS = ("1974-02-05T17:01:00Z", 5768)
MERCURY = [("1974-03-29T20:47:00Z", 703), ("1974-09-21T20:59:00Z", 48069),
           ("1975-03-16T22:39:00Z", 327)]
ARCS_PER_LAP = 8                         # ~22 days, well under 180 deg each
# periapsisKm in gravity_assist legs is altitude above the surface (app.js
# flybyGeometry adds the planet radius).


def days(iso):
    return (dt.datetime.fromisoformat(iso.replace("Z", "+00:00")) - J2000).total_seconds() / DAY_S


def iso(d):
    t = J2000 + dt.timedelta(days=d)
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def app_positions(requests):
    """{name: [x,y,z] AU} from the app's own ephemeris, via headless Chrome."""
    from playwright.sync_api import sync_playwright

    def handle(route):
        path = route.request.url.split("://app/")[1].split("?")[0] or "index.html"
        f = os.path.join(ROOT, path)
        if os.path.isfile(f):
            route.fulfill(body=open(f, "rb").read(),
                          content_type=mimetypes.guess_type(f)[0] or "application/octet-stream")
        else:
            route.fulfill(status=404, body="")

    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page()
        pg.route("http://app/**", handle)
        pg.goto("http://app/index.html")
        pg.wait_for_function("window.__VERIFY__ !== undefined", timeout=30000)
        out = pg.evaluate("(reqs) => Object.fromEntries(reqs.map(([n, body, t]) => "
                          "[n, window.__VERIFY__.getBodyPositionAtDays(body, t)]))", requests)
        b.close()
    return {k: np.array(v, float) for k, v in out.items()}


def lambert(r0, r1, tof, M=0, lowpath=True):
    from hapsira.core.iod import izzo
    v0, v1 = izzo(MU_SUN, r0, r1, tof, M, True, lowpath, 35, 1e-10)
    return np.array(v0), np.array(v1)


def propagate(r0, v0, t):
    """Two-body propagation (elliptic) by t days."""
    r = np.linalg.norm(r0)
    h = np.cross(r0, v0)
    e_vec = np.cross(v0, h) / MU_SUN - r0 / r
    e = np.linalg.norm(e_vec)
    a = 1 / (2 / r - v0 @ v0 / MU_SUN)
    n = math.sqrt(MU_SUN / a ** 3)
    p_hat = e_vec / e
    q_hat = np.cross(h / np.linalg.norm(h), p_hat)
    cos_nu = np.clip(p_hat @ r0 / r, -1, 1)
    nu = math.acos(cos_nu) if (r0 @ q_hat) >= 0 else 2 * math.pi - math.acos(cos_nu)
    E0 = 2 * math.atan2(math.sqrt(1 - e) * math.sin(nu / 2), math.sqrt(1 + e) * math.cos(nu / 2))
    M = E0 - e * math.sin(E0) + n * t
    E = M
    for _ in range(50):
        E -= (E - e * math.sin(E) - M) / (1 - e * math.cos(E))
    x, y = a * (math.cos(E) - e), a * math.sqrt(1 - e * e) * math.sin(E)
    return x * p_hat + y * q_hat, (a, e, 2 * math.pi / n)


def flyby_alt(vinf_in, vinf_out):
    """Flyby altitude (km) implied by the turn between two v-infinity vectors (AU/day)."""
    vi = np.linalg.norm(vinf_in) * AU_KM / DAY_S
    c = np.clip(vinf_in @ vinf_out / (np.linalg.norm(vinf_in) * np.linalg.norm(vinf_out)), -1, 1)
    delta = math.acos(c)
    if delta < 1e-9:
        return float("inf")
    return MU_MERCURY / vi ** 2 * (1 / math.sin(delta / 2) - 1) - R_MERCURY


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()

    tV = days(VENUS[0])
    tM = [days(m[0]) for m in MERCURY]
    dt_fd = 0.01
    reqs = [["V", "Venus", tV]]
    for i, t in enumerate(tM):
        reqs += [[f"M{i}", "Mercury", t], [f"M{i}-", "Mercury", t - dt_fd], [f"M{i}+", "Mercury", t + dt_fd]]
    P = app_positions(reqs)
    vM = [(P[f"M{i}+"] - P[f"M{i}-"]) / (2 * dt_fd) for i in range(3)]

    # Venus -> Mercury I: the app solves this leg itself; we need its arrival velocity.
    _, v_arr = lambert(P["V"], P["M0"], tM[0] - tV)
    vinf_in = v_arr - vM[0]
    report = {"vinf_in_kms": float(np.linalg.norm(vinf_in) * AU_KM / DAY_S)}
    lap_legs = []
    for k in range(2):
        r0, r1, tof = P[f"M{k}"], P[f"M{k + 1}"], tM[k + 1] - tM[k]
        best = None
        for low in (True, False):
            try:
                v0, v1 = lambert(r0, r1, tof, M=1, lowpath=low)
            except Exception as exc:  # noqa: BLE001
                print(f"  lap {k + 1} lowpath={low}: no solution ({exc})")
                continue
            vout = v0 - vM[k]
            mismatch = abs(np.linalg.norm(vout) - np.linalg.norm(vinf_in)) * AU_KM / DAY_S
            alt = flyby_alt(vinf_in, vout)
            print(f"  lap {k + 1} lowpath={low}: |vinf| out {np.linalg.norm(vout) * AU_KM / DAY_S:.3f} km/s "
                  f"vs in {np.linalg.norm(vinf_in) * AU_KM / DAY_S:.3f} (mismatch {mismatch:.3f}), "
                  f"implied flyby altitude {alt:,.0f} km (published {MERCURY[k][1]:,})")
            if best is None or mismatch < best[0]:
                best = (mismatch, v0, v1, alt, low)
        mismatch, v0, v1, alt, low = best
        pos_end, (sma, ecc, period) = propagate(r0, v0, tof)
        close = np.linalg.norm(pos_end - r1) * AU_KM
        report[f"lap{k + 1}"] = {"lowpath": low, "a_AU": round(sma, 4), "e": round(ecc, 4),
                                 "period_days": round(period, 2), "vinf_mismatch_kms": round(mismatch, 3),
                                 "implied_flyby_alt_km": round(alt), "published_alt_km": MERCURY[k][1],
                                 "end_miss_km": round(close)}
        # split the lap into sub-orbit arcs
        step = tof / ARCS_PER_LAP
        pts = [propagate(r0, v0, step * i)[0] for i in range(1, ARCS_PER_LAP)]
        prev, prev_t = "Mercury", tM[k]
        for i, p in enumerate(pts + [None]):
            t_i = tM[k] + step * (i + 1) if p is not None else tM[k + 1]
            to = {"fixedPos": [round(float(c), 9) for c in p]} if p is not None else "Mercury"
            lap_legs.append({"type": "lambert", "fromBody": prev, "toBody": to,
                             "departDate": iso(prev_t), "arrivalDate": iso(t_i) if p is not None else MERCURY[k + 1][0],
                             "estimate": True})
            prev, prev_t = to, t_i
        if k == 0:
            lap_legs.append({"type": "gravity_assist", "body": "Mercury", "date": MERCURY[1][0],
                             "periapsisKm": MERCURY[1][1], "estimate": True})
        vinf_in = v1 - vM[k + 1]

    legs = [
        {"type": "lambert", "fromBody": "Earth", "toBody": "Venus", "departDate": LAUNCH,
         "arrivalDate": VENUS[0], "estimate": True},
        {"type": "gravity_assist", "body": "Venus", "date": VENUS[0],
         "periapsisKm": VENUS[1], "estimate": True},
        {"type": "lambert", "fromBody": "Venus", "toBody": "Mercury", "departDate": VENUS[0],
         "arrivalDate": MERCURY[0][0], "estimate": True},
        {"type": "gravity_assist", "body": "Mercury", "date": MERCURY[0][0],
         "periapsisKm": MERCURY[0][1], "estimate": True},
    ] + lap_legs
    print(json.dumps(report, indent=1))
    if a.check:
        return
    text = open(FLIGHT, encoding="utf-8").read()
    raw = json.loads(text)
    raw["legs"] = legs
    open(FLIGHT, "w", encoding="utf-8").write(json.dumps(raw, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {len(legs)} legs to {os.path.relpath(FLIGHT, ROOT)}")


if __name__ == "__main__":
    main()
