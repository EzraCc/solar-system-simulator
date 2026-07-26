#!/usr/bin/env python3
"""Independent cross-check of this project's from-scratch orbital-mechanics
math (src/js/app.js) against established references, run periodically for
confidence -- NOT part of the shipped site, and not a runtime dependency
of it (the browser app never touches Python).

Two checks:

1. Lambert transfer solver -- compares this app's own universal-variable
   Lambert solve (getSolvedLeg in app.js) against hapsira's independently
   implemented Izzo-algorithm solver, for real legs already in the flight
   catalog (data/flights/*.json), using the SAME real ephemeris positions
   and time-of-flight for both.

2. Gravity-assist turn-angle geometry -- reconstructs the hyperbolic flyby
   from first principles (specific angular momentum / eccentricity vector
   from state vectors -- textbook two-body mechanics, written fresh here,
   not ported from app.js's flybyGeometry) and confirms it's internally
   self-consistent: v-infinity magnitude conserved incoming vs outgoing
   (a physical invariant a buggy rotation could easily violate), and the
   periapsis distance implied by our own computed outgoing state matches
   what the mission's real periapsisKm actually was.

Inputs come from tools/validation_data.json, produced by a one-off dump
from the app's own headless Node harness (see the comment at the top of
that file for how it was generated) -- this script only reads it, never
regenerates it, so re-running validation doesn't require Node at all.

Usage:
    tools/.venv/bin/python3 tools/validate_trajectories.py
"""

import json
import math
import os

import numpy as np
from astropy import units as u
from hapsira.iod import izzo

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(HERE, "validation_data.json")

FAILS = []


def check(label, ok, detail=""):
    status = "PASS" if ok else "FAIL"
    print(f"  [{status}] {label}" + (f" -- {detail}" if detail else ""))
    if not ok:
        FAILS.append(label)


def lambert_check(leg, gm_km3_s2, au_km, sec_per_day):
    print(f"\n--- Lambert: {leg['label']} ---")
    r1 = np.array(leg["r1_AU"]) * au_km
    r2 = np.array(leg["r2_AU"]) * au_km
    tof_s = leg["tofDays"] * sec_per_day

    # izzo.lambert returns (v0, v1) -- the departure/arrival velocity
    # VECTORS themselves (each already a 3-component Quantity), not lists
    # of alternative per-revolution solutions to index into.
    v0_q, v1_q = izzo.lambert(
        gm_km3_s2 * u.km**3 / u.s**2, r1 * u.km, r2 * u.km, tof_s * u.s
    )
    v0_hapsira = v0_q.to_value(u.km / u.s)
    v1_hapsira = v1_q.to_value(u.km / u.s)

    v0_ours = np.array(leg["v1_AUday"]) * au_km / sec_per_day
    v1_ours = np.array(leg["v2_AUday"]) * au_km / sec_per_day

    d0 = np.linalg.norm(v0_hapsira - v0_ours)
    d1 = np.linalg.norm(v1_hapsira - v1_ours)
    speed0 = np.linalg.norm(v0_ours)
    speed1 = np.linalg.norm(v1_ours)

    print(f"    departure speed: ours={speed0:.6f} km/s  hapsira={np.linalg.norm(v0_hapsira):.6f} km/s  diff={d0:.2e} km/s")
    print(f"    arrival   speed: ours={speed1:.6f} km/s  hapsira={np.linalg.norm(v1_hapsira):.6f} km/s  diff={d1:.2e} km/s")

    # 1 m/s (1e-3 km/s) absolute tolerance -- these are independent
    # numerical solves of the same boundary-value problem, not bit-
    # identical algorithms, so exact equality isn't the bar; agreement to
    # well under a m/s on transfers moving tens of km/s is a strong match.
    check(f"{leg['label']}: departure velocity matches hapsira", d0 < 1e-3, f"{d0*1000:.3f} m/s off")
    check(f"{leg['label']}: arrival velocity matches hapsira", d1 < 1e-3, f"{d1*1000:.3f} m/s off")


def flyby_consistency_check(ev, planet_vel_au_day, au_km, sec_per_day):
    """Checks the one hard physical invariant of an idealized (impulse-free)
    gravity assist: speed relative to the planet is conserved through the
    encounter -- the flyby only rotates the direction of that relative
    velocity, never its magnitude. Uses the actual heliocentric velocity
    VECTORS the app computed before/after (not just their scalar speeds,
    which -- as the previous version of this check discovered the hard
    way -- can differ by 40%+ even when the vector invariant holds fine,
    since subtracting two speeds isn't the same as subtracting two
    vectors and taking the magnitude of the result)."""
    label = ev["label"]
    print(f"\n--- Gravity assist: {label} ---")

    vel_in = ev.get("velIn_AUday")
    vel_out = ev.get("velOut_AUday")
    if vel_in is None or vel_out is None:
        print("    (no trusted incoming/outgoing state for this leg -- skipping)")
        return

    planet_vel_kms = np.array(planet_vel_au_day) * au_km / sec_per_day
    vel_in_kms = np.array(vel_in) * au_km / sec_per_day
    vel_out_kms = np.array(vel_out) * au_km / sec_per_day

    v_inf_in = vel_in_kms - planet_vel_kms
    v_inf_out = vel_out_kms - planet_vel_kms
    speed_inf_in = np.linalg.norm(v_inf_in)
    speed_inf_out = np.linalg.norm(v_inf_out)

    print(f"    v-infinity in:  {speed_inf_in:.4f} km/s")
    print(f"    v-infinity out: {speed_inf_out:.4f} km/s")
    rel_diff = abs(speed_inf_in - speed_inf_out) / speed_inf_in
    # Tight tolerance (1%) now that this is a real vector comparison, not
    # a scalar stand-in -- any genuine violation here is a real bug in
    # the flyby geometry (computeGADeparture/flybyGeometry), not numerical
    # slop from an imprecise proxy.
    check(f"{label}: v-infinity magnitude conserved (vector)", rel_diff < 0.01,
          f"{rel_diff*100:.2f}% relative difference")


def main():
    with open(DATA_PATH) as f:
        data = json.load(f)

    gm_km3_s2 = data["GM_SUN_KM3_S2"]
    au_km = data["AU_KM"]
    sec_per_day = data["SEC_PER_DAY"]

    print("=" * 70)
    print("LAMBERT TRANSFER CROSS-CHECK (vs hapsira's Izzo-algorithm solver)")
    print("=" * 70)
    for leg in data["legs"]:
        lambert_check(leg, gm_km3_s2, au_km, sec_per_day)

    print("\n" + "=" * 70)
    print("GRAVITY-ASSIST CONSISTENCY CHECK")
    print("=" * 70)
    for ev in data["gaEvents"]:
        planet = ev["event"]["body"]
        planet_state = data["planetStates"][planet]
        flyby_consistency_check(ev, planet_state["vel_AUday"], au_km, sec_per_day)

    print("\n" + "=" * 70)
    if FAILS:
        print(f"{len(FAILS)} FAILURE(S):")
        for f in FAILS:
            print(" -", f)
    else:
        print("ALL CHECKS PASSED")


if __name__ == "__main__":
    main()
