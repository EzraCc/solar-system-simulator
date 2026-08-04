# Trajectory validation tooling

Optional dev-only tooling. **Not part of the shipped site** — the browser
app has no server component and never touches Python; nothing here is a
runtime dependency.

Two scripts:

- `validate_trajectories.py` cross-checks this project's from-scratch
  orbital-mechanics math (`src/js/app.js`'s Lambert solver and gravity-assist
  turn-angle geometry) against an independent reference: [hapsira](https://github.com/pleiszenburg/hapsira)
  (an actively maintained fork of `poliastro`) for the Lambert transfers, and
  a from-scratch vector check of the one hard physical invariant of an
  idealized flyby (v-infinity magnitude conserved) for gravity assists.
- `check_lambert_sweep.py` screens the whole flight catalog for a real,
  structural limitation of that same Lambert solver — see its own section
  below, and read its docstring before trusting its output.

## `check_lambert_sweep.py` — multi-revolution screening

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
tools/.venv/bin/pip install hapsira
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
