#!/usr/bin/env python3
"""Check flight dates against Siddiqi's "Beyond Earth" (NASA SP-2018-4041).

The fallback when a flight's NSSDCA catalog record is unavailable
(tools/check_nssdca.py). A. A. Siddiqi, *Beyond Earth: A Chronicle of
Deep Space Exploration, 1958-2016* (NASA History Program Office, 2018) has
one entry per mission, with launch date and time and the main events,
including the Soviet, Japanese and European missions NSSDCA can't serve.
It's a free NASA publication.

The PDF (9 MB) is downloaded once from nasa.gov into tools/.cache/siddiqi/.
Text extraction needs PyMuPDF (`fitz`) or pypdf.

    python3 tools/check_siddiqi.py            # report
    python3 tools/check_siddiqi.py --cite     # also add the entry (with its
        # PDF page) to each flight's dataSources
    python3 tools/check_siddiqi.py giotto     # one flight; prints the entry
"""
import argparse
import json
import os
import re
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from check_nssdca import ROOT, UA, flight_dates, prose_dates  # noqa: E402

PDF_URL = "https://www.nasa.gov/sites/default/files/atoms/files/beyond-earth-tagged.pdf"
CACHE = os.path.join(ROOT, "tools", ".cache", "siddiqi")
PDF = os.path.join(CACHE, "beyond-earth.pdf")
TXT = os.path.join(CACHE, "beyond-earth.txt")
CITE = "A. A. Siddiqi, Beyond Earth: A Chronicle of Deep Space Exploration, 1958–2016 (NASA SP-2018-4041)"

# flight key -> entry heading in the book
ENTRIES = {
    "pioneer_9": "Pioneer IX", "venera_5": "Venera 5", "venera_6": "Venera 6",
    "mariner_6": "Mariner VI", "mariner_7": "Mariner VII", "venera_7": "Venera 7",
    "mars_2": "Mars 2", "mars_3": "Mars 3", "mariner_9": "Mariner 9",
    "helios_1": "Helios 1", "venera_9": "Venera 9", "venera_10": "Venera 10",
    "viking_1": "Viking 1", "viking_2": "Viking 2", "helios_2": "Helios 2",
    "pioneer_venus_1": "Pioneer Venus 1", "pioneer_venus_2": "Pioneer Venus 2",
    "isee3": "ISEE-3", "venera_11": "Venera 11", "venera_12": "Venera 12",
    "venera_13": "Venera 13", "venera_14": "Venera 14", "venera_15": "Venera 15",
    "venera_16": "Venera 16", "vega_1": "Vega 1", "vega_2": "Vega 2",
    "sakigake": "Sakigake", "giotto": "Giotto", "suisei": "Suisei",
}


def book_text():
    os.makedirs(CACHE, exist_ok=True)
    if os.path.exists(TXT):
        return open(TXT, encoding="utf-8").read()
    if not os.path.exists(PDF):
        req = urllib.request.Request(PDF_URL, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=120) as r:
            open(PDF, "wb").write(r.read())
    try:
        import fitz
        pages = [p.get_text() for p in fitz.open(PDF)]
    except ImportError:
        from pypdf import PdfReader
        pages = [p.extract_text() or "" for p in PdfReader(PDF).pages]
    text = "\n".join(f"<<<PAGE {i + 1}>>>\n{t}" for i, t in enumerate(pages))
    open(TXT, "w", encoding="utf-8").write(text)
    return text


def entry(text, heading):
    """(pdf page, cleaned entry text) for the mission entry with this heading."""
    m = re.search(r"^%s\s*\nNation:" % re.escape(heading), text, re.M)
    if not m:
        return None, ""
    end = re.search(r"^[^\n]+\s*\nNation:", text[m.end():], re.M)
    body = text[m.start(): m.end() + (end.start() if end else 20000)]
    page = text[:m.start()].count("<<<PAGE ")
    body = re.sub(r"<<<PAGE \d+>>>\n", "", body)
    body = re.sub(r"^BEYOND EARTH: A CHRONICLE.*$|^\d{1,4}\s*$", "", body, flags=re.M)
    body = body.replace("\xad\n", "").replace("\xad", "")
    body = re.sub(r"-\n(?=[a-z])", "", body)
    return page, re.sub(r"\s+", " ", body).strip()


def add_source(key, heading, page):
    path = os.path.join(ROOT, "data", "flights", key + ".json")
    text = open(path, encoding="utf-8").read()
    raw = json.loads(text)
    url = f"{PDF_URL}#page={page}"
    if any(s.get("url", "").split("#")[0] == PDF_URL for s in raw.get("dataSources", [])):
        return 0
    src = {"title": f"{CITE}, entry “{heading}”", "url": url,
           "note": "launch date and mission events checked against this entry (NSSDCA's catalog record is unavailable)"}
    line = json.dumps(src, ensure_ascii=False)
    if "dataSources" in raw:
        m = re.search(r'"dataSources"\s*:\s*', text)
        _, end = json.JSONDecoder().raw_decode(text, m.end())
        last = text[:end - 1].rstrip()
        text = last + ("\n    " if last.endswith("[") else ",\n    ") + line + text[len(last):]
    else:
        i = text.rstrip().rfind("}")
        text = text[:i].rstrip() + ',\n  "dataSources": [\n    ' + line + "\n  ]\n}" + text[i + 1:]
    json.loads(text)
    open(path, "w", encoding="utf-8").write(text)
    return 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cite", action="store_true")
    ap.add_argument("keys", nargs="*")
    a = ap.parse_args()
    text = book_text()
    for key in a.keys or ENTRIES:
        heading = ENTRIES[key]
        raw = json.load(open(os.path.join(ROOT, "data", "flights", key + ".json"), encoding="utf-8"))
        launch, ours = flight_dates(raw)
        page, body = entry(text, heading)
        print(f"\n== {key}: {raw.get('name')}  (Siddiqi “{heading}”, PDF p. {page})")
        if not body:
            print("    entry not found")
            continue
        lt = re.search(r"Launch Date and Time: (.+?) Launch Site", body)
        lt = lt.group(1) if lt else "?"
        print(f"    launch    Siddiqi {lt}   ours {raw.get('launchDate') or launch}")
        for iso, ctx in prose_dates(body):
            mark = "=" if iso in ours or iso == launch else "?"
            print(f"    {mark} {iso}  …{ctx}…")
        print(f"    our dates: {', '.join(ours[:12])}{' …' if len(ours) > 12 else ''}")
        if a.keys and len(a.keys) == 1:
            print("\n" + body)
        if a.cite:
            print(f"    cited: +{add_source(key, heading, page)}")


if __name__ == "__main__":
    sys.exit(main())
