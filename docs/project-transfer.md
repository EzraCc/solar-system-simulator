# Solar System Orbital Mechanics Visualizer — Project Transfer Document

**Generated:** 2026-06-18  
**Transferring from:** Claude (claude.ai conversation, multi-session)  
**Transferring to:** Claude Code or Cowork  
**Purpose:** Full context, decision history, and current state for continued development

> **STATUS (updated 2026-08-01): Historical/archival.** This document captures
> the project's state as of the initial claude.ai→Claude Code transfer
> (single-flight-arc model, 3 missions, no gravity assists). Nearly everything
> in this file's own Section 7 backlog has since shipped — see the per-item
> status notes added there, `docs/gravigram-spec.md` (its gravity-assist
> chain trajectory feature is implemented; note that doc's own name is a
> misnomer — see its top banner, "gravigram" properly refers to an
> unrelated, unbuilt net-force/momentum teaching visual), and
> `CHANGELOG.md` for what actually happened. Sections 1–6, 8, and 9 below are
> kept as-is for their still-accurate architectural/decision-rationale content
> (Lambert solver flow, Y-flip convention, lazy-solve contract, etc.), but
> file paths and line counts in Section 2 predate the `src/js/`, `src/css/`,
> `data/flights/` reorganization — see the current `README.md` "Project
> structure" section for the real layout. Section 10 (unrelated personal
> research notes) and Section 11 (a session transcript path that no longer
> exists on disk) have been removed as out of scope for this file.

---

## 1. What This Project Is

A browser-based 3D solar system orbital mechanics visualizer built as a multi-file web app (HTML + CSS + JS + per-flight JSON data files). It uses real Keplerian physics throughout — not a cartoon representation — with real orbital elements sourced from authoritative data, a universal-variable Lambert solver for flight trajectories, and verified numerics throughout.

**Intended direction (user's stated goal):** Eventually become the physical simulation layer for a logistics/transport game involving cargo movement between planetary bodies. The current simulator is the foundation; a gameplay layer does not yet exist.

---

## 2. Current File Stack

After the file-split refactor completed at the end of this session, the project lives at:

```
index.html              — markup only, no inline CSS or JS
style.css               — 205 lines, all visual styling
app.js                  — ~1941 lines, all simulation logic
flights/
  manifest.json         — ordered list of flight keys (the only place flight inclusion is declared)
  curiosity.json        — per-flight data file
  perseverance.json     — per-flight data file
  akatsuki.json         — per-flight data file
```

**Delivered as:** `solar-system-split.zip`

**Important:** Because `app.js` uses `fetch()` to load the flight files, the app must be served from a local HTTP server. Opening `index.html` directly as a `file://` URL will block the fetch calls with a CORS error. Use `python3 -m http.server` or equivalent.

---

## 3. Physics Architecture

### 3.1 Coordinate System

- Heliocentric, ecliptic plane
- Units: AU (positions), days (time)
- Origin: Sol at `[0, 0, 0]`
- Epoch: J2000 (2000-01-01T12:00:00Z)
- Time variable throughout: `daysSinceJ2000` (a float)

### 3.2 Planet Positions — Keplerian Propagation

All 8 major planets use real orbital elements (`PLANET_ELEMENTS` in `app.js`). Position at any time is computed via `computeStateVector(elements, daysSinceEpoch)`:
1. Advance mean anomaly M from epoch
2. Solve Kepler's equation iteratively (`solveKepler`, Newton-Raphson)
3. Compute position in orbital plane
4. Rotate by argument of perihelion (ω), inclination (i), longitude of ascending node (Ω) via 3-2-3 Euler rotation

### 3.3 Moon Positions — Satellite Offsets

Earth's Moon, Phobos, and Deimos use `computeSatelliteOffset(elements, daysSinceEpoch)`:
- Same Kepler propagation as planets
- Result is an **offset from the primary**, not absolute heliocentric position
- Moon has real precessing node (`nodalPeriodDays: 18.61 * 365.25`) and precessing perigee (`apsidalPeriodDays: 8.85 * 365.25`)
- Moon inclination is 5.145° — real, not flat — verified numerically to produce ~35,000 km Z-swing
- Final position: `buildSatelliteAbs()` adds the primary's heliocentric state

### 3.4 Flight Trajectories — Lambert Solver

Flights (real interplanetary missions) use a universal-variable Lambert solver:

**Data flow for a given flight key:**
1. `getFlightDates(key)` — cheap, pure date arithmetic only. Returns `{launchDays, arrivalDays, tofDays}`. Uses `daysSinceJ2000()` on the raw JSON's `launchDate`/`arrival` fields. Memoized. **Never triggers the Lambert solve.**
2. `getSolvedFlight(key)` — expensive, deferred. Calls `computeStateVector()` for both planets at launch/arrival, determines sweep direction (Type-I vs Type-II from actual geometry via cross-product check), calls `solveLambertUniversal()`, then `stateVectorToElements()` to convert the result into Keplerian elements. **Memoized — only runs once per flight per session.**

**Laziness contract (critical for scalability):**  
`getSolvedFlight` is only called when a flight is either (a) explicitly selected by clicking it, or (b) the simulated date falls within its `launchDays..arrivalDays` window and the render loop actually needs to draw its arc or compute its spacecraft marker position. The visibility gate (`isFlightVisible`) uses only `getFlightDates` — it never triggers a solve.

**Adding a flight:** Drop a new JSON file in `flights/` matching the schema (see Section 5.2), add its key to `flights/manifest.json`'s `order` array. No JS changes needed.

### 3.5 Camera / Rendering

- Camera is yaw + pitch rotation around the scene origin (Sol)
- `rotateWorld(x, y, z)` → camera space
- `worldToScreen(x, y, z)` → `[screenX, screenY, rz]`
  - Screen Y is **flipped**: `cy - ry * pxPerAU` (increasing world Y = upward on screen = decreasing pixel Y)
  - This flip must be accounted for anywhere that converts a world-space direction vector to screen space (e.g., the lighting direction for sphere shading)
- Zoom: `pxPerAU`, range 2–20,000. Ceiling was raised from 4,000 this session to make the Moon's orbital inclination visually perceptible
- Camera follow: when a body is locked (`lockedBodyName`), `camX`/`camY` are adjusted each frame to keep the body centered

### 3.6 Sphere Shading

Planets render as directionally-lit spheres, not flat circles. Per-frame, per-body:
1. Compute world-space direction from body toward Sol: `-normalize(body.pos)`
2. Rotate through `rotateWorld()` to get camera-space direction
3. **Flip the Y component** to match screen-space sign convention
4. Pass `(lightDirX, lightDirY)` to `drawBody()`
5. `drawBody` creates an offset radial gradient: hotspot at `0.42 * screenR` toward the light direction, outer radius `1.35 * screenR`, clipped to the body's circle. Color stops: full color at hotspot → 55% darkened at terminator → 88% darkened at shadow edge
6. Sol itself is **not** shaded (it's the light source) — it gets a flat fill plus a glow gradient only

---

## 4. UI Architecture

### 4.1 Panels

All panels are `<div class="panel">` positioned via CSS. Active panels:
- `#legend-panel` — collapsible Planets and Flights accordion groups
- `#date-panel` — date display/edit with toggle state (Edit ↔ Go to date + ✕)
- `#time-panel` — speed slider + Play/Pause
- `#locked-panel` — info panel for the currently-tracked body or flight
- `#camera-controls` — Reset view + Stop tracking buttons
- `#scale-toggle-panel` — "Compare true sizes" toggle
- `#size-compare-panel` — true-scale diameter bar

### 4.2 State Variables (key globals in the IIFE)

| Variable | Type | Role |
|---|---|---|
| `simDate` | `Date` | Current simulated date |
| `paused` | `bool` | Whether the simulation is advancing |
| `lockedBodyName` | `string\|null` | Name of currently tracked body (or null) |
| `selectedFlightKey` | `string\|null` | Key of currently selected flight (or null) |
| `pxPerAU` | `float` | Current zoom level (2–20,000) |
| `yaw`, `pitch` | `float` | Camera rotation angles (radians) |
| `camX`, `camY` | `float` | Camera pan offset (screen pixels) |
| `renderedBodies` | `array` | Populated each frame; used for hit-testing |

### 4.3 Critical State Rules

**`lockedBodyName` and `selectedFlightKey` are mutually exclusive in practice:**  
Locking a body (any planet, moon, or Sol) clears `selectedFlightKey` — *unless* the lock came from `selectFlight()`'s own internal call, which passes `{preserveFlightSelection: true}` to `lockBody()` to avoid immediately clearing the selection it just set.

**`setPaused(value)` is the single source of truth for date-edit mode:**  
It controls: the `paused` flag, the Play/Pause button label, the date input's `readOnly` state, and the visibility of the Edit vs. (Go-to-date + ✕) button groups. Nothing else should toggle these directly.

**`isFlightVisible(key, daysSinceEpoch)` is the single gate for flight rendering:**  
All arc-drawing and marker-placement code checks this first. It uses `getFlightDates()` only (cheap). Any code that then needs the solved trajectory calls `getSolvedFlight()` after the gate passes.

### 4.4 Legend Architecture

Two separate builder functions:
- `buildLegend()` — planets + moons. Moons appear as indented accordion rows only when their parent planet is `lockedBodyName`
- `buildFlightsLegend()` — flights. Reads `FLIGHTS_RAW[key].name` only, no solve triggered

Both call `buildLegend()` via `lockBody()` when the locked body changes (to re-render moon visibility). `buildFlightsLegend()` is called from `lockBody()` (to clear stale selection highlight) and from `selectFlight()`.

---

## 5. Data Schemas

### 5.1 Planet Orbital Elements (`PLANET_ELEMENTS`)

```js
{
  a: float,           // semi-major axis, AU
  e: float,           // eccentricity
  iDeg: float,        // inclination, degrees
  OmDeg: float,       // longitude of ascending node, degrees (at J2000)
  wDeg: float,        // argument of perihelion, degrees (at J2000)
  LDeg: float,        // mean longitude, degrees (at J2000)
  dOmDeg: float,      // rate of change of Om, degrees/century
  dwDeg: float,       // rate of change of w, degrees/century
  dLDeg: float,       // rate of change of L, degrees/century
}
```

### 5.2 Per-Flight JSON Schema (`flights/<key>.json`)

```json
{
  "key": "string",              // must match filename and manifest entry
  "name": "string",             // display name
  "launchBody": "string",       // must be a key in PLANET_ELEMENTS (e.g. "Earth")
  "destinationBody": "string",  // must be a key in PLANET_ELEMENTS (e.g. "Mars")
  "launchDate": "YYYY-MM-DD",
  "arrival": "YYYY-MM-DD",      // intended arrival date (single field regardless of outcome)
  "rocket": "string",
  "payload": "string",
  "status": "string",           // e.g. "Success", "Orbit insertion failed"
  "statusNote": "string|null",  // free text for non-success outcomes
  "_designNote": "string"       // optional, internal documentation only, ignored by app.js
}
```

**Key constraint:** `launchBody` and `destinationBody` must both be present in `PLANET_ELEMENTS`. The Lambert solver calls `computeStateVector(PLANET_ELEMENTS[raw.launchBody], ...)` — if the key doesn't exist, this will throw at solve time (when the flight is first selected or encountered, not at load time).

### 5.3 Flights Manifest (`flights/manifest.json`)

```json
{
  "_comment": "string",
  "order": ["key1", "key2", ...]
}
```

`order` controls display order in the Flights legend. Every key listed must have a corresponding `flights/<key>.json` file.

---

## 6. Known Bugs Fixed This Session (Do Not Re-Introduce)

### 6.1 Stale Flight Selection (`selectedFlightKey` never cleared)
**Symptom:** After clicking a flight to view it, its arc would remain drawn indefinitely even after the simulated date moved far past its arrival, because `selectedFlightKey` was never cleared unless you re-clicked the same flight.  
**Fix:** `lockBody()` now clears `selectedFlightKey` whenever called, *unless* the caller passes `{preserveFlightSelection: true}`. `selectFlight()` passes this flag on its own internal `lockBody()` call.

### 6.2 Premature `buildFlightsLegend()` Call
**Symptom (introduced during file split):** `buildFlightsLegend()` previously ran synchronously at definition time, before `loadFlightsRaw()` had resolved, producing an empty legend.  
**Fix:** Moved to the async `bootstrap()` function at the end of `app.js`, which `await`s `loadFlightsRaw()` before calling it.

### 6.3 Click Hit-Testing: Flights vs. Planets
**Symptom:** Clicking a flight marker that overlapped a planet body in screen space would unpredictably select either one.  
**Fix:** The canvas click handler uses a two-pass approach: checks flight markers first regardless of depth order, falls back to non-flight bodies only if no flight was hit.

### 6.4 Date Panel Button Toggle State
**Symptom:** "Go to date" was always visible even when the field was readonly (meaningless); "Edit" was visible even when already editing.  
**Fix:** `setPaused()` now controls button visibility as part of its existing "single source of truth" role. Not-paused = "Edit" button visible, "Go to date" + "✕" hidden. Paused = reverse.

### 6.5 Y-Flip in Light Direction Computation
**Symptom (potential):** The sphere shading's light direction needed an explicit Y-flip to match `worldToScreen`'s sign convention (`cy - ry * pxPerAU`). A naive rotation without the flip would light the wrong hemisphere.  
**Fix:** `lightDirY = -ry / screenMag` (not `+ry`). Verified numerically with two independent geometric test cases.

---

## 7. Backlog (Explicitly Queued Items)

### 7.1 Parker Solar Probe (Flight) — ✅ DONE
PSP's real trajectory uses 7 sequential Venus gravity-assist flybys over 7 years and 24 solar orbits. **Cannot be added as a single Lambert arc.** Queued for after a "gravgram" (gravity-assist chain visualization) feature is built. Do not attempt to add it as a simple flight.

The gravigram feature (`docs/gravigram-spec.md`) is fully implemented — multi-leg
schema, patched-conic gravity assists with real turn-angle geometry, and
`data/flights/psp.json` exists in the catalog with all 7 Venus flybys.

### 7.2 Flight Arc Color Legend by Type — still deliberately deferred
All flight arcs are currently a single color (`#7fd99c`). A per-type color scheme was discussed and **deliberately deferred** — a small fixed palette won't scale to ~100 flights, and the flight taxonomy needed to define "type" hasn't been designed yet. Do not add ad-hoc per-flight colors without that taxonomy existing first.

No change since this was written — still true as of 2026-08-01, still no per-type
color taxonomy. Remains valid guidance if this is revisited.

### 7.3 Missions Catalog (`interplanetary_missions.json`) — ❌ REMOVED / superseded
This standalone research artifact was never carried into the repo. `data/flights/manifest.json` is now the actual single source of truth for which missions are included (57 as of 2026-08-01), each backed by a real per-mission JSON file researched and verified individually at add-time rather than through a separate catalog file. Treat this section as historical only — there is no `interplanetary_missions.json` in this repo.

### 7.4 Expansion Categories (from missions catalog) — ✅ ALL DONE
Every capability gap listed below has since been built and used:

| Expansion needed | Status |
|---|---|
| Gravity-assist / multi-flyby chains | ✅ Done — `docs/gravigram-spec.md`; BepiColombo, JUICE, New Horizons, ESCAPADE, Parker Solar Probe, Lucy, etc. all implemented |
| Multi-target tours (no single arrival) | ✅ Done — Lucy (multiple asteroid targets), Dawn (Vesta then Ceres), OSIRIS-REx all in the catalog |
| Absent target body types: asteroids | ✅ Done — DART, Hera, Psyche, Lucy, Hayabusa, Hayabusa2, Rosetta all present |
| Absent target body types: comets | ✅ Done — Rosetta (67P), Deep Impact (Tempel 1), plus hyperbolic-orbit comets added for Ulysses (see `docs/gravigram-spec.md` Part B in the mutable-riding-church plan) |
| Absent target body types: specific moons | ✅ Done — full Galilean/Saturnian/Uranian moon sets plus Triton implemented (`docs/satellite-addition-spec.md`) |
| Absent target body types: dwarf planets | ✅ Done — Pluto/Charon (combined-GM binary system) and Ceres (dual `asteroid`+`dwarf_planet` tag) both present |

### 7.5 Missions with Direct Transfers — ✅ ALL ADDED
Every mission in the original list below is now in `data/flights/manifest.json` as its own JSON file:

Mars Odyssey, Spirit (MER-A), Opportunity (MER-B), Mars Express, MRO, Phoenix, MAVEN,
InSight, ExoMars TGO, Hope/Al-Amal, Tianwen-1, Mangalyaan — all present and verified
(Mangalyaan specifically uses the geocentric-orbit-raising leg type, not a plain
direct arc, since its real trajectory includes an Earth-orbit-raising phase before
translunar injection).

---

## 8. Key Design Decisions and Their Rationale

### 8.1 Single Lambert Arc Per Flight
The simulator models each flight as a single heliocentric transfer arc from the launch planet's position at launch date to the destination planet's position at arrival date. This is accurate for direct-transfer missions (the majority of Mars missions) but cannot represent gravity-assist chains, multi-revolution trajectories, or staged missions. This is a known, accepted limitation — it's appropriate for a visualization tool at this stage. The missions catalog tracks which missions would need model expansion.

### 8.2 `arrival` as a Single Field (Not Planned + Actual)
After research confirmed that Curiosity and Perseverance both landed on exactly their pre-launch announced dates (NASA's own press kit stated the landing date was fixed regardless of launch day within the window), a single `arrival` field was chosen over a `planned`/`actual` pair. This field always represents the intended arrival date the trajectory was calculated toward. Outcomes are captured in `status`/`statusNote` as a separate axis. This schema handles future failure cases (a mission lost during cruise still has a well-defined intended arrival date) without requiring a nullable `arrivalActual` field.

### 8.3 Screen Y-Flip Convention
`worldToScreen` uses `cy - ry * pxPerAU` — increasing world Y moves *up* on screen (decreasing pixel Y). This is the standard math-coordinates-vs-screen-coordinates inversion. Any code that converts a world-space direction vector to screen space must apply the same flip. Current locations where this matters: sphere lighting (`lightDirY = -ry / screenMag`) and the camera-follow correction. If you add any feature that involves projecting world directions to screen (e.g., arrow indicators, velocity vectors), remember the flip.

### 8.4 Lazy Lambert Solve
The expensive trajectory computation is deferred until first actual need (selection or in-transit encounter) and then memoized. This was an explicit scalability decision for the eventual thousands-of-flights logistics game direction. The cheap `getFlightDates()` / expensive `getSolvedFlight()` split must be maintained — do not collapse them back into a single always-eager function.

### 8.5 Per-Flight JSON Files
Each flight is its own file (not an array in a single flights.json) so that adding a new flight requires adding one file + one manifest line, with no JS edits. This also makes it easy to track individual flights in version control, review them independently, and eventually validate them against the missions catalog's verification system.

### 8.6 Zoom Ceiling at 20,000 px/AU
Raised from 4,000 this session specifically so that the Moon's 5.145° orbital inclination produces a visually perceptible elevation wobble (~89px of vertical travel across one orbit at max zoom, locked on Earth). At 4,000 px/AU, this was sub-pixel and invisible despite the physics being correct. The number 20,000 was chosen by computing the actual screen-pixel swing at candidate zoom levels and picking one where the inclination reads clearly.

### 8.7 Moon Physics Confirmation
The Moon uses full 6-DOF orbital elements including real inclination and both node and perigee precession. A user report that the Moon looked "flat" was investigated, confirmed to be a rendering-scale issue (the physics was correct all along), and resolved by raising the zoom ceiling. This was verified by direct numerical sampling of Z-offset across one full orbit (±35,000 km confirmed, matching `sin(5.145°) × 384,399 km`).

---

## 9. Numerical Verification Tests (Reference)

These tests were run during this session to verify specific physics claims. The test code is not in the shipped files but is archived in the session transcript. Run them again if you ever need to verify a regression:

- **Lambert solver correctness:** Verify that Curiosity's solved arc endpoints match Earth's position at 2011-11-26 and Mars's position at 2012-08-06 to machine precision (~1e-13 AU). `sweepDeg` should be ~172.4° (Type-I).
- **Akatsuki Type-II confirmation:** Akatsuki's arc should produce `sweepDeg > 180°` (~219°), confirming a Type-II (long-way) transfer. If it comes out ~141°, the sweep-direction logic has regressed.
- **Light direction sign test:** Body at world `(1, 0, 0)` should produce `lightDirX ≈ -1.0` (pointing toward screen-left, where Sol is). Body at world `(0, 1, 0)` should produce `lightDirY ≈ +1.0` (pointing downward in screen space, toward Sol which is below).
- **Lazy solve verification:** After `bootstrap()`, a frame rendered at a date with no flights in transit should log zero `getSolvedFlight` calls. A frame at 2020-10-01 should log exactly `['perseverance', 'perseverance']` (arc + marker) with no other flights solved.

---

*(Former Section 10, "Pending Research / To-Do Items," and Section 11, "Session
Transcript Reference," removed 2026-08-01: Section 10 was unrelated personal
research notes with no connection to this codebase, and Section 11 pointed at
`/mnt/transcripts/2026-06-18-14-37-08-solar-sim-and-mission-catalog.txt`, which
no longer exists on disk. Neither belongs in this project's docs.)*
