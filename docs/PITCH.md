# Hearthbeat: hear how home is doing

Challenge: NASA Space Apps 2026, **The Earth Information Jukebox**.

## The story

From the space station, astronauts can see home but cannot hear it. Scott Kelly, who spent a year
on the station, wrote that his crewmates played a recording of Earth sounds (birds, rustling trees,
even mosquitoes) over and over ([Scott Kelly, "I Spent a Year in Space, and I Have Tips on Isolation to Share", *The New York Times*, March 2020](https://www.sltrib.com/opinion/commentary/2020/03/22/scott-kelly-i-spent-year); republished by the Salt Lake Tribune, 22 March 2020). A
student who cannot see can hear, but NASA shows home only as colour maps. Hearthbeat gives both the
same thing: the sound of home, made from NASA's newest data.

The name carries the idea. A *hearth* is the heart of a home, so Hearthbeat is the heartbeat of
home. (The astronaut is the story that opens the pitch, not a user we have studied. The one fact
we use is Scott Kelly's own account; we make no wider claim about astronauts. The *Astronaut
sign-in* in the app is a demo: one press, no password, no accounts, and the dialog says so.)

## The problem

NASA reports the condition of our planet as colour maps. The Earth Information Center's daily
rain and air-quality maps and the 145-year temperature record are all colour maps. NASA's climate
site even calls its key indicators the planet's **vital signs**.

If you cannot see a colour map, you have to wait for someone to describe it. The WHO estimates
that **at least 2.2 billion people** live with a near or distance vision impairment
([World report on vision, 2019](https://www.who.int/publications/i/item/9789241516570)). For a
visually impaired student, today's rain, today's haze and their own city's warming exist only
when a teacher has time to read the map aloud or make a tactile copy by hand. A daily NASA product
cannot be made tactile every day.

**Problem statement.** How might anyone, and first a student who cannot see a map, find out alone
from NASA's daily Earth data how home is doing: is it raining, is the air clean, and how much has
home warmed?

## The idea

Doctors listen to examine what they cannot see. That is auscultation, and it is a stethoscope
skill, not an eyesight skill. Hearthbeat applies the same idea to the planet:

> Place the stethoscope anywhere on NASA's Earth and hear its vital signs.

| Vital sign | NASA data | What you hear |
|---|---|---|
| **Circulation**: rain | EIC / SVS 5149, GEOS-FP precipitation, every 6 h over 5 days | Raindrops. More drops means harder rain, and a soft low note joins in heavy rain. In Explore and the check-ups, a soft wash on the left or right tells which side nearby rain lies on. |
| **Breathing**: air quality | EIC / SVS 5151 picture; GEOS-CF PM2.5 values, every 6 h | Clean air sounds clear and open. Dirtier air sounds muffled. Above the WHO guideline a soft heartbeat (two wooden notes) joins in. The dirtier the air, the faster it beats, from 60 to 140 beats a minute. |
| **Fever**: warming | NASA GISTEMP v4, 1880–2025 | One music-box note per year. A higher note means warmer than 1951–1980. A soft held chord is the whole planet, and it rises as the Earth warms. |

Exact numbers are always available by voice (the *Read aloud* button, or Enter on the globe).
Nobody has to guess a value by ear.

## How it answers the challenge

The challenge asks for an "Earth Jukebox" that pairs EIC visual frames with sonifications generated
in real time, where people can select an EIC visualization and experience it with its soundscape.
It names accessibility as a core theme and asks for sound that is musical rather than noise.

| The challenge asks for | Hearthbeat |
|---|---|
| EIC frames paired with sound generated in real time | The globe shows the NASA EIC frame for the step being heard. The sound is synthesized in the browser, as you listen, from the value at the listening point: decoded from the frame for rain (SVS 5149), and taken from the model output behind the frame for PM2.5 (SVS 5151). |
| Select a visualization and experience it with its soundscape | Five tracks to choose from (the track list, or keys 1–5): Rain, Air quality, Warming, Night lights and Lightning. Play, pause, step, scrub or *Go to…* through 5 days, 12 months, 12 years or 146 years. *Home* asks the same tracks one question each. |
| Accessibility as a core theme | Eyes-closed mode with everything spoken, screen-reader text, keyboard control, vibration, a tactile map. Checked by automated tests only so far. |
| Musical, not chaotic | One data voice per track in front of a quiet musical bed, major keys only, levels measured so nothing clips or rumbles. |
| Explain the "why" | This document, *About* in the app, and `docs/ACCURACY.md`. |

Of the ten SVS pages NASA listed for the challenge on 13 November, two are tracks: SVS 5313, night
lights 2012–2023 (EIC version), read from NASA's movie of it because its frame folder is not public,
and SVS 5011, lightning seen by the sensor on the ISS, 2017–2023, which also plays on the station's
side in Together. Neither picture has a colour scale, so both values are relative, and the app says
so. The other EIC tracks use the daily visualizations 5149 and 5151; the air values come from
GEOS-CF, the model behind SVS 5533. NASA's Caldwell 73 sonification (SVS 13786) gives each kind of
star its own instrument; Hearthbeat gives each kind of data its own voice.

## What you can do

### 1. Hear your home (the main function)

Choose home (Malaysian towns first, then Asia and the world, or tap anywhere on the globe).

**Together** (sign in as the astronaut or as their family; a demo, no accounts). The card says
where the International Space Station is now, from NASA's own predicted trajectory, and when it
next passes closest to home; the station and its track are on the globe. *Hear both sides* plays
home, and the station's side: a soft chord while the next 16 minutes of its path go by, with
NASA's rain and air under the track. The astronaut hears their side first, the family home first.
Apart, but listening to the same planet. This is the answer to Scott Kelly's crewmates replaying
a recording of Earth: not a recording, but the planet below them now, and home, from NASA data.

**Hear home** plays 12 seconds, one thing at a time. First a household alone: someone cooking, a
pan sizzling and a utensil stirring. Then NASA's newest rain for that place, as drops on the
window, as many as the rain rate says. Then the air: dirty air brings the heartbeat, and it also
shuts the room in, so the home sounds get muffled and farther away, as if the windows were closed.
In clean, dry weather you hear the home clearly, with nothing on top. (An earlier version played
all three at once; a team member found it cluttered and too fast.) The home sounds are public-domain recordings from Wikimedia Commons, credited
in the app's About page. They are not data and not the listener's own home, and the card says so.
A switch turns them off to hear the data alone. The button reads *Hear home now*, and the text
says "today", only when the newest NASA step is less than 36 hours old; otherwise the app gives
the date and how old the data is.

No voices are used. The Space Apps terms bar recognizable voices of anyone under 18 and need the
consent of any adult who is featured, so recordings of a family can only come from a family that
has agreed to it.

Or press one of three questions:

| Question | What you hear | What you read |
|---|---|---|
| Is it raining? | Raindrops at home for 4 seconds. More drops, harder rain. No drops, dry. | e.g. "Light rain · 0.5 mm/h" |
| Is the air clean? | A heartbeat for 4 seconds. Faster, dirtier. No heartbeat, clean. | e.g. "Not clean · 3× the WHO guideline · 47 µg/m³" |
| How much warmer than in 1951–1980? | One note per decade, 1880s to 2020s, while the globe steps through the years. Higher, warmer. | e.g. "+1.05 °C in 2025" |

Nothing plays until a button is pressed, and each question plays only its own sound, so every
sound answers something the listener just asked. *Compare with* plays home, then any other city:
in the data of 12 November 2026, Kuala Lumpur's heartbeat at about 100 beats a minute, then
Jakarta's at about 131.

### 2. Four check-ups (for class)

Each check-up is a real question with an answer that the app checks against the NASA data shown
at that moment. It records how long the check-up took and whether the answer was right.

1. **Circulation.** Where is it raining hardest in Southeast Asia in the newest NASA data? Move the stethoscope
   until the drops are dense. A hint gives the direction of the rain.
2. **Breathing.** Kuala Lumpur or another city: whose air is dirtier in the newest NASA data? Listen to both, then
   choose.
3. **Breathing over time.** On which of the last five days was Kuala Lumpur's air at its worst? Play the
   day, one at a time, and compare how fast the heartbeat is.
4. **Fever.** How much warmer was Kuala Lumpur in 2025 than in 1951–1980? Play 1880 to 2025 and
   hear the notes climb.

### 3. Explore the globe

Pick a track, move the listening point anywhere and hear the data there, play the 5 days or the 145 years, compare
two places, or have the whole picture described.

The main functions work with a mouse, touch or keyboard only, and in eyes-closed mode, where
text is spoken and the controls are large buttons. This is checked by automated tests; no user
test has been run yet.

## Why it is original

- **Personal, not planetary.** Most sonifications play the whole planet. Hearthbeat starts from
  one place you care about, home: you hear it, and you ask three questions about it.
- **An examination, not a song.** In Hearthbeat you ask, listen and compare, and in check-ups
  your answer is checked against the data.
- **Values with a measured error.** Each EIC frame is read back through its own colorbar
  and checked against NASA's raw model output (`docs/ACCURACY.md`). When the picture cannot be
  trusted, as with PM2.5, the values come straight from NASA's model output. Nothing is simulated.
- **A metaphor that needs no explanation.** Everyone knows what a stethoscope and a fever are.
  The name says the rest: a hearth is the heart of a home.
- **The picture stays NASA's.** NASA's rain colours and clouds are laid on NASA's Blue Marble,
  lit by the sun at that hour, so a sighted classmate sees what the student hears.

## Materials

- **The web app**, which runs on a phone. The data voices are mixed loud enough for a phone
  speaker; headphones add the side that nearby rain or haze lies on.
- **The classroom pack** (`docs/classroom/`, English and 中文):
  - a teacher guide with a 40-minute lesson and a listening-test protocol;
  - four large-print check-up cards;
  - a tactile map of Southeast Asia for swell paper.
- **Sounds of a home** (`app/public/home-sounds/`): public-domain recordings from Wikimedia
  Commons, trimmed and filtered, with author, source and changes in `manifest.json` and in the
  app's About page. Today that is one clip: leeks sizzling in a pan (hugh, pdsounds.org). No clip
  contains a person's voice.
- **This pitch** and the accuracy report (`docs/ACCURACY.md`).

## How it could be sustained (a proposal; no organisation has been contacted)

| Who | What they would get | How it could pay |
|---|---|---|
| Schools and special-education classes | The web app and four check-ups; needs only a phone and headphones | Free. This is the impact, and it builds the evidence base. |
| Science centres, planetariums and EIC screens | An audio layer and check-up kiosk for Earth exhibits | Yearly venue licence with content updates |
| Agencies, publishers and universities | **The engine**: an equirectangular map whose colours follow its colorbar becomes explorable sound, with a measured accuracy report. Of five EIC layers tried, two were usable, one needed model output for its numbers, and two could not be used | API or SDK licence, plus setup |

The engine is the scalable part. Colour maps and charts are among the hardest content to make
accessible, and legal pressure is growing:

- The [European Accessibility Act](https://eur-lex.europa.eu/eli/dir/2019/882/oj) has applied
  since 28 June 2025.
- The US Department of Justice's 2024 ADA Title II rule adopted WCAG 2.1 AA for state and local
  government websites.

Hearthbeat's pipeline adds a new SVS map as a configuration entry
(`pipeline/hearthbeat_pipeline/probe.py`). A person still reads the colorbar range, and the
accuracy test decides whether the layer can be trusted.

## How we will show it works (validation plan)

- **Built in.** The app logs every check-up: time, result, hints used, and whether it was done
  with eyes closed. "Copy results" exports the log as CSV.
- **Comparison.** The same four questions answered (a) with a screen reader reading numbers one
  at a time, and (b) with Hearthbeat. Measure completion rate and time.
- **Report honestly who took part.** Blindfolded sighted volunteers are not visually impaired
  users. Label them as such, and seek a special-education teacher's review before claiming
  classroom fit.

## Limits we state up front

- Rain and air quality are NASA model analyses and short forecasts, not station measurements.
- Rain hidden under clouds in the picture is under-counted, and rain rates read from the picture
  are 22–25 % low on average, with heavy rain read lower still (`docs/ACCURACY.md`).
- The shipped data is a snapshot. The app says how old it is and calls it "today" only when it is.
- The air classes compare hourly model values with the WHO 24-hour guideline. They are a guide,
  not a health warning.
- The sounds of a home are public recordings of a kitchen, not from Malaysia and not from the
  listener's own home, and they have no voices. They are not data. Muffling the room when the air
  is dirty is a picture (closed windows), not a physical effect of haze on sound.
- No listening test and no test with blind or low-vision users has been run yet.
