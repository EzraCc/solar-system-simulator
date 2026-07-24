# Visual/functional QA checklist

Go through in order. For each item, confirm working / not working; for "not
working," a screenshot in `debug/screenshots/` (see workflow discussed) plus
the date/locked-body shown is the fastest way to get it fixed.

## 1. Basic scene rendering
1. Page loads with no console errors, canvas fills the view, Sol is visible at center (unshaded, glowing, not a flat disc)
2. All 8 planets render as shaded spheres (lit side bright, far side dark, not flat circles) with plausible relative sizes and colors
3. Each planet's orbit ellipse is visible and roughly circular/correctly eccentric (Mercury's should look visibly more elongated than Earth's)
4. Planets are in the correct relative order/spacing from Sol (Mercury closest, Neptune farthest)

## 2. Camera controls
5. Click-drag rotates the view (orbit around Sol)
6. Scroll wheel zooms in/out smoothly, no jumping or flipping
7. "Reset view" button restores default rotation/zoom/pan
8. At very high zoom, no visual glitching/flickering of bodies or orbit lines

## 3. Time controls
9. Date panel shows today's date on load
10. Play/pause button animates the simulation (planets visibly move)
11. Speed slider changes animation rate; readout updates to match
12. "Reset speed" returns to default speed
13. "Today" button jumps back to the current real-world date
14. Manually editing the date (edit button → type a date → apply) moves the whole scene to that date correctly
15. Canceling a date edit leaves the date unchanged

## 4. Planets legend
16. Legend panel header ("Planets") collapses/expands the list on click
17. All 8 planets listed, clicking one locks the info panel onto it and highlights it in the scene
18. Earth's Moon only appears in the legend (indented, nested under Earth) when Earth or the Moon is locked
19. Phobos and Deimos only appear when Mars or one of them is locked
20. Each outer planet's moons (Jupiter: Io/Europa/Ganymede/Callisto; Saturn: Enceladus/Tethys/Dione/Rhea/Titan/Iapetus; Uranus: Miranda/Ariel/Umbriel/Titania/Oberon; Neptune: Triton) only appear when that planet or one of its moons is locked
21. Clicking a moon locks the panel onto it and its orbit line draws around its parent planet (not around Sol)

## 5. Small Bodies legend
22. Header now reads "Small Bodies" (not "Asteroids & Comets"), collapses/expands correctly
23. All ~19 bodies listed as one flat list (no sub-headers)
24. "Pluto and Charon" row shows a small "DP" badge next to the name; hovering the badge shows a "Dwarf planet" tooltip
25. Clicking "Pluto and Charon" locks onto it AND reveals a nested "Charon" row that orbits Pluto correctly in the scene
26. Every small body is invisible by default in the scene until clicked, or until a flight targeting it is selected/in-transit

## 6. Locked info panel — general behavior
27. Clicking any body/flight opens the panel with a connector line + highlight ring pointing at it
28. Panel follows the body across frames as time advances or the camera rotates
29. Panel is draggable by its header; dragged position is preserved (per-body) until you lock a different body
30. Close button (X) closes the panel and clears the highlight/connector
31. Panel never overflows off-screen or overlaps the date/time controls at any window size; internal content scrolls instead of pushing the panel taller than the viewport
32. Clicking the same already-locked body again toggles the panel closed

## 7. Locked info panel — content correctness by body type
33. Sol: shows role + radius + "Why it matters" + the Sun image (should look white/neutral, NOT yellow)
34. A planet (e.g. Mars): shows position/speed/orbital elements + "Why it matters" + a real photo
35. A moon (e.g. Titan): shows "Orbits [Planet] (not Sol directly)", distance from primary, orbital period around primary + "Why it matters" + image
36. A small body (e.g. Bennu, Ceres): shows heliocentric orbital data + "Why it matters" + image
37. A flight (e.g. Perseverance): shows Mission/Launch from/Launch date/Destination/Arrival/Rocket/Payload/Status + "Why it matters" + Notes + a small image gallery (rocket + spacecraft, and lander where applicable)
38. Every image in every panel actually loads (no broken-image icons); every image links out to its source when clicked

## 8. Flights legend + trajectory rendering
39. Flights list shows all 38 missions; a flight currently in transit (check today's date) is visibly highlighted/lighter than the rest
40. Selecting a flight draws its full trajectory arc(s) and a spacecraft marker at its current position (only while within its actual launch–arrival window)
41. Simple direct-transfer missions (e.g. Curiosity, Mars Odyssey, **MMX**) show one clean arc from Earth to Mars
42. **BepiColombo**: multi-flyby chain to Mercury renders without wild jumps; check whether the spacecraft marker looks reasonably close to its real path, especially during the long ion-thrust coast segments — tell me the date if something looks off, since this one has a known, accepted physics limitation (ion thrust isn't modeled) and I need to know if what you're seeing matches that or looks like something else
43. **Parker Solar Probe**: 7 Venus-flyby chain renders through all flybys without the spacecraft flying off to an absurd position; same ion-thrust/SRP caveat as BepiColombo — flag the date if it looks wrong
44. **New Horizons**: Jupiter flyby then Pluto arrival — should land essentially exactly on Pluto's real position at 2015-07-14 (this was a real bug fixed this session, worth double-checking)
45. **Lucy**: the 13-leg tour (Earth→Earth GA→Dinkinesh→Earth GA→Donaldjohanson→Eurybates→Polymele→Leucus→Orus→Earth GA→Patroclus) draws as one continuous, sensible path with no teleporting
46. **Rosetta**: 4-flyby chain (3 Earth, 1 Mars) into orbit around comet 67P
47. **Dawn**: arc from Earth to Vesta, HOLDS POSITION at Vesta for its ~14-month stay (doesn't jump early to Ceres), then continues to Ceres
48. **Juno, MESSENGER, JUICE**: gravity-assist chains render as continuous paths, no jumps
49. **Mangalyaan and Aditya-L1**: the initial Earth-orbit "raising" phase (spiral of widening loops before departure) renders as a sequence of growing ellipses around Earth, not a straight jump to interplanetary space
50. **Chang'e 2 (Toutatis extended mission)**: loiters at the Earth-Sun L2 point, then departs to intercept asteroid Toutatis
51. Sample-return missions with a stay-then-return leg (Hayabusa, Hayabusa2, OSIRIS-REx) show the outbound leg, a hold at the target, and (where modeled) the return leg

## 9. Other UI features
52. "Size comparison" toggle switch: turning it on shows bodies at true relative scale (planets shrink dramatically relative to their orbits) and shows the size-compare panel; turning it off restores the normal exaggerated-for-visibility view
53. Hovering over any body (unlocked) shows a small tooltip with its name and "click to track"; tooltip disappears once a body is locked
54. "Stop tracking" button un-follows the locked body without closing its panel (camera stops re-centering on it every frame)
55. Resizing the browser window doesn't break the layout (canvas resizes, panels reflow, nothing clips)

## 10. Data-loading edge cases
56. On a slow/first load, the app doesn't show a broken/empty state for more than a moment — flights legend populates once data arrives
57. If you have a way to test it: temporarily breaking a data file (or just trust this one) shouldn't crash the whole app, only that one flight/body's content

---

**Priority order if you want to triage fastest**: sections 1, 6, 8 first (those cover the actual physics/data work from this session and are most likely to have real bugs), then 4/5 (legend restructuring is also very recent), then 2/3/9/10 (older, more stable UI plumbing, lower risk but worth a pass).
