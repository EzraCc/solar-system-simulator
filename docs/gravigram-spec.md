# Gravigram Specification
## Solar System Orbital Mechanics Visualizer — Feature Extension

**Document purpose:** Complete technical specification for implementing gravity-assist
chain trajectories ("gravigrams"), Sphere of Influence (SOI) patching, and Lagrange
point support. Written for handoff to Claude Code with no assumed prior context.

**What this unlocks:** Parker Solar Probe (7 Venus flybys), BepiColombo (9-flyby chain
to Mercury), JUICE (4-flyby chain to Ganymede), ESCAPADE (L2 loiter + Earth flyby),
New Horizons (Jupiter flyby to Pluto), and all other missions that cannot be represented
as a single Lambert arc.

> **STATUS (2026-08-01), corrected:** This document uses "gravigram" as a
> name for **gravity-assist chain trajectories** — patched-conic multi-flyby
> paths, SOI radii, Lagrange points, the multi-leg flight schema. That
> specific thing (Tier 1 chained Lambert arcs, Tier 2 SOI-patched hyperbolic
> flybys via `flybyGeometry`/`vInfOutAtPhi`/`getGAChain` in `src/js/app.js`,
> `drawSOIOverlay`, `getLagrangePositions`) genuinely is implemented — that
> part of an earlier status note here was accurate.
>
> **But "gravigram" is not what the maintainer means by that word.** Per
> direct correction (2026-08-01): a gravigram is meant to be **a teaching
> visual showing net force/momentum from a combination of bodies' gravity**
> — not a trajectory-chaining feature at all. That visual has not been
> started; nothing in this document or in `app.js` builds it. Do not treat
> anything in this file as progress toward "gravigram" going forward. This
> document is kept because the gravity-assist-chain machinery it specs is
> real and still the right reference for that subsystem — just mentally
> substitute "gravity-assist chain trajectories" wherever it says
> "gravigram" below, and look elsewhere (a new spec, not yet written) for
> the actual gravigram feature.

---

## 1. The Core Problem — Why Current Architecture Can't Handle These

The current simulator models each flight as a **single heliocentric Lambert arc**: one
ellipse from launch-planet-position-at-T0 to destination-planet-position-at-T1, solved
once, propagated via Kepler. This works perfectly for direct-transfer missions
(Curiosity, Perseverance, Akatsuki's cruise leg).

It fails for gravity-assist missions because:

1. A gravity-assist flyby **discontinuously changes the spacecraft's velocity vector** —
   the outgoing heliocentric orbit is a different ellipse than the incoming one. You
   cannot represent this as a single conic section.

2. The physics of the flyby itself happens inside the **Sphere of Influence (SOI)** of
   the flyby body, where the spacecraft's motion is governed primarily by that planet's
   gravity, not the Sun's. The heliocentric model breaks down inside the SOI.

3. A multi-flyby trajectory is therefore a **sequence of patched conic sections**: one
   Lambert arc from launch to the edge of the first SOI, one hyperbolic arc through that
   SOI, one new Lambert arc from exit of that SOI to the next destination or SOI, etc.

**Patched conic approximation:** The standard engineering simplification (used for real
mission planning up through first-pass design, and appropriate for visualization) is to
treat each leg as a separate two-body problem:
- Outside any SOI: heliocentric, Sun's gravity only
- Inside a planet's SOI: planetocentric, planet's gravity only
- Transition: instantaneous handoff at the SOI boundary

This is the model this spec implements.

---

## 2. Sphere of Influence (SOI)

### 2.1 Formula

The SOI radius for a planet is:

```
r_SOI = a_planet × (m_planet / m_sun)^(2/5)
```

Where `a_planet` is the planet's semi-major axis and the mass ratio is equivalent to
`GM_planet / GM_sun` since mass is proportional to GM in Newtonian mechanics.

### 2.2 Pre-Computed Values

All values computed from GM constants already in `app.js`. Add these to `PLANET_META`:

| Planet  | SOI radius (km) | SOI radius (AU) | SOI radius (planet radii) |
|---------|----------------|-----------------|--------------------------|
| Mercury | 112,000         | 0.00075         | 46                       |
| Venus   | 616,000         | 0.0041          | 102                      |
| Earth   | 925,000         | 0.0062          | 145                      |
| Mars    | 577,000         | 0.0039          | 170                      |
| Jupiter | 48,200,000      | 0.3222          | 690                      |
| Saturn  | 54,500,000      | 0.3646          | 937                      |
| Uranus  | 51,800,000      | 0.3460          | 2041                     |
| Neptune | 86,700,000      | 0.5793          | 3520                     |

**Implementation:** Add `soiRadiusKm` and `soiRadiusAU` to each entry in `PLANET_META`.
Compute dynamically from GM values rather than hardcoding, so they stay consistent if
GM constants ever get updated:

```js
// Add to PLANET_META initialization, after planet GMs are declared:
function computeSOI(a_AU, GM_planet) {
  return a_AU * Math.pow(GM_planet / GM_SUN_KM3_S2, 2/5); // result in AU
}
```

The GM values needed (all in km³/s²) — most are already in `app.js`; add missing ones:

```js
const GM_MERCURY_KM3_S2 = 2.2032e4;      // add — not currently in app.js
const GM_VENUS_KM3_S2   = 3.24859e5;     // add
const GM_EARTH_KM3_S2   = 3.986004418e5; // already present
const GM_MARS_KM3_S2    = 4.282837e4;    // already present
const GM_JUPITER_KM3_S2 = 1.26686534e8;  // add
const GM_SATURN_KM3_S2  = 3.7931187e7;   // add
const GM_URANUS_KM3_S2  = 5.793951e6;    // add
const GM_NEPTUNE_KM3_S2 = 6.836529e6;    // add
```

### 2.3 What SOI Means in Practice for Visualization

For **visualization purposes** (not full trajectory computation), the SOI boundary is
used to:
1. Determine whether to draw the spacecraft on its heliocentric arc or its planetocentric
   hyperbolic arc at any given simulated time
2. Determine the visual "entry" and "exit" events that define the gravity-assist corridor
3. Show the SOI boundary as an optional visual overlay (a circle around the flyby planet)

The simulator does **not** need to solve the full hyperbolic trajectory inside the SOI
for basic gravigram visualization — see Section 4 for the two implementation tiers.

---

## 3. Lagrange Points

### 3.1 What They Are

For any two-body system (Sun + planet), there are 5 equilibrium points where a third
small body can maintain a fixed position relative to the two primaries. The relevant
ones for this simulator:

- **L1:** Between the two bodies. For Sun-Earth, approximately 1.5M km from Earth toward
  the Sun. Gravitationally unstable (halo orbit around L1 requires stationkeeping).
  Used by: SOHO, DSCOVR, Aditya-L1.

- **L2:** Directly opposite L1, behind the smaller body relative to the larger. For
  Sun-Earth, approximately 1.5M km from Earth away from the Sun. Also unstable.
  Used by: Webb, Gaia, Herschel, Planck, WMAP; ESCAPADE loiters here en route to Mars.

- **L4 / L5:** 60° ahead and behind the smaller body in its orbit, at the same orbital
  radius. **Stable** — objects naturally librate around these points. Jupiter's Trojan
  asteroids are L4/L5 objects. Lucy visits the L4 and L5 Trojan clouds.

- **L3:** Opposite the smaller body, behind the Sun. Dynamically unstable. Not
  mission-relevant; include in the spec for completeness but don't prioritize rendering.

### 3.2 Computing Lagrange Point Positions

Given planet orbital elements `{a, e, i, Om, w, M}` at any `daysSinceEpoch`, the planet
has a computed state vector `{pos, vel}`. Lagrange point positions follow:

**L1 and L2** — offset along the Sun-planet line by the Hill sphere radius:

```js
function hillSphereRadiusAU(a_AU, GM_planet) {
  return a_AU * Math.pow(GM_planet / (3 * GM_SUN_KM3_S2_AS_AU3_DAY2_EQUIVALENT), 1/3);
  // Note: use consistent units. If a_AU is in AU and you want result in AU:
  // r_Hill = a_AU * (GM_planet / (3 * GM_sun))^(1/3)
  // where both GMs are in the same units
}
```

More precisely: use mass ratio `mu = GM_planet / (GM_sun + GM_planet)`, then:
```
r_Hill = a * (mu/3)^(1/3)
L1 position = planet_pos * (1 - r_Hill / |planet_pos|)   [toward Sun]
L2 position = planet_pos * (1 + r_Hill / |planet_pos|)   [away from Sun]
```

**Pre-computed Hill sphere radii** (these are also the L1/L2 offsets from the planet):

| Planet  | Hill radius / L1 offset from planet |
|---------|-------------------------------------|
| Mercury | 221,000 km (0.0015 AU)              |
| Venus   | 1,011,000 km (0.0068 AU)            |
| Earth   | 1,497,000 km (0.0100 AU)            |
| Mars    | 1,084,000 km (0.0072 AU)            |
| Jupiter | 53,100,000 km (0.3551 AU)           |
| Saturn  | 65,200,000 km (0.4355 AU)           |

**L4 and L5** — same orbital radius as the planet, ±60° in true anomaly:

```js
// If planet is at heliocentric position vector p, L4 is at:
// Rotate p by +60° around the ecliptic pole (Z axis)
// L5 is at -60°

function rotateZ(pos, angleDeg) {
  const theta = angleDeg * Math.PI / 180;
  return [
    pos[0] * Math.cos(theta) - pos[1] * Math.sin(theta),
    pos[0] * Math.sin(theta) + pos[1] * Math.cos(theta),
    pos[2]
  ];
}
// L4 = rotateZ(planet.pos, +60)
// L5 = rotateZ(planet.pos, -60)
```

### 3.3 Rendering Lagrange Points

Add as a new body category, distinct from planets and moons:

- Small marker (diamond or cross, not a circle — visually distinct from bodies)
- Labeled on hover: "Earth L2", "Jupiter L4", etc.
- Optional: show SOI-equivalent "stability zone" radius around L4/L5 as a shaded region
- L1/L2 markers should scale their visual size slightly with zoom (they're at a fixed AU
  distance from the planet, so they'll naturally move on screen as zoom changes, but
  the marker itself can be fixed-pixel like body markers)

### 3.4 Lagrange Points in the Flight Schema

For missions that loiter at a Lagrange point (ESCAPADE, Webb, Aditya-L1), the flight
data schema needs to support Lagrange points as intermediate or final destinations:

```json
{
  "key": "escapade",
  "legs": [
    {
      "type": "lambert",
      "launchBody": "Earth",
      "destinationBody": "Earth_L2",
      "launchDate": "2025-11-13",
      "arrival": "2025-12-01"
    },
    {
      "type": "loiter",
      "location": "Earth_L2",
      "departure": "2026-11-01"
    },
    {
      "type": "gravity_assist",
      "flybyBody": "Earth",
      "date": "2026-11-15"
    },
    {
      "type": "lambert",
      "launchBody": "Earth",
      "destinationBody": "Mars",
      "launchDate": "2026-11-15",
      "arrival": "2027-09-01"
    }
  ]
}
```

This multi-leg schema replaces the current single-field schema for complex missions.
Simple direct-transfer missions retain the current flat schema for backward compatibility
(the loader detects the presence of a `legs` array vs. a flat `launchDate`).

---

## 4. Gravigram: Two Implementation Tiers

Implement in order. Tier 1 is visually useful and architecturally sound. Tier 2 adds
physical accuracy inside the SOI.

### Tier 1 — Chained Lambert Arcs (Recommended First Implementation)

**What it does:** Model the entire trajectory as a sequence of Lambert arcs. Each leg
connects a departure position to an arrival position. Flyby legs are simplified as:
"arrive at flyby planet's position at date T_flyby, depart from same position toward
next target."

**What it ignores:** The actual hyperbolic path inside the SOI (the spacecraft doesn't
really pass through the center of the planet — it follows a hyperbola that bends its
velocity vector). For visualization purposes at heliocentric scale, this simplification
is nearly undetectable visually (the SOI is small compared to interplanetary distances
for inner planets) and is standard practice in trajectory visualization tools.

**Data structure per leg:**

```js
{
  type: "lambert",
  fromBody: "Earth",         // or a Lagrange point key or "deepspace_point"
  toBody: "Mars",
  fromDate: Date,            // departure date for this leg
  toDate: Date,              // arrival date for this leg
  // solved lazily, same as current getSolvedFlight():
  elements: null,            // filled in by getSolvedLeg() on first need
  launchDays: float,
  arrivalDays: float,
}
```

**Solver:** `getSolvedLeg(flightKey, legIndex)` — same Lambert machinery already in
`app.js` (`solveLambertUniversal`, `stateVectorToElements`), applied per-leg. Lazy +
memoized per leg, not per flight, so a flight with 4 legs solves only the currently-
visible leg on first encounter, not all 4 at once.

**Rendering:** Each leg's arc draws exactly like the current `drawFlightArc()`. Multiple
arcs for the same flight draw in the same color with slightly different opacity or dash
pattern per leg (define a visual convention; don't make them indistinguishable).

**Position at time T:** Walk through the leg list chronologically. Find which leg's
`[launchDays, arrivalDays]` window contains `daysSinceEpoch`. Propagate position on
that leg's arc via the existing `computeFlightPosition()` function. If T falls between
legs (in a loiter period at a Lagrange point), position = that Lagrange point's
computed position at T.

**Visibility gate:** `isFlightVisible(key, daysSinceEpoch)` now checks whether T falls
within **any** leg's window (not just a single `launchDays..arrivalDays`). This must
remain the cheap-path check using only date arithmetic, never triggering a solve.

### Tier 2 — SOI-Patched Conics (Higher Fidelity)

**What it adds:** Inside the SOI of a flyby planet, the spacecraft follows a hyperbolic
trajectory around that planet. This produces the correct velocity-vector bend angle
(which determines what the outgoing heliocentric orbit actually is), not just the
hand-waved "arrives and departs from same position."

**Why it matters:** The trajectory bend angle at a flyby determines the entire shape of
the next leg. If you're doing this properly for Parker Solar Probe (7 Venus flybys over
7 years, each one lowering the perihelion), the cumulative error from ignoring SOI
physics compounds significantly. For BepiColombo (9 flybys) or JUICE (4 across multiple
bodies), same issue.

**What Tier 2 requires that Tier 1 does not:**

1. **Hyperbolic conic solver** — given an incoming velocity vector relative to a planet
   (v_∞_in), a desired flyby altitude (periapsis distance r_p), and the planet's GM,
   compute the outgoing velocity vector (v_∞_out):

   ```
   v_∞ = |v_incoming - v_planet|          // velocity relative to planet (hyperbolic excess)
   e = 1 + r_p * v_∞² / GM_planet        // eccentricity of hyperbolic orbit (e > 1 always)
   δ = 2 * arcsin(1/e)                   // turn angle (bend angle)
   ```

   The direction of v_∞_out is v_∞_in rotated by δ around the axis perpendicular to
   the flyby plane. The flyby plane is defined by the incoming velocity vector and the
   planet's position. (In 3D, there's an additional degree of freedom: which side of the
   planet the spacecraft passes on — this determines the sign of the rotation and is
   defined by `b_plane_angle` in the flight data.)

2. **Planetocentric propagation** — inside the SOI, propagate the hyperbolic trajectory:

   ```
   r(θ) = p / (1 + e·cos(θ))    // same conic formula, but e > 1
   p = a(e² - 1)                 // semi-latus rectum for hyperbola (note: a is negative for hyperbola)
   ```

   The spacecraft enters the SOI at some true anomaly θ_entry < 0 (before periapsis),
   reaches periapsis (closest approach), then exits at θ_exit > 0 (symmetric for
   unpowered flyby).

3. **SOI entry/exit matching** — the heliocentric arrival velocity at the SOI boundary
   must equal the planetocentric velocity at SOI entry (in the planet's frame), and
   vice versa at exit. This is what makes patched conics self-consistent.

**For Parker Solar Probe specifically** (the priority mission for this feature):

PSP's trajectory:
- Launch: 2018-08-12
- Venus flyby 1: 2018-10-03 (r_p = 2,394 km above Venus surface)
- Venus flyby 2: 2019-12-26
- Venus flyby 3: 2020-07-11
- Venus flyby 4: 2021-02-20
- Venus flyby 5: 2021-10-16
- Venus flyby 6: 2023-08-21
- Venus flyby 7: 2024-11-06
- Solar perihelion closest approach: 2024-12-24 (6.1 solar radii / 4.25M km)

Each Venus flyby lowers PSP's solar perihelion. The perihelion at launch was ~35 solar
radii; after 7 Venus flybys it reaches 6.1 solar radii. This is the trajectory that
cannot be shown without Tier 2 — a chain of 7 Lambert arcs would get the broad path
approximately right but would not produce the correct perihelion evolution.

---

## 5. Flight Data Schema — Multi-Leg Format

### 5.1 Schema Extension

Current flat schema (retained for simple missions, backward-compatible):
```json
{
  "key": "curiosity",
  "name": "...",
  "launchBody": "Earth",
  "destinationBody": "Mars",
  "launchDate": "2011-11-26",
  "arrival": "2012-08-06",
  "status": "Success",
  "statusNote": null
}
```

New multi-leg schema (detected by presence of `legs` array):
```json
{
  "key": "psp",
  "name": "Parker Solar Probe",
  "status": "Success",
  "statusNote": null,
  "legs": [
    {
      "index": 0,
      "type": "lambert",
      "fromBody": "Earth",
      "toBody": "Venus",
      "departDate": "2018-08-12",
      "arrivalDate": "2018-10-03",
      "notes": "Launch to Venus flyby 1"
    },
    {
      "index": 1,
      "type": "gravity_assist",
      "flybyBody": "Venus",
      "date": "2018-10-03",
      "periapsisKm": 2394,
      "bPlaneAngleDeg": null,
      "notes": "Venus flyby 1 — periapsis 2,394 km above surface"
    },
    {
      "index": 2,
      "type": "lambert",
      "fromBody": "Venus",
      "toBody": "Venus",
      "departDate": "2018-10-03",
      "arrivalDate": "2019-12-26",
      "notes": "Interleg arc — Venus to Venus flyby 2"
    },
    ...
  ]
}
```

**Leg types:**
- `lambert` — heliocentric transfer arc, solved by existing Lambert machinery
- `gravity_assist` — flyby at a named body; Tier 1 treats as instantaneous, Tier 2
  solves the hyperbolic arc inside SOI
- `loiter` — spacecraft holds a fixed location (typically a Lagrange point) for a
  defined period with stationkeeping; position = that location's current computed position
- `deepspace_maneuver` — a propulsive burn mid-cruise that alters the trajectory; not
  a gravity assist. Modeled as ending one Lambert leg and beginning another at the same
  position but different velocity.

### 5.2 Loader Changes (app.js)

`loadFlightsRaw()` detects schema version and handles both:

```js
function isMultiLeg(raw) { return Array.isArray(raw.legs); }

function getFlightDates(key) {
  const raw = FLIGHTS_RAW[key];
  if (isMultiLeg(raw)) {
    const lambertLegs = raw.legs.filter(l => l.type === 'lambert');
    const launchDays = daysSinceJ2000(new Date(lambertLegs[0].departDate + 'T00:00:00Z'));
    const lastLeg = lambertLegs[lambertLegs.length - 1];
    const arrivalDays = daysSinceJ2000(new Date(lastLeg.arrivalDate + 'T00:00:00Z'));
    return { launchDays, arrivalDays, tofDays: arrivalDays - launchDays };
  }
  // ... existing flat-schema code ...
}
```

`isFlightVisible()` unchanged in interface — it still calls `getFlightDates()` and
checks the `launchDays..arrivalDays` window. For a multi-leg mission, this is the
window from first departure to final arrival, which is correct (the spacecraft is
somewhere in the system throughout).

---

## 6. Visual Design — What a Gravigram Looks Like

### 6.1 Arc Segments

Each Lambert leg of a multi-leg trajectory draws as a separate arc, same color as the
flight, with a consistent visual language to indicate sequence:

- All legs of the same flight share the flight's color (`#7fd99c` currently, or future
  per-type color from the taxonomy)
- Interleg connections at flyby points are indicated by a small "bend marker" — a
  brighter dot at the flyby location at the flyby date (distinct from the spacecraft
  position dot, which moves)
- Arc opacity could decrease slightly for later legs (first leg full opacity, subsequent
  legs at 85%, 70%, etc.) to give a sense of sequence without requiring labels

### 6.2 SOI Visualization (optional overlay)

When a flight with a gravity-assist leg is selected, optionally draw the SOI boundary of
each flyby planet as a dashed circle around that planet at the time of flyby. This makes
the "what's happening inside that circle" intuition legible.

- Only draw SOI circle for flyby planets, not all planets
- Only when the flight is selected, not always (would be visual clutter)
- Animate: the SOI circle could appear as the spacecraft approaches and fade once it
  departs

### 6.3 Spacecraft Marker

The moving spacecraft dot (`screenR: 3`) follows the active leg's arc at the current
simulated time. At flyby moments (Tier 1), the marker jumps from the incoming arc to the
outgoing arc instantaneously. At Tier 2, it follows the hyperbolic arc through the SOI,
which means the marker briefly orbits the flyby planet rather than passing through it.

### 6.4 Lagrange Point Markers

- Small diamond marker (4-point star or ×, distinct from circular body markers)
- Only rendered when a flight uses that Lagrange point, or when Lagrange-point display
  is toggled on in the legend
- L4/L5 markers move with the planet's orbit — they need to be recomputed each frame
  from the planet's current position (fast: just `rotateZ(planet.pos, ±60)`)
- L1/L2 markers similarly track the planet, offset along the Sun-planet line

---

## 7. Integration Points in the Current Codebase

### 7.1 Files to Modify

- **`app.js`** — all solver and rendering changes
- **`flights/manifest.json`** — add new multi-leg flight keys
- **`flights/<key>.json`** — new per-flight files using multi-leg schema
- **`style.css`** — no changes expected; gravigram visual elements are all Canvas2D

### 7.2 Functions to Extend (app.js)

| Function | Current behavior | New behavior |
|---|---|---|
| `getFlightDates(key)` | Reads flat schema | Detects and handles multi-leg schema |
| `getSolvedFlight(key)` | Solves one Lambert arc | Delegates to `getSolvedLeg(key, legIndex)` for multi-leg |
| `isFlightVisible(key, t)` | Checks single window | Unchanged — `getFlightDates` already returns overall window |
| `drawFlightArc(flight)` | Draws one arc | Draws all legs' arcs in sequence |
| `computeFlightPosition(flight, t)` | Propagates on one arc | Finds active leg, propagates on that leg's arc |
| `selectFlight(key)` | Jumps to single launch date | Unchanged — still jumps to first leg's departure |

### 7.3 Functions to Add (app.js)

```js
// Lazy memoized solver for a single leg within a multi-leg flight
function getSolvedLeg(flightKey, legIndex) { ... }

// Hyperbolic SOI trajectory (Tier 2 only)
function solveHyperbolicFlyby(v_inf_in, periapsisKm, GM_planet, bPlaneAngleDeg) { ... }

// Lagrange point positions at a given epoch
function getLagrangePositions(planetKey, daysSinceEpoch) {
  // returns { L1, L2, L4, L5 } as AU position vectors
}

// SOI entry/exit times for a given incoming arc (useful for animation)
function computeSOIEntryExit(legSolved, flybyPlanetKey, daysSinceEpoch) { ... }
```

### 7.4 New Data Structures

```js
// Add to PLANET_META entries:
{
  soiRadiusAU: float,    // computed from GM ratio
  hillRadiusAU: float,   // computed from GM ratio (Hill sphere = L1/L2 offset)
  gmKm3S2: float,        // planet GM in km³/s² (needed for hyperbolic solver)
}

// Leg solve cache (analogous to current _solvedFlightCache):
const _solvedLegCache = {};
// Key: `${flightKey}:${legIndex}`

// Lagrange point position cache (per planet, per frame):
const _lagrangeCache = {};
// Key: `${planetKey}:${Math.floor(daysSinceEpoch)}` (1-day resolution)
```

---

## 8. Implementation Order

**All 8 steps below are done.** Recommended sequence for Claude Code (kept as
historical record of the actual build order):

1. **Add GM constants and SOI/Hill radii to PLANET_META** — pure data addition, no
   behavior change. Verified against the pre-computed table in Section 2.2.

2. **Implement `getLagrangePositions()`** — math is simple (rotation + offset), renders
   as fixed markers, useful immediately for ESCAPADE's L2 loiter even before full
   multi-leg support exists.

3. **Extend flight schema loader** to detect and parse multi-leg `legs` array, populate
   `getFlightDates()` from the full window across all legs.

4. **Implement `getSolvedLeg(flightKey, legIndex)`** — same Lambert machinery as
   `getSolvedFlight()`, applied per-leg. Wire into `computeFlightPosition()` and
   `drawFlightArc()`.

5. **Render multi-leg arcs** — update `drawFlightArc()` to iterate over all solved legs
   and draw each one. Add bend markers at flyby points.

6. **Add Lagrange point markers to the renderer** — track active flight's Lagrange point
   legs, draw markers at those positions each frame.

7. **Add SOI circle overlay** — optional, draw when a flight with `gravity_assist` legs
   is selected.

8. **(Tier 2)** **Implement `solveHyperbolicFlyby()`** — adds physical accuracy inside
   SOI. Required for Parker Solar Probe's perihelion evolution to be correct.

**Parker Solar Probe can be added after step 4** using Tier 1 (chained Lambert arcs).
The broad trajectory will be visually correct. Add its data file once the multi-leg
loader and renderer exist. Tier 2 is needed to show the correct perihelion shrinking
correctly across the 7 flybys.

---

## 9. Reference Data — Priority Missions

All three missions below are implemented (`data/flights/psp.json`,
`data/flights/escapade.json`, `data/flights/bepicolombo.json`).

### Parker Solar Probe (NASA, 2018)
7 Venus gravity assists over ~6 years. All dates confirmed from NASA mission timeline.

| Leg | From | To | Depart | Arrive | Notes |
|-----|------|----|--------|--------|-------|
| 0 | Earth | Venus | 2018-08-12 | 2018-10-03 | Launch |
| GA1 | Venus flyby | | 2018-10-03 | | Periapsis 2,394 km above surface |
| 1 | Venus | Venus | 2018-10-03 | 2019-12-26 | |
| GA2 | Venus flyby | | 2019-12-26 | | |
| 2 | Venus | Venus | 2019-12-26 | 2020-07-11 | |
| GA3 | Venus flyby | | 2020-07-11 | | |
| 3 | Venus | Venus | 2020-07-11 | 2021-02-20 | |
| GA4 | Venus flyby | | 2021-02-20 | | |
| 4 | Venus | Venus | 2021-02-20 | 2021-10-16 | |
| GA5 | Venus flyby | | 2021-10-16 | | |
| 5 | Venus | Venus | 2021-10-16 | 2023-08-21 | |
| GA6 | Venus flyby | | 2023-08-21 | | |
| 6 | Venus | Venus | 2023-08-21 | 2024-11-06 | |
| GA7 | Venus flyby | | 2024-11-06 | | |
| 7 | Venus | Sun | 2024-11-06 | 2024-12-24 | Final perihelion 6.1 solar radii |

### ESCAPADE (NASA, 2025) — requires Lagrange point support
| Leg | Type | Notes |
|-----|------|-------|
| Earth → L2 | lambert | 2025-11-13 launch |
| L2 loiter | loiter | ~2025-12 to 2026-11 |
| L2 → Earth flyby | lambert | departure ~2026-11 |
| Earth flyby | gravity_assist | ~2026-11-15 |
| Earth → Mars | lambert | 2026-11-15 → 2027-09 |

### BepiColombo (ESA/JAXA, 2018) — 9 flybys, Mercury orbit Nov 2026
9 gravity assists: 1 Earth (2020-04-10), 2 Venus (2020-10-15, 2021-08-11),
6 Mercury (2021-10-01, 2022-06-23, 2023-06-19, 2024-09-04, 2024-12-01, 2025-01-08).
Mercury orbit insertion: 2026-11-21.

---

## 10. What This Spec Does Not Cover

- **n-body integration** — not needed for this visualizer. Patched conics is appropriate.
- **Trajectory optimization** — real mission design solves for optimal flyby dates and
  periapsis distances. This simulator takes those dates as given from real mission data.
- **Atmospheric drag / aerobraking** — Mars aerobraking (used by MRO, Mars Odyssey to
  circularize orbit) is a separate category not addressed here.
- **Station-keeping propellant budgets** — Lagrange point halos need continuous small
  burns; modeled here as perfectly stable for simplicity.
- **Relativistic corrections** — negligible for solar system visualization purposes.
- **Powered deep-space maneuvers** (DSMs) — some missions (e.g. Cassini's DSMs to
  fine-tune flyby geometry) involve mid-cruise burns. These can be approximated by
  splitting a Lambert leg at the burn date, which the multi-leg schema supports via
  the `deepspace_maneuver` leg type.
