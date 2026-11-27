#!/usr/bin/env python3
"""Find the original source, creator and licence of every gallery image.

The info-panel gallery images (data/images/bodies, missions, rockets) were
collected by hand, and each asset recorded only a title and an infoUrl,
usually a Wikipedia article rather than the image's own file page. This
tool recovers the file page for each image and writes its attribution to
data/images/credits.json, keyed by the image's localImage path. The app
reads that file to show a credit line under each gallery tile.

How an image is matched:
  1. infoUrl is a Commons file page: use that file directly.
  2. infoUrl is images.nasa.gov: read the NASA Image Library record.
  3. Otherwise (a Wikipedia article, or a NASA/ESA page with no
     machine-readable credit): list every image used in the linked
     Wikipedia article (plus the flight's or body's own article as a
     fallback), download a small thumbnail of each, and compare it with
     our local copy. The closest visual match above MATCH_MIN is taken
     as the source.
  4. MANUAL below overrides anything the steps above get wrong or can't
     find.

Images that can't be matched are written with "status": "unverified" so
the gap is visible in the app and in docs/CREDITS.md.

Usage:
  tools/.venv/bin/python tools/audit_images.py            # all images
  tools/.venv/bin/python tools/audit_images.py --only images/bodies/io.jpg
  tools/.venv/bin/python tools/audit_images.py --report-only

Downloads are cached in tools/.image_audit_cache/ (gitignored).
"""
import argparse
import glob
import hashlib
import html
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
CACHE = os.path.join(ROOT, "tools", ".image_audit_cache")
OUT = os.path.join(DATA, "images", "credits.json")
CREDITS_MD = os.path.join(ROOT, "docs", "CREDITS.md")
UA = "solar-sim-image-audit/1.0 (educational)"

MATCH_MIN = 0.80      # normalized correlation needed to call it a match
MATCH_GOOD = 0.93     # stop searching once a candidate scores this high
ASPECT_TOL = 0.25
MAX_CANDIDATES = 8    # per article: lead image, then closest aspect ratio
REQUEST_DELAY = 8.0   # seconds between uncached requests     # skip candidates whose aspect ratio differs more than this

# Per-image corrections. Keys are localImage paths; values replace or add
# fields in the generated record. Use "nasa_id" (NASA Image and Video
# Library, images.nasa.gov; preferred for NASA material) or "file" (a
# Commons file title) to name the source directly.
MANUAL = {
    # Replacements chosen 2026-11-25 for images whose source couldn't be
    # found or wasn't free (fair use). NASA material comes from the NASA
    # Image and Video Library; ESA, ISRO, CNSA, UAE, SpaceX and newer NASA
    # images (not yet in the library) from Commons. Each local copy is a
    # <=800 px rendition of the named original.
    "images/bodies/didymos.png": {"file": "High-Resolution Didymos and Dimorphos - North Up.png"},
    "images/bodies/dinkinesh.png": {"file": "Dinkinesh First Look L'LORRI.png"},
    "images/bodies/donaldjohanson.png": {"file": "Donaldjohanson Combined.png"},
    "images/bodies/ganymede.jpg": {"nasa_id": "PIA00716"},
    "images/bodies/mercury.jpg": {"nasa_id": "PIA11245"},
    "images/bodies/pluto_charon.jpg": {"nasa_id": "PIA19966"},
    "images/bodies/polymele.png": {"file": "Polymele occultation satellite discovery.png"},
    "images/bodies/sol.jpg": {"file": "SDO 20250309 001038 4096 HMII (HMI).jpg"},
    "images/bodies/tempel1.jpg": {"nasa_id": "PIA02127"},
    "images/missions/aditya_l1/spacecraft.jpg": {"file": "Aditya-L1 spacecraft.jpg"},
    "images/missions/cassini/spacecraft.jpg": {"nasa_id": "PIA03883"},
    "images/missions/exomars_tgo/spacecraft.jpg": {"file": "ExoMars Trace Gas Orbiter Model at ESOC.JPG"},
    "images/missions/galileo/spacecraft.jpg": {"nasa_id": "PIA18176"},
    "images/missions/hope_mars/spacecraft.jpg": {"file": "Emirates Mars Mission mockup at IAC 2021 01 (cropped).jpg"},
    "images/missions/magellan/rocket.jpg": {"nasa_id": "8905993"},
    "images/missions/mars_global_surveyor/spacecraft.jpg": {"nasa_id": "PIA17486"},
    "images/missions/mars_polar_lander/spacecraft.jpg": {"file": "Mars Polar Lander - artist depiction.png"},
    "images/missions/maven/spacecraft.jpg": {"nasa_id": "PIA17487"},
    "images/missions/near_shoemaker/rocket.jpg": {"nasa_id": "201407020006HQ"},
    "images/missions/rosetta/spacecraft.jpg": {"file": "Rosetta spacecraft model.png"},
    "images/missions/tianwen1/spacecraft.jpg": {"file": "Tianwen-1 in Mars orbit.jpg"},
    "images/rockets/atlas_v.jpg": {"nasa_id": "201311180001HQ"},
    "images/rockets/delta_ii.jpg": {"nasa_id": "KSC-07PD-2590"},
    "images/rockets/delta_iv_heavy.jpg": {"file": "Delta IV Heavy in 2018.jpg"},
    "images/rockets/falcon_9.jpg": {"file": "Iridium-1 Launch (32312419215).jpg"},
    "images/rockets/falcon_heavy.jpg": {"nasa_id": "NHQ202310110005"},
    "images/rockets/proton_k.jpg": {"file": "Proton-K-Zarya.jpg"},
    # Halley Armada flights (1984-85). No NASA Image Library originals for
    # these (non-NASA missions); Commons. Sakigake, Suisei and Vega use
    # link-only tiles: the only images are ISAS or Soviet drawings (NSSDCA
    # hosts copies tagged NASA public domain, but that doesn't make them
    # NASA works).
    "images/bodies/halley.jpg": {"file": "Lspn comet halley (cropped).jpg"},
    "images/bodies/grigg_skjellerup.jpg": {"file": "Grigg-Skjellerup 19920710.jpg"},
    "images/missions/giotto/spacecraft.jpg": {"file": "Giotto Whipple shield ESA239195.jpg"},
    "images/rockets/ariane_1.jpg": {"file": "Ariane 1 Le Bourget FRA 001.jpg"},
    "images/rockets/mu_3sii.jpg": {"file": "M-3SII exhibition model.jpg"},
    # Pre-1988 Veneras (added 2026-11-26). No free photo of either spacecraft
    # type was found: the 1982 USSR stamp shows Venera 13/14; Venera 15/16
    # use a map made from their radar altimetry (PDS Geosciences data).
    "images/missions/venera_13/spacecraft.jpg": {"file": "1982 CPA 5278.jpg"},
    "images/missions/venera_15/spacecraft.jpg": {"file": "VenusTopoVenera.jpg"},
    # NASA/JPL photojournal image (PIA19664); the Commons page has no licence field.
    "images/missions/insight/spacecraft.jpg": {"license": "Public domain (NASA)",
        "licenseUrl": "https://www.nasa.gov/nasa-brand-center/images-and-media/"},
}

PD_NASA = "Public domain (NASA)"
NASA_GUIDE = "https://www.nasa.gov/nasa-brand-center/images-and-media/"


# --------------------------------------------------------------------------
# HTTP with cache and polite backoff
# --------------------------------------------------------------------------

def _cache_path(url):
    return os.path.join(CACHE, hashlib.sha1(url.encode()).hexdigest())


def fetch(url, cache=True):
    path = _cache_path(url)
    if cache and os.path.exists(path):
        with open(path, "rb") as f:
            return f.read()
    for attempt in range(8):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            break
        except urllib.error.HTTPError as e:
            if e.code not in (429, 503) or attempt == 7:
                raise
            wait = 60 * (attempt + 1)
            print(f"    {e.code} from server, waiting {wait}s", flush=True)
            time.sleep(wait)
    if cache:
        os.makedirs(CACHE, exist_ok=True)
        with open(path, "wb") as f:
            f.write(data)
    time.sleep(REQUEST_DELAY)  # Wikimedia throttles anonymous clients hard
    return data


def api(base, **params):
    params.setdefault("action", "query")
    params.setdefault("format", "json")
    params.setdefault("formatversion", "2")
    url = base + "?" + urllib.parse.urlencode(params)
    if os.path.exists(_cache_path(url)):
        with open(_cache_path(url), "rb") as f:
            return json.loads(f.read())
    data = fetch(url, cache=False)
    if not data.lstrip().startswith(b"{"):
        raise RuntimeError(f"non-JSON reply from {base}")
    os.makedirs(CACHE, exist_ok=True)
    with open(_cache_path(url), "wb") as f:
        f.write(data)
    return json.loads(data)


WP_API = "https://en.wikipedia.org/w/api.php"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
META_FIELDS = "LicenseShortName|LicenseUrl|Artist|Credit|AttributionRequired|UsageTerms|ObjectName"


# --------------------------------------------------------------------------
# Image comparison
# --------------------------------------------------------------------------

def signature(img):
    """32x32 grayscale vector, mean-removed and unit length, plus aspect."""
    img = img.convert("RGBA")
    bg = Image.new("RGBA", img.size, (0, 0, 0, 255))
    img = Image.alpha_composite(bg, img).convert("L")
    aspect = img.width / img.height
    v = np.asarray(img.resize((32, 32), Image.LANCZOS), dtype=np.float64).ravel()
    v -= v.mean()
    n = np.linalg.norm(v)
    return (v / n if n else v), aspect


def similarity(sig_a, sig_b):
    return float(np.dot(sig_a[0], sig_b[0]))


def local_signature(rel):
    with Image.open(os.path.join(DATA, rel)) as im:
        im.seek(0)  # first frame of a GIF
        return signature(im)


# --------------------------------------------------------------------------
# Metadata helpers
# --------------------------------------------------------------------------

def strip_html(s):
    if not s:
        return ""
    s = re.sub(r"<br\s*/?>", "; ", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s)
    return re.sub(r"\s+", " ", s).strip(" ;")


def record_from_imageinfo(page, score=None, method=""):
    ii = page["imageinfo"][0]
    meta = ii.get("extmetadata", {})
    g = lambda k: strip_html(meta.get(k, {}).get("value", ""))
    lic = g("LicenseShortName") or g("UsageTerms")
    artist = g("Artist")
    credit = g("Credit")
    rec = {
        "sourcePage": ii["descriptionurl"],
        "sourceTitle": page["title"].removeprefix("File:"),
        "credit": artist or credit,
        "creditDetail": credit if artist and credit and credit != artist else "",
        "license": lic,
        "licenseUrl": g("LicenseUrl"),
        "attributionRequired": g("AttributionRequired").lower() == "true",
        "status": "verified",
        "method": method,
    }
    if score is not None:
        rec["match"] = round(score, 3)
    return rec


def imageinfo_query(base, **params):
    return api(base, prop="imageinfo",
               iiprop="url|size|mime|extmetadata",
               iiextmetadatafilter=META_FIELDS,
               iiurlwidth=330, **params)


# --------------------------------------------------------------------------
# Matchers
# --------------------------------------------------------------------------

def commons_file(title, local_sig, method):
    r = imageinfo_query(COMMONS_API, titles=title)
    page = r["query"]["pages"][0]
    if "imageinfo" not in page:
        return None
    score = None
    try:
        thumb = Image.open(io.BytesIO(fetch(page["imageinfo"][0]["thumburl"])))
        score = similarity(local_sig, signature(thumb))
    except Exception as e:  # noqa: BLE001 - report and continue
        print(f"    thumb failed: {e}")
    return record_from_imageinfo(page, score, method)


def article_candidates(article):
    """Every raster file used in an English Wikipedia article."""
    pages = []
    cont = {}
    while True:
        r = imageinfo_query(WP_API, generator="images", titles=article,
                            gimlimit="max", redirects=1, **cont)
        pages += r.get("query", {}).get("pages", [])
        if "continue" not in r:
            break
        cont = {k: v for k, v in r["continue"].items()}
    out = []
    for p in pages:
        ii = (p.get("imageinfo") or [{}])[0]
        if ii.get("mime") not in ("image/jpeg", "image/png", "image/gif", "image/tiff", "image/webp"):
            continue
        if not ii.get("thumburl") or not ii.get("width"):
            continue
        out.append(p)
    return out


def best_in_article(article, local_sig, seen):
    best = (0.0, None)
    cands = article_candidates(article)
    # The article's lead image first (most gallery images were taken from
    # it), then closest aspect ratio, so the source usually comes up early
    # and few thumbnails are downloaded.
    lead = None
    try:
        r = api(WP_API, prop="pageimages", piprop="name", titles=article, redirects=1)
        pg = (r.get("query", {}).get("pages") or [{}])[0]
        lead = "File:" + pg["pageimage"].replace("_", " ") if pg.get("pageimage") else None
    except Exception:  # noqa: BLE001
        pass
    cands.sort(key=lambda p: (p["title"] != lead,
                              abs(p["imageinfo"][0]["width"] / p["imageinfo"][0]["height"] - local_sig[1])))
    for p in cands[:MAX_CANDIDATES]:
        if p["title"] in seen:
            continue
        seen.add(p["title"])
        ii = p["imageinfo"][0]
        aspect = ii["width"] / ii["height"]
        if abs(aspect - local_sig[1]) / local_sig[1] > ASPECT_TOL:
            continue
        try:
            thumb = Image.open(io.BytesIO(fetch(ii["thumburl"])))
            s = similarity(local_sig, signature(thumb))
        except Exception as e:  # noqa: BLE001
            print(f"    skip {p['title']}: {e}")
            continue
        if s > best[0]:
            best = (s, p)
        if s >= MATCH_GOOD:
            break
    return best


def nasa_library(nasa_id):
    r = json.loads(fetch("https://images-api.nasa.gov/search?nasa_id=" + urllib.parse.quote(nasa_id)))
    items = r["collection"]["items"]
    if not items:
        return None
    d = items[0]["data"][0]
    credit = d.get("secondary_creator") or d.get("photographer") or ""
    center = d.get("center", "")
    if not credit:
        credit = f"NASA{('/' + center) if center else ''}"
    # NASA's public-domain status covers work by NASA. Library items credited
    # to someone else (a contractor such as SpaceX, a university without
    # NASA) may carry that party's terms, so they aren't marked verified.
    nasa_made = "nasa" in credit.lower() or not (d.get("secondary_creator") or d.get("photographer"))
    if not nasa_made:
        return {
            "sourcePage": f"https://images.nasa.gov/details/{nasa_id}",
            "sourceTitle": d.get("title", nasa_id), "credit": credit, "creditDetail": "",
            "license": "", "licenseUrl": "", "attributionRequired": True,
            "status": "unverified",
            "method": "NASA Image Library record credited to a non-NASA party; check its terms",
        }
    return {
        "sourcePage": f"https://images.nasa.gov/details/{nasa_id}",
        "sourceTitle": d.get("title", nasa_id),
        "credit": credit,
        "creditDetail": "",
        "license": PD_NASA,
        "licenseUrl": NASA_GUIDE,
        "attributionRequired": False,
        "status": "verified",
        "method": "NASA Image Library record",
    }


def article_from_url(url):
    m = re.match(r"https?://en\.wikipedia\.org/wiki/(.+)", url)
    return urllib.parse.unquote(m.group(1)).replace("_", " ") if m else None


def audit_one(rel, uses):
    url = uses[0]["infoUrl"]
    manual = MANUAL.get(rel, {})
    sig = local_signature(rel)

    if manual.get("nasa_id"):
        rec = nasa_library(manual["nasa_id"])
        if rec:
            rec["method"] = "manual: NASA Image Library record"
    elif manual.get("file"):
        title = manual["file"] if manual["file"].startswith("File:") else "File:" + manual["file"]
        rec = commons_file(title, sig, "manual: named file")
    elif "commons.wikimedia.org/wiki/File:" in url:
        title = urllib.parse.unquote(url.split("/wiki/")[1]).replace("_", " ")
        rec = commons_file(title, sig, "infoUrl is the file page")
    elif "images.nasa.gov/details/" in url:
        rec = nasa_library(url.rsplit("/", 1)[1])
    else:
        rec = None
        seen = set()
        articles = []
        a = article_from_url(url)
        if a:
            articles.append(a)
        for u in uses:  # fallbacks: the article named in the asset title
            t = u.get("title", "")
            if t and t not in articles:
                articles.append(t)
        best = (0.0, None, "")
        for art in articles:
            try:
                s, p = best_in_article(art, sig, seen)
            except Exception as e:  # noqa: BLE001
                print(f"    article {art!r} failed: {e}")
                continue
            if s > best[0]:
                best = (s, p, art)
            if s >= MATCH_GOOD:
                break
        if best[1] is not None and best[0] >= MATCH_MIN:
            rec = record_from_imageinfo(best[1], best[0], f"visual match in Wikipedia article '{best[2]}'")
        elif best[1] is not None:
            print(f"    best guess {best[1]['title']} only {best[0]:.2f}")

    if rec is None:
        rec = {"sourcePage": url, "credit": "", "license": "", "licenseUrl": "",
               "attributionRequired": False, "status": "unverified",
               "method": "no match found"}
    rec.update({k: v for k, v in manual.items() if k not in ("file", "nasa_id")})
    rec["title"] = uses[0]["title"]
    rec["usedBy"] = sorted({u["_src"] for u in uses})
    return rec


# --------------------------------------------------------------------------
# Collect assets, write outputs
# --------------------------------------------------------------------------

def collect_assets():
    assets = {}

    def walk(o, src):
        if isinstance(o, dict):
            if "localImage" in o:
                assets.setdefault(o["localImage"], []).append({**o, "_src": src})
            for v in o.values():
                walk(v, src)
        elif isinstance(o, list):
            for v in o:
                walk(v, src)

    with open(os.path.join(DATA, "bodies", "info.json")) as f:
        info = json.load(f)
    for name, body in info.items():
        walk(body, name)
    for path in sorted(glob.glob(os.path.join(DATA, "flights", "*.json"))):
        if path.endswith("manifest.json"):
            continue
        with open(path) as f:
            walk(json.load(f), os.path.basename(path)[:-5])
    return assets


def clean_credit(s):
    """Drop boilerplate like a leading "Credits:" or "Image:"."""
    s = re.sub(r"^\s*(image\s+)?credits?\s*[:\-]\s*", "", s or "", flags=re.I)
    s = re.sub(r"^\s*image\s*:\s*", "", s, flags=re.I)
    return s.strip()


def md_escape(s):
    return (s or "").replace("|", "\\|")


def write_credits_table(records):
    rows = ["| Image | Source file | Credit | Licence |", "|---|---|---|---|"]
    for rel in sorted(records):
        r = records[rel]
        src = f"[{md_escape(r.get('sourceTitle') or 'page')}]({r['sourcePage']})" if r.get("sourcePage") else ""
        lic = md_escape(r.get("license"))
        if r.get("licenseUrl") and lic:
            lic = f"[{lic}]({r['licenseUrl']})"
        if r["status"] != "verified":
            lic = (lic + " " if lic else "") + "⚠️ unverified"
        rows.append(f"| `{rel}` | {src} | {md_escape(r.get('credit'))} | {lic} |")
    table = "\n".join(rows)
    with open(CREDITS_MD) as f:
        text = f.read()
    start, end = "<!-- gallery:start -->", "<!-- gallery:end -->"
    if start not in text:
        print("CREDITS.md has no gallery markers; table not written")
        return
    pre, rest = text.split(start, 1)
    _, post = rest.split(end, 1)
    with open(CREDITS_MD, "w") as f:
        f.write(pre + start + "\n" + table + "\n" + end + post)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", action="append", help="localImage path(s) to redo")
    ap.add_argument("--redo", action="store_true", help="re-audit images already verified")
    ap.add_argument("--report-only", action="store_true", help="rewrite CREDITS.md from credits.json")
    args = ap.parse_args()

    existing = {}
    if os.path.exists(OUT):
        with open(OUT) as f:
            existing = json.load(f)

    if not args.report_only:
        assets = collect_assets()
        for rel in sorted(assets):
            if args.only and rel not in args.only:
                continue
            if not args.only and not args.redo and existing.get(rel, {}).get("status") == "verified":
                continue
            print(rel, flush=True)
            try:
                rec = audit_one(rel, assets[rel])
            except Exception as e:  # noqa: BLE001
                print(f"    FAILED: {e}")
                continue
            existing[rel] = rec
            print(f"    {rec['status']}: {rec.get('sourceTitle', '')} | {rec.get('credit', '')} | {rec.get('license', '')} | match={rec.get('match')}", flush=True)
            with open(OUT, "w") as f:  # save as we go
                json.dump(dict(sorted(existing.items())), f, indent=1, ensure_ascii=False)
                f.write("\n")
        # drop records for images no longer referenced
        existing = {k: v for k, v in existing.items() if k in assets}
        with open(OUT, "w") as f:
            json.dump(dict(sorted(existing.items())), f, indent=1, ensure_ascii=False)
            f.write("\n")

    for r in existing.values():
        r["credit"] = clean_credit(r.get("credit"))
    with open(OUT, "w") as f:
        json.dump(dict(sorted(existing.items())), f, indent=1, ensure_ascii=False)
        f.write("\n")
    write_credits_table(existing)
    n_ok = sum(r["status"] == "verified" for r in existing.values())
    print(f"{n_ok}/{len(existing)} verified")


if __name__ == "__main__":
    sys.exit(main())
