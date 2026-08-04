#!/usr/bin/env python3
"""Flags Lambert legs whose transfer duration is suspicious relative to
their own solved orbit's natural period -- a screening tool for a real,
structural limitation in this app's Lambert solver, not a general-purpose
trajectory validator (see LIMITATIONS below).

## Why this exists

`solveLambertUniversal` in src/js/app.js is a ZERO-REVOLUTION solver: given
two positions and a time of flight, it always finds *some* orbit connecting
them assuming the spacecraft takes less than one full lap around the Sun.
If the real spacecraft actually took more than one lap, the solver doesn't
error -- it silently returns a different, WRONG orbit that still happens to
satisfy the same two endpoints and time-of-flight. There is no way to tell
this happened by looking at the solved leg alone; the math is internally
consistent either way, only the shape is wrong.

Two real instances of this were found and fixed by hand this way (Solar
Orbiter's first leg, NEAR Shoemaker's post-Earth-flyby leg -- see
CHANGELOG.md) via manual cross-checks against real JPL Horizons ephemeris.
This script automates the SCREENING step of that process across the whole
catalog: for each Lambert leg, it computes the ratio of (leg duration) to
(the solved orbit's own Keplerian period). A ratio approaching or exceeding
1.0 means the transfer took about as long as its own orbit's natural period
-- exactly the regime where "did this only take one lap" becomes doubtful.

## LIMITATIONS -- read before treating a flagged leg as a bug

This is a heuristic, not a verifier. The ratio is computed from the SOLVED
orbit's own elements, which by construction always describe a <1-lap
transfer (that's what the solver assumes) -- so a leg that genuinely only
takes one lap and a leg that was WRONGLY forced into a <1-lap shape when it
actually needed more can both show a ratio near 1.0. They look identical
from inside the app. Many real multi-gravity-assist missions (PSP,
BepiColombo, JUICE, Rosetta, Solar Orbiter) legitimately fly long, resonant,
near-one-lap coast legs by design -- flagged here, and correctly so, but not
necessarily wrong.

Telling a real bug apart from a legitimate resonant leg requires an
independent source of truth: cross-checking against real ephemeris (JPL
Horizons' vector API, https://ssd-api.jpl.nasa.gov/doc/horizons.html --
most well-documented NASA/ESA missions since the 1990s have a spacecraft
target ID there) the same way the two confirmed bugs were found. That
cross-check isn't automated here (no registry of per-mission Horizons IDs
exists in this repo); use this script's output as a prioritized list of
what's worth doing that by hand for, not as a pass/fail gate.

## Usage

    tools/.venv/bin/python3 tools/check_lambert_sweep.py [flight_key ...]
    tools/.venv/bin/python3 tools/check_lambert_sweep.py --threshold 0.5
    tools/.venv/bin/python3 tools/check_lambert_sweep.py --url http://localhost:8934/index.html

With no flight_key arguments, scans the entire catalog (data/flights/manifest.json).
Starts its own local static file server unless --url is given.
"""

import argparse
import json
import os
import socket
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(HERE)

DEFAULT_THRESHOLD = 0.6


def find_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def scan(page_url, flight_keys):
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(page_url)
        page.wait_for_function("() => window.__VERIFY__ !== undefined", timeout=15000)

        rows = page.evaluate(
            """(flightKeys) => {
                const D = window.__VERIFY__;
                const keys = flightKeys.length ? flightKeys : Object.keys(D.FLIGHTS_RAW);
                const out = [];
                for (const key of keys) {
                    const raw = D.FLIGHTS_RAW[key];
                    if (!raw) { out.push({ flight: key, error: 'unknown flight key' }); continue; }
                    if (!D.isMultiLeg(raw)) continue;
                    raw.legs.forEach((leg, i) => {
                        if (leg.type !== 'lambert' || !leg.departDate || !leg.arrivalDate) return;
                        try {
                            const solved = D.getSolvedLeg(key, i);
                            const el = solved.elements;
                            const tDep = D.daysSinceJ2000(D.parseFlightDate(leg.departDate));
                            const tArr = D.daysSinceJ2000(D.parseFlightDate(leg.arrivalDate));
                            const durationDays = tArr - tDep;
                            let periodDays = null, ratio = null;
                            if (el.a > 0) {
                                periodDays = 365.25 * Math.pow(el.a, 1.5);
                                ratio = durationDays / periodDays;
                            }
                            out.push({
                                flight: key, legIndex: i, a: el.a, e: el.e,
                                depart: leg.departDate, arrive: leg.arrivalDate,
                                durationDays: Math.round(durationDays),
                                periodDays: periodDays ? Math.round(periodDays) : null,
                                ratio: ratio !== null ? Number(ratio.toFixed(3)) : null,
                            });
                        } catch (err) {
                            out.push({ flight: key, legIndex: i, error: String(err) });
                        }
                    });
                }
                return out;
            }""",
            flight_keys,
        )
        browser.close()
        return rows, errors


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("flight_keys", nargs="*", help="Specific flight key(s) to check (default: whole catalog)")
    parser.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD,
                         help=f"Flag legs at or above this duration/period ratio (default {DEFAULT_THRESHOLD})")
    parser.add_argument("--url", default=None, help="Page URL to check (default: spin up a local server)")
    args = parser.parse_args()

    server_proc = None
    page_url = args.url
    if page_url is None:
        port = find_free_port()
        server_proc = subprocess.Popen(
            [sys.executable, "-m", "http.server", str(port)],
            cwd=REPO_ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        time.sleep(0.5)
        page_url = f"http://127.0.0.1:{port}/index.html"

    try:
        rows, page_errors = scan(page_url, args.flight_keys)
    finally:
        if server_proc:
            server_proc.terminate()
            server_proc.wait(timeout=5)

    if page_errors:
        print("Page errors encountered while loading the app:", file=sys.stderr)
        for e in page_errors:
            print(" -", e, file=sys.stderr)

    errored = [r for r in rows if "error" in r]
    scored = [r for r in rows if r.get("ratio") is not None]
    hyperbolic = [r for r in rows if r.get("ratio") is None and "error" not in r]
    flagged = sorted((r for r in scored if r["ratio"] >= args.threshold), key=lambda r: -r["ratio"])

    print(f"Scanned {len(rows)} Lambert leg(s): {len(scored)} elliptical, "
          f"{len(hyperbolic)} hyperbolic/degenerate (not applicable to this check), "
          f"{len(errored)} errored.\n")

    if errored:
        print(f"{len(errored)} leg(s) failed to solve:")
        for r in errored:
            print(f"  {r['flight']} leg {r.get('legIndex', '?')}: {r['error']}")
        print()

    if not flagged:
        print(f"No legs at or above ratio {args.threshold} -- nothing flagged.")
    else:
        print(f"{len(flagged)} leg(s) at or above ratio {args.threshold} "
              f"(worth a real-ephemeris cross-check if not already verified -- see this "
              f"script's own docstring for why a high ratio alone isn't proof of a bug):\n")
        for r in flagged:
            print(f"  {r['ratio']:.2f}  {r['flight']:25s} leg {r['legIndex']:2d}  "
                  f"a={r['a']:.3f} e={r['e']:.3f}  {r['depart']} -> {r['arrive']}  "
                  f"({r['durationDays']}d / period {r['periodDays']}d)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
