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
import io
import os
import sys
import time
import urllib.request

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "images", "textures")
UA = "solar-sim-texture-build/1.0 (educational)"
NASA3D = "https://raw.githubusercontent.com/nasa/NASA-3D-Resources/master/Images%20and%20Textures/"

# name, url, output width, note. Longitude checks, done by eye on the
# downloaded map against known features (planetocentric):
#   Jupiter  Great Red Spot near 50 W in the Dec 2000 Cassini map (it
#            drifts in System III, so this is illustrative anyway).
#   Io       Pele's red ring at 19 S 255 W, Babbar Patera at 40 S 272 W.
#   Europa   Pwyll's bright rays at 25 S 271 W.
SOURCES = [
    ("jupiter", "https://upload.wikimedia.org/wikipedia/commons/1/1e/Jupiter_Cylindrical_Map_-_Dec_2000_PIA07782.jpg",
     2048, "Cassini ISS, Dec 2000 (NASA/JPL/SSI, PIA07782)"),
    ("io", NASA3D + "Jupiter%20-%20Io%20(A)/Jupiter%20-%20Io%20(A).jpg",
     1024, "Galileo SSI / Voyager (NASA 3D Resources)"),
    ("europa", "https://upload.wikimedia.org/wikipedia/commons/2/26/Europa_Voyager_GalileoSSI_global_mosaic.jpg",
     1024, "Voyager / Galileo SSI global mosaic (USGS)"),
    ("ganymede", NASA3D + "Jupiter%20-%20Ganymede/Jupiter%20-%20Ganymede.jpg",
     1024, "Voyager / Galileo SSI (NASA 3D Resources)"),
    ("callisto", "https://upload.wikimedia.org/wikipedia/commons/9/96/Callisto_USGS_global_small.jpg",
     1024, "Voyager / Galileo SSI global mosaic (USGS)"),
]


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def fill_polar_gaps(a, thresh=6):
    """Replace near-black runs touching the top/bottom edge of each column
    with the nearest valid pixel in that column."""
    lum = a.mean(axis=2)
    h = a.shape[0]
    for x in range(a.shape[1]):
        col = lum[:, x]
        top = 0
        while top < h and col[top] <= thresh:
            top += 1
        bot = h - 1
        while bot >= 0 and col[bot] <= thresh:
            bot -= 1
        if top >= h:  # whole column empty: leave it to the neighbours
            continue
        a[:top, x] = a[top, x]
        a[bot + 1:, x] = a[bot, x]
    return a


def main():
    os.makedirs(OUT, exist_ok=True)
    only = set(sys.argv[1:])
    for name, url, width, note in SOURCES:
        if only and name not in only:
            continue
        im = Image.open(io.BytesIO(fetch(url))).convert("RGB")
        a = fill_polar_gaps(np.asarray(im).copy())
        im = Image.fromarray(a).resize((width, width // 2), Image.LANCZOS)
        path = os.path.join(OUT, name + ".jpg")
        im.save(path, quality=86, optimize=True, progressive=True)
        print(f"{name}: {width}x{width // 2}, {os.path.getsize(path) // 1024} KB  ({note})")
        time.sleep(2)  # be polite to upload.wikimedia.org


if __name__ == "__main__":
    main()
