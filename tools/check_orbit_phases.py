#!/usr/bin/env python3
"""Checks fitted orbit phases (a flight's `planetOrbit`, from
tools/build_orbit_phases.py) against JPL Horizons, the way check_horizons.py
checks legs: samples the spacecraft's planet-centered position as the app
itself computes it (headless browser, window.__VERIFY__) at random UTC times
across the modeled orbit, fetches Horizons at the same times, and reports the
worst and median position error.

    tools/.venv/bin/python3 tools/check_orbit_phases.py              # every flight with a planetOrbit
    tools/.venv/bin/python3 tools/check_orbit_phases.py mro maven --samples 200
"""

import argparse
import json
import os
import random
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from check_horizons import (IDS_PATH, J2000_JD, PRIMARY_IDS, REPO_ROOT,  # noqa: E402
                            find_free_port, horizons_vectors)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("flights", nargs="*")
    ap.add_argument("--samples", type=int, default=120)
    ap.add_argument("--seed", type=int, default=1)
    args = ap.parse_args()

    ids = {k: v for k, v in json.load(open(IDS_PATH)).items() if not k.startswith("_")}
    port = find_free_port()
    server = subprocess.Popen([sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"],
                              cwd=REPO_ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.5)
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page()
            page.goto(f"http://127.0.0.1:{port}/index.html")
            page.wait_for_function("() => window.__VERIFY__ && window.__VERIFY__.getPlanetOrbiters", timeout=20000)
            orbiters = page.evaluate("""(keys) => {
                const D = window.__VERIFY__, out = [];
                for (const [key, raw] of Object.entries(D.FLIGHTS_RAW)) {
                    if (!raw.planetOrbit || (keys.length && !keys.includes(key))) continue;
                    const o = D.getPlanetOrbiters(raw.planetOrbit.primaryBody).find((x) => x.key === key);
                    if (o) out.push({ key, primary: raw.planetOrbit.primaryBody, t0: o.tStart, t1: o.tEnd });
                }
                return out; }""", args.flights)
            rng = random.Random(args.seed)
            for o in orbiters:
                ts = sorted(round(o["t0"] + rng.random() * (o["t1"] - o["t0"]), 6) for _ in range(args.samples))
                o["samples"] = page.evaluate("""([key, primary, ts]) => {
                    const D = window.__VERIFY__;
                    const o = D.getPlanetOrbiters(primary).find((x) => x.key === key);
                    return ts.map((t) => { const ph = D.orbiterPhaseAt(o, t);
                        return { t, pos: ph ? D.orbiterOffsetKm(ph, t) : null }; }); }""",
                                             [o["key"], o["primary"], ts])
            browser.close()
    finally:
        server.terminate()
        server.wait(timeout=5)

    print(f"{'flight':16s} {'primary':8s} {'span':11s} {'n':>4s} {'max err km':>11s} {'median km':>10s} {'max/r':>7s}")
    for o in orbiters:
        target = ids.get(o["key"], {}).get("id")
        if not target:
            print(f"{o['key']}: no Horizons id")
            continue
        jd_of = {round(s["t"] + J2000_JD, 6): s for s in o["samples"] if s["pos"]}
        real = horizons_vectors(target, list(jd_of), center=PRIMARY_IDS[o["primary"]], units="KM-S")
        errs = []
        for jd, s in jd_of.items():
            if jd in real:
                d = sum((a - b) ** 2 for a, b in zip(s["pos"], real[jd])) ** 0.5
                errs.append((d, d / sum(c * c for c in real[jd]) ** 0.5, jd))
        if not errs:
            print(f"{o['key']}: no Horizons coverage at sampled times")
            continue
        errs.sort()
        worst = errs[-1]
        span = f"{2000 + o['t0'] / 365.25:.1f}-{2000 + o['t1'] / 365.25:.1f}"
        print(f"{o['key']:16s} {o['primary']:8s} {span:11s} {len(errs):4d} {worst[0]:11,.0f} "
              f"{errs[len(errs) // 2][0]:10,.0f} {100 * max(e[1] for e in errs):6.1f}%")
    return 0


if __name__ == "__main__":
    sys.exit(main())
