# Trajectory validation tooling

Optional dev-only tooling. **Not part of the shipped site** — the browser
app has no server component and never touches Python; nothing here is a
runtime dependency.

`validate_trajectories.py` cross-checks this project's from-scratch
orbital-mechanics math (`src/js/app.js`'s Lambert solver and gravity-assist
turn-angle geometry) against an independent reference: [hapsira](https://github.com/pleiszenburg/hapsira)
(an actively maintained fork of `poliastro`) for the Lambert transfers, and
a from-scratch vector check of the one hard physical invariant of an
idealized flyby (v-infinity magnitude conserved) for gravity assists.

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
in `bootstrap()`, run under Node with `data/` served locally). It is
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
