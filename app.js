// Space, Translated — a ceiling sign cycling through NASA's Astronomy
// Picture of the Day, space weather, a space weather forecast, a live Earth
// image, and a generative canvas reading of the same live data ("Algorithm Art").
//
// /api/nasa-data (a serverless proxy holding the real NASA key) supplies
// APOD, space weather, and near-Earth objects. EPIC and NOAA solar wind
// need no key, so this file fetches those two directly. This file never
// sees or requests a NASA key itself.

(function () {
  'use strict';

  const REFRESH_MS = 60 * 60 * 1000; // APOD/EPIC/space-weather roll over slowly
  const WIND_REFRESH_MS = 60 * 1000; // NOAA solar wind updates about once a minute
  const KM_S_TO_MPH = 2236.94;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const canvas = document.getElementById('art');
  const ctx = canvas.getContext('2d');
  const statusEl = document.getElementById('status');
  const statusText = document.getElementById('status-text');

  let width = 0;
  let height = 0;
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  let ui = 1; // size scale so the art stays readable from across a room on big screens

  // ---------- small math helpers ----------

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function mapRange(v, inMin, inMax, outMin, outMax) {
    if (inMax === inMin) return outMin;
    const t = clamp((v - inMin) / (inMax - inMin), 0, 1);
    return outMin + t * (outMax - outMin);
  }

  function logMapRange(v, inMin, inMax, outMin, outMax) {
    const lv = Math.log10(Math.max(v, 1));
    const lMin = Math.log10(Math.max(inMin, 1));
    const lMax = Math.log10(Math.max(inMax, 1));
    return mapRange(lv, lMin, lMax, outMin, outMax);
  }

  function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function makeRandom(seed) {
    let s = seed || 1;
    return function () {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      s = s >>> 0;
      return s / 4294967295;
    };
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  // ---------- APOD (image/video backdrop) ----------

  function youtubeEmbedUrl(url) {
    const match = (url || '').match(
      /(?:youtube\.com\/(?:embed\/|watch\?v=)|youtu\.be\/)([\w-]+)/
    );
    if (!match) return null;
    const id = match[1];
    return `https://www.youtube.com/embed/${id}?autoplay=1&mute=1&loop=1&playlist=${id}&controls=0&modestbranding=1&rel=0`;
  }

  function renderAPOD(apod) {
    const oculus = document.getElementById('oculus');
    oculus.classList.remove('is-loading', 'show-video', 'show-video-frame', 'show-fallback');

    if (!apod) {
      oculus.classList.add('show-fallback');
      return;
    }

    const imgEl = document.getElementById('oculus-image');
    const videoEl = document.getElementById('oculus-video');
    const frameEl = document.getElementById('oculus-video-frame');

    videoEl.pause();
    videoEl.removeAttribute('src');
    videoEl.load();
    frameEl.src = '';

    if (apod.mediaType === 'image') {
      imgEl.src = apod.imageUrl;
      imgEl.alt = apod.title;
    } else if (apod.mediaType === 'video') {
      const embedUrl = youtubeEmbedUrl(apod.videoUrl);
      if (embedUrl) {
        frameEl.src = embedUrl;
        frameEl.title = apod.title;
        oculus.classList.add('show-video-frame');
      } else {
        videoEl.src = apod.videoUrl;
        videoEl.play().catch(() => {});
        oculus.classList.add('show-video');
      }
    } else {
      oculus.classList.add('show-fallback');
    }
  }

  function renderAPODError() {
    const oculus = document.getElementById('oculus');
    oculus.classList.remove('is-loading');
    oculus.classList.add('show-fallback');
  }

  // ---------- EPIC (Earth Polychromatic Imaging Camera) ----------
  //
  // EPIC's own API host, not proxied through api.nasa.gov — no key needed.

  const EPIC_URL = 'https://epic.gsfc.nasa.gov/api/natural';

  async function loadEPIC() {
    try {
      const res = await fetch(EPIC_URL);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) throw new Error('No EPIC images available');
      renderEPIC(data[data.length - 1]);
    } catch (err) {
      console.error('EPIC fetch failed:', err);
    }
  }

  function renderEPIC(entry) {
    const [datePart] = entry.date.split(' ');
    const [year, month, day] = datePart.split('-');
    const img = document.getElementById('epic-image');
    img.src = `https://epic.gsfc.nasa.gov/archive/natural/${year}/${month}/${day}/jpg/${entry.image}.jpg`;
    img.alt = `Earth, photographed from space on ${datePart}`;
  }

  // ---------- Solar wind (NOAA SWPC — near-real-time, no key required) ----------

  async function loadSolarWind() {
    try {
      const [magRes, speedRes] = await Promise.all([
        fetch('https://services.swpc.noaa.gov/products/summary/solar-wind-mag-field.json'),
        fetch('https://services.swpc.noaa.gov/products/summary/solar-wind-speed.json'),
      ]);
      if (!magRes.ok || !speedRes.ok) throw new Error('HTTP ' + magRes.status + '/' + speedRes.status);
      const [mag] = await magRes.json();
      const [speed] = await speedRes.json();
      renderSolarWind(mag, speed);
    } catch (err) {
      document.getElementById('wx-card').classList.add('has-error');
      document.getElementById('wind-speed').textContent = '—';
      document.getElementById('wind-bz').textContent = '—';
      console.error('Solar wind fetch failed:', err);
    }
  }

  function renderSolarWind(mag, speed) {
    const card = document.getElementById('wx-card');
    card.classList.remove('has-error');

    const mph = Math.round(speed.proton_speed * KM_S_TO_MPH);
    document.getElementById('wind-speed').textContent = mph.toLocaleString('en-US');

    const bz = mag.bz_gsm;
    document.getElementById('wind-bz').textContent = (bz > 0 ? '+' : '') + bz;
    const isSouth = bz < -2; // southward field: more likely to spark aurora
    card.classList.toggle('is-south', isSouth);
    document.getElementById('aurora-badge').hidden = !isSouth;
  }

  // ---------- Cosmic Meteorology summary (from /api/nasa-data) ----------

  function renderSpaceWeatherSummary(spaceWeather) {
    const card = document.getElementById('wx-card');
    card.classList.remove('has-error');

    let text;
    if (spaceWeather.kpIndex >= 5) {
      text = `Geomagnetic storm conditions — Kp ${spaceWeather.kpIndex}`;
    } else if (spaceWeather.flareCount > 0) {
      text = `${spaceWeather.flareCount} solar flare${spaceWeather.flareCount === 1 ? '' : 's'} this week`;
    } else if (spaceWeather.cmeCount > 0) {
      text = `${spaceWeather.cmeCount} coronal mass ejection${spaceWeather.cmeCount === 1 ? '' : 's'} this week`;
    } else {
      text = 'All quiet — no notable activity this week.';
    }
    document.getElementById('wx-alert').textContent = text;
  }

  // ---------- Space Weather Forecast (NOAA SWPC) ----------
  //
  // NOAA publishes an official 3-day forecast on its space weather scales
  // (G = geomagnetic storms, R = radio blackouts, S = radiation storms). The
  // slide shows those as three day cards.

  const SCALES_URL = 'https://services.swpc.noaa.gov/products/noaa-scales.json';
  const FORECAST_REFRESH_MS = 30 * 60 * 1000;
  const G_NAMES = ['Calm', 'Minor storm', 'Moderate storm', 'Strong storm', 'Severe storm', 'Extreme storm'];

  let noaaScales = null; // NOAA's 3-day scales forecast

  async function loadForecast() {
    try {
      const res = await fetch(SCALES_URL);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      noaaScales = await res.json();
    } catch (err) {
      console.error('NOAA scales fetch failed:', err);
    }
    paintForecast();
  }

  function toInt(v) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  }

  function forecastDays() {
    if (!noaaScales) return [];
    return ['1', '2', '3']
      .map((key) => noaaScales[key])
      .filter((d) => d && d.DateStamp)
      .map((d) => ({
        date: d.DateStamp,
        g: toInt(d.G && d.G.Scale) || 0,
        rMinor: toInt(d.R && d.R.MinorProb),
        rMajor: toInt(d.R && d.R.MajorProb),
        s: toInt(d.S && d.S.Prob),
      }));
  }

  function dayName(dateStamp) {
    return new Date(dateStamp + 'T00:00:00Z').toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
  }

  function strongestFlareClass(intensity) {
    if (!(intensity > 0)) return null;
    const classes = [['X', 10000], ['M', 1000], ['C', 100], ['B', 10], ['A', 1]];
    for (const [letter, base] of classes) {
      if (intensity >= base) return letter + (intensity / base).toFixed(1);
    }
    return null;
  }

  function plural(n, one, many) {
    return `${n} ${n === 1 ? one : many}`;
  }

  function paintForecast() {
    const days = forecastDays();
    const daysEl = document.getElementById('fc-days');
    if (daysEl) {
      daysEl.textContent = '';
      if (days.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'fc-empty';
        empty.textContent = 'Forecast unavailable right now';
        daysEl.appendChild(empty);
      }
      days.forEach((d, i) => {
        const card = document.createElement('div');
        card.className = 'fc-day';
        card.dataset.g = String(Math.min(d.g, 5));
        card.style.setProperty('--i', i);

        const date = document.createElement('div');
        date.className = 'fc-date';
        date.textContent = dayName(d.date);

        const cond = document.createElement('div');
        cond.className = 'fc-cond';
        const dot = document.createElement('span');
        dot.className = 'fc-dot';
        dot.setAttribute('aria-hidden', 'true');
        cond.append(dot, G_NAMES[Math.min(d.g, 5)]);

        card.append(date, cond);
        [
          ['Radio blackout', d.rMinor],
          ['Radiation storm', d.s],
        ].forEach(([label, value]) => {
          if (value === null) return;
          const row = document.createElement('div');
          row.className = 'fc-row';
          const name = document.createElement('span');
          name.textContent = label + ' chance';
          const pct = document.createElement('b');
          pct.textContent = value + '%';
          row.append(name, pct);
          card.appendChild(row);
        });
        daysEl.appendChild(card);
      });
    }
    paintArtKey();
  }

  // The artwork key slide: three cards, in the same style as the forecast
  // cards, showing what each part of the artwork is doing right now. A card
  // or row is skipped when its source isn't live, so the key never claims
  // "quiet" for data it doesn't have.
  function paintArtKey() {
    const box = document.getElementById('key-cards');
    if (!box) return;

    const sw = latestData && latestData.spaceWeather;
    const status = (latestData && latestData.sourceStatus) || {};
    const eventsLive = status.flares === 'live' && status.cmes === 'live';
    const cards = [];

    if (sw && (status.storms === 'live' || eventsLive)) {
      const rows = [];
      let value = null;
      if (status.storms === 'live') {
        const intensity = sw.geomagneticIntensity || 0;
        value = intensity < 0.15 ? 'Small & slow' : intensity < 0.6 ? 'Medium' : 'Long & fast';
        rows.push(['Storm peak', sw.kpIndex > 0 ? `Kp ${sw.kpIndex}` : 'None']);
      }
      if (eventsLive) rows.push(['Solar events', String(sw.flareCount + sw.cmeCount)]);
      cards.push({ label: 'Shooting stars', glyph: 'streak', value, rows });
    }
    if (sw && status.flares === 'live') {
      const strongest = strongestFlareClass(sw.flareIntensity);
      cards.push({
        label: 'Glowing core', glyph: 'core',
        value: strongest ? `${strongest} flare` : 'No flares',
        rows: [['Flares this week', String(sw.flareCount)]],
      });
    }
    if (status.neo === 'live' && latestData.asteroids) {
      const count = latestData.asteroids.length;
      const hazardous = latestData.asteroids.filter((a) => a.hazardous).length;
      cards.push({
        label: 'Orbiting dots', glyph: 'orbit',
        value: count === 0 ? 'None today' : plural(count, 'asteroid', 'asteroids'),
        rows: count === 0 ? [] : [['Potentially hazardous', String(hazardous), hazardous > 0]],
      });
    }

    box.textContent = '';
    if (cards.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'fc-empty';
      empty.textContent = 'Waiting for live data';
      box.appendChild(empty);
      return;
    }
    cards.forEach((c, i) => {
      const card = document.createElement('div');
      card.className = 'fc-day';
      card.style.setProperty('--i', i);

      const label = document.createElement('div');
      label.className = 'fc-date';
      label.textContent = c.label;
      card.appendChild(label);

      if (c.value) {
        const cond = document.createElement('div');
        cond.className = 'fc-cond';
        const glyph = document.createElement('span');
        glyph.className = 'key-glyph is-' + c.glyph;
        glyph.setAttribute('aria-hidden', 'true');
        cond.append(glyph, c.value);
        card.appendChild(cond);
      }

      c.rows.forEach(([name, value, warn]) => {
        const row = document.createElement('div');
        row.className = 'fc-row' + (warn ? ' is-warn' : '');
        const n = document.createElement('span');
        n.textContent = name;
        const v = document.createElement('b');
        v.textContent = value;
        row.append(n, v);
        card.appendChild(row);
      });
      box.appendChild(card);
    });
  }

  // ---------- unified NASA data (APOD, space weather, NEO) ----------

  const FALLBACK_DATA = {
    timestamp: null,
    sourceStatus: {
      neo: 'unavailable', flares: 'unavailable', cmes: 'unavailable',
      storms: 'unavailable', apod: 'unavailable',
    },
    spaceWeather: { flareCount: 0, flareIntensity: 0, cmeCount: 0, cmeSpeed: 0, geomagneticIntensity: 0, kpIndex: 0 },
    asteroids: [],
    apod: null,
  };

  let latestData = FALLBACK_DATA;

  // Smoothed, currently-displayed values feeding the artwork — these ease
  // toward latestData's numbers rather than jumping, so a data refresh
  // never looks abrupt.
  const shown = { flareIntensity: 0, geomagneticIntensity: 0 };

  function isAnyLive(sourceStatus) {
    return Object.values(sourceStatus).some((s) => s === 'live');
  }

  function updateStatus() {
    const live = isAnyLive(latestData.sourceStatus);
    statusEl.classList.toggle('is-live', live);
    statusText.textContent = live
      ? 'Live data connected.'
      : 'Live data unavailable — showing a quiet fallback state.';
  }

  let fetchInFlight = false;

  async function fetchData() {
    if (fetchInFlight) return; // guards against overlapping calls racing each other
    fetchInFlight = true;
    try {
      const res = await fetch('/api/nasa-data');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      latestData = data;
      rebuildOrbits(data.asteroids || []);
      renderAPOD(data.apod);
      renderSpaceWeatherSummary(data.spaceWeather);
      paintForecast();
    } catch (err) {
      // Keep whatever we last had (or the fallback) and just reflect the
      // degraded state in the status dot — the sign keeps running. Only
      // fall back the APOD image if we never had one to begin with.
      latestData = { ...latestData, sourceStatus: FALLBACK_DATA.sourceStatus };
      if (document.getElementById('oculus').classList.contains('is-loading')) {
        renderAPODError();
      }
      console.error('nasa-data fetch failed:', err);
    } finally {
      fetchInFlight = false;
    }
    updateStatus();
  }

  // ---------- Algorithm Art: scene state ----------

  let stars = [];
  let orbits = [];
  let fineParticles = [];

  // Verified against the --ink background (rgb(10,11,14)): all of these
  // clear 7.5:1, well past the 3:1 WCAG non-text contrast minimum.
  const palette = {
    core: [99, 179, 255],
    amber: [251, 191, 36],
    star: [250, 250, 255],
  };

  function mix(c1, c2, t) {
    return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
  }

  function rgba(c, a) {
    return `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${a})`;
  }

  function buildStars() {
    const count = Math.round((width * height) / 9000);
    const rand = makeRandom(42);
    stars = [];
    for (let i = 0; i < count; i++) {
      stars.push({
        x: rand() * width,
        y: rand() * height,
        r: (0.9 + rand() * 1.6) * ui,
        base: 0.5 + rand() * 0.5,
        phase: rand() * Math.PI * 2,
        speed: 0.15 + rand() * 0.25,
      });
    }
  }

  function coreCenter() {
    return { x: width * 0.44, y: height * 0.47 };
  }

  function rebuildOrbits(asteroids) {
    const maxRadius = Math.min(width, height) * 0.46;
    const minRadius = Math.min(width, height) * 0.14;

    const missDistances = asteroids.map((a) => a.missDistance).filter((v) => v > 0);
    const minMiss = missDistances.length ? Math.min(...missDistances) : 1;
    const maxMiss = missDistances.length ? Math.max(...missDistances) : 1;

    orbits = asteroids.map((a) => {
      const rand = makeRandom(hashString(a.id || a.name || String(Math.random())));
      const radius = a.missDistance > 0
        ? logMapRange(a.missDistance, Math.max(minMiss, 1), Math.max(maxMiss, minMiss + 1), minRadius, maxRadius)
        : lerp(minRadius, maxRadius, rand());
      const bodyRadius = a.diameter > 0 ? logMapRange(a.diameter, 5, 2000, 4, 11) * ui : 6 * ui;
      const angularSpeed = a.velocity > 0 ? mapRange(a.velocity, 3000, 120000, 0.05, 0.32) : 0.1;

      return {
        radius,
        eccentricity: 0.55 + rand() * 0.25,
        tilt: rand() * Math.PI,
        angle: rand() * Math.PI * 2,
        angularSpeed: angularSpeed * (rand() < 0.5 ? -1 : 1),
        bodyRadius,
        hazardous: Boolean(a.hazardous),
      };
    });
  }

  function makeFineParticle() {
    // A shooting star: a fixed diagonal heading and a brief straight streak
    // with a bright head and a fading tail, entering from an edge. Its size
    // is set by geomagnetic activity at draw time (see drawFineParticle);
    // sizeFactor is just per-particle organic variation around that.
    const angle = Math.PI * 0.15 + (Math.random() - 0.5) * 0.4;
    const fromLeft = Math.random() < 0.5;
    return {
      x: fromLeft ? -20 - Math.random() * width * 0.3 : Math.random() * width,
      y: fromLeft ? Math.random() * height * 0.6 : -20 - Math.random() * height * 0.3,
      angle,
      sizeFactor: 0.75 + Math.random() * 0.5,
      life: 0,
      maxLife: 45 + Math.random() * 35,
    };
  }

  function rebuildParticles() {
    fineParticles = [];
  }

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    ui = clamp(Math.min(width, height) / 500, 1.4, 3);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildStars();
    rebuildOrbits(latestData.asteroids || []);
    rebuildParticles();
  }

  // ---------- Algorithm Art: drawing ----------

  function drawBackdrop() {
    ctx.fillStyle = '#0a0b0e';
    ctx.fillRect(0, 0, width, height);
  }

  function drawStars(t) {
    for (const s of stars) {
      const twinkle = 0.7 + 0.3 * Math.sin(t * s.speed + s.phase);
      ctx.beginPath();
      ctx.fillStyle = rgba(palette.star, s.base * twinkle);
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawCore(t, center, elevated) {
    const intensity = shown.flareIntensity;
    const normalized = clamp(logMapRange(intensity, 1, 10000, 0, 1), 0, 1);
    const radius = mapRange(normalized, 0, 1, Math.min(width, height) * 0.06, Math.min(width, height) * 0.11);
    const brightness = mapRange(normalized, 0, 1, 0.4, 0.7);
    const breathe = 1 + Math.sin(t * 0.12) * 0.04;

    const color = elevated ? mix(palette.core, palette.amber, 0.22) : palette.core;
    const outerRadius = radius * breathe * 2.4;
    const gradient = ctx.createRadialGradient(
      center.x, center.y, 0,
      center.x, center.y, outerRadius
    );
    gradient.addColorStop(0, rgba(color, brightness));
    gradient.addColorStop(0.35, rgba(color, brightness * 0.45));
    gradient.addColorStop(0.7, rgba(color, brightness * 0.12));
    gradient.addColorStop(1, rgba(color, 0));

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(center.x, center.y, outerRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  function orbitPosition(orbit, center) {
    const x0 = Math.cos(orbit.angle) * orbit.radius;
    const y0 = Math.sin(orbit.angle) * orbit.radius * orbit.eccentricity;
    const cos = Math.cos(orbit.tilt);
    const sin = Math.sin(orbit.tilt);
    return {
      x: center.x + x0 * cos - y0 * sin,
      y: center.y + x0 * sin + y0 * cos,
    };
  }

  function drawOrbits(center, elevated) {
    for (const orbit of orbits) {
      ctx.save();
      ctx.translate(center.x, center.y);
      ctx.rotate(orbit.tilt);
      ctx.scale(1, orbit.eccentricity);
      ctx.beginPath();
      ctx.arc(0, 0, orbit.radius, 0, Math.PI * 2);
      ctx.strokeStyle = orbit.hazardous && elevated
        ? rgba(palette.amber, 0.5)
        : rgba(palette.star, 0.32);
      ctx.lineWidth = 3 * ui;
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawBodies(dt, center, elevated) {
    for (const orbit of orbits) {
      orbit.angle += orbit.angularSpeed * dt * (reduceMotion ? 0.15 : 1);
      const pos = orbitPosition(orbit, center);
      const color = orbit.hazardous ? mix(palette.amber, palette.core, elevated ? 0.25 : 0.5) : palette.core;
      const alpha = orbit.hazardous ? 0.85 : 0.75;

      const glow = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, orbit.bodyRadius * 2.6);
      glow.addColorStop(0, rgba(color, alpha));
      glow.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, orbit.bodyRadius * 2.6, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.fillStyle = rgba(color, Math.min(alpha + 0.25, 1));
      ctx.arc(pos.x, pos.y, orbit.bodyRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Shooting stars are a single fading tail segment, not a growing history
  // of points — cheap to draw, and their size/speed are recomputed live
  // from geomagnetic activity every frame rather than fixed at spawn, so
  // they visibly react as the Kp index eases toward a new value.

  function stepFineParticle(p, speed) {
    p.x += Math.cos(p.angle) * speed;
    p.y += Math.sin(p.angle) * speed;
    p.life++;
    return (
      p.life > p.maxLife || p.x < -60 || p.x > width + 60 || p.y < -60 || p.y > height + 60
    );
  }

  function drawFineParticle(p, elevated, geo) {
    const lifeFrac = p.life / p.maxLife;
    const fadeIn = Math.min(lifeFrac / 0.12, 1);
    const fadeOut = 1 - Math.max((lifeFrac - 0.75) / 0.25, 0);
    const alpha = Math.min(fadeIn, fadeOut);
    if (alpha <= 0) return;

    const length = mapRange(geo, 0, 1, 60, 200) * p.sizeFactor * ui;
    const dx = Math.cos(p.angle);
    const dy = Math.sin(p.angle);
    const tailX = p.x - dx * length;
    const tailY = p.y - dy * length;
    const color = elevated ? mix(palette.star, palette.amber, 0.3) : palette.star;

    const gradient = ctx.createLinearGradient(tailX, tailY, p.x, p.y);
    gradient.addColorStop(0, rgba(color, 0));
    gradient.addColorStop(1, rgba(color, alpha));
    ctx.strokeStyle = gradient;
    ctx.lineWidth = mapRange(geo, 0, 1, 2.5, 6) * ui;
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();

    ctx.beginPath();
    ctx.fillStyle = rgba(color, alpha);
    ctx.arc(p.x, p.y, mapRange(geo, 0, 1, 3, 6.5) * ui, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawParticles(elevated) {
    const geo = shown.geomagneticIntensity;
    const speed = mapRange(geo, 0, 1, 1.4, 5.5) * ui;

    const targetFine = Math.round(clamp(shown.eventDensity || 0, 4, 16));
    while (fineParticles.length < targetFine) fineParticles.push(makeFineParticle());
    while (fineParticles.length > targetFine) fineParticles.pop();

    for (let i = fineParticles.length - 1; i >= 0; i--) {
      const p = fineParticles[i];
      const dead = stepFineParticle(p, speed);
      drawFineParticle(p, elevated, geo);
      if (dead) fineParticles[i] = makeFineParticle();
    }
  }

  // ---------- Algorithm Art: animation loop ----------

  let lastTime = performance.now();
  let clock = 0;

  function frame(now) {
    const dtMs = clamp(now - lastTime, 0, 64);
    lastTime = now;
    const dt = dtMs / 16.6667;
    clock += dt * (reduceMotion ? 0.002 : 0.006);

    shown.flareIntensity = lerp(shown.flareIntensity, latestData.spaceWeather.flareIntensity, 0.01);
    shown.geomagneticIntensity = lerp(shown.geomagneticIntensity, latestData.spaceWeather.geomagneticIntensity, 0.01);
    const eventDensityTarget =
      latestData.spaceWeather.flareCount + latestData.spaceWeather.cmeCount + (latestData.spaceWeather.kpIndex > 0 ? 6 : 0);
    shown.eventDensity = lerp(shown.eventDensity || 0, mapRange(eventDensityTarget, 0, 30, 1, 16), 0.01);

    const elevated =
      latestData.spaceWeather.flareIntensity >= 1000 || latestData.spaceWeather.kpIndex >= 5;

    const center = coreCenter();

    drawBackdrop();
    drawStars(clock * 40);
    drawParticles(elevated);
    drawCore(clock * 40, center, elevated);
    drawOrbits(center, elevated);
    drawBodies(reduceMotion ? dt * 0.15 : dt, center, elevated);

    requestAnimationFrame(frame);
  }

  // ---------- slide cycle ----------
  //
  // Each slide holds for SLIDE_DWELL_MS, then the sign moves to the next one:
  // APOD photo → Cosmic Meteorology → Space Weather Forecast → EPIC Earth
  // image → Artwork key → Algorithm Art → back to APOD. Movement cuts in
  // early: when the camera (see startCameraMotion) sees a new visitor — motion
  // after a few seconds of stillness — the sign advances right away and the
  // timer restarts. Continuous movement doesn't skip screens. Mouse/touch/
  // keyboard activity counts as movement too, for desks and testing.

  const SLIDE_DWELL_MS = 15000; // every slide holds at least this long unless a visitor arrives
  const MODE_ORDER = ['apod', 'wx', 'forecast', 'epic', 'key', 'art'];
  let dwellTimer;
  let mode = 'apod';

  function advance() {
    mode = MODE_ORDER[(MODE_ORDER.indexOf(mode) + 1) % MODE_ORDER.length];
    document.body.classList.remove('mode-wx', 'mode-forecast', 'mode-key', 'mode-epic', 'mode-art');
    if (mode !== 'apod') document.body.classList.add('mode-' + mode);
    clearTimeout(dwellTimer);
    dwellTimer = setTimeout(advance, SLIDE_DWELL_MS);
  }

  function startSlideCycle() {
    ['mousemove', 'touchstart', 'touchmove', 'keydown', 'click', 'scroll'].forEach((evt) => {
      window.addEventListener(evt, onMotion, { passive: true });
    });
    dwellTimer = setTimeout(advance, SLIDE_DWELL_MS);
  }

  // ---------- camera motion ----------
  //
  // Frame differencing on a tiny downscaled copy of the webcam feed. Frames
  // are compared and thrown away in the browser — nothing is recorded or sent
  // anywhere. If the camera is missing or permission is denied, the sign just
  // keeps using the mouse/touch fallback above and the timer.

  const MOTION_SAMPLE_MS = 120;
  const MOTION_QUIET_MS = 3000; // stillness needed before movement counts as a new visitor
  const PIXEL_DELTA = 28; // per-pixel brightness change (0-255) that counts as "changed"
  const MOTION_MIN_FRACTION = 0.015; // share of pixels changed to count as movement
  const MOTION_MAX_FRACTION = 0.6; // above this it's a lighting/exposure shift, not a person
  const SAMPLE_W = 32;
  const SAMPLE_H = 24;

  let lastMotionAt = 0;

  function onMotion() {
    const now = performance.now();
    const isNewVisitor = now - lastMotionAt > MOTION_QUIET_MS;
    lastMotionAt = now;
    if (isNewVisitor) advance();
  }

  async function startCameraMotion() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 }, audio: false });
    } catch (err) {
      console.info('camera motion unavailable — using mouse/touch instead:', err && err.name);
      return;
    }

    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    try {
      await video.play();
    } catch (err) {
      return;
    }

    const sample = document.createElement('canvas');
    sample.width = SAMPLE_W;
    sample.height = SAMPLE_H;
    const sctx = sample.getContext('2d', { willReadFrequently: true });
    let previous = null;

    setInterval(() => {
      if (video.readyState < 2) return;
      sctx.drawImage(video, 0, 0, SAMPLE_W, SAMPLE_H);
      const { data } = sctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H);
      const current = new Uint8Array(SAMPLE_W * SAMPLE_H);
      for (let i = 0; i < current.length; i++) {
        current[i] = data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114;
      }
      if (previous) {
        let changed = 0;
        for (let i = 0; i < current.length; i++) {
          if (Math.abs(current[i] - previous[i]) > PIXEL_DELTA) changed++;
        }
        const fraction = changed / current.length;
        if (fraction >= MOTION_MIN_FRACTION && fraction <= MOTION_MAX_FRACTION) onMotion();
      }
      previous = current;
    }, MOTION_SAMPLE_MS);
  }

  // ---------- boot ----------

  window.addEventListener('resize', resize);
  resize();
  ctx.fillStyle = 'rgb(10, 11, 14)';
  ctx.fillRect(0, 0, width, height);

  loadEPIC();
  loadSolarWind();
  loadForecast();
  fetchData();
  setInterval(loadEPIC, REFRESH_MS);
  setInterval(loadSolarWind, WIND_REFRESH_MS);
  setInterval(loadForecast, FORECAST_REFRESH_MS);
  setInterval(fetchData, REFRESH_MS);
  startSlideCycle();
  startCameraMotion();

  requestAnimationFrame(frame);
})();
