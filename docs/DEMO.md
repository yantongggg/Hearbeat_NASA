# Demo walkthrough

Wear headphones. The flows below are exercised by the automated tests in `app/e2e/`.

## The 30-second version (for the KL demo)

1. Start screen: **"Hear how home is doing."** Two short lines: astronauts can see home from orbit
   but cannot hear it, and a student who cannot see is shown home only as colour maps; then what
   Hearthbeat does. (Say aloud: Scott Kelly wrote that his crewmates replayed a recording of Earth
   sounds over and over. The source is in About.)
2. **Sign in: astronaut or family.** Press it, choose *Astronaut*, keep Kuala Lumpur, press *Sign in*
   (a demo account: no password, nothing sent anywhere). The globe is now seen through a porthole,
   following the space station; the big line counts down to home ("Home in 39 min"). Press *Hear home
   now*. Then *Start*, sign in as *Family*: a warm card, the globe turned to home with the station's
   track crossing it, "Your astronaut is over the Atlantic Ocean", "Nearest to us at 03:37". Press
   *Hear where they are*: a soft chord while the next 16 minutes of the station's path go by, with
   rain drops wherever NASA's data has rain under it. *Hear both sides* plays both.
   *Hear home* plays one thing at a
   time. First a home, someone cooking (a pan sizzling, a utensil stirring). Then the light rain in
   NASA's data as drops on the window. Then the air: the heartbeat of the haze, while the home
   sounds slightly shut in. The card names the part that is playing. The button reads *Hear
   home now*, and the text says "today", only when the newest NASA step is less than 36 hours old;
   otherwise the app gives the date. Then *Start*, *Hear my home*, and press *Is the air clean?*: a heartbeat
   at about 100 beats a minute, and the card reads "Not clean · 3× the WHO guideline".
3. **Compare with Jakarta**, press it again: Kuala Lumpur's heartbeat, then Jakarta's, much faster
   (about 131). "Jakarta's air is 2.5 times dirtier." Then *How much warmer?*: 15 notes climb from the
   1880s to the 2020s while the globe warms.

(Numbers are from the data whose newest step is 12 November 2026, 18:00 UTC, built on 13 November;
they change with each rebuild. With the 4 November data Kuala Lumpur read 1.6× and about 76 beats a
minute, Jakarta about 122.)

## The full version (about 3 minutes)

4. **Check-ups for class.** Check-up 1: find the heaviest rain in Southeast Asia by moving the
   stethoscope until the drops are dense. Check-up 3: listen to each of five days in Kuala Lumpur and
   pick the worst-air day (fastest heartbeat). Check-up 4: 1880 to 2025, one note per year.
5. **Check-ups → results.** The log shows time, result, hints, and whether the check-up was done with
   eyes closed. *Copy results (CSV)* gives the evidence for a listening test.
6. **Explore the globe.** Tap anywhere. The right panel shows the place, the value, a sentence saying what
   the sound is doing ("4 drops a second: light rain here…") and the three **vital signs** there. V reads
   them all. D describes the whole frame. C compares two places.
7. **Eyes closed** (E). The screen goes black and everything is spoken. *Hear home*, the three home questions,
   the check-ups and moving the stethoscope are all large buttons. H lists every key.
8. **Trust.** *About* covers why Hearthbeat exists and how it is sustained. For each track it also
   gives how the numbers are made, the measured accuracy against NASA's raw model data, the
   limitations, the sources and the validation status.

Fallbacks: if the data cannot load, the start screen says so and nothing plays, because the app
never invents values. If one layer fails, its track is disabled and the reason is shown.
