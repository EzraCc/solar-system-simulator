# To-do

Open work, roughly in priority order. Move an item to `CHANGELOG.md`
when it ships. Plans for big items live in their own docs and are linked
from here.

## 1. Data refresh: current missions now, then on a schedule

**Pull fresh data on all current missions.** Last full pass: 2026-11-17
(see `docs/project-transfer.md` §3.4 for the process).

- [ ] **In-flight and orbiting missions.** Re-pull each from JPL Horizons
  and update dates, flyby altitudes and fitted orbits:
  - En route: ESCAPADE, Europa Clipper, Hera, JUICE, Lucy, MMX, Psyche,
    Roman, Solar Orbiter, STEREO-A, Tianwen-2.
  - Orbiting or operating: Juno, MRO, Mars Odyssey, MAVEN, Mars Express,
    ExoMars TGO, Hope, Tianwen-1, Akatsuki status, BepiColombo,
    Curiosity, Perseverance, Parker Solar Probe.
- [ ] **Known placeholders** (from the 2026-11-17 pass):
  - MMX Mars arrival 2027-08-31 (estimate)
  - Roman L2 insertion 2026-12-08 (planned)
  - Europa Clipper Earth flyby 2026-12-03 (~3,200 km target)
  - JUICE 2029 Earth flyby altitude (unpublished)
  - Solar Orbiter Venus flyby 2026-12-24
- [ ] **BepiColombo:** refit the Mercury orbit once Horizons carries the
  post-insertion trajectory. Insertion was 2026-11-21; Horizons still had
  the pre-arrival prediction on 2026-11-23. Use
  `tools/build_orbit_phases.py bepicolombo --primary Mercury`, then
  `tools/check_orbit_phases.py`.
- [ ] **Juno:** decide whether to extend the tour past 2026-11-17.
  Horizons has data to 2028-09, but the mission's status is uncertain.
- [ ] **New launches since 2026-11-17:** interplanetary departures and
  Sun–Earth L1/L2 missions are in scope. New flights also need a
  `timeline` entry (`tools/timeline_data.py`) and source citations
  (`docs/CREDITS.md`).

**Set a schedule for new data** (positions and launches).

- [ ] **Build `tools/refresh_check.py` first.** It's a read-only report
  of what's stale, so the scheduled job runs something deterministic
  rather than ad hoc searching:
  - For each flight with a Horizons ID: has Horizons' trajectory
    revision or coverage changed since our fit? (Horizons reports the
    source kernel and revision date in its header.)
  - Which `statusNote` placeholders have passed their date.
  - Which `ongoing` timeline entries need extending.
  - Output: a short markdown report, with no edits.
- [ ] **Recurring job.** A scheduled Claude Code routine (`/schedule`) that:
  - runs `refresh_check.py` every week;
  - scans agency launch news (NASA, ESA, JAXA, ISRO, CNSA, UAE) and
    NSSDCA for new interplanetary or L1/L2 launches;
  - applies the routine updates on a branch and reports what changed.

  It never pushes to `main` on its own, per the push policy in
  `CLAUDE.md`.
- [ ] **Cadence:**
  - Positions weekly: Horizons predictions change after maneuvers.
  - Launches weekly.
  - A deeper monthly pass covering placeholders, status changes and
    end-of-mission events.

## 2. Image attribution audit

See `docs/CREDITS.md`, "Body and mission images".

- [ ] For each of the 167 gallery images:
  - find its original file page (most are on Wikimedia Commons or NASA);
  - record `credit`, `license`, `licenseUrl` and `sourcePage`.
- [ ] Show the credit and licence in the gallery tile. BY and BY-SA
  images require it.
- [ ] Replace any image whose licence isn't compatible, or whose source
  can't be found.
- [ ] Write a script for the Commons part: the API returns the
  `LicenseShortName`, `Artist` and `Credit` fields per file.

## 3. Spacecraft instruments and data feeds (plan only)

What's on board each spacecraft, what it measures, what that tells us,
and where its public data lives, from raw data to analyzed products.
In the app: lightweight previews only, linking to the full-quality data.
**Plan: `docs/instruments-plan.md`.** Not started.

## 4. Rendering (textured-spheres branch)

- [ ] Real-browser check of the sphere renderer on a GPU (testing so far
  was headless Chrome with software WebGL), then merge to `main` when
  told to push.
- [ ] Maps for Ceres and Vesta (Dawn), Triton, and Uranus' major moons
  (Voyager 2, partial coverage).
- [ ] Saturn ring texture: a radial brightness profile from Cassini in
  place of four flat bands.
- [ ] Optional: a Venus radar-surface toggle. Venus is drawn as its
  featureless cloud deck by design.

## 5. Catalog and views

- [ ] **Missions before 1988.** 55 can be mapped (`docs/pre-1988-missions.md`):
  - Verify their dates against NSSDCA.
  - They need Halley's Comet as a target, and Uranus and Neptune system
    views (for Voyager 2).
- [ ] **Earth system view.** Deferred because of the Lagrange-point
  missions.
- [ ] **System view polish:**
  - Mars' spacecraft labels crowd each other.
  - The velocity dashboard doesn't support planetocentric legs.
  - JUICE needs a Ganymede orbit phase.
- [ ] **`#bottom-right-controls`:** this wrapper blocks canvas clicks
  behind it.
