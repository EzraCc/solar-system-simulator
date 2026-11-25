# Plan: spacecraft instruments and data feeds

**Status:** plan only. Nothing here is built yet. Listed as item 3 in
`docs/TODO.md`.

## Goal

For each spacecraft, a viewer should be able to see:

1. **What's on board.** Each instrument and subsystem that produces
   science data.
2. **What it measures.** In plain terms: "a camera that images in visible
   and near-infrared", "a magnetometer that measures the strength and
   direction of the magnetic field".
3. **What that tells us.** The science it answers, and its best-known
   results. For example, Juno's microwave radiometer showed that
   Jupiter's ammonia isn't evenly mixed.
4. **Where the data is.** Public data from raw to analyzed: raw images
   and telemetry, calibrated products, derived maps and catalogs, and
   live or near-live feeds where they exist. Where an archive has an API,
   it should be something we can look at in the app, not only link to.

## Principle: light in the app, full quality one click away

Decided 2026-11-25. The app carries only what it needs to look right and
tell the story:
- small image previews (a few hundred pixels);
- downsampled time series (a few hundred points per chart);
- short text.

Every preview links to the full-quality product at its archive or mission
site, for people who want the real data. No high-resolution files, raw
archives or full-cadence data are stored in the repo, and the app never
streams them. The surface maps already follow this: 1–2k-pixel copies in
`data/images/textures/`, with the credit line linking to the
full-resolution source.

## What the data world looks like

Planetary and heliophysics data is public by policy for NASA and ESA
missions, usually after a proprietary period of about 6 months. It's
organized by processing level. Viewers and the schema should use one
simple level scale that maps onto both conventions:

| Our level | NASA levels | PDS4 | Example |
|---|---|---|---|
| Raw | L0 / L1A | raw, partially processed | Perseverance raw camera frames, hours after downlink |
| Calibrated | L1B / L2 | calibrated | Radiometrically corrected images, field vectors in physical units |
| Derived | L3 / L4 | derived | Global maps, mosaics, shape models, catalogs, time-series indices |

**Candidate sources.** Each must be verified in phase 0. These are
starting points, not confirmed facts.

- **Archives (search and download):**
  - NASA Planetary Data System (PDS) and its discipline nodes:
    Atmospheres, Geosciences, Imaging, Planetary Plasma Interactions,
    Ring-Moon Systems, Small Bodies. Also NAIF, whose SPICE instrument
    kernels describe each instrument's field of view. PDS4 has a search
    API (the PDS Registry) with instrument and mission records, which may
    let us generate instrument lists rather than type them.
  - ESA Planetary Science Archive (PSA).
  - JAXA DARTS.
  - ISRO ISSDC / PRADAN.
  - CNSA lunar and planetary data release system.
  - UAE EMM Science Data Center (Hope).
  - NASA SPDF CDAWeb, for heliophysics time series.
- **APIs that could drive in-app views:**
  - HAPI, the Heliophysics API standard that CDAWeb and others serve:
    time series for Parker Solar Probe, Solar Orbiter, STEREO and others.
  - Mars rover raw-image feeds for Curiosity and Perseverance (JSON
    listings of new frames).
  - JunoCam raw images (published for public processing).
  - Helioviewer, for solar imagery (SDO, SOHO, Solar Orbiter EUI).
  - NOAA SWPC real-time solar wind (DSCOVR / ACE).
  - NASA EPIC (DSCOVR Earth images).
  - IRIS / FDSN web services for InSight seismometer data.
- **Context feeds:**
  - Deep Space Network Now (`eyes.nasa.gov/dsn`): which dishes are
    talking to which spacecraft right now, with data rates. A natural
    "data is flowing" indicator on a spacecraft marker.
- **Descriptions and citations:**
  - NSSDCA experiment pages (one per instrument).
  - Mission instrument pages.
  - The instrument papers: most instruments have a *Space Science
    Reviews* paper, which is the citable source for what the instrument
    measures.

**Hosting constraint.** The app is a static site with no backend. A
browser can only fetch an API directly if it sends permissive CORS
headers. Anything that doesn't can be handled one of two ways:
- snapshotted on a schedule by a tool into `data/` (the same pattern as
  Horizons fits), or
- linked out to instead of shown in the app.

Phase 0 decides this per source.

## Data model (proposed)

One file per flight, `data/instruments/<flight>.json`, loaded with the
flight. Each instrument entry has these fields:

```json
{
  "id": "juno_mwr",
  "name": "Microwave Radiometer",
  "short": "MWR",
  "kind": "radiometer",
  "measures": "Microwave emission from Jupiter's atmosphere at six wavelengths, 1.4 to 50 cm, each sensing a different depth.",
  "tellsUs": "How water and ammonia are distributed hundreds of kilometres below the cloud tops; found ammonia is depleted down to great depth outside the equatorial zone.",
  "status": "operating | ended | failed | planned",
  "dataProducts": [
    { "level": "raw | calibrated | derived", "title": "...", "archive": "PDS Atmospheres", "url": "...", "format": "PDS4", "api": null }
  ],
  "liveFeed": { "type": "hapi | raw-images | dsn", "url": "...", "cors": true, "snapshot": "data/feeds/..." },
  "sources": [
    { "title": "Janssen et al., 'MWR: Microwave Radiometer for the Juno Mission to Jupiter'", "doi": "10.1007/s11214-017-0349-5" }
  ]
}
```

- **`kind`** comes from a short fixed list, so the fleet can be filtered
  by instrument type:
  - camera
  - spectrometer (imaging, UV, IR, gamma/neutron, mass)
  - magnetometer
  - plasma/particle
  - radio science
  - radar/altimeter
  - seismometer
  - dust
  - radiometer
  - sampling
  - other
- **`sources`** is required. Every description cites at least one
  agency page or instrument paper, following `docs/CREDITS.md`.
  `measures` and `tellsUs` are written in our own words, never pasted
  from a source.

## UI (proposed)

- **Flight info panel:** a collapsible "Instruments" section. One row per
  instrument shows:
  - its name and kind;
  - one line on what it measures;
  - "What it tells us", expandable;
  - data links with Raw / Calibrated / Derived badges;
  - a Live badge when a feed exists.
- **Across the fleet:** a filter such as "all magnetometers" or "missions
  with live data" that highlights matching spacecraft in the scene.
- **Later, lightweight in-app previews** (see the principle above), each
  linking to the full product:
  - a small, downsampled HAPI time-series chart (solar wind at Parker or
    Solar Orbiter);
  - thumbnails of the latest rover raw frames;
  - a DSN "talking now" ring on the spacecraft marker.

## Phases

0. **Research spike (one session).** For each candidate source:
   - check its access, API shape, CORS, rate limits, licence/credit
     terms and proprietary periods;
   - decide fetch-live, snapshot or link-out;
   - check whether PDS Registry records can seed instrument lists.

   **Output:** a source table added to this doc.
1. **Instrument catalog for about 12 active flagship missions.**
   Perseverance, Curiosity, Juno, Europa Clipper, JUICE, Parker Solar
   Probe, Solar Orbiter, BepiColombo, Lucy, Psyche, MAVEN and New Horizons:
   - name, kind, what it measures, what it tells us, status;
   - sources for each.
2. **Panel UI and the instrument-type filter.**
3. **Data product links** per instrument, with level badges.
4. **Live and near-live previews** (thumbnails and downsampled series
   only), for the sources phase 0 cleared:
   - DSN Now;
   - rover raw images;
   - HAPI time series;
   - snapshots for sources without CORS.
5. **Extend to all ~58 flights**, including ended and historical
   missions (archive links only).

## Open questions for the maintainer

- ~~How deep should "analyzed data" go in the app?~~ **Decided
  2026-11-25:** lightweight previews in the app, with links to the
  full-quality data. See "Principle" above.
- **Audience level for "what it tells us":** general public, interested
  student, or scientist? This sets the wording and the number of
  results listed.
- **Hosting:** does it stay fully static? A tiny proxy would make
  non-CORS APIs usable live, at the cost of running a service.
