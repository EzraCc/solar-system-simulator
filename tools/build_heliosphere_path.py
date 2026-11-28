#!/usr/bin/env python3
"""Writes a flight's `heliospherePath`: its path beyond the Solar System
view, for the heliosphere layer (docs/outer-missions-plan.md §1).

The Sol view stops far craft at 1.1 x Pluto's aphelion (54.514 AU, see
tools/build_voyager.py); the heliosphere layer draws them from there on.
This tool samples JPL Horizons' heliocentric position (ecliptic J2000, AU)
every --step-days from --start to --end and splices the field into
data/flights/<flight>.json (text splice, the rest of the file untouched):

    "heliospherePath": {
      "source": "JPL Horizons, spacecraft -31",
      "url": "https://ssd.jpl.nasa.gov/api/horizons.api?...",
      "measuredUntil": "2026-11-27",
      "note": "...",
      "points": [["1994-01-06T09:00:00Z", x, y, z], ...]
    }

The app draws the path solid up to `measuredUntil` and dashed after it
(dashed = calculated/projection, outer-missions plan §3). Pick
`measuredUntil` from the mission record: the last contact for a craft that
has gone silent, today's date for one still in contact.

    python3 tools/build_heliosphere_path.py voyager_1 --id -31 \\
        --start 1994-01-06T09:00 --end 2050-01-01 --measured-until 2026-11-27
    python3 tools/build_heliosphere_path.py pioneer_10 --id -23 \\
        --start <cutoff crossing> --end 2050-01-01 --measured-until 2003-01-23

--dry-run prints the first/last points and distances without writing.
"""
import argparse
import hashlib
import json
import math
import os
import re
import sys
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CACHE = os.path.join(HERE, ".cache", "heliosphere")
UA = "solar-simulator-catalog-check/1.0"


def horizons(target, start, stop, step_days):
    params = {"format": "text", "COMMAND": f"'{target}'", "EPHEM_TYPE": "VECTORS", "CENTER": "'500@10'",
              "REF_PLANE": "ECLIPTIC", "REF_SYSTEM": "J2000", "VEC_TABLE": "1", "OUT_UNITS": "AU-D",
              "CSV_FORMAT": "YES", "OBJ_DATA": "NO", "TIME_TYPE": "UT",
              "START_TIME": f"'{start}'", "STOP_TIME": f"'{stop}'", "STEP_SIZE": f"'{step_days} d'"}
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, hashlib.sha1(json.dumps(params, sort_keys=True).encode()).hexdigest() + ".txt")
    if not os.path.exists(path):
        url = "https://ssd.jpl.nasa.gov/api/horizons.api?" + urllib.parse.urlencode(params)
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        text = urllib.request.urlopen(req, timeout=120).read().decode()
        if "$$SOE" not in text:
            raise SystemExit("Horizons returned no ephemeris:\n" + text[-1500:])
        open(path, "w").write(text)
    text = open(path).read()
    out = []
    for row in text.split("$$SOE")[1].split("$$EOE")[0].strip().splitlines():
        c = [x.strip() for x in row.split(",")]
        # "A.D. 1994-Jan-06 09:00:00.0000"
        m = re.match(r"A\.D\. (\d{4})-(\w{3})-(\d{2}) (\d{2}):(\d{2})", c[1])
        mon = "JanFebMarAprMayJunJulAugSepOctNovDec".index(m.group(2)) // 3 + 1
        iso = f"{m.group(1)}-{mon:02d}-{m.group(3)}T{m.group(4)}:{m.group(5)}:00Z"
        out.append([iso] + [round(float(v), 4) for v in c[2:5]])
    return out


def splice(path, field):
    text = open(path, encoding="utf-8").read()
    pts = ",\n".join("      " + json.dumps(p) for p in field["points"])
    head = {k: v for k, v in field.items() if k != "points"}
    body = "".join(f'    {json.dumps(k)}: {json.dumps(v, ensure_ascii=False)},\n' for k, v in head.items())
    block = '{\n' + body + '    "points": [\n' + pts + '\n    ]\n  }'
    m = re.search(r'"heliospherePath"\s*:\s*', text)
    if m:
        _, end = json.JSONDecoder().raw_decode(text, m.end())
        text = text[:m.end()] + block + text[end:]
    else:
        i = text.rstrip().rfind("}")
        text = text[:i].rstrip() + ',\n  "heliospherePath": ' + block + "\n}" + text[i + 1:]
    json.loads(text)
    open(path, "w", encoding="utf-8").write(text)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("flight")
    ap.add_argument("--id", required=True, help="Horizons spacecraft ID, e.g. -31")
    ap.add_argument("--start", required=True, help="first point (the cutoff crossing), ISO UTC")
    ap.add_argument("--end", default="2050-01-01")
    ap.add_argument("--measured-until", required=True, help="solid up to here, dashed after (ISO date)")
    ap.add_argument("--step-days", type=int, default=60)
    ap.add_argument("--note", default="", help="extra sentence for the field's note")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    pts = horizons(a.id, a.start.replace("T", " ").rstrip("Z"), a.end, a.step_days)
    r = lambda p: math.sqrt(p[1] ** 2 + p[2] ** 2 + p[3] ** 2)
    print(f"{a.flight}: {len(pts)} points, {pts[0][0]} at {r(pts[0]):.2f} AU -> {pts[-1][0]} at {r(pts[-1]):.2f} AU")
    if a.dry_run:
        return
    note = (f"Heliocentric ecliptic J2000 positions from JPL Horizons every {a.step_days} days. Solid to "
            f"{a.measured_until}, dashed after: the rest is Horizons' prediction, a projection." + (" " + a.note if a.note else ""))
    field = {"source": f"JPL Horizons, spacecraft {a.id}",
             "url": f"https://ssd.jpl.nasa.gov/api/horizons.api?format=text&MAKE_EPHEM=NO&OBJ_DATA=YES&COMMAND=%27{a.id}%27",
             "measuredUntil": a.measured_until, "note": note, "points": pts}
    path = os.path.join(ROOT, "data", "flights", a.flight + ".json")
    splice(path, field)
    print("wrote", path)


if __name__ == "__main__":
    sys.exit(main())
