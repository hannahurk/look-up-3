# Space, Translated

A ceiling sign that cycles through six full-screen views of live NASA and NOAA data: today's Astronomy Picture of the Day, a space-weather readout, a three-day space weather forecast, a live Earth image, a plain-language key to the artwork, and "Algorithm Art" — a generative canvas piece that translates the same live space-weather and near-Earth-object data into slow, ambient motion (not a dashboard, not a literal solar-system diagram).

## What's driving it

A Vercel serverless function (`api/nasa-data.js`) is the only thing that holds the real NASA API key (`process.env.NASA_API_KEY`, never sent to the browser). It requests five endpoints in parallel with `Promise.allSettled` — so one failure never blocks the rest — and returns a small normalized payload:

- [`planetary/apod`](https://api.nasa.gov) — today's Astronomy Picture of the Day
- [`neo/rest/v1/feed`](https://api.nasa.gov) — today's near-Earth objects
- [`DONKI/FLR`](https://api.nasa.gov) — solar flares, trailing ~7 days
- [`DONKI/CME`](https://api.nasa.gov) — coronal mass ejections, trailing ~7 days
- [`DONKI/GST`](https://api.nasa.gov) — geomagnetic storms, trailing ~7 days

Some sources don't need a key at all, so `app.js` fetches them directly: [NASA's EPIC API](https://epic.gsfc.nasa.gov/) (Earth imagery) and [NOAA SWPC](https://www.swpc.noaa.gov/) (real-time solar wind, the Kp index, and NOAA's three-day space weather scales forecast). The browser never talks to `api.nasa.gov` itself — only `/api/nasa-data`, EPIC, and NOAA.

## The six screens

Each slide holds for 15 seconds, then the sign moves on to the next — and a camera detecting a new visitor (movement after a few seconds of stillness) advances it immediately. The order: **APOD photo → Cosmic Meteorology → Space Weather Forecast → EPIC Earth image → Artwork key → Algorithm Art → back to APOD.**

- **APOD** — full-bleed image or video, whichever NASA published today.
- **Cosmic Meteorology** — NOAA solar wind speed and Bz (live, updated every minute), an aurora-watch badge when the field turns southward, and a one-line summary of the week's flare/CME/storm activity.
- **Space Weather Forecast** — a TV-weather-style report. NOAA's official three-day forecast becomes three day cards (calm to storm, plus the chance of radio blackouts and radiation storms), followed by a short script: what the solar wind and Kp index are doing right now, what's forecast, and a recap of the past week from NASA DONKI. Every sentence is a fixed template filled with live numbers and is simply left out if its data is missing, so nothing is invented.
- **EPIC** — the most recent full-disk photo of Earth from the DSCOVR satellite.
- **Artwork key ("Today's sky, translated")** — shown just before the art, in the same plain weather-report voice: what the shooting stars, glowing core and orbiting dots mean right now, with the live numbers behind each (Kp, flare and CME counts, strongest flare, asteroids today) and NOAA's forecast headline. A line is skipped if its data source isn't live.
- **Algorithm Art** — see below.

## How the data reads as motion (Algorithm Art)

- **Solar-flare intensity** (peak flare class × magnitude in the window) sets the atmospheric core's brightness and radius.
- **Geomagnetic intensity** (max Kp / 9) sets the shooting stars' size (tail length, stroke width, head size) and speed — calm conditions read as small, slow streaks; storm conditions read as long, fast, thick ones.
- **Number of space-weather events** (flares + CMEs, plus a bump for any storm) sets shooting-star density.
- **Each tracked asteroid** becomes one orbiting body.
  - Diameter → body size
  - Velocity → orbital speed
  - Miss distance → orbital radius
- **Potentially hazardous asteroids**, and generally elevated conditions (an X-class flare or Kp ≥ 5), bring in a restrained amber tint — never a saturated warning color.

Displayed values ease toward the latest fetched numbers rather than snapping, so a data refresh never looks abrupt. The canvas keeps running continuously in the background even while a different screen is showing, so Algorithm Art is always mid-motion when the cycle reaches it.

## Camera motion

The sign asks for webcam access on load and uses simple frame differencing on a tiny (32×24) downscaled copy of the feed to detect movement. Frames are compared and discarded in the browser — nothing is recorded or sent anywhere. Movement after about three seconds of stillness counts as a new visitor and advances to the next screen right away (and restarts the 15-second hold); continuous movement doesn't skip screens. Sudden whole-frame brightness changes (lights, auto-exposure) are ignored. If there's no camera or permission is denied, mouse/touch/keyboard activity counts as movement instead, and the 15-second timer still runs. For a kiosk, allow camera access for the site once in the browser's site settings so it never prompts.

## If NASA is unreachable

Every screen keeps running on whatever it last had (or a quiet neutral default on first load) — nothing blocks on the network or shows an error state. The only indicator is a single small dot in the bottom-right corner: dim gray when no source is live, soft teal when at least one is. There are no numeric error displays or panels.

## Files

- `index.html` — markup for all six screens plus the canvas and status dot
- `style.css` — full-viewport layout, the weather "stat screen" style, the canvas/grain styling, and the cross-fade between screens
- `app.js` — fetches and renders APOD, EPIC, solar wind, and Cosmic Meteorology; runs the Algorithm Art generative engine; and drives the six-screen timed cycle
- `api/nasa-data.js` — the Vercel serverless function that fetches and normalizes APOD, NEO, and DONKI data

No React, TypeScript, build tooling, or npm packages — plain HTML/CSS/JS, deployed as-is.

## Setup

Set `NASA_API_KEY` in the Vercel project's environment variables (Project Settings → Environment Variables) to your own key from [api.nasa.gov](https://api.nasa.gov). It's read only inside `api/nasa-data.js`; nothing in the repo needs to contain it.
