# Interplanetary missions since 1988: completeness check

**Status:** list audit only, 2026-11-28. Dates, times and details are not
audited here; the maintainer will audit those later. The question here is
only whether the flight list is complete.

## What existed before this check

- `data/catalog/interplanetary_missions.json` (44 entries) is the phase-1
  catalog. Its own `_meta` marks most entries `first_pass`: "compiled
  quickly from general reference sources (Wikipedia, Planetary Society) for
  breadth". Its scope is "left Earth-Moon space", excluding lunar-only and
  Earth-orbit missions. It was never checked against a definitive list,
  and six of its entries aren't flights in the app: Mangalyaan-2, Shukrayaan,
  Tianwen-3, Tianwen-4 and ExoMars Rosalind Franklin (not launched), and
  Phobos-Grunt (never left Earth orbit).
- `docs/project-transfer.md` §7.3 says that file "was never carried into
  the repo". That's wrong: it's there, at the path above.
- `data/flights/manifest.json` has **58 flights launched since 1988**
  (Phobos 1 to MMX).

## Sources

### Definitive (primary) lists

| Source | Covers | Limits |
|---|---|---|
| **NASA NSSDCA, Chronology of Lunar and Planetary Exploration** — page https://nssdc.gsfc.nasa.gov/planetary/chrono.html, data file https://nssdc.gsfc.nasa.gov/planetary/chronology.xml (785 entries, 405 since 1988) | Every lunar and planetary launch, with target, status, agency and NSSDCA record link | **Planetary only.** Leaves out heliophysics and astrophysics craft (Ulysses, SOHO, ACE, Wind, STEREO, Parker Solar Probe, Solar Orbiter, Aditya-L1, Roman), and also Deep Space 1. Some statuses and targets look wrong (see Discrepancies). Many entries are Earth-orbit (ISS, Shuttle flights) and need filtering. |
| **A. A. Siddiqi, *Beyond Earth: A Chronicle of Deep Space Exploration, 1958–2016*** (NASA SP-2018-4041), https://www.nasa.gov/sites/default/files/atoms/files/beyond-earth-tagged.pdf | Every mission beyond Earth orbit to 2016, one entry each, including Sun–Earth Lagrange-point and Earth-trailing observatories, cubesats and secondary payloads | **Ends in 2016.** Includes lunar missions and some high-Earth-orbit ones (Geotail), which are out of scope here. |

### Secondary (cross-check) lists

| Source | Covers | Limits |
|---|---|---|
| **JPL Horizons spacecraft list** (`COMMAND='MB'` on https://ssd.jpl.nasa.gov/api/horizons.api; 276 spacecraft) | Every craft Horizons has an ephemeris for, with COSPAR IDs | **Not complete:** Webb (-170), IMAP (-43), Carruthers (-171) and Spitzer (-79) are in Horizons but missing from that list. Includes many Earth satellites. Has no ephemeris for Soviet craft, Magellan, Mars Global Surveyor, Mars Climate Orbiter, Mars Polar Lander, Mars Observer, Chang'e 2 or Tianwen-2. |
| **Wikipedia, "List of Solar System probes"** (https://en.wikipedia.org/wiki/List_of_Solar_System_probes, via the MediaWiki API) | Organised by target, with COSPAR IDs; includes recent and private missions (e.g. AstroForge's Odin, 2025) | Not authoritative; some rows lack COSPAR IDs. Used only to catch omissions. |

Both secondary sources and NSSDCA are rechecked at each data pull
(`docs/data-pulls.md`).

## Result: the app's 58 post-1988 flights against the sources

Every app flight appears in at least two sources; all 58 are in the
Wikipedia list. A dash under Siddiqi before 2016 is a parsing miss
(combined entries such as "Deep Space 2" with Mars Polar Lander, and
"Schiaparelli EDM Lander" with ExoMars TGO), not an absence. "n/a" = launched
after Siddiqi's 2016 cut-off.

| App flight | NSSDCA chronology | Siddiqi (to 2016) | Horizons ID | Wikipedia list |
|---|---|---|---|---|
| Phobos 1 | ✓ | ✓ | — | ✓ |
| Phobos 2 | ✓ | ✓ | — | ✓ |
| Magellan | ✓ | ✓ | — | ✓ |
| Galileo | ✓ | ✓ | -77 | ✓ |
| Ulysses | — | ✓ | -55 | ✓ |
| Mars Observer | ✓ | ✓ | — | ✓ |
| NEAR Shoemaker | ✓ | ✓ | -93 | ✓ |
| Mars Global Surveyor | ✓ | ✓ | — | ✓ |
| Mars Pathfinder | ✓ | ✓ | -530 | ✓ |
| Cassini-Huygens | ✓ | ✓ | -82 | ✓ |
| Nozomi (Planet-B) | ✓ | ✓ | -178 | ✓ |
| Deep Space 1 | — | ✓ | -30 | ✓ |
| Mars Climate Orbiter | ✓ | ✓ | — | ✓ |
| Mars Polar Lander | ✓ | — | — | ✓ |
| Stardust | ✓ | ✓ | -29 | ✓ |
| Mars Odyssey | ✓ | ✓ | -53 | ✓ |
| Genesis | ✓ | ✓ | -47 | ✓ |
| Hayabusa | ✓ | ✓ | -130 | ✓ |
| Mars Express | ✓ | ✓ | -41 | ✓ |
| Spirit (MER-A) | ✓ | ✓ | -254 | ✓ |
| Opportunity (MER-B) | ✓ | ✓ | -253 | ✓ |
| Rosetta | ✓ | ✓ | -226 | ✓ |
| MESSENGER | ✓ | ✓ | -236 | ✓ |
| Deep Impact | ✓ | ✓ | -140 | ✓ |
| Mars Reconnaissance Orbiter | ✓ | ✓ | -74 | ✓ |
| Venus Express | ✓ | ✓ | -248 | ✓ |
| STEREO-A | — | ✓ | -234 | ✓ |
| STEREO-B | — | ✓ | -235 | ✓ |
| New Horizons | ✓ | ✓ | -98 | ✓ |
| Phoenix | ✓ | ✓ | -84 | ✓ |
| Dawn | ✓ | ✓ | -203 | ✓ |
| Akatsuki (Venus Climate Orbiter) | ✓ | ✓ | -5 | ✓ |
| Chang'e 2 (extended mission asteroid flyby) | — | ✓ | — | ✓ |
| Juno | ✓ | ✓ | -61 | ✓ |
| Curiosity (Mars Science Laboratory) | ✓ | ✓ | -76 | ✓ |
| Mars Orbiter Mission (Mangalyaan) | ✓ | ✓ | -3 | ✓ |
| MAVEN | ✓ | ✓ | -202 | ✓ |
| Hayabusa2 | ✓ | ✓ | -37 | ✓ |
| ExoMars Trace Gas Orbiter | ✓ | — | -143 | ✓ |
| OSIRIS-REx | ✓ | ✓ | -64 | ✓ |
| InSight | ✓ | n/a | -189 | ✓ |
| Parker Solar Probe | — | n/a | -96 | ✓ |
| BepiColombo | ✓ | n/a | -121 | ✓ |
| Solar Orbiter | — | n/a | -144 | ✓ |
| Hope (Al-Amal) | ✓ | n/a | -62 | ✓ |
| Tianwen-1 | ✓ | n/a | -9901491 | ✓ |
| Perseverance (Mars 2020) | ✓ | n/a | -168 | ✓ |
| Lucy | ✓ | n/a | -49 | ✓ |
| DART (Double Asteroid Redirection Test) | ✓ | ✓ | -135 | ✓ |
| JUICE (Jupiter Icy Moons Explorer) | ✓ | n/a | -28 | ✓ |
| Aditya-L1 | — | n/a | -156 | ✓ |
| Psyche | ✓ | n/a | -255 | ✓ |
| Hera | ✓ | n/a | -91 | ✓ |
| Europa Clipper | ✓ | n/a | -159 | ✓ |
| Tianwen-2 | ✓ | n/a | — | ✓ |
| ESCAPADE | ✓ | n/a | -9 | ✓ |
| Nancy Grace Roman Space Telescope | — | n/a | -211 | ✓ |
| MMX (Martian Moons eXploration) | ✓ | n/a | -239 | ✓ |

## Missing from the app

### A. Probes to planets, small bodies or deep space (in scope; candidates to add)

The Note column summarises each mission's fate as listed in the sources (mainly the Wikipedia list's notes); it isn't audited yet.

| Mission | Launch | What | In sources | Note |
|---|---|---|---|---|
| CONTOUR | 2002 | NASA comet mission | NSSDCA, Siddiqi, Horizons (3 fragments), Wikipedia | Broke apart during its Earth-departure burn; Horizons tracks the fragments, so it left Earth orbit. Would be a very short path. |
| IKAROS | 2010 | JAXA solar-sail demonstrator, Venus flyby | Siddiqi, Wikipedia | Launched with Akatsuki. |
| Shin'en (UNITEC-1) | 2010 | Student probe, Venus flyby | Siddiqi, Wikipedia | Launched with Akatsuki; contact lost early. |
| PROCYON | 2014 | Microsatellite, planned asteroid flyby | Siddiqi, Wikipedia | Launched with Hayabusa2; the flyby was abandoned after an engine failure. |
| Shin'en 2 | 2014 | Student probe, solar orbit | Siddiqi, Wikipedia | Launched with Hayabusa2. |
| DESPATCH (ArtSat-2) | 2014 | Art/education probe, solar orbit | Siddiqi, Wikipedia | Launched with Hayabusa2. |
| MarCO-A and MarCO-B | 2018 | Cubesats, Mars flyby relaying InSight's landing | Horizons (-65, -66), Wikipedia | Separate spacecraft with their own trajectories. |
| LICIACube | 2021 | ASI cubesat, DART impact flyby | NSSDCA, Horizons (-210), Wikipedia | Released by DART 15 days before impact. |
| BioSentinel | 2022 | NASA cubesat, solar orbit | Horizons (-70007), Wikipedia | Artemis I secondary payload; still operating in solar orbit (Horizons record revised 2026-11-03). |
| NEA Scout | 2022 | NASA solar-sail cubesat, asteroid flyby | NSSDCA, Horizons (-182), Wikipedia | Artemis I payload; never contacted. |
| Team Miles | 2022 | Cubesat to Mars | NSSDCA, Wikipedia | Artemis I payload; no contact. |
| CuSP | 2022 | NASA space-weather cubesat, solar orbit | Wikipedia | Artemis I payload; contact lost. |
| Odin (Brokkr-2) | 2025 | AstroForge (private) asteroid flyby | Horizons (COSPAR 2025-038, listed as Brokkr-2), Wikipedia | Launched with IM-2; contact problems early. |
| Clementine | 1994 | NASA/DoD lunar orbiter with a planned asteroid flyby (1620 Geographos) | NSSDCA, Siddiqi, Horizons (-40), Wikipedia | **Check:** the flyby was cancelled after a 1994 thruster malfunction. Whether it left Earth–Moon space decides whether it belongs here or under lunar missions (E). |

### B. Sun–Earth Lagrange-point and Earth-trailing observatories (scope decision needed)

The app already has some of this kind (Genesis, Aditya-L1 and Roman at
Sun–Earth L1/L2; STEREO-A/B in Earth-like solar orbits), but not the
others. Either add these or decide they're out of scope; today the app is
inconsistent.

| Mission | Launch | Where | In sources |
|---|---|---|---|
| Wind | 1994 | L1 | Siddiqi, Horizons (-8), Wikipedia |
| SOHO | 1995 | L1 | Siddiqi, Horizons (-21), Wikipedia |
| ACE | 1997 | L1 | Siddiqi, Horizons (-92), Wikipedia |
| WMAP | 2001 | L2 | Siddiqi, Horizons (-165), Wikipedia |
| Spitzer | 2003 | Earth-trailing solar orbit | Siddiqi, Horizons (-79), Wikipedia |
| Kepler | 2009 | Earth-trailing solar orbit | Siddiqi, Horizons (-227), Wikipedia |
| Herschel | 2009 | L2 | Siddiqi, Wikipedia |
| Planck | 2009 | L2 | Siddiqi, Wikipedia |
| Gaia | 2013 | L2 | Siddiqi, Horizons, Wikipedia |
| DSCOVR | 2015 | L1 | Siddiqi, Horizons (-78), Wikipedia |
| LISA Pathfinder | 2015 | L1 | Siddiqi, Horizons, Wikipedia |
| Spektr-RG | 2019 | L2 | Wikipedia |
| Chang'e 5 orbiter (extended mission) | 2020 | L1, after the lunar sample mission | Wikipedia ("other probes to leave Earth orbit") |
| James Webb Space Telescope | 2021 | L2 | NSSDCA, Horizons (-170), Wikipedia |
| Euclid | 2023 | L2 | Horizons (-680) |
| IMAP | 2025 | L1 | Horizons (-43), Wikipedia |
| Carruthers Geocorona Observatory | 2025 | L1 | Horizons (-171), Wikipedia |
| SWFO-L1 | 2025 | L1 | Horizons (-231) |

### C. Landers, probes and small craft carried by a flight already in the app

Normally shown as events of their parent flight, not as flights of their
own. Listed so the decision is explicit.

Galileo Probe (Galileo), Sojourner (Mars Pathfinder), Huygens (Cassini),
Deep Space 2 (Mars Polar Lander), Stardust and Genesis return capsules,
Beagle 2 (Mars Express), Philae (Rosetta), Deep Impact impactor,
Schiaparelli (ExoMars TGO), Ingenuity (Perseverance), Zhurong (Tianwen-1),
MASCOT and the MINERVA-II rovers (Hayabusa2), Milani and Juventas (Hera).

### D. Never left Earth orbit (excluded; no trajectory to draw)

Mars 96 (1996), Fobos-Grunt and Yinghuo-1 (2011). Also excluded: Geotail
(1992, high Earth orbit by design), PROBA-3 (2024, Earth orbit), and
Tesla Roadster (2018, in solar orbit but not a probe).

### E. Lunar missions that went beyond lunar orbit (scope decision)

Excluded so far by the "not lunar-only" rule, but each spent time beyond
the Moon: Hiten (1990, Earth–Moon Lagrange points), ARTEMIS P1/P2 (2007,
Earth–Moon L1/L2), Chang'e 5-T1 (2014, Earth–Moon L2), EQUULEUS (2022,
Earth–Moon L2), Chandrayaan-3's propulsion module (2023, returned to high
Earth orbit). Chang'e 2's asteroid flyby is in the app already.

### F. Not yet launched (watch list; not counted)

From NSSDCA's "in development" entries and the phase-1 catalog: ExoMars
Rosalind Franklin, Dragonfly, VERITAS, DAVINCI, EnVision, DESTINY+, Janus,
Mangalyaan-2, Shukrayaan, Tianwen-3, Tianwen-4.

## Discrepancies between sources

- **NSSDCA chronology:**
  - Lists MMX as "TBD / In development", though it launched 2026-10-19 (Horizons -239; in the app).
  - Marks Mars Express "Failure", apparently from Beagle 2's loss.
  - Marks Hayabusa and Genesis "Failure" (both returned samples; Genesis's capsule crashed on landing).
  - Gives Cassini's target as "Earth" and Galileo's as "Jovian Atmosphere".
  - Omits all heliophysics and astrophysics missions, plus Deep Space 1.
- **Horizons' spacecraft list** omits craft that Horizons does have (Webb, IMAP, Carruthers, Spitzer); search by name before concluding a craft isn't in Horizons.
- **Siddiqi** combines some missions into one entry (Mars Polar Lander with Deep Space 2; ExoMars TGO with Schiaparelli; Mars Express with Beagle 2; Rosetta with Philae).
- **Wikipedia** misses COSPAR IDs on some rows (JUICE, Hera and Europa Clipper appear in the text but not with COSPAR templates). It lists Odin under its rideshare designation, Brokkr-2.
- **Phase-1 catalog** vs app: six catalog entries aren't flights (above), and `docs/project-transfer.md` §7.3 misdescribes the file as absent.

## Next steps (maintainer decisions)

1. Category A: add these, or some of them? Most are small craft with sparse trajectory data, so they'd be dashed under the all-flights rule.
2. Category B: are Sun–Earth L1/L2 and Earth-trailing observatories in scope? The app already includes four.
3. Category E: are lunar missions that went to Earth–Moon Lagrange points in scope?
4. Then the date and detail audit, separately.
