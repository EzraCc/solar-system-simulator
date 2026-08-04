(function () {
  "use strict";

  // Cache-busting suffix for every data/*.json fetch below -- keep this in
  // sync with the ?v= on this file's own <script> tag in index.html (bump
  // both together on any edit to app.js OR to any data/ JSON file). The
  // script tag's ?v= only forces a fresh fetch of app.js ITSELF; the data
  // files are separate sub-resources fetched at runtime, with no cache
  // headers set by a plain static file server, so a browser can keep
  // serving an old cached copy of e.g. data/flights/escapade.json
  // indefinitely even once app.js itself is confirmed fresh -- exactly the
  // failure mode that made a real, verified-correct code fix look like it
  // wasn't landing (rows/Destinations/Notes rendering correctly off
  // whatever fields an old JSON snapshot happened to have, while newer
  // fields like "significance"/"assets" silently no-op'd as absent).
  const BUILD_VERSION = "25";

  /* =========================================================================
     PHYSICAL / ORBITAL CONSTANTS
     Source: J2000.0 mean orbital elements (a, e, i, Omega, varpi, L), from
     standard planetary ephemeris fits (Standish/JPL DE-derived). Angles in
     degrees in source data, converted to radians below.
     a = semi-major axis (AU)
     e = eccentricity
     i = inclination to ecliptic (deg)
     Om = longitude of ascending node (deg)
     varpi = longitude of perihelion (deg)   [ = Om + argument of perihelion ]
     L = mean longitude at epoch (deg)        [ = varpi + mean anomaly ]
     Also includes per-century rates so the simulator can move the epoch
     elements forward/backward accurately rather than just propagating a
     fixed Keplerian ellipse (mean orbits do precess slowly).
  ========================================================================= */

  const AU_KM = 149597870.7;
  const DAYS_PER_CENTURY = 36525;
  const J2000_JD = 2451545.0; // 2000-01-01 12:00 TT

  // deg -> rad
  const D2R = Math.PI / 180;

  // mu_sun in AU^3 / day^2 (so that periods come out in days directly)
  // GM_sun = 1.32712440018e11 km^3/s^2
  const GM_SUN_KM3_S2 = 1.32712440018e11;
  const SEC_PER_DAY = 86400;
  const GM_SUN_AU3_DAY2 = GM_SUN_KM3_S2 * (SEC_PER_DAY * SEC_PER_DAY) / (AU_KM * AU_KM * AU_KM);

  // Planet GM constants (km³/s²), consolidated here so SOI/Hill computations
  // in PLANET_META (below) can reference them at declaration time.
  // Earth and Mars GMs were previously declared in their satellite-mechanics
  // sections; those duplicate declarations have been removed and the derived
  // constants (GM_EARTH_MOON_KM3_DAY2, GM_MARS_KM3_DAY2) still work because
  // these consts are now in scope before those derived values are computed.
  const GM_MERCURY_KM3_S2 = 2.2032e4;
  const GM_VENUS_KM3_S2   = 3.24859e5;
  const GM_EARTH_KM3_S2   = 3.986004418e5;
  const GM_MARS_KM3_S2    = 4.282837e4;
  const GM_JUPITER_KM3_S2 = 1.26686534e8;
  const GM_SATURN_KM3_S2  = 3.7931187e7;
  const GM_URANUS_KM3_S2  = 5.793951e6;
  const GM_NEPTUNE_KM3_S2 = 6.836529e6;

  // SOI (Sphere of Influence) and Hill sphere radii in AU.
  // SOI:  r = a × (GM_planet / GM_sun)^(2/5)   — patched-conic domain boundary
  // Hill: r = a × (GM_planet / (3 × GM_sun))^(1/3) — L1/L2 offset from planet
  // Both use GM ratio as the mass ratio proxy (mass ∝ GM in Newtonian mechanics).
  function computeSOIAU(a_AU, GM_planet) {
    return a_AU * Math.pow(GM_planet / GM_SUN_KM3_S2, 2 / 5);
  }
  function computeHillAU(a_AU, GM_planet) {
    return a_AU * Math.pow(GM_planet / (3 * GM_SUN_KM3_S2), 1 / 3);
  }

  // Mean orbital elements at J2000 epoch, plus centennial rates.
  // a(AU), aDot(AU/Cy), e, eDot(/Cy), i(deg), iDot("/Cy),
  // Om(deg), OmDot("/Cy), varpi(deg), varpiDot("/Cy), L(deg), LDot("/Cy)
  const PLANET_ELEMENTS = {
    Mercury: { a: 0.38709893, aDot: 0.00000066, e: 0.20563069, eDot: 0.00002527,
               i: 7.00487, iDot: -23.51, Om: 48.33167, OmDot: -446.30, varpi: 77.45645, varpiDot: 573.57,
               L: 252.25084, LDot: 538101628.29 },
    Venus:   { a: 0.72333199, aDot: 0.00000092, e: 0.00677323, eDot: -0.00004938,
               i: 3.39471, iDot: -2.86, Om: 76.68069, OmDot: -996.89, varpi: 131.53298, varpiDot: -108.80,
               L: 181.97973, LDot: 210664136.06 },
    Earth:   { a: 1.00000011, aDot: -0.00000005, e: 0.01671022, eDot: -0.00003804,
               i: 0.00005, iDot: -46.94, Om: -11.26064, OmDot: -18228.25, varpi: 102.94719, varpiDot: 1198.28,
               L: 100.46435, LDot: 129597740.63 },
    Mars:    { a: 1.52366231, aDot: -0.00007221, e: 0.09341233, eDot: 0.00011902,
               i: 1.85061, iDot: -25.47, Om: 49.57854, OmDot: -1020.19, varpi: 336.04084, varpiDot: 1560.78,
               L: 355.45332, LDot: 68905103.78 },
    Jupiter: { a: 5.20336301, aDot: 0.00060737, e: 0.04839266, eDot: -0.00012880,
               i: 1.30530, iDot: -4.15, Om: 100.55615, OmDot: 1217.17, varpi: 14.75385, varpiDot: 839.93,
               L: 34.40438, LDot: 10925078.35 },
    Saturn:  { a: 9.53707032, aDot: -0.00301530, e: 0.05415060, eDot: -0.00036762,
               i: 2.48446, iDot: 6.11, Om: 113.71504, OmDot: -1591.05, varpi: 92.43194, varpiDot: -1948.89,
               L: 49.94432, LDot: 4401052.95 },
    Uranus:  { a: 19.19126393, aDot: 0.00152025, e: 0.04716771, eDot: -0.00019150,
               i: 0.76986, iDot: -2.09, Om: 74.22988, OmDot: -1681.40, varpi: 170.96424, varpiDot: 1312.56,
               L: 313.23218, LDot: 1542547.79 },
    Neptune: { a: 30.06896348, aDot: -0.00125196, e: 0.00858587, eDot: 0.00002510,
               i: 1.76917, iDot: -3.64, Om: 131.72169, OmDot: -151.25, varpi: 44.97135, varpiDot: -844.43,
               L: 304.88003, LDot: 786449.21 }
  };

  // Visual / identity data, plus gravitational physics fields.
  // soiRadiusAU:  Sphere of Influence radius — patched-conic domain boundary.
  // hillRadiusAU: Hill sphere radius — also the L1/L2 offset from the planet.
  // gmKm3S2:      Planet GM in km³/s², needed by the hyperbolic flyby solver.
  // Semi-major axes used here are the J2000 epoch values from PLANET_ELEMENTS.
  const PLANET_META = {
    Mercury: { color: "#b3a39a", radiusKm:  2439.7, gmKm3S2: GM_MERCURY_KM3_S2, soiRadiusAU: computeSOIAU( 0.38709893, GM_MERCURY_KM3_S2), hillRadiusAU: computeHillAU( 0.38709893, GM_MERCURY_KM3_S2) },
    Venus:   { color: "#e8cfa0", radiusKm:  6051.8, gmKm3S2: GM_VENUS_KM3_S2,   soiRadiusAU: computeSOIAU( 0.72333199, GM_VENUS_KM3_S2),   hillRadiusAU: computeHillAU( 0.72333199, GM_VENUS_KM3_S2)   },
    Earth:   { color: "#5ab0ff", radiusKm:  6371.0, gmKm3S2: GM_EARTH_KM3_S2,   soiRadiusAU: computeSOIAU( 1.00000011, GM_EARTH_KM3_S2),   hillRadiusAU: computeHillAU( 1.00000011, GM_EARTH_KM3_S2)   },
    Mars:    { color: "#d9694f", radiusKm:  3389.5, gmKm3S2: GM_MARS_KM3_S2,    soiRadiusAU: computeSOIAU( 1.52366231, GM_MARS_KM3_S2),    hillRadiusAU: computeHillAU( 1.52366231, GM_MARS_KM3_S2)    },
    Jupiter: { color: "#d9b38c", radiusKm: 69911,   gmKm3S2: GM_JUPITER_KM3_S2, soiRadiusAU: computeSOIAU( 5.20336301, GM_JUPITER_KM3_S2), hillRadiusAU: computeHillAU( 5.20336301, GM_JUPITER_KM3_S2) },
    Saturn:  { color: "#e8d6a3", radiusKm: 58232,   gmKm3S2: GM_SATURN_KM3_S2,  soiRadiusAU: computeSOIAU( 9.53707032, GM_SATURN_KM3_S2),  hillRadiusAU: computeHillAU( 9.53707032, GM_SATURN_KM3_S2)  },
    Uranus:  { color: "#9fd6e0", radiusKm: 25362,   gmKm3S2: GM_URANUS_KM3_S2,  soiRadiusAU: computeSOIAU(19.19126393, GM_URANUS_KM3_S2),  hillRadiusAU: computeHillAU(19.19126393, GM_URANUS_KM3_S2)  },
    Neptune: { color: "#5d7fde", radiusKm: 24622,   gmKm3S2: GM_NEPTUNE_KM3_S2, soiRadiusAU: computeSOIAU(30.06896348, GM_NEPTUNE_KM3_S2), hillRadiusAU: computeHillAU(30.06896348, GM_NEPTUNE_KM3_S2) }
  };
  const SUN_RADIUS_KM = 695700;
  const SUN_COLOR = "#ffd27a";

  // Unit vector, in this app's own heliocentric ecliptic J2000 frame, for
  // the real direction the solar system orbits the Milky Way's center at
  // (~220 km/s) -- shown as a static reference arrow from Sol, see
  // drawSolOverlay. This is NOT derived from the simulator's own physics:
  // Sol sits fixed at the origin with zero velocity here (a heliocentric
  // model has nothing else to define "the Sun's motion" against), so this
  // is external astronomical data, not a computed quantity.
  //
  // Derivation: the direction of the Sun's galactic orbital motion is, by
  // the definition of the IAU 1958 galactic coordinate system, galactic
  // longitude l=90 deg, latitude b=0 deg (perpendicular to the direction
  // of the galactic center at l=0, in the galactic plane, in the sense of
  // rotation). Converted galactic -> equatorial J2000 using the standard
  // IAU reference constants (north galactic pole RA 192.85948 deg / Dec
  // 27.12825 deg, galactic longitude of the north celestial pole
  // 122.93192 deg), giving RA ~21h12m, Dec ~+48.3 deg -- near the star
  // Deneb in Cygnus, matching the commonly-cited description of this
  // direction. Then rotated equatorial -> ecliptic J2000 by the mean
  // obliquity (23.4392911 deg). Ecliptic latitude comes out to ~+59.6
  // deg -- a useful sanity check on its own, since it confirms the well
  // known fact that the galactic plane is inclined roughly 60 deg to the
  // ecliptic (a direction lying IN the galactic plane should sit at high
  // ecliptic latitude, and does).
  const GALACTIC_MOTION_DIR_ECLIPTIC = [0.4941094278755832, -0.11099073358466072, 0.8622858750685893];

  const PLANET_ORDER = ["Mercury", "Venus", "Earth", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune"];

  /* =========================================================================
     FLIGHTS: real Earth-to-Mars missions, modeled as Lambert-solved
     heliocentric transfer trajectories. Scope is deliberately limited to
     launch -> Mars arrival (the heliocentric cruise segment); the landing
     sequence (entry, descent, landing) is a separate hyperbolic/atmospheric
     phase this simulator does not model, per explicit scope.

     "arrival" is always the single INTENDED arrival date -- the date the
     trajectory was flying toward -- and is what the Lambert solver uses
     as its end point, regardless of whether the mission actually
     succeeded. For both Curiosity and Perseverance, checked directly
     against primary sources: there was no published delta between
     planned and actual arrival (NASA's own pre-launch press kit for
     Perseverance stated the landing date "remains the same regardless of
     the launch date," and both missions landed on exactly the date
     announced before launch) -- so a single field is accurate here, not
     a simplification.

     "status" and "statusNote" carry the human-readable outcome
     separately, since outcome (success / loss of signal / CATO / etc.)
     is a different axis from "when was it scheduled to arrive" and
     conflating them into parallel planned/actual date fields breaks down
     for missions that never reached "actual" at all -- a future failed
     mission (e.g. one lost during cruise or at Mars orbit insertion)
     still has a single well-defined intended arrival date for trajectory
     purposes, but no actual arrival to report; statusNote covers that
     case with free text rather than forcing a fake second date.

     This same schema now lives in flights/<key>.json, one file per
     flight, rather than as one inline object -- listed by key in
     flights/manifest.json. Adding a flight means adding one JSON file
     and one manifest entry; no JS changes needed. FLIGHTS_RAW is
     populated asynchronously by loadFlightsRaw() below, called from the
     bootstrap at the bottom of this file before the rest of init runs.
  ========================================================================= */
  const FLIGHTS_RAW = {};
  let FLIGHTS_ORDER = [];

  // Reference info (image + "why it matters" significance) for planets,
  // Sol, and small bodies -- keyed by each body's DISPLAY name (b.name in
  // formatLockedPanelContent: "Mercury", "Sol", "101955 Bennu", "Pluto and
  // Charon", etc.), not any internal dict key, since that's the only
  // identifier the locked-panel code already has in hand for every kind of
  // body it renders. One combined file rather than the flights' per-file
  // manifest pattern -- this set is small (~30 bodies) and fixed, not
  // meant to scale the way flights do.
  const BODY_INFO = {};

  async function loadBodyInfo() {
    const res = await fetch(`data/bodies/info.json?v=${BUILD_VERSION}`);
    if (!res.ok) throw new Error("Failed to load data/bodies/info.json: " + res.status);
    Object.assign(BODY_INFO, await res.json());
  }

  async function loadFlightsRaw() {
    const manifestRes = await fetch(`data/flights/manifest.json?v=${BUILD_VERSION}`);
    if (!manifestRes.ok) throw new Error("Failed to load data/flights/manifest.json: " + manifestRes.status);
    const manifest = await manifestRes.json();
    FLIGHTS_ORDER = manifest.order;

    // Fetch every flight file in parallel rather than sequentially -- at
    // thousands of flights, awaiting one fetch at a time before starting
    // the next would make load time scale linearly with flight count for
    // no reason, since these are independent requests.
    const entries = await Promise.all(
      FLIGHTS_ORDER.map(async (key) => {
        const res = await fetch(`data/flights/${key}.json?v=${BUILD_VERSION}`);
        if (!res.ok) throw new Error(`Failed to load data/flights/${key}.json: ${res.status}`);
        const raw = await res.json();
        return [key, raw];
      })
    );
    entries.forEach(([key, raw]) => { FLIGHTS_RAW[key] = raw; });
  }

  /* =========================================================================
     EARTH'S MOON
     Unlike the planets, the Moon orbits Earth, not Sol — so it needs its
     own primary (Earth's GM, not the Sun's) and its own propagation
     function. Its position in the scene is EarthPosition + thisOffset,
     not a standalone heliocentric position.
     A second, important difference from the planets: the Moon's orbital
     plane precesses fast enough to matter on human timescales (the
     planets' precession is a slow centennial-rate correction; the Moon's
     ascending node completes a full backward revolution every 18.61
     years, and its argument of perigee a full forward revolution every
     8.85 years — both driven mainly by the Sun's perturbation). These are
     modeled directly as linear-in-time terms rather than ignored, since
     over the simulator's typical explored timescale (years to decades)
     this precession is visually significant, unlike the planets' case.
     Geocentric, ecliptic-of-J2000 elements (low-precision lunar theory,
     Meeus-derived reference values at the J2000 epoch).
  ========================================================================= */

  // GM_EARTH_KM3_S2 declared above (consolidated planet GM block).
  const GM_MOON_KM3_S2 = 4902.800118; // Moon's own GM -- non-negligible relative to Earth's (~1.2% of Earth's mass), so Kepler's third law for the Earth-Moon pair uses their combined GM, not Earth's alone
  const GM_EARTH_MOON_KM3_DAY2 = (GM_EARTH_KM3_S2 + GM_MOON_KM3_S2) * SEC_PER_DAY * SEC_PER_DAY; // used for the orbital-period readout in the locked panel (Kepler's third law)
  // Note: the Moon's own position propagation below uses its empirically
  // known sidereal period directly (periodSiderealDays) rather than
  // deriving mean motion from GM -- that known period is more accurate
  // than a two-body GM-derived figure, since real lunar motion is heavily
  // perturbed by the Sun in ways a clean two-body GM value can't capture.

  const MOON_ELEMENTS = {
    aKm: 384399,
    e: 0.0549,
    iDeg: 5.145,                          // inclination to the ecliptic (not Earth's equator)
    periodSiderealDays: 27.321661,
    nodalPeriodDays: 18.61 * 365.25,      // ascending node regresses (moves backward) over this period
    apsidalPeriodDays: 8.85 * 365.25,     // argument of perigee progresses (moves forward) over this period
    OmDeg0: 125.1228,                      // longitude of ascending node at J2000
    wDeg0: 318.0634,                       // argument of perigee at J2000
    M0Deg: 115.3654                        // mean anomaly at J2000
  };
  const MOON_META = { color: "#c9c9c9", radiusKm: 1737.4, gmKm3S2: GM_MOON_KM3_S2 };

  // Standalone (not frame-loop-scoped) Moon state, for use anywhere a leg
  // needs the Moon's position/velocity at an arbitrary date -- Lambert-leg
  // endpoints and gravity-assist flybys, the same way computeStateVector
  // serves the Sun-orbiting planets. Mirrors the frame loop's own
  // buildSatelliteAbs(MOON_ELEMENTS, earthState, ...) composition (Earth's
  // heliocentric state + the Moon's Earth-relative offset) but callable at
  // any t, not just "now". computeSatelliteOffset and computeStateVector
  // are both plain functions of (elements, t) with no closure state, so
  // this is safe to call from getBodyPositionAtDays/getGAChain even though
  // it's declared far above them in the file (function declarations hoist).
  function computeMoonStateAtDays(t) {
    const earthState = computeStateVector(PLANET_ELEMENTS.Earth, t);
    const sat = computeSatelliteOffset(MOON_ELEMENTS, t);
    return {
      pos: [earthState.pos[0] + sat.posAU[0], earthState.pos[1] + sat.posAU[1], earthState.pos[2] + sat.posAU[2]],
      vel: [earthState.vel[0] + sat.velAU[0], earthState.vel[1] + sat.velAU[1], earthState.vel[2] + sat.velAU[2]],
    };
  }

  // Resolve a gravity-assist leg's flyby body to { pos, vel } / { radiusKm,
  // gmKm3S2 } -- almost always a Sun-orbiting planet (PLANET_ELEMENTS/
  // PLANET_META), but the Moon is a real, physically legitimate flyby body
  // too (Nozomi's actual 1998 departure used two lunar swingbys before its
  // Earth departure burn) even though it orbits Earth, not the Sun, so it
  // needs its own state/meta path rather than PLANET_ELEMENTS/PLANET_META
  // lookups that would silently return undefined for it.
  function getGAFlybyState(bodyKey, t) {
    if (bodyKey === 'Moon') return computeMoonStateAtDays(t);
    return computeStateVector(PLANET_ELEMENTS[bodyKey], t);
  }
  function getGAFlybyMeta(bodyKey) {
    if (bodyKey === 'Moon') return { radiusKm: MOON_META.radiusKm, gmKm3S2: MOON_META.gmKm3S2 };
    return PLANET_META[bodyKey];
  }

  /* =========================================================================
     MARS'S MOONS: PHOBOS AND DEIMOS
     Mercury and Venus have no natural satellites (confirmed: MESSENGER's
     dedicated search around Mercury found none; Venus has only a
     quasi-satellite, which orbits the Sun on a resonant path rather than
     actually orbiting Venus, so it isn't a moon and isn't modeled here).
     Both Martian moons orbit almost exactly in Mars's equatorial plane
     (inclination to that plane is ~1 degree or less for each), not the
     ecliptic -- unlike the Moon, whose orbit happens to sit close to the
     ecliptic already. The ecliptic-frame inclinations used below (26.04
     and 27.58 degrees) are taken directly from published reference values
     rather than derived from Mars's pole orientation, since the residual
     wobble from Mars's true (slowly precessing) pole vs. its mean ~25
     degree obliquity is far smaller than these moons' rendered pixel size
     at any zoom level this simulator's canvas supports -- a deliberate,
     named simplification, not an oversight. Likewise, their ascending
     nodes are held fixed rather than precessed: the real precession period
     is months for Phobos, but it precesses around the LOCAL LAPLACE PLANE,
     to which Phobos's inclination is under 0.05 degrees -- so the actual
     visual wobble this precession would add is negligible at this scale.
     Both moons have negligible mass relative to Mars, so (unlike the
     Earth-Moon pair) no combined-GM correction is needed for their period.
  ========================================================================= */

  // GM_MARS_KM3_S2 declared above (consolidated planet GM block).
  const GM_MARS_KM3_DAY2 = GM_MARS_KM3_S2 * SEC_PER_DAY * SEC_PER_DAY;

  const PHOBOS_ELEMENTS = {
    aKm: 9376,
    e: 0.0151,
    iDeg: 26.04,                  // inclination to the ecliptic (see note above)
    periodSiderealDays: 0.31891023,
    OmDeg0: 0,                     // ascending node held fixed (see note above)
    wDeg0: 0,
    M0Deg: 0
  };
  const PHOBOS_META = { color: "#9c8b7a", radiusKm: 11.08 };

  const DEIMOS_ELEMENTS = {
    aKm: 23463.2,
    e: 0.00033,
    iDeg: 27.58,                  // inclination to the ecliptic (see note above)
    periodSiderealDays: 1.263,
    OmDeg0: 90,                    // offset from Phobos's so the two don't render coincident at epoch; arbitrary given the fixed-node simplification
    wDeg0: 0,
    M0Deg: 0
  };
  const DEIMOS_META = { color: "#8a7d70", radiusKm: 6.27 };
  // GM constants for outer planets in km³/day² — needed for the orbital-period
  // readout in the locked panel (Kepler's third law, same role as GM_MARS_KM3_DAY2).
  const GM_JUPITER_KM3_DAY2 = GM_JUPITER_KM3_S2 * SEC_PER_DAY * SEC_PER_DAY;
  const GM_SATURN_KM3_DAY2  = GM_SATURN_KM3_S2  * SEC_PER_DAY * SEC_PER_DAY;
  const GM_URANUS_KM3_DAY2  = GM_URANUS_KM3_S2  * SEC_PER_DAY * SEC_PER_DAY;
  const GM_NEPTUNE_KM3_DAY2 = GM_NEPTUNE_KM3_S2 * SEC_PER_DAY * SEC_PER_DAY;
  const OUTER_PLANET_GM_DAY2 = {
    Jupiter: GM_JUPITER_KM3_DAY2,
    Saturn:  GM_SATURN_KM3_DAY2,
    Uranus:  GM_URANUS_KM3_DAY2,
    Neptune: GM_NEPTUNE_KM3_DAY2,
  };

  // Outer moons with diameter >= 450 km.  Orbital elements in ecliptic J2000
  // frame.  For moons orbiting close to their planet's equatorial plane, the
  // ecliptic inclination is approximately the planet's axial tilt:
  //   Jupiter  3.1°,  Saturn 26.7°,  Uranus 97.8°,  Neptune 28.3°.
  // Triton: i=130.8° in ecliptic frame (not 157° equatorial -- spec §7).
  // KNOWN LIMITATION: OmDeg0, wDeg0, M0Deg are approximate, not from JPL Horizons.
  // Galilean moon phase angles at J2000 will drift from reality (spec §2.4).
  // Uranian moons share Om ≈ 167° (Uranus ascending node on the ecliptic).
  const OUTER_MOONS = {
    Jupiter: [
      { name: 'Io',       elements: { aKm: 421800,   e: 0.0041,   iDeg: 3.1,  OmDeg0: 100.5, wDeg0:  84.1, M0Deg: 342, periodSiderealDays:  1.7692  }, meta: { color: '#d4a84b', radiusKm: 1821.6 } },
      { name: 'Europa',   elements: { aKm: 671100,   e: 0.0094,   iDeg: 3.1,  OmDeg0: 100.5, wDeg0: 188.2, M0Deg: 171, periodSiderealDays:  3.5512  }, meta: { color: '#c8b89a', radiusKm: 1560.8 } },
      { name: 'Ganymede', elements: { aKm: 1070400,  e: 0.0011,   iDeg: 3.1,  OmDeg0: 100.5, wDeg0: 192.4, M0Deg: 340, periodSiderealDays:  7.1546  }, meta: { color: '#9b8e7e', radiusKm: 2634.1 } },
      { name: 'Callisto', elements: { aKm: 1882700,  e: 0.0074,   iDeg: 3.1,  OmDeg0: 100.5, wDeg0:  52.6, M0Deg: 190, periodSiderealDays: 16.6890  }, meta: { color: '#6b5f52', radiusKm: 2410.3 } },
    ],
    Saturn: [
      { name: 'Enceladus', elements: { aKm: 238020,  e: 0.0047, iDeg: 26.7, OmDeg0: 113.7, wDeg0:  92.3, M0Deg: 197, periodSiderealDays:  1.3702  }, meta: { color: '#eaeaea', radiusKm:  252.1 } },
      { name: 'Tethys',    elements: { aKm: 294619,  e: 0.0001, iDeg: 27.1, OmDeg0: 113.7, wDeg0:  45.0, M0Deg:  10, periodSiderealDays:  1.8878  }, meta: { color: '#d4d0c8', radiusKm:  536.3 } },
      { name: 'Dione',     elements: { aKm: 377396,  e: 0.0022, iDeg: 26.7, OmDeg0: 113.7, wDeg0: 284.3, M0Deg: 357, periodSiderealDays:  2.7369  }, meta: { color: '#c8c4b8', radiusKm:  561.7 } },
      { name: 'Rhea',      elements: { aKm: 527108,  e: 0.0013, iDeg: 26.8, OmDeg0: 113.7, wDeg0: 241.6, M0Deg: 350, periodSiderealDays:  4.5175  }, meta: { color: '#c0bcb0', radiusKm:  764.3 } },
      { name: 'Titan',     elements: { aKm: 1221870, e: 0.0288, iDeg: 27.5, OmDeg0: 113.7, wDeg0: 185.7, M0Deg: 133, periodSiderealDays: 15.9454  }, meta: { color: '#c8a055', radiusKm: 2574.7 } },
      { name: 'Iapetus',   elements: { aKm: 3560820, e: 0.0286, iDeg: 19.0, OmDeg0:  75.8, wDeg0: 275.8, M0Deg: 201, periodSiderealDays: 79.3215  }, meta: { color: '#a09080', radiusKm:  735.6 } },
    ],
    Uranus: [
      { name: 'Miranda', elements: { aKm: 129390, e: 0.0013, iDeg: 97.8, OmDeg0: 167.4, wDeg0:  68.3, M0Deg:  45, periodSiderealDays:  1.4135 }, meta: { color: '#b0a898', radiusKm: 235.8 } },
      { name: 'Ariel',   elements: { aKm: 190900, e: 0.0012, iDeg: 97.8, OmDeg0: 167.4, wDeg0: 115.3, M0Deg: 115, periodSiderealDays:  2.5204 }, meta: { color: '#c0bcb0', radiusKm: 578.9 } },
      { name: 'Umbriel', elements: { aKm: 266300, e: 0.0039, iDeg: 97.8, OmDeg0: 167.4, wDeg0:  84.7, M0Deg:  84, periodSiderealDays:  4.1442 }, meta: { color: '#706860', radiusKm: 584.7 } },
      { name: 'Titania', elements: { aKm: 435910, e: 0.0011, iDeg: 97.8, OmDeg0: 167.4, wDeg0: 284.4, M0Deg: 299, periodSiderealDays:  8.7059 }, meta: { color: '#a89888', radiusKm: 788.9 } },
      { name: 'Oberon',  elements: { aKm: 583520, e: 0.0014, iDeg: 97.8, OmDeg0: 167.4, wDeg0: 104.4, M0Deg: 273, periodSiderealDays: 13.4632 }, meta: { color: '#887870', radiusKm: 761.4 } },
    ],
    Neptune: [
      // Triton: retrograde (i=130.8°), captured KBO. Period is the sidereal period
      // magnitude; the inclination > 90° encodes the retrograde direction.
      // i=130.8° is the ecliptic-frame value; 157° is the equatorial-frame value (wrong frame here).
      { name: 'Triton', elements: { aKm: 354759, e: 0.000016, iDeg: 130.8, OmDeg0: 131.7, wDeg0: 264.8, M0Deg: 352, periodSiderealDays: 5.8769 }, meta: { color: '#b8c8c0', radiusKm: 1353.4 } },
    ],
  };

  /* =========================================================================
     ASTEROIDS & COMETS
     Real heliocentric osculating elements from JPL's Small-Body Database
     (ssd-api.jpl.nasa.gov/sbdb.api), one well-determined epoch per body --
     NOT the planets' centennial-mean-element-plus-rates convention, since
     these don't have (or need) a multi-century secular fit; a single
     recent epoch propagated forward/backward a few years with plain
     two-body Kepler is accurate enough for this simulator's purposes,
     the same reasoning applied to flight-leg elements. Angles in degrees
     here (as JPL publishes them); computeSmallBodyState converts.

     Deliberately small starter set: real, well-known mission targets
     (comet 67P/Rosetta, Bennu/OSIRIS-REx, Ryugu/Hayabusa2, Didymos/
     DART+Hera, Itokawa/Hayabusa, Vesta+Ceres/Dawn, Tempel 1/Deep Impact,
     16 Psyche/Psyche) rather than an arbitrary population, so every entry
     has a real reason to exist. targetOfFlights lists FLIGHTS_RAW keys
     whose real destination is this body -- isSmallBodyVisible() uses it to
     widen a body's visibility window around its mission(s); Lucy's 7
     Trojan/main-belt targets are the obvious next addition but aren't in
     this starter set yet, so it isn't linked to anything here.
  ========================================================================= */
  const SMALL_BODIES = {
    '67P': {
      name: 'Churyumov–Gerasimenko (67P)', types: ['comet'],
      elements: { a: 3.462249489765068, e: 0.6409081306555051, iDeg: 7.040294906760007,
                  OmDeg: 50.13557380441372, wDeg: 12.79824973415729, M0Deg: 8.859927418758764,
                  epochDays: 5760.5 },
      // dimensionsKm: overall nucleus envelope (both lobes together) --
      // matches the figure already cited in this body's own "Why it
      // matters" text (data/bodies/info.json) rather than a different
      // real-but-narrower figure (e.g. just the large lobe's own
      // 4.1x3.3x1.8 km), so the two don't read as contradicting each
      // other within the same panel.
      meta: { color: '#9c8f7a', radiusKm: 1.7, dimensionsKm: [4.3, 4.1, 1.6], shapeNote: 'bilobed "rubber duck" nucleus' },
      targetOfFlights: ['rosetta'],
    },
    bennu: {
      name: 'Bennu (101955)', types: ['asteroid'],
      elements: { a: 1.126391025894812, e: 0.2037450762416414, iDeg: 6.03494377024794,
                  OmDeg: 2.06086619569642, wDeg: 66.22306084084298, M0Deg: 101.703952002457,
                  epochDays: 4017.5 },
      // dimensionsKm: OSIRIS-REx-measured equatorial long/intermediate
      // axes (565/535 m) and polar diameter (508 m) -- Lauretta et al. 2019.
      meta: { color: '#4a4640', radiusKm: 0.24222, dimensionsKm: [0.565, 0.535, 0.508], shapeNote: 'spinning-top shape' },
      targetOfFlights: ['osiris_rex'],
    },
    ryugu: {
      name: 'Ryugu (162173)', types: ['asteroid'],
      elements: { a: 1.190918932477906, e: 0.1910730049967184, iDeg: 5.866442495106322,
                  OmDeg: 251.2897124408818, wDeg: 211.6089939475371, M0Deg: 62.34067433781601,
                  epochDays: 9655.5 },
      // dimensionsKm: Hayabusa2-measured equatorial diameter (1004 m,
      // roughly axisymmetric) and polar diameter (875 m) -- Watanabe et
      // al. 2019. Equatorial listed twice since it's a near-circular
      // cross-section, not a distinct long/intermediate pair like Bennu's.
      meta: { color: '#5c5650', radiusKm: 0.448, dimensionsKm: [1.004, 1.004, 0.875], shapeNote: 'spinning-top shape' },
      targetOfFlights: ['hayabusa2'],
    },
    didymos: {
      name: 'Didymos (65803)', types: ['asteroid'],
      elements: { a: 1.642709608529702, e: 0.3831233242624545, iDeg: 3.413876519313629,
                  OmDeg: 72.9858236207145, wDeg: 319.5807001349104, M0Deg: 260.8612886320632,
                  epochDays: 9655.5 },
      // No dimensionsKm -- Didymos itself (unlike its moonlet Dimorphos,
      // modeled as a real satellite below near CHARON_ELEMENTS) is close
      // enough to round that radiusKm's implied ~780 m diameter already
      // matches the real measured value.
      meta: { color: '#a89a82', radiusKm: 0.39 },
      targetOfFlights: ['dart', 'hera'],
    },
    itokawa: {
      name: 'Itokawa (25143)', types: ['asteroid'],
      elements: { a: 1.324052284342771, e: 0.2801776414987972, iDeg: 1.620940810523569,
                  OmDeg: 69.07449749929083, wDeg: 162.8409022415483, M0Deg: 170.653905937934,
                  epochDays: 9655.5 },
      // dimensionsKm: Hayabusa-measured principal axes -- one of the most
      // dramatically non-spherical bodies in this list ("sea otter"
      // shape), definitely not well described by a single radius.
      meta: { color: '#8c7d68', radiusKm: 0.165, dimensionsKm: [0.535, 0.294, 0.209], shapeNote: 'elongated, irregular shape' },
      targetOfFlights: ['hayabusa'],
    },
    vesta: {
      name: 'Vesta (4)', types: ['asteroid'],
      elements: { a: 2.361365965127599, e: 0.09020374382834395, iDeg: 7.143925545058711,
                  OmDeg: 103.701293265032, wDeg: 151.4686478221564, M0Deg: 81.19015607686903,
                  epochDays: 9655.5 },
      meta: { color: '#b0a898', radiusKm: 261.4 },
      targetOfFlights: ['dawn'],
    },
    ceres: {
      // IAU-recognized dwarf planet since 2006, in addition to being the
      // largest main-belt asteroid -- both classifications are real, hence
      // two tags rather than picking one (see SMALL_BODY_TYPE_BADGES).
      name: 'Ceres (1)', types: ['asteroid', 'dwarf_planet'],
      elements: { a: 2.765552595034094, e: 0.07969229514816586, iDeg: 10.58802780183462,
                  OmDeg: 80.24862682043221, wDeg: 73.29421453021587, M0Deg: 274.4193463761342,
                  epochDays: 9655.5 },
      meta: { color: '#8a8580', radiusKm: 469.7 },
      targetOfFlights: ['dawn'],
    },
    tempel1: {
      name: 'Tempel 1 (9P)', types: ['comet'],
      elements: { a: 3.146133758958915, e: 0.5097028326964878, iDeg: 10.4734281543904,
                  OmDeg: 68.75357468050096, wDeg: 179.1972753698572, M0Deg: 336.5854438553629,
                  epochDays: 5925.5 },
      // dimensionsKm: Deep Impact-era estimate of the elongated nucleus
      // (length x width) -- comet nuclei are routinely this irregular;
      // Tempel 1 has no well-published 3rd (short) axis, hence only 2
      // values here (formatBodySize handles either 2 or 3 entries).
      meta: { color: '#a8a098', radiusKm: 3.0, dimensionsKm: [7.6, 4.9], shapeNote: 'elongated nucleus' },
      targetOfFlights: ['deep_impact'],
    },
    psyche: {
      name: 'Psyche (16)', types: ['asteroid'],
      elements: { a: 2.925720466462538, e: 0.1349324738201893, iDeg: 3.098749116151128,
                  OmDeg: 149.9753859305033, wDeg: 230.0326782748359, M0Deg: 79.76939505329617,
                  epochDays: 9655.5 },
      // dimensionsKm: telescopic/occultation-derived triaxial shape model
      // (Shepard et al. 2021) -- large enough to be interesting as a
      // target for its own Psyche mission (2029 arrival), but still
      // distinctly potato-shaped, not spherical.
      meta: { color: '#8f8f92', radiusKm: 111, dimensionsKm: [278, 238, 171], shapeNote: 'irregular, potato-shaped' },
      targetOfFlights: ['psyche'],
    },
    pluto: {
      name: 'Pluto and Charon', types: ['dwarf_planet'],
      elements: { a: 39.58862938517124, e: 0.2518378778576892, iDeg: 17.14771140999114,
                  OmDeg: 110.2923840543057, wDeg: 113.7090015158565, M0Deg: 38.68366347318184,
                  epochDays: 6043.5 },
      meta: { color: '#c8b8a0', radiusKm: 1188.3 },
      targetOfFlights: ['new_horizons'],
    },
    toutatis: {
      name: 'Toutatis (4179)', types: ['asteroid'],
      elements: { a: 2.543047155641573, e: 0.6246302247178447, iDeg: 0.4480836624628189,
                  OmDeg: 125.3654799655549, wDeg: 277.8615384113277, M0Deg: 125.5161576467994,
                  epochDays: 9655.5 },
      // dimensionsKm: Chang'e 2 flyby-confirmed contact-binary shape
      // (two fused lobes, max length x width) -- one of the most
      // dramatically elongated bodies in this list.
      meta: { color: '#8f7f6a', radiusKm: 2.7, dimensionsKm: [4.75, 2.4, 1.95], shapeNote: 'elongated contact binary' },
      targetOfFlights: ['chunge2_toutatis'],
    },
    kamooalewa: {
      name: 'Kamoʻoalewa (469219)', types: ['asteroid'],
      elements: { a: 1.000810460069075, e: 0.1022387734111659, iDeg: 7.802609738007058,
                  OmDeg: 65.59324444474426, wDeg: 304.3632084517341, M0Deg: 243.3871507436424,
                  epochDays: 9655.5 },
      meta: { color: '#9a8f80', radiusKm: 0.0286 },
      targetOfFlights: ['tianwen2'],
    },
    dinkinesh: {
      name: 'Dinkinesh (152830)', types: ['asteroid'],
      elements: { a: 2.191768748791583, e: 0.1126817135846694, iDeg: 2.093117265661373,
                  OmDeg: 21.35270512523402, wDeg: 66.91637126596935, M0Deg: 29.60751779009531,
                  epochDays: 9655.5 },
      meta: { color: '#9a8f80', radiusKm: 0.36 },
      targetOfFlights: ['lucy'],
    },
    donaldjohanson: {
      name: 'Donaldjohanson (52246)', types: ['asteroid'],
      elements: { a: 2.383835831129859, e: 0.1868593763038477, iDeg: 4.425205239728406,
                  OmDeg: 262.7765342454273, wDeg: 212.8821499078564, M0Deg: 147.8525890028124,
                  epochDays: 9655.5 },
      // dimensionsKm: Lucy flyby (2025-04-20) shape model -- two heavily
      // cratered lobes joined by a narrower neck, described by the
      // mission team as a "bowling pin" shape.
      meta: { color: '#8f8478', radiusKm: 1.95, dimensionsKm: [8.8, 4.4, 3.1], shapeNote: 'elongated contact binary' },
      targetOfFlights: ['lucy'],
    },
    eurybates: {
      name: 'Eurybates (3548)', types: ['asteroid'],
      elements: { a: 5.217371617810976, e: 0.09059867172297777, iDeg: 8.05147293527498,
                  OmDeg: 43.5587275998936, wDeg: 28.69968222483612, M0Deg: 125.7480299363769,
                  epochDays: 9655.5 },
      meta: { color: '#7a6152', radiusKm: 31.94 },
      targetOfFlights: ['lucy'],
    },
    polymele: {
      name: 'Polymele (15094)', types: ['asteroid'],
      elements: { a: 5.191514133435046, e: 0.09592245810512318, iDeg: 12.97735158439746,
                  OmDeg: 50.33105662992578, wDeg: 5.86529887136951, M0Deg: 143.4220008064438,
                  epochDays: 9655.5 },
      meta: { color: '#7d6455', radiusKm: 10.54 },
      targetOfFlights: ['lucy'],
    },
    leucus: {
      name: 'Leucus (11351)', types: ['asteroid'],
      elements: { a: 5.312382832170665, e: 0.06495789797701287, iDeg: 11.54341670108032,
                  OmDeg: 251.0799335752079, wDeg: 162.4048390063255, M0Deg: 139.1721755085774,
                  epochDays: 9655.5 },
      meta: { color: '#6f5847', radiusKm: 17.08 },
      targetOfFlights: ['lucy'],
    },
    orus: {
      name: 'Orus (21900)', types: ['asteroid'],
      elements: { a: 5.123374239403683, e: 0.03672540559818106, iDeg: 8.468580378470353,
                  OmDeg: 258.5504431073313, wDeg: 182.7884930129634, M0Deg: 96.92267457127365,
                  epochDays: 9655.5 },
      meta: { color: '#75604f', radiusKm: 25.40 },
      targetOfFlights: ['lucy'],
    },
    patroclus: {
      name: 'Patroclus (617)', types: ['asteroid'],
      elements: { a: 5.205975165165407, e: 0.1391467941344403, iDeg: 22.06359067056119,
                  OmDeg: 44.34968895523391, wDeg: 308.8377264097742, M0Deg: 58.67543319923984,
                  epochDays: 9655.5 },
      meta: { color: '#6a5646', radiusKm: 70.18 },
      targetOfFlights: ['lucy'],
    },
    annefrank: {
      name: 'Annefrank (5535)', types: ['asteroid'],
      elements: { a: 2.212362295338773, e: 0.06320477836052894, iDeg: 4.247441129204184,
                  OmDeg: 120.5509750356931, wDeg: 9.553711836846162, M0Deg: 260.8814202465155,
                  epochDays: 9655.5 },
      // dimensionsKm: Stardust flyby (2002-11-02) tri-axial best-fit
      // (Duxbury et al. 2003) -- imaged as a "triangular prism" possibly
      // a contact binary.
      meta: { color: '#8c7d68', radiusKm: 2.4, dimensionsKm: [6.6, 5.0, 3.4], shapeNote: 'triangular-prism shape, possible contact binary' },
      targetOfFlights: ['stardust'],
    },
    wild2: {
      name: 'Wild 2 (81P)', types: ['comet'],
      elements: { a: 3.449745576963111, e: 0.5373989073846863, iDeg: 3.237004173608168,
                  OmDeg: 136.1102208500619, wDeg: 41.72523085114398, M0Deg: 187.5966814232084,
                  epochDays: 7263.5 },
      // dimensionsKm: Stardust flyby-imaged nucleus -- irregular, riddled
      // with flat-bottomed depressions and active jets during the encounter.
      meta: { color: '#a8a098', radiusKm: 2.0, dimensionsKm: [5.5, 4.0, 3.3], shapeNote: 'irregular nucleus with flat-bottomed depressions and active jets' },
      targetOfFlights: ['stardust'],
    },
    braille: {
      name: 'Braille (9969)', types: ['asteroid'],
      // Re-epoched to the 1999-07-29 DS1 flyby date itself (JPL Horizons
      // real position at that exact epoch) rather than a current best-fit
      // epoch ~26 years away -- this simulator's pure two-body Keplerian
      // propagation (no planetary-perturbation model) drifted enough over
      // that gap to put the old epoch's position ~0.4 AU from where the
      // real DS1 spacecraft was during the actual encounter. Only used by
      // deep_space_1's own flyby leg (targetOfFlights below), so accuracy
      // far from 1999 doesn't matter here.
      elements: { a: 2.3417504323926273, e: 0.43354352275681435, iDeg: 28.94884114575071,
                  OmDeg: 242.1583668801643, wDeg: 355.3586939698189, M0Deg: 1.676358559015,
                  epochDays: -156.5 },
      // dimensionsKm: Deep Space 1 flyby / JPL SBDB tri-axial extent.
      meta: { color: '#8f8072', radiusKm: 0.64, dimensionsKm: [2.1, 1.0, 1.0], shapeNote: 'elongated, irregular shape' },
      targetOfFlights: ['deep_space_1'],
    },
    borrelly: {
      name: 'Borrelly (19P)', types: ['comet'],
      // Re-epoched to the 2001-09-22 DS1 flyby date itself (JPL Horizons
      // target 90000304, the 2004-apparition orbital fit, which includes
      // Borrelly's real non-gravitational (outgassing) acceleration model)
      // rather than a current best-fit epoch ~20 years away. This
      // simulator's own propagation is pure two-body Keplerian with no
      // non-gravitational term, so for a comet like this one that error
      // compounds badly the further the epoch is from the date actually
      // needed -- the old epoch (2021) put Borrelly 1.14 AU away from
      // where the real DS1 spacecraft was during the actual encounter.
      // Only used by deep_space_1's own flyby leg (targetOfFlights below),
      // so accuracy far from 2001 doesn't matter here.
      elements: { a: 3.6113328780370355, e: 0.6239037119022925, iDeg: 30.32457234826719,
                  OmDeg: 75.42471180451162, wDeg: 353.37492370239636, M0Deg: 1.0439936661823026,
                  epochDays: 629.5 },
      // dimensionsKm: Deep Space 1 flyby-imaged nucleus -- one of the most
      // dramatically non-spherical cometary nuclei imaged, a "bowling pin"
      // shape.
      meta: { color: '#8f8478', radiusKm: 2.4, dimensionsKm: [8.0, 4.0, 4.0], shapeNote: 'elongated "bowling-pin" nucleus' },
      targetOfFlights: ['deep_space_1'],
    },
    eros: {
      name: 'Eros (433)', types: ['asteroid'],
      elements: { a: 1.458243716760167, e: 0.2228779627700761, iDeg: 10.82854410314273,
                  OmDeg: 304.2679713350896, wDeg: 178.9181319135911, M0Deg: 62.51145501986792,
                  epochDays: 9655.5 },
      // dimensionsKm: NEAR Shoemaker-measured tri-axial extent -- one of the
      // most elongated large near-Earth asteroids, "peanut"-shaped.
      meta: { color: '#9c8f7a', radiusKm: 8.42, dimensionsKm: [34.4, 11.2, 11.2], shapeNote: 'elongated, peanut-shaped' },
      targetOfFlights: ['near_shoemaker'],
    },
    gaspra: {
      name: 'Gaspra (951)', types: ['asteroid'],
      elements: { a: 2.209978353670737, e: 0.1737374595425464, iDeg: 4.10465496946464,
                  OmDeg: 252.9672913251979, wDeg: 130.0037637381037, M0Deg: 112.9508716440696,
                  epochDays: 9655.5 },
      // dimensionsKm: Galileo flyby (1991-10-29) tri-axial best-fit (Thomas
      // et al. 1994) -- the first asteroid ever visited by a spacecraft.
      meta: { color: '#9a8c78', radiusKm: 6.1, dimensionsKm: [18.2, 10.5, 8.9], shapeNote: 'irregular, angular shape' },
      targetOfFlights: ['galileo'],
    },
    ida: {
      name: 'Ida (243)', types: ['asteroid'],
      elements: { a: 2.863348031699649, e: 0.04610962795708528, iDeg: 1.130363094271507,
                  OmDeg: 323.5366609419851, wDeg: 113.2571826848795, M0Deg: 49.64769088009876,
                  epochDays: 9655.5 },
      // dimensionsKm: Galileo flyby (1993-08-28) tri-axial best-fit (Thomas
      // et al. 1996) -- imaged with its small moon Dactyl (not modeled here).
      meta: { color: '#8f8272', radiusKm: 16.0, dimensionsKm: [59.8, 25.4, 18.6], shapeNote: 'elongated, irregular shape' },
      targetOfFlights: ['galileo'],
    },
    // The three comets Ulysses unexpectedly crossed the ion tail of --
    // documented on Ulysses' own Wikipedia page/trajectory GIF, none ever
    // imaged up close (all known only from their tails, not their nuclei),
    // and all genuinely long-period/near-parabolic -- unlike every other
    // comet above (67P, Wild 2, Borrelly, Tempel 1: bound, short-period,
    // imaged nuclei), these needed the hyperbolic branch added to
    // computeSmallBodyState (e>=1, a<0) and are drawn via the time-windowed
    // drawSmallBodyArcByTime instead of drawSmallBodyOrbitEllipse -- there
    // is no meaningful "whole orbit" to draw for a one-time visitor. Real
    // elements all derived the same way as Borrelly/Braille's re-epoch
    // fix: a JPL Horizons heliocentric state vector at the real crossing
    // date, run through stateVectorToElements -- epochDays is the crossing
    // date itself, and each reconstructs the source position AND velocity
    // to ~1e-13 AU / ~1e-15 AU/day. crossingWindowDays gates both the dot's
    // widened in-transit visibility and the arc's drawn time span (see
    // isSmallBodyVisible) -- outside that window a near-parabolic comet's
    // position is either physically meaningless at this scale or so far
    // away it isn't worth rendering.
    hyakutake: {
      name: 'Hyakutake (C/1996 B2)', types: ['comet'],
      // JPL Horizons heliocentric state vector, 1996-05-01 (the real
      // crossing date -- Ulysses unexpectedly passed through this comet's
      // ion tail, "revealing the tail to be at least 3.8 AU in length";
      // this simulator's own Ulysses/comet separation at this date comes
      // out to ~3.65 AU, matching). Near-parabolic (e~1.015).
      elements: { a: -15.516281680420562, e: 1.0149162602402368, iDeg: 126.13899358609308,
                  OmDeg: -170.78942186183025, wDeg: 132.13657721687588, M0Deg: -0.009771406798088477,
                  epochDays: -1340 },
      meta: { color: '#a8e8ff', radiusKm: 2.4 }, // nucleus never imaged; radius a literature estimate
      targetOfFlights: ['ulysses'],
      crossingWindowDays: 365,
    },
    mcnaught_hartley: {
      name: 'McNaught-Hartley (C/1999 T1)', types: ['comet'],
      // JPL Horizons heliocentric state vector, 2000-10-19 (cometary pickup
      // ions detected at Ulysses on 2000-10-19/20, carried there by a
      // coronal mass ejection). Effectively parabolic (e~1.0005).
      elements: { a: -2280.6703921813205, e: 1.000515923783296, iDeg: 80.09283922195306,
                  OmDeg: -177.35974282063773, wDeg: 344.5374853389215, M0Deg: -0.0004999568977696915,
                  epochDays: 292 },
      meta: { color: '#6fc8d8', radiusKm: 1.5 }, // nucleus never imaged; radius a literature estimate
      targetOfFlights: ['ulysses'],
      crossingWindowDays: 365,
    },
    mcnaught: {
      name: 'McNaught (C/2006 P1)', types: ['comet'],
      // JPL Horizons heliocentric state vector, 2007-02-03 (Ulysses' third
      // and final tail crossing -- "the Great Comet of 2007", the brightest
      // comet in over 40 years). Recovered as a very high-eccentricity
      // ellipse (e~0.9994, a~287 AU) from this exact state vector rather
      // than SBDB's rounded hyperbolic quick-look fit -- rendered the same
      // time-windowed way as the other two regardless, since a 287 AU-wide
      // closed ellipse isn't a meaningful "whole orbit" to draw either.
      elements: { a: 287.1542384480255, e: 0.9993942612404899, iDeg: 78.0307515636233,
                  OmDeg: -92.86977517043863, wDeg: 156.30241974327967, M0Deg: 0.004303083393894966,
                  epochDays: 2590 },
      meta: { color: '#e0f5fa', radiusKm: 3 }, // nucleus never imaged; radius a literature estimate
      targetOfFlights: ['ulysses'],
      crossingWindowDays: 365,
    },
  };

  // Pluto-Charon: the solar system's only known "double dwarf planet" --
  // their barycenter sits roughly 2,130 km from Pluto's center, outside
  // Pluto's own 1,188 km radius (unlike Earth-Moon, where the barycenter is
  // comfortably inside Earth), so Charon isn't a "moon" of Pluto in quite
  // the usual sense. Modeled the same way as Earth's Moon or Mars's
  // Phobos/Deimos regardless: Charon's orbit is computed relative to
  // Pluto's own already-computed heliocentric position, which quietly
  // assumes Pluto sits still at that position rather than also wobbling
  // around the barycenter. That wobble (~2,130 km) against Pluto's
  // ~5.9-billion-km solar orbit is a relative error of ~4x10^-7 -- utterly
  // undetectable at this simulator's scale, the same simplification
  // already accepted for Earth-Moon.
  // Elements: JPL Horizons osculating elements (COMMAND=901, CENTER=999,
  // PLU060/DE440 solution, fit through 2023 post-New-Horizons + Gaia
  // data), ecliptic J2000 frame, epoch JD 2461200.5 -- the same epoch used
  // for every other SMALL_BODIES entry in this file. The large ~113°
  // inclination here is not a real tilt of Charon's orbit relative to
  // Pluto's equator (it's ~0°, i.e. exactly equatorial and mutually
  // tidally locked) -- it's Pluto's own extreme ~120° axial obliquity
  // showing up once Charon's orbit is expressed in the ecliptic frame,
  // the same effect already seen with the Uranian moons' iDeg~97.8°.
  const GM_PLUTO_CHARON_KM3_S2 = 975.43; // combined system GM (Brozovic & Jacobson 2024) -- Charon is ~12% of Pluto's mass, non-negligible, so Kepler's-third-law period readouts use the combined value, same reasoning as GM_EARTH_MOON_KM3_DAY2
  const GM_PLUTO_CHARON_KM3_DAY2 = GM_PLUTO_CHARON_KM3_S2 * SEC_PER_DAY * SEC_PER_DAY;
  const CHARON_ELEMENTS = {
    aKm: 19595.76, e: 0.00016026, iDeg: 112.8878,
    OmDeg0: 227.393, wDeg0: 172.3086, M0Deg: 37.3563,
    periodSiderealDays: 6.387222,
  };
  const CHARON_META = { color: '#9c958c', radiusKm: 606 };

  // Didymos-Dimorphos: DART's target binary, and the same "actually two
  // objects" situation as Pluto+Charon above -- Dimorphos, the moonlet
  // DART actually hit, is modeled as a real satellite of Didymos (a
  // SMALL_BODIES entry) using the identical buildSatelliteAbs pattern
  // Charon uses relative to Pluto, rather than folding it into a single
  // "Didymos" blob.
  //
  // Uses the POST-impact orbit (2022-09-26 impact already in the past
  // relative to this simulator's "now") -- DART's whole point was
  // changing this orbit, so the pre-impact values it was launched to
  // change are the wrong ones to model as the current, ongoing state.
  // Real measured post-impact a=1.144 km, e=0.028 (Naidu et al. 2024,
  // Nature) -- a 37 m / -33.24 min change from pre-impact. GM here is
  // derived from those via Kepler's third law (4*pi^2*a^3/T^2) rather
  // than an independent mass measurement, same reasoning as
  // GM_PLUTO_CHARON above. Inclination approximated as Didymos's own
  // heliocentric orbital inclination (assumes Dimorphos orbits roughly
  // in Didymos's orbital plane) -- no published ecliptic-frame pole
  // solution for Didymos was available to derive a more precise figure
  // the way Charon's real Horizons-sourced value above does. Om/w/M0 are
  // placeholder phase angles: at an 11.37-HOUR period, "correct"
  // real-time phase only matters for less than half a day at a stretch,
  // and no precise phase solution was readily available either.
  const GM_DIDYMOS_DIMORPHOS_KM3_S2 = 3.529e-8;
  const GM_DIDYMOS_DIMORPHOS_KM3_DAY2 = GM_DIDYMOS_DIMORPHOS_KM3_S2 * SEC_PER_DAY * SEC_PER_DAY;
  const DIMORPHOS_ELEMENTS = {
    aKm: 1.144, e: 0.028, iDeg: SMALL_BODIES.didymos.elements.iDeg,
    OmDeg0: 0, wDeg0: 0, M0Deg: 0,
    periodSiderealDays: 11.37 / 24, // ~11.37 h post-DART (was ~11.92 h pre-impact)
  };
  const DIMORPHOS_META = {
    color: '#7a7268', radiusKm: 0.0755, dimensionsKm: [0.177, 0.174, 0.116],
    shapeNote: 'ellipsoidal moonlet',
  };

  /* =========================================================================
     ORBITAL MECHANICS: Kepler element propagation + Cartesian conversion
  ========================================================================= */

  // Days since J2000 epoch for a given JS Date (UTC).
  function daysSinceJ2000(date) {
    const msPerDay = 86400000;
    const jsEpochJD = 2440587.5; // JD at 1970-01-01 00:00 UTC
    const jd = date.getTime() / msPerDay + jsEpochJD;
    return jd - J2000_JD;
  }

  // Inverse of daysSinceJ2000: given a days-since-J2000 value, return the
  // corresponding JS Date (UTC). Used to convert a flight's launchDays
  // (computed once at setup) back into a real calendar date for the date
  // input field and for jumping simDate to "just before launch."
  function dateFromDaysSinceJ2000(days) {
    const msPerDay = 86400000;
    const jsEpochJD = 2440587.5;
    const jd = days + J2000_JD;
    return new Date((jd - jsEpochJD) * msPerDay);
  }

  // Parses a flight-data date field, which is a bare "YYYY-MM-DD" (assumed
  // midnight UTC -- the convention every existing flight file uses) UNLESS
  // it already includes a time component (e.g. "YYYY-MM-DDTHH:MM:SSZ"), in
  // which case it's used as-is. Needed for geocentric_orbit legs: a real
  // parking-orbit burn happens at a specific perigee passage, not
  // necessarily at midnight, and getting that timing right (hours, not
  // days) matters for chaining segments so each one's *own* period lines
  // its end back up with the next burn -- day-only precision was leaving
  // multi-hour phase gaps at segment boundaries. Every other leg type/date
  // field keeps working exactly as before, since a bare date has no "T".
  function parseFlightDate(s) {
    return new Date(s.includes('T') ? s : s + 'T00:00:00Z');
  }

  // Solve Kepler's equation M = E - e sin(E) for eccentric anomaly E, given
  // mean anomaly M (radians) and eccentricity e. Newton-Raphson.
  function solveKepler(M, e) {
    M = ((M % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    let E = e < 0.8 ? M : Math.PI;
    for (let iter = 0; iter < 50; iter++) {
      const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
      E -= dE;
      if (Math.abs(dE) < 1e-12) break;
    }
    return E;
  }

  // Solve the HYPERBOLIC Kepler equation M = e sinh(H) - H for hyperbolic
  // anomaly H, given mean anomaly M and eccentricity e > 1. Needed once a
  // flight's own Lambert-solved or GA-derived orbit turns out to be
  // genuinely hyperbolic relative to the Sun -- e.g. New Horizons after
  // its Jupiter assist (e~1.03, correctly escaping the solar system) --
  // which ordinary elliptical solveKepler can't represent (sqrt(1-e)
  // above goes complex for e>1). Unlike M for an ellipse, hyperbolic M is
  // unbounded (not periodic), so no 2π wrapping here. Newton-Raphson with
  // an asymptotic seed for large |M| so it doesn't diverge on a distant
  // start point (M=H is only a good seed near periapsis).
  function solveKeplerHyperbolic(M, e) {
    let H = Math.abs(M) > 1
      ? Math.sign(M) * Math.log(2 * Math.abs(M) / e + 1.8)
      : M;
    for (let iter = 0; iter < 100; iter++) {
      const dH = (e * Math.sinh(H) - H - M) / (e * Math.cosh(H) - 1);
      H -= dH;
      if (Math.abs(dH) < 1e-12) break;
    }
    return H;
  }

  /* =========================================================================
     LAMBERT SOLVER (for flight trajectories: Curiosity, Perseverance, etc.)
     Real interplanetary transfers are not a freehand curve between two
     points -- the heliocentric cruise segment of a real transfer (the
     part between Earth departure and Mars arrival/capture, deliberately
     the only part this simulator models, per scope) is a genuine
     Keplerian ellipse around the Sun, exactly like a planet's orbit. The
     Lambert problem is: given two position vectors and a time of flight,
     find the orbit connecting them. This uses the universal-variable
     formulation (Bate/Mueller/White; Vallado's standard reference
     approach), which handles elliptic/parabolic/hyperbolic cases with one
     continuous set of equations via the Stumpff functions C(z)/S(z) --
     preferred over older method-specific solvers (e.g. p-iteration) which
     have branch-selection pitfalls. Validated standalone (independent
     RK4 numerical re-propagation matched the Lambert-derived velocity to
     within ~13,000 km over a 254-day, 1.5 AU transfer, well under 0.01%)
     before integration here.
  ========================================================================= */

  function stumpffC(z) {
    if (z > 1e-6) {
      const sz = Math.sqrt(z);
      return (1 - Math.cos(sz)) / z;
    } else if (z < -1e-6) {
      const sz = Math.sqrt(-z);
      return (Math.cosh(sz) - 1) / (-z);
    } else {
      return 1 / 2 - z / 24 + z * z / 720; // series near z=0, avoids 0/0
    }
  }
  function stumpffS(z) {
    if (z > 1e-6) {
      const sz = Math.sqrt(z);
      return (sz - Math.sin(sz)) / (sz * sz * sz);
    } else if (z < -1e-6) {
      const sz = Math.sqrt(-z);
      return (Math.sinh(sz) - sz) / (sz * sz * sz);
    } else {
      return 1 / 6 - z / 120 + z * z / 5040;
    }
  }

  // r1, r2 in AU; tofDays in days; shortWay true for a <180deg prograde
  // sweep (what this file calls a Type-I-like transfer), false for
  // >=180deg. Returns {v1, v2} in AU/day -- the velocity the spacecraft
  // must have at r1 (and will have at r2) to make the transfer in exactly
  // tofDays.
  function solveLambertUniversal(r1, r2, tofDays, shortWay) {
    function vSub(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
    function vScale(a, s) { return [a[0]*s, a[1]*s, a[2]*s]; }
    function vDot(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
    function vNorm(a) { return Math.sqrt(vDot(a, a)); }

    const r1mag = vNorm(r1);
    const r2mag = vNorm(r2);
    const cosDnu = vDot(r1, r2) / (r1mag * r2mag);
    const A = (shortWay ? 1 : -1) * Math.sqrt(r1mag * r2mag * (1 + cosDnu));
    if (A === 0) throw new Error("Lambert solver: degenerate geometry (A=0)");

    function yOfZ(z, C, S) {
      return r1mag + r2mag + A * (z * S - 1) / Math.sqrt(C);
    }
    // y(z) < 0 is not a numerical edge case -- it means z lies outside the
    // geometry this A (shortWay/longWay choice) can actually reach, and
    // Math.sqrt(y) below would go complex. tofOfZ returns NaN there so the
    // caller can treat it as "no information" rather than a valid TOF.
    function tofOfZ(z) {
      const C = stumpffC(z), S = stumpffS(z);
      const y = yOfZ(z, C, S);
      if (y < 0) return NaN;
      const chi = Math.sqrt(y / C);
      return (chi * chi * chi * S + A * Math.sqrt(y)) / Math.sqrt(GM_SUN_AU3_DAY2);
    }
    function f(zTry) { return tofOfZ(zTry) - tofDays; }

    // Find a genuine, verified sign-changing bracket by scanning rather than
    // assuming a fixed [-50, 50] window brackets the root. Two things break
    // that fixed-window assumption in practice: (1) the low end can fall in
    // the y(z)<0 invalid region (NaN), which a naive "loVal*hiVal > 0" check
    // silently misreads as "already bracketed" since NaN comparisons are
    // always false -- the search then walks the wrong direction and
    // converges on garbage with no error ever raised; (2) TOF(z) has a pole
    // at z=(2*pi)^2 (where stumpffC(z) -> 0) separating the 0-revolution
    // solution branch (z below the pole) from multi-revolution branches
    // (z above it) -- a wide fixed window can let bisection cross into the
    // wrong branch. Both failure modes were caught for real (New Horizons'
    // Earth->Jupiter leg: fixed-window bisection converged to z~50, on the
    // wrong side of the pole, giving a launch C3 of ~135 km^2/s^2 against
    // the real recorded 157.75 -- silently, with no thrown error). Fix:
    // scan the physically valid domain in front of the pole for the actual
    // (unique, since TOF(z) is monotonic within one branch) sign change,
    // then bisect only within that verified bracket.
    const zPole = 4 * Math.PI * Math.PI; // first 0-rev TOF(z) singularity
    const zScanMin = -8 * zPole; // generously covers realistic solar-system TOFs
    const zScanMax = zPole - 1e-6;
    const SCAN_N = 4000;
    let zLo = null, zHi = null, fLoVal = null, fHiVal = null;
    let prevZ = zScanMin, prevF = f(zScanMin);
    for (let k = 1; k <= SCAN_N; k++) {
      let z = zScanMin + (zScanMax - zScanMin) * (k / SCAN_N);
      let fz = f(z);
      // A NaN->finite transition means the y(z)=0 domain boundary lies
      // somewhere between prevZ (invalid) and z (valid) -- and the valid-
      // but-still-short-of-target window just past that boundary can be
      // much narrower than the scan's own grid spacing. Caught for real on
      // Lucy's Eurybates->Polymele leg (two slow-moving, closely-spaced
      // Trojans, ~34-day hop): the valid window was ~0.04 wide against
      // this grid's ~0.09 spacing, so the first finite sample landed
      // already past the root, with no finite negative sample ever
      // recorded to bracket against -- "could not bracket a root" even
      // though a root genuinely exists right at the domain's edge. Fix:
      // pin the boundary down by bisecting on sign(y(z)) (via finiteness
      // of f), then re-evaluate f just past it. As y->0+, tofOfZ(z)->0,
      // so f(z) there reliably approaches -tofDays (negative, since every
      // real transfer has tofDays>0) -- a trustworthy comparison point
      // even when the coarse grid alone would step right over it.
      if (!Number.isFinite(prevF) && Number.isFinite(fz)) {
        let zInvalid = prevZ, zValid = z;
        for (let b = 0; b < 60; b++) {
          const zMidB = (zInvalid + zValid) / 2;
          if (Number.isFinite(f(zMidB))) zValid = zMidB; else zInvalid = zMidB;
        }
        z = zValid;
        fz = f(z);
      }
      if (Number.isFinite(fz) && Number.isFinite(prevF) && prevF * fz < 0) {
        zLo = prevZ; zHi = z; fLoVal = prevF; fHiVal = fz;
        break;
      }
      if (Number.isFinite(fz)) { prevZ = z; prevF = fz; }
      else { prevF = fz; } // stay at same prevZ; next finite sample restarts comparison cleanly
    }
    if (zLo === null) {
      throw new Error("Lambert solver: could not bracket a root for z in the valid 0-rev domain");
    }

    let zMid = (zLo + zHi) / 2;
    for (let iter = 0; iter < 100; iter++) {
      zMid = (zLo + zHi) / 2;
      const fMid = f(zMid);
      if (Math.abs(fMid) < 1e-9 || (zHi - zLo) < 1e-13) break;
      if (fLoVal * fMid < 0) { zHi = zMid; fHiVal = fMid; } else { zLo = zMid; fLoVal = fMid; }
    }
    const z = zMid;
    const C = stumpffC(z), S = stumpffS(z);
    const y = yOfZ(z, C, S);

    const f_ = 1 - y / r1mag;
    const g_ = A * Math.sqrt(y / GM_SUN_AU3_DAY2);
    const gdot = 1 - y / r2mag;

    const v1 = vScale(vSub(r2, vScale(r1, f_)), 1 / g_);
    const v2 = vScale(vSub(vScale(r2, gdot), r1), 1 / g_);
    return { v1, v2 };
  }

  // Converts a heliocentric position+velocity (AU, AU/day) into the
  // classical orbital elements this file already knows how to propagate
  // forward in time (same representation computeStateVector-family
  // functions use): a, e, i, Om, w, plus the true/mean anomaly AT THE
  // GIVEN STATE, so a caller can reconstruct "mean anomaly at epoch" for
  // later propagation.
  function stateVectorToElements(r, v) {
    function vSub(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
    function vScale(a, s) { return [a[0]*s, a[1]*s, a[2]*s]; }
    function vDot(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
    function vCross(a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
    function vNorm(a) { return Math.sqrt(vDot(a, a)); }

    const rmag = vNorm(r);
    const vmag = vNorm(v);
    const h = vCross(r, v);
    const hmag = vNorm(h);
    const energy = vmag * vmag / 2 - GM_SUN_AU3_DAY2 / rmag;
    const a = -GM_SUN_AU3_DAY2 / (2 * energy);

    const eVec = vSub(vScale(vCross(v, h), 1 / GM_SUN_AU3_DAY2), vScale(r, 1 / rmag));
    const e = vNorm(eVec);

    const i = Math.acos(Math.max(-1, Math.min(1, h[2] / hmag)));

    const nodeLine = [-h[1], h[0], 0]; // cross([0,0,1], h)
    const nodeMag = vNorm(nodeLine);
    let Om;
    if (nodeMag < 1e-12) {
      Om = 0; // equatorial-ish transfer; node undefined, arbitrary reference
    } else {
      Om = Math.atan2(nodeLine[1], nodeLine[0]);
    }

    let w;
    if (nodeMag < 1e-12 || e < 1e-12) {
      w = 0;
    } else {
      const cosW = vDot(nodeLine, eVec) / (nodeMag * e);
      w = Math.acos(Math.max(-1, Math.min(1, cosW)));
      if (eVec[2] < 0) w = 2 * Math.PI - w;
    }

    let nu;
    if (e < 1e-12) {
      nu = 0;
    } else {
      const cosNu = vDot(eVec, r) / (e * rmag);
      nu = Math.acos(Math.max(-1, Math.min(1, cosNu)));
      if (e < 1) {
        // Elliptical: nu is periodic, wrap into [0, 2pi) using the
        // inbound/outbound sign (r.v < 0 means approaching periapsis).
        if (vDot(r, v) < 0) nu = 2 * Math.PI - nu;
      } else {
        // Hyperbolic: nu is bounded within (-nu_inf, +nu_inf), NOT
        // periodic -- wrapping it into [0, 2pi) the same way the
        // elliptical branch does would be physically wrong (there is no
        // "the other side" to wrap around to). Just carry the sign
        // through instead: negative while inbound, positive outbound.
        if (vDot(r, v) < 0) nu = -nu;
      }
    }

    // True anomaly -> eccentric/hyperbolic anomaly -> mean anomaly, so the
    // result can be propagated forward with the same solveKepler (e<1) or
    // solveKeplerHyperbolic (e>=1) machinery used everywhere else.
    let M;
    if (e < 1) {
      const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
      M = E - e * Math.sin(E);
    } else {
      // tanh(H/2) = sqrt((e-1)/(e+1)) * tan(nu/2)
      const H = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu / 2));
      M = e * Math.sinh(H) - H;
    }

    return { a, e, i, Om, w, M };
  }

  // Given mean orbital elements at J2000 and centennial rates, compute the
  // instantaneous element set at time t (days since J2000), then return
  // heliocentric position (AU) and velocity (AU/day) in the ecliptic frame.
  function computeStateVector(elements, daysSinceEpoch) {
    const T = daysSinceEpoch / DAYS_PER_CENTURY; // Julian centuries since J2000

    const a = elements.a + elements.aDot * T; // AU
    const e = elements.e + elements.eDot * T;
    const i = (elements.i + (elements.iDot / 3600) * T) * D2R;
    const Om = (elements.Om + (elements.OmDot / 3600) * T) * D2R;
    const varpi = (elements.varpi + (elements.varpiDot / 3600) * T) * D2R;
    const L = (elements.L + (elements.LDot / 3600) * T) * D2R;

    const w = varpi - Om;       // argument of perihelion
    const M = L - varpi;        // mean anomaly (rad), will be normalized in solveKepler

    const E = solveKepler(M, e); // eccentric anomaly

    // True anomaly
    const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));

    // Distance from focus
    const r = a * (1 - e * Math.cos(E));

    // Position in orbital plane (perifocal coords)
    const xOrb = r * Math.cos(nu);
    const yOrb = r * Math.sin(nu);

    // Mean motion (rad/day) and speed in perifocal frame via vis-viva-consistent
    // derivative of Kepler's equation:
    const n = Math.sqrt(GM_SUN_AU3_DAY2 / (a * a * a)); // rad/day
    const Edot = n / (1 - e * Math.cos(E));
    const xOrbDot = -a * Math.sin(E) * Edot;
    const yOrbDot = a * Math.sqrt(1 - e * e) * Math.cos(E) * Edot;

    // Rotate perifocal -> ecliptic using standard 3-1-3 rotation (w, i, Om)
    const cosOm = Math.cos(Om), sinOm = Math.sin(Om);
    const cosW = Math.cos(w), sinW = Math.sin(w);
    const cosI = Math.cos(i), sinI = Math.sin(i);

    function rotate(x, y) {
      // Rz(Om) * Rx(i) * Rz(w) applied to (x,y,0)
      const xw = x * cosW - y * sinW;
      const yw = x * sinW + y * cosW;
      const xi = xw;
      const yi = yw * cosI;
      const zi = yw * sinI;
      const X = xi * cosOm - yi * sinOm;
      const Y = xi * sinOm + yi * cosOm;
      const Z = zi;
      return [X, Y, Z];
    }

    const pos = rotate(xOrb, yOrb);
    const vel = rotate(xOrbDot, yOrbDot);

    return { pos, vel, a, e, i, Om, w, M, nu, r };
  }

  // Same shape and math as computeStateVector, for a SMALL_BODIES entry --
  // asteroids/comets carry a single osculating epoch (see the SMALL_BODIES
  // comment above) instead of the planets' mean-elements-plus-centennial-
  // rates, so there's no T/DAYS_PER_CENTURY correction step here. Returns
  // the identical { pos, vel, a, e, i, Om, w, M, nu, r } shape so a small
  // body's bodies[] record, and its locked panel, are built exactly the
  // same way any other heliocentric body's already are.
  function computeSmallBodyState(elements, t) {
    const a = elements.a, e = elements.e;
    const i = elements.iDeg * D2R, Om = elements.OmDeg * D2R, w = elements.wDeg * D2R;
    let nu, r, xOrbDot, yOrbDot, M;
    if (e < 1) {
      const n = Math.sqrt(GM_SUN_AU3_DAY2 / (a * a * a)); // rad/day
      M = (elements.M0Deg * D2R) + n * (t - elements.epochDays);
      const E = solveKepler(M, e);
      nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
      r = a * (1 - e * Math.cos(E));
      const Edot = n / (1 - e * Math.cos(E));
      xOrbDot = -a * Math.sin(E) * Edot;
      yOrbDot = a * Math.sqrt(1 - e * e) * Math.cos(E) * Edot;
    } else {
      // Hyperbolic (e>=1, a<0 by convention -- see stateVectorToElements /
      // computeFlightPosition's own hyperbolic branch, which this mirrors
      // for position). Used by long-period comets like the three Ulysses
      // flew through the tail of (SMALL_BODIES.hyakutake/mcnaught_hartley/
      // mcnaught) -- unlike computeFlightPosition, this function also needs
      // velocity (for the locked-panel speed readout), computed via the
      // branch-agnostic p=a(1-e^2)/h relations rather than re-deriving a
      // hyperbolic-anomaly-based xOrbDot/yOrbDot analogous to the E-based
      // ones above (p stays positive for e>=1 since (1-e^2) flips sign the
      // same way a<0 does -- simpler and less sign-error-prone here).
      const n = Math.sqrt(GM_SUN_AU3_DAY2 / (-a * -a * -a)); // rad/day
      M = (elements.M0Deg * D2R) + n * (t - elements.epochDays);
      const H = solveKeplerHyperbolic(M, e);
      nu = 2 * Math.atan2(Math.sqrt(e + 1) * Math.sinh(H / 2), Math.sqrt(e - 1) * Math.cosh(H / 2));
      r = a * (1 - e * Math.cosh(H));
      const p = a * (1 - e * e);
      const h = Math.sqrt(GM_SUN_AU3_DAY2 * p);
      const rDot = (h * e * Math.sin(nu)) / p;
      const nuDot = h / (r * r);
      xOrbDot = rDot * Math.cos(nu) - r * Math.sin(nu) * nuDot;
      yOrbDot = rDot * Math.sin(nu) + r * Math.cos(nu) * nuDot;
    }
    const xOrb = r * Math.cos(nu);
    const yOrb = r * Math.sin(nu);

    const cosOm = Math.cos(Om), sinOm = Math.sin(Om);
    const cosW = Math.cos(w), sinW = Math.sin(w);
    const cosI = Math.cos(i), sinI = Math.sin(i);
    function rotate(x, y) {
      const xw = x * cosW - y * sinW;
      const yw = x * sinW + y * cosW;
      const xi = xw;
      const yi = yw * cosI;
      const zi = yw * sinI;
      return [xi * cosOm - yi * sinOm, xi * sinOm + yi * cosOm, zi];
    }
    const pos = rotate(xOrb, yOrb);
    const vel = rotate(xOrbDot, yOrbDot);
    return { pos, vel, a, e, i, Om, w, M, nu, r };
  }

  // Schema detection — multi-leg flights carry a `legs` array; simple
  // direct-transfer flights use the flat launchDate/arrival/launchBody/
  // destinationBody schema.  Both are supported; the loader branches on this.
  function isMultiLeg(raw) { return Array.isArray(raw.legs); }

  // launchBody/launchDate/destinationBody/arrival for display purposes
  // (locked panel), working for either schema. Flat-schema flights carry
  // these directly; multi-leg flights don't -- their true launch/arrival
  // are the first lambert leg's fromBody/departDate and the last lambert
  // leg's toBody/arrivalDate, the same endpoints getFlightDates() above
  // already uses for the launch/arrival day-count window.
  function flightEndpoints(raw) {
    if (!isMultiLeg(raw)) {
      return {
        launchBody: raw.launchBody, launchDate: raw.launchDate,
        destinationBody: raw.destinationBody, arrival: raw.arrival
      };
    }
    const lambertLegs = raw.legs.filter(l => l.type === 'lambert');
    const first = lambertLegs[0], last = lambertLegs[lambertLegs.length - 1];
    return {
      launchBody: first.fromBody, launchDate: first.departDate,
      destinationBody: last.toBody, arrival: last.arrivalDate
    };
  }

  // Cheap per-flight date arithmetic ONLY -- no ephemeris lookups, no
  // Lambert solve. This is what visibility checks and the legend need,
  // and it must stay cheap even at thousands of flights, since it runs
  // for every flight on every frame (via isFlightVisible). Memoized
  // per key so repeated calls don't even redo the Date parsing.
  //
  // Multi-leg schema: overall window is the FIRST leg's departDate --
  // whatever type it is (a geocentric_orbit parking/raising phase, if
  // present, always comes before any lambert leg, and uses the same
  // departDate field name) -- through the last lambert leg's arrivalDate.
  // Flat schema unchanged.
  const _flightDatesCache = {};
  function getFlightDates(key) {
    if (_flightDatesCache[key]) return _flightDatesCache[key];
    const raw = FLIGHTS_RAW[key];
    let launchDays, arrivalDays;
    if (isMultiLeg(raw)) {
      const lambertLegs = raw.legs.filter(l => l.type === 'lambert');
      launchDays  = daysSinceJ2000(parseFlightDate(raw.legs[0].departDate));
      arrivalDays = daysSinceJ2000(parseFlightDate(lambertLegs[lambertLegs.length - 1].arrivalDate));
    } else {
      launchDays  = daysSinceJ2000(parseFlightDate(raw.launchDate));
      arrivalDays = daysSinceJ2000(parseFlightDate(raw.arrival));
    }
    const result = { launchDays, arrivalDays, tofDays: arrivalDays - launchDays };
    _flightDatesCache[key] = result;
    return result;
  }

  // Per-leg solve cache for multi-leg flights (Step 4).
  // Key format: "${flightKey}:${legIndex}" — analogous to _solvedFlightCache.
  const _solvedLegCache = {};

  // Pre-computed leg boundary days for multi-leg flights.
  // Key: flightKey. Value: array of { type, index, dDays, aDays, location? }.
  // Built once on first call to getLegBoundaries(); subsequent calls are an
  // O(1) cache hit. Eliminates the per-frame new Date() + daysSinceJ2000()
  // calls in computeMultiLegPosition, which previously re-parsed every date
  // string on every animation frame even though the dates never change.
  const _legBoundaryCache = {};

  function getLegBoundaries(flightKey) {
    if (_legBoundaryCache[flightKey]) return _legBoundaryCache[flightKey];
    const legs = FLIGHTS_RAW[flightKey].legs;
    const boundaries = [];
    let prevArrival = null;
    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i];
      if (leg.type === 'lambert') {
        const d = daysSinceJ2000(parseFlightDate(leg.departDate));
        const a = daysSinceJ2000(parseFlightDate(leg.arrivalDate));
        boundaries.push({ type: 'lambert', index: i, dDays: d, aDays: a });
        prevArrival = a;
      } else if (leg.type === 'geocentric_orbit') {
        const d = daysSinceJ2000(parseFlightDate(leg.departDate));
        const a = daysSinceJ2000(parseFlightDate(leg.arrivalDate));
        boundaries.push({ type: 'geocentric_orbit', index: i, dDays: d, aDays: a });
        prevArrival = a;
      } else if (leg.type === 'loiter') {
        const dep = daysSinceJ2000(parseFlightDate(leg.departure));
        boundaries.push({ type: 'loiter', index: i, dDays: prevArrival, aDays: dep, location: leg.location });
        prevArrival = dep;
      } else if (leg.type === 'gravity_assist' || leg.type === 'deepspace_maneuver') {
        const d = daysSinceJ2000(parseFlightDate(leg.date));
        boundaries.push({ type: leg.type, index: i, dDays: d, aDays: d });
        prevArrival = d;
      }
    }
    _legBoundaryCache[flightKey] = boundaries;
    return boundaries;
  }

  // Solves a flight's real Lambert transfer -- looks up the launch body's
  // position at the launch date and the destination body's position at
  // the arrival date (using the SAME ephemeris function planets use, so
  // this is consistent with wherever Earth/Mars actually are in this
  // simulator, not a separately-sourced position), solves for the
  // connecting orbit, then converts that into the classical-element
  // representation so the flight can be propagated forward in time with
  // the same solveKepler-based machinery as everything else.
  //
  // DELIBERATELY LAZY: this is the expensive part (an iterative Lambert
  // solve plus two ephemeris evaluations), and at thousands of flights,
  // running it unconditionally for every flight at load time -- as this
  // simulator used to do -- would make load time scale with total
  // flight count even if the user only ever looks at one flight. Instead
  // this only runs the first time a flight is actually selected (click)
  // or found in-transit on a frame where its arc/marker needs to be
  // drawn (see isFlightVisible and the rendering loop) -- i.e. exactly
  // when the user has either clicked it or "encountered" it through
  // time manipulation, never before. Memoized via _solvedFlightCache so
  // a flight that stays visible across many consecutive frames is only
  // ever solved once, not re-solved every frame.
  const _solvedFlightCache = {};
  function getSolvedFlight(key) {
    if (_solvedFlightCache[key]) return _solvedFlightCache[key];

    const raw = FLIGHTS_RAW[key];
    // Multi-leg flights delegate to getSolvedLeg() (Step 4).
    // Guard here so a multi-leg file added before Step 4 is complete
    // fails loudly rather than silently misusing the flat-schema path.
    if (isMultiLeg(raw)) {
      throw new Error(`getSolvedFlight: "${key}" is a multi-leg flight — use getSolvedLeg(key, legIndex) instead`);
    }
    const { launchDays, arrivalDays, tofDays } = getFlightDates(key);

    const launchState = computeStateVector(PLANET_ELEMENTS[raw.launchBody], launchDays);
    const arrivalState = computeStateVector(PLANET_ELEMENTS[raw.destinationBody], arrivalDays);

    const r1 = launchState.pos;
    const r2 = arrivalState.pos;

    // Determine short-way (<180deg) vs long-way prograde sweep from the
    // actual geometry, rather than assuming -- confirmed Type-I (<180deg)
    // for both Curiosity and Perseverance during validation, but this
    // computes it directly rather than hardcoding that conclusion.
    const r1mag = Math.hypot(r1[0], r1[1], r1[2]);
    const r2mag = Math.hypot(r2[0], r2[1], r2[2]);
    const cosTheta = (r1[0]*r2[0] + r1[1]*r2[1] + r1[2]*r2[2]) / (r1mag * r2mag);
    const rawAngleDeg = Math.acos(Math.max(-1, Math.min(1, cosTheta))) * 180 / Math.PI;
    const crossZ = r1[0]*r2[1] - r1[1]*r2[0];
    const sweepDeg = crossZ < 0 ? 360 - rawAngleDeg : rawAngleDeg;
    const shortWay = sweepDeg < 180;

    const lambert = solveLambertUniversal(r1, r2, tofDays, shortWay);
    const elements = stateVectorToElements(r1, lambert.v1);

    const solved = {
      ...raw,
      launchDays, arrivalDays, tofDays, sweepDeg,
      // Orbital elements at the LAUNCH epoch (M is the mean anomaly at
      // launchDays specifically) -- propagating to any other time needs
      // M0 adjusted by mean motion from this reference point, same
      // pattern as every other Kepler-propagated body in this file.
      elements: { a: elements.a, e: elements.e, i: elements.i, Om: elements.Om, w: elements.w, M0: elements.M, epochDays: launchDays }
    };
    _solvedFlightCache[key] = solved;
    return solved;
  }

  // Propagates a flight's position forward from its Lambert-derived launch
  // state to any daysSinceEpoch within (or even slightly beyond) its
  // actual flight window, using the same Kepler-equation approach as
  // every planet/moon -- a flight is just a heliocentric Keplerian body
  // like any other, once its elements are known.
  function computeFlightPosition(flight, daysSinceEpoch) {
    const el = flight.elements;
    let nu, r;
    if (el.e < 1) {
      const n = Math.sqrt(GM_SUN_AU3_DAY2 / (el.a * el.a * el.a)); // rad/day
      const M = el.M0 + n * (daysSinceEpoch - el.epochDays);
      const E = solveKepler(M, el.e);
      nu = 2 * Math.atan2(Math.sqrt(1 + el.e) * Math.sin(E / 2), Math.sqrt(1 - el.e) * Math.cos(E / 2));
      r = el.a * (1 - el.e * Math.cos(E));
    } else {
      // Hyperbolic (e>=1, a<0 by convention -- see stateVectorToElements):
      // same shape of computation, sinh/cosh and solveKeplerHyperbolic
      // instead of sin/cos and solveKepler. |a|^3 since a itself is
      // negative here (a*a*a would otherwise flip the sign under sqrt).
      const n = Math.sqrt(GM_SUN_AU3_DAY2 / (-el.a * -el.a * -el.a)); // rad/day
      const M = el.M0 + n * (daysSinceEpoch - el.epochDays);
      const H = solveKeplerHyperbolic(M, el.e);
      nu = 2 * Math.atan2(Math.sqrt(el.e + 1) * Math.sinh(H / 2), Math.sqrt(el.e - 1) * Math.cosh(H / 2));
      r = el.a * (1 - el.e * Math.cosh(H));
    }
    const xOrb = r * Math.cos(nu);
    const yOrb = r * Math.sin(nu);

    const cosOm = Math.cos(el.Om), sinOm = Math.sin(el.Om);
    const cosW = Math.cos(el.w), sinW = Math.sin(el.w);
    const cosI = Math.cos(el.i), sinI = Math.sin(el.i);
    const xw = xOrb * cosW - yOrb * sinW;
    const yw = xOrb * sinW + yOrb * cosW;
    const xi = xw;
    const yi = yw * cosI;
    const zi = yw * sinI;
    const X = xi * cosOm - yi * sinOm;
    const Y = xi * sinOm + yi * cosOm;
    const Z = zi;
    return [X, Y, Z];
  }

  // Position offset (km, planet-centered) for a spacecraft in a parking/
  // phasing orbit segment -- the multi-day elliptical orbits real missions
  // like Mangalyaan and Aditya-L1 sit in, raising apogee with a sequence of
  // engine burns at perigee, before their actual heliocentric departure
  // burn (TMI/TL1I). Structurally identical Keplerian propagation to
  // computeFlightPosition, just around a planet (gmKm3Day2, the primary's
  // own GM -- NOT hardcoded to Earth's, since nothing about a parking-orbit
  // leg is Earth-specific: the same "raise apogee with perigee burns"
  // pattern applies to any planet's escape sequence) instead of the Sun,
  // and in km instead of AU -- these orbits (hundreds to a few
  // hundred-thousand km) are far too small for AU-scale units to be
  // numerically meaningful. elements: { aKm, e, i, Om, w, M0, epochDays },
  // same shape/convention as computeFlightPosition's flight.elements (M0 is
  // the mean anomaly AT epochDays, not at J2000 -- unlike the Moon/Phobos/
  // outer-moon elements elsewhere in this file, so each new burn's segment
  // is defined the same convenient way a flight leg is: "0 at the moment
  // this segment starts", since every burn happens at that segment's own
  // periapsis passage).
  function computeGeocentricOffsetKm(elements, t, gmKm3Day2) {
    const n = Math.sqrt(gmKm3Day2 / (elements.aKm * elements.aKm * elements.aKm)); // rad/day
    const M = elements.M0 + n * (t - elements.epochDays);
    const E = solveKepler(M, elements.e);
    const nu = 2 * Math.atan2(Math.sqrt(1 + elements.e) * Math.sin(E / 2), Math.sqrt(1 - elements.e) * Math.cos(E / 2));
    const r = elements.aKm * (1 - elements.e * Math.cos(E));
    const xOrb = r * Math.cos(nu);
    const yOrb = r * Math.sin(nu);

    const cosOm = Math.cos(elements.Om), sinOm = Math.sin(elements.Om);
    const cosW  = Math.cos(elements.w),  sinW  = Math.sin(elements.w);
    const cosI  = Math.cos(elements.i),  sinI  = Math.sin(elements.i);
    const xw = xOrb * cosW - yOrb * sinW;
    const yw = xOrb * sinW + yOrb * cosW;
    const X = xw * cosOm - yw * cosI * sinOm;
    const Y = xw * sinOm + yw * cosI * cosOm;
    const Z = yw * sinI;
    return [X, Y, Z]; // km
  }

  // Velocity twin of computeGeocentricOffsetKm, same elements/units -- the
  // standard perifocal-frame Kepler velocity (mirrors computeFlightVelocity's
  // own elliptical branch verbatim, just in km/day instead of AU/day and
  // around a planet's GM instead of the Sun's), rotated to the same
  // inertial frame computeGeocentricOffsetKm's position uses. Needed for
  // the hodograph dashboard's Sol-relative option on a geocentric_orbit
  // leg (see computeGeocentricOrbitSolFrame) -- until now nothing needed
  // this leg TYPE's own local velocity, only its position (for drawing).
  function computeGeocentricOffsetVelocityKmDay(elements, t, gmKm3Day2) {
    const n = Math.sqrt(gmKm3Day2 / (elements.aKm * elements.aKm * elements.aKm));
    const M = elements.M0 + n * (t - elements.epochDays);
    const E = solveKepler(M, elements.e);
    const Edot = n / (1 - elements.e * Math.cos(E));
    const xd = -elements.aKm * Math.sin(E) * Edot;
    const yd = elements.aKm * Math.sqrt(1 - elements.e * elements.e) * Math.cos(E) * Edot;
    const cosOm = Math.cos(elements.Om), sinOm = Math.sin(elements.Om);
    const cosW  = Math.cos(elements.w),  sinW  = Math.sin(elements.w);
    const cosI  = Math.cos(elements.i),  sinI  = Math.sin(elements.i);
    const xw = xd * cosW - yd * sinW, yw = xd * sinW + yd * cosW;
    return [xw * cosOm - yw * cosI * sinOm, xw * sinOm + yw * cosI * cosOm, yw * sinI]; // km/day
  }

  // Build the { aKm, e, i, Om, w, M0, epochDays } element set for one
  // geocentric_orbit leg from its JSON fields (periapsisKm/apoapsisKm as
  // ALTITUDES above the primary's surface -- same convention as a
  // gravity_assist leg's periapsisKm -- plus angles in degrees and a
  // departDate that IS this segment's periapsis-passage epoch, since every
  // burn happens there). primaryRadiusKm comes from PLANET_META[leg.
  // primaryBody] at the call site -- despite the leg schema having always
  // carried a primaryBody field, this function used to ignore it and
  // hardcode Earth's radius, silently giving the wrong orbit shape for any
  // non-Earth primary (would only have been caught once a Mars/Jupiter-
  // system parking-orbit leg was actually added -- fixed proactively here).
  function geocentricLegElements(leg, primaryRadiusKm) {
    const rp = leg.periapsisKm + primaryRadiusKm; // true radius from the primary's center
    const ra = leg.apoapsisKm  + primaryRadiusKm;
    return {
      aKm: (rp + ra) / 2,
      e: (ra - rp) / (ra + rp),
      i: (leg.inclinationDeg || 0) * D2R,
      Om: (leg.raanDeg || 0) * D2R,
      w: (leg.argPeriapsisDeg || 0) * D2R,
      M0: 0, // every segment starts at its own periapsis passage
      epochDays: daysSinceJ2000(parseFlightDate(leg.departDate)),
    };
  }

  // For the "current orbit" toggle (orbitViewMode "current" vs "full" --
  // see its own UI wiring near focusToggleLabel): find whichever leg is
  // active at the given time and return the orbital elements + reference
  // center (in AU, default the origin/Sol) it should be drawn around.
  // Per the user's own call on how to resolve "what is it orbiting":
  // Sol for a heliocentric (lambert, or a gravity-assist-patched segment)
  // leg or a Lagrange-point loiter (a halo/Lissajous orbit isn't a simple
  // two-body ellipse, so falling back to the underlying heliocentric
  // orbit is the well-defined choice); the geocentric_orbit leg's own
  // primaryBody otherwise (Earth for every current mission, but this
  // reads leg.primaryBody generically so a future non-Earth parking-orbit
  // leg -- Mars, say -- would resolve the same way without new code).
  // Returns null if no leg is active at this time (before launch/after
  // final arrival) or its shape is one of the rejected gravity-assist
  // fallback fits (see drawMultiLegArcs' own comment on why those don't
  // get a specific shape asserted, even here) -- callers fall back to
  // full-path rendering in that case.
  function getCurrentOrbitElements(flightKey, daysSinceEpoch) {
    const raw = FLIGHTS_RAW[flightKey];
    // Flat-schema flights (isMultiLeg false) have no raw.legs at all -- a
    // single implicit heliocentric transfer, same as this function's own
    // lambert/Sol fallback below.
    if (!isMultiLeg(raw)) {
      const flight = getSolvedFlight(flightKey);
      if (daysSinceEpoch < flight.launchDays || daysSinceEpoch > flight.arrivalDays) return null;
      return { elements: flight.elements, centerAU: [0, 0, 0], gmAU3Day2: GM_SUN_AU3_DAY2, legType: 'flat', legLabel: null };
    }
    const legs = raw.legs;

    for (const leg of legs) {
      if (leg.type !== 'geocentric_orbit') continue;
      const d = daysSinceJ2000(parseFlightDate(leg.departDate));
      const a = daysSinceJ2000(parseFlightDate(leg.arrivalDate));
      if (daysSinceEpoch < d || daysSinceEpoch > a) continue;
      const meta = PLANET_META[leg.primaryBody];
      if (!meta || !PLANET_ELEMENTS[leg.primaryBody]) return null;
      const el = geocentricLegElements(leg, meta.radiusKm);
      return {
        elements: { a: el.aKm / AU_KM, e: el.e, i: el.i, Om: el.Om, w: el.w, M0: el.M0, epochDays: el.epochDays },
        // Computed directly rather than read from the frame()-local
        // `worldStates` cache (a real bug this function used to have --
        // worldStates is a const local to frame()'s own body, and this
        // function is a separate top-level sibling with no lexical access
        // to it; reading it here silently threw a ReferenceError any time
        // this branch was reached from outside an active frame() call,
        // e.g. the "Current orbit only" toggle during Mangalyaan/
        // Aditya-L1's real parking-orbit phase -- caught while building
        // the hodograph dashboard, which also calls this function).
        centerAU: computeStateVector(PLANET_ELEMENTS[leg.primaryBody], daysSinceEpoch).pos,
        // Same km/s^2 -> AU^3/day^2 conversion GM_SUN_AU3_DAY2 itself uses
        // (line ~45) -- mean motion around this leg's actual primary, not
        // the Sun, matters once "current orbit" needs to anchor its sweep
        // to elapsed time (see drawCurrentOrbitEllipse).
        gmAU3Day2: meta.gmKm3S2 * (SEC_PER_DAY * SEC_PER_DAY) / (AU_KM * AU_KM * AU_KM),
        legType: 'geocentric_orbit', legLabel: `${leg.primaryBody} parking orbit`,
        influenceBody: leg.primaryBody, // this leg's orbit is planetocentric, not heliocentric -- see getHodographElements
      };
    }

    for (const leg of legs) {
      if (leg.type !== 'loiter') continue;
      const boundaries = getLegBoundaries(flightKey);
      const b = boundaries.find((x) => x.type === 'loiter' && x.location === leg.location);
      if (!b || daysSinceEpoch < b.dDays || daysSinceEpoch > b.aDays) continue;
      const p0 = getBodyPositionAtDays(leg.location, daysSinceEpoch);
      const p1 = getBodyPositionAtDays(leg.location, daysSinceEpoch + 0.5);
      const vel = [(p1[0] - p0[0]) / 0.5, (p1[1] - p0[1]) / 0.5, (p1[2] - p0[2]) / 0.5];
      return {
        elements: stateVectorToElements(p0, vel), centerAU: [0, 0, 0], gmAU3Day2: GM_SUN_AU3_DAY2,
        legType: 'loiter', legLabel: `Parked at ${leg.location}`,
      };
    }

    const hasGA = legs.some((l) => l.type === 'gravity_assist');
    const lambertEntries = legs.map((leg, i) => ({ leg, i })).filter(({ leg }) => leg.type === 'lambert');
    if (hasGA) {
      const segs = getGAChain(flightKey);
      for (const seg of segs) {
        if (daysSinceEpoch < seg.tStart || daysSinceEpoch > seg.tEnd) continue;
        const prevLeg = legs[seg.legIndex - 1];
        const nextLeg = legs[seg.legIndex + 1];
        const followsGA = !!(prevLeg && prevLeg.type === 'gravity_assist');
        if (followsGA && !seg.isPatched) return null; // rejected fallback fit -- no reliable shape to show
        // Label the leg by its neighboring flybys so a dashboard/readout
        // can explain WHY the shape just changed, not just that it did.
        const prevGA = followsGA ? prevLeg.body : null;
        const nextGA = (nextLeg && nextLeg.type === 'gravity_assist') ? nextLeg.body : null;
        let legLabel;
        if (prevGA && nextGA) legLabel = `Between ${prevGA} and ${nextGA} flybys`;
        else if (nextGA) legLabel = `En route to ${nextGA} flyby`;
        else if (prevGA) legLabel = `Cruising after ${prevGA} flyby`;
        else legLabel = 'Interplanetary cruise';
        return { elements: seg.elements, centerAU: [0, 0, 0], gmAU3Day2: GM_SUN_AU3_DAY2, legType: 'lambert_ga', legLabel };
      }
    } else {
      for (const { leg, i } of lambertEntries) {
        const solved = getSolvedLeg(flightKey, i);
        if (daysSinceEpoch >= solved.launchDays && daysSinceEpoch <= solved.arrivalDays) {
          const bodyLabel = (b) => (typeof b === 'string' ? b : 'deep space');
          return {
            elements: solved.elements, centerAU: [0, 0, 0], gmAU3Day2: GM_SUN_AU3_DAY2,
            legType: 'lambert', legLabel: `${bodyLabel(leg.fromBody)} → ${bodyLabel(leg.toBody)}`,
          };
        }
      }
    }
    return null;
  }

  // Given a locked body's display name, resolve its raw satellite elements
  // ({aKm, e, iDeg, OmDeg0, wDeg0, M0Deg, periodSiderealDays} -- confirmed
  // identical shape across the Moon/Phobos/Deimos/Charon/Dimorphos legacy
  // constants AND every OUTER_MOONS entry) plus its primary's display name.
  // Returns null for anything that isn't a moon (planets/small bodies/Sol/
  // flights are resolved elsewhere). Not the same as the per-frame
  // `renderedBodies` records (which carry derived {pos,vel,a,e,i,...} for
  // the CURRENT frame, not the raw {aKm, periodSiderealDays, ...} a
  // hodograph needs to get mean motion right).
  function resolveLockedMoonElements(name) {
    if (name === "Moon") return { elements: MOON_ELEMENTS, primaryName: "Earth" };
    if (name === "Phobos") return { elements: PHOBOS_ELEMENTS, primaryName: "Mars" };
    if (name === "Deimos") return { elements: DEIMOS_ELEMENTS, primaryName: "Mars" };
    if (name === "Charon") return { elements: CHARON_ELEMENTS, primaryName: "Pluto and Charon" };
    if (name === "Dimorphos") return { elements: DIMORPHOS_ELEMENTS, primaryName: "Didymos (65803)" };
    for (const planetName of Object.keys(OUTER_MOONS)) {
      const m = OUTER_MOONS[planetName].find((x) => x.name === name);
      if (m) return { elements: m.elements, primaryName: planetName };
    }
    return null;
  }

  // Resolves "what orbit is active right now" for whatever is currently
  // locked/selected, uniformly for a flight or a plain body -- the single
  // entry point the hodograph dashboard reads from. Only ever needs
  // {a, e, M0, epochDays, n} (mean motion n, not i/Om/w) since the
  // hodograph is drawn in the orbit's own perifocal frame, never rotated
  // into 3D ecliptic. Returns:
  //   null                                  -- nothing locked, or Sol
  //   { empty: 'not-in-transit', ... }      -- flight outside its window
  //   { empty: 'no-shape' }                 -- rejected GA fallback fit
  //   { empty: 'loiter', legLabel }         -- parked at a Lagrange point
  //   { title, legLabel, a, e, M0,
  //     epochDays, n, gmAU3Day2, unitsAreKm } -- a real orbit to draw
  //
  // gmAU3Day2 is only meaningful/used for the hyperbolic branch of
  // hodographCircle -- the elliptical branch derives everything from n
  // directly, which matters because moons use an EMPIRICAL, not
  // GM-derived, n (see computeSatelliteOffset's own comment ~app.js:245).
  // Sol-relative option for a geocentric_orbit leg (the toggle's stretch
  // deliverable): combine the leg's own local (planetocentric) position/
  // velocity with the primary planet's own heliocentric state, then re-fit
  // orbital elements around the SUN instead of the planet -- the same
  // combine-then-refit pattern computeGADeparture already uses for a
  // post-flyby heliocentric orbit. `info` is whatever getCurrentOrbitElements
  // already returned for this instant (elements in AU, planet-centered);
  // reconstructed into km here only because computeGeocentricOffsetKm/
  // computeGeocentricOffsetVelocityKmDay both work in km, matching every
  // other geocentric_orbit call site in this file.
  function computeGeocentricOrbitSolFrame(info, daysSinceEpoch) {
    const elKm = {
      aKm: info.elements.a * AU_KM, e: info.elements.e, i: info.elements.i,
      Om: info.elements.Om, w: info.elements.w, M0: info.elements.M0, epochDays: info.elements.epochDays,
    };
    const gmKm3Day2 = info.gmAU3Day2 * AU_KM * AU_KM * AU_KM;
    const offsetPosKm = computeGeocentricOffsetKm(elKm, daysSinceEpoch, gmKm3Day2);
    const offsetVelKmDay = computeGeocentricOffsetVelocityKmDay(elKm, daysSinceEpoch, gmKm3Day2);
    const primaryState = computeStateVector(PLANET_ELEMENTS[info.influenceBody], daysSinceEpoch);
    const rAU = [0, 1, 2].map((k) => info.centerAU[k] + offsetPosKm[k] / AU_KM);
    const vAUday = [0, 1, 2].map((k) => primaryState.vel[k] + offsetVelKmDay[k] / AU_KM);
    const el = stateVectorToElements(rAU, vAUday);
    const n = el.e < 1
      ? Math.sqrt(GM_SUN_AU3_DAY2 / (el.a * el.a * el.a))
      : Math.sqrt(GM_SUN_AU3_DAY2 / (-el.a * -el.a * -el.a));
    return {
      title: FLIGHTS_RAW[selectedFlightKey].name, legLabel: `${info.legLabel} (Sol-relative)`,
      a: el.a, e: el.e, M0: el.M, epochDays: daysSinceEpoch, n,
      gmAU3Day2: GM_SUN_AU3_DAY2, unitsAreKm: false, influenceBody: 'Sol',
    };
  }

  function getHodographElements(daysSinceEpoch, frameKey) {
    if (frameKey === 'sol' && selectedFlightKey) {
      const info = getCurrentOrbitElements(selectedFlightKey, daysSinceEpoch);
      if (info && info.legType === 'geocentric_orbit') return computeGeocentricOrbitSolFrame(info, daysSinceEpoch);
      return { empty: 'no-shape' };
    }
    if (frameKey && frameKey !== 'default' && frameKey.startsWith('flyby:') && selectedFlightKey) {
      const legIndex = Number(frameKey.slice(6));
      const w = getGaSoiWindows(selectedFlightKey).find((x) => x.legIndex === legIndex);
      const bounds = w && getGaSoiDisplayBounds(w);
      if (w && daysSinceEpoch >= bounds.start && daysSinceEpoch <= bounds.end) {
        // While paused (or stepped to 0x), there's no padding at all (see
        // getGaSoiDisplayBounds) -- show the exact real, undilated physics
        // so a manually-scrubbed date always reflects the true velocity at
        // that instant. The dilation below only kicks in during active
        // playback, where it's solving a real visibility problem, not
        // redefining what "the hodograph at date X" means.
        if (paused || speedMultiplier === 0) {
          return {
            title: FLIGHTS_RAW[selectedFlightKey].name, legLabel: `${w.body} flyby (local)`,
            a: w.aLocalAU, e: w.eHyp, M0: 0, epochDays: w.epochDays, n: w.n,
            gmAU3Day2: w.gmAU3Day2, unitsAreKm: false, influenceBody: w.body,
          };
        }
        // Display-time dilation: the real turn only takes a small fraction
        // of the padded display window (see getGaSoiDisplayBounds) -- far
        // from periapsis the local velocity direction is asymptotically
        // constant (that's what v_infinity means), so evaluating the REAL
        // Kepler timescale here would spend nearly all the widget's
        // visible lifetime sitting motionless at one of the two
        // asymptotes, with the entire turn compressed into a near-instant
        // jump around periapsis. Confirmed numerically: for BepiColombo's
        // real 2021-10-01 Mercury flyby at 1 yr/min, ~95% of a 4-second
        // display window showed a barely-moving point, with the whole
        // ~260deg turn happening in about 0.2 real seconds.
        //
        // A first attempt swept MEAN anomaly linearly across the display
        // window instead -- didn't work, and re-checking the numbers
        // showed why: for an encounter whose SOI radius is huge relative
        // to its periapsis passage (true here, and true of most real
        // flybys), mean anomaly is ALREADY enormous by the time the
        // spacecraft reaches the real SOI boundary -- the hyperbolic
        // anomaly has already saturated near its own asymptote at that
        // point, so stretching the SAME mean-anomaly range across more
        // calendar time just makes the widget sit still for longer, not
        // move more smoothly.
        //
        // TRUE anomaly doesn't have this problem: the hodograph's circle
        // angle is exactly affine in true anomaly (a classical property
        // of the hodograph itself -- verified numerically against this
        // file's own H-based hyperbolic convention: circle angle =
        // -90deg - nu, to within floating-point precision, no saturation
        // anywhere in nu's own bounded range). So sweep nu linearly from
        // -nuSoi to +nuSoi across the display window instead, then
        // convert back to a mean anomaly for THIS instant only (same
        // nu -> H -> M formula computeGaSoiWindow already uses) so the
        // existing M0/epochDays/n-based hodographVelocity still produces
        // the right point -- epochDays is pinned to daysSinceEpoch itself
        // (this element set is freshly rebuilt every frame at the same t
        // it will immediately be evaluated at, same as every other
        // getHodographElements branch), so only this single instant needs
        // to be correct, not a time range. NOT physically real within the
        // real SOI window itself (true nu(t) isn't linear in t -- that's
        // exactly the "sits, then rushes" behavior being smoothed away
        // here), which is why this whole branch is skipped above whenever
        // there's no visibility problem to solve.
        const span = bounds.end - bounds.start;
        const p = (daysSinceEpoch - bounds.start) / span;
        const nuDisplay = -w.nuSoi + p * (2 * w.nuSoi);
        const tanhArg = Math.max(-1 + 1e-9, Math.min(1 - 1e-9,
          Math.sqrt((w.eHyp - 1) / (w.eHyp + 1)) * Math.tan(nuDisplay / 2)));
        const Hdisplay = 2 * Math.atanh(tanhArg);
        const Mdisplay = w.eHyp * Math.sinh(Hdisplay) - Hdisplay;
        return {
          title: FLIGHTS_RAW[selectedFlightKey].name, legLabel: `${w.body} flyby (local)`,
          a: w.aLocalAU, e: w.eHyp, M0: Mdisplay, epochDays: daysSinceEpoch, n: w.n,
          gmAU3Day2: w.gmAU3Day2, unitsAreKm: false, influenceBody: w.body,
        };
      }
      return { empty: 'no-shape' };
    }
    if (selectedFlightKey) {
      const info = getCurrentOrbitElements(selectedFlightKey, daysSinceEpoch);
      if (!info) {
        const { launchDays, arrivalDays } = getFlightDates(selectedFlightKey);
        if (daysSinceEpoch < launchDays || daysSinceEpoch > arrivalDays) {
          return {
            empty: 'not-in-transit',
            launchDate: dateFromDaysSinceJ2000(launchDays).toISOString().slice(0, 10),
            arrivalDate: dateFromDaysSinceJ2000(arrivalDays).toISOString().slice(0, 10),
          };
        }
        return { empty: 'no-shape' };
      }
      if (info.legType === 'loiter') return { empty: 'loiter', legLabel: info.legLabel };
      const el = info.elements;
      const n = el.e < 1
        ? Math.sqrt(info.gmAU3Day2 / (el.a * el.a * el.a))
        : Math.sqrt(info.gmAU3Day2 / (-el.a * -el.a * -el.a));
      return {
        title: FLIGHTS_RAW[selectedFlightKey].name, legLabel: info.legLabel,
        a: el.a, e: el.e, M0: el.M0, epochDays: el.epochDays, n,
        gmAU3Day2: info.gmAU3Day2, unitsAreKm: false,
        // 'Sol' for every leg type except geocentric_orbit (a real
        // planetocentric parking orbit -- see that branch's own comment
        // in getCurrentOrbitElements). NOTE: this does NOT yet cover the
        // brief real window a gravity-assist leg spends inside the FLYBY
        // body's own sphere of influence -- that's a genuinely different,
        // planetocentric-hyperbolic hodograph this app doesn't compute
        // yet (the existing flyby geometry only derives turn angle/exit
        // velocity, not a full local orbital-element set to propagate a
        // hodograph from). Flagged as real follow-up work, not silently
        // approximated as heliocentric.
        influenceBody: info.influenceBody || 'Sol',
      };
    }

    if (!lockedBodyName || lockedBodyName === "Sol") return null;

    if (PLANET_ELEMENTS[lockedBodyName]) {
      const p = PLANET_ELEMENTS[lockedBodyName];
      const T = daysSinceEpoch / DAYS_PER_CENTURY;
      const a = p.a + p.aDot * T;
      const e = p.e + p.eDot * T;
      const varpi = (p.varpi + (p.varpiDot / 3600) * T) * D2R;
      const L = (p.L + (p.LDot / 3600) * T) * D2R;
      const n = Math.sqrt(GM_SUN_AU3_DAY2 / (a * a * a));
      return {
        title: lockedBodyName, legLabel: null,
        a, e, M0: L - varpi, epochDays: daysSinceEpoch, n,
        gmAU3Day2: GM_SUN_AU3_DAY2, unitsAreKm: false, influenceBody: 'Sol',
      };
    }

    const moon = resolveLockedMoonElements(lockedBodyName);
    if (moon) {
      const n = 2 * Math.PI / moon.elements.periodSiderealDays; // empirical period, not GM-derived
      return {
        title: lockedBodyName, legLabel: `Orbiting ${moon.primaryName}`,
        a: moon.elements.aKm, e: moon.elements.e, M0: moon.elements.M0Deg * D2R, epochDays: 0, n,
        gmAU3Day2: null, unitsAreKm: true, influenceBody: moon.primaryName,
      };
    }

    const sb = Object.values(SMALL_BODIES).find((b) => b.name === lockedBodyName);
    if (sb) {
      const el = sb.elements;
      const n = el.e < 1
        ? Math.sqrt(GM_SUN_AU3_DAY2 / (el.a * el.a * el.a))
        : Math.sqrt(GM_SUN_AU3_DAY2 / (-el.a * -el.a * -el.a));
      return {
        title: lockedBodyName, legLabel: null,
        a: el.a, e: el.e, M0: el.M0Deg * D2R, epochDays: el.epochDays, n,
        gmAU3Day2: GM_SUN_AU3_DAY2, unitsAreKm: false, influenceBody: 'Sol',
      };
    }
    return null;
  }

  /* =========================================================================
     LAGRANGE POINT POSITIONS
     For any planet, the five Lagrange points co-rotate with the planet in
     the Sun-planet system.  L1 and L2 lie on the Sun-planet line at the
     Hill sphere radius from the planet; L4 and L5 lie at ±60° in the
     ecliptic plane at the same heliocentric distance as the planet.
     L3 (behind the Sun) is included for completeness but is not
     mission-relevant and is not currently rendered.

     Input:  planetPos — heliocentric ecliptic position vector [x,y,z] in AU
             hillRadiusAU — from PLANET_META[name].hillRadiusAU
     Output: { L1, L2, L4, L5 } — each a [x,y,z] AU position vector
  ========================================================================= */

  function getLagrangePositions(planetPos, hillRadiusAU) {
    const r = Math.sqrt(planetPos[0] * planetPos[0] +
                        planetPos[1] * planetPos[1] +
                        planetPos[2] * planetPos[2]);
    // Unit vector from Sun toward planet
    const ux = planetPos[0] / r;
    const uy = planetPos[1] / r;
    const uz = planetPos[2] / r;

    // L1: between Sun and planet, offset toward Sun from planet
    const L1 = [
      planetPos[0] - ux * hillRadiusAU,
      planetPos[1] - uy * hillRadiusAU,
      planetPos[2] - uz * hillRadiusAU
    ];

    // L2: beyond planet away from Sun
    const L2 = [
      planetPos[0] + ux * hillRadiusAU,
      planetPos[1] + uy * hillRadiusAU,
      planetPos[2] + uz * hillRadiusAU
    ];

    // L4: +60° rotation around ecliptic Z axis (leads planet in orbit)
    // L5: -60° rotation (trails planet)
    function rotateZ(pos, angleDeg) {
      const theta = angleDeg * Math.PI / 180;
      const c = Math.cos(theta), s = Math.sin(theta);
      return [
        pos[0] * c - pos[1] * s,
        pos[0] * s + pos[1] * c,
        pos[2]
      ];
    }
    const L4 = rotateZ(planetPos, +60);
    const L5 = rotateZ(planetPos, -60);

    return { L1, L2, L4, L5 };
  }

  // Lagrange position cache — keyed by "planetName:dayFloor" (1-day resolution
  // is plenty; L-point positions change by < 1 AU/day even for fast planets).
  const _lagrangeCache = {};

  function getCachedLagrange(planetName, planetPos, daysSinceEpoch) {
    const key = planetName + ':' + Math.floor(daysSinceEpoch);
    if (!_lagrangeCache[key]) {
      const meta = PLANET_META[planetName];
      _lagrangeCache[key] = getLagrangePositions(planetPos, meta.hillRadiusAU);
    }
    return _lagrangeCache[key];
  }

  /* =========================================================================
     MULTI-LEG FLIGHT SOLVER AND POSITION HELPERS
  ========================================================================= */

  // Resolve any body key to its heliocentric position at a given epoch.
  // Handles: planet names ("Earth"), Lagrange point refs ("Earth_L2"),
  // and "Sun" (origin).  Used by getSolvedLeg and computeMultiLegPosition.
  function getBodyPositionAtDays(bodyKey, t) {
    // A lambert leg endpoint is usually a named body, but can instead be a
    // fixed heliocentric AU coordinate ({ fixedPos: [x,y,z] }) recorded
    // from real spacecraft ephemeris (JPL Horizons) at that leg boundary's
    // specific date -- used to split an otherwise-unconstrained two-point
    // Lambert solve through a real intermediate waypoint, for a leg where
    // the endpoints alone produce a wildly wrong orbit shape (see
    // BepiColombo's leg 0 comment in its flight JSON). Not tied to any
    // moving body, so it doesn't depend on t at all -- t is only accepted
    // here to keep this function's call signature uniform for every caller.
    if (bodyKey && typeof bodyKey === 'object' && bodyKey.fixedPos) return bodyKey.fixedPos;
    if (bodyKey === 'Sun' || bodyKey === 'Sol') return [0, 0, 0];
    if (bodyKey === 'Moon') return computeMoonStateAtDays(t).pos;
    const lpMatch = bodyKey.match(/^([A-Za-z]+)_(L[1245])$/);
    if (lpMatch) {
      const planetName = lpMatch[1];
      const lpName     = lpMatch[2];
      const planetPos  = computeStateVector(PLANET_ELEMENTS[planetName], t).pos;
      return getCachedLagrange(planetName, planetPos, t)[lpName];
    }
    if (SMALL_BODIES[bodyKey]) {
      return computeSmallBodyState(SMALL_BODIES[bodyKey].elements, t).pos;
    }
    return computeStateVector(PLANET_ELEMENTS[bodyKey], t).pos;
  }

  // Solve a single lambert leg within a multi-leg flight.  Same Lambert
  // machinery as getSolvedFlight, applied per-leg.  Lazy + memoized via
  // _solvedLegCache so only the currently-visible leg is solved on first
  // encounter, not the whole chain at once.
  function getSolvedLeg(flightKey, legIndex) {
    const cacheKey = flightKey + ':' + legIndex;
    if (_solvedLegCache[cacheKey]) return _solvedLegCache[cacheKey];

    const raw = FLIGHTS_RAW[flightKey];
    const leg = raw.legs[legIndex];
    if (leg.type !== 'lambert') {
      throw new Error('getSolvedLeg: leg ' + legIndex + ' of "' + flightKey +
                      '" is type "' + leg.type + '", not lambert');
    }

    const departDays  = daysSinceJ2000(parseFlightDate(leg.departDate));
    const arrivalDays = daysSinceJ2000(parseFlightDate(leg.arrivalDate));
    const tofDays     = arrivalDays - departDays;

    const r1 = getBodyPositionAtDays(leg.fromBody, departDays);
    const r2 = getBodyPositionAtDays(leg.toBody,   arrivalDays);

    const r1mag    = Math.hypot(r1[0], r1[1], r1[2]);
    const r2mag    = Math.hypot(r2[0], r2[1], r2[2]);
    const cosTheta = (r1[0]*r2[0] + r1[1]*r2[1] + r1[2]*r2[2]) / (r1mag * r2mag);
    const rawDeg   = Math.acos(Math.max(-1, Math.min(1, cosTheta))) * 180 / Math.PI;
    const crossZ   = r1[0]*r2[1] - r1[1]*r2[0];
    const sweepDeg = crossZ < 0 ? 360 - rawDeg : rawDeg;
    const shortWay = sweepDeg < 180;

    const lambert  = solveLambertUniversal(r1, r2, tofDays, shortWay);
    const elements = stateVectorToElements(r1, lambert.v1);

    const solved = {
      name: raw.name, legIndex,
      launchDays: departDays, arrivalDays, tofDays, sweepDeg,
      elements: {
        a: elements.a, e: elements.e, i: elements.i,
        Om: elements.Om, w: elements.w,
        M0: elements.M, epochDays: departDays
      }
    };
    _solvedLegCache[cacheKey] = solved;
    return solved;
  }

  /* =========================================================================
     PATCHED-CONIC GRAVITY ASSIST PHYSICS ENGINE
     Root diagnosis: our Lambert solver finds the minimum-energy
     single-revolution orbit between two endpoint positions.  For missions
     like PSP or BepiColombo whose real trajectories are multi-revolution,
     highly-eccentric orbits dipping deep toward the Sun, the single-rev arc
     is completely wrong — e.g. PSP on a Venus→Venus leg sits at ~0.73 AU
     (Venus orbital radius) instead of 0.085 AU at its actual perihelion.

     Fix: patched-conic chaining.
       1. Leg 0 (launch → first flyby): Lambert solve as before.
       2. At each gravity_assist: compute the hyperbolic V_inf rotation to
          get the correct post-flyby heliocentric departure velocity.
       3. All subsequent segments: Keplerian propagation from post-GA state.
     The correct orbit (with the right eccentricity and perihelion) is then
     used for both position queries and arc rendering.

     Turn-direction selection: two candidate outgoing V_inf vectors exist
     (±rotation around the ecliptic-plane-normal axis). We propagate both
     to the next flyby body position and pick whichever gets closer, making
     the selection self-consistent with the mission's date sequence.
  ========================================================================= */

  // Module-level 3-vector helpers (v3_ prefix to avoid shadowing the local
  // closures inside Lambert / stateVectorToElements).
  function v3add(a, b)   { return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; }
  function v3sub(a, b)   { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
  function v3scale(a, s) { return [a[0]*s, a[1]*s, a[2]*s]; }
  function v3dot(a, b)   { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
  function v3cross(a, b) {
    return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  }
  function v3norm(a)     { return Math.sqrt(v3dot(a, a)); }
  function v3unit(a) {
    const m = v3norm(a);
    return m < 1e-15 ? [1, 0, 0] : v3scale(a, 1 / m);
  }

  // Rotate vector v by angle (radians) around unit axis k — Rodrigues formula.
  function rotateAroundAxis(v, k, angle) {
    const cosA  = Math.cos(angle), sinA = Math.sin(angle);
    const dot   = v3dot(k, v);
    const cross = v3cross(k, v);
    return [
      v[0]*cosA + cross[0]*sinA + k[0]*dot*(1 - cosA),
      v[1]*cosA + cross[1]*sinA + k[1]*dot*(1 - cosA),
      v[2]*cosA + cross[2]*sinA + k[2]*dot*(1 - cosA),
    ];
  }

  // Velocity (AU/day) at time t from a flight-element set.
  // Element format: { a, e, i, Om, w, M0, epochDays } — same as getSolvedLeg
  // returns and computeFlightPosition expects.  This is the velocity twin of
  // computeFlightPosition, deriving Ėdot from Kepler's equation and rotating
  // perifocal velocity into ecliptic via the standard 3-1-3 rotation.
  function computeFlightVelocity(el, t) {
    let xd, yd;
    if (el.e < 1) {
      const n    = Math.sqrt(GM_SUN_AU3_DAY2 / (el.a * el.a * el.a));
      const M    = el.M0 + n * (t - el.epochDays);
      const E    = solveKepler(M, el.e);
      const Edot = n / (1 - el.e * Math.cos(E));
      xd = -el.a * Math.sin(E) * Edot;
      yd =  el.a * Math.sqrt(1 - el.e * el.e) * Math.cos(E) * Edot;
    } else {
      // Hyperbolic twin of the above -- see computeFlightPosition's
      // comment for the a<0/|a|^3 convention. Perifocal position here is
      // x=a(cosh(H)-e), y=a*sqrt(e^2-1)*sinh(H) (verified consistent with
      // this file's r/nu-based position formula: at H=0, both give
      // x=a(1-e), y=0, i.e. periapsis); differentiating those directly
      // gives xd/yd below, the hyperbolic analog of the elliptical Edot
      // terms above.
      const n    = Math.sqrt(GM_SUN_AU3_DAY2 / (-el.a * -el.a * -el.a));
      const M    = el.M0 + n * (t - el.epochDays);
      const H    = solveKeplerHyperbolic(M, el.e);
      const Hdot = n / (el.e * Math.cosh(H) - 1);
      xd = el.a * Math.sinh(H) * Hdot;
      yd = el.a * Math.sqrt(el.e * el.e - 1) * Math.cosh(H) * Hdot;
    }

    const cosOm = Math.cos(el.Om), sinOm = Math.sin(el.Om);
    const cosW  = Math.cos(el.w),  sinW  = Math.sin(el.w);
    const cosI  = Math.cos(el.i),  sinI  = Math.sin(el.i);
    const xw = xd*cosW - yd*sinW;
    const yw = xd*sinW + yd*cosW;
    return [xw*cosOm - yw*cosI*sinOm, xw*sinOm + yw*cosI*cosOm, yw*sinI];
  }

  /* =========================================================================
     VELOCITY HODOGRAPH
     For any 2-body Keplerian orbit (ellipse OR hyperbola), the velocity
     vector's tip traces a perfect circle as the body moves along its orbit
     -- radius R, centered at (0, e*R) in the orbit's own perifocal frame
     (x = periapsis direction, y = 90deg ahead in the direction of motion).
     Deliberately NOT reusing computeFlightVelocity above: that function
     hardcodes GM_SUN_AU3_DAY2 into its own mean-motion term, which is
     wrong for a geocentric_orbit parking leg (uses the primary planet's
     GM) and meaningless for a moon (moons use an EMPIRICAL, not
     GM-derived, mean motion -- see computeSatelliteOffset's own comment).
     getHodographElements() resolves the right `n` for whatever is locked/
     selected up front, so these two functions just consume it directly
     and never touch GM except in the hyperbolic branch of the circle math.
  ========================================================================= */

  // Perifocal-frame velocity at time t -- the hodograph's live point.
  // h: { a, e, M0, epochDays, n } as returned by getHodographElements.
  function hodographVelocity(h, t) {
    const { a, e, M0, epochDays, n } = h;
    const M = M0 + n * (t - epochDays);
    if (e < 1) {
      const E = solveKepler(M, e);
      const Edot = n / (1 - e * Math.cos(E));
      return { vx: -a * Math.sin(E) * Edot, vy: a * Math.sqrt(1 - e * e) * Math.cos(E) * Edot };
    }
    const H = solveKeplerHyperbolic(M, e);
    const Hdot = n / (e * Math.cosh(H) - 1);
    return { vx: a * Math.sinh(H) * Hdot, vy: a * Math.sqrt(e * e - 1) * Math.cosh(H) * Hdot };
  }

  // The circle hodographVelocity's point traces over a full orbit.
  // Elliptical branch (R = n*a/sqrt(1-e^2)) is algebraically identical to
  // the textbook R=GM/h when n is GM-derived, but ALSO correct when n is
  // an empirically-measured moon period -- this is why the elliptical
  // branch never touches gmAU3Day2 at all. Only the hyperbolic branch
  // (always GM-driven in this app -- flights/comets, never moons) needs it.
  //
  // Sign note: the hyperbolic branch's center is cy = -e*R, NOT +e*R like
  // the elliptical branch -- verified empirically (live point plotted
  // against both signs across 6 sample true/hyperbolic anomalies for a
  // real hyperbolic comet; only -e*R landed the point on the circle to
  // floating-point precision every time). This isn't a typo: this file's
  // hyperbolic position/velocity parametrization (x=a(cosh H - e),
  // y=a*sqrt(e^2-1)*sinh H, see hodographVelocity/computeFlightVelocity)
  // traces the perifocal frame in the opposite rotational sense from the
  // elliptical E-based parametrization (x=a(cos E - e), y=a*sqrt(1-e^2)*
  // sin E) -- both are internally self-consistent (position and velocity
  // always agree with each other, and the final 3D trajectory after the
  // Om/w/i rotation comes out correct either way, which is why this never
  // surfaced as a visible bug elsewhere), but it means the two branches'
  // "positive y direction" don't match, so the hodograph's offset sign
  // must flip to match whichever convention hodographVelocity used.
  function hodographCircle(h) {
    const { a, e, n, gmAU3Day2 } = h;
    if (e < 1) {
      const R = n * a / Math.sqrt(1 - e * e);
      return { R, cx: 0, cy: e * R };
    }
    const hAng = Math.sqrt(gmAU3Day2 * a * (1 - e * e)); // a<0, 1-e^2<0 -> product positive
    const R = gmAU3Day2 / hAng;
    return { R, cx: 0, cy: -e * R };
  }

  // Given incoming hyperbolic excess velocity (AU/day, planet frame), return
  // the turn-angle magnitude and an orthonormal basis for the plane
  // perpendicular to V_inf.
  //
  // Turn angle derivation: e_hyp = 1 + r_peri × v_inf² / GM_planet (km, km/s)
  //   δ = 2 × arcsin(1 / e_hyp)
  // This magnitude is exact -- straight from the hyperbolic-flyby vis-viva
  // relation, given only periapsis and v_inf. What it does NOT fix is the
  // roll angle: physically, every valid outgoing V_inf for a fixed δ lies
  // on a cone of half-angle δ around the incoming V_inf direction, and
  // where on that cone the real flyby lands depends on the actual approach
  // geometry (the impact-parameter/B-plane vector), which isn't part of
  // this simulator's per-leg data. flybyGeometry() only sets up the cone;
  // computeGADeparture() below solves for the roll angle.
  function flybyGeometry(vInfIn, periapsisKm, planetRadiusKm, gmPlanetKm3S2) {
    const v = v3norm(vInfIn);
    if (v < 1e-12) return null;

    const v_kms  = v * AU_KM / SEC_PER_DAY;           // convert AU/day → km/s
    const r_peri = periapsisKm + planetRadiusKm;       // km, total periapsis radius
    const e_hyp  = 1 + r_peri * v_kms * v_kms / gmPlanetKm3S2;
    const delta  = 2 * Math.asin(Math.min(1, 1 / e_hyp));  // turn angle, radians

    // e1/e2: orthonormal basis spanning the plane perpendicular to V_inf,
    // so any point on the turn cone is e1*cos(phi) + e2*sin(phi) rotated
    // by delta around vInfIn (see vInfOutAtPhi).
    const vUnit = v3unit(vInfIn);
    const ref   = Math.abs(vUnit[2]) > 0.99 ? [1, 0, 0] : [0, 0, 1];
    const e1    = v3unit(v3cross(vUnit, ref));
    const e2    = v3cross(vUnit, e1); // unit already: vUnit ⟂ e1, both unit

    // eHyp/rPeriKm: the local hyperbola's own real eccentricity/periapsis,
    // exposed (not just used internally for delta above) so a SOI-relative
    // hodograph can be drawn for this flyby -- see computeGaSoiWindow. This
    // is exact real hyperbolic-flyby geometry from periapsisKm + the real
    // v_inf alone, independent of whether the SURROUNDING heliocentric
    // roll-angle fit (computeGADeparture's own evalPhi search) later gets
    // accepted or rejected by getGAChain's missTooLarge check -- it stays
    // correct even on legs where that outer fit is known-unreliable
    // (BepiColombo, PSP; see getGAChain's own long comment on why).
    return { delta, e1, e2, turnAngleDeg: delta * 180 / Math.PI, eHyp: e_hyp, rPeriKm: r_peri };
  }

  // Outgoing V_inf at roll angle phi (radians) around the incoming asymptote.
  function vInfOutAtPhi(vInfIn, geom, phi) {
    const cosPhi = Math.cos(phi), sinPhi = Math.sin(phi);
    const axis = [
      geom.e1[0] * cosPhi + geom.e2[0] * sinPhi,
      geom.e1[1] * cosPhi + geom.e2[1] * sinPhi,
      geom.e1[2] * cosPhi + geom.e2[2] * sinPhi,
    ];
    return rotateAroundAxis(vInfIn, axis, geom.delta);
  }

  // Compute the post-flyby heliocentric state at a gravity assist.
  //
  // The turn-angle magnitude is exact (see flybyGeometry). The one
  // remaining unknown -- the B-plane roll angle -- is solved for, not
  // guessed: since we know where the spacecraft is recorded as going next
  // (the following gravity assist or Lambert-arrival body, at its real
  // date), the roll angle that reproduces that known point IS the correct
  // one, up to the accuracy of the Lambert/two-body approximation itself.
  // This replaces an earlier version that only tried two roll angles
  // (±90° about one arbitrary axis) and picked whichever was closer --
  // close enough for gentle flybys to look right but off by a percent or
  // two, and for steep ones (e.g. BepiColombo's ~200km-altitude Mercury
  // passes) sometimes missing badly enough to come out hyperbolic
  // (unbound) relative to the Sun, which broke rendering entirely.
  //
  // Miss distance vs. roll angle can have more than one local minimum
  // (the cone can cross near the target region twice), so this scans the
  // full circle coarsely first, then refines the best sample with a
  // golden-section search -- safer than gradient descent from one guess.
  //
  // KNOWN RESIDUAL ACCURACY LIMITS (verified 2026-07-22 by comparing this
  // solver's best-achievable miss distance, i.e. even at the optimal roll
  // angle, against each flight's recorded next encounter -- see the "OLD
  // best vs NEW best" instrumentation this comment describes; not left in
  // the code, just documented here for whoever picks this up next):
  //   - PSP (chemical propulsion, real ballistic coast-and-flyby profile):
  //     this solver gets most flybys within ~0.1% of the recorded next
  //     encounter (down from 10-140x worse under the old ±90° guess). A
  //     few flybys -- consistently the ones preceded by PSP's longest
  //     coast segments (400+ days) -- stay off by tens of millions of km
  //     EVEN AT the optimal roll angle, meaning no roll-angle choice
  //     explains it; the incoming velocity itself is slightly wrong. Most
  //     likely cause: real trajectory-correction burns and solar
  //     radiation pressure over a long coast, neither of which exists in
  //     this simulator's leg data. Treat as a real, probably irreducible
  //     limit of a pure patched-conic model without added per-leg state
  //     vectors or an SRP term -- not a bug to keep re-tuning per pass.
  //   - BepiColombo: stays inaccurate on most legs even at the optimal
  //     roll angle, MUCH more so than PSP. Root cause is different in
  //     kind, not degree: BepiColombo flies on continuous solar-electric
  //     (ion) thrust between flybys, so the "coast on a fixed ellipse"
  //     assumption this whole GA-chain model relies on is the wrong
  //     physical model for its inter-flyby legs, independent of how well
  //     any single flyby's turn is solved. (Consistent evidence: its one
  //     leg that fits almost exactly is also its shortest coast -- ~90
  //     days -- i.e. the segment with the least accumulated thrust to be
  //     wrong about.) Closing this gap for real needs either real
  //     state-vector checkpoints per leg or a low-thrust arc model; it is
  //     not fixable by better flyby-geometry solving, so don't spend more
  //     time on roll-angle/turn-angle tuning for BepiColombo specifically.
  //     getGAChain() below DOES guard against the worst symptom (a bad
  //     enough fit was rendering BepiColombo's current position out past
  //     Mars, once nearly at Jupiter, for a mission that's actually
  //     Mercury-bound) by falling back to the plain Lambert endpoint-to-
  //     endpoint solve when a patched fit's miss is too large to trust --
  //     see missAU/chordAU below. That fallback is a bound on how wrong
  //     the picture can look, not a fix for WHY it drifts; the underlying
  //     ion-thrust mismodeling is still there.
  function computeGADeparture(posGA, velPlanet, velArrival,
                               periapsisKm, planetRadiusKm, gmPlanetKm3S2,
                               nextBodyPos, nextT, epochT) {
    const vInfIn = v3sub(velArrival, velPlanet);
    const geom = flybyGeometry(vInfIn, periapsisKm, planetRadiusKm, gmPlanetKm3S2);
    if (!geom) return { pos: posGA, vel: velArrival, epochDays: epochT, missAU: 0 }; // no relative velocity to turn

    function evalPhi(phi) {
      const vDep = v3add(velPlanet, vInfOutAtPhi(vInfIn, geom, phi));
      try {
        const el = stateVectorToElements(posGA, vDep);
        // Reject only genuinely degenerate results (non-finite, or a=0 --
        // energy computation blew up). Hyperbolic (a<0, e>=1) is a real,
        // correctly-propagatable outcome now (see computeFlightPosition/
        // computeFlightVelocity's hyperbolic branches) -- New Horizons'
        // post-Jupiter state IS hyperbolic (e~1.03, genuinely escaping the
        // solar system), so excluding e>=1 here would systematically bias
        // the roll-angle search away from the physically correct answer
        // for exactly the flybys energetic enough to need this branch.
        if (!isFinite(el.a) || !isFinite(el.e) || el.a === 0) return { d: 1e30, vDep };
        const elFmt = { a: el.a, e: el.e, i: el.i, Om: el.Om, w: el.w, M0: el.M, epochDays: epochT };
        const pos   = computeFlightPosition({ elements: elFmt }, nextT);
        return { d: v3norm(v3sub(pos, nextBodyPos)), vDep };
      } catch (err) { return { d: 1e30, vDep }; }
    }

    const COARSE_N = 72; // 5° steps around the full roll-angle circle
    let bestPhi = 0, bestD = Infinity;
    for (let k = 0; k < COARSE_N; k++) {
      const phi = (k / COARSE_N) * 2 * Math.PI;
      const { d } = evalPhi(phi);
      if (d < bestD) { bestD = d; bestPhi = phi; }
    }

    // Golden-section refine within ±1 coarse step of the best sample.
    const step = (2 * Math.PI) / COARSE_N;
    let lo = bestPhi - step, hi = bestPhi + step;
    const gr = (Math.sqrt(5) - 1) / 2;
    for (let iter = 0; iter < 40; iter++) {
      const c = hi - gr * (hi - lo);
      const f = lo + gr * (hi - lo);
      if (evalPhi(c).d < evalPhi(f).d) hi = f; else lo = c;
    }

    const { vDep, d: finalD } = evalPhi((lo + hi) / 2);
    return {
      pos: posGA, vel: vDep, epochDays: epochT,
      // How far off, at the BEST achievable roll angle, this fit still is
      // from the real recorded next encounter -- and the direct distance
      // between the two points, as a reference scale for judging that.
      // getGAChain uses these to decide whether to trust this fit at all.
      missAU: finalD,
      chordAU: v3norm(v3sub(nextBodyPos, posGA)),
      // Forwarded from flybyGeometry -- the LOCAL hyperbola's own real
      // eccentricity/periapsis, for a SOI-relative hodograph. Real
      // regardless of missAU/whether this outer heliocentric fit gets
      // accepted (see flybyGeometry's own comment on eHyp/rPeriKm).
      eHyp: geom.eHyp, rPeriKm: geom.rPeriKm,
    };
  }

  // Real SOI entry/exit time bounds (days since J2000) for one flyby's own
  // LOCAL planetocentric hyperbola -- the actual real window during which
  // that body's gravity (not the Sun's) dominates local dynamics, used to
  // decide when a SOI-relative hodograph is physically meaningful to show
  // at all (see getGaSoiWindows/getHodographFrameOptions). Periapsis
  // passage is fixed at tGA (this catalog's own established convention:
  // the real burn/closest-approach happens exactly at a gravity_assist
  // leg's own recorded date), so M0=0 there by definition; entry/exit are
  // symmetric about it since an unpowered hyperbolic flyby is symmetric
  // about its own periapsis.
  //
  // eHyp/rPeriKm: from flybyGeometry (via computeGADeparture's forwarded
  // fields), real hyperbolic-flyby geometry from periapsisKm + real
  // v_inf alone. soiRadiusAU: PLANET_META[body].soiRadiusAU -- callers
  // MUST guard for bodies with none (the Moon; MOON_META has no SOI
  // field, since Earth's own SOI dominates near it, not a separate lunar
  // one in this simplified patched-conic model).
  function computeGaSoiWindow(eHyp, rPeriKm, soiRadiusAU, gmPlanetAU3Day2, tGA) {
    if (!(eHyp > 1) || !soiRadiusAU) return null; // no real v_inf, or a body with no SOI modeled
    const soiRadiusKm = soiRadiusAU * AU_KM;
    if (rPeriKm >= soiRadiusKm) return null; // degenerate (periapsis outside its own SOI) -- not expected with real data
    const aLocalAU = -(rPeriKm / (eHyp - 1)) / AU_KM; // a<0, this file's hyperbolic convention (see stateVectorToElements)
    const n = Math.sqrt(gmPlanetAU3Day2 / (-aLocalAU * -aLocalAU * -aLocalAU)); // rad/day
    const p = rPeriKm * (1 + eHyp); // semi-latus rectum, km (p = a(1-e^2), rearranged to avoid the near-cancellation in a*(1-e^2) directly)
    const cosNu = (p / soiRadiusKm - 1) / eHyp;
    const nu = Math.acos(Math.max(-1, Math.min(1, cosNu))); // domain-clamped, matches stateVectorToElements' own style
    // True anomaly -> hyperbolic anomaly, same formula stateVectorToElements
    // already uses (reused verbatim, not re-derived): tanh(H/2) =
    // sqrt((e-1)/(e+1)) * tan(nu/2). Clamped away from +-1 for float safety
    // only -- exact math never reaches the asymptote for a finite SOI radius.
    const tanhArg = Math.max(-1 + 1e-9, Math.min(1 - 1e-9,
      Math.sqrt((eHyp - 1) / (eHyp + 1)) * Math.tan(nu / 2)));
    const H = 2 * Math.atanh(tanhArg);
    const M = eHyp * Math.sinh(H) - H; // outbound branch (nu>0), so M>0
    const dt = M / n; // days from periapsis to the SOI boundary
    // nu (true anomaly magnitude at the real SOI boundary) is kept
    // alongside M/n/dt -- not used for the window bounds themselves, but
    // needed by getHodographElements' display-time dilation (see its own
    // comment): for a wide-SOI/close-periapsis encounter like this one,
    // M is already huge at the real boundary (H saturates fast), so
    // sweeping M linearly to stretch the display doesn't actually spread
    // the VISUAL motion out -- true anomaly is the parametrization that's
    // exactly linear in hodograph circle angle, with no such saturation.
    return { aLocalAU, eHyp, n, gmAU3Day2: gmPlanetAU3Day2, epochDays: tGA, tStart: tGA - dt, tEnd: tGA + dt, nuSoi: nu };
  }

  // Cache: flightKey → segment array built by getGAChain().
  const _gaChainCache = {};

  // Cache: flightKey → array of real per-flyby speed-change facts, one per
  // gravity_assist leg, populated as a side effect of getGAChain()'s own
  // loop below (which already computes the incoming/outgoing heliocentric
  // velocity for every flyby to solve the turn geometry -- this just keeps
  // a small record of it instead of throwing it away). Used by the
  // educational "Flight profile" panel section (flightProfileHtml) to show
  // a real, mission-specific boost/brake fact instead of an assumption.
  const _gaEventsCache = {};

  function getGAEvents(flightKey) {
    if (!_gaEventsCache[flightKey]) getGAChain(flightKey);
    return _gaEventsCache[flightKey] || [];
  }

  // Real SOI-transit windows, one per gravity_assist leg that has one
  // (Moon flybys and degenerate-v_inf cases have none) -- side effect of
  // getGAChain, same caching precedent as getGAEvents above.
  function getGaSoiWindows(flightKey) {
    return getGAEvents(flightKey).map((ev) => ev.soiWindow).filter(Boolean);
  }

  // A real SOI transit can be very short -- some of BepiColombo's real
  // Mercury flybys last under an hour of sim time. At typical/fast
  // playback speeds (1 yr/min is ~6 sim-days per real second) the second
  // hodograph widget showing that encounter would flash on and off in a
  // fraction of a real second, easy to miss entirely. This pads the
  // real physics window (unchanged, still what's ACTUALLY used to derive
  // the local orbit -- see computeGaSoiWindow) with a symmetric lead-in/
  // hold-after margin, sized so the widget stays visible for at least
  // HODOGRAPH_SOI_MIN_VISIBLE_SECONDS of real wall-clock time regardless
  // of how fast sim time is currently moving. Mathematically fine to
  // evaluate the local hyperbola's own hodograph slightly outside the
  // "real" SOI boundary -- the circle is exact for the entire hyperbola,
  // not just the portion physically inside the SOI (verified: sampled
  // points well outside a real window still land on the predicted
  // circle to floating-point precision) -- so no clamping is needed,
  // just a wider gate on when to show it. No padding while paused: sim
  // time isn't advancing, so there's no flash risk, and the user can
  // already dwell on the real window for as long as they want by not
  // un-pausing.
  const HODOGRAPH_SOI_MIN_VISIBLE_SECONDS = 4;
  // Typed playback speed (unlike the slider, capped at |mult|<=9) is
  // genuinely unbounded -- capping the pad itself keeps an extreme typed
  // speed (thousands of yr/min) from ballooning the display window into
  // an adjacent leg or flyby, which would make two flyby-local frames
  // valid at once (only one can actually be shown -- see the per-frame
  // draw call site). 20 days each side is already far more lead-in/hold
  // than any real encounter here needs at sane speeds.
  const HODOGRAPH_SOI_MAX_PAD_DAYS = 20;
  function getGaSoiDisplayBounds(w) {
    if (paused || speedMultiplier === 0) return { start: w.tStart, end: w.tEnd };
    const daysPerRealSecond = Math.abs(speedMultiplier) * EARTH_YEAR_DAYS / 60;
    const windowDays = w.tEnd - w.tStart;
    const minDays = HODOGRAPH_SOI_MIN_VISIBLE_SECONDS * daysPerRealSecond;
    const padDays = Math.min(HODOGRAPH_SOI_MAX_PAD_DAYS, Math.max(0, (minDays - windowDays) / 2));
    return { start: w.tStart - padDays, end: w.tEnd + padDays };
  }

  // What reference frame(s) the hodograph can currently show: the always-
  // present primary (Sol, or whatever influenceBody the default frame
  // resolves to) plus zero or more flyby-local frames that are only valid
  // while daysSinceEpoch sits inside that flyby's (speed-padded, see
  // getGaSoiDisplayBounds) SOI transit window.
  function getHodographFrameOptions(daysSinceEpoch) {
    const base = getHodographElements(daysSinceEpoch, 'default');
    const primary = { key: 'default', label: (base && base.influenceBody) || 'Sol' };
    const extras = [];
    if (selectedFlightKey && isMultiLeg(FLIGHTS_RAW[selectedFlightKey])) {
      for (const w of getGaSoiWindows(selectedFlightKey)) {
        const bounds = getGaSoiDisplayBounds(w);
        if (daysSinceEpoch >= bounds.start && daysSinceEpoch <= bounds.end) {
          extras.push({ key: `flyby:${w.legIndex}`, label: w.body });
        }
      }
      // Body-orbit case (geocentric_orbit): the spacecraft never leaves its
      // primary's SOI during this leg type by definition, so no window-
      // gating needed here, unlike the flyby case above -- valid for the
      // entire leg duration.
      const info = getCurrentOrbitElements(selectedFlightKey, daysSinceEpoch);
      if (info && info.legType === 'geocentric_orbit') extras.push({ key: 'sol', label: 'Sol' });
    }
    return { primary, extras };
  }

  // Build (or return cached) the patched-conic segment chain for a multi-leg
  // flight.  Each entry covers one Lambert-leg time window:
  //   { legIndex, elements, tStart, tEnd, isPatched }
  // isPatched=false → standard Lambert elements (leg 0 or any leg before the
  //   first gravity_assist), rendered as a single-revolution arc.
  // isPatched=true  → Keplerian elements derived from the post-GA departure
  //   state; may span multiple revolutions; rendered via time-step sampling.
  //
  // For flights with no gravity_assist legs, every segment has isPatched=false
  // and the result is identical to what getSolvedLeg already produces.
  function getGAChain(flightKey) {
    if (_gaChainCache[flightKey]) return _gaChainCache[flightKey];

    const raw  = FLIGHTS_RAW[flightKey];
    const legs = raw.legs;
    const segs = [];
    const gaEvents = _gaEventsCache[flightKey] = [];
    let postGA = null;   // { pos, vel, epochDays } after the most recent GA
    // The GA event's "speed after" can't be read off postGA.vel directly --
    // getGAChain sometimes REJECTS that patched state a few lines below
    // (missTooLarge) and falls back to a fresh Lambert refit instead, which
    // this record has to reflect too or it describes a discarded solution
    // instead of what's actually rendered (verified against real numbers:
    // New Horizons' recorded post-Jupiter fit is one of the rejected ones,
    // and postGA.vel alone gave a bogus ~5 km/s BRAKE where the real,
    // well-documented figure is a ~4 km/s BOOST). So this is only finalized
    // once the following lambert branch settles on its real elements.
    let pendingGaEvent = null;

    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i];

      if (leg.type === 'lambert') {
        const tDepart = daysSinceJ2000(parseFlightDate(leg.departDate));
        const tArrive = daysSinceJ2000(parseFlightDate(leg.arrivalDate));
        let elements, isPatched;

        if (postGA === null) {
          // No prior GA: standard Lambert solve.
          elements  = getSolvedLeg(flightKey, i).elements;
          isPatched = false;
        } else {
          // After a GA: derive elements from post-flyby state vector. Two
          // ways this can be untrustworthy:
          //   1. Outright degenerate (non-finite, or a=0) -- the same
          //      condition evalPhi() inside computeGADeparture already
          //      screens for when scoring candidate roll angles. Can still
          //      happen here if EVERY roll angle came out degenerate.
          //      Hyperbolic (a<0, e>=1) is NOT included in this rejection
          //      -- it's a real, correctly-propagatable outcome (see
          //      computeFlightPosition's hyperbolic branch), needed for
          //      cases like New Horizons' post-Jupiter state (e~1.03,
          //      genuinely escaping the solar system).
          //   2. Technically bound (or hyperbolic), but the incoming velocity it was built
          //      from was already bad enough (see the SEP/ion-thrust note
          //      above) that even the best achievable roll angle still
          //      misses the real recorded next encounter by a wide margin.
          //      At that point the fit carries little more information
          //      than not fitting at all, and rendering it anyway produces
          //      nonsense -- two observed cases:
          //        - A BepiColombo leg whose best-case miss was ~650M km
          //          (many times the chord distance), which came out as a
          //          Jupiter-grazing a=2.1 AU / e=0.96 orbit for a
          //          spacecraft actually en route to a Mercury arrival
          //          months away.
          //        - An ESCAPADE leg (its one Earth flyby has almost no
          //          v_inf to work with -- see the mission's own loiter-
          //          then-flyby design) whose best-case miss was "only"
          //          ~73% of the chord distance -- which sounds passable,
          //          but the resulting a=1.02 AU / e=0.04 orbit never
          //          leaves the immediate neighborhood of Earth's own
          //          orbit (0.98-1.06 AU) despite this leg's real endpoint
          //          being Mars at 1.5+ AU. A miss that's merely "smaller
          //          than the chord" is not the same as "close to the
          //          target" -- a threshold near 100% of the chord passes
          //          fits that clearly never converge on it, so this is
          //          deliberately much stricter.
          // Either way, fall back to the plain Lambert solve for this leg
          // -- always well-posed (it's anchored to the two real endpoint
          // positions and the real time-of-flight, independent of GA
          // history) -- rather than trusting a wild extrapolation.
          //
          // missTooLarge is checked in ABSOLUTE AU, not as a percentage of
          // chordAU -- a catalog-wide survey (every isPatched=true leg's own
          // propagated position vs. its own real declared endpoint) found
          // the relative-to-chord version let genuinely bad fits through
          // whenever the chord itself was long: JUICE's Aug2024->Jan2025
          // leg missed its real target by 0.2554 AU (real, ~38M km) but
          // that was still under the old 20%-of-chord bound because the
          // chord itself was long enough, and the resulting arc rendered
          // as a plausible-looking curve that simply didn't connect to the
          // next leg -- a misleading "gap and jump" at the seam, worse than
          // the honest empty-gap fallback below, since it looks connected
          // until you check where it actually ends. The same survey found
          // a clean split around 0.02-0.03 AU between fits that were
          // genuinely close (imperceptible at any normal zoom) and fits
          // that were not, regardless of chord length -- what matters for
          // "does this look continuous" is the absolute miss, not its
          // fraction of one particular leg's own chord.
          const el = stateVectorToElements(postGA.pos, postGA.vel);
          const missTooLarge = postGA.missAU !== undefined && postGA.missAU > 0.03;
          if (isFinite(el.a) && isFinite(el.e) && el.a !== 0 && !missTooLarge) {
            elements  = {
              a: el.a, e: el.e, i: el.i,
              Om: el.Om, w: el.w,
              M0: el.M, epochDays: postGA.epochDays
            };
            isPatched = true;
          } else {
            // The patched (roll-angle) fit doesn't reach this leg's own
            // real endpoint closely enough to trust. Before giving up and
            // drawing nothing, try the plain Lambert solve instead -- it's
            // ALWAYS anchored exactly on the real endpoint (that's what
            // Lambert's problem guarantees), so if its own shape isn't
            // itself degenerate, it's strictly better than either the
            // rejected patched fit or an empty gap. Reserved for a plain
            // fit that's clearly well-behaved (e < 0.85, comfortably below
            // where a second catalog survey found the genuinely-wrong
            // cases start, e.g. New Horizons' real post-Jupiter escape
            // trajectory at e~1.4 or MESSENGER's near-parabolic early
            // Mercury-approach legs at e~0.99) -- anything borderline or
            // worse keeps the existing honest-gap behavior rather than
            // risking a confidently-wrong bulging shape.
            const plain = getSolvedLeg(flightKey, i).elements;
            if (isFinite(plain.a) && isFinite(plain.e) && plain.e < 0.85) {
              elements  = plain;
              isPatched = true;
            } else {
              elements  = plain;
              isPatched = false;
            }
          }
          postGA = null;
        }
        if (pendingGaEvent) {
          // Only trust a computed speed number when isPatched is true, i.e.
          // the SAME condition getGAChain already uses to trust the patched
          // state for rendering. When it's false (a long, weakly-constrained
          // coast -- verified against New Horizons' 8-year post-Jupiter leg
          // to Pluto: even the BEST achievable roll angle misses the real
          // recorded arrival by ~29 AU against a ~29 AU chord, i.e. no real
          // signal at all), the fallback Lambert refit's implied velocity at
          // this point reflects an unrelated curve fit, not this flyby's
          // actual local physics (verified against PSP: legs whose fallback
          // triggered showed a ~14 km/s "boost" for a flyby whose periapsis
          // was too gentle to physically produce anywhere near that). Leave
          // speedOutKmS unset in that case; flightProfileHtml falls back to
          // a qualitative description instead of fabricating a number.
          if (isPatched) {
            pendingGaEvent.speedOutKmS = v3norm(computeFlightVelocity(elements, tDepart)) * AU_KM / SEC_PER_DAY;
            pendingGaEvent.aAfterAU = elements.a;
            pendingGaEvent.eAfter = elements.e;
          }
          pendingGaEvent = null;
        }
        segs.push({ legIndex: i, elements, tStart: tDepart, tEnd: tArrive, isPatched });

      } else if (leg.type === 'gravity_assist') {
        const tGA = daysSinceJ2000(parseFlightDate(leg.date));
        if (segs.length === 0) continue;  // GA before any Lambert — skip

        // Spacecraft arrival velocity from the preceding segment.
        const prevEl  = segs[segs.length - 1].elements;
        const velArr  = computeFlightVelocity(prevEl, tGA);

        // Flyby body's state at flyby time (a planet, or -- e.g. Nozomi's
        // real 1998 lunar swingbys -- the Moon).
        const pState = getGAFlybyState(leg.body, tGA);

        // Look ahead to the next GA or Lambert arrival (for turn direction).
        let nextBodyPos = pState.pos, nextT = tGA + 180;
        for (let j = i + 1; j < legs.length; j++) {
          if (legs[j].type === 'lambert') {
            nextT       = daysSinceJ2000(parseFlightDate(legs[j].arrivalDate));
            nextBodyPos = getBodyPositionAtDays(legs[j].toBody, nextT);
            break;
          }
          if (legs[j].type === 'gravity_assist') {
            nextT       = daysSinceJ2000(parseFlightDate(legs[j].date));
            nextBodyPos = getGAFlybyState(legs[j].body, nextT).pos;
            break;
          }
        }

        const meta = getGAFlybyMeta(leg.body);
        postGA = computeGADeparture(
          pState.pos, pState.vel, velArr,
          leg.periapsisKm || 500, meta.radiusKm, meta.gmKm3S2,
          nextBodyPos, nextT, tGA
        );
        // Real SOI-relative hodograph window for this flyby, if this body
        // has one modeled (PLANET_META has soiRadiusAU; the Moon does
        // not -- see computeGaSoiWindow's own comment). Set unconditionally
        // here, not deferred like speedOutKmS below: eHyp/rPeriKm are real
        // hyperbolic-flyby geometry from periapsisKm + real v_inf alone,
        // independent of whether the outer heliocentric roll-angle fit
        // later gets accepted or rejected by the isPatched/missTooLarge
        // check further up this function.
        const gmPlanetAU3Day2 = meta.gmKm3S2 * (SEC_PER_DAY * SEC_PER_DAY) / (AU_KM * AU_KM * AU_KM);
        const soiWindow = computeGaSoiWindow(postGA.eHyp, postGA.rPeriKm, meta.soiRadiusAU, gmPlanetAU3Day2, tGA);
        if (soiWindow) { soiWindow.body = leg.body; soiWindow.legIndex = i; }
        pendingGaEvent = {
          legIndex: i, body: leg.body, date: leg.date, periapsisKm: leg.periapsisKm,
          speedInKmS: v3norm(velArr) * AU_KM / SEC_PER_DAY,
          speedOutKmS: undefined, // filled in once the next lambert leg settles on real elements
          aBeforeAU: prevEl.a, eBefore: prevEl.e,
          eHyp: postGA.eHyp, rPeriKm: postGA.rPeriKm, soiWindow,
        };
        gaEvents.push(pendingGaEvent);
      }
      // loiter / deepspace_maneuver: no effect on GA chain state
    }

    _gaChainCache[flightKey] = segs;
    return segs;
  }

  // Return the spacecraft's heliocentric position for a multi-leg flight at
  // time t.  Uses pre-computed leg boundaries (getLegBoundaries) so no date
  // parsing or daysSinceJ2000 calls happen per-frame — only numeric comparisons.
  function computeMultiLegPosition(flightKey, t) {
    const boundaries = getLegBoundaries(flightKey);
    const rawLegs    = FLIGHTS_RAW[flightKey].legs;
    const hasGA      = rawLegs.some(l => l.type === 'gravity_assist');

    for (const b of boundaries) {
      if (b.type === 'lambert') {
        if (t >= b.dDays && t <= b.aDays) {
          if (hasGA) {
            // Use patched-conic elements: correct high-eccentricity post-GA orbit
            const segs = getGAChain(flightKey);
            const seg  = segs.find(s => s.legIndex === b.index);
            if (seg) return computeFlightPosition({ elements: seg.elements }, t);
          }
          return computeFlightPosition(getSolvedLeg(flightKey, b.index), t);
        }
      } else if (b.type === 'geocentric_orbit') {
        if (t >= b.dDays && t <= b.aDays) {
          const leg         = rawLegs[b.index];
          const primaryName = leg.primaryBody || 'Earth';
          const primaryMeta = PLANET_META[primaryName];
          const primaryPos  = computeStateVector(PLANET_ELEMENTS[primaryName], t).pos;
          const gmKm3Day2   = primaryMeta.gmKm3S2 * SEC_PER_DAY * SEC_PER_DAY;
          const offsetKm    = computeGeocentricOffsetKm(geocentricLegElements(leg, primaryMeta.radiusKm), t, gmKm3Day2);
          return [
            primaryPos[0] + offsetKm[0] / AU_KM,
            primaryPos[1] + offsetKm[1] / AU_KM,
            primaryPos[2] + offsetKm[2] / AU_KM,
          ];
        }
      } else if (b.type === 'loiter') {
        if (b.dDays !== null && t >= b.dDays && t <= b.aDays) {
          const parts     = b.location.split('_');   // "Earth_L2" → ["Earth","L2"]
          const planetPos = computeStateVector(PLANET_ELEMENTS[parts[0]], t).pos;
          return getCachedLagrange(parts[0], planetPos, t)[parts[1]];
        }
      }
      // gravity_assist / deepspace_maneuver: boundary tracking only, no position
    }

    // Outside all leg windows: this happens genuinely before the mission
    // starts, genuinely after it ends, OR in an unrepresented GAP between
    // two lambert legs -- e.g. an extended stay at an intermediate target,
    // like Dawn's ~14 months orbiting Vesta before departing for Ceres,
    // which isn't its own leg (no 'loiter' leg type generalizes to
    // "parked at a moving body" the way it does for a fixed Lagrange
    // point). In every one of those cases the right answer is "wherever
    // the most recently-reached body still is" -- its own real ongoing
    // position, not a frozen point -- or the very first leg's origin if
    // we're before anything has happened yet.
    const lambertBounds = boundaries.filter(b => b.type === 'lambert');
    const firstB = lambertBounds[0];
    if (t < firstB.dDays) {
      return getBodyPositionAtDays(rawLegs[firstB.index].fromBody, t);
    }
    let mostRecentArrival = lambertBounds[0];
    for (const b of lambertBounds) {
      if (b.aDays <= t) mostRecentArrival = b;
    }
    return getBodyPositionAtDays(rawLegs[mostRecentArrival.index].toBody, t);
  }

  // Draw a flight arc by sampling position at evenly-spaced time steps.
  // Used for patched-conic segments that may span multiple revolutions —
  // drawFlightArc's eccentric-anomaly sweep assumes a single revolution and
  // would produce a single-loop arc even for 3-orbit segments like PSP's
  // Venus→Venus legs.  300 steps gives smooth curves even at high eccentricity.
  function drawFlightArcByTime(elements, tStart, tEnd) {
    const N = 300;
    const points = [];
    ctx.beginPath();
    for (let k = 0; k <= N; k++) {
      const t = tStart + (k / N) * (tEnd - tStart);
      const [X, Y, Z] = computeFlightPosition({ elements }, t);
      const [sx, sy]  = worldToScreen(X, Y, Z);
      points.push([sx, sy]);
      if (k === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
    return points;
  }

  // Draw a multi-leg flight's lambert legs, with slightly decreasing
  // opacity for later legs. For flights with gravity assists, patched-conic
  // segments are drawn via time-step sampling (drawFlightArcByTime) so
  // multi-revolution arcs render correctly; plain legs use drawFlightArc's
  // closed-form sweep.
  //
  // opts.windowStart/windowEnd (days since J2000), if given, restrict
  // drawing to whatever portion of each leg falls within that range --
  // legs with no overlap at all are skipped outright. Omit both to draw
  // every leg in full (used for the selected flight: an explicit click is
  // "show me the whole thing"). opts.alphaScale multiplies the whole
  // leg-fade opacity, used to keep an unselected, merely-in-transit
  // flight's path visually quieter than the one the user actually clicked.
  function drawMultiLegArcs(flightKey, opts) {
    opts = opts || {};
    const { windowStart, windowEnd, alphaScale = 1 } = opts;
    const raw   = FLIGHTS_RAW[flightKey];
    const hasGA = raw.legs.some(l => l.type === 'gravity_assist');
    const lambertEntries = raw.legs
      .map((leg, i) => ({ leg, i }))
      .filter(({ leg }) => leg.type === 'lambert');

    // Screen-point arrays actually drawn, one per leg -- returned so the
    // caller can register them for click/hover hit-testing (hitTestPaths).
    // A separate array per leg (rather than one flattened list) so a
    // skipped/rejected-fit leg's gap never creates a false connecting
    // segment between two otherwise-unrelated legs.
    const segments = [];

    lambertEntries.forEach(({ leg, i }, seqIndex) => {
      let legStart, legEnd, drawFn;
      const prevLeg = raw.legs[i - 1];
      const followsGA = !!(prevLeg && prevLeg.type === 'gravity_assist');
      if (hasGA) {
        const segs = getGAChain(flightKey);
        const seg  = segs.find(s => s.legIndex === i);
        if (seg && seg.isPatched) {
          // Post-GA orbit: may be multi-revolution; use time-step rendering.
          legStart = seg.tStart; legEnd = seg.tEnd;
          drawFn = (t0, t1) => drawFlightArcByTime(seg.elements, t0, t1);
        }
      }
      if (followsGA && !drawFn) {
        // This leg's patched-conic fit was REJECTED (getGAChain's
        // missTooLarge fallback -- see its own giant comment), meaning
        // getSolvedLeg's plain 2-point Lambert solve is standing in for
        // it. That solve DOES pass through the two real endpoints, but
        // the ellipse/hyperbola shape connecting them over a long, often
        // multi-revolution real gap can bulge wildly in the wrong
        // direction -- confirmed via harness survey: 19 such legs across
        // 12 missions in this catalog, several with e above 0.9 and one
        // outright hyperbolic (New Horizons' post-Jupiter leg),
        // reproducing exactly the "extends past Mars, arcs sharply out
        // past Jupiter" artifact reported for Dawn's post-flyby leg.
        // A straight line between the two endpoints (an earlier version
        // of this fix) isn't a real fix either -- nothing coasts in a
        // straight line that close to the Sun, so it just swaps one
        // physically-impossible shape for another. Drawing nothing for
        // this leg is the only honest option: this simulator doesn't
        // know the real shape here, and no single stand-in shape is
        // correct. The spacecraft's position marker (a separate code
        // path, computeMultiLegPosition) still moves correctly; only
        // this preview line is skipped.
        return;
      }
      if (!drawFn) {
        // First leg (pre-GA Lambert), or no GA at all: standard
        // eccentric-anomaly arc, which drawFlightArc can clip directly.
        const solved = getSolvedLeg(flightKey, i);
        legStart = solved.launchDays; legEnd = solved.arrivalDays;
        drawFn = (t0, t1) => drawFlightArc(solved, t0, t1);
      }

      let drawStart = legStart, drawEnd = legEnd;
      if (windowStart !== undefined) {
        drawStart = Math.max(legStart, windowStart);
        drawEnd   = Math.min(legEnd, windowEnd);
        if (drawStart >= drawEnd) return; // this leg doesn't overlap the window at all
      }

      ctx.globalAlpha = Math.max(0.4, 1.0 - seqIndex * 0.15) * alphaScale;
      const pts = drawFn(drawStart, drawEnd);
      ctx.globalAlpha = 1.0;
      if (pts && pts.length) segments.push(pts);
    });

    // Loiter legs (a stay at a moving Lagrange point) aren't in
    // lambertEntries above, but a real path exists for them too -- the
    // point co-orbits the Sun with its parent planet, so a loiter of more
    // than a few weeks sweeps a real, substantial arc (Chang'e 2's ~8-month
    // Earth_L2 loiter sweeps ~240 degrees of Earth's own orbit; ESCAPADE's
    // ~11-month loiter sweeps even more). Leaving it undrawn produced a
    // visually wrong gap-and-jump between the leg before and the leg after
    // -- unlike the Lambert-fit "honest gap" cases above, there's no
    // uncertainty here: the Lagrange point's position is exactly
    // computable at every moment (same getBodyPositionAtDays lookup the
    // marker/position code already uses), so there's no reason to hide it.
    getLegBoundaries(flightKey).forEach((b) => {
      if (b.type !== 'loiter' || b.dDays === null) return;
      let drawStart = b.dDays, drawEnd = b.aDays;
      if (windowStart !== undefined) {
        drawStart = Math.max(b.dDays, windowStart);
        drawEnd   = Math.min(b.aDays, windowEnd);
        if (drawStart >= drawEnd) return;
      }
      const N = 120;
      const pts = [];
      ctx.globalAlpha = 0.4 * alphaScale;
      ctx.beginPath();
      for (let k = 0; k <= N; k++) {
        const t = drawStart + (k / N) * (drawEnd - drawStart);
        const [X, Y, Z] = getBodyPositionAtDays(b.location, t);
        const [sx, sy]  = worldToScreen(X, Y, Z);
        pts.push([sx, sy]);
        if (k === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
      ctx.globalAlpha = 1.0;
      if (pts.length) segments.push(pts);
    });

    return segments;
  }

  // Draw a small diamond (rotated square) at a world-space AU position.
  // Used for Lagrange point markers — distinct from the circular body
  // markers so L-points are visually identifiable at a glance.
  // size: half-diagonal in pixels; color: CSS color string; alpha: 0-1.
  function drawDiamondMarker(worldPos, size, color, alpha, label) {
    const [sx, sy] = worldToScreen(worldPos[0], worldPos[1], worldPos[2] || 0);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(sx,        sy - size); // top
    ctx.lineTo(sx + size, sy        ); // right
    ctx.lineTo(sx,        sy + size); // bottom
    ctx.lineTo(sx - size, sy        ); // left
    ctx.closePath();
    ctx.stroke();
    if (label) {
      ctx.fillStyle = color;
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(label, sx + size + 3, sy + 3);
    }
    ctx.restore();
  }

  // Draw Lagrange point markers for the selected multi-leg flight, or for
  // any planet whose markers are pinned via the legend toggle (future).
  // Currently: if the selected flight has loiter legs referencing a Lagrange
  // point (e.g. "Earth_L2"), draw that point's marker at its live position
  // for the current frame epoch.  L1/L2/L4/L5 all move with the planet.
  function drawLagrangeMarkers(daysSinceEpoch) {
    if (!selectedFlightKey) return;
    const raw = FLIGHTS_RAW[selectedFlightKey];
    if (!isMultiLeg(raw)) return;

    // Collect unique (planetName, lpName) pairs from loiter legs
    const seen = new Set();
    raw.legs.forEach((leg) => {
      if (leg.type !== 'loiter' || !leg.location) return;
      const parts = leg.location.split('_'); // "Earth_L2" → ["Earth","L2"]
      if (parts.length !== 2) return;
      seen.add(leg.location);
    });
    if (seen.size === 0) return;

    seen.forEach((locationStr) => {
      const [planetName, lpName] = locationStr.split('_');
      const meta = PLANET_META[planetName];
      if (!meta) return;

      // L1/L2 sit at the Hill sphere radius (~1.5M km for Earth = 0.01 AU).
      // Below ~200 px/AU they'd render within a pixel of the planet dot and
      // be invisible noise.  L4/L5 are 1 AU away from the planet so they
      // always have enough separation; no zoom gate needed for them.
      if ((lpName === 'L1' || lpName === 'L2') && pxPerAU < 200) return;

      const pState = computeStateVector(PLANET_ELEMENTS[planetName], daysSinceEpoch);
      const lpts   = getLagrangePositions(pState.pos, meta.hillRadiusAU);
      const pos    = lpts[lpName];
      if (!pos) return;
      drawDiamondMarker(pos, 5, meta.color, 0.75, lpName);
    });
  }

  // Draw dashed SOI boundary circles around flyby bodies when a
  // gravity-assist flight is selected.  Only drawn for planets that appear
  // as the flyby body in at least one gravity_assist leg; not drawn
  // continuously for all planets (visual clutter).  The circle is drawn in
  // world-space AU radius converted to px at the current zoom level, centred
  // on the planet's live screen position so it tracks orbital motion.
  function drawSOIOverlay(daysSinceEpoch) {
    if (!selectedFlightKey) return;
    const raw = FLIGHTS_RAW[selectedFlightKey];
    if (!isMultiLeg(raw)) return;

    // Collect unique flyby planet names from gravity_assist legs
    const flybyBodies = new Set();
    raw.legs.forEach((leg) => {
      if (leg.type === 'gravity_assist' && leg.body) flybyBodies.add(leg.body);
    });
    if (flybyBodies.size === 0) return;

    flybyBodies.forEach((bodyName) => {
      const meta = PLANET_META[bodyName];
      if (!meta || !meta.soiRadiusAU) return;
      const state = computeStateVector(PLANET_ELEMENTS[bodyName], daysSinceEpoch);
      const [sx, sy] = worldToScreen(state.pos[0], state.pos[1], state.pos[2]);
      const soiPx = meta.soiRadiusAU * pxPerAU;

      ctx.save();
      ctx.strokeStyle = meta.color;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(sx, sy, soiPx, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    });
  }

  // Translucent filled quadrilateral for one of the three coordinate
  // reference planes (see drawSolOverlay) -- toWorld(u, v) maps 2D
  // in-plane coordinates to a 3D world position, so the same helper draws
  // any of the three planes just by swapping which axis is held at 0.
  // Orthographic projection (worldToScreen never uses depth for scale)
  // means a flat square in 3D always projects to a flat quadrilateral in
  // 2D, so a single fill() traces it correctly from any camera angle.
  function drawReferencePlane(toWorld, halfExtentAU, color) {
    const corners = [
      toWorld(-halfExtentAU, -halfExtentAU), toWorld(halfExtentAU, -halfExtentAU),
      toWorld(halfExtentAU, halfExtentAU), toWorld(-halfExtentAU, halfExtentAU),
    ].map(([x, y, z]) => worldToScreen(x, y, z));
    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.12;
    ctx.beginPath();
    corners.forEach(([sx, sy], k) => { if (k === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy); });
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  // Draws a straight world-space arrow (line + a small 2D arrowhead at the
  // tip) from `fromAU` toward `fromAU + dir*lengthAU`, with a text label
  // past the tip. The arrowhead is built in SCREEN space from the
  // projected shaft direction, not world space -- a 3D cone/wedge would
  // foreshorten unpredictably under this app's rotation and isn't worth
  // the complexity for a purely schematic indicator.
  function drawWorldArrow(fromAU, dir, lengthAU, color, label) {
    const tip = [fromAU[0] + dir[0]*lengthAU, fromAU[1] + dir[1]*lengthAU, fromAU[2] + dir[2]*lengthAU];
    const [sx1, sy1] = worldToScreen(fromAU[0], fromAU[1], fromAU[2]);
    const [sx2, sy2] = worldToScreen(tip[0], tip[1], tip[2]);
    const ang = Math.atan2(sy2 - sy1, sx2 - sx1);
    const headLen = 9;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx1, sy1);
    ctx.lineTo(sx2, sy2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sx2, sy2);
    ctx.lineTo(sx2 - headLen*Math.cos(ang - Math.PI/7), sy2 - headLen*Math.sin(ang - Math.PI/7));
    ctx.lineTo(sx2 - headLen*Math.cos(ang + Math.PI/7), sy2 - headLen*Math.sin(ang + Math.PI/7));
    ctx.closePath();
    ctx.fill();
    if (label) {
      ctx.font = '11px sans-serif';
      ctx.textAlign = ang > -Math.PI/2 && ang < Math.PI/2 ? 'left' : 'right';
      ctx.fillText(label, sx2 + (ang > -Math.PI/2 && ang < Math.PI/2 ? 6 : -6), sy2 + 4);
    }
    ctx.restore();
  }

  // Shown only while Sol itself is locked: the three coordinate reference
  // planes of this app's own heliocentric ecliptic J2000 frame (XY, the
  // ecliptic itself; XZ; YZ), colored by the conventional X=red/Y=green/
  // Z=blue axis scheme, plus a static arrow along
  // GALACTIC_MOTION_DIR_ECLIPTIC showing the real direction the solar
  // system orbits the galactic center -- a fixed astronomical fact, not
  // something derived from Sol's own (deliberately zero, in this
  // heliocentric model) velocity. Answers "what is 0 along each axis"
  // visually: the three lines ARE the axes, meeting at the origin, which
  // is exactly where Sol itself sits.
  function drawSolOverlay() {
    if (lockedBodyName !== "Sol") return;
    const halfExtentAU = 3;
    const axisLenAU = 3.6;
    const AXIS_X_COLOR = "#ff6b6b", AXIS_Y_COLOR = "#5ce07a", AXIS_Z_COLOR = "#6ba3ff";

    drawReferencePlane((u, v) => [u, v, 0], halfExtentAU, AXIS_Z_COLOR); // XY (ecliptic), normal = Z
    drawReferencePlane((u, v) => [u, 0, v], halfExtentAU, AXIS_Y_COLOR); // XZ, normal = Y
    drawReferencePlane((u, v) => [0, u, v], halfExtentAU, AXIS_X_COLOR); // YZ, normal = X

    drawWorldArrow([0, 0, 0], [1, 0, 0], axisLenAU, AXIS_X_COLOR, "X (vernal equinox, J2000)");
    drawWorldArrow([0, 0, 0], [0, 1, 0], axisLenAU, AXIS_Y_COLOR, "Y");
    drawWorldArrow([0, 0, 0], [0, 0, 1], axisLenAU, AXIS_Z_COLOR, "Z (ecliptic north)");

    drawWorldArrow([0, 0, 0], GALACTIC_MOTION_DIR_ECLIPTIC, axisLenAU, "#e8c15a", "Solar system's motion around the galactic center (~220 km/s)");
  }

  // Generic satellite position relative to its primary: returns the
  // satellite's offset FROM ITS PRIMARY (not an absolute position), in AU,
  // plus its own local orbital elements for display. Used for the Moon
  // (relative to Earth) and for Phobos/Deimos (relative to Mars). Distinct
  // from computeStateVector because these bodies' primary is a planet, not
  // the Sun, and because in the Moon's case its node/perigee precess fast
  // enough (18.61 yr / 8.85 yr) to model explicitly. nodalPeriodDays and
  // apsidalPeriodDays are optional; if omitted, Om and w are held fixed at
  // their epoch values (used for Phobos/Deimos, where the real precession
  // wobble is negligible at this orbital scale -- see comment above their
  // element definitions).
  function computeSatelliteOffset(elements, daysSinceEpoch) {
    const a = elements.aKm;
    const e = elements.e;
    const i = elements.iDeg * D2R;

    const Om = elements.nodalPeriodDays
      ? (elements.OmDeg0 - 360 * (daysSinceEpoch / elements.nodalPeriodDays)) * D2R
      : elements.OmDeg0 * D2R;
    const w = elements.apsidalPeriodDays
      ? (elements.wDeg0 + 360 * (daysSinceEpoch / elements.apsidalPeriodDays)) * D2R
      : elements.wDeg0 * D2R;

    const n = 2 * Math.PI / elements.periodSiderealDays; // rad/day
    const M = (elements.M0Deg * D2R) + n * daysSinceEpoch;

    const E = solveKepler(M, e);
    const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
    const r = a * (1 - e * Math.cos(E)); // km

    const xOrb = r * Math.cos(nu);
    const yOrb = r * Math.sin(nu);

    const Edot = n / (1 - e * Math.cos(E));
    const xOrbDot = -a * Math.sin(E) * Edot;
    const yOrbDot = a * Math.sqrt(1 - e * e) * Math.cos(E) * Edot;

    const cosOm = Math.cos(Om), sinOm = Math.sin(Om);
    const cosW = Math.cos(w), sinW = Math.sin(w);
    const cosI = Math.cos(i), sinI = Math.sin(i);

    function rotate(x, y) {
      const xw = x * cosW - y * sinW;
      const yw = x * sinW + y * cosW;
      const xi = xw;
      const yi = yw * cosI;
      const zi = yw * sinI;
      const X = xi * cosOm - yi * sinOm;
      const Y = xi * sinOm + yi * cosOm;
      const Z = zi;
      return [X, Y, Z];
    }

    const posKm = rotate(xOrb, yOrb);
    const velKmDay = rotate(xOrbDot, yOrbDot);

    // Convert to AU / (AU/day) so it composes directly with the primary's
    // already-AU-scale heliocentric position and velocity.
    const posAU = posKm.map((v) => v / AU_KM);
    const velAU = velKmDay.map((v) => v / AU_KM);

    return { posAU, velAU, rKm: r, a, e, i, Om, w, M, nu };
  }

  /* =========================================================================
     SCENE / RENDER STATE
  ========================================================================= */

  const canvas = document.getElementById("scene");
  const ctx = canvas.getContext("2d");

  let dpr = window.devicePixelRatio || 1;
  let viewW = 0, viewH = 0;

  // Single source of truth for "are we in the mobile layout" -- several
  // things this drives (the locked panel's bottom-sheet positioning in
  // drawLockedPanelConnector, the canvas tap hit-radius, the zoom-hint
  // text) are computed in JS, not just styled, so a CSS media query alone
  // can't express them. body.mobile lets CSS key off the same flag rather
  // than maintaining a second, separately-tuned breakpoint there.
  // (pointer: coarse) alone would also catch a touch-capable laptop with
  // a big screen, hence the width clause on both branches.
  let isMobileLayout = false;
  // The locked panel specifically needs a second axis: portrait mobile
  // (tall and narrow) has room to spare vertically but not horizontally,
  // so a bottom sheet makes sense; landscape mobile (short and wide,
  // e.g. a phone rotated) is the opposite -- a bottom sheet there would
  // eat most of the already-scarce vertical space, where a docked
  // sidebar (like desktop's panel, but fixed rather than floating) uses
  // the surplus width instead. Only meaningful when isMobileLayout is
  // also true -- a landscape *desktop* window doesn't get sidebar mode.
  let isLandscapeMobile = false;
  // The coarse-pointer clause's max-width used to be 1024px, which
  // excludes iPad Air LANDSCAPE (~1180-1194px wide, real device
  // dimensions) entirely -- portrait iPad Air (820px) matched via the
  // first clause, but rotating it, the panel would have silently fallen
  // back to desktop's floating-panel behavior instead of the mobile
  // full-screen modal. Widened to comfortably cover landscape tablet
  // widths generally (up to iPad Pro 12.9" landscape, ~1366px).
  const MOBILE_LAYOUT_QUERY = "(max-width: 820px), (pointer: coarse) and (max-width: 1366px)";

  // Moves the actual #camera-controls DOM node into the speed row on
  // mobile (folding "Reset view"/"Stop tracking" into the same row as the
  // speed controls, freeing up the vertical space its own separate
  // stacked block used to need), and back to its original spot -- right
  // before #zoom-hint, its markup position in index.html -- on desktop.
  // NOT done with CSS alone: .panel's backdrop-filter creates a new
  // containing block for position:fixed descendants (a real, easy-to-miss
  // CSS gotcha, not specific to this file), so simply nesting
  // #camera-controls inside #time-panel (also a .panel) in the markup
  // broke its desktop position -- position:fixed started resolving
  // against that small panel instead of the viewport. Actually moving the
  // node keeps desktop's copy outside any .panel-classed ancestor, same
  // as it always was, while still letting mobile achieve genuine flex-row
  // membership (needs to be a literal DOM child of the row to participate
  // in its layout at all -- display:contents on #camera-controls itself,
  // see its own CSS, makes its two buttons join that row directly once
  // it's actually there).
  const cameraControlsEl = document.getElementById("camera-controls");
  const speedRowEl = document.getElementById("speed-row");
  const zoomHintEl = document.getElementById("zoom-hint");
  function relocateCameraControls() {
    if (isMobileLayout) {
      if (cameraControlsEl.parentElement !== speedRowEl) speedRowEl.appendChild(cameraControlsEl);
    } else if (cameraControlsEl.parentElement !== zoomHintEl.parentElement || cameraControlsEl.nextElementSibling !== zoomHintEl) {
      zoomHintEl.parentElement.insertBefore(cameraControlsEl, zoomHintEl);
    }
  }

  function updateMobileLayoutMode() {
    isMobileLayout = window.matchMedia(MOBILE_LAYOUT_QUERY).matches;
    isLandscapeMobile = isMobileLayout && window.matchMedia("(orientation: landscape)").matches;
    document.body.classList.toggle("mobile", isMobileLayout);
    document.body.classList.toggle("landscape", isLandscapeMobile);
    relocateCameraControls();
  }

  function resize() {
    dpr = window.devicePixelRatio || 1;
    viewW = window.innerWidth;
    viewH = window.innerHeight;
    canvas.width = Math.round(viewW * dpr);
    canvas.height = Math.round(viewH * dpr);
    canvas.style.width = viewW + "px";
    canvas.style.height = viewH + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    updateMobileLayoutMode();
  }
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", resize);
  resize();

  /* =========================================================================
     CAMERA: true 3D orbit camera.
     - yaw / pitch define a rotation applied to every world point before
       projection, so the 3rd axis (out of the ecliptic plane) is a real,
       inspectable rotation, not a cosmetic tilt.
     - pan is a screen-space offset applied after projection.
     - zoom is pixels-per-AU, applied after rotation, before pan.
     Projection is a simple orthographic projection (no perspective
     foreshortening) — appropriate here since the goal is accurate spatial
     reading of relative positions, not a photographic camera; perspective
     would distort apparent distances between bodies depending on depth,
     which would work against the "read positions accurately" goal.
  ========================================================================= */

  const DEFAULT_PX_PER_AU = 70;
  const DEFAULT_YAW = 0;
  const DEFAULT_PITCH = -0.45; // start tilted so 3D is visible immediately

  let pxPerAU = DEFAULT_PX_PER_AU;
  let camX = 0, camY = 0;       // pan offset (screen px), applied after projection
  let yaw = DEFAULT_YAW;        // rotation around the vertical (screen Y) axis, radians
  let pitch = DEFAULT_PITCH;    // rotation around horizontal (screen X) axis, radians

  // Declared here (rather than down near the hover/click-lock section
  // where it's most heavily used) because buildLegend() -- called once at
  // load time, below -- calls isSatelliteVisible(), which reads
  // lockedBodyName. Since it's declared with `let`, reading it before
  // this line would execute hits JavaScript's temporal dead zone and
  // throws, so it must be declared before any load-time code path can
  // reach it. selectedFlightKey is declared here for the identical
  // reason: buildFlightsLegend() also runs once at load time and reads it.
  let lockedBodyName = null;
  // Separate from lockedBodyName: camera tracking and the info PANEL's own
  // visibility used to be the same thing (lockedBodyName null <-> panel
  // hidden), so closing the panel also dropped tracking -- especially bad
  // on mobile, where the panel is a full-screen modal covering the whole
  // scene, so "close it to see the animation again" also meant "lose your
  // target." Now lockedBodyName alone drives tracking/highlight/camera-
  // follow; infoPanelVisible alone drives whether the panel is shown.
  // lockBody/selectFlight open it for a NEWLY chosen target; the panel's
  // own close button (and toggling the same target off) close it without
  // touching lockedBodyName; stopTrackingBtn -> lockBody(null) is the only
  // way to actually stop tracking.
  let infoPanelVisible = false;
  // "auto" (default): selecting a flight opens its info panel immediately,
  // same as every lockBody caller. "manual": selecting a flight leaves the
  // panel closed -- just the path/scrubber -- so re-verifying a bunch of
  // flights in a row doesn't mean closing the panel after every single
  // click. Only gates flight selection's OWN auto-open (see lockBody's
  // opts.respectInfoBoxMode); a plain body/moon lock always opens its
  // panel regardless, since a body has no alternative "just show the path"
  // view the way a flight's scrubber gives it. The scrubber title/button's
  // own reopen action (reopenFlightInfoPanel) deliberately does NOT check
  // this -- it's an explicit "open it now" click, not an automatic one.
  let infoBoxMode = "auto"; // "auto" | "manual"
  let selectedFlightKey = null;
  let renderedBodies = []; // populated each frame: {name, sx, sy, screenR, pos, vel, ...}
  // Populated each frame alongside renderedBodies, from the exact screen
  // points each orbit/arc-drawing function already computes (see e.g.
  // drawOrbitEllipse's `return points`) -- reused for click/hover
  // hit-testing (hitTestPaths) so a path's clickable geometry always
  // matches its drawn geometry exactly, at no extra sampling cost.
  // Entry shape: { name, flightKey, color, segments: [[[x,y],...], ...] }
  let renderedPaths = [];
  // The path currently under the pointer (desktop hover, or a brief touch
  // preview -- see handleHover/canvas touchstart), redrawn with a wider
  // translucent glow each frame so the user can see, before clicking,
  // exactly which single path is about to be selected -- the mechanism
  // that actually resolves crossing/overlapping orbits, rather than any
  // kind of "layers" picker. Null when the pointer isn't near any path.
  let hoveredPathEntry = null;

  // Whether syncPauseWithLockedPanel (see near setPaused) auto-paused
  // playback when the panel most recently opened -- so closing it knows
  // whether to resume (it was actually playing) or leave things alone
  // (it was already paused for some other reason, e.g. manually).
  let autoPausedOnLock = false;
  // Same idea, but for a flight-scrubber drag (see the FLIGHT SCRUBBER
  // section below) -- kept as its own flag rather than reusing
  // autoPausedOnLock, since the two auto-pauses can overlap (e.g. closing
  // the locked panel mid-drag, or ending a drag while the panel happens to
  // be open) and either one resuming unconditionally could yank playback
  // out from under the other. See maybeResumeFromAutoPause.
  let scrubberAutoPaused = false;

  // "broad" (default): a flight/small body shows whenever it's genuinely
  // in transit right now, independent of selection -- lets you casually
  // watch whatever's happening at the current date. "focused": suppress
  // that entirely -- show ONLY the currently selected flight's own
  // path(s), or (if a body/small body is locked instead) only the
  // flights that actually target it, hiding every other flight/body in
  // transit right now regardless of date. Read by isFlightVisible and
  // isSmallBodyVisible below.
  let sceneVisibilityMode = "broad"; // "broad" | "focused"
  // Only meaningful (and only shown in the UI) while a flight is selected:
  // "full" draws the whole path as today; "current" draws just the one
  // 360-degree orbit the spacecraft is presently on (see
  // getCurrentOrbitElements/drawCurrentOrbitEllipse).
  let orbitViewMode = "full"; // "full" | "current"
  // "Hold frame": normally, locking onto a body force-overwrites camX/camY
  // every frame so it stays centered (see the camera-follow block in
  // frame()), and manual panning is disabled while locked for the same
  // reason (see dragButtonIsPan's mousedown handler and the two-finger
  // touchmove handler). When true, that force-follow is skipped entirely
  // and manual panning re-enabled even while a body is locked -- lets the
  // camera hold a fixed, deliberately-chosen framing regardless of what's
  // tracked or how the scene evolves, which is what a specific shot (a
  // screenshot, a scripted capture, an eventual embed) actually needs
  // instead of the camera constantly recentering on a moving target.
  let freeCameraMode = false;
  // Whether the Scene Framing readout (below) is currently shown --
  // independent of freeCameraMode itself; you can check the numbers
  // without hold-frame on, or hold a frame without the readout open.
  let sceneFramingVisible = false;

  // Whether the full-viewport dashboard (velocity hodograph, first of
  // eventually several widgets) is currently shown for whatever's
  // locked/selected -- see openDashboard/closeDashboard near the locked-
  // panel wiring below.
  let dashboardVisible = false;
  // Which reference frame the PRIMARY hodograph widget draws -- 'default'
  // (Sol, or whatever influenceBody the leg resolves to) or a toggled
  // alternate for a body-orbit leg (geocentric_orbit; see the toggle UI
  // near drawHodograph). The second widget (flyby SOI transit) never uses
  // this -- it's fully derived from daysSinceEpoch each frame instead,
  // since a toggle would force picking one view during the one moment
  // comparing both is the interesting part. Reset on close so a stale
  // choice from one flight doesn't leak into the next.
  let hodographFrameKey = 'default';

  // Absolute screen position of the locked panel -- set once when a new
  // body/flight is locked (see drawLockedPanelConnector's edge-detection),
  // and otherwise only ever changed by the user dragging the header (see
  // those mousedown/mousemove/mouseup handlers). null while nothing is
  // locked. Deliberately NOT re-derived from the tracked body's on-screen
  // position every frame -- see drawLockedPanelConnector's top comment.
  let lockedPanelPos = null;

  const MAX_PITCH = Math.PI / 2 - 0.02;
  const MIN_PITCH = -(Math.PI / 2 - 0.02);

  let isRotating = false;
  let isPanning = false;
  let dragStartX = 0, dragStartY = 0;
  let camStartX = 0, camStartY = 0;
  let yawStart = 0, pitchStart = 0;

  function dragButtonIsPan(e) {
    // Right mouse button, or left+shift, pans. Plain left drag rotates.
    return e.button === 2 || e.shiftKey;
  }

  // Auto-enables free-camera ("Hold camera frame") mode the moment the
  // user manually pans while a body is tracked and it's currently off --
  // see freeCameraMode's own comment. Panning used to just be silently
  // blocked in that case (any offset would be overwritten by the
  // camera-follow block on the very next frame anyway), rather than doing
  // what dragging the screen obviously means: "let me move the view
  // myself now." Does exactly what clicking the toggle switch itself
  // does, just triggered by the drag gesture instead of requiring the
  // user to find and click a switch first. Deliberately NOT triggered by
  // rotating (yaw/pitch) -- rotating while tracked already works fine
  // without this (the follow block only ever touches camX/camY, so
  // there's nothing fighting it), and orbiting the camera around a
  // still-centered tracked body is itself a nice, expected way to look at
  // it from different angles.
  function enableFreeCameraFromPan() {
    if (freeCameraMode) return;
    freeCameraMode = true;
    freeCameraSwitch.classList.toggle("on", true);
    updateURLParams({ hold: "1" });
  }

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  canvas.addEventListener("mousedown", (e) => {
    dragStartX = e.clientX; dragStartY = e.clientY;
    if (dragButtonIsPan(e)) {
      if (lockedBodyName && !freeCameraMode) enableFreeCameraFromPan();
      isPanning = true;
      camStartX = camX; camStartY = camY;
    } else {
      isRotating = true;
      yawStart = yaw; pitchStart = pitch;
    }
  });
  window.addEventListener("mousemove", (e) => {
    if (isRotating) {
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      yaw = yawStart + dx * 0.006;
      pitch = pitchStart - dy * 0.006;
      pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, pitch));
    } else if (isPanning) {
      camX = camStartX + (e.clientX - dragStartX);
      camY = camStartY + (e.clientY - dragStartY);
    }
    handleHover(e);
  });
  window.addEventListener("mouseup", () => { isRotating = false; isPanning = false; });

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const zoomFactor = Math.exp(-e.deltaY * 0.0012);
    pxPerAU *= zoomFactor;
    pxPerAU = Math.max(2, Math.min(pxPerAU, 20000));
  }, { passive: false });

  // Touch support: one finger rotates, two fingers pinch-zoom + pan.
  let touchStartDist = null;
  let touchStartPxPerAU = null;
  let touchMidStartX = 0, touchMidStartY = 0;
  canvas.addEventListener("touchstart", (e) => {
    if (e.touches.length === 1) {
      isRotating = true; isPanning = false;
      dragStartX = e.touches[0].clientX; dragStartY = e.touches[0].clientY;
      yawStart = yaw; pitchStart = pitch;
    } else if (e.touches.length === 2) {
      isRotating = false;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      touchStartDist = Math.hypot(dx, dy);
      touchStartPxPerAU = pxPerAU;
      touchMidStartX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      touchMidStartY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      camStartX = camX; camStartY = camY;
    }
  }, { passive: true });
  canvas.addEventListener("touchmove", (e) => {
    if (e.touches.length === 1 && isRotating) {
      const dx = e.touches[0].clientX - dragStartX;
      const dy = e.touches[0].clientY - dragStartY;
      yaw = yawStart + dx * 0.006;
      pitch = pitchStart - dy * 0.006;
      pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, pitch));
    } else if (e.touches.length === 2 && touchStartDist) {
      // Two-finger pan+zoom. See enableFreeCameraFromPan's own comment --
      // a pan gesture while tracking auto-enables hold-frame instead of
      // being silently absorbed by the camera-follow block re-centering
      // on the very next frame. Zoom (pxPerAU) always applies either way.
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      pxPerAU = Math.max(2, Math.min(20000, touchStartPxPerAU * (dist / touchStartDist)));
      if (lockedBodyName && !freeCameraMode) enableFreeCameraFromPan();
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      camX = camStartX + (midX - touchMidStartX);
      camY = camStartY + (midY - touchMidStartY);
    }
  }, { passive: true });
  canvas.addEventListener("touchend", () => { isRotating = false; isPanning = false; touchStartDist = null; });

  // Rotate a world point (AU, ecliptic frame: x,y in-plane, z out-of-plane)
  // by yaw (about the world Z axis, spinning the system "in place" as seen
  // from above) then pitch (about the resulting X axis, tilting the whole
  // system toward/away from the viewer to reveal the 3rd dimension).
  function rotateWorld(x, y, z) {
    const cosYaw = Math.cos(yaw), sinYaw = Math.sin(yaw);
    const x1 = x * cosYaw - y * sinYaw;
    const y1 = x * sinYaw + y * cosYaw;
    const z1 = z;

    const cosPitch = Math.cos(pitch), sinPitch = Math.sin(pitch);
    const y2 = y1 * cosPitch - z1 * sinPitch;
    const z2 = y1 * sinPitch + z1 * cosPitch;

    return [x1, y2, z2];
  }

  function worldToScreen(xAU, yAU, zAU) {
    const [rx, ry, rz] = rotateWorld(xAU, yAU, zAU || 0);
    const cx = viewW / 2 + camX;
    const cy = viewH / 2 + camY;
    return [cx + rx * pxPerAU, cy - ry * pxPerAU, rz];
  }

  /* =========================================================================
     TIME STATE
     Simulation date is tracked as a JS Date (UTC). Default real-time mapping
     requested: 1 Earth year of simulated time per 1 minute of wall-clock time
     at "speed = 1x". The speed slider scales this rate, and can go negative
     to run time backwards. Speed = 0 pauses.
  ========================================================================= */

  const EARTH_YEAR_DAYS = 365.25;
  const BASE_DAYS_PER_MS = EARTH_YEAR_DAYS / (60 * 1000); // 1 yr per 60,000 ms at 1x

  let simDate = new Date(); // current simulated UTC date
  let speedMultiplier = 1.0; // can be negative; 0 = paused (but we use separate pause flag)
  let paused = false;
  let lastFrameTime = performance.now();

  function setSimDateFromInputValue(value) {
    // value is "YYYY-MM-DD"; interpret as UTC midday to avoid TZ edge issues
    const parts = value.split("-").map(Number);
    const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0));
    simDate = d;
  }

  function dateInputValue(date) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    const d = String(date.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  const dateInput = document.getElementById("date-input");
  dateInput.value = dateInputValue(simDate);

  const editDateBtn = document.getElementById("edit-date-btn");
  const applyDateBtn = document.getElementById("apply-date");
  const cancelEditDateBtn = document.getElementById("cancel-edit-date-btn");

  applyDateBtn.addEventListener("click", () => {
    if (dateInput.value) {
      setSimDateFromInputValue(dateInput.value);
      updateURLParams({ date: dateInput.value });
    }
  });
  document.getElementById("reset-today").addEventListener("click", () => {
    simDate = new Date();
    dateInput.value = dateInputValue(simDate);
    // "Today" means "always-current," not a specific moment worth
    // pinning -- clear rather than write today's date into the URL.
    updateURLParams({ date: null });
  });
  editDateBtn.addEventListener("click", () => {
    setPaused(true); // also flips dateInput to editable and swaps button visibility, see setPaused
    dateInput.focus();
  });
  cancelEditDateBtn.addEventListener("click", () => {
    // Discard whatever the user may have typed (without clicking "Go to
    // date") by restoring the field to the actual current simDate, then
    // resume -- this is "cancel," not "apply," so simDate itself is left
    // untouched.
    dateInput.value = dateInputValue(simDate);
    setPaused(false);
  });

  const speedSlider = document.getElementById("speed-slider");
  const speedField = document.getElementById("speed-field");
  const speedEdit = document.getElementById("speed-edit");
  const speedGoBtn = document.getElementById("speed-go-btn");
  const playPauseBtn = document.getElementById("playpause");

  // Bare signed number, no "yr/min" suffix -- what the edit input itself
  // shows while being typed into.
  function formatSpeedBare(mult) {
    const sign = mult < 0 ? "-" : "";
    const abs = Math.abs(mult);
    const valueStr = abs >= 1 ? (Math.round(abs * 10) / 10).toString() : (Math.round(abs * 100) / 100).toString();
    return sign + valueStr;
  }

  // "N yr/min" -- years of simulated time per real minute. Used to show
  // two separate "Nx"/"N (yr/min)" chips (this app defines a year as
  // exactly 365.25 days, so an "x" multiplier and a yr/min rate were
  // always the same number anyway); simplified to just the one label
  // directly describing what the number means.
  function refreshSpeedField() {
    speedField.textContent = `${formatSpeedBare(speedMultiplier)} yr/min`;
  }

  // Slider position <-> speedMultiplier is the same squared curve both
  // directions -- kept as one pair of functions so typing a value and
  // dragging the slider can never drift out of sync with each other.
  function sliderValueForMultiplier(mult) {
    const sign = mult < 0 ? -1 : 1;
    return sign * Math.sqrt(Math.abs(mult)) * 100;
  }

  function updateSpeedFromSlider() {
    // slider range -300..300 maps to multiplier via a curve giving fine
    // control near 0 and large range at extremes: mult = sign * (|v|/100)^2
    const v = Number(speedSlider.value);
    const sign = v < 0 ? -1 : 1;
    const norm = Math.abs(v) / 100; // 0..3
    speedMultiplier = sign * norm * norm; // 0..9, squared for fine low-end control
    refreshSpeedField();
  }
  speedSlider.addEventListener("input", updateSpeedFromSlider);
  updateSpeedFromSlider();

  // Click-to-edit speed: clicking the "N yr/min" chip swaps it for a small
  // text input (pre-filled, focused, selected) plus a Go button. Typed
  // input accepts a bare number, an optional leading "-", and tolerates a
  // trailing "yr/min"/"x" being typed and ignored (parsed and thrown away).
  //
  // Deliberately Go/Enter-only for APPLYING a value -- blur alone cancels
  // back to the current speed without applying. An earlier design
  // auto-applied on blur, which raced with whatever OTHER click had just
  // stolen focus (blur fires before that element's own click handler): e.g.
  // clicking Play while paused first blurred the field, whose blur handler
  // called setPaused(false) to resume at the new speed, and THEN Play's own
  // click handler ran setPaused(!paused) against the now-stale pre-blur
  // "paused" value and immediately re-paused it -- needing a second Play
  // click to actually take effect. An explicit, blur-independent commit
  // (Go or Enter) has no such race: nothing else's click handler can run
  // between a Go/Enter keypress and this function.
  let speedEditing = false;
  let speedFieldsDisabled = false; // see setDemoControlsDisabled

  function startSpeedEdit() {
    if (speedFieldsDisabled) return;
    speedEditing = true;
    speedField.style.display = "none";
    speedEdit.value = formatSpeedBare(speedMultiplier);
    speedEdit.classList.add("visible");
    speedEdit.focus();
    speedEdit.select();
    speedGoBtn.classList.add("visible");
  }

  function endSpeedEdit(apply) {
    if (!speedEditing) return;
    if (apply) {
      const raw = speedEdit.value.trim().toLowerCase().replace(/\s*(yr\/min|x)\s*$/, "");
      const parsed = Number(raw);
      // Unlike the slider (mechanically capped at -300..300, i.e.
      // |mult|<=9), a typed value isn't clamped -- only the slider's own
      // thumb position is, since typing doesn't have the slider's
      // drag-precision reason for a cap.
      if (raw !== "" && Number.isFinite(parsed)) {
        speedMultiplier = parsed;
        speedSlider.value = Math.max(-300, Math.min(300, sliderValueForMultiplier(speedMultiplier)));
        if (paused && speedMultiplier !== 0) setPaused(false);
      }
    }
    speedEdit.classList.remove("visible");
    speedField.style.display = "";
    speedGoBtn.classList.remove("visible");
    speedEditing = false;
    refreshSpeedField();
  }

  speedField.addEventListener("click", startSpeedEdit);
  speedGoBtn.addEventListener("click", () => endSpeedEdit(true));
  speedEdit.addEventListener("keydown", (e) => {
    if (e.key === "Enter") endSpeedEdit(true);
    else if (e.key === "Escape") endSpeedEdit(false);
  });
  // Click anywhere else (Play, the slider, the canvas, another panel...)
  // cancels an in-progress edit rather than leaving its input stuck open
  // forever -- without this, only Go/Enter/Escape ever closed it, and any
  // other click (e.g. Play) had no idea speed-editing state existed at all.
  document.addEventListener("click", (e) => {
    if (!speedEditing) return;
    if (e.target === speedField || e.target === speedEdit || e.target === speedGoBtn) return;
    endSpeedEdit(false);
  });

  function setPaused(value) {
    paused = value;
    playPauseBtn.textContent = paused ? "Play" : "Pause";
    // The date field is only safely editable while paused: frame() only
    // overwrites dateInput.value when NOT paused, so editing while running
    // would otherwise get stomped on the very next frame. Locking the
    // field to readonly when running makes that constraint visible rather
    // than something the user discovers by losing their typed input.
    dateInput.readOnly = !paused;
    dateInput.classList.toggle("editable", paused);
    // Button visibility tracks the SAME paused flag (rather than a
    // separate "editing" flag) since the field's actual editability is
    // already tied to paused -- keeping one flag as the source of truth
    // means the buttons can't show a state the field doesn't actually
    // support, regardless of how pausing was triggered (the Edit button,
    // the main Pause/Play control, or the spacebar shortcut).
    editDateBtn.style.display = paused ? "none" : "";
    applyDateBtn.style.display = paused ? "" : "none";
    cancelEditDateBtn.style.display = paused ? "" : "none";
  }
  setPaused(paused); // explicit initial sync, rather than relying on the
                      // HTML "readonly" attribute happening to match
                      // paused's default JS value

  // Reading "Why it matters"/Notes/an image gallery while bodies keep
  // drifting past defeats the point of a detail panel -- opening one
  // auto-pauses playback, closing it resumes ONLY if playback was
  // actually running before (not already paused for some other reason,
  // and not un-paused just because a SECOND lock happened to replace a
  // first one -- see the two "false <-> true transition only" guards
  // below). Keyed off infoPanelVisible (the panel's own shown/hidden
  // state), NOT lockedBodyName (camera tracking) -- since closing the
  // panel no longer drops tracking (see infoPanelVisible's own comment),
  // auto-pause/resume needs to follow whether you're actually LOOKING at
  // the panel, not whether a body happens to be tracked. Called from
  // every place infoPanelVisible changes: lockBody, selectFlight's own
  // deselect path, and the panel's close button -- all three mutate it
  // directly rather than funneling through one setter, so this needs to
  // be invoked from each rather than being able to live inside a single
  // infoPanelVisible= assignment.
  function syncPauseWithLockedPanel(prevPanelVisible, newPanelVisible) {
    if (!prevPanelVisible && newPanelVisible) {
      if (!paused) {
        autoPausedOnLock = true;
        setPaused(true);
      }
    } else if (prevPanelVisible && !newPanelVisible) {
      if (autoPausedOnLock) {
        autoPausedOnLock = false;
        maybeResumeFromAutoPause();
      }
    }
  }

  // Shared resume gate for the two independent auto-pause mechanisms
  // (locked-panel-open and flight-scrubber-drag) -- only actually resumes
  // once NEITHER thinks it's the one holding playback paused, so closing
  // the locked panel mid-scrubber-drag (or releasing a drag while the
  // panel happens to be open) can't yank playback out from under whichever
  // mechanism is still active.
  function maybeResumeFromAutoPause() {
    if (!autoPausedOnLock && !scrubberAutoPaused) setPaused(false);
  }

  document.getElementById("reset-speed").addEventListener("click", () => {
    speedSlider.value = 100;
    updateSpeedFromSlider();
    if (paused) setPaused(false);
  });

  playPauseBtn.addEventListener("click", () => {
    setPaused(!paused);
  });

  // Keyboard shortcuts: space = play/pause, arrows nudge speed
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      e.preventDefault();
      setPaused(!paused);
    }
    // Backtick: toggle the Scene Framing readout. Not in the same
    // conditional as Space above since it's unrelated to play/pause and
    // needs its own guard (skip while the user is actually typing into a
    // text field, e.g. the speed input or an editable date field, where a
    // literal "`" character should just be typed, not treated as a
    // shortcut).
    if (e.key === "`" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
      e.preventDefault();
      sceneFramingVisible = !sceneFramingVisible;
      sceneFramingPanel.classList.toggle("visible", sceneFramingVisible);
      if (sceneFramingVisible) updateSceneFramingPanel();
    }
  });

  /* =========================================================================
     SCENE FRAMING
     Live readout of the camera state (zoom/rotation/pan/tracking/date) --
     toggled via the backtick key (see keydown handler above), independent
     of freeCameraMode ("Hold camera frame" toggle) itself. Exists so a
     specific shot can be manually found and noted down/reproduced, e.g.
     for a screenshot or a scripted capture.
  ========================================================================= */
  const sceneFramingPanel = document.getElementById("scene-framing-panel");
  const sceneFramingReadout = document.getElementById("scene-framing-readout");
  const sceneFramingCopyBtn = document.getElementById("scene-framing-copy");

  // Cheap (just .textContent), called once per frame from frame() while
  // the panel is visible -- gated on sceneFramingVisible there so it costs
  // nothing while hidden, same convention updateFlightScrubberPlayhead
  // already uses for its own cheap per-frame update.
  function updateSceneFramingPanel() {
    const yawDeg = (yaw * 180 / Math.PI).toFixed(1);
    const pitchDeg = (pitch * 180 / Math.PI).toFixed(1);
    sceneFramingReadout.textContent =
      `zoom (pxPerAU): ${pxPerAU.toFixed(1)}\n` +
      `yaw / pitch (deg): ${yawDeg} / ${pitchDeg}\n` +
      `pan (camX, camY): ${camX.toFixed(0)}, ${camY.toFixed(0)}` +
        (lockedBodyName && !freeCameraMode ? "  [not meaningful while tracking]" : "") + `\n` +
      `tracking: ${lockedBodyName || "none"}\n` +
      `hold frame: ${freeCameraMode ? "on" : "off"}\n` +
      `date: ${dateInputValue(simDate)}`;
  }

  sceneFramingCopyBtn.addEventListener("click", () => {
    const yawDeg = (yaw * 180 / Math.PI).toFixed(2);
    const pitchDeg = (pitch * 180 / Math.PI).toFixed(2);
    // URL-fragment form (not the full readout text) -- directly usable as
    // query params, e.g. pasted onto the end of this page's own URL, or
    // (once embedding exists) an embed src. Only includes what's actually
    // reproducible: zoom/yaw/pitch/hold always are; camX/camY are omitted
    // since they're meaningless while tracking (the common case) and get
    // overwritten by camera-follow anyway unless hold=1.
    const params = `zoom=${pxPerAU.toFixed(1)}&yaw=${yawDeg}&pitch=${pitchDeg}` +
      (freeCameraMode ? `&hold=1` : ``);
    navigator.clipboard.writeText(params).catch(() => {}); // clipboard access can be denied; failing silently is fine for a copy-convenience button
  });

  /* =========================================================================
     SIZE COMPARISON TOGGLE
  ========================================================================= */

  let showTrueSizes = false;
  const sizeSwitch = document.getElementById("size-switch");
  const sizeToggleLabel = document.getElementById("size-toggle-label");
  const sizeComparePanel = document.getElementById("size-compare-panel");
  const sizeRow = document.getElementById("size-row");

  function buildSizeComparePanel() {
    sizeRow.innerHTML = "";
    const maxRadius = SUN_RADIUS_KM;
    const maxPx = 80; // sun gets 80px diameter-equivalent radius in this mini chart

    function addItem(name, radiusKm, color) {
      const r = Math.max(1, (radiusKm / maxRadius) * maxPx);
      const wrap = document.createElement("div");
      wrap.className = "size-item";
      const circle = document.createElement("div");
      circle.className = "size-circle";
      circle.style.width = (r * 2) + "px";
      circle.style.height = (r * 2) + "px";
      circle.style.background = color;
      const label = document.createElement("div");
      label.className = "size-label";
      const pct = (radiusKm / maxRadius) * 100;
      label.textContent = `${name} (${pct < 1 ? pct.toFixed(2) : pct.toFixed(1)}%)`;
      wrap.appendChild(circle);
      wrap.appendChild(label);
      sizeRow.appendChild(wrap);
    }

    addItem("Sol", SUN_RADIUS_KM, SUN_COLOR);
    PLANET_ORDER.forEach((name) => {
      addItem(name, PLANET_META[name].radiusKm, PLANET_META[name].color);
    });
  }
  buildSizeComparePanel();

  sizeToggleLabel.addEventListener("click", () => {
    showTrueSizes = !showTrueSizes;
    sizeSwitch.classList.toggle("on", showTrueSizes);
    sizeComparePanel.classList.toggle("visible", showTrueSizes);
  });

  /* =========================================================================
     BROAD / FOCUSED SCENE VISIBILITY TOGGLE
     sceneVisibilityMode itself is declared up near lockedBodyName/
     selectedFlightKey (same load-time-read reasoning) -- this just wires
     the switch to it. See isFlightVisible/isSmallBodyVisible for what the
     mode actually changes.
  ========================================================================= */

  const focusSwitch = document.getElementById("focus-switch");
  const focusToggleLabel = document.getElementById("focus-toggle-label");
  focusToggleLabel.addEventListener("click", () => {
    sceneVisibilityMode = sceneVisibilityMode === "broad" ? "focused" : "broad";
    focusSwitch.classList.toggle("on", sceneVisibilityMode === "focused");
    // "broad" is the default -- omit the param entirely rather than
    // writing focus=broad, so a plain visit keeps a clean bare URL.
    updateURLParams({ focus: sceneVisibilityMode === "focused" ? "focused" : null });
  });

  // Only meaningful with a mission selected (see orbitViewMode's own
  // comment); visibility is kept in sync from buildFlightsLegend, the one
  // central place selectedFlightKey actually changes.
  const orbitViewSwitch = document.getElementById("orbit-view-switch");
  const orbitViewToggleLabel = document.getElementById("orbit-view-toggle-label");
  orbitViewToggleLabel.addEventListener("click", () => {
    orbitViewMode = orbitViewMode === "full" ? "current" : "full";
    orbitViewSwitch.classList.toggle("on", orbitViewMode === "current");
  });

  const infoBoxSwitch = document.getElementById("infobox-switch");
  const infoBoxToggleLabel = document.getElementById("infobox-toggle-label");
  infoBoxToggleLabel.addEventListener("click", () => {
    infoBoxMode = infoBoxMode === "auto" ? "manual" : "auto";
    infoBoxSwitch.classList.toggle("on", infoBoxMode === "manual");
    // "auto" is the default -- omit the param entirely, same reasoning as
    // the focus toggle just above.
    updateURLParams({ info: infoBoxMode === "manual" ? "manual" : null });
    updateScrubberInfoButton();
  });

  const freeCameraSwitch = document.getElementById("free-camera-switch");
  const freeCameraToggleLabel = document.getElementById("free-camera-toggle-label");
  freeCameraToggleLabel.addEventListener("click", () => {
    freeCameraMode = !freeCameraMode;
    freeCameraSwitch.classList.toggle("on", freeCameraMode);
    // "off" is the default -- omit the param entirely, same reasoning as
    // the other toggles above.
    updateURLParams({ hold: freeCameraMode ? "1" : null });
  });

  /* =========================================================================
     LEGEND DRAWER (mobile only -- see body.mobile rules in style.css)
     Desktop keeps the legend as an always-visible floating panel; on
     mobile it's a slide-out drawer instead, open/close driven by a
     single "drawer-open" class on <body>.
  ========================================================================= */

  const legendDrawerToggle = document.getElementById("legend-drawer-toggle");
  const legendBackdrop = document.getElementById("legend-backdrop");
  legendDrawerToggle.addEventListener("click", () => {
    document.body.classList.add("drawer-open");
  });
  legendBackdrop.addEventListener("click", () => {
    document.body.classList.remove("drawer-open");
  });

  // #scale-toggle-panel's mobile-collapsed form (see body.mobile rules in
  // style.css) -- lighter-weight than the legend drawer above: no
  // backdrop, the gear button itself stays visible and clicking it again
  // is how you close it.
  const settingsDrawerToggle = document.getElementById("settings-drawer-toggle");
  settingsDrawerToggle.addEventListener("click", () => {
    document.body.classList.toggle("settings-open");
  });

  /* =========================================================================
     GLOSSARY (general "how spacecraft get around" explainer)
     Deliberately independent of lockedBodyName/lockBody -- it's general
     education, not tied to any specific body, so opening/closing it must
     not touch auto-pause or camera-tracking state the way locking a body
     does. See the "Flight profile" section on individual missions
     (flightProfileHtml) for the mission-specific numbers this generalizes.
  ========================================================================= */

  // Same as lpSectionHtml, plus an optional "Watch it happen" button that
  // drives startManeuverDemo (defined below) -- prose stays the primary
  // explanation, the button is a way to actually SEE it using this
  // simulator's own physics/rendering on a real mission's real leg,
  // rather than a separate hand-built illustration.
  function glossarySectionHtml(heading, bodyHtml, demoType) {
    const btn = demoType
      ? `<button type="button" class="demo-watch-btn" data-demo-type="${demoType}">▶ Watch it happen</button>`
      : "";
    return `<div class="lp-section"><div class="lp-section-heading">${heading}</div><div class="lp-section-body">${bodyHtml}</div>${btn}</div>`;
  }

  const GLOSSARY_HTML =
    glossarySectionHtml("Coasting between burns (Lambert transfers)",
      "Between a launch and an arrival, and between one flyby and the next, this simulator draws a smooth ellipse or hyperbola. That shape isn't decoration: outside of the specific moments below (a launch burn, a flyby, an orbit-raising burn, or continuous low-thrust cruising), nothing is pushing the spacecraft at all — and without that initial burn, it would simply stay on whatever orbit it was already on. Gravity alone shapes the path once it's coasting, the same way a thrown ball's arc is entirely gravity once it leaves your hand.",
      "lambert") +
    glossarySectionHtml("Gravity assists: how a flyby changes speed",
      "In the planet's own frame, a flyby doesn't speed a spacecraft up or slow it down at all — it only turns the direction of its velocity relative to the planet, by an angle set by how close the flyby passes and how fast it's moving. Back in the Sun's frame, since the planet itself is orbiting, that turn can add to or subtract from the spacecraft's solar-orbit speed depending on which side of the planet it passes: catching the planet from behind and swinging past its leading side tends to boost the spacecraft; approaching from ahead and passing its trailing side tends to brake it." +
      "<br><br>A boost or brake happens at essentially one point in the orbit — near the planet — and doesn't move that point right away. What it changes is the orbit's total energy, which reshapes the <em>opposite</em> side: a brake near the orbit's far point (aphelion) pulls the near point (perihelion) in closer to the Sun; a boost near the near point pushes the far point out. That's what makes a \"small\" few-km/s change matter. Parker Solar Probe's Venus brakes are each only 2–6 km/s — modest next to the ~30 km/s it's already moving at that distance — but because each one happens near the orbit's far point, it drags the near point in: after just its first three Venus flybys, PSP's orbital period had already shrunk from 174 days to 112, and its perihelion kept falling with each later pass, eventually diving under 0.05 AU (about 9 solar radii) from the Sun. Run the other way, a single ~4 km/s Earth flyby stretched the Lucy mission's far point from 2.3 AU out to 5.8 AU — reaching Jupiter's own distance — and nearly tripled its orbital period, from about two years to over six." +
      "<br><br>This is exactly how Venus helps Parker Solar Probe get <em>closer</em> to the Sun instead of farther from it. Simply pointing at the Sun and firing an engine doesn't work: Earth's own orbital motion is already about 30 km/s sideways, and anything launched from Earth keeps that sideways speed unless something cancels it out — expensive to do with propellant alone. Repeated Venus brakes shed that sideways speed a few km/s at a time, letting the orbit sink closer to the Sun with each pass.",
      "gravity_assist") +
    glossarySectionHtml("Orbit-raising sequences (parking orbits)",
      "Missions launched on a smaller, cheaper rocket sometimes can't reach escape velocity in one shot. Instead, the spacecraft parks in an elliptical orbit around Earth and, every time it swings back through its closest point (perigee), fires its own engine again to stretch the far side of the orbit a little further out. Repeated enough times, the orbit eventually reaches escape velocity on its own — slower than a single powerful upper stage, but far cheaper. Aditya-L1 and Mangalyaan, both launched on ISRO's PSLV, used this technique.",
      "geocentric_orbit") +
    glossarySectionHtml("Loiter / station-keeping",
      "Some missions deliberately pause at a location — a body, or a gravitationally stable Lagrange point like Earth–L2 — for weeks or months before their next maneuver, whether to run science operations, complete a checkout period, or wait for the next window when their following target is correctly positioned for departure.",
      "loiter") +
    glossarySectionHtml("Continuous low-thrust (ion) missions",
      "Most spacecraft here fly the way the sections above describe: brief chemical burns bracketing long coasts. A few — Dawn, Hayabusa, Hayabusa2, and BepiColombo — instead carry ion engines that thrust continuously for months at a time, at a tiny fraction of a chemical engine's force but far higher efficiency. This simulator's Lambert-arc rendering approximates their true, gently-curving continuous-thrust path rather than modeling it exactly, a simplification each of those missions' own notes already flag.",
      "ion_thrust");

  const glossaryToggle  = document.getElementById("glossary-toggle");
  const glossaryPanel   = document.getElementById("glossary-panel");
  const glossaryBackdrop = document.getElementById("glossary-backdrop");
  const glossaryClose   = document.getElementById("glossary-panel-close");
  document.getElementById("glossary-panel-body").innerHTML = GLOSSARY_HTML;
  glossaryToggle.addEventListener("click", () => {
    document.body.classList.add("glossary-open");
  });
  glossaryClose.addEventListener("click", () => {
    document.body.classList.remove("glossary-open");
  });
  glossaryBackdrop.addEventListener("click", () => {
    document.body.classList.remove("glossary-open");
  });

  /* =========================================================================
     MANEUVER DEMOS ("Watch it happen" -- animates a real mission's real leg
     using this simulator's own physics/camera/clock rather than a separate
     illustration)

     Built fresh on demand (not as a top-level constant) because FLIGHTS_RAW
     (app.js ~line 158) starts as an empty object and is only populated by
     loadFlightsRaw()'s async fetch -- computing this eagerly at module-load
     time would run before that data exists. Cheap enough (a handful of
     date parses) that recomputing per call, like getFlightDestinations
     elsewhere in this file, needs no caching.
  ========================================================================= */

  const DEMO_TARGET_SECONDS = 14; // how long each demo takes to play out in real time
  const DEMO_PX_PER_AU = 260;     // fixed demo zoom -- tighter than the default 70 so the
                                   // camera-followed spacecraft's own maneuver reads clearly

  function getManeuverDemoConfig(typeKey) {
    if (typeKey === 'lambert') {
      const raw = FLIGHTS_RAW.dart;
      const leg = raw.legs[0];
      const depart = daysSinceJ2000(parseFlightDate(leg.departDate));
      const arrive = daysSinceJ2000(parseFlightDate(leg.arrivalDate));
      return {
        flightKey: 'dart',
        startDays: depart - 5,
        endDays: arrive + 2,
        stages: [
          { atDays: depart - 5, text: "DART is still coasting on Earth's own orbit — nothing has changed yet." },
          { atDays: depart, text: "Departure burn: DART leaves Earth's orbit and starts coasting toward Didymos. From here to arrival, gravity is the only force acting on it — no more engine burns." },
          { atDays: arrive - 5, text: "Still coasting — the whole ~10-month cruise is a single arc, shaped only by gravity since that one burn at the start." },
        ],
      };
    }

    if (typeKey === 'gravity_assist') {
      const raw = FLIGHTS_RAW.psp;
      const gaLeg = raw.legs[1]; // first Venus flyby
      const flyby = daysSinceJ2000(parseFlightDate(gaLeg.date));
      const ev = getGAEvents('psp').find((e) => e.legIndex === 1);
      let resultText = "braked PSP's heliocentric speed, pulling its orbit's far point closer to the Sun";
      if (ev && ev.speedOutKmS !== undefined) {
        const before = apsisAU(ev.aBeforeAU, ev.eBefore), after = apsisAU(ev.aAfterAU, ev.eAfter);
        resultText = `braked PSP from ${ev.speedInKmS.toFixed(1)} to ${ev.speedOutKmS.toFixed(1)} km/s relative to the Sun, pulling its orbit's far point in from ${before.Q.toFixed(3)} to ${after.Q.toFixed(3)} AU`;
      }
      return {
        flightKey: 'psp',
        startDays: flyby - 20,
        endDays: flyby + 25,
        stages: [
          { atDays: flyby - 20, text: "PSP is approaching Venus after coasting from Earth." },
          { atDays: flyby - 1, text: "Flyby moment: Venus's gravity bends PSP's path. Its speed relative to VENUS barely changes — only the direction does. But since Venus itself is moving, that turn changes PSP's speed relative to the SUN too." },
          { atDays: flyby + 3, text: `Result: this flyby ${resultText} — a brake, not a boost, which is exactly how Venus helps PSP get closer to the Sun.` },
        ],
      };
    }

    if (typeKey === 'geocentric_orbit') {
      const raw = FLIGHTS_RAW.aditya_l1;
      const legs = raw.legs.filter((l) => l.type === 'geocentric_orbit');
      const first = legs[0], last = legs[legs.length - 1];
      const depart = daysSinceJ2000(parseFlightDate(first.departDate));
      const lastArrive = daysSinceJ2000(parseFlightDate(last.arrivalDate));
      const mid = depart + (lastArrive - depart) / 2;
      return {
        flightKey: 'aditya_l1',
        startDays: depart - 1,
        endDays: lastArrive + 4,
        stages: [
          { atDays: depart - 1, text: "Aditya-L1 begins in a small parking orbit around Earth." },
          { atDays: mid, text: "Each pass through perigee (closest approach), the engine fires again, stretching the far side of the orbit further out." },
          { atDays: lastArrive, text: `After ${legs.length} burns, the orbit has grown from ${Math.round(first.periapsisKm).toLocaleString()}×${Math.round(first.apoapsisKm).toLocaleString()} km to ${Math.round(last.periapsisKm).toLocaleString()}×${Math.round(last.apoapsisKm).toLocaleString()} km — enough to coast the rest of the way to the Sun–Earth L1 point.` },
        ],
      };
    }

    if (typeKey === 'loiter') {
      const raw = FLIGHTS_RAW.escapade;
      const loiterLeg = raw.legs.find((l) => l.type === 'loiter');
      const loiterIdx = raw.legs.indexOf(loiterLeg);
      const arriveLeg = raw.legs[loiterIdx - 1];
      const arrive = daysSinceJ2000(parseFlightDate(arriveLeg.arrivalDate));
      const depart = daysSinceJ2000(parseFlightDate(loiterLeg.departure));
      return {
        flightKey: 'escapade',
        startDays: arrive - 3,
        endDays: depart + 8,
        stages: [
          { atDays: arrive - 3, text: "ESCAPADE is arriving at the Earth–L2 point." },
          { atDays: arrive + (depart - arrive) / 2, text: "It stays here for months — no burns, just holding position near L2 for spacecraft checkout — before its next departure window opens. (Sped way up here so the wait doesn't take, well, months.)" },
          { atDays: depart, text: "Departure: ESCAPADE leaves L2, heading back past Earth for a gravity assist on its way to Mars." },
        ],
      };
    }

    if (typeKey === 'ion_thrust') {
      const raw = FLIGHTS_RAW.dawn;
      const leg = raw.legs.find((l) => l.type === 'lambert' && l.fromBody === 'Earth');
      const depart = daysSinceJ2000(parseFlightDate(leg.departDate));
      const arrive = daysSinceJ2000(parseFlightDate(leg.arrivalDate));
      return {
        flightKey: 'dawn',
        startDays: depart - 3,
        // Stop just short of `arrive`, not past it: the leg right after
        // this one is a rejected gravity-assist patched-conic fit (see
        // getGAChain's missTooLarge fallback -- confirmed via harness:
        // legIndex 2 here comes out isPatched=false, a nearly-parabolic
        // e=0.9974 fallback orbit reaching ~4 AU, versus this leg's own
        // well-behaved e=0.33). Crossing into it drew a sharp, wildly
        // wrong arc out past Mars/Jupiter that has nothing to do with
        // Dawn's real continuous-thrust path -- an artifact of the
        // fallback fit, not a real feature of the trajectory. Every
        // other demo's endDays was checked against this same hazard and
        // only Dawn's crossed it (PSP's leg IS a trusted patched fit;
        // Aditya-L1/ESCAPADE's following legs aren't gated by the GA
        // chain at all).
        endDays: arrive - 0.5,
        stages: [
          { atDays: depart - 3, text: "Dawn is about to leave Earth under continuous ion thrust — not a single burn, but a gentle push that never stops." },
          { atDays: depart + (arrive - depart) / 3, text: "Unlike a chemical rocket, Dawn's ion engine fires continuously for months at a time, at a tiny fraction of the force but far higher efficiency." },
          { atDays: arrive - 5, text: "Almost at Mars for a gravity assist. The smooth curve shown here approximates that continuous thrust — a real chemical-propulsion coast would only burn at the very start." },
        ],
      };
    }

    return null;
  }

  let demoSnapshot = null;   // saved state to restore on exit, or null while no demo is active
  let demoStages = null;     // this demo's caption stages, sorted by atDays
  let demoEndDays = null;
  let demoRafId = null;
  let demoStageIdx = 0;      // index into demoStages of the currently-displayed caption
  let demoStageShownAt = 0;  // performance.now() when demoStageIdx was last advanced

  // Caption stages are spaced by simulated days, not real seconds -- for a
  // demo whose stages happen to be clustered close together in sim-time
  // (PSP's "flyby moment" and "result" captions, only ~4 sim-days apart),
  // the day-threshold alone let one flash on screen for under a second
  // before the next replaced it. This guarantees every stage gets the
  // same minimum real-world reading time regardless of how close together
  // its underlying real events are, by advancing at most one stage per
  // tick and only once the current one has been shown this long.
  const MIN_STAGE_DWELL_MS = 4500;

  const demoCaption = document.getElementById("demo-caption");
  const demoCaptionText = document.getElementById("demo-caption-text");
  const demoExitBtn = document.getElementById("demo-exit-btn");

  function setDemoControlsDisabled(disabled) {
    speedSlider.disabled = disabled;
    playPauseBtn.disabled = disabled;
    editDateBtn.disabled = disabled;
    document.getElementById("reset-speed").disabled = disabled;
    // The speed chip isn't a real <input>/<button> element (no native
    // :disabled), so it gets its own flag (checked in startSpeedEdit) plus
    // a CSS class for the matching dimmed look. If a demo starts while it
    // happens to be mid-edit, cancel that edit first -- otherwise its Go
    // button would keep working via the demo's own controls-disabled
    // visual state.
    if (disabled && speedEditing) endSpeedEdit(false);
    speedFieldsDisabled = disabled;
    speedField.classList.toggle("disabled", disabled);
  }

  function startManeuverDemo(typeKey) {
    const demo = getManeuverDemoConfig(typeKey);
    if (!demo || !FLIGHTS_RAW[demo.flightKey]) return; // flight data not loaded yet

    if (demoSnapshot === null) {
      demoSnapshot = {
        simDate: new Date(simDate), speedSliderValue: speedSlider.value,
        lockedBodyName, selectedFlightKey, sceneVisibilityMode,
        pxPerAU, camX, camY, paused, infoPanelVisible,
      };
    }

    document.body.classList.remove("glossary-open");
    document.body.classList.add("demo-active");

    sceneVisibilityMode = "focused";
    focusSwitch.classList.toggle("on", true);
    selectFlight(demo.flightKey);
    autoPausedOnLock = false; // this is a deliberate play state, not an auto-pause to track/undo
    scrubberAutoPaused = false;

    simDate = dateFromDaysSinceJ2000(demo.startDays);
    dateInput.value = dateInputValue(simDate);
    pxPerAU = DEMO_PX_PER_AU;

    const spanDays = demo.endDays - demo.startDays;
    speedMultiplier = spanDays * 60 / (DEMO_TARGET_SECONDS * EARTH_YEAR_DAYS);
    refreshSpeedField();
    setPaused(false);
    setDemoControlsDisabled(true);

    demoStages = demo.stages.slice().sort((a, b) => a.atDays - b.atDays);
    demoEndDays = demo.endDays;
    demoStageIdx = 0;
    demoStageShownAt = performance.now();
    demoCaptionText.textContent = demoStages[0].text;
    demoExitBtn.textContent = "Exit demo";
    demoCaption.classList.remove("demo-ended");

    if (demoRafId !== null) cancelAnimationFrame(demoRafId);
    demoWatchTick();
  }

  function demoWatchTick() {
    if (demoSnapshot === null) return; // demo was exited
    const nowDays = daysSinceJ2000(simDate);
    const now = performance.now();

    // The physically-correct stage for the current simDate...
    let targetIdx = 0;
    for (let k = 0; k < demoStages.length; k++) {
      if (nowDays >= demoStages[k].atDays) targetIdx = k;
    }
    // ...but only actually advance the caption one stage at a time, and
    // only once the current one has had its minimum reading time -- so a
    // fast-playing demo queues up rather than skipping straight to
    // whatever stage the clock has already reached.
    if (targetIdx > demoStageIdx && (now - demoStageShownAt) >= MIN_STAGE_DWELL_MS) {
      demoStageIdx++;
      demoStageShownAt = now;
      demoCaptionText.textContent = demoStages[demoStageIdx].text;
    }

    // The animation itself still pauses as soon as it reaches its natural
    // end point, even if the caption is still catching up -- freezing on
    // the final frame while the last stage finishes its own dwell time is
    // better than either running past the interesting part or looking
    // stuck with no explanation.
    if (nowDays >= demoEndDays && !paused) setPaused(true);

    const lastStageSettled = demoStageIdx === demoStages.length - 1 &&
                              (now - demoStageShownAt) >= MIN_STAGE_DWELL_MS;
    if (nowDays >= demoEndDays && lastStageSettled && !demoCaption.classList.contains("demo-ended")) {
      demoCaption.classList.add("demo-ended");
      demoExitBtn.textContent = "Exit demo";
    }
    demoRafId = requestAnimationFrame(demoWatchTick);
  }

  function exitManeuverDemo() {
    if (demoSnapshot === null) return;
    if (demoRafId !== null) { cancelAnimationFrame(demoRafId); demoRafId = null; }
    const snap = demoSnapshot;
    demoSnapshot = null; // clear first so the watch tick (if it fires once more) no-ops

    if (snap.selectedFlightKey) {
      selectFlight(snap.selectedFlightKey);
    } else if (snap.lockedBodyName) {
      lockBody(snap.lockedBodyName);
    } else {
      lockBody(null);
    }
    // The calls above always (re)open the panel for whatever they just
    // locked (see lockBody's own comment) -- override with the exact
    // pre-demo panel state (it may have been closed while still tracking).
    infoPanelVisible = snap.infoPanelVisible;
    updateLockedPanelVisibility();
    updateScrubberInfoButton();
    autoPausedOnLock = false;
    scrubberAutoPaused = false;

    simDate = snap.simDate;
    dateInput.value = dateInputValue(simDate);
    speedSlider.value = snap.speedSliderValue;
    updateSpeedFromSlider();
    sceneVisibilityMode = snap.sceneVisibilityMode;
    focusSwitch.classList.toggle("on", sceneVisibilityMode === "focused");
    pxPerAU = snap.pxPerAU;
    camX = snap.camX; camY = snap.camY;
    setPaused(snap.paused);
    setDemoControlsDisabled(false);

    document.body.classList.remove("demo-active");
    document.body.classList.add("glossary-open");
  }

  document.getElementById("glossary-panel-body").addEventListener("click", (e) => {
    const btn = e.target.closest(".demo-watch-btn");
    if (btn) startManeuverDemo(btn.dataset.demoType);
  });
  demoExitBtn.addEventListener("click", exitManeuverDemo);

  /* =========================================================================
     LEGEND
  ========================================================================= */

  const legendRows = document.getElementById("legend-rows");

  // Shared by both the Planets legend (Moon/Phobos/Deimos/outer moons) and
  // the Small Bodies legend (Charon, under Pluto) -- a satellite's row only
  // ever appears expanded while its primary (or the satellite itself) is
  // the locked/focused body (see isSatelliteVisible); container lets each
  // caller target its own rows list.
  function addSatelliteRow(container, name, parentName, color) {
    const wrapper = document.createElement("div");
    wrapper.className = "satellite-accordion";
    const expanded = isSatelliteVisible(parentName, name);
    wrapper.classList.toggle("expanded", expanded);

    const row = document.createElement("div");
    row.className = "row";
    row.style.paddingLeft = "17px";
    row.style.cursor = "pointer";
    row.innerHTML = `<span class="dot" style="background:${color};width:6px;height:6px"></span><span>${name}</span>`;
    row.addEventListener("click", () => lockBody(name, { toggleIfSame: true }));

    wrapper.appendChild(row);
    container.appendChild(wrapper);
  }

  function buildLegend() {
    legendRows.innerHTML = "";
    const sunRow = document.createElement("div");
    sunRow.className = "row";
    sunRow.style.cursor = "pointer";
    sunRow.innerHTML = `<span class="dot" style="background:${SUN_COLOR}"></span><span>Sol</span>`;
    sunRow.addEventListener("click", () => lockBody("Sol", { toggleIfSame: true }));
    legendRows.appendChild(sunRow);

    PLANET_ORDER.forEach((name) => {
      const row = document.createElement("div");
      row.className = "row";
      row.style.cursor = "pointer";
      row.innerHTML = `<span class="dot" style="background:${PLANET_META[name].color}"></span><span>${name}</span>`;
      row.addEventListener("click", () => lockBody(name, { toggleIfSame: true }));
      legendRows.appendChild(row);
      if (name === "Earth") {
        addSatelliteRow(legendRows, "Moon", "Earth", MOON_META.color);
      }
      if (name === "Mars") {
        addSatelliteRow(legendRows, "Phobos", "Mars", PHOBOS_META.color);
        addSatelliteRow(legendRows, "Deimos", "Mars", DEIMOS_META.color);
      }
      if (OUTER_MOONS[name]) {
        OUTER_MOONS[name].forEach((m) => addSatelliteRow(legendRows, m.name, name, m.meta.color));
      }
    });
  }
  buildLegend();

  // Asteroids & comets legend: unlike planets (always shown) or flights
  // (rows always listed, visibility handled separately per-flight), every
  // small body IS always listed here so it can be clicked to select it --
  // that click is what makes an otherwise-hidden body visible in the scene
  // (see isSmallBodyVisible). Listing them is cheap and static (9 rows,
  // built once), unlike buildFlightsLegend which waits on an async fetch.
  const smallBodiesRows = document.getElementById("smallbodies-rows");
  // Split into two labeled sub-sections rather than one flat list: Pluto is
  // an IAU dwarf planet, not an asteroid or comet, and lumping it in under
  // an "Asteroids & Comets" header read as miscategorized once it had a
  // companion (Charon) rendered alongside it. Ceres is ALSO technically a
  // dwarf planet, but stays in the general section below -- it physically
  // sits in the main asteroid belt and everyone (astronomers included)
  // still looks for it right next to Vesta, so moving it would fight the
  // mental model this legend exists to support, purely to satisfy a formal
  // classification. This subsection is deliberately ready to gain more
  // members later (Eris, Haumea, Makemake) without any further UI change.
  // Small bodies are a mixed bag by design -- asteroids, comets, and (so
  // far) one dwarf-planet system -- deliberately kept as one flat list
  // rather than split into type-based sub-sections: subdividing by type
  // doesn't stop at "dwarf planets get their own group," it also implies
  // comets should split from asteroids, and so on, which just recreates a
  // taxonomy argument in the UI for a handful of rows. A compact badge
  // next to the name (full explanation on hover) flags anything unusual
  // without spending vertical space or inventing new groups every time a
  // body doesn't fit neatly in "asteroid."
  //
  // Every SMALL_BODIES entry carries a `types` array (not a single `type`)
  // so a body can honestly hold more than one real classification at once
  // -- Ceres is both an asteroid and an IAU dwarf planet, and a future
  // Kuiper-belt addition would make Pluto/Charon dwarf-planet-and-KBO.
  // Deliberately no entry here for the plain 'asteroid'/'comet' tags --
  // they're the default, unremarkable case, so leaving them out of this
  // map keeps the legend badge-free for the common case (see the comment
  // above); only add an entry here for a genuinely notable classification.
  const SMALL_BODY_TYPE_BADGES = {
    dwarf_planet: { label: "DP", title: "Dwarf planet" },
  };

  // key -> row element, so the per-frame visibility highlight (see
  // updateSmallBodiesLegendActiveState) can toggle a class on the existing
  // rows without rebuilding the whole legend every frame -- same pattern
  // as flightLegendRowEls.
  let smallBodyLegendRowEls = {};
  function buildSmallBodiesLegend() {
    smallBodiesRows.innerHTML = "";
    smallBodyLegendRowEls = {};
    // Sorted alphabetically by display name -- catalog numbers moved to a
    // trailing "(N)" specifically so this reads as alphabetical to a human
    // scanning it (e.g. "Bennu (101955)" sorts under B), rather than the
    // old "101955 Bennu" convention, which put every numbered body in a
    // seemingly arbitrary jumble ahead of named ones like "Pluto and Charon".
    const sorted = Object.entries(SMALL_BODIES).sort((a, b) => a[1].name.localeCompare(b[1].name));
    sorted.forEach(([key, body]) => {
      const row = document.createElement("div");
      row.className = "row";
      row.style.cursor = "pointer";
      // A body can carry more than one real classification (e.g. Ceres is
      // both an asteroid and an IAU dwarf planet -- see its own SMALL_BODIES
      // comment) -- render one badge per tag that has a badge definition,
      // not just the first. Plain "asteroid"/"comet" deliberately have no
      // entry in SMALL_BODY_TYPE_BADGES (see that map's own comment) so the
      // common case stays badge-free; only the "notable" tags show one.
      const badgeHtml = body.types
        .map((t) => SMALL_BODY_TYPE_BADGES[t])
        .filter(Boolean)
        .map((badge) => `<span class="body-type-badge" title="${badge.title}">${badge.label}</span>`)
        .join("");
      row.innerHTML = `<span class="dot" style="background:${body.meta.color}"></span><span>${body.name}</span>${badgeHtml}`;
      // Locked by its display name, not the SMALL_BODIES key -- same
      // convention every other body (planets, moons) already uses, so the
      // locked panel title reads "Bennu (101955)", not "bennu".
      row.addEventListener("click", () => lockBody(body.name, { toggleIfSame: true }));
      smallBodiesRows.appendChild(row);
      smallBodyLegendRowEls[key] = row;
      if (key === "pluto") addSatelliteRow(smallBodiesRows, "Charon", "Pluto and Charon", CHARON_META.color);
      if (key === "didymos") addSatelliteRow(smallBodiesRows, "Dimorphos", "Didymos (65803)", DIMORPHOS_META.color);
    });
  }
  buildSmallBodiesLegend();

  // Lighten a small body's row while it's actually visible in the scene
  // right now (see isSmallBodyVisible -- selected directly, or its
  // targeting mission is selected/in-transit within the padded window),
  // mirroring updateFlightsLegendActiveState's "in-transit" highlight for
  // flights. Unlike flights, most small bodies sit hidden most of the
  // time (see isSmallBodyVisible's own comment), so this is the legend's
  // only way to show "this one happens to be visible right now" versus
  // the majority that aren't -- reuses the same .in-transit CSS class
  // (same "lighter" treatment) since the visual meaning -- "the thing
  // this row refers to is live in the scene right now" -- is the same
  // idea in both legends, even though the underlying condition differs.
  function updateSmallBodiesLegendActiveState(daysSinceEpoch) {
    for (const key in SMALL_BODIES) {
      const row = smallBodyLegendRowEls[key];
      if (!row) continue;
      row.classList.toggle("in-transit", isSmallBodyVisible(key, daysSinceEpoch));
    }
  }

  // Generic collapsible layer-group toggle: clicking a group's header
  // flips its "collapsed" class, which the CSS transition (max-height +
  // opacity on .layer-body) animates. Used for the Planets, Flights, and
  // Asteroids & Comets groups so none needs its own bespoke toggle logic.
  function wireLayerGroupToggle(headerId, groupId) {
    const header = document.getElementById(headerId);
    const group = document.getElementById(groupId);
    header.addEventListener("click", () => {
      group.classList.toggle("collapsed");
    });
  }
  wireLayerGroupToggle("planets-layer-header", "planets-layer-group");
  wireLayerGroupToggle("flights-layer-header", "flights-layer-group");
  wireLayerGroupToggle("smallbodies-layer-header", "smallbodies-layer-group");

  // Flights legend: empty for now (no missions added yet). Built the same
  // way buildLegend() builds the planets list, so adding real flight rows
  // later is a drop-in replacement for the empty-state note below, not a
  // new code path.
  const flightsRows = document.getElementById("flights-rows");
  // key -> row element, so the per-frame in-transit highlight (see
  // updateFlightsLegendActiveState) can toggle a class on the existing
  // rows without rebuilding the whole legend every frame.
  let flightLegendRowEls = {};
  // Converts an HSL color to "#rrggbb" -- every other color in this app
  // (planet/body meta colors, the flight marker's own drawBody call via
  // hexWithAlpha/hexDarken below) is hex, so flightColor must produce hex
  // too rather than a CSS hsl() string, which those two functions can't
  // parse (they slice fixed hex digit positions and would silently
  // produce NaN channels instead of throwing early).
  function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    const toHex = (n) => Math.round(f(n) * 255).toString(16).padStart(2, "0");
    return `#${toHex(0)}${toHex(8)}${toHex(4)}`;
  }

  // Deterministic per-flight color so several trajectories on screen at
  // once are visually distinguishable, rather than every arc being the
  // same solid green. Hues are spread with the golden angle (~137.5deg)
  // rather than picked from a fixed-size palette, so adjacent flights in
  // FLIGHTS_ORDER land on maximally distinct hues and the scheme never
  // runs out or starts repeating as more flights are added. Muted
  // saturation/lightness keeps arcs from competing visually with the
  // brighter planet/body colors.
  function flightColor(key) {
    const idx = FLIGHTS_ORDER.indexOf(key);
    const hue = (idx * 137.508) % 360;
    return hslToHex(hue, 55, 58);
  }

  function buildFlightsLegend() {
    // The "current orbit" toggle only means anything once a mission is
    // selected -- buildFlightsLegend is called from every place
    // selectedFlightKey changes, so this is the one central spot to keep
    // its visibility in sync without hunting down each call site.
    orbitViewToggleLabel.classList.toggle("visible", !!selectedFlightKey);
    flightsRows.innerHTML = "";
    flightLegendRowEls = {};
    if (FLIGHTS_ORDER.length === 0) {
      const note = document.createElement("div");
      note.className = "empty-note";
      note.textContent = "No flights added yet";
      flightsRows.appendChild(note);
      return;
    }
    // Sorted alphabetically by display name for the legend -- at 38+
    // flights and growing, launch-chronological order (FLIGHTS_ORDER's own
    // sequence, still used everywhere else: flightColor's hue assignment,
    // the GA-chain/render loops, etc.) meant finding a specific mission
    // required already knowing roughly when it launched. This sort is
    // local to how the legend is BUILT, not a mutation of FLIGHTS_ORDER
    // itself, so nothing else keys off it.
    const sortedKeys = [...FLIGHTS_ORDER].sort((a, b) =>
      FLIGHTS_RAW[a].name.localeCompare(FLIGHTS_RAW[b].name));
    sortedKeys.forEach((key) => {
      const raw = FLIGHTS_RAW[key];
      const row = document.createElement("div");
      row.className = "row";
      row.style.cursor = "pointer";
      if (selectedFlightKey === key) row.style.color = "var(--text-primary)";
      row.innerHTML = `<span class="dot" style="background:${flightColor(key)}"></span><span>${raw.name}</span>`;
      row.addEventListener("click", () => selectFlight(key));
      flightsRows.appendChild(row);
      flightLegendRowEls[key] = row;
    });
  }

  // Lighten a flight's row while it's actually flying (in transit) right
  // now, at the current simulated date -- independent of whether it's
  // selected. Runs every frame (see frame()); only toggles a class on the
  // rows buildFlightsLegend() already built, so it's cheap and doesn't
  // touch the DOM otherwise.
  function updateFlightsLegendActiveState(daysSinceEpoch) {
    FLIGHTS_ORDER.forEach((key) => {
      const row = flightLegendRowEls[key];
      if (!row) return;
      const { launchDays, arrivalDays } = getFlightDates(key);
      const inTransit = daysSinceEpoch >= launchDays && daysSinceEpoch <= arrivalDays;
      row.classList.toggle("in-transit", inTransit);
    });
  }
  // NOTE: the initial call to buildFlightsLegend() happens in the async
  // bootstrap at the end of this file, AFTER loadFlightsRaw() resolves --
  // calling it here, synchronously, would run against an empty
  // FLIGHTS_RAW/FLIGHTS_ORDER (the fetches haven't completed yet) and
  // render a legend with nothing in it.


  /* =========================================================================
     HOVER TOOLTIP + CLICK-TO-LOCK SATELLITE DATA PANEL
     Hovering shows a transient tooltip, as before. Clicking a body (a true
     click — not the end of a drag/rotate gesture) locks that body: the
     tooltip becomes a persistent panel that tracks the body's screen
     position every frame as it orbits and as the camera moves, until the
     user clicks elsewhere (on empty space, or on another body to switch
     the lock) or clicks the panel's own close control.
  ========================================================================= */

  const hoverTip = document.getElementById("hover-tip");

  // Track whether the current mouse-down/up sequence was a genuine click
  // (negligible movement) rather than a camera drag, so rotating the view
  // never accidentally locks/unlocks a planet.
  let mouseDownX = 0, mouseDownY = 0;
  let mouseDownWasDrag = false;
  const CLICK_DRAG_THRESHOLD_PX = 5;

  canvas.addEventListener("mousedown", (e) => {
    mouseDownX = e.clientX; mouseDownY = e.clientY;
    mouseDownWasDrag = false;
  });
  window.addEventListener("mousemove", (e) => {
    if (Math.hypot(e.clientX - mouseDownX, e.clientY - mouseDownY) > CLICK_DRAG_THRESHOLD_PX) {
      mouseDownWasDrag = true;
    }
  });
  // Touch has no native "click" gesture -- the browser synthesizes one
  // from a tap (touchstart+touchend with little movement in between),
  // and that synthesized click is what the listener below actually
  // receives. But mouseDownWasDrag was only ever updated from mouse
  // events, so it stayed permanently false through any touch session --
  // meaning a one-finger ROTATE drag on mobile would still fire a
  // synthesized click at wherever the finger lifted, misfiring a body
  // selection mid-gesture. Feeding touchstart/touchmove into the exact
  // same threshold tracking mousedown/mousemove already use closes that
  // gap without needing a separate touch-specific click handler.
  canvas.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return; // 2-finger gesture is pan/zoom, never a tap-to-select
    mouseDownX = e.touches[0].clientX; mouseDownY = e.touches[0].clientY;
    mouseDownWasDrag = false;
  }, { passive: true });
  canvas.addEventListener("touchmove", (e) => {
    if (e.touches.length !== 1) return;
    if (Math.hypot(e.touches[0].clientX - mouseDownX, e.touches[0].clientY - mouseDownY) > CLICK_DRAG_THRESHOLD_PX) {
      mouseDownWasDrag = true;
    }
  }, { passive: true });
  // Minimum squared distance from point (px,py) to a line segment (x1,y1)-(x2,y2).
  function pointToSegmentDistSq(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq > 0 ? ((px - x1) * dx + (py - y1) * dy) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = x1 + t * dx, cy = y1 + t * dy;
    const ex = px - cx, ey = py - cy;
    return ex * ex + ey * ey;
  }

  // Nearest-path-wins hit test against renderedPaths (populated each frame
  // right alongside renderedBodies -- see the "Orbit paths" block above) --
  // the fallback when a click/hover misses every body/flight marker (see
  // the canvas "click" and handleHover below). Returns the closest path
  // entry within tolerancePx, or null. Deliberately the SAME "nearest
  // under threshold" philosophy the marker hit test already uses (its own
  // comment above) rather than any kind of selection menu for overlapping
  // paths -- the hover-glow preview this feeds is what actually resolves
  // ambiguity for the user, by letting them nudge the pointer until the
  // right name lights up, rather than the app guessing or listing options.
  function hitTestPaths(mx, my, tolerancePx) {
    let best = null, bestDistSq = tolerancePx * tolerancePx;
    for (const path of renderedPaths) {
      for (const seg of path.segments) {
        for (let k = 0; k < seg.length - 1; k++) {
          const [x1, y1] = seg[k], [x2, y2] = seg[k + 1];
          const dSq = pointToSegmentDistSq(mx, my, x1, y1, x2, y2);
          if (dSq < bestDistSq) { bestDistSq = dSq; best = path; }
        }
      }
    }
    return best;
  }

  canvas.addEventListener("click", (e) => {
    if (mouseDownWasDrag) return; // was a rotate/pan gesture, not a click
    if (e.button === 2 || e.shiftKey) return; // pan gesture
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // A mouse pointer is precise; a fingertip isn't -- give touch a much
    // more forgiving hit radius so tapping a small/distant body (or a
    // thin flight marker) doesn't require pixel-perfect accuracy.
    const minHitR = isMobileLayout ? 24 : 8;

    // Two-pass hit test: flight markers first, regardless of depth-sort
    // order. renderedBodies is sorted by rz (camera depth) for correct
    // drawing, not by "which target should win an overlapping click" --
    // a flight marker is small and sits ON TOP of (at nearly the same
    // screen position as) whatever body it's currently passing near, so
    // depth order alone made the planet win unpredictably whenever the
    // two happened to be close in rz. A spacecraft is always the more
    // specific target when it overlaps a planet, so it gets first claim.
    let hit = null;
    for (const b of renderedBodies) {
      if (!b.isFlight) continue;
      const dx = mx - b.sx, dy = my - b.sy;
      const hitR = Math.max(b.screenR, minHitR);
      if (dx * dx + dy * dy <= hitR * hitR) { hit = b; break; }
    }
    if (!hit) {
      for (const b of renderedBodies) {
        if (b.isFlight) continue;
        const dx = mx - b.sx, dy = my - b.sy;
        const hitR = Math.max(b.screenR, minHitR);
        if (dx * dx + dy * dy <= hitR * hitR) { hit = b; break; }
      }
    }
    // Marker miss: fall back to the path/orbit line itself -- a flight
    // marker especially is small and constantly moving, but the arc it's
    // following is a much bigger, static target. Same nearest-under-
    // threshold philosophy as the marker test above (see hitTestPaths'
    // own comment), just a slightly larger tolerance since a thin line is
    // harder to land on than a marker's own already-generous minHitR.
    if (!hit) {
      const pathHit = hitTestPaths(mx, my, isMobileLayout ? 28 : 10);
      if (pathHit) {
        if (pathHit.flightKey) {
          selectFlight(pathHit.flightKey);
        } else {
          lockBody(pathHit.name, { toggleIfSame: true });
        }
        return;
      }
    }
    // A flight marker needs selectFlight(), not the generic lockBody() --
    // selectFlight is what sets selectedFlightKey, which is what tells the
    // arc-drawing pass in frame() to render this mission's FULL path (see
    // its comment) instead of the usual +/-6-month window it draws for a
    // merely-in-transit, unselected flight. Clicking a flight's legend row
    // already went through selectFlight; clicking its marker directly on
    // the canvas was going through plain lockBody() instead, so the panel
    // opened correctly but the full-path treatment never kicked in.
    if (hit && hit.isFlight) {
      selectFlight(hit.flightKey);
    } else if (hit) {
      lockBody(hit.name, { toggleIfSame: true });
    } else if (lockedBodyName && infoPanelVisible) {
      // Empty-space click with the panel open: dismiss it exactly like the
      // panel's own X button (see closeInfoPanel) -- NOT lockBody(null),
      // which would also clear lockedBodyName/selectedFlightKey and drop
      // whatever was selected. "Click away to close" and "Stop tracking"
      // are different gestures and shouldn't have the same effect; if
      // nothing is locked, or the panel's already closed, there's nothing
      // to do here at all.
      closeInfoPanel();
    }
  });

  /* =========================================================================
     URL PERMALINKS
     Query params, not hash/path routing -- this is a static single-page
     app served straight from a plain host (GitHub Pages) with no
     server-side routing, so query params are what actually survive a
     page refresh/share/bookmark without any server config. Every update
     goes through history.replaceState (never pushState): toggling
     Focused/Broad or editing the date shouldn't spam browser history --
     the CURRENT url is always a valid, shareable snapshot of what's on
     screen, but back/forward isn't turned into a step-by-step undo log
     of every toggle. Params are omitted entirely when they'd just be the
     default (broad, no locked target, no pinned date), so a plain visit
     keeps a clean bare URL.
  ========================================================================= */

  const DEFAULT_DOCUMENT_TITLE = document.title;
  function updateDocumentTitle() {
    document.title = lockedBodyName ? `${lockedBodyName} — ${DEFAULT_DOCUMENT_TITLE}` : DEFAULT_DOCUMENT_TITLE;
  }

  function updateURLParams(updates) {
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === undefined) url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    }
    history.replaceState(null, "", url);
  }

  // Read once at bootstrap, after flight data has loaded (a flight= param
  // needs FLIGHTS_RAW populated to validate against). Order: focus mode
  // and date first (cheap state, no rendering dependency), then the
  // locked target last, since locking also rebuilds the legend/panel and
  // should reflect the final date/focus state when it does.
  function applyInitialURLState() {
    const params = new URLSearchParams(window.location.search);
    const focus = params.get("focus");
    if (focus === "focused") {
      sceneVisibilityMode = "focused";
      focusSwitch.classList.toggle("on", true);
    }
    const info = params.get("info");
    if (info === "manual") {
      infoBoxMode = "manual";
      infoBoxSwitch.classList.toggle("on", true);
    }
    const hold = params.get("hold");
    if (hold === "1") {
      freeCameraMode = true;
      freeCameraSwitch.classList.toggle("on", true);
    }
    const date = params.get("date");
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setSimDateFromInputValue(date);
      dateInput.value = dateInputValue(simDate);
      setPaused(true);
    }
    const flightKey = params.get("flight");
    const bodyName = params.get("body");
    if (flightKey && FLIGHTS_RAW[flightKey]) {
      selectFlight(flightKey);
    } else if (bodyName) {
      lockBody(bodyName);
    }
  }

  // Shared lock/unlock entry point, used both by clicking a body directly
  // in the canvas and by clicking its row in the legend menu. Centralizing
  // this avoids the legend needing to duplicate the lock/unlock/visibility
  // logic that the canvas click handler already implements.
  function lockBody(name, opts) {
    closeDashboard(); // any change of what's locked closes an open dashboard rather than trying to keep it in sync
    opts = opts || {};
    const prevPanelVisible = infoPanelVisible;
    if (name === null) {
      lockedBodyName = null;
      infoPanelVisible = false;
    } else if (opts.toggleIfSame && lockedBodyName === name) {
      if (infoPanelVisible) {
        lockedBodyName = null; // panel's already open: same-body click unlocks it, as before
        infoPanelVisible = false;
      } else {
        // Still tracking this target but the panel was closed (see the
        // panel close button) -- re-clicking it means "show me that info
        // again," not "stop tracking" (that's stopTrackingBtn's job).
        infoPanelVisible = true;
      }
    } else {
      lockedBodyName = name;
      // opts.respectInfoBoxMode is only ever set by selectFlight's own
      // auto-open call below -- every other caller (a plain body/moon
      // click, a "missions here"/"destinations" link, a URL-driven
      // body= load) always opens the panel immediately, same as before.
      infoPanelVisible = opts.respectInfoBoxMode ? (infoBoxMode === "auto") : true;
    }
    syncPauseWithLockedPanel(prevPanelVisible, infoPanelVisible);
    // Locking onto a body (a planet, moon, or Sol) is a sign attention
    // has moved elsewhere, so any lingering flight selection should clear
    // -- otherwise a flight's arc stays pinned visible indefinitely after
    // the user has moved on to look at something else, with no way to
    // turn it off short of re-finding and re-clicking that exact flight
    // again. selectFlight() itself calls lockBody() to focus the launch
    // body as part of SETTING the selection, so it passes
    // preserveFlightSelection to skip this -- every other caller (direct
    // canvas/legend clicks) leaves it unset and gets the clearing.
    if (!opts.preserveFlightSelection && selectedFlightKey !== null) {
      selectedFlightKey = null;
      buildFlightsLegend();
      buildFlightScrubber();
    }
    updateLockedPanelVisibility();
    buildLegend(); // re-render so the accordion (moon rows) reflects the new focus
    // Picking something from the legend drawer is the natural "I'm done
    // browsing" signal on mobile -- close it so the canvas/info panel are
    // actually visible. selectFlight() routes through here too (see its
    // own lockBody call), so this covers flight selection as well without
    // a separate hook. No-op on desktop (drawer-open only means anything
    // under body.mobile) and harmless if the drawer was already closed
    // (e.g. a canvas tap, not a drawer row).
    if (isMobileLayout && lockedBodyName !== null) {
      document.body.classList.remove("drawer-open");
    }
    updateDocumentTitle();
    // Skip the URL write when this call is selectFlight's own internal
    // lockBody(raw.name, {preserveFlightSelection:true}) -- selectFlight
    // writes flight=<key> itself right after, which is the correct param
    // for a flight (its data-file key, not its display name).
    if (!opts.preserveFlightSelection) {
      updateURLParams({ body: lockedBodyName, flight: null });
    }
  }

  // Clicking a flight selects it and focuses the camera on the
  // spacecraft, WITHOUT touching simDate -- see the comment further down
  // for why that date-jump was removed. (Pause state DOES get touched,
  // but only as the panel-open/close side effect syncPauseWithLockedPanel
  // applies uniformly to every lock/unlock, not something specific to
  // flight selection.)
  function selectFlight(key) {
    closeDashboard(); // any change of what's selected closes an open dashboard rather than trying to keep it in sync
    if (selectedFlightKey === key) {
      // clicking the same flight again deselects it, mirroring lockBody's
      // toggle-on-same-click convention used elsewhere
      selectedFlightKey = null;
      const prevPanelVisible = infoPanelVisible;
      lockedBodyName = null;
      infoPanelVisible = false;
      syncPauseWithLockedPanel(prevPanelVisible, false);
      buildLegend();
      buildFlightsLegend();
      buildFlightScrubber();
      updateLockedPanelVisibility();
      updateDocumentTitle();
      updateURLParams({ body: null, flight: null });
      return;
    }
    const raw = FLIGHTS_RAW[key];
    selectedFlightKey = key;
    // Deliberately does NOT touch simDate/pause state: a legend click is
    // "I want to see info about this mission," not "take me to its
    // launch." Jumping the date out from under the user broke the normal
    // flow of comparing multiple currently-visible missions -- click one
    // to read about it, click another, without the clock lurching around
    // underneath. isFlightVisible() already keeps the arc/marker on screen
    // purely because it's selected (see its own "OR selected" clause), so
    // the trajectory still renders correctly even while the current date
    // sits outside the mission's actual launch-arrival window.
    // Lock the camera to the spacecraft (raw.name), not the launch planet.
    // worldStates is populated with the spacecraft position each frame
    // (see the selectedFlightKey block below the moons section) so the
    // camera-follow code can track it exactly like any planet or moon.
    // respectInfoBoxMode: this is specifically flight selection's own
    // auto-open -- see infoBoxMode's own comment and lockBody's handling
    // of this flag.
    lockBody(raw.name, { toggleIfSame: false, preserveFlightSelection: true, respectInfoBoxMode: true });
    buildFlightsLegend();
    buildFlightScrubber();
    // Clicking is one of the two conditions ("clicked or encountered
    // during time manipulation") that should trigger the Lambert solve.
    // Doing it explicitly here, rather than waiting for the next frame's
    // draw call to discover (via isFlightVisible) that this flight is
    // now selected, avoids any ordering ambiguity about which happens
    // first within a single frame. getSolvedFlight is flat-schema-only
    // (throws for multi-leg, by design -- see its own comment); multi-leg
    // flights have no equivalent single upfront solve to warm, since each
    // leg solves lazily via getSolvedLeg/getGAChain the first time its
    // position is actually queried during rendering.
    if (!isMultiLeg(raw)) getSolvedFlight(key);
    updateDocumentTitle();
    updateURLParams({ body: null, flight: key });
  }

  // A moon is shown -- in the scene and in the legend's expanded accordion
  // -- only while its parent planet is the focused/locked body, or while
  // the moon itself is the locked body (so clicking a moon directly keeps
  // it visible even though the "focus" is technically on the moon, not
  // the planet). Nothing is shown when nothing is locked.
  function isSatelliteVisible(parentName, satelliteName) {
    return lockedBodyName === parentName || lockedBodyName === satelliteName;
  }

  // An asteroid/comet is too small to sit permanently on screen at
  // planet-scale zoom (per design: they'd just be visual noise), so each
  // one is hidden unless there's a specific reason to care about it right
  // now:
  //   1. it's directly selected (clicked in the Asteroids & Comets legend), or
  //   2. a mission that actually targets it (SMALL_BODIES[key].targetOfFlights)
  //      is selected in the Flights legend -- shown regardless of date, same
  //      as a selected flight's own arc is, or
  //   3. such a mission is within its transit window WIDENED by one year on
  //      each side (launch-365d through arrival+365d) -- wider than a
  //      flight's own normal in-transit window, specifically so scrubbing
  //      time while the mission is selected lets you watch the target body's
  //      real motion approaching/departing the encounter, not just see it
  //      appear right at the moment of arrival.
  // How far on either side of "now" an unselected, merely-in-transit
  // flight's trajectory arc is drawn (see the FLIGHTS_ORDER render loop).
  // A selected flight ignores this entirely and draws its full path.
  const TRAJECTORY_WINDOW_DAYS = 365; // ~12 months

  const SMALL_BODY_VISIBILITY_PAD_DAYS = 365;
  function isSmallBodyVisible(key, daysSinceEpoch) {
    // Focused mode strips the widened in-transit-window fallback below
    // entirely -- it's exactly isSmallBodyOrbitVisible's own (stricter)
    // rule, so delegate rather than duplicating it.
    if (sceneVisibilityMode === "focused") return isSmallBodyOrbitVisible(key);
    const body = SMALL_BODIES[key];
    if (lockedBodyName === body.name) return true;
    // Long-period/one-time-encounter bodies (comet tail crossings, see
    // crossingWindowDays on hyakutake/mcnaught_hartley/mcnaught) only make
    // sense to show near their own crossing date -- unlike a bound,
    // short-period target like Borrelly/Braille (fine across their whole
    // targeting mission's span, since they keep orbiting normally the
    // whole time), a near-parabolic/hyperbolic comet sits at a wildly
    // wrong, often absurdly distant position for most of a multi-year
    // mission's own span. Gated here (after the explicit-lock check above,
    // so directly clicking the comet itself still always shows it) so it
    // applies uniformly to every path below, not just the widened
    // in-transit fallback.
    if (body.crossingWindowDays != null &&
        Math.abs(daysSinceEpoch - body.elements.epochDays) > body.crossingWindowDays) {
      return false;
    }
    for (const flightKey of body.targetOfFlights) {
      // A targetOfFlights entry can name a mission that isn't actually in
      // this build's manifest.json yet (or was pulled, e.g. a hyperbolic
      // trajectory this solver can't handle yet) -- don't let a stale
      // reference throw for every other small body's visibility check too.
      if (!FLIGHTS_RAW[flightKey]) continue;
      if (selectedFlightKey === flightKey) return true;
      const { launchDays, arrivalDays } = getFlightDates(flightKey);
      if (daysSinceEpoch >= launchDays - SMALL_BODY_VISIBILITY_PAD_DAYS &&
          daysSinceEpoch <= arrivalDays + SMALL_BODY_VISIBILITY_PAD_DAYS) return true;
    }
    return false;
  }

  // Stricter than isSmallBodyVisible: the body's own DOT is deliberately
  // shown for the whole widened in-transit window (so scrubbing time lets
  // you watch a target approach/depart even without clicking anything --
  // see isSmallBodyVisible's comment), but its ORBIT LINE should only
  // appear as the direct result of an explicit action -- clicking the body
  // itself, or clicking/selecting a mission that targets it -- not just
  // because a targeting mission happens to be in transit somewhere nearby
  // in time. Otherwise the orbit ellipse would flicker on/off across a
  // full year on either side of every targeting mission's launch/arrival
  // regardless of whether anyone asked to see it.
  function isSmallBodyOrbitVisible(key) {
    const body = SMALL_BODIES[key];
    if (lockedBodyName === body.name) return true;
    for (const flightKey of body.targetOfFlights) {
      if (!FLIGHTS_RAW[flightKey]) continue;
      if (selectedFlightKey === flightKey) return true;
    }
    return false;
  }

  // A flight's trajectory arc and spacecraft marker are shown only if
  // EITHER it is currently selected (clicked in the Flights legend) OR
  // the simulated date falls within its actual transit window (it is
  // genuinely traversing space right now, not sitting docked/orbiting at
  // either end). Outside both conditions, it is hidden entirely. This is
  // the single rule every flight-visibility check should go through --
  // at 100 or 1000 flights, drawing every arc unconditionally (the
  // earlier behavior) would make the view unreadable, so the rule is
  // centralized here rather than re-implemented at each call site.
  //
  // Uses getFlightDates(), NOT getSolvedFlight() -- this runs for every
  // flight on every frame, so it must never trigger the expensive Lambert
  // solve. Only date arithmetic happens here; the solve happens later,
  // only for flights this function actually returns true for.
  // Deliberately does NOT key off lockedBodyName at all -- clicking a
  // plain body/small body (as opposed to clicking a FLIGHT, or a
  // "Missions here"/"Destinations" link, either of which calls
  // selectFlight) is not itself a request to see anything's path.  Those
  // links already surface exactly which missions relate to a body without
  // needing the canvas to also auto-show their paths, and separates "what
  // touches this body" (informational, in the panel) from "what's drawn
  // right now" (deliberately either explicitly selected, or just
  // genuinely happening) -- this used to also treat a locked body as an
  // implicit filter/reveal (narrower in Broad mode, the ONLY way anything
  // showed at all in Focused mode), which made clicking a body feel like
  // it was doing two different, not-obviously-related things at once.
  function isFlightVisible(key, daysSinceEpoch) {
    if (selectedFlightKey === key) return true;
    // Focused mode: nothing else gets a "merely in transit" pass -- an
    // explicit selection is the only way in.
    if (sceneVisibilityMode === "focused") return false;
    const { launchDays, arrivalDays } = getFlightDates(key);
    return daysSinceEpoch >= launchDays && daysSinceEpoch <= arrivalDays;
  }

  function handleHover(e) {
    // This listener is bound on window (so hover keeps working during an
    // active camera rotate/pan drag, see the mousemove listener above),
    // which means it also fires for every mousemove over any DOM panel
    // sitting on top of the canvas -- including the flight scrubber, which
    // runs its OWN #hover-tip logic for its event markers (see the
    // delegated mousemove listener on flightScrubberMarkers). Bail out
    // here, BEFORE the locked-panel-open check below, rather than letting
    // this canvas-only hit-test (which knows nothing about the marker DOM
    // underneath the pointer) immediately clobber whatever the scrubber's
    // own handler just set, in the same event dispatch -- the scrubber
    // stays interactive/tooltip-able even while the info panel it belongs
    // to is open (selecting a flight opens that panel by default), unlike
    // a canvas hover preview of some OTHER, unrelated body.
    if (e.target.closest && e.target.closest("#flight-scrubber-panel")) { hoveredPathEntry = null; return; }
    // Only suppressed while the panel is actually open (it visually covers
    // enough of the view that a hover preview underneath is pointless) --
    // tracking a body with the panel closed leaves the scene fully
    // interactive, hover previews included.
    if (lockedBodyName && infoPanelVisible) { hoverTip.style.display = "none"; hoveredPathEntry = null; return; }
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    let hit = null;
    for (const b of renderedBodies) {
      const dx = mx - b.sx, dy = my - b.sy;
      const hitR = Math.max(b.screenR, 6);
      if (dx * dx + dy * dy <= hitR * hitR) { hit = b; break; }
    }
    if (hit) {
      hoveredPathEntry = null;
      hoverTip.style.display = "block";
      hoverTip.style.left = (e.clientX + 14) + "px";
      hoverTip.style.top = (e.clientY + 14) + "px";
      hoverTip.innerHTML = `<strong>${hit.name}</strong><span style="color:var(--text-dim)"> · click to track</span>`;
      return;
    }
    // Marker miss: same path fallback as the click handler (hitTestPaths),
    // so hovering near a path previews -- via #hover-tip's name plus a
    // glow redrawn each frame (see the "Orbit paths" block in frame()) --
    // exactly what a click there would select, before it's committed.
    const pathHit = hitTestPaths(mx, my, 10);
    hoveredPathEntry = pathHit;
    if (pathHit) {
      hoverTip.style.display = "block";
      hoverTip.style.left = (e.clientX + 14) + "px";
      hoverTip.style.top = (e.clientY + 14) + "px";
      hoverTip.innerHTML = `<strong>${pathHit.name}</strong><span style="color:var(--text-dim)"> · click to track</span>`;
    } else {
      hoverTip.style.display = "none";
    }
  }

  /* ---- Locked satellite-data panel ---- */

  const lockedPanel = document.getElementById("locked-panel");
  const lockedPanelTitle = document.getElementById("locked-panel-title");
  const lockedPanelBody = document.getElementById("locked-panel-body");
  const lockedPanelClose = document.getElementById("locked-panel-close");
  const lockedPanelHeader = document.getElementById("locked-panel-header");

  // Hides the panel WITHOUT touching lockedBodyName/selectedFlightKey --
  // camera tracking (and the highlight ring/connector, and the flight
  // scrubber) continues on whatever was selected. Especially important on
  // mobile, where this panel is a full-screen modal: closing it to see the
  // animation again shouldn't also lose your target. Use "Stop tracking"
  // (camera-controls) to actually clear lockedBodyName -- see its own
  // comment: that's meant to be the ONLY way this happens. Shared by the
  // panel's own close button and the canvas's empty-space click (clicking
  // away from the panel to dismiss it is not the same gesture as
  // deliberately clicking "Stop tracking," and shouldn't have the same
  // effect -- it used to, via a plain lockBody(null) call, which silently
  // violated that "only way" invariant and dropped a selected flight the
  // moment its panel was dismissed by anything other than its own X).
  function closeInfoPanel() {
    const prevPanelVisible = infoPanelVisible;
    infoPanelVisible = false;
    syncPauseWithLockedPanel(prevPanelVisible, false);
    updateLockedPanelVisibility();
    updateScrubberInfoButton();
  }
  lockedPanelClose.addEventListener("click", closeInfoPanel);

  /* ---- Dashboard (full-viewport takeover; velocity hodograph is the
     first widget) ---- */

  const dashboardToggleBtn = document.getElementById("dashboard-toggle-btn");
  const dashboardPanel = document.getElementById("dashboard-panel");
  const dashboardPanelTitle = document.getElementById("dashboard-panel-title");
  const dashboardPanelClose = document.getElementById("dashboard-panel-close");
  // Two independent widget cards sharing the same draw/resize logic: the
  // primary (always-on, Sol-relative by default) and a second one shown
  // only during a real gravity-assist SOI transit (see
  // getHodographFrameOptions). Each bundles its own Canvas2D surface plus
  // last-known-size cache -- the two canvases are independent backing
  // stores, not something a single cache could share.
  function makeHodographWidget(suffix) {
    const canvas = document.getElementById(`hodograph-canvas${suffix}`);
    return {
      canvas, ctx: canvas.getContext("2d"),
      readout: document.getElementById(`hodograph-readout${suffix}`),
      emptyState: document.getElementById(`hodograph-empty-state${suffix}`),
      influenceBody: document.getElementById(`hodograph-influence-body${suffix}`),
      widgetEl: document.getElementById(`hodograph-widget${suffix}`),
      lastW: 0, lastH: 0,
    };
  }
  const hodographWidget1 = makeHodographWidget("");
  const hodographWidget2 = makeHodographWidget("-2");
  const hodographFrameToggle = document.getElementById("hodograph-frame-toggle");

  // Mirrors the main canvas's own resize() (devicePixelRatio-aware sizing)
  // -- needed since each hodograph canvas is an independent Canvas2D
  // surface with its own backing-store size, not something the main
  // resize() touches. Called every frame from drawHodograph (cheap no-op
  // below the resize threshold, via the last-known-size guard) rather
  // than only once at open time, since the panel is still animating into
  // place (translateY transition) right when it opens -- its final
  // layout size isn't necessarily settled on the very first frame.
  function resizeHodographCanvas(widget) {
    const rect = widget.canvas.getBoundingClientRect();
    if (rect.width === widget.lastW && rect.height === widget.lastH) return;
    widget.lastW = rect.width; widget.lastH = rect.height;
    const dpr = window.devicePixelRatio || 1;
    widget.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    widget.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    widget.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Desktop/laptop only for now -- mobile has enough screen-space pressure
  // already (see the button's own visibility toggle in
  // updateLockedPanelVisibility) that this needs a different treatment,
  // deferred rather than cramming the current design in.
  function openDashboard() {
    if (isMobileLayout) return;
    if (!lockedBodyName && !selectedFlightKey) return;
    if (lockedBodyName === "Sol" && !selectedFlightKey) return; // no hodograph -- Sol's velocity is [0,0,0] by construction
    dashboardVisible = true;
    document.body.classList.add("dashboard-active");
    // Only shift the scrubber up to clear the docked panel (see CSS) when
    // there's actually a flight/scrubber to shift -- a plain locked body
    // has no scrubber at all. Safe to read selectedFlightKey once here
    // (not per-frame): closeDashboard() unconditionally fires on any
    // lockBody/selectFlight call, so nothing can change what's selected
    // while the dashboard stays open.
    document.body.classList.toggle("dashboard-has-scrubber", !!selectedFlightKey);
    dashboardPanelTitle.textContent = selectedFlightKey ? FLIGHTS_RAW[selectedFlightKey].name : lockedBodyName;
    resizeHodographCanvas(hodographWidget1);
  }
  function closeDashboard() {
    if (!dashboardVisible) return;
    dashboardVisible = false;
    hodographFrameKey = 'default';
    hodographFrameToggle.innerHTML = '';
    _hodographToggleSig = null;
    document.body.classList.remove("dashboard-active", "dashboard-has-scrubber");
  }
  dashboardToggleBtn.addEventListener("click", () => { dashboardVisible ? closeDashboard() : openDashboard(); });
  dashboardPanelClose.addEventListener("click", closeDashboard);
  window.addEventListener("resize", () => {
    if (dashboardVisible) resizeHodographCanvas(hodographWidget1);
    // Dashboard is desktop/laptop only (see openDashboard's own comment).
    // Registered after resize()'s own top-of-file listener (line ~2983),
    // which updates isMobileLayout first -- listeners fire in
    // registration order, so isMobileLayout is already current by here.
    // Deliberately NOT done via updateMobileLayoutMode() itself: that
    // function runs synchronously during initial bootstrap (resize()'s
    // own unconditional call at the bottom of its setup block), well
    // before dashboardToggleBtn/lockedPanel and everything else this
    // needs even exist yet -- a real "Cannot access before
    // initialization" crash caught live, not hypothetical.
    if (isMobileLayout) {
      dashboardToggleBtn.classList.remove("visible");
      closeDashboard();
    } else {
      updateLockedPanelVisibility();
    }
  });

  // Speed magnitude in km/s from a hodograph-space velocity component --
  // vx/vy/the whole circle are drawn in whatever unit getHodographElements
  // resolved them in (AU/day for GM-driven bodies, km/day for moons, see
  // `unitsAreKm`), so only the READOUT text needs a real unit conversion;
  // the drawing itself never needs to know or care which unit it's in.
  function hodographSpeedKmS(vMag, unitsAreKm) {
    return unitsAreKm ? (vMag / SEC_PER_DAY) : (vMag * AU_KM / SEC_PER_DAY);
  }
  // Inverse of the above -- a km/s value back into whatever native unit
  // (AU/day or km/day) the current hodograph's circle/scale math is in,
  // needed to convert a chosen tick VALUE (km/s) into a pixel RADIUS.
  function hodographKmSToNative(kmS, unitsAreKm) {
    return unitsAreKm ? (kmS * SEC_PER_DAY) : (kmS * SEC_PER_DAY / AU_KM);
  }
  // A "nice" round tick spacing (1/2/5 x10^n) close to maxValue/targetCount
  // -- standard axis-labeling approach so gridlines land on readable
  // numbers (10, 20, 50 km/s) instead of arbitrary fractions.
  function niceTickStep(maxValue, targetCount) {
    if (!(maxValue > 0)) return 1;
    const raw = maxValue / targetCount;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const niceNorm = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
    return niceNorm * mag;
  }

  function hodographEmptyMessage(h) {
    if (!h) return "Nothing to show a hodograph for.";
    if (h.empty === "not-in-transit") return `Not currently in transit\n(launches ${h.launchDate}, arrives ${h.arrivalDate})`;
    if (h.empty === "no-shape") return "No reliable orbit shape available for this segment.";
    if (h.empty === "loiter") return `${h.legLabel} — no meaningful orbital hodograph here.`;
    return "No hodograph available right now.";
  }

  // Renders (or hides) the primary widget's reference-frame toggle -- only
  // relevant for a body-orbit leg (geocentric_orbit) that offers more than
  // one valid frame, e.g. planet-relative vs Sol-relative. The flyby SOI-
  // transit case never populates this (getHodographFrameOptions' extras
  // there are all 'flyby:'-prefixed and drive the SECOND widget instead --
  // see the per-frame call site). Rebuilds the DOM only when the actual
  // set of offered keys changes (cheap no-op most frames); the active-
  // state highlight updates every frame regardless, since that's just a
  // class toggle.
  let _hodographToggleSig = null;
  function updateHodographFrameToggle(options) {
    const nonFlybyExtras = options.extras.filter((o) => !o.key.startsWith('flyby:'));
    if (nonFlybyExtras.length === 0) {
      if (_hodographToggleSig !== null) {
        hodographFrameToggle.innerHTML = '';
        _hodographToggleSig = null;
      }
      return;
    }
    const all = [options.primary, ...nonFlybyExtras];
    const sig = all.map((o) => o.key).join('|');
    if (sig !== _hodographToggleSig) {
      _hodographToggleSig = sig;
      hodographFrameToggle.innerHTML = '';
      all.forEach((opt) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'hodograph-frame-btn';
        btn.textContent = opt.label;
        btn.addEventListener('click', () => { hodographFrameKey = opt.key; });
        hodographFrameToggle.appendChild(btn);
      });
    }
    Array.from(hodographFrameToggle.children).forEach((btn, i) => {
      btn.classList.toggle('active', all[i].key === hodographFrameKey);
    });
  }

  // The velocity hodograph: for any 2-body Keplerian orbit, the velocity
  // vector's tip traces a perfect circle -- radius R = n*a/sqrt(1-e^2)
  // (elliptical) or GM/h (hyperbolic), centered at (0, e*R) in the orbit's
  // own perifocal frame (see hodographCircle's own comment for the sign
  // subtlety on the hyperbolic branch). The line from the origin to the
  // live point IS the instantaneous speed -- the single clearest teaching
  // element here, since the circle itself never changes shape mid-orbit
  // but that line's length visibly grows/shrinks as the point sweeps
  // around it.
  function drawHodograph(daysSinceEpoch, widget, frameKey) {
    const { canvas: hodographCanvas, ctx: hodographCtx, readout: hodographReadout,
      emptyState: hodographEmptyState, influenceBody: hodographInfluenceBody } = widget;
    const h = getHodographElements(daysSinceEpoch, frameKey);
    if (!h || h.empty) {
      hodographEmptyState.style.display = "flex";
      hodographCanvas.style.display = "none";
      hodographReadout.style.display = "none";
      hodographEmptyState.textContent = hodographEmptyMessage(h);
      hodographInfluenceBody.textContent = "";
      return;
    }
    hodographEmptyState.style.display = "none";
    hodographCanvas.style.display = "block";
    hodographReadout.style.display = "block";
    hodographInfluenceBody.textContent = h.influenceBody;
    resizeHodographCanvas(widget); // see its own comment -- must run AFTER display is set to "block" and the readout populated on a prior call, so clientHeight reflects final layout

    const circ = hodographCircle(h);
    const pt = hodographVelocity(h, daysSinceEpoch);

    const w = hodographCanvas.clientWidth, viewH = hodographCanvas.clientHeight;
    hodographCtx.clearRect(0, 0, w, viewH);
    if (w < 10 || viewH < 10) return; // not laid out yet (first-frame race)

    // Fit the circle AND the origin (always drawn, since the origin/
    // speed-line is the whole point) with margin for axis/tick labels.
    // Margin shrinks (down to a hard floor of 4px, never negative) on a
    // cramped canvas rather than assuming a fixed value always fits -- a
    // short/phone-landscape mobile viewport can leave the canvas only
    // ~30px tall, and a fixed margin bigger than half the canvas would
    // make `scale` negative, which crashes ctx.arc with a "negative
    // radius" error (caught live via Playwright, not hypothetical).
    // Also deliberately leaves the circle short of the canvas edges (not
    // just enough for tick labels) -- a circle that always fills the
    // frame regardless of the body's real speed was flagged as
    // misleading (Mercury and Saturn rendered as literally the same
    // diameter); the tick rings below are the actual fix for that, but
    // a bit of visible empty margin also just reads as "not maxed out."
    const minX = Math.min(-circ.R, 0), maxX = Math.max(circ.R, 0);
    const minY = Math.min(circ.cy - circ.R, 0), maxY = Math.max(circ.cy + circ.R, 0);
    const margin = Math.max(4, Math.min(46, w / 4, viewH / 4));
    const scale = Math.min((w - margin * 2) / (maxX - minX || 1), (viewH - margin * 2) / (maxY - minY || 1));
    const originX = w / 2 - ((minX + maxX) / 2) * scale;
    const originY = viewH / 2 + ((minY + maxY) / 2) * scale; // +vy draws upward, matching worldToScreen's own Y-flip convention
    const toScreen = (vx, vy) => [originX + vx * scale, originY - vy * scale];

    // Axes through the origin.
    hodographCtx.strokeStyle = "rgba(255,255,255,0.15)";
    hodographCtx.lineWidth = 1;
    hodographCtx.beginPath();
    hodographCtx.moveTo(0, originY); hodographCtx.lineTo(w, originY);
    hodographCtx.moveTo(originX, 0); hodographCtx.lineTo(originX, viewH);
    hodographCtx.stroke();

    // Scale rings, centered on the ORIGIN (v=0) not the circle -- distance
    // from the origin is speed, so these are what actually make speed
    // readable as a number from the picture itself, not just relative
    // circle size (which is auto-fit per body and so, on its own, made
    // Mercury's and Saturn's hodographs look like the same magnitude
    // despite a ~5x real speed difference -- flagged directly by the
    // user). Spacing is a "nice" round km/s number close to a 3-ring fit
    // against the circle's own farthest point from the origin.
    const farKmS = hodographSpeedKmS(Math.abs(circ.cy) + circ.R, h.unitsAreKm);
    const tickStepKmS = niceTickStep(farKmS, 3);
    hodographCtx.strokeStyle = "rgba(255,255,255,0.12)";
    hodographCtx.fillStyle = "rgba(255,255,255,0.4)";
    hodographCtx.font = "9px sans-serif";
    hodographCtx.lineWidth = 1;
    for (let tick = tickStepKmS; tick <= farKmS * 1.05; tick += tickStepKmS) {
      const rPx = hodographKmSToNative(tick, h.unitsAreKm) * scale;
      hodographCtx.beginPath();
      hodographCtx.arc(originX, originY, rPx, 0, 2 * Math.PI);
      hodographCtx.stroke();
      // Label along a diagonal so it rarely collides with the axes, the
      // speed line, or the "v = 0" label near the origin itself.
      const lx = originX + rPx * Math.SQRT1_2, ly = originY - rPx * Math.SQRT1_2;
      hodographCtx.fillText(`${tick.toFixed(tickStepKmS < 1 ? 1 : 0)}`, lx + 3, ly - 3);
    }

    // The circle itself.
    const [ccx, ccy] = toScreen(circ.cx, circ.cy);
    hodographCtx.strokeStyle = "#6ba3ff";
    hodographCtx.lineWidth = 1.5;
    hodographCtx.beginPath();
    hodographCtx.arc(ccx, ccy, circ.R * scale, 0, 2 * Math.PI);
    hodographCtx.stroke();

    // Origin marker ("v=0").
    hodographCtx.fillStyle = "rgba(255,255,255,0.5)";
    hodographCtx.beginPath();
    hodographCtx.arc(originX, originY, 2.5, 0, 2 * Math.PI);
    hodographCtx.fill();
    hodographCtx.font = "11px sans-serif";
    hodographCtx.fillText("v = 0", originX + 6, originY - 6);

    // Speed line (origin -> live point) -- its length IS the current speed.
    const [px, py] = toScreen(pt.vx, pt.vy);
    hodographCtx.strokeStyle = "#e8c15a";
    hodographCtx.lineWidth = 1.5;
    hodographCtx.beginPath();
    hodographCtx.moveTo(originX, originY);
    hodographCtx.lineTo(px, py);
    hodographCtx.stroke();

    // Live point.
    hodographCtx.fillStyle = "#e8c15a";
    hodographCtx.beginPath();
    hodographCtx.arc(px, py, 4, 0, 2 * Math.PI);
    hodographCtx.fill();

    // Readout: current speed, e, periapsis/apoapsis speed, and the ring
    // spacing (so the on-canvas tick labels' unit is stated once rather
    // than repeated at every ring). |cy| +/- R are the farthest/nearest
    // points on the circle from the origin -- always correct regardless
    // of which branch's sign convention cy came from. Lives in its own
    // block below the canvas now (not an overlay on top of it) -- the
    // overlay version was flagged as overlapping the circle itself once
    // the circle got large enough to matter.
    const speedKmS = hodographSpeedKmS(Math.hypot(pt.vx, pt.vy), h.unitsAreKm);
    const periapsisKmS = hodographSpeedKmS(Math.abs(circ.cy) + circ.R, h.unitsAreKm);
    const peakLine = h.e < 1
      ? `peri ${periapsisKmS.toFixed(1)} / apo ${hodographSpeedKmS(Math.abs(Math.abs(circ.cy) - circ.R), h.unitsAreKm).toFixed(1)} km/s`
      : `peri ${periapsisKmS.toFixed(1)} km/s`;
    const lines = [
      `${speedKmS.toFixed(2)} km/s`,
      `e = ${h.e.toFixed(3)} · ${peakLine}`,
      `rings every ${tickStepKmS.toFixed(tickStepKmS < 1 ? 1 : 0)} km/s`,
    ];
    if (h.legLabel) lines.push(h.legLabel);
    hodographReadout.innerHTML = lines.map((l) => `<div>${l}</div>`).join("");
  }

  // "Missions here" (missionsToHereHtml) and "Destinations"
  // (flightDestinationsHtml) links are rebuilt into lockedPanelBody's
  // innerHTML each time the panel's content is (re)rendered (see
  // drawLockedPanelConnector -- just once per lock change, not every
  // frame), so listening on the individual <span> elements would mean
  // re-attaching on every such rebuild -- delegate to the stable
  // container instead, bound once here, same as every other one-time
  // listener in this block. Explicitly closes the current panel
  // (lockBody(null)) before opening the new target as two separate state
  // transitions, rather than switching lockedBodyName directly from one
  // value to another. This turned out not to be what was actually
  // breaking the links (the real cause was the panel rebuilding on every
  // single frame regardless of pause state -- see drawLockedPanelConnector's
  // comment), but the two-step transition is harmless and left in place.
  lockedPanelBody.addEventListener("click", (e) => {
    const jumpBtn = e.target.closest(".lp-jump-btn");
    if (jumpBtn) {
      jumpToLaunch(jumpBtn.dataset.jumpToLaunch);
      return;
    }
    const collapsibleHeading = e.target.closest(".lp-collapsible-heading");
    if (collapsibleHeading) {
      collapsibleHeading.parentElement.classList.toggle("lp-collapsed");
      return;
    }
    const link = e.target.closest(".lp-mission-link");
    if (!link) return;
    lockBody(null); // step 1: close whatever's currently open
    if (link.dataset.flightKey) {
      selectFlight(link.dataset.flightKey); // step 2: open the flight (selectFlight itself locks its body)
    } else if (link.dataset.bodyName) {
      lockBody(link.dataset.bodyName, { toggleIfSame: false }); // step 2: open the body
    }
  });

  // Explicit, opt-in date jump -- see the "Jump to launch" button's comment
  // in formatLockedPanelContent for why this is separate from selectFlight.
  // Lands one day before launch (not exactly on it) so pressing Play
  // immediately afterward shows the actual liftoff happen, rather than
  // starting the clock already mid-launch-day.
  function jumpToLaunch(key) {
    const raw = FLIGHTS_RAW[key];
    if (!raw) return;
    const { launchDays } = getFlightDates(key);
    simDate = dateFromDaysSinceJ2000(launchDays - 1);
    dateInput.value = dateInputValue(simDate);
    updateURLParams({ date: dateInput.value });
    setPaused(true);
    if (selectedFlightKey !== key) {
      selectedFlightKey = key;
      buildFlightsLegend();
      buildFlightScrubber();
    }
    if (!isMultiLeg(raw)) getSolvedFlight(key);
  }

  // Drag-to-reposition: mousedown on the header (but not the close button)
  // starts a drag; mousemove writes directly to lockedPanelPos and the
  // DOM style right here, event-driven, since the frame loop no longer
  // touches the panel's position at all once it's been placed (see
  // drawLockedPanelConnector). mousemove/mouseup are on window, not the
  // header, so the drag doesn't break if the cursor outruns the (small)
  // header element mid-drag.
  let lockedPanelDrag = null; // { startMouseX, startMouseY, startX, startY } while dragging
  lockedPanelHeader.style.cursor = "grab";
  lockedPanelHeader.addEventListener("mousedown", (e) => {
    if (isMobileLayout) return; // mobile uses the touch snap-drag below instead
    if (e.target === lockedPanelClose) return;
    if (!lockedPanelPos) return; // nothing locked yet, nothing to drag
    e.preventDefault();
    lockedPanelDrag = {
      startMouseX: e.clientX, startMouseY: e.clientY,
      startX: lockedPanelPos.x, startY: lockedPanelPos.y
    };
    lockedPanelHeader.style.cursor = "grabbing";
  });
  window.addEventListener("mousemove", (e) => {
    if (!lockedPanelDrag) return;
    const panelRect = lockedPanel.getBoundingClientRect();
    let px = lockedPanelDrag.startX + (e.clientX - lockedPanelDrag.startMouseX);
    let py = lockedPanelDrag.startY + (e.clientY - lockedPanelDrag.startMouseY);
    px = Math.max(8, Math.min(px, viewW - panelRect.width - 8));
    py = Math.max(8, Math.min(py, viewH - panelRect.height - 8));
    lockedPanelPos = { x: px, y: py };
    lockedPanel.style.left = px + "px";
    lockedPanel.style.top = py + "px";
  });
  window.addEventListener("mouseup", () => {
    if (!lockedPanelDrag) return;
    lockedPanelDrag = null;
    lockedPanelHeader.style.cursor = "grab";
  });

  // Mobile: no drag-to-dismiss or peek/full snapping -- the panel is a
  // full-screen modal now (see body.mobile #locked-panel in the CSS),
  // and the whole point of "make sure it covers things and we don't
  // allow interactions through without closing" is that closing is
  // deliberate (the close button only), not something an accidental
  // swipe on the header could trigger.

  const resetViewBtn = document.getElementById("reset-view-btn");
  const stopTrackingBtn = document.getElementById("stop-tracking-btn");

  resetViewBtn.addEventListener("click", () => {
    // Restores rotation, zoom, and pan to their startup defaults. This is
    // the fix for getting visually stuck near the ecliptic (pitch close
    // to 0, looking edge-on) or any other disorienting yaw/pitch/zoom
    // combination -- it does NOT clear a locked/tracked body, since being
    // lost in the camera and tracking a body are independent problems;
    // resetting the view while still tracking just re-centers cleanly on
    // whatever is currently locked, which is also the desired behavior.
    yaw = DEFAULT_YAW;
    pitch = DEFAULT_PITCH;
    pxPerAU = DEFAULT_PX_PER_AU;
    if (!lockedBodyName) {
      camX = 0;
      camY = 0;
    }
    // If a body IS locked, camX/camY are recomputed every frame by the
    // follow logic regardless, so no explicit reset is needed there.
  });

  stopTrackingBtn.addEventListener("click", () => {
    lockBody(null);
  });

  function updateLockedPanelVisibility() {
    // "flex", not "block" -- #locked-panel is a column flex container (see
    // CSS) so its header stays put while a too-tall body scrolls under its
    // own max-height, rather than the whole panel just growing past the
    // viewport edge for a flight with a long statusNote + asset gallery.
    lockedPanel.style.display = (lockedBodyName && infoPanelVisible) ? "flex" : "none";
    // Deliberately still keyed on lockedBodyName alone (not infoPanelVisible)
    // -- "Stop tracking" needs to stay reachable even while the panel is
    // closed but a body/flight is still being tracked, since it's the only
    // way to fully clear lockedBodyName once the panel's own close button
    // no longer does that.
    stopTrackingBtn.classList.toggle("visible", !!lockedBodyName);
    // Same "reachable independent of the info panel's own open/closed
    // state" reasoning as Stop tracking above, plus: hidden outright
    // (not just disabled) on mobile -- see openDashboard's own comment on
    // why this feature is desktop/laptop-only for now -- and for Sol,
    // whose velocity is [0,0,0] by construction in this heliocentric
    // model, so a hodograph is meaningless for it.
    dashboardToggleBtn.classList.toggle("visible", !!lockedBodyName && lockedBodyName !== "Sol" && !isMobileLayout);
    if (isMobileLayout) closeDashboard();
  }

  // Rocket/spacecraft/lander thumbnail row for a flight's locked panel.
  // raw.assets (set per-flight in data/flights/<key>.json) is keyed by
  // "rocket"/"spacecraft"/"lander" (lander omitted where not applicable),
  // each { title, infoUrl, localImage }. infoUrl is the official
  // NASA/ESA/agency page where one was found, Wikipedia otherwise -- either
  // way it's where the thumbnail links out to. localImage is a path
  // relative to index.html (e.g. "images/rockets/atlas_v.jpg"); missing
  // images still render a labeled placeholder tile rather than being
  // silently dropped, since the info link itself is still useful.
  // "image" is the single-tile case used for planets/Sol/small bodies (see
  // BODY_INFO); it's harmless alongside the flight-specific keys since
  // assetGalleryHtml only renders whichever keys are actually present on
  // the assets object passed in.
  const ASSET_ORDER = ["rocket", "spacecraft", "lander", "image"];
  // No "credit"/"source" field exists in the data yet -- every asset only
  // carries title/infoUrl/localImage -- so attribution is derived from
  // infoUrl's hostname rather than requiring a data migration across every
  // flight/body JSON file. Falls back to the bare hostname for anything
  // not explicitly named here (still real attribution, just unstyled).
  function sourceLabel(url) {
    let host;
    try { host = new URL(url).hostname.replace(/^www\./, ""); }
    catch { return "Source"; }
    if (host.endsWith("nasa.gov")) return "NASA";
    if (host === "en.wikipedia.org") return "Wikipedia";
    if (host.endsWith("esa.int")) return "ESA";
    return host;
  }

  function assetGalleryHtml(assets) {
    if (!assets) return "";
    const tiles = ASSET_ORDER
      .filter((k) => assets[k])
      .map((k) => {
        const a = assets[k];
        // localImage is stored relative to data/ (e.g. "images/rockets/atlas_v.png"
        // matches the real path data/images/rockets/atlas_v.png on disk) -- but the
        // <img> src is resolved relative to index.html at the project root, so it
        // needs the "data/" prefix added here. Never verified in a real browser
        // until now: every asset across every flight/body JSON file had this same
        // silent 404, invisible to the headless test harness since it only checks
        // the rendered HTML string, never actually fetches the image.
        // No loading="lazy" -- these tiles only ever exist inside the
        // locked panel, which itself only gets created after a deliberate
        // click (never many dozens on a page at once, the actual case
        // lazy-loading exists for), so there's no real cost to eager
        // loading. Removed after several images were reported not
        // rendering with no data-side cause found (paths/files all
        // verified correct) -- lazy-loading images inside a
        // resizable, `position: fixed`, nested-scroll container like this
        // panel is a known source of native browser IntersectionObserver
        // flakiness, and eager loading eliminates that whole class of
        // failure regardless of whether it was the actual cause here.
        // Cache-bust the same way data/*.json fetches already do (BUILD_VERSION)
        // -- these are plain static <img src> requests with no query param at
        // all until now, so a browser could keep serving stale image bytes at
        // an unchanged path indefinitely even after the real file on disk was
        // replaced (found while swapping Akatsuki's spacecraft photo).
        const img = a.localImage
          ? `<img src="data/${a.localImage}?v=${BUILD_VERSION}" alt="${a.title}">`
          : `<div class="lp-asset-noimg">${a.title}</div>`;
        // Caption (the asset's real title) and a visible attribution/
        // source line are both always-on text, not just an invisible
        // click target on the thumbnail -- the whole tile still links out
        // to infoUrl on click, this just makes that discoverable without
        // having to guess or hover.
        return `<a class="lp-asset" href="${a.infoUrl}" target="_blank" rel="noopener noreferrer">${img}<span class="lp-asset-caption">${a.title}</span><span class="lp-asset-source">${sourceLabel(a.infoUrl)} ↗</span></a>`;
      });
    if (tiles.length === 0) return "";
    return `<div class="lp-assets">${tiles.join("")}</div>`;
  }

  // A single prominent outbound link near the top of the panel, distinct
  // from the per-image attribution in the asset gallery below -- addresses
  // "click to learn more about the subject of this whole panel," not just
  // "where did this thumbnail come from." Prefers the spacecraft asset for
  // flights (its infoUrl is the mission's own page, unlike the rocket
  // asset which just points at the generic launch-vehicle article) and the
  // body's own image asset otherwise.
  function learnMoreHtml(assets) {
    if (!assets) return "";
    const order = ["spacecraft", "image", "lander", "rocket"];
    let url = null;
    for (const k of order) { if (assets[k] && assets[k].infoUrl) { url = assets[k].infoUrl; break; } }
    if (!url) return "";
    return `<a class="lp-learn-more" href="${url}" target="_blank" rel="noopener noreferrer">Learn more at ${sourceLabel(url)} ↗</a>`;
  }

  // Full-width block (heading + paragraph) for prose content -- see the
  // .lp-section CSS comment for why this exists separately from addRow's
  // two-column key/value layout (which wastes its whole key column on
  // every wrapped line of a long paragraph).
  function lpSectionHtml(heading, bodyHtml) {
    return `<div class="lp-section"><div class="lp-section-heading">${heading}</div><div class="lp-section-body">${bodyHtml}</div></div>`;
  }

  // Renders a body's physical size for the info panel. Most bodies here
  // (planets, round moons, dwarf planets) are spherical enough that a
  // single radius/diameter says everything worth saying. But several
  // small bodies in this app's catalog are dramatically NOT spherical --
  // 67P's bilobed "rubber duck" nucleus, Itokawa's elongated shape,
  // Toutatis's contact-binary "peanut" -- and describing those with a
  // single radius (as if they were round) would be actively misleading,
  // not just imprecise. dimensionsKm (real published long/intermediate/
  // [polar] axis measurements, set per-body in SMALL_BODIES' meta) is
  // shown instead when present; a plain diameter otherwise.
  //
  // Values under ~2 km are shown in meters, not km -- real mission
  // dimensions for small asteroids/comets are always quoted that way
  // ("535 x 294 x 209 m" for Itokawa, never "0.535 x 0.294 x 0.209 km"),
  // and this app's own small-body radii span more than 4 orders of
  // magnitude (30 m to 1,400+ km), so one fixed unit would read badly
  // at one end or the other.
  function formatBodySize(radiusKm, dimensionsKm, shapeNote) {
    let sizeText;
    if (dimensionsKm && dimensionsKm.length) {
      const useMeters = Math.max(...dimensionsKm) < 2;
      const scale = useMeters ? 1000 : 1;
      const unit = useMeters ? "m" : "km";
      sizeText = dimensionsKm.map((d) => Math.round(d * scale).toLocaleString()).join(" × ") + " " + unit;
    } else {
      const diameterKm = radiusKm * 2;
      const useMeters = diameterKm < 2;
      const scale = useMeters ? 1000 : 1;
      const unit = useMeters ? "m" : "km";
      sizeText = `${Math.round(diameterKm * scale).toLocaleString()} ${unit} diameter`;
    }
    return shapeNote ? `${sizeText} (${shapeNote})` : sizeText;
  }

  // Flight keys whose actual destination (see flightEndpoints -- the FINAL
  // leg's target for multi-leg flights, not any intermediate gravity-assist
  // stop) is this body. Small bodies already carry a curated, authoritative
  // list (SMALL_BODIES[key].targetOfFlights, also used for visibility
  // widening) so this reuses that directly rather than re-deriving it;
  // planets have no such field, so their list is derived fresh from every
  // flight's real endpoint. Cheap either way (at most 38 flights, no
  // ephemeris or Lambert calls), so no memoization -- fine to recompute
  // every frame like the rest of formatLockedPanelContent already does.
  function getMissionsToBody(bodyName) {
    for (const key in SMALL_BODIES) {
      if (SMALL_BODIES[key].name === bodyName) {
        return SMALL_BODIES[key].targetOfFlights.filter((k) => FLIGHTS_RAW[k]);
      }
    }
    return FLIGHTS_ORDER.filter((key) => flightEndpoints(FLIGHTS_RAW[key]).destinationBody === bodyName);
  }

  // Clickable list of missions whose destination is this body -- see the
  // delegated click listener on lockedPanelBody (below) for how these
  // actually select the flight; empty string (no section at all) if none.
  function missionsToHereHtml(bodyName) {
    const keys = getMissionsToBody(bodyName);
    if (keys.length === 0) return "";
    const links = keys
      .map((k) => `<span class="lp-mission-link" data-flight-key="${k}">${FLIGHTS_RAW[k].name}</span>`)
      .join("");
    return `<div class="lp-section"><div class="lp-section-heading">Missions here</div><div class="lp-mission-links">${links}</div></div>`;
  }

  // The reverse of getMissionsToBody: every planet/small body a given
  // flight's legs actually touch (launch/arrival/gravity-assist stops),
  // in chronological order (a Set preserves insertion order, and legs are
  // walked in their real sequence) -- Lagrange-point loiters and
  // geocentric_orbit legs are deliberately skipped, since neither has a
  // lockable panel to link to (a loiter's primaryBody/a geocentric leg's
  // surrounding lambert legs already cover the real body either way).
  // Named "destinations", not "visited" -- deliberately tense-neutral,
  // since this list is the same for a mission that's already arrived and
  // one still en route (e.g. MMX, JUICE): both cases are "where this
  // flight's trajectory goes", not "where it has already been".
  // Resolves a raw body-reference KEY, as it appears in flight leg JSON
  // (a planet name, 'Moon', a SMALL_BODIES key, or a "Planet_L1"-style
  // Lagrange-point reference -- same pattern describeLegBody matches), to
  // the real display name lockedBodyName/SMALL_BODIES[key].name use.
  // Anything else (a {fixedPos:[...]} waypoint object, an unrecognized
  // key) resolves to null. Shared so a Lagrange-point loiter (e.g.
  // ESCAPADE/Chang'e 2's "Earth_L2") resolves to its actual planet the
  // same way everywhere this matters.
  function resolveBodyKeyName(k) {
    if (!k || typeof k !== 'string') return null;
    if (PLANET_ORDER.includes(k)) return k;
    if (k === 'Moon') return 'Moon';
    if (SMALL_BODIES[k]) return SMALL_BODIES[k].name;
    const lpMatch = k.match(/^([A-Za-z]+)_(L[1245])$/);
    if (lpMatch && PLANET_ORDER.includes(lpMatch[1])) return lpMatch[1];
    return null;
  }

  function getFlightDestinations(key) {
    const raw = FLIGHTS_RAW[key];
    const rawKeys = new Set();
    if (isMultiLeg(raw)) {
      raw.legs.forEach((leg) => {
        if (leg.type === 'lambert') { rawKeys.add(leg.fromBody); rawKeys.add(leg.toBody); }
        else if (leg.type === 'gravity_assist') { rawKeys.add(leg.body); }
      });
    } else {
      rawKeys.add(raw.launchBody);
      rawKeys.add(raw.destinationBody);
    }
    // Dedupe by resolved NAME, not just raw key -- e.g. a genuine Earth
    // gravity-assist leg (raw key "Earth") and an Earth_L1/L2 loiter (raw
    // key "Earth_L2") are different raw keys that both resolve to the
    // same display name "Earth", which a plain Set on rawKeys alone
    // wouldn't catch.
    const names = new Set();
    rawKeys.forEach((k) => {
      const name = resolveBodyKeyName(k);
      if (name) names.add(name);
    });
    return [...names];
  }

  // Clickable list of this flight's destinations -- same .lp-mission-link
  // styling as missionsToHereHtml's links, distinguished by data-body-name
  // (lock a body) vs data-flight-key (select a flight) in the shared
  // delegated click listener below.
  function flightDestinationsHtml(flightKey) {
    const names = getFlightDestinations(flightKey);
    if (names.length === 0) return "";
    const links = names
      .map((n) => `<span class="lp-mission-link" data-body-name="${n}">${n}</span>`)
      .join("");
    return `<div class="lp-section"><div class="lp-section-heading">Destinations</div><div class="lp-mission-links">${links}</div></div>`;
  }

  // Missions that fly continuous low-thrust (ion) propulsion instead of
  // coasting between chemical burns between flybys -- already called out
  // in each of these four missions' own statusNote text. The Lambert arcs
  // this simulator draws for their cruise legs are a simplified stand-in
  // for that smooth, continuous-thrust path, not a literal coast; the
  // Flight profile section below says so explicitly for these.
  const ION_THRUST_MISSIONS = new Set(['dawn', 'hayabusa', 'hayabusa2', 'bepicolombo', 'deep_space_1']);

  // Resolve any of the several shapes a leg's body/fromBody/toBody/location
  // field can take (a PLANET_META key, a lowercase SMALL_BODIES key, an
  // "Earth_L1"/"Earth_L2" Lagrange-point string, a real recorded {fixedPos}
  // waypoint -- see getBodyPositionAtDays, which handles the same shapes
  // for rendering) into a human-readable name plus that body's legend
  // color, so the Flight profile timeline below can show a colored dot
  // that ties each line back to the same body in the legend/3D scene.
  function describeLegBody(bodyRef) {
    if (bodyRef && typeof bodyRef === 'object' && bodyRef.fixedPos) {
      return { name: 'a recorded waypoint', color: null };
    }
    const lpMatch = typeof bodyRef === 'string' && bodyRef.match(/^([A-Za-z]+)_(L[1245])$/);
    if (lpMatch) {
      const planet = lpMatch[1], lp = lpMatch[2];
      return { name: `${planet}–${lp}`, color: PLANET_META[planet] ? PLANET_META[planet].color : null };
    }
    if (PLANET_META[bodyRef]) return { name: bodyRef, color: PLANET_META[bodyRef].color };
    if (bodyRef === 'Moon') return { name: 'Moon', color: MOON_META.color };
    if (SMALL_BODIES[bodyRef]) return { name: SMALL_BODIES[bodyRef].name, color: SMALL_BODIES[bodyRef].meta.color };
    if (bodyRef === 'Sol' || bodyRef === 'Sun') return { name: 'Sol', color: SUN_COLOR };
    return { name: String(bodyRef), color: null };
  }

  // A gravity assist changes speed at essentially one point in the orbit
  // (near the flyby planet) -- that point's own distance from the Sun
  // barely moves, but the orbit's total energy changes, which reshapes the
  // OTHER side: braking near the far point (aphelion) pulls the near point
  // (perihelion) in closer to the Sun; boosting near the near point pushes
  // the far point out. This is what actually makes a "small" few-km/s
  // change matter -- it shows up as a large shift on whichever side of the
  // orbit the flyby ISN'T at, which is why PSP's few-km/s Venus brakes
  // compound into a perihelion that ends up deep inside Mercury's orbit.
  function apsisAU(a, e) {
    return { q: a * (1 - e), Q: e < 1 ? a * (1 + e) : null };
  }
  function periodDaysFor(a, e) {
    return (e < 1 && a > 0) ? 2 * Math.PI * Math.sqrt(a * a * a / GM_SUN_AU3_DAY2) : null;
  }
  function orbitShapeChangeHtml(aBeforeAU, eBefore, aAfterAU, eAfter) {
    const before = apsisAU(aBeforeAU, eBefore);
    const after  = apsisAU(aAfterAU, eAfter);
    const dQ = (before.Q !== null && after.Q !== null) ? Math.abs(after.Q - before.Q) : -1;
    const dq = Math.abs(after.q - before.q);

    let apsisText;
    if (dQ > dq) {
      apsisText = after.Q === null
        ? `aphelion ${before.Q.toFixed(3)} AU &rarr; unbound (this orbit now escapes the Sun's pull entirely)`
        : `aphelion ${before.Q.toFixed(3)} &rarr; ${after.Q.toFixed(3)} AU`;
    } else {
      apsisText = `perihelion ${before.q.toFixed(3)} &rarr; ${after.q.toFixed(3)} AU`;
    }

    const periodBefore = periodDaysFor(aBeforeAU, eBefore);
    const periodAfter  = periodDaysFor(aAfterAU, eAfter);
    let periodText = "";
    if (periodBefore !== null && periodAfter !== null) {
      periodText = `, orbital period ${periodBefore.toFixed(0)} &rarr; ${periodAfter.toFixed(0)} days`;
    } else if (periodBefore !== null && periodAfter === null) {
      periodText = `, and it's no longer a closed loop around the Sun at all`;
    }
    return ` (${apsisText}${periodText})`;
  }

  function legTimelineItemHtml(color, html) {
    const dot = color
      ? `<span class="lp-timeline-dot" style="background:${color}"></span>`
      : `<span class="lp-timeline-dot lp-timeline-dot-none"></span>`;
    return `<div class="lp-timeline-item">${dot}<span class="lp-timeline-text">${html}</span></div>`;
  }

  // Shared leg-walker: turns raw.legs into one entry per real EVENT,
  // collapsing a run of consecutive geocentric_orbit legs around the same
  // primary into one entry (Aditya-L1's 5 successive perigee-raising burns
  // would otherwise read as 5 nearly-identical lines/markers). Both
  // flightProfileHtml's prose timeline AND the flight-scrubber's event
  // markers (buildScrubberEvents, below) consume this SAME walk rather
  // than each re-parsing raw.legs separately -- letting the two views of
  // "what happened on this flight" drift out of sync would be a real bug
  // risk. dDays/aDays are both days-since-J2000; for an instantaneous leg
  // (gravity_assist) they're equal. A plain lambert leg is included too
  // (flightProfileHtml needs its coast text) -- callers that only want
  // marker-worthy events filter it out themselves.
  function buildLegEntries(flightKey) {
    const raw = FLIGHTS_RAW[flightKey];
    if (!raw.legs || raw.legs.length === 0) return [];
    const legs = raw.legs;
    const gaByLegIndex = {};
    getGAEvents(flightKey).forEach((ev) => { gaByLegIndex[ev.legIndex] = ev; });

    const entries = [];
    let prevArrivalDays = daysSinceJ2000(parseFlightDate(legs[0].departDate || legs[0].date));
    let i = 0;
    while (i < legs.length) {
      const leg = legs[i];

      if (leg.type === 'lambert') {
        const dDays = daysSinceJ2000(parseFlightDate(leg.departDate));
        const aDays = daysSinceJ2000(parseFlightDate(leg.arrivalDate));
        entries.push({ kind: 'lambert', legIndex: i, leg, dDays, aDays });
        prevArrivalDays = aDays;
        i++;

      } else if (leg.type === 'gravity_assist') {
        const d = daysSinceJ2000(parseFlightDate(leg.date));
        entries.push({ kind: 'gravity_assist', legIndex: i, leg, ev: gaByLegIndex[i], dDays: d, aDays: d });
        prevArrivalDays = d;
        i++;

      } else if (leg.type === 'geocentric_orbit') {
        let j = i;
        while (j < legs.length && legs[j].type === 'geocentric_orbit' && legs[j].primaryBody === leg.primaryBody) j++;
        const last = legs[j - 1];
        const dDays = daysSinceJ2000(parseFlightDate(leg.departDate));
        const aDays = daysSinceJ2000(parseFlightDate(last.arrivalDate));
        entries.push({ kind: 'geocentric_orbit', legIndexStart: i, legIndexEnd: j - 1,
          firstLeg: leg, lastLeg: last, burnCount: j - i, dDays, aDays });
        prevArrivalDays = aDays;
        i = j;

      } else if (leg.type === 'loiter') {
        const aDays = daysSinceJ2000(parseFlightDate(leg.departure));
        entries.push({ kind: 'loiter', legIndex: i, leg, dDays: prevArrivalDays, aDays });
        prevArrivalDays = aDays;
        i++;

      } else {
        i++;
      }
    }
    return entries;
  }

  // Point-in-time, non-trajectory-affecting notable events on a flight --
  // e.g. Ulysses' three unplanned comet-tail crossings, which happened
  // mid-leg and have no bearing on the Lambert solve or the path actually
  // flown. Kept as a separate top-level `milestones` array on the
  // flight's own JSON (NOT inserted into `legs`) specifically so they
  // can't interact with the trajectory/Lambert-solving/gravity-assist
  // machinery in any way -- pure annotations layered onto an otherwise
  // unaffected leg sequence. Each raw entry: { date, label, text } --
  // label is the short marker/tooltip string, text is the fuller
  // plain-English paragraph for the Flight profile section (same
  // shape/style as every other entry there). Returns the same
  // { kind, dDays, aDays } shape buildLegEntries' own entries use so
  // buildTimelineEntries below can merge and sort the two chronologically
  // without either consumer needing to know milestones exist as a
  // separate source.
  function getFlightMilestones(flightKey) {
    const raw = FLIGHTS_RAW[flightKey];
    return (raw.milestones || []).map((m) => {
      const d = daysSinceJ2000(parseFlightDate(m.date));
      return { kind: 'milestone', dDays: d, aDays: d, milestone: m };
    });
  }

  // buildLegEntries + getFlightMilestones, merged into one chronological
  // walk -- the single source both flightProfileHtml's prose timeline and
  // buildScrubberEvents' scrubber markers consume, so a milestone shows up
  // in the right place in both without two separate merge implementations
  // drifting apart.
  function buildTimelineEntries(flightKey) {
    return buildLegEntries(flightKey)
      .concat(getFlightMilestones(flightKey))
      .sort((a, b) => a.dDays - b.dDays);
  }

  // Chronological, per-leg breakdown of how a mission actually got where
  // it went -- which planet was involved in each flyby and what kind of
  // maneuver happened where. Built entirely from buildLegEntries (already
  // the ground truth this simulator renders from) plus getGAEvents' real
  // computed speed-before/after for each gravity_assist leg -- nothing
  // here is hand-authored per mission.
  function flightProfileHtml(flightKey) {
    const entries = buildTimelineEntries(flightKey);
    if (entries.length === 0) return "";
    const isIon = ION_THRUST_MISSIONS.has(flightKey);

    let items = "";
    entries.forEach((entry) => {
      if (entry.kind === 'lambert') {
        const leg = entry.leg;
        const from = describeLegBody(leg.fromBody);
        const to = describeLegBody(leg.toBody);
        const verb = isIon ? "Continuous ion-thrust cruise" : "Coast";
        let text = `${verb} from ${from.name} to ${to.name} (${leg.departDate.slice(0, 10)} &rarr; ${leg.arrivalDate.slice(0, 10)})`;
        if (isIon) {
          text += " &mdash; engines fire gently the whole way, not just at the ends; the smooth arc shown here approximates that continuous push, not a literal coast.";
        }
        items += legTimelineItemHtml(to.color || from.color, text);

      } else if (entry.kind === 'gravity_assist') {
        const leg = entry.leg, ev = entry.ev;
        const body = describeLegBody(leg.body);
        let text = `Gravity assist at <strong>${body.name}</strong> (${leg.date.slice(0, 10)}, periapsis ${Math.round(leg.periapsisKm).toLocaleString()} km)`;
        if (ev && ev.speedOutKmS !== undefined) {
          const delta = ev.speedOutKmS - ev.speedInKmS;
          text += `: ${ev.speedInKmS.toFixed(1)} &rarr; ${ev.speedOutKmS.toFixed(1)} km/s heliocentric`;
          if (Math.abs(delta) < 0.05) {
            text += " &mdash; this pass barely changed its solar-orbital speed, mostly just bending its path instead";
          } else {
            const dir = delta > 0 ? "boost" : "brake";
            text += ` &mdash; a <strong>${dir}</strong>, ${delta > 0 ? "gaining" : "shedding"} ${Math.abs(delta).toFixed(1)} km/s of speed relative to the Sun`;
            if (ev.aAfterAU !== undefined) {
              text += orbitShapeChangeHtml(ev.aBeforeAU, ev.eBefore, ev.aAfterAU, ev.eAfter);
            }
          }
        } else {
          text += " &mdash; a real flyby, though the long coast that follows is beyond what this simulator's simplified model can precisely track, so an exact speed change isn't shown for this one";
        }
        items += legTimelineItemHtml(body.color, text);

      } else if (entry.kind === 'geocentric_orbit') {
        const leg = entry.firstLeg, last = entry.lastLeg;
        const primary = describeLegBody(leg.primaryBody);
        const text = entry.burnCount > 1
          ? `${entry.burnCount}-burn orbit-raising sequence around ${primary.name}: ${Math.round(leg.periapsisKm).toLocaleString()}×${Math.round(leg.apoapsisKm).toLocaleString()} km &rarr; ${Math.round(last.periapsisKm).toLocaleString()}×${Math.round(last.apoapsisKm).toLocaleString()} km apogee (${leg.departDate.slice(0, 10)} &ndash; ${last.arrivalDate.slice(0, 10)}) &mdash; each pass through perigee, the engine fires again to raise the far side of the orbit a little further, cheaper than one large burn.`
          : `Parking orbit around ${primary.name}: ${Math.round(leg.periapsisKm).toLocaleString()}×${Math.round(leg.apoapsisKm).toLocaleString()} km.`;
        items += legTimelineItemHtml(primary.color, text);

      } else if (entry.kind === 'loiter') {
        const leg = entry.leg;
        const loc = describeLegBody(leg.location);
        const text = `Extended stay at ${loc.name}${leg.departure ? ` (until ${leg.departure.slice(0, 10)})` : ""}.`;
        items += legTimelineItemHtml(loc.color, text);

      } else if (entry.kind === 'milestone') {
        const m = entry.milestone;
        items += legTimelineItemHtml(m.color || null, m.text);
      }
    });

    if (!items) return "";
    const itemCount = (items.match(/lp-timeline-item/g) || []).length;
    // Starts collapsed: a multi-flyby mission's profile can run to a dozen
    // entries, which otherwise buries "Destinations"/"Notes"/the asset
    // gallery under a wall of text most visitors didn't ask to see yet.
    return `<div class="lp-section lp-collapsed"><div class="lp-section-heading lp-collapsible-heading"><span class="lp-chevron"></span>Flight profile<span class="lp-collapsible-count">(${itemCount})</span></div><div class="lp-timeline">${items}</div></div>`;
  }

  // Marker-worthy events for the flight scrubber -- same walk as
  // flightProfileHtml, minus plain 'lambert' coasts (a coast IS the
  // ordinary in-between state the scrubber's track already represents,
  // not a marker-worthy event). Point events (gravity assists) get a
  // single date; span events (orbit-raising sequences, loiters) get a
  // [dDays, aDays] range for a shaded bar plus a marker at the midpoint.
  function buildScrubberEvents(flightKey) {
    return buildTimelineEntries(flightKey)
      .filter((e) => e.kind !== 'lambert')
      .map((e) => {
        if (e.kind === 'milestone') {
          return { type: 'milestone', dDays: e.dDays, aDays: e.aDays,
            color: e.milestone.color || '#a8e8ff', label: e.milestone.label };
        }
        if (e.kind === 'gravity_assist') {
          const body = describeLegBody(e.leg.body);
          // Short "<Body> gravity assist" for the hover tip / tap-toast --
          // the exact date is already implicit in where the marker sits on
          // the track, and the full blow-by-blow (periapsis, speed change)
          // is one click away in the Flight profile section.
          return { type: 'ga', dDays: e.dDays, aDays: e.aDays, color: body.color,
            label: `${body.name} gravity assist` };
        }
        if (e.kind === 'geocentric_orbit') {
          const primary = describeLegBody(e.firstLeg.primaryBody);
          const label = e.burnCount > 1
            ? `${primary.name} orbit-raising sequence`
            : `${primary.name} orbit insertion`;
          return { type: 'orbit', dDays: e.dDays, aDays: e.aDays, color: primary.color, label };
        }
        // loiter
        const loc = describeLegBody(e.leg.location);
        return { type: 'loiter', dDays: e.dDays, aDays: e.aDays, color: loc.color, label: `${loc.name} loiter` };
      });
  }

  /* =========================================================================
     FLIGHT SCRUBBER
     Video-style seek bar for the currently selected flight: launch date at
     one end, arrival/landing date at the other, event markers in between
     (from buildScrubberEvents), and a playhead the user can drag -- or
     click anywhere on the track, or click a marker directly -- to scrub
     simDate within that flight's own window. Shown/rebuilt whenever
     selectedFlightKey changes (same call sites buildFlightsLegend() already
     runs from); the playhead position alone is refreshed every frame
     (updateFlightScrubberPlayhead), since frame() repaints continuously
     regardless of paused and already threads daysSinceEpoch through.
  ========================================================================= */
  const flightScrubberPanel    = document.getElementById("flight-scrubber-panel");
  const flightScrubberTitle    = document.getElementById("flight-scrubber-title");
  const flightScrubberOpenInfoBtn = document.getElementById("flight-scrubber-open-info-btn");
  const flightScrubberDates    = document.getElementById("flight-scrubber-dates");
  const flightScrubberTrack    = document.getElementById("flight-scrubber-track");
  const flightScrubberFill     = document.getElementById("flight-scrubber-fill");
  const flightScrubberMarkers  = document.getElementById("flight-scrubber-markers");
  const flightScrubberPlayhead = document.getElementById("flight-scrubber-playhead");

  // Blanket stop-propagation net for the whole panel, covering the header/
  // title/Show-info-button area in addition to the track/markers (which
  // have their own more specific handlers below). Note this panel itself
  // is pointer-events:none in CSS -- only its genuinely interactive
  // children (track, title, Show-info button) re-enable pointer-events
  // and are reachable at all, so plain background/dead-space taps never
  // reach this panel's DOM in the first place and correctly fall through
  // to the canvas underneath (needed so a rotate/pan gesture that merely
  // STARTS over this panel's dead space still reaches the canvas, since a
  // touch sequence's move/end events always keep targeting wherever its
  // start landed). For events that DO land on an interactive child, this
  // listener stops them bubbling any further up past this panel, so a
  // real click/tap on the track/title/button never also reaches a
  // window/document-level listener and gets mistaken for a canvas
  // interaction (body select, rotate-drag) underneath it. A bubble-phase
  // listener here fires AFTER each child's own bubble-phase listener (if
  // any), so this doesn't interfere with their handling.
  ["pointerdown", "pointerup", "pointermove", "pointercancel", "click"].forEach((evt) => {
    flightScrubberPanel.addEventListener(evt, (e) => e.stopPropagation());
  });

  function pctClamp(v) { return Math.max(0, Math.min(100, v)); }

  // Shows the "Show info" button whenever it'd actually do something new:
  // a flight selected, and its panel not currently open -- regardless of
  // infoBoxMode. Originally gated to manual mode only, on the theory that
  // auto mode's own auto-open made a dedicated reopen affordance
  // unnecessary -- but auto mode's panel can still end up closed later
  // (the X button, or an empty-space click, both deliberately leave
  // selectedFlightKey/the scrubber in place -- see closeInfoPanel) with no
  // other discoverable way back in besides clicking the scrubber's title
  // text, which isn't obviously clickable. Called from everywhere
  // infoBoxMode/selectedFlightKey/infoPanelVisible can change --
  // buildFlightScrubber (covers selection changes), closeInfoPanel, the
  // infoBoxMode toggle itself, and exitManeuverDemo's post-restore step.
  function updateScrubberInfoButton() {
    const show = !!selectedFlightKey && !infoPanelVisible;
    flightScrubberOpenInfoBtn.classList.toggle("visible", show);
  }

  // Full rebuild -- track bounds, title/date labels, and every event
  // marker -- called whenever selectedFlightKey changes (a different
  // flight means a different window and a different event list), never
  // per-frame (see updateFlightScrubberPlayhead for the cheap per-frame
  // part).
  function buildFlightScrubber() {
    flightScrubberPanel.classList.toggle("visible", !!selectedFlightKey);
    flightScrubberMarkers.innerHTML = "";
    if (!selectedFlightKey) { updateScrubberInfoButton(); return; }
    const key = selectedFlightKey;
    const raw = FLIGHTS_RAW[key];
    const { launchDays, arrivalDays } = getFlightDates(key);
    const tof = arrivalDays - launchDays;
    const accent = flightColor(key);
    flightScrubberFill.style.background = accent;
    flightScrubberPlayhead.style.background = accent;
    flightScrubberTitle.textContent = raw.name;
    const ep = flightEndpoints(raw);
    flightScrubberDates.textContent = `${ep.launchDate.slice(0, 10)} → ${ep.arrival.slice(0, 10)}`;

    buildScrubberEvents(key).forEach((ev) => {
      const span = ev.aDays - ev.dDays;
      if (tof > 0 && span > 0.5) {
        // Span event (orbit-raising sequence, loiter): a shaded range
        // behind the track showing how long it lasted.
        const range = document.createElement("div");
        range.className = "scrubber-marker-range";
        const p1 = pctClamp((ev.dDays - launchDays) / tof * 100);
        const p2 = pctClamp((ev.aDays - launchDays) / tof * 100);
        range.style.left = p1 + "%";
        range.style.width = Math.max(0, p2 - p1) + "%";
        range.style.background = ev.color || "var(--text-dim)";
        flightScrubberMarkers.appendChild(range);
      }
      const midDays = (ev.dDays + ev.aDays) / 2;
      const pct = tof > 0 ? pctClamp((midDays - launchDays) / tof * 100) : 0;
      const dot = document.createElement("div");
      dot.className = "scrubber-marker scrubber-marker--" + (ev.type === 'ga' ? 'ga' : ev.type === 'orbit' ? 'orbit' : ev.type === 'milestone' ? 'milestone' : 'loiter');
      dot.style.left = pct + "%";
      if (ev.color) {
        dot.style.color = ev.color; // used by the loiter marker's dashed border (currentColor)
        // Same "lit sphere" shading language the planets themselves use on
        // the canvas (see drawBody's off-center-hotspot radial gradient) --
        // a flat filled circle read as a generic bullet point; a bright
        // highlight fading through the true color into a darkened rim
        // reads as a small glowing body, tying each marker visually back
        // to the real, matching-colored world it refers to.
        dot.style.background = `radial-gradient(circle at 32% 32%, #ffffff, ${ev.color} 55%, ${hexDarken(ev.color, 0.4)} 100%)`;
      }
      // Jumping to a span event's exact start (not its midpoint) matches
      // "jump to launch date"'s own convention of landing right where the
      // named thing begins, rather than partway through it.
      dot.dataset.jumpDays = String(ev.dDays);
      dot.dataset.label = ev.label;
      flightScrubberMarkers.appendChild(dot);
    });
    updateFlightScrubberPlayhead(daysSinceJ2000(simDate));
    updateScrubberInfoButton();
  }

  // Cheap, per-frame: just repositions the playhead/fill, no DOM rebuild.
  // Clamps visually at 0%/100% when simDate is currently outside the
  // flight's own window (the sim clock keeps running after a mission
  // ends) -- this only affects passive display; an active drag is itself
  // bounded by the track's physical ends (see daysFromPointerX).
  function updateFlightScrubberPlayhead(daysSinceEpoch) {
    if (!selectedFlightKey) return;
    const { launchDays, arrivalDays } = getFlightDates(selectedFlightKey);
    const tof = arrivalDays - launchDays;
    const pct = tof > 0
      ? pctClamp((daysSinceEpoch - launchDays) / tof * 100)
      : (daysSinceEpoch < launchDays ? 0 : 100);
    flightScrubberPlayhead.style.left = pct + "%";
    flightScrubberFill.style.width = pct + "%";
  }

  function daysFromPointerX(clientX) {
    const rect = flightScrubberTrack.getBoundingClientRect();
    const frac = rect.width > 0 ? Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) : 0;
    const { launchDays, arrivalDays } = getFlightDates(selectedFlightKey);
    return launchDays + frac * (arrivalDays - launchDays);
  }

  // Live visual update only -- does NOT touch the URL (matches the speed
  // slider's own "input" listener, which never calls updateURLParams
  // either). The URL is only written once, on pointerup, mirroring the
  // Apply-date button's click handler.
  function commitScrubberDate(days) {
    simDate = dateFromDaysSinceJ2000(days);
    dateInput.value = dateInputValue(simDate);
    updateFlightScrubberPlayhead(daysSinceJ2000(simDate));
  }

  // Reopens the locked info panel for the flight currently on the
  // scrubber -- an easy way back into the details (significance, flight
  // profile, destinations) after closing the panel to get it out of the
  // way, without having to re-find and re-click the flight in the legend.
  // Deliberately does NOT pass respectInfoBoxMode -- this is an explicit
  // "open it now" click (from the title, or the "Show info" button that
  // appears once the panel's closed -- see updateScrubberInfoButton), not
  // an automatic open, so it always opens regardless of infoBoxMode. toggleIfSame is
  // false, so this unconditionally reopens (lockedBodyName/infoPanelVisible
  // already match this flight's tracked body whenever the scrubber itself
  // is visible, so re-running it is a harmless no-op if the panel happens
  // to already be open).
  function reopenFlightInfoPanel() {
    if (!selectedFlightKey) return;
    lockBody(FLIGHTS_RAW[selectedFlightKey].name, { toggleIfSame: false, preserveFlightSelection: true });
    updateScrubberInfoButton();
  }
  flightScrubberTitle.addEventListener("click", reopenFlightInfoPanel);
  flightScrubberOpenInfoBtn.addEventListener("click", reopenFlightInfoPanel);

  let scrubberDragging = false;
  let scrubberTipTimeout = null;

  flightScrubberTrack.addEventListener("pointerdown", (e) => {
    if (!selectedFlightKey) return;
    // This panel sits fixed above the canvas -- a real click/tap here
    // should never also reach the canvas's own body-select/rotate
    // handling or the page's default touch gesture handling underneath,
    // which bubbling could otherwise still allow even though the two
    // elements aren't in an ancestor/descendant relationship with each
    // other (both bubble independently up to window/document, where a
    // broad-enough listener could still see either one).
    e.stopPropagation();
    flightScrubberTrack.setPointerCapture(e.pointerId);
    flightScrubberTrack.classList.add("dragging");
    scrubberDragging = true;
    if (!paused) {
      scrubberAutoPaused = true;
      setPaused(true);
    }
    const markerEl = e.target.closest(".scrubber-marker");
    if (markerEl) {
      commitScrubberDate(Number(markerEl.dataset.jumpDays));
      // No hover on touch -- show the label briefly so tapping a marker
      // still tells you what it was, then let it fade like a toast.
      hoverTip.style.display = "block";
      hoverTip.style.left = (e.clientX + 14) + "px";
      hoverTip.style.top = (e.clientY + 14) + "px";
      hoverTip.innerHTML = markerEl.dataset.label;
      clearTimeout(scrubberTipTimeout);
      scrubberTipTimeout = setTimeout(() => { hoverTip.style.display = "none"; }, 1500);
    } else {
      commitScrubberDate(daysFromPointerX(e.clientX));
    }
  });
  flightScrubberTrack.addEventListener("pointermove", (e) => {
    e.stopPropagation();
    if (!scrubberDragging) return;
    commitScrubberDate(daysFromPointerX(e.clientX));
  });
  function endScrubberDrag(e) {
    if (e) e.stopPropagation();
    if (!scrubberDragging) return;
    scrubberDragging = false;
    flightScrubberTrack.classList.remove("dragging");
    updateURLParams({ date: dateInput.value });
    if (scrubberAutoPaused) {
      scrubberAutoPaused = false;
      maybeResumeFromAutoPause();
    }
  }
  flightScrubberTrack.addEventListener("pointerup", endScrubberDrag);
  flightScrubberTrack.addEventListener("pointercancel", endScrubberDrag);

  // Hover tooltip (desktop) -- delegated, same #hover-tip element and
  // pattern as the canvas path-hover code (see handleHover), rather than
  // a second bespoke tooltip element.
  flightScrubberMarkers.addEventListener("mousemove", (e) => {
    e.stopPropagation();
    if (scrubberDragging) return;
    const el = e.target.closest(".scrubber-marker");
    if (!el) { hoverTip.style.display = "none"; return; }
    hoverTip.style.display = "block";
    hoverTip.style.left = (e.clientX + 14) + "px";
    hoverTip.style.top = (e.clientY + 14) + "px";
    hoverTip.innerHTML = el.dataset.label;
  });
  flightScrubberMarkers.addEventListener("mouseleave", (e) => {
    e.stopPropagation();
    if (!scrubberDragging) hoverTip.style.display = "none";
  });

  function formatLockedPanelContent(b) {
    if (b.isFlight) {
      const raw = FLIGHTS_RAW[b.flightKey];
      const ep  = flightEndpoints(raw);
      let rows = "";
      const addRow = (k, v) => { rows += `<div class="lp-row"><span class="lp-key">${k}</span><span class="lp-val">${v}</span></div>`; };
      addRow("Mission", raw.name);
      addRow("Launch from", ep.launchBody);
      addRow("Launch date", ep.launchDate);
      addRow("Destination", describeLegBody(ep.destinationBody).name);
      // "arrival" is always the intended arrival date the trajectory was
      // flying toward (see FLIGHTS_RAW comment) -- label it plainly for a
      // success, or as "intended" when the mission didn't reach it, so
      // the same single field reads correctly either way.
      addRow(raw.status === "Success" ? "Arrival" : "Arrival (intended)", ep.arrival);
      addRow("Rocket", raw.rocket);
      addRow("Payload", raw.payload);
      addRow("Status", raw.status);
      // "Jump to launch" is a deliberate, explicit action distinct from
      // selectFlight()'s own no-date-jump behavior above -- selecting a
      // mission from a legend/link is "tell me about this," which must
      // NOT move the clock out from under someone comparing several
      // currently-visible missions (see selectFlight's comment). But once
      // someone is reading a specific flight's panel and decides they
      // actually want to watch it happen, there was no way to get there
      // short of manually typing a date. This button closes that gap
      // without reintroducing the automatic jump-on-select.
      const jumpBtn = `<div class="lp-jump-row"><button type="button" class="lp-jump-btn" data-jump-to-launch="${b.flightKey}">Jump to launch date</button></div>`;
      let sections = "";
      if (raw.significance) sections += lpSectionHtml("Why it matters", raw.significance);
      sections += flightProfileHtml(b.flightKey);
      sections += flightDestinationsHtml(b.flightKey);
      if (raw.statusNote) sections += lpSectionHtml("Notes", raw.statusNote);
      lockedPanelBody.innerHTML = rows + jumpBtn + learnMoreHtml(raw.assets) + sections + assetGalleryHtml(raw.assets);
      return;
    }

    if (b.name === "Sol") {
      const info = BODY_INFO["Sol"];
      let rows =
        `<div class="lp-row"><span class="lp-key">Role</span><span class="lp-val">Central body (reference origin)</span></div>` +
        `<div class="lp-row"><span class="lp-key">Radius</span><span class="lp-val">${SUN_RADIUS_KM.toLocaleString()} km</span></div>`;
      let sections = "";
      if (info && info.significance) sections += lpSectionHtml("Why it matters", info.significance);
      lockedPanelBody.innerHTML = rows + (info ? learnMoreHtml(info.assets) : "") + sections + (info ? assetGalleryHtml(info.assets) : "");
      return;
    }

    if (b.primary && b.primary !== "Sol") {
      // Any natural satellite (Earth's Moon, or Mars's Phobos/Deimos): its
      // period/semi-major-axis are only meaningful computed against its
      // actual primary's GM, not the Sun's. Heliocentric position is still
      // shown for consistency with the planets' "from Sol" framing, but
      // labeled distinctly so it isn't read as describing an orbit around Sol.
      const speedKmS = Math.hypot(...b.vel) * AU_KM / SEC_PER_DAY;
      const aKm = b.a * AU_KM;
      const periodDays = 2 * Math.PI * Math.sqrt(Math.pow(aKm, 3) / b.primaryGmKm3Day2);
      let rows = "";
      const addRow = (k, v) => { rows += `<div class="lp-row"><span class="lp-key">${k}</span><span class="lp-val">${v}</span></div>`; };
      addRow("Size", formatBodySize(b.radiusKm, b.dimensionsKm, b.shapeNote));
      addRow("Orbits", `${b.primary} (not Sol directly)`);
      addRow(`Distance from ${b.primary}`, `${b.rKmFromPrimary.toLocaleString(undefined, {maximumFractionDigits: 0})} km`);
      addRow("Heliocentric position", `${b.pos.map(v => v.toFixed(3)).join(", ")} AU`);
      addRow("Speed (heliocentric)", `${speedKmS.toFixed(2)} km/s`);
      addRow("Semi-major axis (a)", `${(aKm).toLocaleString(undefined,{maximumFractionDigits:0})} km`);
      addRow("Eccentricity (e)", b.e.toFixed(4));
      addRow("Inclination to ecliptic", `${(b.i / D2R).toFixed(2)}°`);
      addRow(`Orbital period (around ${b.primary})`, `${periodDays.toFixed(4)} d`);
      const satInfo = BODY_INFO[b.name];
      let sections = "";
      if (satInfo && satInfo.significance) sections += lpSectionHtml("Why it matters", satInfo.significance);
      lockedPanelBody.innerHTML = rows + (satInfo ? learnMoreHtml(satInfo.assets) : "") + sections + (satInfo ? assetGalleryHtml(satInfo.assets) : "");
      return;
    }

    // Generic heliocentric body -- covers both planets and small bodies
    // (identical shape, primary: "Sol"), which is also why both get the
    // same "Missions here" treatment below.
    const speedKmS = Math.hypot(...b.vel) * AU_KM / SEC_PER_DAY;
    const periodDays = 2 * Math.PI * Math.sqrt((b.a * b.a * b.a) / GM_SUN_AU3_DAY2);
    const periodYears = periodDays / 365.25;
    let rows = "";
    const addRow = (k, v) => { rows += `<div class="lp-row"><span class="lp-key">${k}</span><span class="lp-val">${v}</span></div>`; };
    addRow("Size", formatBodySize(b.radiusKm, b.dimensionsKm, b.shapeNote));
    addRow("Distance from Sol", `${b.r.toFixed(4)} AU`);
    addRow("Position (x,y,z)", `${b.pos.map(v => v.toFixed(3)).join(", ")} AU`);
    addRow("Speed", `${speedKmS.toFixed(2)} km/s`);
    addRow("Semi-major axis (a)", `${b.a.toFixed(4)} AU`);
    addRow("Eccentricity (e)", b.e.toFixed(4));
    addRow("Inclination (i)", `${(b.i / D2R).toFixed(2)}°`);
    addRow("Orbital period", `${periodYears.toFixed(2)} yr (${periodDays.toFixed(0)} d)`);
    const info = BODY_INFO[b.name];
    let sections = "";
    if (info && info.significance) sections += lpSectionHtml("Why it matters", info.significance);
    sections += missionsToHereHtml(b.name);
    lockedPanelBody.innerHTML = rows + (info ? learnMoreHtml(info.assets) : "") + sections + (info ? assetGalleryHtml(info.assets) : "");
  }

  // The locked panel is event-based, not per-frame: formatLockedPanelContent
  // fully replaces lockedPanelBody's innerHTML, and this used to run EVERY
  // frame unconditionally (60/sec) regardless of pause state, along with
  // recomputing the panel's position to keep following the tracked body's
  // on-screen motion. Two real, confirmed problems, not just wasted work:
  // (1) destroying and recreating the "Missions here"/"Destinations" link
  // elements 60 times a second meant a real mouse click's mousedown and
  // mouseup could land on two DIFFERENT DOM nodes, silently dropping the
  // click -- the actual cause of "no events firing for the links"; (2) a
  // panel that keeps sliding around to track a moving body is genuinely
  // hard to read. Fix: both the content AND the position are set exactly
  // ONCE, at the moment a NEW body/flight is locked (detected below via
  // lockedBodyName changing since the last frame) -- never touched again
  // by the frame loop afterward. The panel only moves again if the user
  // drags it (see the header mousedown/mousemove/mouseup handlers, which
  // now own lockedPanelPos directly). The connector line + highlight ring
  // on the CANVAS still track the body's real current position every
  // frame regardless -- that's a cheap canvas draw, not a DOM node, so it
  // can't cause the click-interference problem, and it's useful to still
  // see at a glance where the (possibly still-moving) body actually is
  // relative to the now-stationary panel.
  let _lastLockedBodyForPanel = null;
  // Separate from _lastLockedBodyForPanel: that one tracks CONTENT (title/
  // body HTML), which should populate immediately on a new lock even while
  // the panel is still hidden (manual info-box mode -- see infoBoxMode),
  // so there's no flash of stale content the instant it's shown. Position
  // can only be correctly computed once the panel is actually visible --
  // getBoundingClientRect() on a display:none element returns a 0px-tall
  // box, and since positioning is otherwise deliberately sticky (see
  // lockedPanelPos's own comment -- it only recomputes on a genuinely new
  // lock, to preserve a user's manual drag), computing it against that
  // bogus zero height would freeze a wrong position that then persists
  // even after the panel is later actually opened (reported: the "Show
  // info" button, manual mode's way of opening a panel that was never
  // auto-opened, placed the panel using whatever the tracked body's
  // on-screen Y happened to be at SELECTION time, clamped as if the panel
  // had zero height -- not a real "reposition for how it looks right
  // now" the way clicking the flight in the legend already does in auto
  // mode, where the panel is visible from the very first frame). Tracked
  // separately so a still-pending position (infoPanelVisible false) is
  // retried every frame without redundantly re-running the content-setting
  // side (which would keep resetting scroll position for no reason).
  let _lastPositionedBodyForPanel = null;
  function drawLockedPanelConnector() {
    if (!lockedBodyName) {
      _lastLockedBodyForPanel = null;
      _lastPositionedBodyForPanel = null;
      lockedPanelPos = null;
      return;
    }
    const b = renderedBodies.find((x) => x.name === lockedBodyName);
    if (!b) return;

    if (lockedBodyName !== _lastLockedBodyForPanel) {
      lockedPanelTitle.textContent = b.name;
      formatLockedPanelContent(b);
      // Scrolling #locked-panel-body doesn't recreate it, so without this
      // a new target inherits whatever scroll position the PREVIOUS one
      // was left at -- e.g. scroll down to a flight's image gallery,
      // click a different mission from "Destinations", and the new
      // panel opens already scrolled past its own Mission/Launch/
      // Destination rows straight to wherever the old scroll happened to
      // land. Easy to miss entirely for a new user who doesn't think to
      // scroll up on a panel that just visibly opened.
      lockedPanelBody.scrollTop = 0;
      _lastLockedBodyForPanel = lockedBodyName;
    }

    if (lockedBodyName !== _lastPositionedBodyForPanel) {
      // Mobile: the panel is a full-screen modal, positioned entirely by
      // CSS (body.mobile #locked-panel { inset:0; ... }) -- setting
      // inline left/top here would win over that (inline styles beat
      // class rules) and fight the CSS positioning, so skip it entirely.
      //
      // Real bug found via a live-browser repro (Playwright, not just the
      // headless harness): locking something while desktop-sized sets a
      // real inline left/top; if the SAME PAGE is then resized/rotated
      // into mobile layout (no reload -- e.g. toggling a devtools device
      // preset on an already-open tab) and a NEW body gets locked, this
      // branch never used to touch that stale inline style at all, only
      // the "else" branch below ever wrote to it. Since inline beats the
      // CSS class rule per-property, the stale left/top (from whatever
      // the desktop viewport size used to be) could push the whole panel
      // off-screen even though display:flex made it "visible" and every
      // other property was correct -- exactly a "I don't see the panel"
      // report with no console error. Explicitly clearing them here means
      // mobile mode is never at the mercy of whatever inline values a
      // prior desktop session happened to leave behind.
      if (isMobileLayout) {
        lockedPanelPos = null;
        lockedPanel.style.left = "";
        lockedPanel.style.top = "";
        _lastPositionedBodyForPanel = lockedBodyName;
      } else if (infoPanelVisible) {
        const panelRect = lockedPanel.getBoundingClientRect();
        let px = b.sx + 20;
        let py = b.sy - panelRect.height / 2;
        px = Math.max(8, Math.min(px, viewW - panelRect.width - 8));
        py = Math.max(8, Math.min(py, viewH - panelRect.height - 8));
        lockedPanelPos = { x: px, y: py };
        lockedPanel.style.left = px + "px";
        lockedPanel.style.top = py + "px";
        _lastPositionedBodyForPanel = lockedBodyName;
      }
      // else: desktop, not yet visible (manual info-box mode, panel not
      // opened yet) -- left pending, retried each frame until
      // infoPanelVisible flips true (e.g. via the "Show info" button or
      // the scrubber title), at which point it positions using the
      // tracked body's CURRENT on-screen position and the panel's real
      // height, same as a fresh legend click would.
    }

    // Highlight ring around the tracked body -- kept on mobile too (cheap
    // canvas draw, useful regardless of panel layout), and kept even while
    // the info panel itself is closed (infoPanelVisible=false): it's the
    // visual cue for what's being TRACKED, independent of the panel. The
    // connector LINE to the panel's position only makes sense while that
    // panel is actually visible -- otherwise it's a stray line pointing at
    // a hidden panel's last on-screen position -- so it's gated on both
    // desktop-only (a fixed bottom sheet on mobile has no "near the body"
    // position to connect to) and infoPanelVisible.
    ctx.save();
    ctx.strokeStyle = "rgba(120,180,255,0.7)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(b.sx, b.sy, b.screenR + 6, 0, Math.PI * 2);
    ctx.stroke();

    if (!isMobileLayout && infoPanelVisible) {
      const lineStartX = b.sx + (b.screenR + 6);
      const lineStartY = b.sy;
      const panelRect = lockedPanel.getBoundingClientRect(); // current rect, possibly moved by a drag
      ctx.beginPath();
      ctx.moveTo(lineStartX, lineStartY);
      ctx.lineTo(lockedPanelPos.x, lockedPanelPos.y + panelRect.height / 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* =========================================================================
     MAIN RENDER LOOP
  ========================================================================= */

  function drawOrbitEllipse(elements, daysSinceEpoch) {
    // Draw the full ellipse path for current osculating elements (approx,
    // using current a/e/i/Om/w — precise enough visually; orbit precesses
    // slowly so this is stable frame to frame).
    const T = daysSinceEpoch / DAYS_PER_CENTURY;
    const a = elements.a + elements.aDot * T;
    const e = elements.e + elements.eDot * T;
    const i = (elements.i + (elements.iDot / 3600) * T) * D2R;
    const Om = (elements.Om + (elements.OmDot / 3600) * T) * D2R;
    const varpi = (elements.varpi + (elements.varpiDot / 3600) * T) * D2R;
    const w = varpi - Om;

    const cosOm = Math.cos(Om), sinOm = Math.sin(Om);
    const cosW = Math.cos(w), sinW = Math.sin(w);
    const cosI = Math.cos(i), sinI = Math.sin(i);

    function rotate(x, y) {
      const xw = x * cosW - y * sinW;
      const yw = x * sinW + y * cosW;
      const xi = xw;
      const yi = yw * cosI;
      const zi = yw * sinI;
      const X = xi * cosOm - yi * sinOm;
      const Y = xi * sinOm + yi * cosOm;
      const Z = zi;
      return [X, Y, Z];
    }

    const N = 180;
    const points = [];
    ctx.beginPath();
    for (let k = 0; k <= N; k++) {
      const E = (k / N) * 2 * Math.PI;
      const xOrb = a * (Math.cos(E) - e);
      const yOrb = a * Math.sqrt(1 - e * e) * Math.sin(E);
      const [X, Y, Z] = rotate(xOrb, yOrb);
      const [sx, sy] = worldToScreen(X, Y, Z);
      points.push([sx, sy]);
      if (k === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
    return points; // reused for click/hover hit-testing (hitTestPaths) -- no extra sampling cost
  }

  // Draws only the TRAVELED PORTION of a flight's transfer ellipse --
  // from launch to arrival -- not the full closed loop drawOrbitEllipse
  // draws for planets. A real flight has a start and end; showing the
  // rest of the ellipse (the part the spacecraft never flew) would be
  // misleading, not just visually noisy.
  // tStart/tEnd optionally clip the drawn portion to a sub-interval of the
  // flight's full [launchDays, arrivalDays] span (days since J2000) --
  // used to render only a rolling window around "now" for an unselected,
  // merely-in-transit flight (see the FLIGHTS_ORDER render loop) instead
  // of its entire path. Defaults to the full span when omitted. Computed
  // from mean motion directly (M0 is anchored at el.epochDays, not
  // necessarily flight.launchDays -- true for a multi-leg leg's own solved
  // elements) rather than assuming the clip bounds coincide with the
  // flight's own endpoints.
  function drawFlightArc(flight, tStart, tEnd) {
    const el = flight.elements;
    const t0 = tStart !== undefined ? tStart : flight.launchDays;
    const t1 = tEnd !== undefined ? tEnd : flight.arrivalDays;
    const Eat = (mAnomaly) => {
      // Eccentric anomaly at a given (unnormalized) mean anomaly, walking
      // forward from M0 rather than solveKepler's normalized [0,2pi)
      // result directly, so the arc sweeps the correct direction/amount
      // even across a 0/2pi wrap.
      return solveKepler(mAnomaly, el.e);
    };
    const n = Math.sqrt(GM_SUN_AU3_DAY2 / (el.a * el.a * el.a));
    const M_launch = el.M0 + n * (t0 - el.epochDays);
    const M_arrival = el.M0 + n * (t1 - el.epochDays);

    const E_launch = Eat(M_launch);
    let E_arrival = Eat(M_arrival);
    // solveKepler normalizes into [0, 2pi); since M_arrival > M_launch by
    // construction (time only moves forward) and the transfer is well
    // under one full orbit, force E_arrival to be the value reached by
    // sweeping FORWARD from E_launch, not wrapped back below it.
    if (E_arrival < E_launch) E_arrival += 2 * Math.PI;

    const cosOm = Math.cos(el.Om), sinOm = Math.sin(el.Om);
    const cosW = Math.cos(el.w), sinW = Math.sin(el.w);
    const cosI = Math.cos(el.i), sinI = Math.sin(el.i);
    function rotate(x, y) {
      const xw = x * cosW - y * sinW;
      const yw = x * sinW + y * cosW;
      const xi = xw;
      const yi = yw * cosI;
      const zi = yw * sinI;
      const X = xi * cosOm - yi * sinOm;
      const Y = xi * sinOm + yi * cosOm;
      const Z = zi;
      return [X, Y, Z];
    }

    const N = 90;
    const points = [];
    ctx.beginPath();
    for (let k = 0; k <= N; k++) {
      const E = E_launch + (k / N) * (E_arrival - E_launch);
      const xOrb = el.a * (Math.cos(E) - el.e);
      const yOrb = el.a * Math.sqrt(1 - el.e * el.e) * Math.sin(E);
      const [X, Y, Z] = rotate(xOrb, yOrb);
      const [sx, sy] = worldToScreen(X, Y, Z);
      points.push([sx, sy]);
      if (k === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
    return points;
  }

  // One 360-degree loop of static, radians-based orbital elements (a in
  // AU, e, i/Om/w already in radians, plus M0/epochDays -- the same shape
  // flight-leg elements already use, e.g. getSolvedLeg's/getGAChain's
  // output, or getCurrentOrbitElements' AU-converted geocentric/loiter
  // output), optionally centered on a moving point (centerAU, default the
  // origin/Sol). Used by the "current orbit" toggle to show one full
  // revolution of whatever the spacecraft is CURRENTLY on.
  //
  // Anchored to the CURRENT position, not an arbitrary start point: swept
  // 90 degrees of mean anomaly BEHIND where the spacecraft is right now
  // through 300 degrees AHEAD (390 degrees total -- more than a full
  // circle). Going past 360 is deliberate: the trailing 90 and leading 300
  // together mean the last 30 degrees of the forward sweep retraces the
  // same arc the trailing fade starts from, so as the spacecraft crosses a
  // maneuver or gravity assist and the active leg's elements change, the
  // new ellipse's forward sweep still reaches back far enough to visibly
  // overlap where the old one's trail was -- letting a shift in aphelion/
  // perihelion read as a change in an already-visible piece of the curve,
  // not just an abrupt jump with no shared reference. The trailing 90 is
  // drawn fading toward its far end (see TRAIL_FADE_STEPS below) rather
  // than at full weight, both so it doesn't read as just another lap of a
  // closed ring and so it stays visually secondary to the forward
  // (solid, undiminished) projection, which is the part that actually
  // anticipates what's coming. Weighted toward what's coming rather than
  // centered/symmetric or starting from periapsis, so the recent-past and
  // upcoming path both stay visually intact around wherever it actually
  // is, per the user's own call. Mean anomaly (not eccentric or true
  // anomaly) because it's the one that maps linearly to elapsed TIME,
  // which is what "90 degrees ago" / "300 degrees from now" actually means
  // here; gmAU3Day2 is the mean motion's own primary's GM (Sol for a
  // heliocentric leg, the geocentric_orbit leg's own primaryBody otherwise
  // -- see getCurrentOrbitElements), NOT always GM_SUN_AU3_DAY2.
  // Returns null (draws nothing) for e>=1 -- a hyperbolic/parabolic path
  // never closes into a bounded loop, so there's no ellipse to show.
  function drawCurrentOrbitEllipse(el, centerAU, gmAU3Day2, daysSinceEpoch) {
    if (el.e >= 1) return null;
    centerAU = centerAU || [0, 0, 0];
    const cosOm = Math.cos(el.Om), sinOm = Math.sin(el.Om);
    const cosW = Math.cos(el.w), sinW = Math.sin(el.w);
    const cosI = Math.cos(el.i), sinI = Math.sin(el.i);
    function rotate(x, y) {
      const xw = x * cosW - y * sinW;
      const yw = x * sinW + y * cosW;
      const xi = xw, yi = yw * cosI, zi = yw * sinI;
      return [xi * cosOm - yi * sinOm, xi * sinOm + yi * cosOm, zi];
    }
    const TRAILING_DEG = 90, FORWARD_DEG = 300;
    const n = Math.sqrt(gmAU3Day2 / (el.a * el.a * el.a)); // rad/day
    const M_now = el.M0 + n * (daysSinceEpoch - el.epochDays);

    function sampleAt(M) {
      // solveKepler normalizes M into [0, 2pi) internally, so it's already
      // correct for any M here regardless of sign/range -- each M maps to
      // its own definite (x,y), no "unwrap E to stay increasing" trick
      // needed (that's only for parametrizing directly by E across a
      // linear sweep, e.g. drawFlightArc; here E is re-derived fresh at
      // every sample).
      const E = solveKepler(M, el.e);
      const xOrb = el.a * (Math.cos(E) - el.e);
      const yOrb = el.a * Math.sqrt(1 - el.e * el.e) * Math.sin(E);
      const [x, y, z] = rotate(xOrb, yOrb);
      return worldToScreen(centerAU[0] + x, centerAU[1] + y, centerAU[2] + z);
    }

    // Trailing portion: drawn as short segments with per-segment alpha
    // (canvas has no per-vertex alpha on a single stroked path) ramping
    // from faint at the oldest point up toward full weight approaching
    // "now" -- a standard fading-tail technique, not a native stroke
    // gradient (which would follow the path's bounding box, not its curve).
    const TRAIL_FADE_STEPS = 48;
    const trailPoints = [];
    for (let k = 0; k <= TRAIL_FADE_STEPS; k++) {
      const M = M_now - TRAILING_DEG * D2R * (1 - k / TRAIL_FADE_STEPS);
      trailPoints.push(sampleAt(M));
    }
    const baseAlpha = ctx.globalAlpha;
    for (let k = 0; k < TRAIL_FADE_STEPS; k++) {
      const t = (k + 1) / TRAIL_FADE_STEPS; // 0 at the oldest end, 1 at "now"
      ctx.globalAlpha = baseAlpha * (0.06 + 0.94 * t * t);
      ctx.beginPath();
      ctx.moveTo(trailPoints[k][0], trailPoints[k][1]);
      ctx.lineTo(trailPoints[k + 1][0], trailPoints[k + 1][1]);
      ctx.stroke();
    }
    ctx.globalAlpha = baseAlpha;

    // Forward portion: solid, full weight -- the part that actually
    // anticipates an upcoming shift in aphelion/perihelion.
    const FORWARD_STEPS = 160;
    const fwdPoints = [];
    ctx.beginPath();
    for (let k = 0; k <= FORWARD_STEPS; k++) {
      const [sx, sy] = sampleAt(M_now + FORWARD_DEG * D2R * (k / FORWARD_STEPS));
      fwdPoints.push([sx, sy]);
      if (k === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    }
    ctx.stroke();

    return trailPoints.concat(fwdPoints);
  }

  // Draws a satellite's orbit ellipse centered on a moving point (its
  // primary's current position) rather than the origin -- needed for any
  // moon, since it orbits its primary's current position, not Sol's fixed
  // origin. Takes a satellite's element shape (aKm in km) rather than the
  // planets' a-in-AU/centennial-rate shape, since these are genuinely
  // different kinds of orbital elements, not the same structure reused.
  // nodalPeriodDays/apsidalPeriodDays are optional, matching
  // computeSatelliteOffset's convention (fixed Om/w if omitted).
  function drawOrbitEllipseAroundPoint(satElements, daysSinceEpoch, centerAU) {
    const a = satElements.aKm;
    const e = satElements.e;
    const i = satElements.iDeg * D2R;
    const Om = satElements.nodalPeriodDays
      ? (satElements.OmDeg0 - 360 * (daysSinceEpoch / satElements.nodalPeriodDays)) * D2R
      : satElements.OmDeg0 * D2R;
    const w = satElements.apsidalPeriodDays
      ? (satElements.wDeg0 + 360 * (daysSinceEpoch / satElements.apsidalPeriodDays)) * D2R
      : satElements.wDeg0 * D2R;

    const cosOm = Math.cos(Om), sinOm = Math.sin(Om);
    const cosW = Math.cos(w), sinW = Math.sin(w);
    const cosI = Math.cos(i), sinI = Math.sin(i);

    function rotate(x, y) {
      const xw = x * cosW - y * sinW;
      const yw = x * sinW + y * cosW;
      const xi = xw;
      const yi = yw * cosI;
      const zi = yw * sinI;
      const X = xi * cosOm - yi * sinOm;
      const Y = xi * sinOm + yi * cosOm;
      const Z = zi;
      return [X, Y, Z];
    }

    const N = 90;
    const points = [];
    ctx.beginPath();
    for (let k = 0; k <= N; k++) {
      const E = (k / N) * 2 * Math.PI;
      const xOrb = a * (Math.cos(E) - e);
      const yOrb = a * Math.sqrt(1 - e * e) * Math.sin(E);
      const [Xkm, Ykm, Zkm] = rotate(xOrb, yOrb);
      const X = centerAU[0] + Xkm / AU_KM;
      const Y = centerAU[1] + Ykm / AU_KM;
      const Z = centerAU[2] + Zkm / AU_KM;
      const [sx, sy] = worldToScreen(X, Y, Z);
      points.push([sx, sy]);
      if (k === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
    return points;
  }

  // A small body's a/e/i/Om/w are fixed (SMALL_BODIES elements carry no
  // secular rates the way PLANET_ELEMENTS do -- see drawOrbitEllipse), so
  // its orbit shape doesn't depend on the current date at all: drawn
  // directly from the polar conic equation swept over true anomaly,
  // rather than needing daysSinceEpoch or an eccentric-anomaly solve.
  function drawSmallBodyOrbitEllipse(elements) {
    const a = elements.a, e = elements.e;
    const i = elements.iDeg * D2R;
    const Om = elements.OmDeg * D2R;
    const w = elements.wDeg * D2R;

    const cosOm = Math.cos(Om), sinOm = Math.sin(Om);
    const cosW = Math.cos(w), sinW = Math.sin(w);
    const cosI = Math.cos(i), sinI = Math.sin(i);
    function rotate(x, y) {
      const xw = x * cosW - y * sinW;
      const yw = x * sinW + y * cosW;
      const xi = xw;
      const yi = yw * cosI;
      const zi = yw * sinI;
      const X = xi * cosOm - yi * sinOm;
      const Y = xi * sinOm + yi * cosOm;
      const Z = zi;
      return [X, Y, Z];
    }

    const N = 180;
    const points = [];
    ctx.beginPath();
    for (let k = 0; k <= N; k++) {
      const nu = (k / N) * 2 * Math.PI;
      const r = (a * (1 - e * e)) / (1 + e * Math.cos(nu));
      const xOrb = r * Math.cos(nu);
      const yOrb = r * Math.sin(nu);
      const [X, Y, Z] = rotate(xOrb, yOrb);
      const [sx, sy] = worldToScreen(X, Y, Z);
      points.push([sx, sy]);
      if (k === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
    return points;
  }

  // Same time-windowed-sampling pattern as drawFlightArcByTime, for a
  // SMALL_BODIES entry instead of a flight leg -- used for long-period/
  // near-parabolic comets (crossingWindowDays set, see hyakutake/
  // mcnaught_hartley/mcnaught) in place of drawSmallBodyOrbitEllipse's
  // closed-form full-ellipse sweep, which assumes a periodic, boundable
  // orbit worth drawing in full. A one-time visitor doesn't have a
  // meaningful "whole orbit" -- just the arc through its real crossing.
  function drawSmallBodyArcByTime(elements, tStart, tEnd) {
    const N = 300;
    const points = [];
    ctx.beginPath();
    for (let k = 0; k <= N; k++) {
      const t = tStart + (k / N) * (tEnd - tStart);
      const [X, Y, Z] = computeSmallBodyState(elements, t).pos;
      const [sx, sy]  = worldToScreen(X, Y, Z);
      points.push([sx, sy]);
      if (k === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
    return points;
  }

  function frame() {
    const now = performance.now();
    const dtMs = now - lastFrameTime;
    lastFrameTime = now;

    if (!paused && speedMultiplier !== 0) {
      const daysElapsed = speedMultiplier * BASE_DAYS_PER_MS * dtMs;
      simDate = new Date(simDate.getTime() + daysElapsed * 86400000);
      dateInput.value = dateInputValue(simDate);
    }

    ctx.clearRect(0, 0, viewW, viewH);

    // subtle starfield (static, cheap)
    drawStars();

    const daysSinceEpoch = daysSinceJ2000(simDate);
    updateFlightsLegendActiveState(daysSinceEpoch);
    updateSmallBodiesLegendActiveState(daysSinceEpoch);
    updateFlightScrubberPlayhead(daysSinceEpoch);

    // ---- Pass 1: compute world positions for every body, BEFORE any
    // screen projection. This has to happen first so that, if a body is
    // locked, we know its world position in time to correct the camera
    // pan (camX/camY) before worldToScreen is called for anything --
    // otherwise the locked body would lag one frame behind the camera
    // correction, producing a visible jitter.
    const worldStates = { Sol: { pos: [0, 0, 0], vel: [0, 0, 0], r: 0, e: 0, i: 0, a: 0 } };
    let earthState = null;
    let marsState = null;
    PLANET_ORDER.forEach((name) => {
      const state = computeStateVector(PLANET_ELEMENTS[name], daysSinceEpoch);
      worldStates[name] = state;
      if (name === "Earth") earthState = state;
      if (name === "Mars") marsState = state;
    });

    // Generic helper: given a satellite's elements/meta and its primary's
    // current state, compute the satellite's absolute position/velocity
    // (primary's state + satellite's own offset) and package everything
    // the body-record and the locked panel need, including which GM to
    // use for that satellite's own orbital-period readout (its primary's,
    // or -- for the Moon specifically -- the combined Earth+Moon value,
    // since the Moon's mass is non-negligible relative to Earth's).
    function buildSatelliteAbs(elements, primaryState, primaryGmKm3Day2) {
      const sat = computeSatelliteOffset(elements, daysSinceEpoch);
      const pos = [
        primaryState.pos[0] + sat.posAU[0],
        primaryState.pos[1] + sat.posAU[1],
        primaryState.pos[2] + sat.posAU[2]
      ];
      const vel = [
        primaryState.vel[0] + sat.velAU[0],
        primaryState.vel[1] + sat.velAU[1],
        primaryState.vel[2] + sat.velAU[2]
      ];
      return { pos, vel, sat, primaryGmKm3Day2 };
    }

    let moonAbs = null;
    if (earthState) {
      moonAbs = buildSatelliteAbs(MOON_ELEMENTS, earthState, GM_EARTH_MOON_KM3_DAY2);
      worldStates.Moon = { pos: moonAbs.pos, vel: moonAbs.vel };
    }
    let phobosAbs = null, deimosAbs = null;
    if (marsState) {
      phobosAbs = buildSatelliteAbs(PHOBOS_ELEMENTS, marsState, GM_MARS_KM3_DAY2);
      deimosAbs = buildSatelliteAbs(DEIMOS_ELEMENTS, marsState, GM_MARS_KM3_DAY2);
      worldStates.Phobos = { pos: phobosAbs.pos, vel: phobosAbs.vel };
      worldStates.Deimos = { pos: deimosAbs.pos, vel: deimosAbs.vel };
    }

    // Charon: only worth computing while Pluto itself is in play (small
    // bodies are hidden by default -- see isSmallBodyVisible), same gating
    // the outer moons get implicitly via their planet always being present.
    // Also computed when CHARON ITSELF is directly locked (the "|| isSatel-
    // liteVisible" clause) -- isSmallBodyVisible("pluto", ...) only ever
    // checks whether PLUTO's own name is locked, so clicking Charon's own
    // nested legend row (a completely normal action, lockBody("Charon",
    // ...)) used to leave charonAbs uncomputed, silently dropping Charon
    // out of renderedBodies entirely and leaving the locked panel showing
    // Pluto's stale content from before the click (formatLockedPanelContent
    // never got called again for a body drawLockedPanelConnector's `b`
    // lookup couldn't find) -- a real, pre-existing bug found while
    // verifying the new Dimorphos satellite below hits the identical
    // failure mode for the identical reason.
    let charonAbs = null, plutoState = null;
    if (isSmallBodyVisible("pluto", daysSinceEpoch) || isSatelliteVisible("Pluto and Charon", "Charon")) {
      plutoState = computeSmallBodyState(SMALL_BODIES.pluto.elements, daysSinceEpoch);
      charonAbs = buildSatelliteAbs(CHARON_ELEMENTS, plutoState, GM_PLUTO_CHARON_KM3_DAY2);
      worldStates.Charon = { pos: charonAbs.pos, vel: charonAbs.vel };
    }

    // Dimorphos: same gating as Charon above (including the same direct-
    // lock fix), keyed off Didymos instead of Pluto.
    let dimorphosAbs = null, didymosState = null;
    if (isSmallBodyVisible("didymos", daysSinceEpoch) || isSatelliteVisible("Didymos (65803)", "Dimorphos")) {
      didymosState = computeSmallBodyState(SMALL_BODIES.didymos.elements, daysSinceEpoch);
      dimorphosAbs = buildSatelliteAbs(DIMORPHOS_ELEMENTS, didymosState, GM_DIDYMOS_DIMORPHOS_KM3_DAY2);
      worldStates.Dimorphos = { pos: dimorphosAbs.pos, vel: dimorphosAbs.vel };
    }

    // Outer moons: compute absolute states for all 16 bodies, keyed by name.
    const outerMoonAbs = {};
    PLANET_ORDER.forEach((planetName) => {
      if (!OUTER_MOONS[planetName]) return;
      const planetState  = worldStates[planetName];
      const gmKm3Day2    = OUTER_PLANET_GM_DAY2[planetName];
      OUTER_MOONS[planetName].forEach((moon) => {
        const abs = buildSatelliteAbs(moon.elements, planetState, gmKm3Day2);
        outerMoonAbs[moon.name] = { abs, primaryName: planetName, meta: moon.meta };
        worldStates[moon.name]  = { pos: abs.pos, vel: abs.vel };
      });
    });

    // ---- Spacecraft position in worldStates: if a flight is selected,
    // register the spacecraft's current heliocentric position so the
    // camera-follow code below can track it like any planet or moon.
    // Pre-launch → spacecraft is still at the launch planet.
    // In-transit → propagated from Lambert-derived Keplerian elements.
    // Post-arrival → spacecraft is at the destination planet.
    if (selectedFlightKey) {
      const sfRaw = FLIGHTS_RAW[selectedFlightKey];
      const { launchDays, arrivalDays } = getFlightDates(selectedFlightKey);
      let scPos;
      if (isMultiLeg(sfRaw)) {
        if (daysSinceEpoch < launchDays) {
          const firstLambert = sfRaw.legs.find(l => l.type === 'lambert');
          scPos = getBodyPositionAtDays(firstLambert.fromBody, daysSinceEpoch);
        } else if (daysSinceEpoch > arrivalDays) {
          const lambertLegs = sfRaw.legs.filter(l => l.type === 'lambert');
          scPos = getBodyPositionAtDays(lambertLegs[lambertLegs.length - 1].toBody, daysSinceEpoch);
        } else {
          scPos = computeMultiLegPosition(selectedFlightKey, daysSinceEpoch);
        }
      } else {
        if (daysSinceEpoch < launchDays) {
          scPos = worldStates[sfRaw.launchBody].pos;
        } else if (daysSinceEpoch > arrivalDays) {
          scPos = worldStates[sfRaw.destinationBody].pos;
        } else {
          scPos = computeFlightPosition(getSolvedFlight(selectedFlightKey), daysSinceEpoch);
        }
      }
      worldStates[sfRaw.name] = { pos: scPos, vel: [0, 0, 0] };
    }

    // ---- Camera follow: if a body is locked, force camX/camY so that
    // body's projected position lands at the viewport center every frame,
    // while still respecting the user's current yaw/pitch/zoom -- i.e.
    // rotate and zoom keep working around the followed body, only manual
    // panning is superseded (since it would be overwritten next frame
    // anyway; the pan gesture is disabled while locked, see mousedown
    // handler, so this isn't fighting the user, just keeping the maths
    // consistent with what the UI actually allows). Skipped entirely in
    // free-camera ("hold frame") mode -- see freeCameraMode's own comment.
    if (lockedBodyName && worldStates[lockedBodyName] && !freeCameraMode) {
      const lockedPos = worldStates[lockedBodyName].pos;
      const [rx, ry] = rotateWorld(lockedPos[0], lockedPos[1], lockedPos[2] || 0);
      // We want: viewW/2 + camX + rx*pxPerAU == viewW/2  =>  camX = -rx*pxPerAU
      // (worldToScreen computes cx + rx*pxPerAU where cx = viewW/2 + camX)
      camX = -rx * pxPerAU;
      camY = ry * pxPerAU;
    }

    // After camera-follow above, so the readout reflects this frame's
    // final camX/camY, not a stale value from before it was corrected.
    if (sceneFramingVisible) updateSceneFramingPanel();
    // Cheap no-op when closed (dashboardVisible false) -- same lazy-cost
    // gating pattern as the Scene Framing readout above. The main canvas
    // keeps rendering underneath regardless (frame() is never gated on
    // panel visibility), so this needs no pause/resume logic of its own.
    if (dashboardVisible) {
      const frameOpts = getHodographFrameOptions(daysSinceEpoch);
      updateHodographFrameToggle(frameOpts);
      drawHodograph(daysSinceEpoch, hodographWidget1, hodographFrameKey);
      // The second widget is fully derived from daysSinceEpoch each frame
      // (no stored selection state) -- it shows the flyby body's local
      // frame exactly while a real SOI transit window is active, and
      // never otherwise. At most one extra is possible at a time with
      // this catalog's leg spacing (see getHodographFrameOptions).
      const flybyExtras = frameOpts.extras.filter((o) => o.key.startsWith('flyby:'));
      if (flybyExtras.length > 0) {
        hodographWidget2.widgetEl.style.display = "flex";
        drawHodograph(daysSinceEpoch, hodographWidget2, flybyExtras[0].key);
      } else {
        hodographWidget2.widgetEl.style.display = "none";
      }
    }

    // Orbit paths (drawn first, beneath bodies)
    renderedPaths = [];
    ctx.lineWidth = 1;
    PLANET_ORDER.forEach((name) => {
      ctx.strokeStyle = hexWithAlpha(PLANET_META[name].color, 0.28);
      const pts = drawOrbitEllipse(PLANET_ELEMENTS[name], daysSinceEpoch);
      renderedPaths.push({ name, color: PLANET_META[name].color, segments: [pts] });
    });
    if (earthState && isSatelliteVisible("Earth", "Moon")) {
      ctx.strokeStyle = hexWithAlpha(MOON_META.color, 0.35);
      const pts = drawOrbitEllipseAroundPoint(MOON_ELEMENTS, daysSinceEpoch, earthState.pos);
      renderedPaths.push({ name: "Moon", color: MOON_META.color, segments: [pts] });
    }
    if (marsState) {
      if (isSatelliteVisible("Mars", "Phobos")) {
        ctx.strokeStyle = hexWithAlpha(PHOBOS_META.color, 0.35);
        const pts = drawOrbitEllipseAroundPoint(PHOBOS_ELEMENTS, daysSinceEpoch, marsState.pos);
        renderedPaths.push({ name: "Phobos", color: PHOBOS_META.color, segments: [pts] });
      }
      if (isSatelliteVisible("Mars", "Deimos")) {
        ctx.strokeStyle = hexWithAlpha(DEIMOS_META.color, 0.35);
        const pts = drawOrbitEllipseAroundPoint(DEIMOS_ELEMENTS, daysSinceEpoch, marsState.pos);
        renderedPaths.push({ name: "Deimos", color: DEIMOS_META.color, segments: [pts] });
      }
    }
    PLANET_ORDER.forEach((planetName) => {
      if (!OUTER_MOONS[planetName]) return;
      const pPos = worldStates[planetName].pos;
      OUTER_MOONS[planetName].forEach((moon) => {
        if (!isSatelliteVisible(planetName, moon.name)) return;
        ctx.strokeStyle = hexWithAlpha(moon.meta.color, 0.35);
        const pts = drawOrbitEllipseAroundPoint(moon.elements, daysSinceEpoch, pPos);
        renderedPaths.push({ name: moon.name, color: moon.meta.color, segments: [pts] });
      });
    });
    if (plutoState && isSatelliteVisible("Pluto and Charon", "Charon")) {
      ctx.strokeStyle = hexWithAlpha(CHARON_META.color, 0.35);
      const pts = drawOrbitEllipseAroundPoint(CHARON_ELEMENTS, daysSinceEpoch, plutoState.pos);
      renderedPaths.push({ name: "Charon", color: CHARON_META.color, segments: [pts] });
    }
    if (didymosState && isSatelliteVisible("Didymos (65803)", "Dimorphos")) {
      ctx.strokeStyle = hexWithAlpha(DIMORPHOS_META.color, 0.35);
      const pts = drawOrbitEllipseAroundPoint(DIMORPHOS_ELEMENTS, daysSinceEpoch, didymosState.pos);
      renderedPaths.push({ name: "Dimorphos", color: DIMORPHOS_META.color, segments: [pts] });
    }

    // Small body orbit ellipses: narrower than the body's own dot
    // visibility (see isSmallBodyOrbitVisible) -- only clicking the body
    // directly, or clicking/selecting a mission that targets it, reveals
    // its path; merely being in the widened in-transit window (which
    // shows the dot) is not enough on its own.
    Object.entries(SMALL_BODIES).forEach(([key, body]) => {
      if (!isSmallBodyOrbitVisible(key)) return;
      ctx.strokeStyle = hexWithAlpha(body.meta.color, 0.35);
      // Long-period/near-parabolic comets (crossingWindowDays set) have no
      // meaningful "whole orbit" to draw -- just the arc through their
      // real crossing, sampled by time rather than swept by true anomaly.
      const pts = body.crossingWindowDays != null
        ? drawSmallBodyArcByTime(body.elements, body.elements.epochDays - body.crossingWindowDays, body.elements.epochDays + body.crossingWindowDays)
        : drawSmallBodyOrbitEllipse(body.elements);
      renderedPaths.push({ name: body.name, color: body.meta.color, segments: [pts] });
    });

    // Flight trajectory arcs: shown only while the flight is selected or
    // genuinely in transit (see isFlightVisible) -- not as a permanent
    // historical record, since at any meaningful scale (dozens, hundreds,
    // eventually thousands of flights as logistics/terraforming expands
    // this) drawing every arc unconditionally would make the view
    // unreadable. A completed flight's path disappears once you move on,
    // the same way a moon's orbit disappears once you stop focusing on
    // its planet.
    //
    // An unselected flight (visible only because it's genuinely in transit
    // right now) draws just a rolling +/-TRAJECTORY_WINDOW_DAYS window
    // around the current date, thinner and dimmer than a selected one --
    // full multi-year paths for every simultaneously-in-transit mission
    // (BepiColombo, Lucy, PSP...) turned the view into unreadable clutter.
    // Clicking a flight is the deliberate "show me the whole thing"
    // action: it draws every leg in full, at full weight/opacity, so the
    // one you actually care about reads clearly against the muted rest.
    FLIGHTS_ORDER.forEach((key) => {
      if (!isFlightVisible(key, daysSinceEpoch)) return;
      const selected = selectedFlightKey === key;
      ctx.strokeStyle = flightColor(key);
      ctx.lineWidth = selected ? 1.6 : 0.9;
      let segments;
      if (selected && orbitViewMode === "current") {
        // "Current orbit only": one 360-degree loop anchored on wherever
        // the spacecraft actually is right now (see getCurrentOrbitElements/
        // drawCurrentOrbitEllipse), REPLACING the full/windowed path
        // rather than drawing both -- the toggle is an either/or choice.
        const orbitInfo = getCurrentOrbitElements(key, daysSinceEpoch);
        const pts = orbitInfo && drawCurrentOrbitEllipse(orbitInfo.elements, orbitInfo.centerAU, orbitInfo.gmAU3Day2, daysSinceEpoch);
        segments = pts ? [pts] : [];
      } else if (isMultiLeg(FLIGHTS_RAW[key])) {
        if (selected) {
          segments = drawMultiLegArcs(key);
        } else {
          segments = drawMultiLegArcs(key, {
            windowStart: daysSinceEpoch - TRAJECTORY_WINDOW_DAYS,
            windowEnd: daysSinceEpoch + TRAJECTORY_WINDOW_DAYS,
            alphaScale: 0.55,
          });
        }
      } else {
        const flight = getSolvedFlight(key);
        if (selected) {
          ctx.globalAlpha = 1;
          segments = [drawFlightArc(flight)];
        } else {
          const ws = Math.max(flight.launchDays, daysSinceEpoch - TRAJECTORY_WINDOW_DAYS);
          const we = Math.min(flight.arrivalDays, daysSinceEpoch + TRAJECTORY_WINDOW_DAYS);
          ctx.globalAlpha = 0.55;
          segments = [drawFlightArc(flight, ws, we)];
          ctx.globalAlpha = 1;
        }
      }
      renderedPaths.push({ name: FLIGHTS_RAW[key].name, flightKey: key, color: flightColor(key), segments: segments || [] });
    });

    // Hover/near-tap preview glow: a single extra stroke over whichever
    // path the pointer is currently nearest to (see handleHover), wider
    // and translucent so it reads as "this is what a click here selects"
    // without permanently thickening every path and cluttering Broad mode.
    //
    // hoveredPathEntry is only ever (re)assigned from a mousemove event
    // (handleHover), not every frame -- but this block runs every frame,
    // and renderedPaths is rebuilt from scratch every frame too (fresh
    // objects, see "renderedPaths = []" above), so hoveredPathEntry itself
    // is a reference to a PAST frame's object whose .segments are frozen
    // at wherever they were projected to at that moment. Drawing them
    // directly would glow a stale, increasingly wrong screen location any
    // time the camera moves without a new mousemove to refresh it -- most
    // noticeably while auto-following a tracked body: the glow stays
    // frozen near the mouse's last real position instead of following the
    // hovered path to wherever it actually renders now. Re-find THIS
    // frame's live entry for the same identity instead, and just use its
    // segments; if it's no longer being rendered at all (e.g. visibility
    // changed), drop the stale hover state entirely.
    if (hoveredPathEntry) {
      const liveEntry = renderedPaths.find((p) =>
        p.name === hoveredPathEntry.name && p.flightKey === hoveredPathEntry.flightKey);
      if (liveEntry) {
        ctx.save();
        ctx.strokeStyle = hexWithAlpha(liveEntry.color, 0.35);
        ctx.lineWidth = 6;
        for (const seg of liveEntry.segments) {
          ctx.beginPath();
          seg.forEach(([x, y], k) => { if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
          ctx.stroke();
        }
        ctx.restore();
      } else {
        hoveredPathEntry = null;
      }
    }

    // Lagrange point diamond markers for the active multi-leg flight
    drawLagrangeMarkers(daysSinceEpoch);

    // SOI boundary circles for flyby planets in the active flight
    drawSOIOverlay(daysSinceEpoch);

    // Coordinate reference planes + galactic-motion arrow, only while Sol
    // itself is locked
    drawSolOverlay();

    // ---- Pass 2: project everything to screen space now that the camera
    // (including any follow-correction above) is finalized for this frame.
    const bodies = [];

    const [sunSx, sunSy, sunRz] = worldToScreen(0, 0, 0);
    bodies.push({
      name: "Sol", sx: sunSx, sy: sunSy, rz: sunRz,
      screenR: bodyScreenRadius(SUN_RADIUS_KM, true),
      color: SUN_COLOR, isSun: true, primary: null,
      pos: [0, 0, 0], vel: [0, 0, 0], r: 0, e: 0, i: 0, a: 0
    });

    PLANET_ORDER.forEach((name) => {
      const state = worldStates[name];
      const [sx, sy, rz] = worldToScreen(state.pos[0], state.pos[1], state.pos[2]);
      const meta = PLANET_META[name];
      bodies.push({
        name, sx, sy, rz,
        screenR: bodyScreenRadius(meta.radiusKm, false),
        color: meta.color, isSun: false, primary: "Sol",
        pos: state.pos, vel: state.vel, r: state.r, e: state.e, i: state.i, a: state.a,
        radiusKm: meta.radiusKm // every planet is spherical enough that dimensionsKm never applies here
      });
    });

    // Shared body-record construction for any satellite, given its
    // pre-computed absolute state (from buildSatelliteAbs above) and meta.
    function pushSatelliteBody(name, abs, primaryName, meta) {
      const [sx, sy, rz] = worldToScreen(abs.pos[0], abs.pos[1], abs.pos[2]);
      bodies.push({
        name, sx, sy, rz,
        screenR: bodyScreenRadius(meta.radiusKm, false),
        color: meta.color, isSun: false, primary: primaryName,
        pos: abs.pos, vel: abs.vel,
        r: abs.sat.rKm / AU_KM, e: abs.sat.e, i: abs.sat.i, a: abs.sat.a / AU_KM,
        rKmFromPrimary: abs.sat.rKm,
        primaryGmKm3Day2: abs.primaryGmKm3Day2,
        radiusKm: meta.radiusKm, dimensionsKm: meta.dimensionsKm, shapeNote: meta.shapeNote
      });
    }

    if (moonAbs && isSatelliteVisible("Earth", "Moon")) pushSatelliteBody("Moon", moonAbs, "Earth", MOON_META);
    if (phobosAbs && isSatelliteVisible("Mars", "Phobos")) pushSatelliteBody("Phobos", phobosAbs, "Mars", PHOBOS_META);
    if (deimosAbs && isSatelliteVisible("Mars", "Deimos")) pushSatelliteBody("Deimos", deimosAbs, "Mars", DEIMOS_META);
    Object.entries(outerMoonAbs).forEach(([moonName, { abs, primaryName, meta }]) => {
      if (isSatelliteVisible(primaryName, moonName)) pushSatelliteBody(moonName, abs, primaryName, meta);
    });
    if (charonAbs && isSatelliteVisible("Pluto and Charon", "Charon")) {
      pushSatelliteBody("Charon", charonAbs, "Pluto and Charon", CHARON_META);
    }
    if (dimorphosAbs && isSatelliteVisible("Didymos (65803)", "Dimorphos")) {
      pushSatelliteBody("Dimorphos", dimorphosAbs, "Didymos (65803)", DIMORPHOS_META);
    }

    // Asteroids/comets: hidden by default (see isSmallBodyVisible) --
    // heliocentric like a planet, so the body record shape matches a
    // planet's exactly (primary: "Sol"), which is what lets the locked
    // panel's existing generic-heliocentric-body branch render one with
    // no new panel code.
    Object.entries(SMALL_BODIES).forEach(([key, body]) => {
      if (!isSmallBodyVisible(key, daysSinceEpoch)) return;
      const state = computeSmallBodyState(body.elements, daysSinceEpoch);
      const [sx, sy, rz] = worldToScreen(state.pos[0], state.pos[1], state.pos[2]);
      bodies.push({
        name: body.name, sx, sy, rz,
        screenR: bodyScreenRadius(body.meta.radiusKm, false),
        color: body.meta.color, isSun: false, primary: "Sol",
        pos: state.pos, vel: state.vel, r: state.r, e: state.e, i: state.i, a: state.a,
        radiusKm: body.meta.radiusKm, dimensionsKm: body.meta.dimensionsKm, shapeNote: body.meta.shapeNote
      });
    });

    // Spacecraft markers: only exist (are drawn, clickable, hoverable)
    // while the simulated date falls within the flight's actual transit
    // window -- this is a stricter check than isFlightVisible, which also
    // allows showing a SELECTED flight's planned path before launch (for
    // logistics/planning purposes). A marker, unlike the path itself,
    // represents a physical spacecraft; showing one sitting on a future
    // path before launch, or frozen after arrival, would misrepresent
    // what's actually happening rather than just omitting something.
    FLIGHTS_ORDER.forEach((key) => {
      const { launchDays, arrivalDays } = getFlightDates(key);
      if (daysSinceEpoch < launchDays || daysSinceEpoch > arrivalDays) return;
      const raw = FLIGHTS_RAW[key];
      let pos, e, i, a;
      if (isMultiLeg(raw)) {
        pos = computeMultiLegPosition(key, daysSinceEpoch);
        e = 0; i = 0; a = Math.hypot(...pos); // display fields only; orbital elements not meaningful across legs
      } else {
        const flight = getSolvedFlight(key);
        pos = computeFlightPosition(flight, daysSinceEpoch);
        e = flight.elements.e; i = flight.elements.i; a = flight.elements.a;
      }
      const [sx, sy, rz] = worldToScreen(pos[0], pos[1], pos[2]);
      bodies.push({
        name: raw.name, flightKey: key, sx, sy, rz,
        screenR: 3, color: flightColor(key), isSun: false, isFlight: true, primary: null,
        pos, vel: [0, 0, 0], r: Math.hypot(...pos), e, i, a
      });
    });

    // When the selected flight is outside its transit window (before launch
    // or after arrival), push a virtual marker at the anchor planet so the
    // locked panel connector has a body to attach to and can display mission
    // data via formatLockedPanelContent. The in-transit case is already
    // handled by the FLIGHTS_ORDER forEach above.
    if (selectedFlightKey) {
      const { launchDays, arrivalDays } = getFlightDates(selectedFlightKey);
      if (daysSinceEpoch < launchDays || daysSinceEpoch > arrivalDays) {
        const sfRaw = FLIGHTS_RAW[selectedFlightKey];
        let anchorPos, e, i, a;
        if (isMultiLeg(sfRaw)) {
          const lambertLegs = sfRaw.legs.filter(l => l.type === 'lambert');
          const anchorBodyKey = daysSinceEpoch < launchDays
            ? lambertLegs[0].fromBody
            : lambertLegs[lambertLegs.length - 1].toBody;
          anchorPos = getBodyPositionAtDays(anchorBodyKey, daysSinceEpoch);
          e = 0; i = 0; a = Math.hypot(...anchorPos);
        } else {
          const sf = getSolvedFlight(selectedFlightKey);
          const anchorName = daysSinceEpoch < launchDays ? sfRaw.launchBody : sfRaw.destinationBody;
          anchorPos = worldStates[anchorName].pos;
          e = sf.elements.e; i = sf.elements.i; a = sf.elements.a;
        }
        const [sx, sy, rz] = worldToScreen(anchorPos[0], anchorPos[1], anchorPos[2]);
        bodies.push({
          name: sfRaw.name, flightKey: selectedFlightKey, sx, sy, rz,
          screenR: 3, color: flightColor(selectedFlightKey), isSun: false, isFlight: true, primary: null,
          pos: anchorPos, vel: [0, 0, 0], r: Math.hypot(...anchorPos), e, i, a
        });
      }
    }

    // Consistent depth ordering: whichever rotated side currently faces the
    // viewer is drawn last, on top. This is SMALLER rz, not larger --
    // verified against real astronomical fact (not just internal self-
    // consistency, which the previous `a.rz - b.rz` direction also had,
    // making this bug easy to miss): at yaw=4.13deg/pitch=78.72deg, on
    // 2022-05-31 Mercury sits in front of Sol (rz=-0.46) and was rendered
    // hidden behind it under the old ascending sort; on 2024-03-18 Mercury
    // sits behind Sol (rz=+0.30) and was rendered in front of it. Both
    // were backwards -- `rotateWorld`'s pitch rotation is a proper,
    // sign-consistent rotation with no inherent flip (confirmed
    // separately), so this was a real, orientation-independent inversion
    // in the sort direction itself, not a case-by-case edge condition.
    bodies.sort((a, b) => b.rz - a.rz);

    renderedBodies = [];
    bodies.forEach((b) => {
      // Direction from this body toward Sol (Sol sits at the world
      // origin, so this is simply -pos, normalized), rotated through the
      // same yaw/pitch transform as everything else so the lit side
      // tracks both the body's real position relative to the Sun and the
      // current camera angle. Bodies essentially at the origin (Sol
      // itself) skip this -- drawBody special-cases isSun anyway.
      let lightDirX = 0, lightDirY = -1; // arbitrary default, only used if magnitude is ~0
      const distFromSol = Math.hypot(b.pos[0], b.pos[1], b.pos[2]);
      if (distFromSol > 1e-9) {
        const toSolWorld = [-b.pos[0] / distFromSol, -b.pos[1] / distFromSol, -b.pos[2] / distFromSol];
        const [rx, ry] = rotateWorld(toSolWorld[0], toSolWorld[1], toSolWorld[2]);
        const screenMag = Math.hypot(rx, ry);
        if (screenMag > 1e-9) {
          // Screen Y is flipped relative to world Y in worldToScreen
          // (cy - ry * pxPerAU), so the direction vector's Y must flip
          // the same way to stay consistent with where things actually
          // render on screen.
          lightDirX = rx / screenMag;
          lightDirY = -ry / screenMag;
        }
      }
      drawBody(b.sx, b.sy, b.screenR, b.color, b.isSun, lightDirX, lightDirY);
      renderedBodies.push(b);
    });

    drawLockedPanelConnector();
    drawDateLabel();

    requestAnimationFrame(frame);
  }

  function hexWithAlpha(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // Darkens a hex color toward black by the given fraction (0 = unchanged,
  // 1 = pure black), used for the shadowed side of a planet. Mixing
  // toward black (rather than just lowering alpha, which would let the
  // dark space background show through and look translucent) keeps the
  // sphere reading as a solid, lit object instead of a fading circle.
  function hexDarken(hex, fraction) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const k = 1 - fraction;
    return `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;
  }

  // Stars: generate once, draw as fixed screen-space dots (decorative only)
  let stars = null;
  function drawStars() {
    if (!stars) {
      stars = [];
      const count = 220;
      for (let k = 0; k < count; k++) {
        stars.push({
          x: Math.random(),
          y: Math.random(),
          r: Math.random() * 1.1 + 0.2,
          a: Math.random() * 0.5 + 0.2
        });
      }
    }
    ctx.save();
    stars.forEach((s) => {
      ctx.fillStyle = `rgba(255,255,255,${s.a})`;
      ctx.beginPath();
      ctx.arc(s.x * viewW, s.y * viewH, s.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  // Minimum visible radius in px so planets remain visible/clickable even at
  // true relative scale (per user request: AU distances true to scale, but
  // bodies should stay visible -- true-size comparison is shown in the side
  // panel toggle instead of warping the main scene).
  const MIN_BODY_PX = 4;
  const SUN_DISPLAY_PX = 14; // fixed visual size for the sun in the main scene
  const PLANET_DISPLAY_BASE_PX = 5; // base visual size for planets in the main scene

  function bodyScreenRadius(radiusKm, isSun) {
    if (isSun) return SUN_DISPLAY_PX;
    // Gentle log-ish scaling so gas giants read larger than terrestrials
    // without being literally true-to-scale (which would make them
    // invisible relative to AU-scale distances, per user's explicit request).
    const ratio = radiusKm / PLANET_META.Earth.radiusKm;
    const scaled = PLANET_DISPLAY_BASE_PX * Math.pow(ratio, 0.42);
    return Math.max(MIN_BODY_PX, scaled);
  }

  // lightDirX/lightDirY: unit vector, in SCREEN space, pointing from the
  // body TOWARD Sol -- i.e. where the lit hemisphere should face. Caller
  // computes this once per body per frame (see frame()'s body-drawing
  // loop) by rotating the body-to-Sol world-space direction through the
  // same yaw/pitch transform already used for position, so the lit side
  // visually tracks both the body's real orbital position relative to
  // the Sun AND the current camera angle.
  function drawBody(sx, sy, screenR, color, isSun, lightDirX, lightDirY) {
    if (isSun) {
      const glowR = screenR * 3.2;
      const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, glowR);
      grad.addColorStop(0, hexWithAlpha(color, 0.55));
      grad.addColorStop(1, hexWithAlpha(color, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(sx, sy, glowR, 0, Math.PI * 2);
      ctx.fill();

      // The Sun IS the light source, so it is drawn as an even, glowing
      // disc rather than shaded -- a "lit side" wouldn't make physical
      // sense for the thing doing the lighting.
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(sx, sy, screenR, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    // Offset the gradient's bright center toward the light direction, by
    // a fraction of the body's own radius -- this is the standard
    // Canvas2D "fake sphere" trick: a flat radial gradient with a
    // off-center hotspot reads as a curved, lit surface far more
    // convincingly than a gradient centered on the circle itself (which
    // just looks like a glow, not a sphere).
    const offsetFrac = 0.42;
    const hx = sx + lightDirX * screenR * offsetFrac;
    const hy = sy + lightDirY * screenR * offsetFrac;

    const grad = ctx.createRadialGradient(hx, hy, 0, sx, sy, screenR * 1.35);
    grad.addColorStop(0, hexWithAlpha(color, 1));       // lit hotspot, full color
    grad.addColorStop(0.45, color);                      // mid-tone, true color
    grad.addColorStop(0.78, hexDarken(color, 0.55));      // terminator region
    grad.addColorStop(1, hexDarken(color, 0.88));         // deep shadow side

    ctx.save();
    ctx.beginPath();
    ctx.arc(sx, sy, screenR, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip(); // keep the gradient strictly within the body's own disc
    ctx.fillStyle = grad;
    ctx.fillRect(sx - screenR, sy - screenR, screenR * 2, screenR * 2);
    ctx.restore();
  }

  function drawDateLabel() {
    // Rendered via the HTML panel's date input value already; nothing extra
    // needed on canvas itself. Reserved hook if an in-canvas label is later
    // desired (e.g., for screenshots/export).
  }

  // Bootstrap: everything above this point is function/variable
  // definitions, which don't execute until called -- so load order
  // doesn't matter for any of it. This is the one place load order DOES
  // matter: buildFlightsLegend() reads FLIGHTS_RAW/FLIGHTS_ORDER, and the
  // render loop (frame(), via requestAnimationFrame) reads them every
  // frame through getFlightDates()/getSolvedFlight() once a flight is
  // selected or in transit. Both must wait for loadFlightsRaw() to
  // actually populate that data from data/flights/manifest.json and the
  // per-flight JSON files before either runs.
  async function bootstrap() {
    try {
      await loadFlightsRaw();
    } catch (err) {
      // Surface the failure visibly rather than silently leaving the
      // legend empty with no explanation -- a missing or malformed
      // data/flights/manifest.json or data/flights/<key>.json file is a real
      // authoring error someone needs to notice and fix, not something
      // to paper over.
      console.error("Failed to load flight data:", err);
      const note = document.createElement("div");
      note.className = "empty-note";
      note.textContent = "Failed to load flight data (see console)";
      flightsRows.appendChild(note);
    }
    try {
      await loadBodyInfo();
    } catch (err) {
      // Unlike flight data, body info (images/"why it matters" text) is
      // purely supplementary to an already-functional locked panel -- log
      // and move on rather than blocking the whole app over a missing or
      // malformed data/bodies/info.json.
      console.error("Failed to load body info:", err);
    }
    buildFlightsLegend();
    applyInitialURLState();
    requestAnimationFrame(frame);
  }
  bootstrap();

})();
