# Space, Translated

A ceiling sign that cycles through four full-screen views of live NASA data: today's Astronomy Picture of the Day, a space-weather readout, a live Earth image, and "Algorithm Art" — a generative canvas piece that translates the same live space-weather and near-Earth-object data into slow, ambient motion (not a dashboard, not a literal solar-system diagram).

## What's driving it

A Vercel serverless function (`api/nasa-data.js`) is the only thing that holds the real NASA API key (`process.env.NASA_API_KEY`, never sent to the browser). It requests five endpoints in parallel with `Promise.allSettled` — so one failure never blocks the rest — and returns a small normalized payload:

- [`planetary/apod`](https://api.nasa.gov) — today's Astronomy Picture of the Day
- [`neo/rest/v1/feed`](https://api.nasa.gov) — today's near-Earth objects
- [`DONKI/FLR`](https://api.nasa.gov) — solar flares, trailing ~7 days
- [`DONKI/CME`](https://api.nasa.gov) — coronal mass ejections, trailing ~7 days
- [`DONKI/GST`](https://api.nasa.gov) — geomagnetic storms, trailing ~7 days

Two more sources don't need a key at all, so `app.js` fetches them directly: [NASA's EPIC API](https://epic.gsfc.nasa.gov/) (Earth imagery) and [NOAA SWPC](https://www.swpc.noaa.gov/) (real-time solar wind). The browser never talks to `api.nasa.gov` itself — only `/api/nasa-data`, EPIC, and NOAA.

## The four screens

Each time the sign wakes from idle (not on every twitch while already awake), or a camera detects a new visitor after a few seconds of stillness, it advances: **APOD photo → Cosmic Meteorology → EPIC Earth image → Algorithm Art → back to APOD.**

- **APOD** — full-bleed image or video, whichever NASA published today.
- **Cosmic Meteorology** — a written, TV-weather-style space forecast: paragraphs fade in one at a time like a teleprompter and end with a highlighted "Cosmic outlook." Underneath, a small ticker shows live NOAA solar wind speed and Bz (updated every minute) and an aurora-watch badge when the field turns southward. See below for how the forecast is written.
- **EPIC** — the most recent full-disk photo of Earth from the DSCOVR satellite.
- **Algorithm Art** — see below.

## How the forecast is written (Cosmic Meteorology)

`api/cosmic-report.js` pulls the past week of NASA DONKI events — solar flares, coronal mass ejections (with any predicted Earth-arrival time), geomagnetic storms, and interplanetary shocks — turns them into a plain-text digest, and asks an OpenAI model to write the forecast under a strict weather-reporter persona (defined in that file): every claim must come from the digest, events that already happened are kept separate from ones predicted to reach Earth, and a quiet week is reported as quiet. The result is cached for 30 minutes.

If the OpenAI key isn't set, NASA can't be reached, or the model's answer doesn't match the expected format, the function returns no report and the screen shows a one-line summary instead. It never reports "quiet" when it simply couldn't get the data.

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

The sign asks for webcam access on load and uses simple frame differencing on a tiny (32×24) downscaled copy of the feed to detect movement. Frames are compared and discarded in the browser — nothing is recorded or sent anywhere. Movement wakes the sign; movement after about three seconds of stillness counts as a new visitor and advances to the next screen. Sudden whole-frame brightness changes (lights, auto-exposure) are ignored. If there's no camera or permission is denied, mouse/touch/keyboard activity is the fallback. For a kiosk, allow camera access for the site once in the browser's site settings so it never prompts.

## If NASA is unreachable

Every screen keeps running on whatever it last had (or a quiet neutral default on first load) — nothing blocks on the network or shows an error state. The only indicator is a single small dot in the bottom-right corner: dim gray when no source is live, soft teal when at least one is. There are no numeric error displays or panels.

## Files

- `index.html` — markup for all four screens plus the canvas and status dot
- `style.css` — full-viewport layout, the weather "stat screen" style, the canvas/grain styling, and the mode-switching + idle/wake transitions
- `app.js` — fetches and renders APOD, EPIC, solar wind, and Cosmic Meteorology; runs the Algorithm Art generative engine; and drives the four-way idle/wake cycle
- `api/nasa-data.js` — the Vercel serverless function that fetches and normalizes APOD, NEO, and DONKI data
- `api/cosmic-report.js` — the Vercel serverless function that writes the Cosmic Meteorology forecast from DONKI events

No React, TypeScript, build tooling, or npm packages — plain HTML/CSS/JS, deployed as-is.

## Setup

Set `NASA_API_KEY` in the Vercel project's environment variables (Project Settings → Environment Variables) to your own key from [api.nasa.gov](https://api.nasa.gov). It's read only inside the `api/` functions; nothing in the repo needs to contain it.

For the written forecast, also set `OPENAI_API_KEY` (from platform.openai.com → API keys; the account needs billing credit). Optionally set `COSMIC_REPORT_MODEL` to use a model other than the default `gpt-4o`. Without the key everything still works — the weather screen just shows the one-line summary.
