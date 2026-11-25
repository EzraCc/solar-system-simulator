#!/usr/bin/env python3
"""Download and prepare surface maps for the sphere renderer.

Writes data/images/textures/<name>.jpg: equirectangular (simple
cylindrical) maps, 2:1, power-of-two sizes (WebGL 1 can only mipmap
power-of-two textures), longitude 0 at the centre, east to the right,
north up. That is the convention SPHERE_TEXTURES in app.js assumes.

All sources are public domain (NASA / JPL / USGS). Polar no-data margins
(pure black in some mosaics) are filled with the nearest valid pixel in
the same column, so the poles don't render as black caps.

Run from the repo root:  tools/.venv/bin/python tools/build_textures.py
Re-running re-downloads and overwrites. Add a body by adding a row here
and an entry in SPHERE_TEXTURES (app.js).
"""
import hashlib
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None  # the Cassini moon mosaics are >100 Mpx

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "images", "textures")
UA = "solar-sim-texture-build/1.0 (educational)"
NASA3D = "https://raw.githubusercontent.com/nasa/NASA-3D-Resources/master/Images%20and%20Textures/"
COMMONS = "https://upload.wikimedia.org/wikipedia/commons/"

# One entry per map. Every field ends up in data/images/textures/manifest.json,
# which the app loads for both the texture paths and the credit line shown
# in each body's info panel; docs/CREDITS.md summarises the same sources.
#   body      app body name (as in the info panel title / moon tables)
#   file      output file name in data/images/textures/
#   url       where this script downloads the image from
#   page      the human-readable source page to cite (file page / catalogue)
#   title     what the image is
#   credit    who made it, in the form the source asks to be credited
#   license   licence or copyright status at the source
#   width     output width (power of two; height is width / 2)
#   ops       processing applied here (see TRANSFORMS), recorded in the manifest
#
# Longitude checks, done by eye on the downloaded map against known
# features (all maps: lon 0 at centre, east to the right):
#   Jupiter  Great Red Spot near 50 W in the Dec 2000 Cassini map (it
#            drifts in System III, so this is illustrative anyway).
#   Io       Pele's red ring at 19 S 255 W, Babbar Patera at 40 S 272 W.
#   Europa   Pwyll's bright rays at 25 S 271 W.
NASA3D_PAGE = "https://github.com/nasa/NASA-3D-Resources/tree/master/Images%20and%20Textures/"
NASA3D_LIC = "NASA media, not copyrighted (NASA 3D Resources; NASA media usage guidelines)"
PD = "Public domain (NASA)"
def commons(path, thumb=None):
    """Download URL and file page for a Commons file. thumb: fetch one of
    Wikimedia's standard thumbnail widths (1920, 3840, ...) instead of the original, which
    the file servers ask for (and rate-limit originals of 100+ Mpx)."""
    name = path.split("/", 2)[2]
    url = COMMONS + path if not thumb else f"{COMMONS}thumb/{path}/{thumb}px-{name}"
    return url, "https://commons.wikimedia.org/wiki/File:" + name
def nasa3d(folder):
    f = folder.replace(" ", "%20")
    return NASA3D + f + "/" + f + ".jpg", NASA3D_PAGE + f

SOURCES = [
    dict(body="Jupiter", file="jupiter", width=2048, license=PD,
         title="Cassini Jupiter cylindrical map, December 2000 (PIA07782)",
         credit="NASA/JPL/Space Science Institute",
         **dict(zip(("url", "page"), commons("1/1e/Jupiter_Cylindrical_Map_-_Dec_2000_PIA07782.jpg")))),
    dict(body="Io", file="io", width=1024, license=NASA3D_LIC,
         title="Io global map, Galileo and Voyager imagery (NASA 3D Resources)",
         credit="NASA/JPL/USGS; NASA 3D Resources",
         **dict(zip(("url", "page"), nasa3d("Jupiter - Io (A)")))),
    dict(body="Europa", file="europa", width=1024, license=PD,
         title="Europa Voyager / Galileo SSI global mosaic",
         credit="NASA/JPL/USGS Astrogeology Science Center",
         **dict(zip(("url", "page"), commons("2/26/Europa_Voyager_GalileoSSI_global_mosaic.jpg")))),
    dict(body="Ganymede", file="ganymede", width=1024, license=NASA3D_LIC, ops=["soften"],
         title="Ganymede global map, Voyager and Galileo imagery (NASA 3D Resources)",
         credit="NASA/JPL/USGS; NASA 3D Resources",
         **dict(zip(("url", "page"), nasa3d("Jupiter - Ganymede")))),
    dict(body="Callisto", file="callisto", width=1024, license=PD,
         title="Callisto Voyager / Galileo SSI global mosaic",
         credit="NASA/JPL/USGS Astrogeology Science Center",
         **dict(zip(("url", "page"), commons("9/96/Callisto_USGS_global_small.jpg")))),
    dict(body="Mercury", file="mercury", width=2048, license=PD,
         title="MESSENGER MDIS global monochrome basemap (2,500 m/px)",
         credit="NASA/Johns Hopkins University Applied Physics Laboratory/Carnegie Institution of Washington",
         **dict(zip(("url", "page"), commons("0/04/Mercury_-_complete_mono_basemap_2500mpp_equirectangular.png", thumb=3840)))),
    dict(body="Earth", file="earth", width=2048, license=PD,
         title="Blue Marble: land surface and ocean (NASA Visible Earth)",
         credit="NASA Goddard Space Flight Center; image by Reto Stöckli, enhancements by Robert Simmon",
         **dict(zip(("url", "page"), commons("8/8f/Whole_world_-_land_and_oceans_12000.jpg", thumb=3840)))),
    dict(body="Moon", file="moon", width=2048, license=PD,
         url="https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_2k.tif",
         page="https://svs.gsfc.nasa.gov/4720",
         title="CGI Moon Kit colour map, from LRO Wide Angle Camera mosaics",
         credit="NASA's Scientific Visualization Studio (Ernie Wright); LRO data NASA/GSFC/Arizona State University"),
    dict(body="Mars", file="mars", width=2048, license=NASA3D_LIC,
         title="Mars global colour map (NASA 3D Resources)",
         credit="NASA/JPL/USGS; NASA 3D Resources",
         **dict(zip(("url", "page"), nasa3d("Mars")))),
    dict(body="Phobos", file="phobos", width=1024, license=NASA3D_LIC,
         title="Phobos global map (NASA 3D Resources)", credit="NASA/JPL; NASA 3D Resources",
         **dict(zip(("url", "page"), nasa3d("Mars - Phobos")))),
    dict(body="Deimos", file="deimos", width=1024, license=NASA3D_LIC,
         title="Deimos global map (NASA 3D Resources)", credit="NASA/JPL; NASA 3D Resources",
         **dict(zip(("url", "page"), nasa3d("Mars - Deimos")))),
    # NASA 3D's Saturn map is over-saturated orange; its banding (luminance)
    # is kept and recoloured toward Cassini's natural-colour palette.
    dict(body="Saturn", file="saturn", width=1024, license=NASA3D_LIC, ops=["saturn_tone"],
         title="Saturn band map (NASA 3D Resources), recoloured here",
         credit="NASA/JPL; NASA 3D Resources",
         **dict(zip(("url", "page"), nasa3d("Saturn")))),
    dict(body="Titan", file="titan", width=512, license=NASA3D_LIC,
         title="Titan in visible light: its orange haze (NASA 3D Resources)",
         credit="NASA/JPL; NASA 3D Resources",
         **dict(zip(("url", "page"), nasa3d("Saturn - Titan")))),
    dict(body="Enceladus", file="enceladus", width=1024, license=PD, ops=["desat"],
         title="Cassini global colour map of Enceladus (PIA18435)",
         credit="NASA/JPL-Caltech/Space Science Institute/Lunar and Planetary Institute",
         **dict(zip(("url", "page"), commons("a/aa/Enceladus_Color_Map.jpg", thumb=3840)))),
    dict(body="Tethys", file="tethys", width=1024, license=PD, ops=["desat"],
         title="Cassini global colour map of Tethys",
         credit="NASA/JPL-Caltech/Space Science Institute/Lunar and Planetary Institute",
         **dict(zip(("url", "page"), commons("4/40/Tethys_Color_Map.jpg", thumb=3840)))),
    dict(body="Dione", file="dione", width=1024, license=PD, ops=["desat"],
         title="Cassini global colour map of Dione",
         credit="NASA/JPL-Caltech/Space Science Institute/Lunar and Planetary Institute",
         **dict(zip(("url", "page"), commons("1/18/Dione_Color_Map.jpg", thumb=3840)))),
    dict(body="Rhea", file="rhea", width=1024, license=PD, ops=["desat"],
         title="Cassini global colour map of Rhea (PIA18438)",
         credit="NASA/JPL-Caltech/Space Science Institute/Lunar and Planetary Institute",
         **dict(zip(("url", "page"), commons("2/21/Rhea_Color_Map.jpg", thumb=3840)))),
    dict(body="Iapetus", file="iapetus", width=1024, license=PD, ops=["desat"],
         title="Cassini global colour map of Iapetus",
         credit="NASA/JPL-Caltech/Space Science Institute/Lunar and Planetary Institute",
         **dict(zip(("url", "page"), commons("5/53/Iapetus_Color_Map.jpg", thumb=3840)))),
    dict(body="Pluto", file="pluto", width=1024, license=NASA3D_LIC,
         title="Pluto global map from New Horizons; the unseen southern hemisphere is filled (NASA 3D Resources)",
         credit="NASA/Johns Hopkins University Applied Physics Laboratory/Southwest Research Institute; NASA 3D Resources",
         **dict(zip(("url", "page"), nasa3d("Pluto")))),
    dict(body="Charon", file="charon", width=1024, license=NASA3D_LIC,
         title="Charon global map from New Horizons (NASA 3D Resources)",
         credit="NASA/Johns Hopkins University Applied Physics Laboratory/Southwest Research Institute; NASA 3D Resources",
         **dict(zip(("url", "page"), nasa3d("Pluto - Charon")))),
]


CACHE = os.path.join(ROOT, "tools", ".texture_cache")


def fetch(url):
    """Download once into tools/.texture_cache (gitignored); retry with
    backoff on HTTP 429, which upload.wikimedia.org sends quickly."""
    os.makedirs(CACHE, exist_ok=True)
    cached = os.path.join(CACHE, hashlib.sha1(url.encode()).hexdigest())
    if os.path.exists(cached):
        return open(cached, "rb").read()
    for attempt in range(6):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=120) as r:
                data = r.read()
            open(cached, "wb").write(data)
            return data
        except urllib.error.HTTPError as e:
            if e.code != 429 or attempt == 5:
                raise
            wait = 20 * (attempt + 1)
            print(f"  429 from server, waiting {wait}s", flush=True)
            time.sleep(wait)


def to_rgb8(im):
    """16-bit greyscale PNG/TIFF -> 8-bit RGB, stretched to its own range."""
    if im.mode in ("I;16", "I;16B", "I", "F"):
        a = np.asarray(im, dtype=np.float64)
        lo, hi = np.percentile(a, 0.5), np.percentile(a, 99.5)
        a = np.clip((a - lo) / max(hi - lo, 1) * 255, 0, 255).astype(np.uint8)
        im = Image.fromarray(a)
    return im.convert("RGB")


def saturn_tone(a):
    """Recolour by luminance between Cassini natural-colour endpoints."""
    lum = a.astype(np.float64).mean(axis=2) / 255.0
    lum = (lum - lum.min()) / max(lum.max() - lum.min(), 1e-6)
    dark = np.array([150, 120, 82.0]); light = np.array([238, 222, 186.0])
    lum = np.clip((lum - 0.5) * 1.6 + 0.5, 0, 1) ** 0.9  # the source bands are faint; lift them a little
    out = dark[None, None, :] + (light - dark)[None, None, :] * (0.15 + 0.85 * lum[..., None])
    return np.clip(out, 0, 255).astype(np.uint8)


def desat(a, keep=0.3):
    """Cassini's colour mosaics are IR/green/UV composites with stretched
    colour; these moons are close to grey to the eye. Keep a hint of it."""
    f = a.astype(np.float64)
    lum = f.mean(axis=2, keepdims=True)
    return np.clip(lum + (f - lum) * keep, 0, 255).astype(np.uint8)


def soften(a, amount=0.35):
    """Pull an over-stretched map's contrast back toward its mean."""
    f = a.astype(np.float64)
    m = f.mean(axis=(0, 1), keepdims=True)
    return np.clip(m + (f - m) * (1 - amount), 0, 255).astype(np.uint8)


TRANSFORMS = {"saturn_tone": saturn_tone, "desat": desat, "soften": soften}
OP_NOTES = {
    "saturn_tone": "recoloured by luminance toward Cassini natural colour",
    "desat": "colour saturation reduced to 30% (source is an enhanced IR/green/UV composite)",
    "soften": "contrast reduced 35% toward the mean",
}


def fill_polar_gaps(a, thresh=14):
    """Fill near-black no-data runs touching the top/bottom edge of each
    column. The fill colour is the first valid pixel a few rows in from
    the gap, smoothed along the row (wrapping in longitude), so the
    filled caps read as a soft continuation instead of per-column bars."""
    lum = a.astype(np.float64).mean(axis=2)
    h, w = lum.shape
    tops = np.zeros(w, int); bots = np.full(w, h - 1)
    for x in range(w):
        col = lum[:, x]
        t = 0
        while t < h and col[t] <= thresh:
            t += 1
        b = h - 1
        while b >= 0 and col[b] <= thresh:
            b -= 1
        tops[x], bots[x] = min(t, h - 1), max(b, 0)
    if tops.max() == 0 and bots.min() == h - 1:
        return a
    inset = max(2, h // 100)  # skip the ragged mosaic edge itself
    def edge_colours(rows):
        c = a[np.clip(rows, 0, h - 1), np.arange(w)].astype(np.float64)
        k = max(3, w // 16)
        pad = np.concatenate([c[-k:], c, c[:k]])
        ker = np.ones(k) / k
        return np.stack([np.convolve(pad[:, ch], ker, "same")[k:-k] for ch in range(3)], axis=1)
    top_c = edge_colours(tops + inset)
    bot_c = edge_colours(bots - inset)
    for x in range(w):
        if tops[x] > 0:
            a[:tops[x] + inset, x] = top_c[x]
        if bots[x] < h - 1:
            a[bots[x] - inset + 1:, x] = bot_c[x]
    return fill_polar_holes(a, thresh)


def fill_polar_holes(a, thresh):
    """Near-black no-data patches poleward of 60 degrees that don't touch
    the map edge (Callisto's south pole): replace with the median of the
    row's valid pixels."""
    lum = a.astype(np.float64).mean(axis=2)
    h = a.shape[0]
    band = h // 6  # 60 to 90 degrees
    for y in list(range(band)) + list(range(h - band, h)):
        bad = lum[y] <= thresh
        if bad.any() and (~bad).sum() > a.shape[1] // 4:
            a[y, bad] = np.median(a[y, ~bad], axis=0)
    return a


def main():
    os.makedirs(OUT, exist_ok=True)
    only = set(sys.argv[1:])
    manifest_path = os.path.join(OUT, "manifest.json")
    manifest = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {}
    for src in SOURCES:
        name = src["file"]
        if only and name not in only:
            continue
        try:
            im = to_rgb8(Image.open(io.BytesIO(fetch(src["url"]))))
        except Exception as e:  # one bad source shouldn't stop the rest
            print(f"{name}: FAILED ({e})", flush=True)
            continue
        width = src["width"]
        if im.width > 4 * width:  # shrink huge mosaics before the per-column pass
            im = im.resize((2 * width, im.height * 2 * width // im.width), Image.LANCZOS)
        a = fill_polar_gaps(np.asarray(im).copy())
        for o in src.get("ops", []):
            a = TRANSFORMS[o](a)
        im = Image.fromarray(a).resize((width, width // 2), Image.LANCZOS)
        path = os.path.join(OUT, name + ".jpg")
        im.save(path, quality=86, optimize=True, progressive=True)
        manifest[src["body"]] = {
            "file": f"data/images/textures/{name}.jpg",
            "title": src["title"], "credit": src["credit"], "license": src["license"],
            "sourcePage": src["page"], "downloadedFrom": src["url"],
            "processing": ["resized to %dx%d" % (width, width // 2), "polar no-data filled"]
                          + [OP_NOTES[o] for o in src.get("ops", [])],
        }
        print(f"{name}: {width}x{width // 2}, {os.path.getsize(path) // 1024} KB", flush=True)
        time.sleep(3)  # be polite to upload.wikimedia.org
    with open(manifest_path, "w") as f:
        json.dump(dict(sorted(manifest.items())), f, indent=1, ensure_ascii=False)
        f.write("\n")
    write_credits_table(manifest)


def write_credits_table(manifest):
    """Regenerate the surface-map table in docs/CREDITS.md (between the
    maps:start / maps:end markers) from the manifest."""
    path = os.path.join(ROOT, "docs", "CREDITS.md")
    doc = open(path).read()
    start, end = "<!-- maps:start -->", "<!-- maps:end -->"
    if start not in doc or end not in doc:
        print("docs/CREDITS.md: markers missing, table not written")
        return
    rows = ["| Body | Map | Credit | Licence | Processing here |", "|---|---|---|---|---|"]
    for body, m in sorted(manifest.items()):
        esc = lambda x: str(x).replace("|", "\\|")
        rows.append(f"| {body} | [{esc(m['title'])}]({m['sourcePage']}) | {esc(m['credit'])} | "
                    f"{esc(m['license'])} | {esc('; '.join(m['processing']))} |")
    table = "\n".join(rows)
    a, b = doc.index(start) + len(start), doc.index(end)
    open(path, "w").write(doc[:a] + "\n" + table + "\n" + doc[b:])


if __name__ == "__main__":
    main()
