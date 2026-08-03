# Solar System Simulator

A browser-based, real-physics 3D orbital mechanics visualizer covering 57
real interplanetary missions — from Phobos 1 (1988) to MMX and Tianwen-2 —
plus the full solar system (planets, major moons, dwarf planets, asteroids,
and comets), rendered with a from-scratch Keplerian/Lambert physics engine.
No game engine, no physics library, no build step: it's a single HTML page,
one JS file, and per-mission JSON data files, doing real orbital mechanics
in plain JavaScript on a 2D canvas.

Every trajectory is either solved from real launch/arrival dates via a
universal-variable Lambert solver, patched through real gravity-assist
flybys, or — where telemetry doesn't cleanly fit a single arc (long coasts,
resonant flybys, ion-thrust cruises) — reconstructed through real recorded
spacecraft positions (JPL Horizons) so the rendered path matches where the
mission actually was, not just a smooth idealized curve between two points.

## Running it

There's no build step and no server-side code. Any static file server works:

```sh
python3 -m http.server 8000
# open http://localhost:8000/index.html
```

Opening `index.html` directly via `file://` will not work — the app fetches
`data/*.json` at startup, which browsers block under `file://` for security
reasons.

## Features

- **57 real missions**, each with a physically solved trajectory, launch
  vehicle, significance write-up, and (where available) real mission
  photography.
- **Gravity-assist chains**: multi-flyby missions (BepiColombo's 9 flybys,
  JUICE, Parker Solar Probe's 7 Venus passes, New Horizons, Lucy, etc.) are
  patched through real flyby dates/altitudes, not a single smoothed curve.
- **A video-style flight scrubber**: drag through a selected mission's own
  timeline, with markers for gravity assists, orbit insertions, loiters,
  and other notable events (e.g. Ulysses' three unplanned comet-tail
  crossings), each with a short label and a fuller plain-English
  explanation in the mission's Flight Profile section.
- **Small bodies**: asteroids, comets, and dwarf planets — including
  long-period/hyperbolic comets (e.g. the three Ulysses flew through the
  tail of) via a proper hyperbolic-orbit branch, not just closed ellipses.
  Bodies can carry more than one classification (e.g. Ceres is both an
  asteroid and a dwarf planet).
- **Scene Framing**: a free-camera mode that stops the camera
  auto-following the tracked body, plus a live zoom/rotation/tracking
  readout — useful for lining up a specific shot or screenshot. Manually
  panning while a body is tracked turns this on automatically (the same
  as toggling "Hold camera frame" by hand), since dragging the screen is
  an unambiguous "let me control the view now"; rotating around a tracked
  body works freely either way.
- **Coordinate reference overlay**: clicking Sol shows the three XY/XZ/YZ
  planes of this app's own coordinate system (see "Coordinate system"
  below) plus a static arrow for the real direction the solar system
  orbits the Milky Way's center — a fixed astronomical fact, not derived
  from Sol's own (deliberately zero, in a heliocentric model) velocity.
- **Dashboard (desktop/laptop only for now)**: a "Dashboard" button
  (appears once a body or flight is locked, next to Reset view/Stop
  tracking) slides up a small panel alongside the still-visible scene.
  First widget: a velocity hodograph — the classic orbital-mechanics plot
  of the velocity vector's tip, which traces a perfect circle for any
  2-body Keplerian orbit no matter how eccentric the position-space path
  is, labeled with which body that velocity is measured relative to
  (Sol, almost always, today). Built to hold more widgets later.
  During a real gravity-assist flyby's sphere-of-influence transit, a
  second widget appears alongside the first showing the flyby body's own
  local (planetocentric) hodograph live; during a body-orbit leg (a
  parking/apogee-raising phase), a small toggle instead switches the
  primary widget between planet-relative and Sol-relative.
- **Mobile support**: full touch input (rotate/pinch-zoom/pan), a
  slide-out legend drawer, and a full-screen info panel on small screens.
- **URL permalinks** — see below.
- Toggles for comparing true relative sizes, focused-vs-broad scene
  visibility, full-path-vs-current-orbit-only trajectory display, and
  auto-vs-manual info panel behavior.

## Controls

- **Drag** to rotate the camera; **shift+drag** (or right-drag) to pan;
  **scroll** to zoom.
- **Click** a body, orbit line, or flight path to select/track it.
- **Space** to play/pause. Playback speed is adjustable via the slider, or
  by clicking the "N yr/min" readout to type a value directly (e.g. `2`,
  `-0.5`) — years of simulated time per real minute.
- **`` ` `` (backtick)** toggles the Scene Framing readout.

## URL parameters

The current view state is reflected in the URL as you interact, so a
specific view can be bookmarked or shared:

| Param | Values | Effect |
|---|---|---|
| `flight` | a flight key (e.g. `ulysses`) | Selects that mission on load |
| `body` | a body's display name | Locks/tracks that body on load |
| `date` | `YYYY-MM-DD` | Sets the simulated date (paused) on load |
| `focus` | `focused` | Starts in Focused view (only the selected/locked mission's traffic shows) |
| `info` | `manual` | Starts in manual info-panel mode |
| `hold` | `1` | Starts with the camera held (not auto-following) |

## Project structure

```
index.html              Page shell, all UI markup
src/js/app.js            Everything else: physics, rendering, UI logic
src/css/style.css        Styling
data/flights/            One JSON file per mission, plus manifest.json
                          (the single source of truth for which missions
                          are included — app.js has no hardcoded list)
data/bodies/              Static per-body info (descriptions, links)
data/images/               Mission/rocket/body photography
tools/                    Optional dev-only trajectory validation (see tools/README.md)
docs/                    Design specs for prior feature extensions
```

### Data model, briefly

- A mission is either a **flat-schema** flight (`launchBody`/`launchDate`/
  `destinationBody`/`arrival` — a single Lambert arc) or a **multi-leg**
  flight (a `legs` array mixing `lambert`, `gravity_assist`,
  `geocentric_orbit`, and `loiter` segments). Waypoints can be a real body
  name or a `{ "fixedPos": [x, y, z] }` heliocentric AU coordinate, used to
  anchor a leg to a real recorded spacecraft position when a straight
  Lambert solve between two dates would misread a long or multi-revolution
  real coast.
- A flight can also carry a `milestones` array: point-in-time, purely
  informational events (not trajectory legs) with a short label and a
  plain-English paragraph — used for things like Ulysses' comet-tail
  crossings, which happened mid-coast and have no bearing on the solved
  path.
- Small bodies (`SMALL_BODIES` in `app.js`) carry classical orbital
  elements at a given epoch and a `types` array (e.g.
  `['asteroid', 'dwarf_planet']` for Ceres) rather than a single fixed
  category.

## Coordinate system

Every position in this app is in a **heliocentric ecliptic J2000** frame —
the standard used throughout real ephemeris data (JPL, Standish), not
something invented for this project:

- **Origin (0, 0, 0)**: the Sun's center, hardcoded fixed there. This is a
  heliocentric model, not barycentric — the Sun doesn't move, not even
  the small real wobble planetary gravity actually causes.
- **Z = 0 plane**: the ecliptic (Earth's own orbital plane) at the
  J2000.0 epoch (2000-01-01 12:00 TT). +Z points toward ecliptic north.
- **X axis (0° longitude)**: the J2000.0 vernal equinox ("First Point of
  Aries") — frozen at its year-2000 orientation rather than tracking the
  real ~26,000-year precession, the standard convention modern ephemeris
  data uses.
- **Y axis**: 90° from X within the ecliptic plane, completing a
  right-handed system.

Click Sol in the app to see these three planes and axes drawn directly,
along with a static arrow for the real direction the solar system orbits
the Milky Way's center — a fixed astronomical fact (not derived from
Sol's own velocity, which is exactly zero in this heliocentric model by
construction).

## Physics notes

- Planetary/lunar positions use real mean orbital elements plus
  centennial precession rates (J2000 epoch), not a fixed ellipse.
- Interplanetary transfers are solved with a universal-variable Lambert
  solver supporting multiple revolutions, matched to the documented real
  transfer type (e.g. Magellan's Type IV, ~1.5-orbit transfer) where no
  telemetry exists to fit against directly.
- Gravity assists are patched-conic: real periapsis altitude, real
  incoming/outgoing heliocentric velocity vectors, with actual v-infinity
  conservation.
- Comets/asteroids close to or past parabolic (e ≥ 1) use a genuine
  hyperbolic-orbit propagator, not an approximation.
- This is a pure two-body Keplerian model — no N-body perturbation, no
  non-gravitational (outgassing) forces, no relativistic correction. For
  short-lived flyby targets this is negligible; for longer time spans
  between a body's orbital-element epoch and the date actually needed, real
  JPL Horizons state vectors are used to re-epoch rather than letting
  propagation error accumulate.
- `tools/validate_trajectories.py` independently cross-checks the Lambert
  solver and gravity-assist geometry against a third-party orbital
  mechanics library — see `tools/README.md`.

## Status

Actively developed. See `CHANGELOG.md` for what's shipped and
`docs/project-transfer.md` for longer-range direction and prior design
decisions.
