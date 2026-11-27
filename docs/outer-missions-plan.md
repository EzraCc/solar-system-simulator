# Plan: missions beyond Pluto, estimated paths, and data citations

**Status:** plan, from the maintainer's notes of 2026-11-27. Items 3 and 4
(estimated-path styling and trajectory data sources) are built first,
because every flight from here on uses them. Listed in `docs/TODO.md` §5.

## 1. A heliosphere layer for missions past Pluto

Voyager 1 and 2, Pioneer 10 and 11 and New Horizons travel far beyond
Pluto. The Solar System view can't zoom out indefinitely to follow them,
but showing how far out they are is part of their story.

**Idea (maintainer):** a third zoom layer, the way the planet-system view
sits below the Solar System view:

```
planet system  →  Solar System (Sol view)  →  heliosphere
   (moons)          (planets, out to ~50 AU)    (~1–200 AU, log-ish)
```

- **What it shows:** the Sun, Pluto's orbit as the edge of the familiar
  Solar System, and the termination shock (~85–95 AU), heliopause
  (~120 AU, crossed by Voyager 1 in 2012 and Voyager 2 in 2018) and bow
  region. Most inner planets are hidden or collapsed into the centre,
  much as the Solar System view hides a planet's moons.
- **Handover:** a spacecraft that passes Pluto's orbit goes "out of
  zone" in the Sol view, the same way a craft disappears from the Sol
  view when it enters orbit inside a planet system. It's drawn in the
  heliosphere layer instead.
- **Data:** Horizons has Voyager 1 (−31), Voyager 2 (−32), Pioneer 10
  (−23), Pioneer 11 (−24) and New Horizons (−98) to the present and
  beyond. The boundary crossings should cite the papers that reported
  them.

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
