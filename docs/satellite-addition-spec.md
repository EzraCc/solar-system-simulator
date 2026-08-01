# Adding Planetary Satellites (Moons) to the Simulator
## Implementation Specification — Solar System Orbital Mechanics Visualizer

**Document purpose:** Complete checklist and decision guide for adding any new natural
satellite to the simulator. Covers every touch point in the codebase, every physics
decision that must be made per-satellite, and the deliberate simplifications already
made for existing satellites so new additions stay consistent.

**Implementation note:** The Moon, Phobos, and Deimos use individually-named constants
(`MOON_ELEMENTS`, `PHOBOS_META`, etc.) — legacy pattern, kept as-is. All outer moons
(Galilean, Saturnian, Uranian, Neptunian) use the `OUTER_MOONS` array structure
described in Section 8. New additions should follow the `OUTER_MOONS` pattern, not
the named-constants pattern.

> **STATUS (2026-08-01): Living reference document, still accurate.** Unlike
> the other two `docs/` specs, this one isn't a single completed feature —
> it's the standing checklist/decision-guide for *whenever* a new satellite
> gets added, and remains the right doc to consult for that. All satellites
> in Section 10's priority table are now implemented (see that section's own
> status update) using exactly the patterns described here (`OUTER_MOONS` for
> everything except the Moon/Phobos/Deimos/Pluto-Charon's legacy/combined-GM
> cases). Keep this doc maintained going forward rather than archiving it.

---

## 1. The Complete Touch-Point Checklist

**For moons added to `OUTER_MOONS`** (all outer planet moons — the right pattern for
anything new):

```
[ ] 1. GM constant for the primary planet in km³/day² — add to OUTER_PLANET_GM_DAY2
       if the planet isn't already there. The km³/s² constant already exists in the
       GM block near the top of app.js; just add _KM3_DAY2 = _KM3_S2 * SEC_PER_DAY².
[ ] 2. Add an entry to OUTER_MOONS[planetName] with elements + meta.
       That's it for data. The loops in frame() and buildLegend() handle the rest.
[ ] 3. Verify formatLockedPanelContent() handles b.primary correctly (it does, generically).
```

Steps 4–8 from the old per-moon checklist are now handled by generic loops:
- `frame()` Pass 1 iterates `OUTER_MOONS` → computes all states, populates `worldStates`
- `frame()` orbit ellipse pass iterates `OUTER_MOONS` → draws orbits gated by `isSatelliteVisible`
- `frame()` Pass 2 iterates `outerMoonAbs` → calls `pushSatelliteBody` for visible moons
- `buildLegend()` iterates `OUTER_MOONS[name]` inside `PLANET_ORDER.forEach` → adds legend rows

**For inner-system moons using the legacy pattern** (Moon, Phobos, Deimos):

```
[ ] 1. GM constant for primary (km³/s² + km³/day² variant)
[ ] 2. ELEMENTS const — orbital elements at J2000
[ ] 3. META const — color + radiusKm
[ ] 4. buildSatelliteAbs() call inside frame() Pass 1
[ ] 5. worldStates entry
[ ] 6. Orbit ellipse draw (gated by isSatelliteVisible)
[ ] 7. pushSatelliteBody() call in Pass 2
[ ] 8. addSatelliteRow() call in buildLegend()
[ ] 9. Verify formatLockedPanelContent() handles b.primary correctly (it does)
```

---

## 2. Physics Decisions Required Per Satellite

These must be resolved from reference sources before writing any code. Each has a
confirmed answer for the Moon, Phobos, and Deimos; the same questions need answers
for any new satellite.

### 2.1 What is the reference plane for inclination?

**The question:** Inclination relative to *what*? Options are:
- The ecliptic plane (what this simulator uses as its global XY plane)
- The planet's equatorial plane (what most moon catalogs quote natively)
- The local Laplace plane (relevant for moons heavily perturbed by the planet's oblateness)

**Current answers:**
- Moon: 5.145° to the **ecliptic**. This is the natural frame; the Moon's orbit happens
  to be close to the ecliptic, so ecliptic-frame elements are the standard reference.
- Phobos/Deimos: orbital inclinations in the **ecliptic frame** are 26.04° and 27.58°
  respectively. Both orbit almost exactly in Mars's equatorial plane (inclination to that
  plane is ~1° or less). Mars's obliquity is ~25°, so the ecliptic-frame inclination
  is approximately Mars's obliquity. These values were taken from published reference
  tables rather than derived from Mars's pole orientation — see Section 3.1 for the
  named simplification this represents.

**For new satellites:** If the reference catalog gives inclination to the planet's
equator, you must convert to ecliptic-frame inclination before using it here. The
conversion requires the planet's pole orientation (right ascension and declination of
the north pole, which changes slowly over time). For inner system moons (Earth, Mars)
this is straightforward. For outer system moons (Jupiter, Saturn), the planet's
obliquity is larger and the conversion matters more.

**Formula (equatorial → ecliptic frame inclination):**
For a moon orbiting in a planet's equatorial plane (i_eq ≈ 0), the ecliptic-frame
inclination is approximately equal to the planet's axial tilt (obliquity). For a moon
with non-negligible equatorial inclination i_eq:
```
i_ecliptic ≈ i_eq + obliquity   (rough; exact conversion uses spherical trig)
```
For Galilean moons (i_eq < 0.5°): i_ecliptic ≈ Jupiter's obliquity ≈ 3.13°.
For Titan (i_eq ≈ 0.35°): i_ecliptic ≈ Saturn's obliquity + 0.35° ≈ 27.1°.
For Triton (retrograde): i_ecliptic ≈ 130.8° — **not** 157° (equatorial).
Neptune's obliquity is 28.3°; Triton's equatorial inclination is ~157° but the
ecliptic-frame inclination requires a full pole-vector computation. Use 130.8°.

### 2.2 Does the node precess, and does it matter at this simulator's timescale?

**The question:** The ascending node (Ω) and argument of perigee (ω) both drift over
time. Whether to model this depends on: (a) how fast they drift, and (b) whether the
drift is visually significant over the timescale users explore.

**Current answers:**
- Moon: **Yes, modeled.** Nodal period 18.61 years, apsidal period 8.85 years. On
  multi-year timescales these are visually significant; over 10 years the node moves
  almost halfway around. Implemented as linear rates from J2000 values.
- Phobos/Deimos: **No, held fixed.** Phobos's node precesses around the local Laplace
  plane with a period of months — but the Laplace plane inclination is under 0.05°,
  so the visual wobble this would add is sub-pixel at any zoom level this simulator
  supports. Explicitly named as a deliberate simplification in the code comments.
- Callisto: **Yes, modeled.** Nodal period ~56 years (20,600 days), comparable to the
  Moon's 18.6-year period in terms of visual significance. `nodalPeriodDays: 20600`
  is set in the OUTER_MOONS entry.

**For new satellites — decision rule:**
1. Look up the nodal precession period.
2. If the period is longer than ~5 years: model it (add `nodalPeriodDays` and
   optionally `apsidalPeriodDays` to the elements object; `computeSatelliteOffset`
   already handles these if present).
3. If the period is shorter than ~5 years: check whether the Laplace plane inclination
   (the plane around which it precesses) is small. If small (< ~1°), omit (same as
   Phobos/Deimos). If large, model it.
4. If uncertain: omit with a named comment explaining why.

**Galilean moons reference:**
- Io: nodal precession period ~508 days (~1.4 years) → borderline; Laplace inclination
  is ~0.04°, so the visual wobble is negligible → omit, with comment.
- Europa: ~1024 days, Laplace inclination ~0.47° → omit.
- Ganymede: ~3096 days (~8.5 years) → on the boundary; Laplace inclination ~0.19° →
  omit is defensible; model if long timescales matter.
- Callisto: ~20,600 days (~56 years) → **model it** (implemented: `nodalPeriodDays: 20600`).

### 2.3 Should the GM use a combined primary+satellite value, or primary-only?

**The question:** Kepler's third law gives the orbital period as:
```
T = 2π √(a³ / GM_total)
```
where `GM_total = GM_primary + GM_satellite`. For most moons, the satellite's GM is
negligible compared to the primary's. For the Moon, it's not (Moon GM is ~1.2% of
Earth's GM, non-negligible for a 0.01-level accuracy claim).

**Current answers:**
- Moon: **Combined GM used** (`GM_EARTH_MOON_KM3_DAY2 = (GM_EARTH + GM_MOON) × day²`).
  This is used in `buildSatelliteAbs()` as `primaryGmKm3Day2`, and in the info panel
  to compute the displayed orbital period. The Moon's *position propagation* uses its
  known sidereal period directly rather than deriving mean motion from GM — this is
  more accurate because the real Moon is heavily perturbed by the Sun in ways a clean
  two-body GM value can't capture.
- Phobos/Deimos: **Primary-only GM** (`GM_MARS_KM3_DAY2`). Their masses are negligible
  relative to Mars's (Phobos mass/Mars mass ≈ 1.8 × 10⁻⁸). Explicitly noted in code.
- Outer moons: **Primary-only GM** via `OUTER_PLANET_GM_DAY2[planetName]`. All mass
  ratios are well below the 0.1% threshold (Titan/Saturn ≈ 2.4 × 10⁻⁴).

**For new satellites — threshold:**
If `GM_satellite / GM_primary > 0.001` (0.1%), use combined GM.
Otherwise, use primary-only.

Reference mass ratios:
- Moon/Earth: ~0.012 → use combined ✓ (already done)
- Titan/Saturn: ~2.4 × 10⁻⁴ → primary-only acceptable; combined for rigor
- Ganymede/Jupiter: ~7.8 × 10⁻⁵ → primary-only
- Io/Jupiter: ~4.7 × 10⁻⁵ → primary-only
- Triton/Neptune: ~2.1 × 10⁻⁴ → primary-only acceptable; combined for rigor
- Charon/Pluto: ~0.12 → must use combined (Pluto-Charon is almost a binary system)

### 2.4 What is the reference epoch for M₀ (mean anomaly at J2000)?

The elements must be referenced to J2000 (2000-01-01 12:00 TT). Most planetary science
references give elements at this epoch. Verify the source epoch before using values
directly. If the source gives elements at a different epoch, the mean anomaly must be
propagated to J2000 using:
```
M_J2000 = M_epoch + n × Δt
```
where n = 2π / T (mean motion in rad/day) and Δt = days from source epoch to J2000.

**For Phobos/Deimos:** M₀ was set to 0 (both) with a deliberate arbitrary Ω₀ offset for
Deimos (90°) to prevent them from rendering coincident at epoch. This is acceptable
for small moons where the exact initial phase angle doesn't affect any physics check.
For scientifically important moons (Galilean, Titan), use real reference values.

**Current limitation:** OmDeg0, wDeg0, and M0Deg in `OUTER_MOONS` are approximate —
not pulled from JPL Horizons. Phase angles at J2000 will be off. Orbital planes and
periods are correct. This is flagged in a code comment. Fix by querying JPL Horizons
for each moon at epoch 2000-Jan-01 12:00 TT before using for any precision check.

---

## 3. Named Simplifications in the Current Implementation

These are deliberate approximations, not errors. Document any new simplifications
the same way — comment in code and record here.

### 3.1 Phobos/Deimos: Fixed Reference Plane Approximation

**What was simplified:** The ecliptic-frame inclinations (26.04° and 27.58°) were
taken directly from published reference tables rather than being derived from Mars's
true (slowly precessing) pole orientation and equatorial-to-ecliptic frame rotation.

**Why acceptable:** The residual error from Mars's true pole vs. its mean ~25° obliquity
is far smaller than the rendered pixel size of these moons at any zoom level the
simulator supports.

**Would need revisiting if:** True-scale rendering is added, or if orbital elements
are being used for precision calculations (e.g., timing occultations).

### 3.2 Phobos/Deimos: Fixed Ascending Node

**What was simplified:** The ascending node (Ω) is held fixed. The real Phobos node
precesses around the local Laplace plane with a period of months.

**Why acceptable:** Phobos's inclination to the Laplace plane is < 0.05°. The
visual wobble this precession would add is negligible at this simulator's scale.

### 3.3 Moon: Linear Precession Model

**What was simplified:** Node and perigee precession are modeled as constant linear
rates from J2000 values, not as the full perturbed lunar theory.

**Why acceptable:** For visualization purposes over decades, the linear approximation
is close enough. Full lunar theory (e.g., ELP 2000) is needed only for sub-arcminute
positional accuracy or precise eclipse prediction — not required here.

### 3.4 All Satellites: No J2 Oblateness Correction

Satellites close to a planet (especially Io, Phobos) are significantly perturbed by
the planet's oblateness (J₂ term). This causes apsidal precession beyond the nominal
solar perturbation rate. Not currently modeled. For inner Galilean moons and inner
system small moons, this may be visually significant at high zoom.

### 3.5 Outer Moons: Approximate Phase Angles at J2000

OmDeg0, wDeg0, and M0Deg for all OUTER_MOONS entries are approximate — not sourced
from JPL Horizons. Orbital periods and planes are correct; only initial phase positions
within each orbit are off. The Galilean Laplace resonance (Io:Europa:Ganymede = 1:2:4
mean motion) is not enforced; each moon propagates independently.

---

## 4. The Orbital Elements Schema

`computeSatelliteOffset(elements, daysSinceEpoch)` reads the following fields:

```js
{
  aKm: float,                   // REQUIRED. Semi-major axis in km.
  e: float,                     // REQUIRED. Eccentricity (0 = circular).
  iDeg: float,                  // REQUIRED. Inclination to ecliptic, degrees.
                                 //           See Section 2.1 for reference plane decisions.
  periodSiderealDays: float,    // REQUIRED. Sidereal orbital period, days.
                                 //           Used for mean motion n = 2π/T.
                                 //           Prefer observed period over GM-derived for
                                 //           heavily-perturbed moons (Moon, inner Galileans).
  OmDeg0: float,                // REQUIRED. Longitude of ascending node at J2000, degrees.
  wDeg0: float,                 // REQUIRED. Argument of perigee at J2000, degrees.
  M0Deg: float,                 // REQUIRED. Mean anomaly at J2000, degrees.

  nodalPeriodDays: float,       // OPTIONAL. If present, node regresses linearly:
                                 //           Ω(t) = OmDeg0 - 360 × (t / nodalPeriodDays)
                                 //           Omit if node is held fixed (Phobos/Deimos case).
  apsidalPeriodDays: float,     // OPTIONAL. If present, argument of perigee progresses:
                                 //           ω(t) = wDeg0 + 360 × (t / apsidalPeriodDays)
                                 //           Omit if held fixed.
}
```

The function returns `{ posAU, velAU, rKm, a, e, i, Om, w, M, nu }`. All of these
are passed through `pushSatelliteBody()` into the body record, where `a`, `e`, `i`
are used for the locked-panel display. `rKm` becomes `rKmFromPrimary`.

---

## 5. The META Schema

```js
// In OUTER_MOONS, the meta object is inline:
{ color: "#rrggbb", radiusKm: float }

// color: hex color for the body dot and legend swatch
// radiusKm: physical radius — used by bodyScreenRadius() for display scaling
//           (log-ish scale, not true to scale) and for comparison panel
```

---

## 6. GM Constants Required

The outer planet GMs in km³/s² are already declared in the GM block near the top of
`app.js`. To add a new outer planet, add its `_KM3_DAY2` constant and register it in
`OUTER_PLANET_GM_DAY2`:

```js
const GM_NEWPLANET_KM3_DAY2 = GM_NEWPLANET_KM3_S2 * SEC_PER_DAY * SEC_PER_DAY;

const OUTER_PLANET_GM_DAY2 = {
  Jupiter: GM_JUPITER_KM3_DAY2,
  Saturn:  GM_SATURN_KM3_DAY2,
  Uranus:  GM_URANUS_KM3_DAY2,
  Neptune: GM_NEPTUNE_KM3_DAY2,
  NewPlanet: GM_NEWPLANET_KM3_DAY2,  // ← add here
};
```

For combined primary+satellite GM (only needed when mass ratio > 0.1% — see §2.3):
```js
// Example: Charon/Pluto would need this
const GM_PLUTO_CHARON_KM3_DAY2 = (GM_PLUTO_KM3_S2 + GM_CHARON_KM3_S2) * SEC_PER_DAY * SEC_PER_DAY;
```

**GM reference values (km³/s²) for likely future additions:**

| Body | GM (km³/s²) | Source |
|---|---|---|
| Jupiter | 1.26686534 × 10⁸ | NASA GM₀ |
| Io | 5959.916 | NASA fact sheet |
| Europa | 3202.739 | NASA fact sheet |
| Ganymede | 9887.834 | NASA fact sheet |
| Callisto | 7179.289 | NASA fact sheet |
| Saturn | 3.7931187 × 10⁷ | NASA GM₀ |
| Titan | 8978.137 | NASA fact sheet |
| Enceladus | 7.211 | NASA fact sheet |
| Uranus | 5.793951 × 10⁶ | NASA GM₀ |
| Neptune | 6.836529 × 10⁶ | NASA GM₀ |
| Triton | 1427.598 | NASA fact sheet |

---

## 7. Reference Orbital Elements — Implemented and Likely Future Additions

Sources: NASA Solar System Exploration, JPL Horizons (J2000 epoch), and
Seidelmann et al. (2007) IAU Working Group report on cartographic standards.

All inclinations are to the **ecliptic** unless noted. Verify before coding.

### Galilean Moons (Jupiter system) — implemented

| Moon | a (km) | e | i_ecliptic (°) | Period (days) | nodalPeriodDays |
|---|---|---|---|---|---|
| Io | 421,800 | 0.0041 | 3.1 | 1.7692 | omitted (Laplace i < 0.05°) |
| Europa | 671,100 | 0.0094 | 3.1 | 3.5512 | omitted (Laplace i < 0.5°) |
| Ganymede | 1,070,400 | 0.0013 | 3.1 | 7.1546 | omitted (defensible) |
| Callisto | 1,882,700 | 0.0074 | 3.1 | 16.6890 | **20,600** (56-year period) |

OmDeg0, wDeg0, M0Deg are approximate (see §3.5). Pull from JPL Horizons before
using for any precision check. Do not use zero placeholders — the approximate values
at least spread the moons around their orbits.

**Galilean Laplace resonance note:** Io:Europa:Ganymede mean motions are in 1:2:4
ratio. The simulator does not enforce this; each moon propagates independently using
mean elements. Slow drift from the real phase relationship will accumulate over years.

### Saturn's Major Moons — implemented

| Moon | a (km) | e | i_ecliptic (°) | Period (days) |
|---|---|---|---|---|
| Enceladus | 238,020 | 0.0047 | 26.7 | 1.3702 |
| Tethys | 294,619 | 0.0001 | 27.1 | 1.8878 |
| Dione | 377,396 | 0.0022 | 26.7 | 2.7369 |
| Rhea | 527,108 | 0.0013 | 26.8 | 4.5175 |
| Titan | 1,221,870 | 0.0288 | 27.1 | 15.9454 |
| Iapetus | 3,560,820 | 0.0286 | 19.0 | 79.3215 |

Saturn's obliquity is 26.73°. Titan: i_equatorial ≈ 0.35°, so i_ecliptic ≈ 27.1°.
Iapetus's Laplace plane is significantly tilted (~8°) relative to Saturn's equator,
giving a lower ecliptic inclination (~19°) than the other inner Saturnian moons.

### Uranian Moons — implemented

All orbit in Uranus's equatorial plane (i_equatorial < 0.5°). Uranus's obliquity is
97.77°, so all have i_ecliptic ≈ 97.8°. They share Om ≈ 167° (Uranus ascending node
on the ecliptic). The extreme tilt means these moons appear to orbit nearly
perpendicular to the ecliptic — visually distinct from all other moon systems.

| Moon | a (km) | e | Period (days) |
|---|---|---|---|
| Miranda | 129,390 | 0.0013 | 1.4135 |
| Ariel | 190,900 | 0.0012 | 2.5204 |
| Umbriel | 266,300 | 0.0039 | 4.1442 |
| Titania | 435,910 | 0.0011 | 8.7059 |
| Oberon | 583,520 | 0.0014 | 13.4632 |

### Neptune's Triton — implemented

| Body | a (km) | e | i_ecliptic (°) | Period (days) |
|---|---|---|---|---|
| Triton | 354,759 | 0.000016 | **130.8** | 5.8769 |

Triton is retrograde. i_ecliptic = 130.8° (not 157° equatorial — see §2.1).
The inclination > 90° in the Keplerian propagator encodes the retrograde direction;
period is positive. Captured KBO; essentially circular orbit.

---

## 8. Code Pattern — Adding a Moon to OUTER_MOONS

To add a new moon to an already-supported planet (Jupiter, Saturn, Uranus, Neptune):

```js
// In the OUTER_MOONS constant, add an entry to the appropriate planet array:
const OUTER_MOONS = {
  Jupiter: [
    // ... existing entries ...
    {
      name: 'NewMoon',
      elements: {
        aKm: 000000,
        e: 0.000,
        iDeg: 3.1,               // ecliptic-frame — see §2.1
        OmDeg0: 100.5,           // from JPL Horizons at J2000
        wDeg0: 000.0,            // from JPL Horizons at J2000
        M0Deg: 000,              // from JPL Horizons at J2000
        periodSiderealDays: 0.0,
        // nodalPeriodDays: 00000,  // add if nodal period > 5 years (§2.2)
      },
      meta: { color: '#rrggbb', radiusKm: 000.0 }
    },
  ],
  // ...
};
```

**That's all.** The generic loops in `frame()` and `buildLegend()` pick it up
automatically. No changes needed to the render loop, legend builder, or any other
function.

To add a moon for a **new planet** not yet in OUTER_PLANET_GM_DAY2:

```js
// 1. Add the km³/day² constant (the km³/s² constant should already exist):
const GM_NEWPLANET_KM3_DAY2 = GM_NEWPLANET_KM3_S2 * SEC_PER_DAY * SEC_PER_DAY;

// 2. Register in the lookup table:
const OUTER_PLANET_GM_DAY2 = {
  Jupiter: ..., Saturn: ..., Uranus: ..., Neptune: ...,
  NewPlanet: GM_NEWPLANET_KM3_DAY2,
};

// 3. Add the planet's moon array to OUTER_MOONS:
const OUTER_MOONS = {
  // ...existing planets...
  NewPlanet: [
    { name: '...', elements: {...}, meta: {...} },
  ],
};
```

**Nothing else needs to change.** `formatLockedPanelContent()` already handles any
`b.primary !== "Sol"` body correctly — it uses `b.primaryGmKm3Day2`, `b.rKmFromPrimary`,
`b.a`, `b.e`, `b.i`, and `b.vel`, all populated by `pushSatelliteBody()`.

**Legacy pattern (Moon, Phobos, Deimos):** These use individually-named constants and
explicit per-body frame() code. Do not extend this pattern to new moons. It exists
because these bodies were added before the OUTER_MOONS generalization.

---

## 9. Zoom Considerations for Small/Distant Moons

The zoom ceiling is currently 20,000 px/AU (raised from 4,000 specifically to make
the Moon's 5.145° inclination visually perceptible). Check whether a new moon system
is visible at this ceiling before shipping.

**Quick check formula:**
```
orbit_radius_on_screen_px = (a_km / AU_KM) * pxPerAU
inclination_wobble_px = orbit_radius_on_screen_px * sin(i_deg * π/180) * sin(camera_pitch)
```

At 20,000 px/AU and default pitch (-0.45 rad = -25.8°):

| Moon | a (km) | Orbit radius at 20k (px) | Notes |
|---|---|---|---|
| Earth's Moon | 384,399 | 51 | ✓ inclination wobble visible |
| Phobos | 9,376 | 1.25 | marginal — very small orbit |
| Deimos | 23,463 | 3.1 | marginal |
| Io | 421,800 | 56 | ✓ |
| Europa | 671,100 | 90 | ✓ |
| Ganymede | 1,070,400 | 143 | ✓ |
| Callisto | 1,882,700 | 251 | ✓ |
| Titan | 1,221,870 | 163 | ✓ large inclination wobble at 27° |
| Miranda | 129,390 | 17 | ✓ visible when Uranus is locked |
| Triton | 354,759 | 47 | ✓ retrograde orbit visually distinct |

Galilean moons and Titan are comfortably visible at 20,000 px/AU. Phobos and Deimos
remain marginal regardless of zoom ceiling because of their very small orbital radii.
Uranian moons require locking Uranus to zoom in; Miranda is the smallest and tightest.

---

## 10. Priority Order for Future Additions

Based on the missions catalog (`interplanetary_missions.json`) and mission targets:

| Priority | Body | Why |
|---|---|---|
| High | Ganymede | JUICE target (2034 orbit insertion) — **already implemented** |
| High | Europa | Europa Clipper target (2030) — **already implemented** |
| High | Callisto | JUICE flyby target — **already implemented** |
| High | Io | JUICE flyby target — **already implemented** |
| Medium | Titan | Dragonfly (2028 launch, 2034 arrival) — **already implemented** |
| Medium | Enceladus | Cassini target; no upcoming dedicated mission — **already implemented** |
| Medium | Triton | New Horizons extended? No confirmed mission — **already implemented** |
| Low | Charon | **already implemented** — Pluto/Charon added as a combined-GM binary system (`GM_PLUTO_CHARON_KM3_S2`, ~`app.js:781`), not the legacy or `OUTER_MOONS` pattern, since Charon is ~12% of Pluto's mass (same "must use combined GM" case as noted in §2.3 below) |
| Low | Phobos (detail) | MMX sample return (2026 launch); already in model at coarse level |

**STATUS (2026-08-01):** All bodies in this table are now implemented — this
was true for most rows even before this pass (see the inline "already
implemented" notes original to this table), and Charon (the one remaining
row) has since been added too. No outstanding moon/satellite additions are
queued as of this writing.
