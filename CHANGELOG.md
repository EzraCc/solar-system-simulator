# Changelog

All notable changes to this project, grouped by day. This project has no
version numbers (it's a continuously-deployed single-page app, not a
published package), so entries are dated instead.

## Unreleased (local prototype, not yet pushed) — planet system views

- **Classification in info panels.** Every info panel and system view
  card shows what the thing is under its title: "Spacecraft", "Planet ·
  gas giant", "Moon of Jupiter", "Asteroid · Jupiter trojan, binary",
  "Jupiter-family comet", "Dwarf planet · Kuiper belt".
- **Selectable panel titles.** The info panel's title and classification
  can be selected and copied again. Dragging now starts from the grip
  (⠿) or the header's empty space, not from text or buttons, using
  pointer events with pointer capture.
- **Draggable timeline.** The mission timeline can be moved by its grip
  or header, sharing the info panel's drag code; its title stays
  selectable, and a moved timeline reopens where it was left.
- **Mission timelines.** A body's info panel (planets, moons, small
  bodies, and the system view's info card) now dates each mission in
  "Missions here", lists flybys and gravity assists separately, and has a
  "See timeline" button. The timeline has one row per mission: transit,
  orbit and surface time as color-coded bars; landings, flybys, arrivals,
  atmospheric entries, impacts and losses as fixed-size marks, so an
  instant (or a lander that lasted an hour) never shrinks out of sight.
  Planned phases are drawn hollow or dashed past today. Scroll to zoom,
  drag to pan, click a mark to jump the clock there, click a mission to
  select it.
  - Built from each flight's legs plus a new `timeline` block (orbit end
    dates, landings, surface operations, losses) for 42 flights, written
    by tools/timeline_data.py.
  - Moons now list their missions, with flyby counts (Titan: Cassini,
    124 flybys plus Huygens' landing; Europa: Galileo, Juno, JUICE,
    Europa Clipper).
- **System view: click a body or spacecraft** for an info card: size,
  live distance, orbit, why it matters, missions, timeline. Clicks used
  to fall through to the Solar System view's stale hit list.
- **System view: "Compare true sizes"** shows the planet and its moons
  side by side at true relative diameter. In the view itself, a moon (or
  the planet, zoomed far out) too small to see is drawn as a true-size dot
  inside a ring, so it stays visible and clickable without being drawn
  bigger than it is.
- **docs/pre-1988-missions.md:** the backlog of earlier interplanetary
  missions (Earth–Moon-only excluded). 55 reached interplanetary space and
  can be mapped; 22 more never left Earth orbit.

- **System views for Mercury, Venus, Mars, Saturn and Pluto**, alongside
  Jupiter. Open them from the planet's panel (Pluto's from "Pluto and
  Charon") or from a mission's "View … orbit/tour" button. Earth is left
  for later because of its Lagrange-point missions. Uranus and Neptune have
  no missions in the catalog.
  - Saturn draws its main rings (C, B, Cassini Division, A) in its
    equatorial plane, depth-sorted against the planet.
  - Paths that pass in front of a planet (low orbits, perijoves) are
    redrawn over its disc.
  - Spacecraft labels step aside instead of overlapping.
  - New 10 min/s speed. Each system opens at a speed suited to it.
- **Missions:** MESSENGER and BepiColombo (Mercury); Venus Express and
  Akatsuki (Venus); Mars Odyssey, Mars Express, MRO, MAVEN, MOM, TGO and
  Hope (Mars); Cassini's full 2004–2017 tour (Saturn); New Horizons' flyby
  (Pluto). Magellan, Mars Global Surveyor and Tianwen-1's orbit have no
  Horizons ephemeris and aren't modeled.
- **BepiColombo is in Mercury orbit** (inserted 2026-11-21): status set to
  Success and its description updated. The insertion burn was cut short by a
  software issue, and Horizons still carries ESA's pre-arrival prediction
  (fit through 2026-11-10), so the modeled orbit is that prediction until
  Horizons updates; the flight's statusNote says to refit then.
- **New `planetOrbit` block for orbiters** (tools/build_orbit_phases.py):
  windows of mean elements fitted to Horizons, because a Mars orbiter's
  ~12 revolutions a day for decades are too many to draw arc by arc. The
  view shows the current orbit and the spacecraft, with altitude when
  close in. Checked against Horizons with the new
  tools/check_orbit_phases.py: median error 3–42 km for every
  orbiter except Akatsuki (311 km, Sun-perturbed 10-day orbit); worst single
  samples run from 29 km (Odyssey) to 1,700 km (Akatsuki). The current orbit
  is sampled in eccentric anomaly, so highly eccentric ones (Akatsuki,
  capture orbits) stay smooth through periapsis. Each phase is written on
  one line, about 30% smaller, since every flight file loads at startup.
- **Cassini and New Horizons** use the existing arc-by-arc tours.
  New Horizons matches Horizons to within 255 km through the Pluto and
  Charon passes. Cassini: 2,028 legs, median error 57 km, 95th percentile
  1,256 km; the worst is 59,000 km (0.7% of its distance) on the first
  8-day apoapsis leg in 2004, where the Sun tugs at the far end.
- **Moon fixes:**
  - Saturn's six moons, Phobos, Deimos and Charon are fitted to Horizons;
    they were hand-entered.
  - The moon model takes an optional equatorial reference plane
    (`refPoleRaDec`), so moons that precess about their planet's equator
    have linear rates.
  - Max errors: Titan 730 km, Rhea 420, Phobos 275, Deimos 285, Charon
    7 km; Enceladus and Tethys ~1° because of resonance librations.
  - Charon had been tens of degrees out of place: its elements were
    osculating values at a 2026 epoch, read as if at J2000.
  - All fitted moons now use the app's UTC clock. Horizons times are TDB,
    ~67 s off, which was ~0.9° for Phobos and ~0.16° for Io.
- **Tools:**
  - fit_moon_elements.py: fits in the e·cos ω / e·sin ω form, so a
    small eccentricity no longer sticks at 0 (Titan's had); new `--pole`,
    `--nodal-guess` and `--apsidal-guess` options.
  - build_planet_tour.py: Saturn and Pluto; `--merge-min`; flyby refinement
    only near real passes; backs off when Horizons is busy.
  - check_horizons.py: knows every system primary.
  - After the venv rebuild, Playwright needed its own browser build
    (`playwright install chromium-headless-shell`). The checkers couldn't
    launch without it.

- **Sun orientation marker in the system view.** A small Sun icon sits at
  the edge of the view along the true direction from the planet to the
  Sun, through the current camera rotation, and slides clear of the
  panels. Ecliptic J2000 X/Y/Z axes are drawn around it (X toward the
  vernal equinox, Z toward ecliptic north). Its label gives the Sun's
  distance, how far the planet sits north or south of the ecliptic, and
  how far the Sun lies behind or toward the viewer. The marker and any
  axis pointing away are dimmed.
- **Tour paths drawn as true arcs.** Each tour leg used to be drawn from 16
  points evenly spaced in time, so legs that leave a perijove fast (e.g.
  Juno 2024-04-09, 4 RJ to 68 RJ in 8 days) showed long straight chords,
  up to 6° off the real arc. Legs are now subdivided until every segment
  is within ~0.2°. The upcoming-path highlight also starts at the
  spacecraft instead of at the next sample point; before, the stretch
  just ahead of the spacecraft vanished while it flew through it.
- **System-view clock.** The Jupiter panel shows the simulation time in
  UTC to the minute. The shared date field shows whole days only, so at
  system-view speeds (hours per second) it looked stuck while Juno moved.
- **Galilean moon positions fixed.** The hand-entered phases had Io,
  Europa, Ganymede and Callisto 50–160° out of place (400,000 to 2.8
  million km). They now use least-squares fits to JPL Horizons over
  1990–2040, from the new `tools/fit_moon_elements.py`, in exactly the
  app's own moon model. Verified in-app from 1996 to 2034: Ganymede and
  Callisto within ~2,000 km, Io within ~3,000 km, Europa within ~13,000 km.
- **New `planetocentric` leg type**: a Lambert arc in a planet's own frame.
  Endpoints are Horizons waypoints (`{relPos}`) or moon flybys
  (`{moon, offsetKm}`), and flybys are pinned to the moon as drawn. It
  reuses the existing solver by rescaling length so the planet's GM equals
  the Sun's.
- **Four Jupiter tours**:
  - **Juno**: 2016–2026, 90 orbits, 7 flybys, built from Horizons. Median
    error against Horizons is 217 km.
  - **Galileo**: 1995–2003, 34 orbits, 35 flybys, from Horizons; median
    error 326 km.
  - **Europa Clipper**: 2030–2034, 79 orbits, 69 flybys, from Horizons'
    predicted tour; median error 138 km.
  - **JUICE**: 2031–2034, 36 flybys, ending at Ganymede orbit insertion.
    It's a model built from ESA's published flyby schedule, because
    Horizons has no JUICE tour. Orbit counts and flyby times of day are
    chosen so each gravity assist conserves the spacecraft's speed relative
    to the moon.
- **Separate Jupiter system view**, opened from Jupiter's info panel or a
  touring flight's "View Jupiter tour" button. It shows Jupiter, the moons
  and the mission tours, with time presets, jump-to-flyby buttons,
  follow-a-moon or follow-a-spacecraft, a scale bar, and Esc to exit.
- **New tools**:
  - `tools/build_planet_tour.py` builds a tour from Horizons ephemeris.
  - `tools/build_tour_from_flybys.py` builds one from a published schedule.
  - `tools/check_horizons.py` now verifies planetocentric legs in km.
- **Tooling environment fixed**: the `tools/.venv` numpy (1.26, which
  predates Python 3.14) silently corrupted large-array results, its scipy
  optimizer did nothing, and matplotlib 3.7 hit a recursion bug. The venv
  is rebuilt from a pinned `tools/requirements.txt`: numpy 2.5.5, scipy
  1.18.1, numba 0.68.1, and matplotlib 3.11.2, which overrides hapsira's
  old pin. `validate_trajectories.py` still passes, and the new tools
  reproduce identical results.

## 2026-11-17 — Every trajectory checked against JPL Horizons; 25 wrong legs fixed; catalog refreshed

- **New real-ephemeris verifier, `tools/check_horizons.py`.** The 2026-08-03
  sweep left 53 flagged legs to check by hand. Rather than checking them one
  at a time, this script compares the position the app actually *renders*
  (`computeMultiLegPosition`, newly exposed on `window.__VERIFY__` along with
  `getSolvedFlight`) against JPL Horizons, for every leg of all 27 flights
  that have a Horizons ID (`tools/horizons_ids.json`). That changed the
  picture in two ways:
  - For any leg after a gravity assist, the sweep had been measuring the
    wrong thing: the plain Lambert solve, which isn't what gets drawn (the
    patched-conic propagation is). Many of its alarming ratios (e≈1.0 on
    Venus→Venus legs) belonged to legs that render correctly. Most of
    Lucy's, Ulysses', JUICE's and Rosetta's flagged legs match Horizons to
    under 0.02 AU.
  - It also found real errors the sweep missed or under-ranked. 25 legs were
    off by more than 0.15 AU, several by 1–3 AU:
    - PSP's 2021–2024 Venus legs
    - MESSENGER's four Mercury-approach legs
    - Solar Orbiter's 2025–2030 legs
    - Rosetta's 2007–2009 Earth→Earth leg (3.1 AU)
    - Nozomi's 1998–2002 Earth→Earth leg
    - Hayabusa2's Earth→Ryugu leg (4.8 AU)
    - Psyche's post-Mars leg (2.9 AU)
    - plus smaller misses on Lucy, Dawn, Cassini and BepiColombo
- **Fixed all of them with a new `tools/split_leg_horizons.py`**, which
  automates the established fix (split through real Horizons `fixedPos`
  waypoints, ≤90° of sweep per piece, 6-hour sampling so PSP's perihelion
  passes are resolved). 29 legs were split, including four borderline ones
  (Akatsuki, Psyche's 2024–25 cruise, MESSENGER's first Earth→Venus leg, and
  a Solar Orbiter leg that drifted once an earlier flyby's incoming velocity
  changed). Result: every one of the 466 legs with Horizons coverage is now
  under 0.15 AU, and 446 are under 0.05 AU. The remaining 0.05–0.10 AU legs
  are ion-thrust cruises and Jupiter-distance coasts.
- **Flight-profile timeline merges waypoint chains** (`buildLegEntries`), so
  a split coast still reads as one "Venus → Venus" entry. PSP shows 7 coast
  rows, not ~60.
- **Tianwen-2** has no published ephemeris, and its single arc dipped to
  0.57 AU (inside Venus's orbit) en route to quasi-satellite Kamo'oalewa,
  which never leaves 0.90–1.10 AU. Replaced with 7 **synthetic, clearly
  labeled** waypoints that blend from Earth's position to Kamo'oalewa's. The
  path now stays between 0.96 and 1.10 AU. Hayabusa can't be checked
  (Horizons only has it from 2009).
- **Catalog update (2026-08-30 → 2026-11-17).** No new in-scope launches
  besides MMX, which was already a placeholder. Refreshed in-flight
  missions, mostly from Horizons' predicted trajectories:
  - **MMX** launched 2026-10-19 19:41 UTC (H3 F10). Mars arrival is now
    2027-08-31, estimated by coast-propagating Horizons' published cruise
    trajectory; CNES says August 2027.
  - **Roman** L2 insertion moved to 2026-12-08 (NASA: ~100 days after
    launch; Horizons' halo orbit has its innermost point that day).
  - **Hera** reached Didymos on 2026-10-29, within ~100 km per Horizons
    (was a 2027-01-15 placeholder).
  - **ESCAPADE** now follows Blue's real trajectory: L2 arrival ~2025-12-04,
    departure ~2026-10-20, Earth flyby 2026-11-07 at 1,609 km, Mars
    2027-09-09.
  - **JUICE**'s 2026-09-29 Earth flyby altitude is now the real 8,641 km.
  - **Europa Clipper**'s Earth flyby uses NASA's current ~3,200 km target.
- **Psyche (backlog item 3):** besides the waypoint fix, Horizons' predicted
  trajectory runs to 2029-02-24 (~50,000 km from the asteroid). NASA still
  says capture July 2029 and orbit operations August 2029, so the
  2029-07-31 arrival stays.
- `BUILD_VERSION` 26 → 27; `app.js?v=` 78 → 79.

## 2026-08-30 — Added Nancy Grace Roman Space Telescope; documented the catalog update cycle

- Roman launched today (2026-08-30, Falcon Heavy from KSC) on a direct
  Earth-to-Sun–Earth-L2 transfer. Added as a single-Lambert-leg flight
  (`data/flights/roman.json`) targeting the already-supported `Earth_L2`
  point (same mechanism ESCAPADE's own L2 leg uses), with an *estimated*
  2026-11-28 L2 arrival date sourced from NASA's own post-launch
  "three-month journey to its final orbit" statement — not yet a
  confirmed trajectory value, flagged as such in the flight's own
  `statusNote`, to be replaced with real numbers once public (same
  placeholder-pending-actuals pattern already used for MMX).
- This is the first flight added under a deliberately broadened scope:
  previously only missions leaving Earth's SOI for another body were
  catalog-worthy; Sun-Earth L1/L2 station-keeping observatories are now
  in scope too, since the underlying trajectory (and this simulator's
  `Earth_L2` modeling) is real orbital mechanics, not just an Earth-orbit
  satellite.
- Checked for other launches between ESCAPADE (2025-11-13, the previous
  addition) and today — nothing else in the broadened scope was found
  (Pandora, SMILE, and the Swift boost mission are Earth-orbit only;
  Venus Life Finder and MMX haven't launched yet).
- Documented the catalog update cycle itself in `docs/project-transfer.md`
  section 3.4 — how to find the cutoff (manifest.json's launch-date
  ordering), where to check for new launches, current scope, and how to
  handle a just-launched mission's estimated dates — so a future update
  knows exactly how far back to look instead of re-deriving it from
  scratch.
- `BUILD_VERSION` 25 → 26 (data-only change).

## 2026-08-03 (continued) — Trajectory-bug prevention: a permanent verify hook, a catalog-wide screening tool, and a real Dawn path gap fixed

- After finding the same class of bug twice in one session (Solar Orbiter,
  then NEAR Shoemaker below), asked directly: what stops this from being
  a recurring manual spot-check? Root cause: `solveLambertUniversal`
  (`app.js`) only ever solves a ZERO-revolution transfer -- given two
  positions and a time of flight, it always finds *some* orbit assuming
  less than one full lap around the Sun. If the real spacecraft took
  more than one lap, the solver doesn't error, it silently returns a
  different, wrong orbit that still satisfies the same endpoints and
  time-of-flight. Nothing about the math signals this happened; only
  the shape is wrong.
- Added a small, permanent `window.__VERIFY__` hook (`app.js`, end of
  `bootstrap()`) exposing the handful of pure functions verification
  tooling needs (`getSolvedLeg`, `getGAChain`, `computeFlightPosition`,
  etc.) -- replaces the fragile, repeated-all-session pattern of hand-
  copying `app.js` and regex-injecting a throwaway debug hook before
  every check. Read-only, no side effects, not reachable without
  deliberately scripting against the page.
- New `tools/check_lambert_sweep.py`: scans every Lambert leg in the
  full 57-mission catalog, flags any where the transfer duration
  approaches or exceeds the solved orbit's own natural period -- the
  regime where a zero-revolution assumption becomes doubtful. Flagged
  55 of 161 legs at first pass. Important limitation documented in the
  script itself: this is a screening heuristic, not a verifier -- many
  real multi-gravity-assist missions (PSP, BepiColombo, JUICE, Rosetta,
  Solar Orbiter) legitimately fly long, resonant, near-one-lap coast
  legs by design, and look identical to a genuine bug from inside the
  app. Confirming one requires cross-checking against real ephemeris,
  same as the two bugs below were found. Documented in `tools/README.md`
  as a required step when adding/editing multi-leg Lambert data going
  forward; the other 53 flagged legs remain an open backlog to check
  incrementally rather than a claim they're all bugs.
- **Fixed a real, distinct issue this surfaced while investigating**:
  Dawn's path looked visibly "separated" -- two disconnected loops with
  a gap between them. Verified this was NOT the zero-revolution bug
  (each of Dawn's own legs is individually a correct, smoothly-growing
  shape). The real cause: Dawn genuinely held position in orbit around
  Vesta for ~14 months (2011-07-16 to 2012-09-05) before departing for
  Ceres -- an extended stay that isn't its own leg type in this
  catalog's schema. `computeMultiLegPosition` already had a correct
  fallback for the moving marker during a gap like this ("wherever the
  most recently-reached body still is," tracking its real ongoing
  motion), but the drawn preview path had no equivalent and simply
  skipped that span, leaving a real ~3.9 AU gap (exactly how far Vesta
  itself travels along its own orbit in 14 months) with no connecting
  line. Generalized the existing Lagrange-loiter arc-drawing logic
  (added for the same reason -- "there's no reason to hide an exactly
  computable position") to also cover any gap between two Lambert legs
  where the held body is a real, trackable object -- fixes this for any
  other flight with a similar "extended stay at an intermediate target"
  pattern, not just Dawn.

## 2026-08-03 (continued) — Fixed NEAR Shoemaker's post-Earth-flyby arc ballooning to 3.2 AU

- Flagged directly: NEAR Shoemaker's path looked wrong after its Earth
  gravity assist. Root cause matched the Solar Orbiter first-leg bug
  fixed earlier this session: real NEAR Shoemaker (JPL Horizons, target
  -93) sweeps ~467 degrees around the Sun between the 1998-01-23 Earth
  flyby and 2000-02-14 Eros orbit insertion -- more than a full
  revolution, since NEAR spent over a year in a near-Eros-like orbit
  working through the real 1998-12-20 rendezvous-burn abort and
  1999-01-03 recovery burn. A single 2-point Lambert solve across that
  whole span can't distinguish a >360deg sweep from a much shorter one,
  and picked a badly wrong orbit shape -- ballooning out to ~3.2 AU
  (past Mars) instead of tracking Eros's own orbit (max ~1.78 AU).
  Fixed the same way: split into three legs through two real Horizons
  waypoints (1998-09-20, 1999-07-17). Verified against the real
  ephemeris across the whole span -- was off by 1.5+ AU at points,
  now matches to within 0.01 AU throughout.

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
- That padding fix wasn't enough on its own -- flagged directly: the
  point "sits on (0,+) for a moment then jumps to (0,-) and
  disappears." Numerically confirmed why: a flyby's SOI radius is
  usually far bigger than its periapsis passage, so the spacecraft's
  velocity direction is already nearly at its asymptotic v-infinity by
  the time it geometrically crosses the SOI boundary -- mean anomaly is
  already huge there, so stretching the SAME mean-anomaly range across
  more calendar time (the first fix) just left the point sitting still
  for longer, not moving more smoothly. Re-parametrized by TRUE anomaly
  instead, which has no such saturation -- the hodograph's circle angle
  is exactly affine in true anomaly (verified numerically against this
  file's own hyperbolic sign convention), so sweeping it linearly
  across the full padded window gives a genuinely smooth, watchable
  turn instead of a near-instant jump. Only applies during active
  playback; a paused/manually-scrubbed date still shows the exact real,
  undilated physics.

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
