#!/usr/bin/env python3
"""Read-only report of what in the flight catalog may be out of date.

Run it before a data-refresh pass (by hand or from the weekly scheduled
routine in docs/TODO.md). It edits nothing except, with
--update-baseline, its own baseline file.

It checks three things:

1. Horizons trajectories. For each flight in tools/horizons_ids.json it
   fetches the Horizons object header (no ephemeris) and reads:
     - "Revised:" date
     - the trajectory kernel names and their coverage
     - the "Data fit through <date>, prediction thereafter" line
   and compares them with tools/horizons_baseline.json, the snapshot
   taken at the last refresh pass. A change means the trajectory we
   fitted may have moved: rerun the fit (build_orbit_phases.py for
   planet orbits, check_horizons.py for cruise legs).
   It also tries a Horizons name search for flights with no ID yet.

2. Dated notes. Every date written in a flight's statusNote that falls
   between the last pass and today, or that sits next to a word like
   "planned", "estimated", "target" or "expected". Those are the
   placeholders to replace with real numbers once the event happens.

3. Ongoing timeline entries ("ongoing": true): listed so each can be
   confirmed still true (spacecraft still operating, still in orbit).

Output is markdown on stdout (or --out FILE).

Usage:
  tools/.venv/bin/python tools/refresh_check.py
  tools/.venv/bin/python tools/refresh_check.py --since 2026-11-17 --out report.md
  tools/.venv/bin/python tools/refresh_check.py --update-baseline   # after a pass
"""
import argparse
import datetime as dt
import glob
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FLIGHTS = os.path.join(ROOT, "data", "flights")
IDS = os.path.join(HERE, "horizons_ids.json")
BASELINE = os.path.join(HERE, "horizons_baseline.json")
API = "https://ssd.jpl.nasa.gov/api/horizons.api"
UA = "solar-sim-refresh-check/1.0 (educational)"

MONTHS = {m: i for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}
TENTATIVE = re.compile(r"\b(planned|plan|estimate[sd]?|expected|target(?:ed)?|scheduled|predicted|tentative|TBD|approx\.?|~)\b", re.I)


def get(params):
    params = {"format": "text", **params}
    url = API + "?" + urllib.parse.urlencode(params)
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode("utf-8", "replace")
        except Exception:  # noqa: BLE001 - retry network errors
            if attempt == 3:
                raise
            time.sleep(5 * (attempt + 1))
    return ""


def parse_header(text):
    """Pull the revision, trajectory kernels and fit line from a header."""
    out = {"revised": None, "kernels": [], "dataFit": None, "name": None}
    m = re.search(r"Revised:\s*([A-Z][a-z]{2})\s+(\d{1,2}),\s*(\d{4})\s+(.+?)\s{2,}", text)
    if m:
        out["revised"] = f"{m.group(3)}-{MONTHS[m.group(1)]:02d}-{int(m.group(2)):02d}"
        out["name"] = m.group(4).strip()
    m = re.search(r"[Dd]ata fit through\s+(\d{4}-[A-Z][a-z]{2}-\d{1,2})", text)
    if m:
        y, mo, d = m.group(1).split("-")
        out["dataFit"] = f"{y}-{MONTHS[mo]:02d}-{int(d):02d}"
    # Kernel table rows: name  YYYY-Mon-DD HH:MM  YYYY-Mon-DD HH:MM
    for km in re.finditer(r"^\s*(\S+)\s+(\d{4}-[A-Z][a-z]{2}-\d{2} \d{2}:\d{2})\s+(\d{4}-[A-Z][a-z]{2}-\d{2} \d{2}:\d{2})\s*$", text, re.M):
        out["kernels"].append({"name": km.group(1), "start": km.group(2), "stop": km.group(3)})
    return out


def horizons_header(target_id):
    return parse_header(get({"COMMAND": f"'{target_id}'", "MAKE_EPHEM": "NO", "OBJ_DATA": "YES"}))


def name_search(name):
    """Spacecraft matches for a name, as (id, name) pairs."""
    text = get({"COMMAND": f"'{name}'", "MAKE_EPHEM": "NO", "OBJ_DATA": "NO"})
    hits = re.findall(r"^\s*(-\d+)\s+(.+?)\s{2,}", text, re.M)
    if not hits:
        m = re.search(r"Revised:.*?\s{2,}(.+?)\s{2,}(-\d+)", text)
        if m:
            hits = [(m.group(2), m.group(1))]
    return hits


def load_flights():
    order = json.load(open(os.path.join(FLIGHTS, "manifest.json")))["order"]
    out = {}
    for key in order:
        path = os.path.join(FLIGHTS, f"{key}.json")
        if os.path.exists(path):
            out[key] = json.load(open(path))
    return out


DATE_RE = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")


def dated_notes(flights, since, today):
    rows = []
    for key, f in flights.items():
        note = f.get("statusNote") or ""
        for m in DATE_RE.finditer(note):
            try:
                d = dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            except ValueError:
                continue
            ctx_start = max(0, m.start() - 90)
            ctx = note[ctx_start:m.end() + 60]
            tentative = bool(TENTATIVE.search(note[max(0, m.start() - 60):m.end() + 40]))
            passed = since < d <= today
            if passed or (tentative and d > since):
                state = "passed" if d <= today else "upcoming"
                rows.append((key, d.isoformat(), state, tentative, ctx.replace("\n", " ").strip()))
    return rows


def ongoing_entries(flights):
    rows = []
    for key, f in flights.items():
        for t in f.get("timeline", []) or []:
            if t.get("ongoing"):
                rows.append((key, t.get("body", ""), t.get("kind", ""), t.get("start", ""), t.get("label", "")))
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default=None, help="last pass date (default: baseline's date)")
    ap.add_argument("--out", default=None)
    ap.add_argument("--update-baseline", action="store_true",
                    help="record the current Horizons headers as the new baseline")
    ap.add_argument("--no-horizons", action="store_true", help="skip network checks")
    args = ap.parse_args()

    today = dt.date.today()
    baseline = json.load(open(BASELINE)) if os.path.exists(BASELINE) else {"date": None, "targets": {}}
    since = dt.date.fromisoformat(args.since or baseline.get("date") or "2026-11-17")
    ids = {k: v for k, v in json.load(open(IDS)).items() if isinstance(v, dict)}
    flights = load_flights()

    lines = [f"# Refresh check, {today.isoformat()}", "",
             f"Changes since the last pass ({since.isoformat()}). Read-only; nothing was edited.", ""]

    current = {}
    if not args.no_horizons:
        changed, same, failed = [], [], []
        for key, v in ids.items():
            if not v.get("id"):
                continue
            try:
                h = horizons_header(v["id"])
            except Exception as e:  # noqa: BLE001
                failed.append((key, str(e)))
                continue
            current[key] = h
            old = baseline["targets"].get(key)
            if old is None:
                changed.append((key, v["id"], "no baseline yet", h))
                continue
            diffs = []
            if h["revised"] != old.get("revised"):
                diffs.append(f"revised {old.get('revised')} → {h['revised']}")
            if h["dataFit"] != old.get("dataFit"):
                diffs.append(f"data fit through {old.get('dataFit')} → {h['dataFit']}")
            if [k["name"] for k in h["kernels"]] != [k["name"] for k in old.get("kernels", [])]:
                diffs.append("trajectory kernels changed")
            (changed if diffs else same).append((key, v["id"], "; ".join(diffs), h))
            time.sleep(0.5)

        lines += ["## 1. Horizons trajectories", ""]
        if changed:
            lines += ["Changed since the baseline. Re-fit these:", "",
                      "| Flight | ID | Change | Revised | Data fit through | Latest kernel (stop) |",
                      "|---|---|---|---|---|---|"]
            for key, tid, why, h in changed:
                k = h["kernels"][-1] if h["kernels"] else {}
                lines.append(f"| {key} | {tid} | {why} | {h['revised'] or ''} | {h['dataFit'] or ''} | "
                             f"{k.get('name', '')} ({k.get('stop', '')}) |")
            lines.append("")
        lines.append(f"Unchanged: {', '.join(k for k, *_ in same) or 'none'}.")
        lines.append("")
        if failed:
            lines += ["Fetch failed: " + ", ".join(f"{k} ({e})" for k, e in failed), ""]
        missing = [k for k, v in ids.items() if not v.get("id")]
        if missing:
            lines += ["No Horizons ID yet:", ""]
            for key in missing:
                name = flights.get(key, {}).get("name", key).split(" (")[0]
                try:
                    hits = name_search(name)
                except Exception as e:  # noqa: BLE001
                    hits = []
                    lines.append(f"- {key}: search failed ({e})")
                    continue
                lines.append(f"- {key} (searched '{name}'): " +
                             (", ".join(f"{i} {n}" for i, n in hits[:5]) if hits else "no spacecraft match"))
            lines.append("")
        unlisted = [k for k in flights if k not in ids]
        if unlisted:
            lines += [f"Flights not in horizons_ids.json (never checked): {', '.join(unlisted)}", ""]

    lines += ["## 2. Dated notes to revisit", "",
              "Dates in a statusNote that have passed since the last pass, or that are marked as planned/estimated.", "",
              "| Flight | Date | State | Tentative | Context |", "|---|---|---|---|---|"]
    for key, d, state, tent, ctx in sorted(dated_notes(flights, since, today), key=lambda r: r[1]):
        lines.append(f"| {key} | {d} | {state} | {'yes' if tent else ''} | …{ctx.replace('|', '/')}… |")
    lines.append("")

    lines += ["## 3. Ongoing timeline entries", "",
              "Confirm each is still true; set an end date if not.", "",
              "| Flight | Body | Kind | Since | Label |", "|---|---|---|---|---|"]
    for row in ongoing_entries(flights):
        lines.append("| " + " | ".join(str(x) for x in row) + " |")
    lines.append("")

    report = "\n".join(lines)
    if args.out:
        with open(args.out, "w") as f:
            f.write(report)
    else:
        print(report)

    if args.update_baseline and current:
        baseline = {"_comment": "Horizons object headers at the last refresh pass. Written by tools/refresh_check.py --update-baseline; compared on the next run.",
                    "date": today.isoformat(), "targets": {**baseline.get("targets", {}), **current}}
        with open(BASELINE, "w") as f:
            json.dump(baseline, f, indent=1)
            f.write("\n")
        print(f"baseline updated ({len(current)} targets)", file=sys.stderr)


if __name__ == "__main__":
    sys.exit(main())
