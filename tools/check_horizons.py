#!/usr/bin/env python3
"""Cross-checks the app's RENDERED spacecraft positions against real JPL
Horizons ephemeris, leg by leg -- the verifier that check_lambert_sweep.py
explicitly is not.

## Why this exists

check_lambert_sweep.py screens for Lambert legs whose duration approaches
their own solved orbit's period (the regime where the app's zero-revolution
Lambert solver can silently pick the wrong orbit). But a high ratio alone
can't distinguish a real bug from a legitimate resonant coast leg, and for
any leg that follows a gravity assist the app doesn't even render the raw
Lambert solve the sweep measures -- it renders getGAChain's patched-conic
propagation instead. The only real answer is "where was the spacecraft
actually?", which is what this script asks Horizons.

For every Lambert leg of each requested flight it samples the position the
app actually uses (window.__VERIFY__.computeMultiLegPosition -- the same
call the render loop makes for the spacecraft marker; for flat single-arc
flights, computeFlightPosition(getSolvedFlight(key))) at evenly spaced
interior times, fetches Horizons' heliocentric ecliptic-J2000 vectors at
those same instants, and reports the worst-case separation per leg along
with how the leg is drawn (plain Lambert arc / patched-conic propagation /
not drawn because getGAChain rejected the fit).

Spacecraft IDs live in tools/horizons_ids.json. Horizons responses are
cached in tools/.horizons_cache/ (gitignored) so reruns are fast and polite.

## Reading the output

  max_dev    worst separation (AU) between app and Horizons inside the leg
  r_real     Horizons' heliocentric distance at that worst sample
  drawn      lambert | patched | GAP (not drawn) -- see drawMultiLegArcs

Rough interpretation (absolute AU; thresholds are judgment, not physics):
  < 0.05   matches -- imperceptible at normal zoom
  0.05-0.15  approximate -- usually unmodeled thrust (ion/SEP) or a
             simplified flyby; check the flight's statusNote
  > 0.15   wrong shape -- candidate for a fixedPos waypoint split (see
             solar_orbiter.json leg 0's _comment for the established fix)

## Usage

    python3 tools/check_horizons.py                     # every flight with an ID
    python3 tools/check_horizons.py psp bepicolombo     # just these
    python3 tools/check_horizons.py --samples 24 --json out.json
"""

import argparse
import hashlib
import json
import os
import re
import socket
import subprocess
import sys
import time
import urllib.parse
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(HERE)
IDS_PATH = os.path.join(HERE, "horizons_ids.json")
CACHE_DIR = os.path.join(HERE, ".horizons_cache")
J2000_JD = 2451545.0
HORIZONS_URL = "https://ssd.jpl.nasa.gov/api/horizons.api"


def find_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _get_with_retry(url, tries=4):
    for k in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=120) as resp:
                return resp.read().decode()
        except urllib.error.HTTPError as e:
            if e.code < 500 or k == tries - 1:
                raise
            time.sleep(2 * (k + 1))


def horizons_vectors(target, jds, chunk=30):
    """Chunked wrapper: long TLISTs make URLs Horizons' gateway rejects."""
    jds = sorted(jds)
    out = {}
    for i in range(0, len(jds), chunk):
        out.update(_horizons_vectors(target, jds[i:i + chunk]))
    return out


def _horizons_vectors(target, jds):
    """Heliocentric ecliptic J2000 positions (AU) at the given JDs (TDB).
    Returns {jd: [x,y,z]} for the JDs Horizons has coverage for; JDs outside
    the spacecraft's ephemeris span are retried after clipping to the span
    Horizons reports in its error message."""
    jds = sorted(jds)
    key = hashlib.sha1((target + "|" + ",".join(f"{j:.6f}" for j in jds)).encode()).hexdigest()
    os.makedirs(CACHE_DIR, exist_ok=True)
    cache_path = os.path.join(CACHE_DIR, key + ".json")
    if os.path.exists(cache_path):
        with open(cache_path) as f:
            return {float(k): v for k, v in json.load(f).items()}

    result = {}
    pending = list(jds)
    for _attempt in range(3):
        if not pending:
            break
        params = {
            "format": "text", "COMMAND": f"'{target}'", "EPHEM_TYPE": "VECTORS",
            "CENTER": "'500@10'", "REF_PLANE": "ECLIPTIC", "REF_SYSTEM": "J2000",
            "VEC_TABLE": "1", "OUT_UNITS": "AU-D", "CSV_FORMAT": "YES", "OBJ_DATA": "NO",
            "TLIST_TYPE": "JD", "TLIST": " ".join(f"'{j:.6f}'" for j in pending),
        }
        url = HORIZONS_URL + "?" + urllib.parse.urlencode(params)
        text = _get_with_retry(url)
        if "$$SOE" in text:
            body = text.split("$$SOE")[1].split("$$EOE")[0]
            for line in body.strip().splitlines():
                parts = [p.strip() for p in line.split(",")]
                result[round(float(parts[0]), 6)] = [float(parts[2]), float(parts[3]), float(parts[4])]
            break
        # Coverage error: "No ephemeris for target ... prior to A.D. 2018-AUG-12 ..."
        # or "... after A.D. 2025-JAN-01 ..." -- clip and retry.
        m_prior = re.search(r"prior to A\.D\. (\d{4}-[A-Z]{3}-\d{2} \d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)", text)
        m_after = re.search(r"after A\.D\. (\d{4}-[A-Z]{3}-\d{2} \d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)", text)
        if not (m_prior or m_after):
            raise RuntimeError(f"Horizons error for {target}:\n{text[-1500:]}")
        if m_prior:
            lo = calendar_to_jd(m_prior.group(1))
            pending = [j for j in pending if j > lo + 1e-3]
        if m_after:
            hi = calendar_to_jd(m_after.group(1))
            pending = [j for j in pending if j < hi - 1e-3]
        time.sleep(0.5)

    with open(cache_path, "w") as f:
        json.dump({str(k): v for k, v in result.items()}, f)
    return result


MONTHS = {m: i + 1 for i, m in enumerate("JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split())}


def calendar_to_jd(s):
    date, clock = s.split(" ")
    y, mon, d = date.split("-")
    hh, mm, *rest = clock.split(":")
    sec = float(rest[0]) if rest else 0.0
    y, m, d = int(y), MONTHS[mon], int(d)
    a = (14 - m) // 12
    yy, mm2 = y + 4800 - a, m + 12 * a - 3
    jdn = d + (153 * mm2 + 2) // 5 + 365 * yy + yy // 4 - yy // 100 + yy // 400 - 32045
    return jdn - 0.5 + (int(hh) + int(mm) / 60 + sec / 3600) / 24


def sample_app(page_url, flight_keys, n_samples):
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(page_url)
        page.wait_for_function("() => window.__VERIFY__ !== undefined && window.__VERIFY__.computeMultiLegPosition", timeout=20000)
        rows = page.evaluate(
            """([keys, n]) => {
                const D = window.__VERIFY__;
                const out = [];
                const fr = (k) => Array.from({length: n}, (_, s) => (s + 0.5) / n);
                for (const key of keys) {
                    const raw = D.FLIGHTS_RAW[key];
                    if (!raw) { out.push({ flight: key, error: 'unknown flight key' }); continue; }
                    if (!D.isMultiLeg(raw)) {
                        const solved = D.getSolvedFlight(key);
                        const t0 = solved.launchDays, t1 = solved.arrivalDays;
                        const samples = fr().map(f => { const t = t0 + f * (t1 - t0);
                            return { t, pos: D.computeFlightPosition(solved, t) }; });
                        out.push({ flight: key, legIndex: 0, depart: raw.launchDate, arrive: raw.arrival,
                                   from: raw.launchBody, to: raw.destinationBody, drawn: 'lambert', samples });
                        continue;
                    }
                    const hasGA = raw.legs.some(l => l.type === 'gravity_assist');
                    const segs = hasGA ? D.getGAChain(key) : [];
                    raw.legs.forEach((leg, i) => {
                        if (leg.type !== 'lambert') return;
                        const t0 = D.daysSinceJ2000(D.parseFlightDate(leg.departDate));
                        const t1 = D.daysSinceJ2000(D.parseFlightDate(leg.arrivalDate));
                        const seg = segs.find(s => s.legIndex === i);
                        const followsGA = i > 0 && raw.legs[i-1].type === 'gravity_assist';
                        let drawn = 'lambert';
                        if (seg && seg.isPatched) drawn = 'patched';
                        else if (followsGA) drawn = 'GAP';
                        const name = (b) => typeof b === 'string' ? b : 'waypoint';
                        const samples = fr().map(f => { const t = t0 + f * (t1 - t0);
                            return { t, pos: D.computeMultiLegPosition(key, t) }; });
                        out.push({ flight: key, legIndex: i, depart: leg.departDate, arrive: leg.arrivalDate,
                                   from: name(leg.fromBody), to: name(leg.toBody), drawn, samples });
                    });
                }
                return out;
            }""",
            [flight_keys, n_samples],
        )
        browser.close()
        return rows, errors


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("flight_keys", nargs="*")
    parser.add_argument("--samples", type=int, default=16, help="interior samples per leg (default 16)")
    parser.add_argument("--url", default=None)
    parser.add_argument("--json", default=None, help="also write full per-sample results here")
    parser.add_argument("--legs", default=None,
                        help="comma list of flight:leg to restrict to, e.g. psp:10,lucy:0")
    args = parser.parse_args()

    with open(IDS_PATH) as f:
        ids = {k: v for k, v in json.load(f).items() if not k.startswith("_")}
    keys = args.flight_keys or [k for k, v in ids.items() if v.get("id")]
    missing = [k for k in keys if not ids.get(k, {}).get("id")]
    if missing:
        print("No Horizons ID registered for: " + ", ".join(missing), file=sys.stderr)
    keys = [k for k in keys if k not in missing]
    leg_filter = None
    if args.legs:
        leg_filter = {tuple([a.split(":")[0], int(a.split(":")[1])]) for a in args.legs.split(",")}

    server_proc = None
    page_url = args.url
    if page_url is None:
        port = find_free_port()
        server_proc = subprocess.Popen([sys.executable, "-m", "http.server", str(port)],
                                       cwd=REPO_ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(0.5)
        page_url = f"http://127.0.0.1:{port}/index.html"
    try:
        rows, page_errors = sample_app(page_url, keys, args.samples)
    finally:
        if server_proc:
            server_proc.terminate()
            server_proc.wait(timeout=5)
    for e in page_errors:
        print("page error:", e, file=sys.stderr)

    if leg_filter:
        rows = [r for r in rows if (r["flight"], r.get("legIndex")) in leg_filter]

    results = []
    for r in rows:
        if "error" in r:
            print(f"{r['flight']}: {r['error']}")
            continue
        target = ids[r["flight"]]["id"]
        jd_of = {round(s["t"] + J2000_JD, 6): s for s in r["samples"]}
        real = horizons_vectors(target, list(jd_of.keys()))
        worst, devs = None, []
        for jd, s in jd_of.items():
            if jd not in real:
                continue
            rp = real[jd]
            d = sum((a - b) ** 2 for a, b in zip(s["pos"], rp)) ** 0.5
            rr = sum(c * c for c in rp) ** 0.5
            ra = sum(c * c for c in s["pos"]) ** 0.5
            s.update(real=rp, dev=d)
            devs.append(d)
            if worst is None or d > worst[0]:
                worst = (d, rr, ra, jd)
        r["coverage"] = f"{len(devs)}/{len(jd_of)}"
        r["max_dev"] = worst[0] if worst else None
        r["median_dev"] = sorted(devs)[len(devs) // 2] if devs else None
        r["r_real"] = worst[1] if worst else None
        r["r_app"] = worst[2] if worst else None
        results.append(r)

    print(f"{'flight':16s} {'leg':>3s}  {'depart':10s} -> {'arrive':10s}  {'from':>8s}->{'to':8s} "
          f"{'drawn':7s} {'cov':>5s}  {'max_dev':>7s} {'median':>7s}  r_real/r_app @worst")
    for r in results:
        if r["max_dev"] is None:
            print(f"{r['flight']:16s} {r['legIndex']:3d}  {r['depart']} -> {r['arrive']}  "
                  f"{r['from'][:8]:>8s}->{r['to'][:8]:8s} {r['drawn']:7s} {r['coverage']:>5s}  (no Horizons coverage)")
            continue
        flag = "  <-- WRONG?" if r["max_dev"] > 0.15 else ("  (approx)" if r["max_dev"] > 0.05 else "")
        print(f"{r['flight']:16s} {r['legIndex']:3d}  {r['depart']} -> {r['arrive']}  "
              f"{r['from'][:8]:>8s}->{r['to'][:8]:8s} {r['drawn']:7s} {r['coverage']:>5s}  "
              f"{r['max_dev']:7.3f} {r['median_dev']:7.3f}  {r['r_real']:.2f}/{r['r_app']:.2f}{flag}")

    if args.json:
        with open(args.json, "w") as f:
            json.dump(results, f, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
