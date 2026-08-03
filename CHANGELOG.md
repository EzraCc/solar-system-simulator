# Changelog

All notable changes to this project, grouped by day. This project has no
version numbers (it's a continuously-deployed single-page app, not a
published package), so entries are dated instead.

## 2026-08-03 (continued) — Hodograph: sphere-of-influence-relative frames during gravity assists and body orbits

- The hodograph dashboard always showed one Sol-relative circle, even
  during a real gravity-assist flyby -- the exact moment a Sphere of
  Influence (SOI) is physically doing something interesting (the
  spacecraft's velocity relative to the flyby body is a second, genuinely
  real two-body problem, distinct from its heliocentric cruise). Added
  real SOI-transit windows (`computeGaSoiWindow`): entry/exit time
  bounds derived from each flyby's own local hyperbolic geometry
  (`flybyGeometry` now also returns `eHyp`/`rPeriKm`), not an arbitrary
  distance heuristic.
- **During a real flyby SOI transit**, a second hodograph widget card
  now appears alongside the first, showing the flyby body's own local
  (planetocentric, hyperbolic) circle live -- both visible at once,
  since forcing a single view is wrong right when comparing both is
  most interesting. Fully derived from the current date each frame, no
  stored selection state. Verified against BepiColombo's real Venus/
  Mercury encounters and Lucy's real Earth flybys; confirmed Nozomi's
  lunar swingbys correctly produce no SOI window (the Moon has no
  modeled sphere of influence) rather than crashing.
- **During a body-orbit leg** (a real `geocentric_orbit` parking/
  apogee-raising phase, e.g. Mangalyaan's real pre-TMI orbit-raising
  campaign), the primary widget now offers a small toggle between the
  existing planet-relative view and a new Sol-relative one -- the
  spacecraft's local planetocentric velocity combined with its primary
  planet's own heliocentric state, refit into instantaneous heliocentric
  orbital elements the same way a post-flyby heliocentric orbit is
  already derived elsewhere in this file. A toggle fits this case better
  than a second card: the leg is long and mostly static, not a brief
  moment worth comparing side by side.
- Some real SOI transits are very short (several of BepiColombo's real
  Mercury flybys last under an hour of sim time) -- at the default 1
  yr/min playback speed the second widget would have appeared and
  vanished in a fraction of a real second, easy to miss entirely. Added
  a speed-aware lead-in/hold-after pad around the real window so it
  stays visible for at least ~4 real seconds regardless of current
  playback speed (capped so an extreme typed speed can't balloon it
  into an adjacent leg); no padding while paused, since the real window
  is already exact and the user controls dwell time themselves. Measured
  live: previously flashed for well under a real second at 1 yr/min, now
  holds for ~4 seconds.

## 2026-08-03 — Hodograph: added a real velocity scale, fixed text overlapping the circle

- The hodograph circle was auto-fit to the widget every time, which made
  every body's circle come out roughly the same on-screen diameter
  regardless of its real speed -- flagged directly: Mercury's and
  Saturn's hodographs looked like the same magnitude despite a real ~6x
  speed difference, and the only way to tell them apart was to watch how
  fast the dot moved. Standard hodograph diagrams solve this with a
  labeled velocity scale rather than a shared/fixed pixel-per-km/s ratio
  across every diagram (which would make small-body circles too tiny to
  read); added that: concentric tick rings centered on the origin (v=0,
  since distance from there is speed) at a "nice" round km/s spacing
  chosen per body, each labeled, plus a readout line stating the ring
  spacing. Mercury now reads "rings every 20 km/s", Saturn "rings every
  5 km/s" -- same circle size, correctly different real scale, readable
  directly from the picture instead of requiring you to watch it.
- Fixed the speed/eccentricity readout text overlapping the circle: it
  was an absolutely-positioned overlay chip on top of the canvas, which
  collided with the circle once the circle got big enough to matter.
  Moved to normal document flow below the canvas instead, and made the
  widget card taller (not square) to fit that without shrinking the
  circle further. Also left a bit more empty margin around the circle
  itself so it no longer runs edge-to-edge.

## 2026-08-02 — Fixed a real body-occlusion depth bug; added a velocity-hodograph dashboard

- **Fixed a real, longstanding depth-sorting bug**: near edge-on camera
  angles, bodies that should occlude Sol (sitting between it and the
  viewer) were rendering hidden behind it, and bodies that should be
  hidden behind Sol were rendering in front of it -- backwards in both
  directions. Root cause: `bodies.sort((a,b) => a.rz - b.rz)` drew
  ascending-`rz` last (on top), but `rz`'s actual sign (from
  `rotateWorld`'s pitch rotation) means the OPPOSITE -- smaller `rz` is
  closer to the viewer. This wasn't visible in every view because the
  bug was internally self-consistent (the sort always matched its own,
  backwards, stated convention), so a superficial check couldn't catch
  it -- it only became visible once real astronomical fact was used as
  ground truth. Confirmed and fixed against two independent real
  repro cases the user provided (camera yaw=4.13/pitch=78.72, dates
  2022-05-31 and 2024-03-18): both were backwards before the fix,
  correct after. Verified via direct pixel sampling at each body's exact
  predicted screen position (not just re-reading the same sort's own
  output), and re-checked across a full 88-day Mercury orbital cycle at
  a second camera angle with no remaining discrepancy.
- **Added a velocity-hodograph dashboard**: for a locked body or selected
  flight (desktop/laptop only for now -- mobile needs a different
  treatment, deferred), a "Dashboard" button in the camera-controls row
  slides up a small panel alongside the still-visible, still-interactive
  scene (not a takeover) showing the classic orbital-mechanics plot of
  the velocity vector's tip, which traces a perfect circle for any
  2-body Keplerian orbit no matter how eccentric the position-space path
  is. Shows the body this orbit's velocity is measured relative to
  ("orbiting Sol" today for almost everything; a moon's is relative to
  its planet) -- designed for that reference body to eventually be
  switchable once a flyby's own local (planetocentric) sphere-of-
  influence hodograph is supported, not implemented yet. For a flight,
  the scrubber shifts up to stay usable alongside the open dashboard, so
  gravity-assist reshaping of the circle can be watched live while
  scrubbing through a flyby. Along the way, fixed a real pre-existing
  bug this surfaced: `getCurrentOrbitElements`'s `geocentric_orbit`
  branch read a variable local to `frame()`'s own body from a sibling
  top-level function, throwing a `ReferenceError` any time it was
  reached outside an active frame() call (e.g. Mangalyaan/Aditya-L1's
  real parking-orbit phase via the "Current orbit only" toggle).
- This directly supersedes an earlier same-day attempt at a full-
  viewport takeover version of this dashboard, corrected after direct
  user feedback that it covered too much of the view and its toggle
  button was buried inside the info panel rather than always reachable.

## 2026-08-01 (continued) — Fixed Solar Orbiter's first leg flying the wrong way

- Fixed Solar Orbiter's Earth->Venus first leg (2020-02-10 to 2020-12-27),
  which was rendering as a huge, wrong-shaped balloon out past 1.9 AU
  (beyond Mars) instead of diving toward the Sun. Root cause: the real
  trajectory on this leg sweeps just over 360 degrees of true anomaly (a
  real perihelion dip to ~0.52 AU around 2020-06-10, then back out to
  ~0.99 AU around 2020-08-09, confirmed against JPL Horizons target -144),
  but this catalog's Lambert solver only ever finds the 0-revolution
  solution -- given only the two endpoint positions and dates, it can't
  tell a >360deg real sweep from that same angle minus 360, and silently
  solved for the wrong (~83deg short-way) orbit instead. Same root cause
  already diagnosed for other multi-flyby missions in this catalog
  (BepiColombo's own leg 0 carries an identical fix and comment). Fixed
  by splitting the single leg into three, through two real JPL Horizons
  waypoints (2020-05-11 and 2020-08-09) as `fixedPos` boundaries, so each
  piece's real sweep stays safely under 360 degrees. Verified all three
  sub-legs reconstruct their real endpoints to ~1e-12 AU and produce
  self-consistent orbital elements (a~0.752 AU, e~0.314 across all
  three, as expected since it's physically one continuous real orbit),
  and that the resulting r(t) profile now matches the real ~0.52 AU/
  ~0.99 AU dip-and-rise instead of the wrong ~1.9 AU balloon.
  Found via user report ("bad arc... first leg from earth to venus").

## 2026-08-01 — Fixed a reintroduced mobile scrubber-marker centering bug; updated design docs

- Fixed `.scrubber-marker`'s mobile-only CSS rule
  (`body.mobile .scrubber-marker`), which had reintroduced the exact
  centering bug already fixed for desktop: `padding: 14px; margin: -14px;`
  under this sheet's global `box-sizing: border-box` clamps the real
  rendered box to 36x36 (padding can't fit inside an 8px box), and
  `transform: translate(-50%, -50%)` alone already centers that real box
  correctly -- the extra `margin: -14px` double-corrected, shifting every
  gravity-assist/orbit-insertion/loiter marker on the mobile scrubber
  14px off its true event date. Verified via direct measurement (Chromium,
  390px viewport, BepiColombo's flybys): rendered marker center was 14.0px
  off the marker's own `left` anchor before the fix, 0.0px off after.
  Caught while auditing `docs/` against the current codebase, not reported
  by the user.
- Reviewed all three `docs/*.md` design specs plus `debug/checklist.md`
  against the current codebase and marked them up to date: added status
  banners to `docs/project-transfer.md` (now archival/historical -- its
  backlog section is fully superseded, since every listed expansion
  category and direct-transfer mission has since been added; removed two
  sections of content unrelated to this project), `docs/gravigram-spec.md`
  (now fully implemented -- Tier 1 chained-Lambert-arc and Tier 2
  SOI-patched hyperbolic flybys are both live, plus Lagrange points and
  the multi-leg schema), and `docs/satellite-addition-spec.md` (still a
  living reference doc; its one remaining "not yet added" row, Charon, is
  now done too). Updated `debug/checklist.md`'s stale mission count
  (38 -> 57) and flagged its untested sections as since-exercised through
  later development rather than through that specific checklist. Fixed a
  real README.md inconsistency found in the process (intro paragraph said
  57 missions, the Features bullet still said 53).

## 2026-07-31 (continued) — Simplified the speed control to one field

- Replaced the two clickable "Nx"/"N (yr/min)" speed chips with a single
  "N yr/min" field. They were always the same underlying number anyway
  (this app defines a year as exactly 365.25 days), so having two
  separately-editable copies of it added UI clutter and interaction
  complexity (field-switching, exclusion rules for the click-away
  handler) without adding anything a user could actually do differently.
  Considerably simplified the underlying JS as a result -- no more
  per-field state tracking, just one editable chip.

## 2026-07-31 (continued) — Clicking a body no longer shows its flights; mobile controls consolidated further

- Clicking a plain body or small body (as opposed to clicking a flight,
  or a "Missions here"/"Destinations" link) no longer affects which
  flight paths show on canvas at all. The rule is now simply: a flight
  shows if it's explicitly selected, or (Broad mode only) if it's
  currently in transit for the simulated date -- Focused mode shows only
  what's explicitly selected, full stop. This replaces a change from
  earlier the same day that made locking a body narrow (Broad) or reveal
  (Focused, pre-existing before that change) related flight paths --
  discovering and selecting a relevant mission is still fully possible
  via the "Missions here"/"Destinations" links in a body's info panel,
  it just no longer happens as an automatic side effect of merely
  clicking the body itself. Removed the now-unused getFlightRelevantBodies.
- Folded "Reset view"/"Stop tracking" into the same row as the speed
  selector on mobile, removing their own separate stacked block entirely
  and letting the flight scrubber (moved into the bottom column earlier
  today) drop further toward the true bottom edge, freeing up more
  viewing space still. Caught a real, easy-to-miss CSS gotcha before it
  shipped: nesting #camera-controls directly in the markup broke its
  desktop floating position, because `.panel`'s `backdrop-filter` creates
  a new containing block for `position:fixed` descendants -- its
  position:fixed started resolving against the small speed-row panel
  instead of the viewport. Fixed by actually moving the DOM node via JS
  at the mobile breakpoint (and back on return to desktop) instead of
  relying on CSS alone, verified robust to repeated resize toggling
  (exactly one node, correctly restored each time, zero console errors).

## 2026-07-31 (continued) — Mobile flight scrubber moved out of the main view

- The flight scrubber (playhead) was top-anchored on mobile, sitting
  directly over the main 3D view for the entire time a flight was
  selected -- right when the view is most likely to actually be in use.
  Moved it into the bottom control column instead, stacked above "Reset
  view"/"Stop tracking": since selecting a flight always locks its
  spacecraft too, that column is reliably in its full 2-button height
  whenever the scrubber can be visible at all, so no extra state handling
  was needed to stack them correctly. Net effect is a LARGER clear
  viewing area than before, not just a relocated block, since the old top
  band is now fully reclaimed rather than just traded for a bottom one.
- Phone-landscape specifically (~390px tall) didn't have room to also
  stack the scrubber above that column without colliding with the top
  toggle buttons -- confirmed live via Playwright before landing a fix,
  not assumed. Landscape has the opposite problem portrait does (lots of
  spare width, little height), so there specifically the scrubber sits to
  the LEFT of the button column instead of above it, using a plain
  `max-height` media query to distinguish phone-landscape from
  tablet-landscape (which has plenty of room and keeps the stacked-above
  layout).
- Verified across all 5 of this project's standard mobile breakpoints
  (iPhone SE, modern phone portrait/landscape, iPad Air portrait/
  landscape): no overlaps between the scrubber and any other UI element,
  fully within the viewport at each size. Also re-verified that an
  earlier fix (touch gestures starting on the scrubber's own dead space
  correctly passing through to the canvas underneath) still holds at the
  new position. Full mobile_verify.py suite passes.

## 2026-07-31 (continued) — Coordinate reference planes + galactic-motion arrow at Sol

- Added a new overlay shown only while Sol itself is locked: the three
  XY/XZ/YZ reference planes of this app's own heliocentric ecliptic J2000
  coordinate frame (colored by the conventional X=red/Y=green/Z=blue axis
  scheme), plus a static arrow showing the real direction the solar
  system orbits the Milky Way's center (~220 km/s). The arrow's direction
  is external astronomical data, not something derived from the sim's own
  physics — Sol sits fixed at the origin with exactly zero velocity in a
  heliocentric model, so there's no in-model motion to compute an arrow
  from. Direction verified via the standard IAU galactic-coordinate
  conversion (RA ~21h12m, Dec ~+48.3°, near Deneb in Cygnus — matching
  the commonly-cited description of this direction), landing at +59.6°
  ecliptic latitude, consistent with the well-known ~60° tilt between the
  galactic plane and the ecliptic.
- Documented the coordinate system itself in the README (origin, axis
  directions, what "J2000" freezes) — this overlay is the visual answer
  to "what is 0 along each axis."

## 2026-07-31 (continued) — Four more real missions: Venus Express, Solar Orbiter, STEREO-A/B

- Audited the mission catalog for gaps against real spaceflight history back
  to 1988 (the earliest mission already in the catalog) and added four
  confirmed real missions that were missing: **Venus Express** (ESA, 2005,
  Venus polar orbiter), **Solar Orbiter** (ESA/NASA, 2020, a chain of Venus
  gravity assists progressively tilting its orbit out of the ecliptic to
  image the Sun's poles — the same kind of trajectory story as Ulysses'),
  and **STEREO-A/B** (NASA, 2006, twin solar observatories split by a lunar
  gravity assist into heliocentric orbits leading and trailing Earth,
  modeled as two separate flights since they diverged onto different real
  trajectories from the same launch).
- STEREO's near-1-year orbital period (347/387 days) turned out to be
  right at the edge of a real trap: naive yearly-spaced position waypoints
  would have swept just PAST a full revolution each leg, which the
  sweep-angle-only geometry check this catalog's Lambert solver uses can't
  tell apart from a much shorter, wrong-shaped hop (it's inherently
  ambiguous mod 360 degrees). Verified empirically before committing to the
  data: real JPL Horizons waypoints spaced safely under one orbital period
  apart reproduce the real, published orbital periods to within ~0.6%.
- Considered several more missions found during the audit (CONTOUR, a
  failed 2002 comet mission; long-duration Sun-Earth L1 observatories
  WIND/SOHO) and left them out as a deliberate scope call, not an omission.
  Lunar-only missions (Chang'e, Chandrayaan, Clementine, etc.) remain
  entirely out of scope for now, planned as a future expansion once
  planet-level zoom exists.
- Sourced real spacecraft photos (official ESA/NASA renderings, since
  none of these four were ever photographed in flight) for all four new
  missions, closing the gap this audit found: every mission in the
  catalog now has both a spacecraft and a launch-vehicle image, with no
  broken image references anywhere in the data.

## 2026-07-31 — Locking a body now actually filters flight paths; fixed a stale hover glow

- Fixed locking a body (e.g. clicking Earth) doing nothing to narrow
  which flight paths show in Broad mode — every currently-in-transit
  mission kept showing regardless of what was clicked, since only an
  actual flight click (not a body click) narrowed anything. The obvious
  fix (reuse the existing "ever touches this body" relevance check) didn't
  actually help for Earth specifically once measured — nearly every real
  mission launches from Earth, so that definition still matched all of
  them. Added a genuinely narrower relevance check (gravity-assist
  flybys, orbit-insertion/loiter stops, and the flight's true final
  destination — deliberately excluding the launch body) so "launched from
  Earth years ago, now cruising to Jupiter" no longer counts as "relevant
  to Earth."
- Fixed the hover preview glow (the widened stroke over whichever path
  the mouse is nearest) freezing at a stale screen position once the
  camera started auto-following a tracked body — hover state only
  recomputes on an actual mousemove event, but the camera (and thus every
  path's actual screen position) can keep moving on its own. The glow now
  re-finds its target's live position every frame instead of drawing a
  cached one from whenever the mouse last actually moved.
- Manually dragging to pan while a body is tracked and "Hold camera
  frame" is off now auto-enables hold-frame (the same effect as clicking
  its toggle switch) instead of being silently blocked — dragging the
  screen is an unambiguous "let me control the view now" signal. Rotating
  is unaffected (it already worked fine while tracking, orbiting around
  the tracked body).

## 2026-07-29 — Scene Framing, keyboard speed input, multi-tag small bodies, Ulysses' comets

- Added a README and CHANGELOG (this file) — no top-level project
  documentation existed before.
- Redesigned the playback-speed control: instead of a separate text
  field that needed an extra Play click to actually take effect (a real
  blur/click race), the "Nx"/"N (yr/min)" readout itself is now
  click-to-edit, with a Go button while editing and a click-away-to-cancel
  fallback.
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
