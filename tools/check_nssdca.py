#!/usr/bin/env python3
"""Check flight dates against NASA's NSSDCA Master Catalog.

For each flight in NSSDCA_IDS, fetch its NSSDCA spacecraft record(s)
(nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=<COSPAR ID>) and
compare:

  - launch date and launch vehicle ("Facts in Brief") with the flight file;
  - the flight's arrival / encounter dates with the dates written in the
    record's description (reported for review; descriptions are prose).

NSSDCA's robots.txt allows these record pages (it blocks only the search
and query pages), and NASA content may be used for informational purposes
with NASA credited (NASA Images and Media Usage Guidelines). Records are
cached in tools/.cache/nssdca/ so reruns don't refetch.

    tools/.venv/bin/python tools/check_nssdca.py            # report
    tools/.venv/bin/python tools/check_nssdca.py --cite     # also add the
        # record link(s) to each flight's dataSources

Read-only on the network; --cite edits data/flights/<key>.json by text
insertion (no re-dump, so the files' formatting is kept).
"""
import argparse
import html
import json
import os
import re
import sys
import time
import urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
CACHE = os.path.join(ROOT, "tools", ".cache", "nssdca")
RECORD = "https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id={}"
UA = "solar-simulator-catalog-check/1.0"
DELAY = 2.0

# flight key -> NSSDCA/COSPAR IDs (main craft first, then landers/probes).
NSSDCA_IDS = {
    "mariner_10": ["1973-085A"],
    "helios_1": ["1974-097A"],
    "venera_9": ["1975-050A", "1975-050D"],
    "venera_10": ["1975-054A", "1975-054D"],
    "viking_1": ["1975-075A", "1975-075C"],
    "viking_2": ["1975-083A", "1975-083C"],
    "helios_2": ["1976-003A"],
    "pioneer_venus_1": ["1978-051A"],
    "pioneer_venus_2": ["1978-078A"],
    "isee3": ["1978-079A"],
    "venera_11": ["1978-084A"],
    "venera_12": ["1978-086A"],
    "venera_13": ["1981-106A"],
    "venera_14": ["1981-110A"],
    "venera_15": ["1983-053A"],
    "venera_16": ["1983-054A"],
    "vega_1": ["1984-125A"],
    "vega_2": ["1984-128A"],
    "sakigake": ["1985-001A"],
    "giotto": ["1985-056A"],
    "suisei": ["1985-073A"],
}

MONTHS = {m: i for i, m in enumerate(
    "january february march april may june july august september october november december".split(), 1)}


def fetch(cid):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, cid + ".html")
    if os.path.exists(path):
        text = open(path, encoding="utf-8", errors="replace").read()
        if "Facts in Brief" in text:
            return text
    req = urllib.request.Request(RECORD.format(cid), headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        text = r.read().decode("utf-8", errors="replace")
    time.sleep(DELAY)
    if "Facts in Brief" not in text:
        return None  # NSSDCA answers some records with its generic error page
    open(path, "w", encoding="utf-8").write(text)
    return text


def plain(s):
    s = re.sub(r"<script.*?</script>|<style.*?</style>", "", s, flags=re.S)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s))).strip()


def parse(text):
    name = re.search(r"<h1[^>]*>(.*?)</h1>", text, re.S)
    facts = {}
    for k, v in re.findall(r"<strong>([^<:]+):</strong>\s*([^<]*)", text):
        facts[html.unescape(k).replace("\xa0", " ").strip()] = html.unescape(v).replace("\xa0", " ").strip()
    desc = re.search(r"<h2>Description</h2>(.*?)<h2>", text, re.S)
    return {"name": plain(name.group(1)) if name else "?", "facts": facts,
            "description": plain(desc.group(1)) if desc else ""}


def prose_dates(desc):
    """(ISO date, context) for every '22 October 1975' / 'October 22, 1975' in the text."""
    out = []
    pat = (r"(\d{1,2})\s+(%s)\s+(\d{4})|(%s)\s+(\d{1,2}),?\s+(\d{4})"
           % ("|".join(MONTHS), "|".join(MONTHS)))
    for m in re.finditer(pat, desc, re.I):
        if m.group(1):
            d, mo, y = m.group(1), m.group(2), m.group(3)
        else:
            mo, d, y = m.group(4), m.group(5), m.group(6)
        iso = f"{y}-{MONTHS[mo.lower()]:02d}-{int(d):02d}"
        ctx = desc[max(0, m.start() - 70):m.end() + 30]
        out.append((iso, ctx))
    return out


def flight_dates(raw):
    """Launch date and every arrival/encounter date the flight file states."""
    launch = raw.get("launchDate") or next(
        (l.get("departDate") for l in raw.get("legs", []) if l.get("departDate")), None)
    dates = set()
    for k in ("arrivalDate", "arrival"):
        if isinstance(raw.get(k), str):
            dates.add(raw[k][:10])
    for leg in raw.get("legs", []):
        for k in ("arriveDate", "arrivalDate", "date", "endDate"):
            if isinstance(leg.get(k), str):
                dates.add(leg[k][:10])
    for ev in raw.get("timeline", []) or []:
        for k in ("date", "start", "end"):
            if isinstance(ev, dict) and isinstance(ev.get(k), str):
                dates.add(ev[k][:10])
    return (launch or "")[:10], sorted(dates)


def add_sources(key, cids, names):
    path = os.path.join(ROOT, "data", "flights", key + ".json")
    text = open(path, encoding="utf-8").read()
    raw = json.loads(text)
    have = {s.get("url") for s in raw.get("dataSources", [])}
    new = []
    for cid, nm in zip(cids, names):
        url = RECORD.format(cid)
        if nm is None or url in have:
            continue
        new.append({"title": f"NASA NSSDCA Master Catalog: {nm} ({cid})", "url": url,
                    "note": "launch date, vehicle and mission events checked against this record"})
    if not new:
        return 0
    if "dataSources" in raw:
        # append at the end of the existing array (the trajectory sources
        # stay first; NSSDCA is a cross-check)
        m = re.search(r'"dataSources"\s*:\s*', text)
        _, end = json.JSONDecoder().raw_decode(text, m.end())
        close = end - 1                      # index of the array's "]"
        last = text[:close].rstrip()
        sep = "\n    " if last.endswith("[") else ",\n    "   # flight files indent array items 4 spaces
        body = sep + ",\n    ".join(json.dumps(s, ensure_ascii=False) for s in new)
        text = last + body + text[len(last):]
    else:
        # add before the final closing brace
        ind = re.search(r'\n(\s+)"', text).group(1)
        items = ",\n".join(ind * 2 + json.dumps(s, ensure_ascii=False) for s in new)
        i = text.rstrip().rfind("}")
        head = text[:i].rstrip()
        text = head + ",\n" + ind + '"dataSources": [\n' + items + "\n" + ind + "]\n}" + text[i + 1:]
    json.loads(text)  # still valid
    open(path, "w", encoding="utf-8").write(text)
    return len(new)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cite", action="store_true", help="add record links to dataSources")
    ap.add_argument("keys", nargs="*", help="flight keys (default: all in NSSDCA_IDS)")
    a = ap.parse_args()
    problems = 0
    unavailable = []
    for key in a.keys or NSSDCA_IDS:
        raw = json.load(open(os.path.join(ROOT, "data", "flights", key + ".json"), encoding="utf-8"))
        launch, ours = flight_dates(raw)
        print(f"\n== {key}: {raw.get('name')}")
        names = []
        for i, cid in enumerate(NSSDCA_IDS[key]):
            text = fetch(cid)
            if text is None:
                unavailable.append((key, cid))
                names.append(None)
                print(f"  {cid}  UNAVAILABLE (NSSDCA error page)")
                continue
            rec = parse(text)
            names.append(rec["name"])
            f = rec["facts"]
            print(f"  {cid}  {rec['name']}")
            if i == 0:
                ok = f.get("Launch Date") == launch
                problems += not ok
                print(f"    launch    NSSDCA {f.get('Launch Date')}  ours {launch}  {'ok' if ok else 'MISMATCH'}")
                print(f"    vehicle   NSSDCA {f.get('Launch Vehicle')}  ours {raw.get('rocket') or raw.get('launchVehicle')}")
            for iso, ctx in prose_dates(rec["description"]):
                mark = "=" if iso in ours or iso == launch else "?"
                print(f"    {mark} {iso}  …{ctx}…")
        print(f"    our dates: {', '.join(ours)}")
        if a.cite:
            n = add_sources(key, NSSDCA_IDS[key], names)
            print(f"    cited: +{n} dataSources")
    print(f"\n{problems} launch-date mismatch(es)")
    if unavailable:
        print(f"{len(unavailable)} record(s) unavailable. Open each in a browser and save the page as")
        print(f"tools/.cache/nssdca/<ID>.html, then rerun (cached pages are read first):")
        for key, cid in unavailable:
            print(f"  {key:16s} {RECORD.format(cid)}")


if __name__ == "__main__":
    sys.exit(main())
