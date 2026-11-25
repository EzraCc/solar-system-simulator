# Trajectory validation tooling

Optional dev-only tooling. **Not part of the shipped site** — the browser
app has no server component and never touches Python; nothing here is a
runtime dependency.

Scripts:

- `check_horizons.py` — **the trajectory verifier.** Compares the position
  the app actually renders for each leg against real JPL Horizons ephemeris.
  See its own section below.
- `split_leg_horizons.py` — the fix for a leg `check_horizons.py` shows is
  wrong: splits it through real Horizons waypoints automatically.
- `validate_trajectories.py` cross-checks this project's from-scratch
  orbital-mechanics math (`src/js/app.js`'s Lambert solver and gravity-assist
  turn-angle geometry) against an independent reference: [hapsira](https://github.com/pleiszenburg/hapsira)
  (an actively maintained fork of `poliastro`) for the Lambert transfers, and
  a from-scratch vector check of the one hard physical invariant of an
  idealized flyby (v-infinity magnitude conserved) for gravity assists.
- `check_lambert_sweep.py` screens the whole flight catalog for a real,
  structural limitation of that same Lambert solver — see its own section
  below, and read its docstring before trusting its output.

## `check_horizons.py` — real-ephemeris verification

For every Lambert leg of a flight, samples the position the app really
uses for the spacecraft (`window.__VERIFY__.computeMultiLegPosition`, the
same call the render loop makes) and compares it with JPL Horizons'
heliocentric ecliptic-J2000 position at the same instants. Reports the
worst separation per leg and how the leg is drawn (plain Lambert arc,
patched-conic propagation, or not drawn at all because `getGAChain`
rejected the fit). Spacecraft IDs live in `horizons_ids.json`; responses are
cached in `tools/.horizons_cache/` (gitignored). Needs Playwright, like the
sweep script; no other dependencies.

```sh
python3 tools/check_horizons.py                   # every flight with an ID
python3 tools/check_horizons.py psp bepicolombo   # just these
python3 tools/check_horizons.py --samples 40 --json out.json
```

Rough reading: under 0.05 AU matches (invisible at normal zoom); 0.05–0.15 AU
is approximate, usually unmodeled ion/SEP thrust or a long outer-system leg;
over 0.15 AU is a wrong shape, so fix it with `split_leg_horizons.py`.

As of 2026-11-17, all 466 legs with Horizons coverage are under 0.15 AU and
446 are under 0.05 AU. Not checkable: Hayabusa (Horizons only has it from
2009 on), Nozomi's 1998 lunar-swingby phase, and Tianwen-2 (no ephemeris
published; its cruise uses clearly labeled synthetic waypoints instead).

## `split_leg_horizons.py` — waypoint splitting

```sh
python3 tools/split_leg_horizons.py psp 10 --dry-run   # show planned waypoints
python3 tools/split_leg_horizons.py psp 10             # rewrite data/flights/psp.json
```

Walks Horizons' 6-hourly positions across the leg and drops a `fixedPos`
waypoint whenever the real spacecraft has swept 90° around the Sun or 150
days have passed (both adjustable), so every piece is unambiguous for the
zero-revolution solver. Automatically clips to the spacecraft's Horizons
coverage: ephemeris usually starts hours after launch, and an active
mission's predicted trajectory may end before the leg does, in which case
the last available point becomes the final waypoint. Writes an explanatory
`_comment` on the first new piece. Splitting a leg can change the incoming
velocity at the *next* gravity assist and so shift later patched legs, so
always re-run `check_horizons.py` on the whole flight afterwards. The
flight-profile timeline in the app merges each waypoint chain back into a
single coast entry, so splitting doesn't clutter the UI.

## Planet-system views (Mercury, Venus, Mars, Jupiter, Saturn, Pluto)

Two ways to model a spacecraft in a planet's system:

- **Tours, arc by arc:** `build_planet_tour.py <flight> --primary <planet> --start <arrival> --stop <end>`
  builds `planetocentric` legs from Horizons. It finds every periapsis and
  every moon flyby (closest approach refined to 1 s) and keeps pieces under
  60° / 8 days. Used for Juno, Galileo, Europa Clipper, Cassini (Saturn) and
  New Horizons (Pluto; `--flyby-km 40000 --merge-min 5`, so the Pluto and
  Charon closest approaches 13 minutes apart both stay waypoints).
- **Orbiters, as fitted orbit phases:** `build_orbit_phases.py <flight> --primary <planet> --arrival <date> --stop <end>`
  writes a `planetOrbit` block: windows (default 30 days) of mean elements
  with secular rates, fitted to Horizons in the app's moon model, each
  halved until its worst error is under max(30 km, 1% of a). Aerobraking
  and maneuvers end up in short windows automatically. Used for MESSENGER,
  BepiColombo, Venus Express, Akatsuki and the Mars orbiters, which circle
  too often (a Mars orbiter makes ~12 revolutions a day for decades) to
  draw arc by arc. Phase times are UTC, the app's clock (Horizons vector
  times are TDB, ~64–69 s off).
- `check_orbit_phases.py [flight ...]` samples fitted orbiters in the app
  at random times and reports the error against Horizons in km.
- `build_tour_from_flybys.py tools/tours/<schedule>.json` (needs
  `tools/.venv` for hapsira's multi-revolution Izzo solver) builds a tour
  from a published flyby schedule when no ephemeris exists. Used for JUICE,
  with `tools/tours/juice_crema52.json`. See the script's docstring for the
  method and its limits.
- `fit_moon_elements.py <moon id> <planet id>` fits a moon's elements to
  Horizons in exactly the app's moon model, with M0 shifted to UTC. Options:
  `--pole RA DEC` fits in the planet's equatorial frame (output carries
  `refPoleRaDec`), for moons that precess about the equator (Phobos, Deimos,
  Saturn's inner moons). `--nodal-guess` / `--apsidal-guess` seed fast
  precession (Phobos: 826 / 413 days). Used for the Galilean, Saturnian and
  Martian moons and Charon.
- `check_horizons.py` checks planetocentric legs in the planet's frame and
  reports errors in km.

**Environment note (fixed 2026-11-17):** the old `tools/.venv` had numpy 1.26, which
predates Python 3.14. It silently corrupted results on large arrays, and its scipy optimizer did
nothing. The venv is now rebuilt from `requirements.txt` (numpy 2.5, scipy 1.18, matplotlib 3.11),
and all of that works. If you ever rebuild it, install from `requirements.txt`, not bare `hapsira`,
then run `tools/.venv/bin/playwright install chromium-headless-shell` -- a newer Playwright
needs its own browser build, and the checkers fail to launch without it.

## `timeline_data.py` — mission timeline phases

Writes each flight's `timeline` block: the phases its legs can't express
(orbit end dates, landings, surface operations, losses, impacts). The app
merges these with what the legs already give (launch, gravity assists,
fitted orbits, planet tours, moon flybys) to draw a body's mission
timeline (the "See timeline" button on a body's info panel). Edit the
table in the script and rerun; only the `timeline` block of each listed
flight is touched, as text, so the rest of the file stays as it was.

    python3 tools/timeline_data.py

## `build_textures.py` — surface maps for the sphere renderer

Downloads public-domain surface maps (NASA / JPL / USGS) and writes them to
`data/images/textures/<name>.jpg`: equirectangular, 2:1, power-of-two
sizes (WebGL 1 can only mipmap those), longitude 0 at the centre with east
to the right. Polar no-data margins are filled from the nearest valid
pixel. Sources and the features used to check each map's longitude are
listed at the top of the script.

```
tools/.venv/bin/python tools/build_textures.py            # all
tools/.venv/bin/python tools/build_textures.py europa io  # some
```

To add a body: a row in `SOURCES` here, an entry in `SPHERE_TEXTURES` in
app.js, and an orientation (`BODY_ROTATION` for a planet; Galilean-style
locked moons get theirs from their orbit).

## `check_lambert_sweep.py` — multi-revolution screening

> For flights with a Horizons ID, prefer `check_horizons.py`. This script
> measures `getSolvedLeg`'s plain Lambert solve, which for any leg after a
> gravity assist is usually *not* what the app draws, so its ratios can
> look alarming (e≈1.0) for legs that render correctly.


`solveLambertUniversal` in `src/js/app.js` only ever solves for a
**zero-revolution** transfer: given two positions and a time of flight, it
always finds *some* orbit connecting them assuming less than one full lap
around the Sun. If the real spacecraft actually took more than one lap, the
solver doesn't error — it silently returns a different, wrong orbit that
still happens to satisfy the same two endpoints and time-of-flight. Two real
instances of this shipped and went unnoticed until visually spotted (Solar
Orbiter's first leg, NEAR Shoemaker's post-Earth-flyby leg — both fixed by
splitting the leg through real JPL Horizons waypoints; see `CHANGELOG.md`).

This script automates the *screening* step of finding more: for every
Lambert leg in the catalog, it computes the ratio of (leg duration) to (the
solved orbit's own Keplerian period). A ratio near or above 1.0 means the
transfer took about as long as its own orbit's natural period — the regime
where "did this only take one lap" becomes doubtful.

**Read the script's own docstring before treating its output as a bug
list.** It's a heuristic, not a verifier: many real multi-gravity-assist
missions (PSP, BepiColombo, JUICE, Rosetta, Solar Orbiter) legitimately fly
long, resonant, near-one-lap coast legs by design, and look identical to a
genuine bug from inside the app. Confirming a flagged leg one way or the
other requires an independent source of truth — cross-checking against real
ephemeris (JPL Horizons, if the mission has a spacecraft target ID) the same
way the two known bugs were found.

Requires Playwright (a browser automation library, not just an HTTP
client) rather than plain `requests`, because it needs the app's Lambert
solver to actually run in a JS engine:

```sh
pip install playwright
playwright install chromium
python3 tools/check_lambert_sweep.py                    # whole catalog
python3 tools/check_lambert_sweep.py bepicolombo lucy    # just these flights
python3 tools/check_lambert_sweep.py --threshold 0.5     # lower the bar
```

Run this whenever adding or editing a multi-leg flight's Lambert legs,
especially any leg with a duration measured in months rather than weeks.

## `validate_trajectories.py`

## Setup

```sh
python3 -m venv tools/.venv
tools/.venv/bin/pip install -r tools/requirements.txt
```

`hapsira` publishes a pure-Python wheel, so this installs cleanly on any
Python 3.8+ with no compiler needed. (`pykep` — the one library with a
dedicated multi-gravity-assist module — only ships prebuilt wheels through
Python 3.13 and would need its C++/boost core built from source on newer
interpreters; not worth the added fragility for a verification-only tool.)

Note: `hapsira`'s higher-level `Orbit`/`Ephem` classes currently fail to
import against recent `astropy` releases (an internal function they
depend on, `matrix_product`, was renamed upstream). This script only uses
the lower-level `hapsira.iod.izzo.lambert` solver directly, which is
unaffected.

## Regenerating the input data

`validation_data.json` is a one-time dump from the app's own headless Node
test harness (see the session's established pattern: copy `app.js`, inject
a `globalThis.__DEBUG__`-gated hook before `requestAnimationFrame(frame)`
in `bootstrap()`, run under Node with `data/` served locally) -- predates
the permanent `window.__VERIFY__` hook the app now ships with (see
`check_lambert_sweep.py`'s section above), which covers most of what a
fresh regeneration would need without the copy/inject step; extend that
hook's exposed function list in `app.js`'s `bootstrap()` if the fields
below need refreshing, rather than reaching for the old Node pattern. It is
**not** regenerated automatically — this script only reads it. To refresh
it (e.g., after changing which legs/flybys to validate, or after a real
physics change to `app.js`), re-run that extraction pattern to dump:
- `legs`: for each test leg, `r1_AU`/`r2_AU` (real ephemeris positions at
  the leg's actual depart/arrival dates), `tofDays`, and the app's own
  `getSolvedLeg` velocity at both ends (via `computeFlightVelocity`).
- `gaEvents`: for each test flyby, `getGAEvents`' own `speedInKmS`/
  `speedOutKmS`, plus the actual incoming/outgoing heliocentric velocity
  **vectors** (`velIn_AUday`/`velOut_AUday`, from the preceding/following
  leg's elements evaluated at the flyby date via `getGAChain`).
- `planetStates`: each flyby planet's own heliocentric position/velocity
  at the flyby date (`computeStateVector`), for converting to/from the
  planet's own reference frame.

## Running

```sh
tools/.venv/bin/python3 tools/validate_trajectories.py
```

Prints a pass/fail table. As of this writing: all checks pass, with
Lambert velocities matching hapsira to ~1e-10 km/s (floating-point noise,
not a meaningful discrepancy) and gravity-assist v-infinity conserved to
0.00% across every tested flyby.

If a real discrepancy ever turns up, treat it as a genuine bug report
against `src/js/app.js`, the same as any other verified finding.
