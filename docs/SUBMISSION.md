# Submission drafts for the Space Apps project page

Drafts for each field of the project page, in English as the rules require. Edit them into your
own words before submitting. Rules quoted here were read on the official pages on 13 November 2026:
the [Project Submission Guide](https://www.spaceappschallenge.org/resources/project-submission-guide/),
the [Participant Terms and Conditions](https://www.spaceappschallenge.org/legal/) and the
[Participant FAQs](https://www.spaceappschallenge.org/resources/participant-faqs/).

## Before you submit (only the team can do these)

1. **Eligibility.** Review the official Participant FAQs and confirm eligibility with the Kuala Lumpur Local Lead before submitting.
2. **Public links.** The demo link and the final-project link "should not require a password,
   permission, or registration". The public repository is
   <https://github.com/yantongggg/Hearbeat_NASA>. The demo site is
   <https://yantongggg.github.io/hearthbeat/>. Test both links in a private browser window before submitting.
3. **Demo.** A video of 30 seconds or less, or a slide deck of at most 7 slides including the
   title slide. Going over either limit makes the project ineligible for global judging. A
   non-English video needs English subtitles. Scripts for both are below.
4. **No one under 18** in any image, video or audio, in the demo or the project. Do not film or
   record children for the video.
5. **Kuala Lumpur local event.** Check its page and guide book for the local requirements (a PDF
   document and a longer video were listed there on 13 November) and its own rubric.
6. **Listening test.** Nobody outside the team has tried Hearthbeat yet. A test with even three
   people, using the check-ups and *Copy results (CSV)*, would let the page report real numbers.
   Say who took part (for example "three sighted adults, eyes closed"); do not describe them as
   blind or low-vision users unless they are.

## Project Name

Hearthbeat

## High-Level Project Summary

Hearthbeat is an Earth Information Jukebox for people who cannot read a colour map. It pairs NASA
Earth Information Center (EIC) frames with sound generated in real time from the data in each
frame. Pick a track (rain, air quality or warming) and move a listening point over a 3D globe:
raindrops get denser where it rains harder, a heartbeat beats faster where the air is dirtier, and
one note per year rises as a place warms. Or start from the one place you care about, home, and
ask three questions: Is it raining? Is the air clean? How much warmer than in 1951–1980? Each
answer is a short sound, then the NASA number. An eyes-closed mode speaks everything and works
from the keyboard. It matters because the EIC's daily maps are visual only, so a blind or
low-vision student has to wait for someone else to describe them.

## Link to Project Demo

(your public 30-second video or 7-slide deck)

## Link to Final Project

<https://github.com/yantongggg/Hearbeat_NASA> · demo: <https://yantongggg.github.io/hearthbeat/>

## Detailed Project Description

**What it does.** Five tracks play NASA data as sound while the globe shows the matching NASA
frame:

- Rain (EIC / SVS 5149, GEOS-FP precipitation): raindrops, from 1 a second in light rain to 10 a
  second at 20 mm/h, with a soft low note in heavy rain.
- Air quality (EIC / SVS 5151; PM2.5 values from GEOS-CF): music that gets muffled as PM2.5
  rises, and above the WHO 24-hour guideline (15 µg/m³) a heartbeat from 60 to 140 beats a minute.
- Warming (NASA GISTEMP v4, 1880–2025): one music-box note per year, higher when warmer than
  1951–1980.
- Night lights (EIC / SVS 5313, Black Marble VIIRS, 2012–2023; one of the visualizations listed in
  the challenge): twinkles, more where there is more light at night. Delhi's light index rose by
  half from 2012 to 2023; Kyiv's fell by half after 2021.
- Lightning (SVS 5011, seen by LIS on the International Space Station, 2017–2023; listed in the
  challenge): soft marimba taps, more where the station saw more lightning, one step per month.
  Florida's storms come in summer, Johannesburg's and Darwin's in January; Kuala Lumpur has them all
  year. In Together, the station's side plays the lightning its own sensor saw below its path.

*Home song* plays all five as one song for a place: the warming is the melody, one note per
decade since the 1880s, and the other four join one by one in the same key before playing together.
*Home* asks those tracks one question each about a place you choose, and *Hear home* plays a
household recording (someone cooking), then the rain on its window, then the air as a heartbeat.
*Together*: sign in as an astronaut or as their family (a demo) and *Hear both sides*: home, and
the Earth passing below the space station now, where NASA's predicted ISS trajectory puts it, with
NASA's rain and air under its path. Four *check-ups* for class pose a
question, check the answer against the data, time it and keep a log that exports as CSV. The exact
number is always available by voice.

**How it works.** A Python pipeline downloads the EIC frames from NASA's Scientific Visualization
Studio, reads each pixel back through the visualization's own colorbar, validates the result and
writes one-degree grids. The accuracy of those values was measured against NASA's raw model output
(`docs/ACCURACY.md`): rain location is read well and rain amount is 22–25 % low; PM2.5 frames did
not follow their colorbar, so PM2.5 numbers are taken from GEOS-CF model output instead. The web
app (TypeScript, three.js, Web Audio) synthesizes every sound in the browser from the value at the
listening point. Nothing is pre-recorded except the household clip, and nothing is simulated: if
data is missing, the track is switched off and says why.

**Sound design.** One data voice per track in front of a quiet musical bed, major keys only, round
wooden and music-box tones, levels measured so nothing clips or rumbles. An earlier version was
described as scary by a team member; the heartbeat then had 65 % of its energy below 150 Hz and it
now has none.

**Accessibility.** Eyes-closed mode (black screen, large buttons, everything spoken), screen-reader
live regions, full keyboard control, vibration on phones, English and Chinese, and a tactile map
in the classroom pack. It passes automated axe checks (WCAG 2.1 A/AA) and keyboard tests. It has
not yet been tested with a screen reader by a blind or low-vision user.

**Limits.** Rain and air quality are NASA model analyses and short forecasts, not measurements at
a station. The air classes compare hourly model values with a 24-hour guideline and are a guide,
not a health warning. The app shows how old its data is and says "today" only when the newest step
is less than 36 hours old. The astronaut sign-in is a demo with no accounts. The night-lights picture has no colour scale, so
its value is a relative light index, not radiance.

**What we hope to achieve.** A student who cannot see the map should be able to find out alone,
from NASA's own daily data, how home is doing. And an astronaut and the family at home, far apart,
should be able to hear the same planet: each other's side, from NASA's data.

**Tools.** TypeScript, Vite, three.js, d3-geo, Web Audio API, Web Speech API; Python, numpy,
Pillow, netCDF4, requests; Vitest, Playwright, axe-core; GitHub Actions.

## Use of Super Intelligence (SI)

Yes. Most of the code, tests and documentation were written with an AI coding assistant, directed
and reviewed by the team; the README and NOTICE say so. The team
gave the direction and judged the result by listening: for example that the first sounds were too
quiet, that a later version sounded scary, and that home should be the centre. The sounds are
synthesized at run time by code from NASA data, the household recording was made by a person and is
in the public domain, and the globe pictures are NASA's. The team poster, the demo videos and the
project document were assembled with AI assistance from screen recordings of the app and carry a
visible "AI-assisted (SI)" mark.

(Check this against what actually happened in your team before submitting. The form says SI should
not be used to come up with the idea of how to solve the challenge.)

## NASA Data

- NASA Earth Information Center daily visualizations, NASA Scientific Visualization Studio:
  SVS 5149 (GEOS-FP precipitation), SVS 5151 (GEOS-CF surface PM2.5), SVS 5147 (GEOS-FP
  near-surface temperature, shown as a context value). <https://svs.gsfc.nasa.gov/5149/>,
  <https://svs.gsfc.nasa.gov/5151/>, <https://svs.gsfc.nasa.gov/5147/>
- NASA GMAO GEOS-CF v2 surface PM2.5 (`pm25_rh35`), read from the NCCS OPeNDAP server, for the
  PM2.5 numbers and for the accuracy test.
- NASA GISS Surface Temperature Analysis (GISTEMP v4), 1880–2025.
  <https://data.giss.nasa.gov/gistemp/>
- NASA Visible Earth: Blue Marble and Black Marble, for the globe.
- NASA Earth Information Center visualization SVS 5313, "Change in Night Lights between 2012 and
  2023 - EIC Version" (Black Marble: Next Generation, NASA/NOAA Suomi NPP VIIRS),
  <https://svs.gsfc.nasa.gov/5313/>, read from NASA's movie of it.
- NASA visualization SVS 5011, "Lightning Events Detected from the International Space Station (ISS)
  2017-2023" (data: Blakeslee 2020, Quality Controlled LIS on ISS Science Data, NASA GHRC DAAC),
  <https://svs.gsfc.nasa.gov/5011/>, read from NASA's Science On a Sphere movie of it.
- Compared with, not used as data: NASA SVS 5533 (Air Quality Model Runs, GEOS-CF, the model behind
  the air values) and SVS 13786 (Data Sonification: Caldwell 73).
- NASA Johnson Space Center (Flight Operations Directorate, TOPO): International Space Station
  predicted trajectory, CCSDS OEM, `https://nasa-public-data.s3.amazonaws.com/iss-coords/current/ISS_OEM/ISS.OEM_J2K_EPH.txt`
  (for Together: where the station is now).

## Space Agency Partner Data and Other References

- World Health Organization, global air quality guidelines (2021): the 24-hour PM2.5 guideline of
  15 µg/m³ and interim targets. The class names in the app are Hearthbeat's own.
- World Health Organization, World report on vision (2019): at least 2.2 billion people with a
  vision impairment.
- American Meteorological Society, Glossary of Meteorology: rain intensity classes.
- Scott Kelly, "I Spent a Year in Space, and I Have Tips on Isolation to Share", The New York
  Times, March 2020 (the story on the start screen).
- Natural Earth coastlines (public domain) through the `world-atlas` package.
- Household recording: "Sauteing leeks" by hugh, pdsounds.org, public domain, from Wikimedia
  Commons.
- Lenssen et al. (2019), Improvements in the GISTEMP uncertainty model.
- Open-source libraries: three.js, d3-geo, topojson-client, Vite, Vitest, Playwright, axe-core,
  numpy, Pillow, requests, netCDF4, reportlab. Fonts: Archivo, Noto Sans SC (SIL OFL).
- An AI coding assistant (see Use of SI above).

No Space Agency Partner data is used.

## 30-second video script

| Time | Picture | Words |
|---|---|---|
| 0:00 | Title card, then the globe turning (adults only on screen, if anyone) | "An astronaut can see home from space, but cannot hear it." |
| 0:04 | Sign-in: *Family* | "Hearthbeat turns NASA's Earth data into sound." |
| 0:07 | Together card; the station on the globe with its track | "Right now the space station is over the Pacific, from NASA's own trajectory." |
| 0:12 | *Hear both sides*: home (cooking, rain, heartbeat) | "Home: someone cooking, today's rain on the window, the haze as a heartbeat." |
| 0:19 | The station's side, the globe following it | "And the planet passing below them, from the same NASA data." |
| 0:24 | Eyes-closed mode, black screen | "Built first for people who cannot see a colour map. Apart, but hearing the same Earth." |

Record the app's own sound; keep narration short enough to hear it. Every number on screen comes
from the app at the time of recording; do not script numbers in advance.

## 7-slide outline

1. Title: Hearthbeat, team name, members, challenge "The Earth Information Jukebox".
2. Problem: EIC maps are visual only; a student who cannot see waits for a description.
3. Idea: listen to the planet like a doctor with a stethoscope; three vital signs; Together for an
   astronaut and the family at home.
4. Demo screenshots: Together with the station on the globe, Home with the three questions, and
   the jukebox tracks.
5. How it works: EIC frame → colorbar → value → sound in the browser; measured accuracy.
6. Accessibility and honesty: eyes-closed mode, automated checks, what is not tested yet.
7. What next: more EIC tracks from the challenge list, a classroom test.
