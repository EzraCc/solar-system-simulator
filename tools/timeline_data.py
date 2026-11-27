#!/usr/bin/env python3
"""Writes each flight's `timeline` block: the mission phases its legs can't
express (orbit end dates, landings, surface operations, losses, impacts).
The app merges these with what the legs already give (launch, gravity
assists, fitted orbits, planet tours) to draw a body's mission timeline.

Entry: {"body": <leg-style key: planet, SMALL_BODIES key, or moon name>,
        "kind": orbit | ground | landing | flyby | impact | lost | entry,
        "start": date, "end": date (bars only), "ongoing": true (bar still
        running), "label": short text}
An explicit orbit for a body replaces the derived one (fitted orbit / tour
span) for that body; an explicit flyby on a gravity-assist date replaces
the derived flyby.

    python3 tools/timeline_data.py    # rewrite every listed flight
"""
import json, os, sys

def bar(body, kind, start, end=None, label="", ongoing=False):
    e = {"body": body, "kind": kind, "start": start}
    if end: e["end"] = end
    if ongoing: e["ongoing"] = True
    if label: e["label"] = label
    return e

def ev(body, kind, date, label=""):
    e = {"body": body, "kind": kind, "start": date}
    if label: e["label"] = label
    return e

T = {
  # ---- Mars ----
  "phobos_1": [ev("Mars", "lost", "1988-09-02", "Contact lost in cruise (bad uploaded command)")],
  "phobos_2": [bar("Mars", "orbit", "1989-01-29", "1989-03-27", "Mars orbit; approach to Phobos"),
               ev("Mars", "lost", "1989-03-27", "Contact lost before the Phobos landers were released")],
  "mars_observer": [ev("Mars", "lost", "1993-08-21", "Contact lost three days before orbit insertion")],
  "mars_global_surveyor": [bar("Mars", "orbit", "1997-09-12", "2006-11-02", "Mapping orbit"),
                           ev("Mars", "lost", "2006-11-02", "Contact lost")],
  "mars_pathfinder": [ev("Mars", "landing", "1997-07-04", "Landed in Ares Vallis (airbags)"),
                      bar("Mars", "ground", "1997-07-04", "1997-09-27", "Lander and Sojourner rover")],
  "mars_climate_orbiter": [ev("Mars", "lost", "1999-09-23", "Destroyed at orbit insertion (unit mix-up)")],
  "mars_polar_lander": [ev("Mars", "lost", "1999-12-03", "Lost during landing")],
  "mars_odyssey": [bar("Mars", "orbit", "2001-10-24", label="Orbit", ongoing=True)],
  "mars_express": [bar("Mars", "orbit", "2003-12-25", label="Orbit", ongoing=True),
                   ev("Mars", "landing", "2003-12-25", "Beagle 2 landed but never made contact (found in 2015)")],
  "spirit_mer_a": [ev("Mars", "landing", "2004-01-04", "Landed in Gusev crater"),
                   bar("Mars", "ground", "2004-01-04", "2010-03-22", "Spirit rover (last contact)")],
  "opportunity_mer_b": [ev("Mars", "landing", "2004-01-25", "Landed in Meridiani Planum"),
                        bar("Mars", "ground", "2004-01-25", "2018-06-10", "Opportunity rover (last contact)")],
  "mro": [bar("Mars", "orbit", "2006-03-10", label="Orbit", ongoing=True)],
  "phoenix": [ev("Mars", "landing", "2008-05-25", "Landed near the north pole"),
              bar("Mars", "ground", "2008-05-25", "2008-11-02", "Phoenix lander (last contact)")],
  "curiosity": [ev("Mars", "landing", "2012-08-06", "Landed in Gale crater (sky crane)"),
                bar("Mars", "ground", "2012-08-06", label="Curiosity rover", ongoing=True)],
  "maven": [bar("Mars", "orbit", "2014-09-22", "2025-12-06", "Orbit (contact lost)"),
            ev("Mars", "lost", "2025-12-06", "Contact lost")],
  "mom_mangalyaan": [bar("Mars", "orbit", "2014-09-24", "2022-04-23", "Orbit"),
                     ev("Mars", "lost", "2022-04-23", "Contact lost (announced October 2022)")],
  "exomars_tgo": [bar("Mars", "orbit", "2016-10-19", label="Orbit", ongoing=True),
                  ev("Mars", "impact", "2016-10-19", "Schiaparelli lander crashed")],
  "insight": [ev("Mars", "landing", "2018-11-26", "Landed in Elysium Planitia"),
              bar("Mars", "ground", "2018-11-26", "2022-12-15", "InSight lander (last contact)")],
  "hope_mars": [bar("Mars", "orbit", "2021-02-09", label="Orbit", ongoing=True)],
  "tianwen1": [bar("Mars", "orbit", "2021-02-10", label="Orbiter", ongoing=True),
               ev("Mars", "landing", "2021-05-14", "Zhurong landed in Utopia Planitia"),
               bar("Mars", "ground", "2021-05-14", "2022-05-20", "Zhurong rover (hibernated, never woke)")],
  "perseverance": [ev("Mars", "landing", "2021-02-18", "Landed in Jezero crater"),
                   bar("Mars", "ground", "2021-02-18", label="Perseverance rover (and Ingenuity)", ongoing=True)],
  "nozomi": [ev("Mars", "flyby", "2003-12-14", "Orbit insertion abandoned; flew past Mars")],
  # ---- Venus ----
  "magellan": [bar("Venus", "orbit", "1990-08-10", "1994-10-12", "Radar mapping orbit"),
               ev("Venus", "entry", "1994-10-13", "Deliberately entered the atmosphere")],
  "venus_express": [bar("Venus", "orbit", "2006-04-11", "2014-11-28", "Orbit (contact lost)"),
                    ev("Venus", "lost", "2014-11-28", "Contact lost after its fuel ran out")],
  "akatsuki": [ev("Venus", "flyby", "2010-12-07", "Orbit insertion failed; flew past Venus"),
               bar("Venus", "orbit", "2015-12-07", "2024-04-25", "Orbit (second attempt succeeded)"),
               ev("Venus", "lost", "2024-04-25", "Contact lost")],
  # ---- Mercury ----
  "messenger": [bar("Mercury", "orbit", "2011-03-18", "2015-04-30", "Orbit"),
                ev("Mercury", "impact", "2015-04-30", "Impacted Mercury at end of mission")],
  "bepicolombo": [bar("Mercury", "orbit", "2026-11-21", label="Orbit (MPO and Mio)", ongoing=True)],
  # ---- Jupiter ----
  "galileo": [ev("Jupiter", "entry", "1995-12-07", "Atmospheric probe entered Jupiter"),
              bar("Jupiter", "orbit", "1995-12-08", "2003-09-21", "Orbit tour"),
              ev("Jupiter", "impact", "2003-09-21", "Deliberately entered Jupiter")],
  "juno": [bar("Jupiter", "orbit", "2016-07-05", label="Polar orbit", ongoing=True)],
  # ---- Saturn ----
  "cassini": [bar("Saturn", "orbit", "2004-07-01", "2017-09-15", "Orbit tour"),
              ev("Saturn", "entry", "2017-09-15", "Grand Finale: entered Saturn"),
              ev("Titan", "landing", "2005-01-14", "Huygens probe landed (72 minutes of surface data)"),
              bar("Titan", "ground", "2005-01-14", "2005-01-14", "Huygens on the surface (~72 min)")],
  # ---- Small bodies ----
  "near_shoemaker": [bar("eros", "orbit", "2000-02-14", "2001-02-12", "Orbit"),
                     ev("eros", "landing", "2001-02-12", "Touched down: first landing on an asteroid"),
                     bar("eros", "ground", "2001-02-12", "2001-02-28", "Surface operations")],
  "hayabusa": [bar("itokawa", "orbit", "2005-09-12", "2005-12-08", "Station-keeping near Itokawa"),
               ev("itokawa", "landing", "2005-11-19", "First touchdown"),
               ev("itokawa", "landing", "2005-11-25", "Second touchdown (sample)")],
  "hayabusa2": [bar("ryugu", "orbit", "2018-06-27", "2019-11-13", "Station-keeping near Ryugu"),
                ev("ryugu", "landing", "2018-09-21", "MINERVA-II1 rovers landed"),
                ev("ryugu", "landing", "2018-10-03", "MASCOT lander (~17 hours)"),
                bar("ryugu", "ground", "2018-10-03", "2018-10-04", "MASCOT on the surface"),
                ev("ryugu", "landing", "2019-02-21", "First touchdown (sample)"),
                ev("ryugu", "impact", "2019-04-05", "Small Carry-on Impactor made a crater"),
                ev("ryugu", "landing", "2019-07-11", "Second touchdown (subsurface sample)")],
  "osiris_rex": [bar("bennu", "orbit", "2018-12-03", "2021-05-10", "Proximity operations"),
                 ev("bennu", "landing", "2020-10-20", "Touch-and-go sample collection")],
  "dawn": [bar("vesta", "orbit", "2011-07-16", "2012-09-05", "Orbit"),
           bar("ceres", "orbit", "2015-03-06", "2018-10-31", "Orbit (mission ended, out of fuel)")],
  "rosetta": [bar("67P", "orbit", "2014-08-06", "2016-09-30", "Escort orbit"),
              ev("67P", "landing", "2014-11-12", "Philae landed (bounced twice)"),
              bar("67P", "ground", "2014-11-12", "2014-11-15", "Philae surface operations"),
              ev("67P", "impact", "2016-09-30", "Rosetta set down on the comet at end of mission")],
  "deep_impact": [ev("tempel1", "impact", "2005-07-04", "Impactor struck Tempel 1; flyby spacecraft watched")],
  "dart": [ev("didymos", "impact", "2022-09-26", "Struck Dimorphos, changing its orbit")],
  "chunge2_toutatis": [ev("toutatis", "flyby", "2012-12-13", "Flyby at ~3 km")],
  "stardust": [ev("annefrank", "flyby", "2002-11-02", "Flyby"),
               ev("wild2", "flyby", "2004-01-02", "Flyby; collected coma dust")],
  "deep_space_1": [ev("braille", "flyby", "1999-07-29", "Flyby"),
                   ev("borrelly", "flyby", "2001-09-22", "Flyby")],
  "lucy": [ev("patroclus", "flyby", "2033-03-03", "Flyby of the Patroclus–Menoetius binary (planned)")],
  # ---- Halley Armada (1984-86) ----
  "vega_1": [ev("Venus", "entry", "1985-06-11", "Descent module entered; balloon floated in the clouds ~46 h"),
             ev("Venus", "landing", "1985-06-11", "Lander touched down north of Aphrodite Terra"),
             bar("Venus", "ground", "1985-06-11", "1985-06-11", "Lander on the surface (~56 min)"),
             ev("halley", "flyby", "1986-03-06", "Flyby at 8,889 km: first close images of a comet nucleus")],
  "vega_2": [ev("Venus", "entry", "1985-06-15", "Descent module entered; balloon floated in the clouds ~46 h"),
             ev("Venus", "landing", "1985-06-15", "Lander touched down in Rusalka Planitia"),
             bar("Venus", "ground", "1985-06-15", "1985-06-15", "Lander on the surface (~57 min)"),
             ev("halley", "flyby", "1986-03-09", "Flyby at 8,030 km")],
  "sakigake": [ev("halley", "flyby", "1986-03-11", "Distant flyby (7 million km), monitoring the solar wind")],
  "suisei": [ev("halley", "flyby", "1986-03-08", "Flyby at 151,000 km; ultraviolet images of the hydrogen cloud")],
  "giotto": [ev("halley", "flyby", "1986-03-14", "Flyby at 596 km: the closest look at Halley's nucleus"),
             ev("grigg_skjellerup", "flyby", "1992-07-10", "Flyby at ~200 km: first spacecraft to visit two comets")],
}

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
for key, entries in T.items():
    p = os.path.join(ROOT, "data", "flights", key + ".json")
    src = open(p).read(); d = json.loads(src)
    # Appended (or replaced) as text, so the rest of the hand-formatted file
    # is left byte-for-byte alone.
    block = json.dumps(entries, indent=2).replace("\n", "\n  ")
    if "timeline" in d:
        start = src.index('"timeline"')
        body = src[:start].rstrip()
        body = body[:-1] if body.endswith(",") else body
        tail = "\n}" + ("\n" if src.endswith("\n") else "")
    else:
        body = src.rstrip()
        assert body.endswith("}")
        body = body[:-1].rstrip()
        tail = "\n}" + ("\n" if src.endswith("\n") else "")
    out = body + ',\n  "timeline": ' + block + tail
    d["timeline"] = entries
    assert json.loads(out) == d, key
    open(p, "w").write(out)
print(f"wrote timeline for {len(T)} flights")
