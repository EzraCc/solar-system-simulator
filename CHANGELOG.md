# Changelog

All notable changes to this project, grouped by day. This project has no
version numbers (it's a continuously-deployed single-page app, not a
published package), so entries are dated instead.

## 2026-07-29 — Scene Framing, keyboard speed input, multi-tag small bodies, Ulysses' comets

- Added Ulysses' three comet tail crossings (Hyakutake, McNaught-Hartley,
  McNaught) as flight **milestones**: diamond markers on the scrubber plus
  a plain-English paragraph in the Flight Profile section, so a viewer can
  learn these happened without digging through the Small Bodies legend.
- Fixed the info panel silently dropping a selected flight when dismissed
  by clicking empty canvas space (only the panel's own X button preserved
  selection before); the scrubber's "Show info" reopen button now appears
  in both auto and manual info-panel modes, not just manual.
- Mapped the three comets Ulysses actually flew through the tail of —
  Hyakutake (1996), McNaught-Hartley (2000), McNaught (2007) — as real,
  physically-derived paths (JPL Horizons state vectors converted to
  orbital elements, verified to ~1e-13 AU), replacing what Wikipedia's own
  flattened 2D trajectory GIF can only show as static labels. Two of the
  three are genuinely hyperbolic, which required extending the small-body
  orbit propagator (`computeSmallBodyState`) with a proper hyperbolic
  branch it didn't have before.
- Fixed a flight-scrubber click-through bug (clicks on the scrubber could
  register on canvas objects behind it) and a mobile bug where rotating
  the camera stopped working entirely once a flight was selected (a touch
  drag starting anywhere on the scrubber panel — not just its track — got
  permanently stuck there instead of reaching the canvas).
- Added a **Scene Framing** panel: a live camera-state readout (zoom,
  yaw/pitch, tracking, date) plus a "Hold camera frame" toggle that stops
  the camera auto-following the tracked body, for lining up a specific
  shot.
- Small bodies can now carry more than one classification (`types`
  array) instead of a single fixed category — e.g. Ceres is both an
  asteroid and a dwarf planet.
- Playback speed became keyboard-enterable (typed values like `2` or
  `-0.5`), not slider-only.
- Fixed the flight-scrubber's event markers rendering with their visible
  center offset from the actual event date (a CSS box-model bug: a
  redundant negative margin was double-correcting for padding already
  handled by the marker's own centering transform).

## 2026-07-28 — Trajectory accuracy pass, auto/manual info panel

- Fixed several missions' trajectories where a single 0-revolution Lambert
  solve misread a long or multi-revolution real coast as a short, wrong-
  shaped hop: Magellan (hand-derived, no telemetry exists for it),
  Ulysses' post-Jupiter-flyby coast, Rosetta/Juno/Psyche's leg 0, Dawn's
  ion-thrust leg, Stardust/NEAR Shoemaker/MESSENGER's Earth-Earth (and
  Venus-Venus) loops, and Deep Space 1's ion-thrust legs — the last of
  which also exposed stale orbital-element epochs for its two flyby
  targets (Braille, Borrelly), re-epoched from real Horizons state
  vectors at the actual encounter dates.
- Added real path rendering for loiter legs (Chang'e 2, ESCAPADE's
  Lagrange-point stay).
- Added an Auto/Manual info-box mode (selecting a flight can open its
  info panel immediately or leave it closed until asked), with a mobile
  settings drawer to hold the new toggle.
- Fixed the info panel's first-open position being wrong in manual mode,
  and disabled mobile browsers' automatic text-size-adjust (was producing
  tiny/inconsistent info-panel font sizes).

## 2026-07-27 — Flight scrubber, gravity-assist path fixes

- Added a video-style flight scrubber: drag through a selected mission's
  own timeline, with markers for gravity assists and other events, hover
  tooltips, and a click-title-to-reopen affordance for the info panel.
- Redid the "current orbit only" view: fades the trailing 90°, extends
  solid 300° ahead of the current position.
- Fixed misleading gap/jump rendering artifacts on legs immediately after
  a gravity assist (JUICE, Lucy, and others), and JUICE's third
  Earth-Earth loop incorrectly bulging in toward Mercury's orbit.

## 2026-07-26 — Mission catalog expansion, path math validation, URL permalinks

- Added the first 20 pre-2001/pre-1998 missions: Nozomi, Deep Space 1,
  Mars Climate Orbiter, Mars Polar Lander, Stardust, Phobos 1/2, Magellan,
  Galileo, Ulysses, Mars Observer, NEAR Shoemaker, Mars Global Surveyor,
  Mars Pathfinder, Cassini-Huygens.
- Fixed OSIRIS-REx's and Hayabusa's near-parabolic, sun-grazing
  Earth→Earth legs.
- Mapped Akatsuki's real failed-then-recovered Venus orbit insertion, and
  added real Moon flybys to Nozomi's trajectory.
- Added independent validation tooling (`tools/validate_trajectories.py`)
  cross-checking the Lambert solver and gravity-assist geometry against a
  third-party orbital mechanics library.
- Made orbit/flight path lines directly clickable (with a hover-glow
  disambiguator for near-overlapping paths), added URL permalinks for
  bodies/flights/focus-mode/dates, and added a "Current orbit only"
  toggle.

## 2026-07-25 — Mobile support, educational content

- Built out full mobile support in phases: touch input parity, the legend
  becoming a slide-out drawer, the locked info panel becoming a
  full-screen modal (after an intermediate bottom-sheet/sidebar design),
  and repositioning persistent controls out of the modal's way.
- Added a Focused/Broad scene-visibility toggle.
- Added the educational layer: per-mission flight profiles (a plain-
  English, auto-generated breakdown of every leg/flyby/maneuver) and a
  gravity-assist glossary with animated "Watch it happen" demos.
- Fixed wildly wrong trajectory arcs for gravity-assist fits the solver
  should have rejected, and stopped drawing a fictional straight line for
  those rejected legs.
- Added real physical sizes to the info panel; modeled Dimorphos as its
  own object (not just an offset from Didymos).

## 2026-07-24 — Initial build

- Initial commit: the core orbital-mechanics simulator — real Keplerian
  planet/moon motion, a universal-variable Lambert solver for
  interplanetary transfers, and the first batch of missions.
- Added the MMX mission and moon image/significance content.
- Fixed early locked-panel bugs found in first browser testing, made the
  locked panel fully event-based (root fix for a class of broken
  navigation-link bugs), and added cache-busting for `app.js`/`style.css`/
  `data/*.json` so updates aren't served stale.
- Replaced several placeholder rocket logos with real launch photography,
  added per-flight colors, and decluttered flight trajectory rendering.

---

For the full commit-by-commit history, see `git log`. For longer-range
design decisions and direction, see `docs/project-transfer.md`.
