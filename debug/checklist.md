# Visual/functional QA checklist

> **STATUS (2026-08-01):** This was a single point-in-time QA pass from an
> earlier stage of the project (references "38 missions" below; the catalog
> is now 57 as of `data/flights/manifest.json`). The features under sections
> 8–10 that were marked "NOT YET TESTED" here — gravity-assist chains, sample
> returns, the size-comparison toggle, hover tooltips, resize handling, data
> load edge cases — have all since been built on top of, exercised, and
> individually verified (via ad-hoc Playwright checks) many times over across
> later sessions per `CHANGELOG.md`, just not re-run through this specific
> checklist format. Treat the pass/fail annotations below as stale rather than
> current QA state; this file is not being kept up to date item-by-item going
> forward — `CHANGELOG.md` is the authoritative record of what shipped and
> was verified.

Go through in order. For each item, confirm working / not working; for "not
working," a screenshot in `debug/screenshots/` plus the date/locked-body
shown is the fastest way to get it fixed.

## 1. Basic scene rendering — ✅ CONFIRMED WORKING
1. Page loads with no console errors, canvas fills the view, Sol is visible at center (unshaded, glowing, not a flat disc)
2. All 8 planets render as shaded spheres (lit side bright, far side dark, not flat circles) with plausible relative sizes and colors
3. Each planet's orbit ellipse is visible and roughly circular/correctly eccentric (Mercury's should look visibly more elongated than Earth's)
4. Planets are in the correct relative order/spacing from Sol (Mercury closest, Neptune farthest)

## 2. Camera controls — ✅ CONFIRMED WORKING
5. Click-drag rotates the view (orbit around Sol)
6. Scroll wheel zooms in/out smoothly, no jumping or flipping
7. "Reset view" button restores default rotation/zoom/pan
8. At very high zoom, no visual glitching/flickering of bodies or orbit lines

## 3. Time controls — ✅ CONFIRMED WORKING
9. Date panel shows today's date on load
10. Play/pause button animates the simulation (planets visibly move)
11. Speed slider changes animation rate; readout updates to match
12. "Reset speed" returns to default speed
13. "Today" button jumps back to the current real-world date
14. Manually editing the date (edit button → type a date → apply) moves the whole scene to that date correctly
15. Canceling a date edit leaves the date unchanged

## 4. Planets legend — ✅ CONFIRMED WORKING
16. Legend panel header ("Planets") collapses/expands the list on click
17. All 8 planets listed, clicking one locks the info panel onto it and highlights it in the scene
18. Earth's Moon only appears in the legend (indented, nested under Earth) when Earth or the Moon is locked
19. Phobos and Deimos only appear when Mars or one of them is locked
20. Each outer planet's moons (Jupiter: Io/Europa/Ganymede/Callisto; Saturn: Enceladus/Tethys/Dione/Rhea/Titan/Iapetus; Uranus: Miranda/Ariel/Umbriel/Titania/Oberon; Neptune: Triton) only appear when that planet or one of its moons is locked
21. Clicking a moon locks the panel onto it and its orbit line draws around its parent planet (not around Sol)

## 5. Small Bodies legend — fixed since first pass, worth a re-check
22. Header reads "Small Bodies" (renamed from "Asteroids & Comets"), collapses/expands correctly
23. All bodies listed alphabetically by name, numbers moved to "(N)" suffix (e.g. "Bennu (101955)", not "101955 Bennu")
24. "Pluto and Charon" row shows a small "DP" badge; hovering it shows a "Dwarf planet" tooltip
25. Clicking "Pluto and Charon" locks onto it AND reveals a nested "Charon" row that orbits Pluto correctly in the scene
26. A body's row lights up (same treatment as an in-transit flight) whenever it's actually visible in the scene right now — selected directly, or a mission targeting it is selected/in-transit
27. Every small body is invisible in the scene by default until clicked, or until a flight targeting it is selected/in-transit

## 6. Locked info panel — REWORKED, please re-verify all of this section
Significant behavior change since the first pass: the panel used to follow
the tracked body's on-screen position every frame (this was actually the
root cause of the broken nav-links bug, now fixed). It no longer does that
by design — worth specifically confirming the new intended behavior below,
not just "does it look like before."
28. Clicking any body/flight opens the panel, positioned once near the body, with a connector line + highlight ring pointing at it
29. **New:** the panel itself stays put — it does NOT slide around as the body moves or the camera rotates. The connector line/ring on the canvas DO keep tracking the body's real current position, so the line may stretch/reangle over time even though the panel box stays still
30. Panel is draggable by its header; dragged position sticks until you lock a different body (a new lock always starts fresh near the newly-tracked body)
31. Close button (X) closes the panel and clears the highlight/connector
32. Panel is resizable (drag the bottom-right corner)
33. Long content ("Why it matters", "Notes") scrolls inside the panel rather than pushing it off-screen; there's breathing room below the last item (image gallery), not flush against the edge
34. Clicking the same already-locked body again toggles the panel closed
35. **"Missions here"** section (planets/small bodies only): lists every flight whose actual destination is that body, as clickable links
36. **"Destinations"** section (flights only): lists every body that flight actually touches (launch/gravity-assist/arrival), as clickable links
37. Clicking a mission-here or destination link closes the current panel and opens the clicked one — this was the reported-broken behavior, now fixed; please confirm it holds across a few different bodies/flights, not just the one already tested

## 7. Locked info panel — content correctness by body type
38. Sol: shows role + radius + "Why it matters" + the Sun image (should look white/neutral, NOT yellow)
39. A planet (e.g. Mars): shows position/speed/orbital elements + "Why it matters" + a real photo
40. A moon (e.g. Titan): shows "Orbits [Planet] (not Sol directly)", distance from primary, orbital period around primary + "Why it matters" + image
41. A small body (e.g. Bennu, Ceres): shows heliocentric orbital data + "Why it matters" + image
42. A flight (e.g. Perseverance): shows Mission/Launch from/Launch date/Destination/Arrival/Rocket/Payload/Status + "Why it matters" + Destinations + Notes + a small image gallery (rocket + spacecraft, and lander where applicable)
43. Every image in every panel actually loads (no broken-image icons) — this was a real bug (wrong path) already fixed, worth spot-checking a few since you mentioned going through the image folder yourself separately

## 8. Flights legend + trajectory rendering — NOT YET TESTED
44. Flights list shows all 57 missions (including MMX); a flight currently in transit (check today's date) is visibly highlighted/lighter than the rest
45. Selecting a flight draws its full trajectory arc(s) and a spacecraft marker at its current position (only while within its actual launch–arrival window)
46. Simple direct-transfer missions (e.g. Curiosity, Mars Odyssey, MMX) show one clean arc from Earth to Mars
47. **BepiColombo**: multi-flyby chain to Mercury renders without wild jumps; has a known, accepted physics limitation (ion thrust isn't modeled) — flag the date if something looks off so I can tell whether it matches that or is something new
48. **Parker Solar Probe**: 7 Venus-flyby chain renders through all flybys without the spacecraft flying off to an absurd position; same ion-thrust/SRP caveat as BepiColombo
49. **New Horizons**: Jupiter flyby then Pluto arrival — should land essentially exactly on Pluto's real position at 2015-07-14 (a real Lambert-solver bug was found and fixed here this session)
50. **Lucy**: the 13-leg tour (Earth→Earth GA→Dinkinesh→Earth GA→Donaldjohanson→Eurybates→Polymele→Leucus→Orus→Earth GA→Patroclus) draws as one continuous, sensible path with no teleporting
51. **Rosetta**: 4-flyby chain (3 Earth, 1 Mars) into orbit around comet 67P
52. **Dawn**: arc from Earth to Vesta, HOLDS POSITION at Vesta for its ~14-month stay (doesn't jump early to Ceres), then continues to Ceres
53. **Juno, MESSENGER, JUICE**: gravity-assist chains render as continuous paths, no jumps
54. **Mangalyaan and Aditya-L1**: the initial Earth-orbit "raising" phase (spiral of widening loops before departure) renders as a sequence of growing ellipses around Earth, not a straight jump to interplanetary space
55. **Chang'e 2 (Toutatis extended mission)**: loiters at the Earth-Sun L2 point, then departs to intercept asteroid Toutatis
56. Sample-return missions with a stay-then-return leg (Hayabusa, Hayabusa2, OSIRIS-REx) show the outbound leg, a hold at the target, and (where modeled) the return leg
57. **MMX**: direct Earth→Mars arc (added this session, launch date is a provisional placeholder — trajectory shape is what matters, not the exact date)

## 9. Other UI features — NOT YET TESTED
58. "Size comparison" toggle switch: turning it on shows bodies at true relative scale; turning it off restores the normal exaggerated-for-visibility view
59. Hovering over any UNLOCKED body shows a small tooltip with its name and "click to track" — you previously reported not seeing this; it's suppressed by design whenever a body is already locked, so please retest specifically with the panel fully closed
60. "Stop tracking" button un-follows the locked body without closing its panel
61. Resizing the browser window doesn't break the layout (canvas resizes, panels reflow, nothing clips)

## 10. Data-loading edge cases — NOT YET TESTED
62. On a slow/first load, the app doesn't show a broken/empty state for more than a moment — flights legend populates once data arrives
63. If you have a way to test it: temporarily breaking a data file shouldn't crash the whole app, only that one flight/body's content

---

**Suggested order from here**: section 8 (flights/trajectories) is the biggest untested surface and the one most likely to have real physics bugs — worth doing next. Section 9's hover-tooltip item is a quick one-off check. Sections 5, 6, 7 got heavy rework this round so a quick re-pass would catch anything the fixes missed.
