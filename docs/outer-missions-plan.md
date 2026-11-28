# Plan: missions beyond Pluto, estimated paths, and data citations

**Status:** plan, from the maintainer's notes of 2026-11-27. Items 3 and 4
(estimated-path styling and trajectory data sources) are built first,
because every flight from here on uses them. Listed in `docs/TODO.md` §5.

## 1. A heliosphere layer for missions past Pluto

**Status: built 2026-11-27.**

Voyager 1 and 2, Pioneer 10 and 11 and New Horizons travel far beyond
Pluto. The Solar System view can't zoom out indefinitely to follow them,
but showing how far out they are is part of their story.

```
planet system  →  Solar System (Sol view)  →  heliosphere
   (moons)          (planets, out to ~50 AU)    (~1–200 AU)
```

- **Entering it:** zoom out past the Solar System view's limit, use the
  "Heliosphere view" button (top-right toggles), the "Open heliosphere
  view" button in a far craft's info panel, or `?system=Heliosphere`.
  Leave with "← Solar System" or Esc. The time flag reads "Heliosphere".
- **Scale:** square root (a point at r AU sits at sqrt(r / 200) of the
  layer's radius), with rings at 1, 10 and 100 AU, so the outer planets and
  craft at 170 AU both read.
- **What it shows:** the Sun; the orbits of Jupiter to Neptune (the inner
  planets are left out); Pluto's orbit as the edge of the familiar Solar
  System; the Sol view's edge for far craft (1.1 × Pluto's aphelion,
  54.514 AU); the termination shock and heliopause; and every flight with a
  `heliospherePath`.
- **Handover:** a craft's Sol-view legs end where it passes 54.514 AU
  (`tools/build_voyager.py`), and its info panel reads "Continues in the
  heliosphere view". The layer draws the whole outward path: the inner part
  sampled from the craft's legs (faint), then `heliospherePath`, solid up to
  its `measuredUntil` date and dashed after (§3).
- **`heliospherePath`** (per flight, written by
  `tools/build_heliosphere_path.py <flight> --id <Horizons id> --start <cutoff
  crossing> --end 2050-01-01 --measured-until <date>`):
  `{ source, url, measuredUntil, note, points: [[ISO date, x, y, z], ...] }`,
  heliocentric ecliptic J2000 AU from JPL Horizons, every 60 days by default.
  `measuredUntil` is the last contact for a silent craft, or today's date
  for one still in contact (both Voyagers: 2026-11-27).
- **Boundaries:** drawn through the four measured crossings, at each craft's
  own Horizons position on the crossing date:

  | Crossing | Date | Distance | Source |
  |---|---|---|---|
  | Voyager 1, termination shock | 2004-12-16 | 94.0 AU | Stone et al. 2005, *Science* 309 |
  | Voyager 2, termination shock | 2007-08-30 | 83.7 AU | Stone et al. 2008, *Nature* 454 |
  | Voyager 1, heliopause | 2012-08-25 | 121.6 AU | Stone et al. 2013, *Science* 341, 150 |
  | Voyager 2, heliopause | 2018-11-05 | 119.0 AU | Stone et al. 2019, *Nature Astronomy*, doi:10.1038/s41550-019-0928-3 |

  The nose points upwind into the interstellar flow, ecliptic longitude
  255.6°, latitude +5.12° (IBEX; the reverse of the downwind direction
  75.6° / −5.12° in IBEX Data Release 9). **Away from the crossings the shape
  is a schematic:** r(θ, φ) = 2 R0(φ) / (1 + cos θ) about the nose axis, with
  R0 varying in azimuth so the surface passes through both crossings of
  each boundary. The real heliosphere's tail and flanks aren't measured.
- **Still to add:** Pioneer 10/11 and New Horizons (run the tool; see
  TODO §5). The bow wave/shock beyond the heliopause isn't drawn.

## 2. Flyby galleries and discoveries of their time

For grand tours (the Voyagers, Pioneer 10/11, Galileo, Cassini), a flight
should be able to carry more than one image: one for each body it passed.
Each flyby also gets its significant findings **as understood when it
happened**, not from today's perspective. Examples: Io's active
volcanoes (Voyager 1, 1979), Jupiter's faint rings (Voyager 1, 1979),
Uranus's tilted magnetic field (Voyager 2, 1986), Triton's geysers
(Voyager 2, 1989).

- **Data model (proposed):** `assets.flybys: [{ body, date, image,
  findings: [{ text, source }] }]` beside the existing
  rocket/spacecraft/lander tiles. Images follow the same rules as now:
  NASA Image Library first, credit under each tile, link-only tile when
  nothing is freely licensed.
- **One image per body in the app; the full galleries link out**
  (maintainer, 2026-11-27). The carousel carries a single image for each
  body passed. Below it, a "More images" line links to the mission's own
  galleries off the app, for example NASA's Voyager galleries
  (https://science.nasa.gov/mission/voyager/galleries-overview/, with
  per-planet galleries) and the JPL Photojournal
  (https://photojournal.jpl.nasa.gov/mission/Voyager) for full-resolution
  files. Proposed field: `assets.galleryLinks: [{ title, url }]` on the
  flight; usable by any mission with a NASA or agency gallery, not just
  grand tours.

## 3. Calculated paths drawn dashed

**Rule (maintainer, 2026-11-27; applies to every flight):** a path is
solid only when measured trajectory data stands behind it; otherwise it's
dashed. "If we need to add a different path type to signify another
state, we'll do so."

- **Solid:** built from measured positions (JPL Horizons ephemeris, NASA
  SPDF/SSCWeb data, published tracking waypoints), or calculated and then
  checked against such data and found within about 0.02 AU (pinned to it
  with `tools/split_leg_horizons.py` where a leg drifts).
- **Dashed (`"estimate": true`, on a single-arc flight or on each leg):**
  calculated with no measured data to check it against. That covers
  two-body arcs between published launch, flyby and arrival times (most
  pre-1988 and Soviet, Japanese and Chinese missions), orbits built from
  published elements, projections after contact ended, and unofficial
  trajectories (Tianwen-1's volunteer-fitted Horizons record). For
  reference, arcs calculated this way for modern direct flights fall within
  about 0.002 AU of their Horizons trajectories.
- The flight panel's "Trajectory data" section explains the dashes, and
  each flight's note says which parts are calculated.
- Dashed paths that lap the same orbit many times need legs that are an
  exact fraction of the period, or the laps' dashes fill each other's gaps
  (`build_solar_orbit_i.py`, `build_solar_orbit_h.py`, `build_helios.py`).

## 3a. Dead craft are off the map

**Rule (maintainer, 2026-11-27):** "If a craft goes silent and does not
revive, like Pioneer 11, end it where it was last believed to be at the
time of last communication. If it comes back online (voyagers sometimes
glitch out and come back) then we add it when it happens. If it's dead,
it's off the map."

- A dead craft's flight carries `"lastContact"` (date, time when known) and
  `"lastContactSource"`. Its path data stops there: the last leg is cut at
  the craft's position at that moment on its existing path (solid or dashed
  as before), and nothing is projected beyond it, in the Sol view, the
  planet views or the heliosphere layer.
- The app also uses `lastContact` directly: no marker or visibility after
  it, no heliosphere position after it, and the craft's colour is freed
  then (history after it, such as Venera 3's silent impact, stays on the
  timeline and in the notes).
- The panel reads "Contact lost" with the date when the path ends there, or
  adds a "Last contact" row otherwise.
- A craft that comes back is extended when it happens; a craft still in
  contact has no `lastContact`.

## 4. Trajectory data sources, cited like images

Every flight lists where its trajectory comes from, with links, so
people can compare our path with the original.

- **Field:** `dataSources: [{ title, url, note? }]` on the flight, shown
  in the info panel as "Trajectory data".
- **Priority:** Horizons is the primary source and is considered
  definitive. Where Horizons has nothing, use what can be found:
  published orbital elements, SPDF/COHOWeb trajectory files (Helios,
  early Pioneers), NSSDCA, or mission papers. Cite each one.

## 5. Specific missions

- **Pioneer 10 and 11:** treated like New Horizons at Pluto, with full
  flyby data and planet-view tours at Jupiter (and Saturn for
  Pioneer 11), then the heliosphere layer.
- **Voyager 1 and 2:** every planet flyby with its data (time, closest
  approach, moons passed) and planet-view tours. Uranus and Neptune
  planet views are needed for Voyager 2. Then the heliosphere layer.
- **ISEE-3/ICE:** model the L1 halo period as a pause at Sun–Earth L1
  (the `loiter` leg ESCAPADE uses), then its lunar flybys (lunar gravity
  assists already work; STEREO-A uses one), then Giacobini–Zinner and
  the distant Halley pass. Horizons has it as −111. If the lunar flyby
  chain needs more than a pause and gravity assists, defer it until the
  Earth–Moon/Lagrange-point view exists.
- **Helios 1 and 2:** not in Horizons. Use NASA SPDF's Helios trajectory
  data (COHOWeb/HelioWeb heliocentric positions) as waypoints, cited in
  `dataSources`.
- **Venera flyby buses, and similar:** after their encounter they went on
  into solar orbit. The app ends a path at its destination; showing the
  coast afterwards needs a "coast" leg (propagate the last state with no
  target) and would be drawn dashed unless data exists.
