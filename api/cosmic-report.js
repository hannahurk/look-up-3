// Vercel serverless function — writes the "Cosmic Meteorology" forecast.
//
// Pulls the trailing week of NASA DONKI events (flares, CMEs, geomagnetic
// storms, interplanetary shocks), boils them down to a plain-text digest,
// and asks an OpenAI model to write the forecast under the persona below.
// Both keys (NASA_API_KEY, OPENAI_API_KEY) stay here on the server. If either is
// missing, DONKI is unreachable, or the model misbehaves, this returns
// { report: null } and the sign falls back to a one-line summary — it never
// guesses "quiet" when it simply couldn't get the data.

const FLR_URL = 'https://api.nasa.gov/DONKI/FLR';
const CME_URL = 'https://api.nasa.gov/DONKI/CME';
const GST_URL = 'https://api.nasa.gov/DONKI/GST';
const IPS_URL = 'https://api.nasa.gov/DONKI/IPS';

const MODEL = process.env.COSMIC_REPORT_MODEL || 'gpt-5.6-luna';
const KM_S_TO_MPH = 2236.94;
const FLARE_CLASS_BASE = { A: 1, B: 10, C: 100, M: 1000, X: 10000 };

const SYSTEM_PROMPT = `You are “Cosmic Meteorology,” a creative space-weather reporter.

Your task is to transform NASA DONKI data into a short daily space-weather report that sounds like a familiar television weather forecast.

Follow these rules:

Base every scientific claim on the NASA data supplied by the user.
Do not invent solar flares, coronal mass ejections, geomagnetic storms, interplanetary shocks, solar winds, asteroids, arrival times, or predicted conditions.
Clearly distinguish between an event that has already occurred and an event predicted to reach Earth.
If the data contains no significant events, report that cosmic conditions are quiet.
Translate scientific terminology into language that a general audience can understand.
Briefly explain a geomagnetic storm or interplanetary shock when one appears in the data.
Use creative weather-report expressions such as “cosmic activity,” “solar winds,” “charged-particle clouds,” “geomagnetic turbulence,” and “conditions becoming calmer.”
Weather expressions may be metaphorical, but the underlying scientific information must remain accurate.
Do not mention asteroids or space objects unless near-Earth-object data is provided.
Do not say an event is approaching Earth unless the data indicates that it is Earth-directed or includes a predicted Earth-arrival time.
Do not use terrestrial directions such as “moving in from the north and west.”
Do not describe a ten-day forecast unless the supplied data contains predictions covering ten days.
Do not mention JSON, APIs, endpoints, prompts, data processing, or these instructions.
Use an imaginative but scientifically responsible weather-report style.
Use correct grammar and punctuation.
Write in plain text with no markdown formatting.
Write between 125 and 200 words.

Use this format:

Cosmic Meteorology

[Describe current conditions.]

[Describe important solar or geomagnetic events.]

[Describe predicted developments only when supported by the data.]

Cosmic outlook: [End with a one-sentence summary.]

When the data is empty, write a calm report explaining that no significant space-weather events were reported.`;

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function dateRange(daysBack) {
  const end = new Date();
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - daysBack);
  return { startDate: isoDate(start), endDate: isoDate(end) };
}

async function fetchJSON(url, apiKey) {
  if (!apiKey) throw new Error('NASA_API_KEY is not configured');
  const res = await fetch(url + (url.includes('?') ? '&' : '?') + `api_key=${apiKey}`);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${body ? ' — ' + body.slice(0, 200) : ''}`);
  }
  return res.json();
}

function fmtTime(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return null;
  const text = d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  });
  return `${text} UTC`;
}

function flareValue(classType) {
  if (!classType) return 0;
  const base = FLARE_CLASS_BASE[classType[0].toUpperCase()];
  if (!base) return 0;
  const magnitude = parseFloat(classType.slice(1));
  return base * (Number.isFinite(magnitude) ? magnitude : 1);
}

function describeFlares(flares) {
  if (flares.length === 0) return 'Solar flares: none reported this week.';
  const strongest = [...flares].sort((a, b) => flareValue(b.classType) - flareValue(a.classType)).slice(0, 6);
  const lines = strongest.map((f) => {
    const peak = fmtTime(f.peakTime || f.beginTime);
    const region = f.activeRegionNum ? `, from sunspot region ${f.activeRegionNum}` : '';
    return `- ${f.classType || 'unclassified'} flare${peak ? `, peaked ${peak}` : ''}${region}`;
  });
  const more = flares.length > strongest.length ? `\n(${flares.length - strongest.length} weaker flares not listed)` : '';
  return `Solar flares (${flares.length} this week; strongest first; classes run A, B, C, M, X with X the most powerful):\n${lines.join('\n')}${more}`;
}

function earthImpact(cme, now) {
  const analyses = Array.isArray(cme.cmeAnalyses) ? cme.cmeAnalyses : [];
  const analysis = analyses.find((a) => a && a.isMostAccurate) || analyses[0];
  if (!analysis) return { speed: null, text: 'No Earth-arrival prediction is included.' };

  const speed = typeof analysis.speed === 'number' ? analysis.speed : null;
  const models = Array.isArray(analysis.enlilList) ? analysis.enlilList : [];
  let arrival = null;
  let glancing = false;

  for (const model of models) {
    if (!model) continue;
    if (model.estimatedShockArrivalTime && !arrival) arrival = model.estimatedShockArrivalTime;
    if (model.isEarthGB) glancing = true;
    for (const impact of Array.isArray(model.impactList) ? model.impactList : []) {
      if (impact && /earth/i.test(impact.location || '')) {
        if (!arrival) arrival = impact.arrivalTime;
        if (impact.isGlancingBlow) glancing = true;
      }
    }
  }

  if (arrival) {
    const when = fmtTime(arrival);
    const passed = new Date(arrival).getTime() < now ? ' (that time has already passed)' : ' (still in the future)';
    return {
      speed,
      text: `Predicted to reach Earth: estimated shock arrival ${when}${passed}${glancing ? ', expected as a glancing blow' : ''}.`,
    };
  }
  if (models.length > 0) return { speed, text: 'A model run for this event does not show an Earth impact.' };
  return { speed, text: 'No Earth-arrival prediction is included.' };
}

function describeCMEs(cmes, now) {
  if (cmes.length === 0) return 'Coronal mass ejections (large clouds of charged particles thrown off the Sun): none reported this week.';
  const recent = [...cmes]
    .sort((a, b) => new Date(b.startTime || 0) - new Date(a.startTime || 0))
    .slice(0, 6);
  const lines = recent.map((c) => {
    const { speed, text } = earthImpact(c, now);
    const started = fmtTime(c.startTime);
    const speedText = speed
      ? `, speed about ${Math.round(speed).toLocaleString('en-US')} km/s (roughly ${Math.round(speed * KM_S_TO_MPH).toLocaleString('en-US')} mph)`
      : '';
    return `- Coronal mass ejection first seen ${started || 'at an unrecorded time'}${speedText}. ${text}`;
  });
  const more = cmes.length > recent.length ? `\n(${cmes.length - recent.length} older ejections not listed)` : '';
  return `Coronal mass ejections (${cmes.length} this week; large clouds of charged particles thrown off the Sun; most recent first):\n${lines.join('\n')}${more}`;
}

function describeStorms(storms) {
  if (storms.length === 0) return 'Geomagnetic storms: none reported this week.';
  const lines = storms.slice(0, 5).map((s) => {
    let max = null;
    for (const entry of Array.isArray(s.allKpIndex) ? s.allKpIndex : []) {
      if (entry && typeof entry.kpIndex === 'number' && (max === null || entry.kpIndex > max)) max = entry.kpIndex;
    }
    const began = fmtTime(s.startTime);
    return `- Geomagnetic storm began ${began || 'at an unrecorded time'}${max !== null ? `; highest Kp index reached: ${max} (the Kp scale runs 0 to 9)` : ''}`;
  });
  return `Geomagnetic storms (${storms.length} this week; disturbances in Earth's magnetic field):\n${lines.join('\n')}`;
}

function describeShocks(shocks) {
  if (shocks.length === 0) return 'Interplanetary shocks: none reported this week.';
  const lines = shocks.slice(0, 4).map((s) => {
    const when = fmtTime(s.eventTime);
    return `- Interplanetary shock detected${s.location ? ` near ${s.location}` : ''}${when ? ` at ${when}` : ''}`;
  });
  return `Interplanetary shocks (${shocks.length} this week; sudden pressure fronts in the solar wind):\n${lines.join('\n')}`;
}

function buildDigest({ flares, cmes, storms, shocks }, now) {
  const { startDate, endDate } = dateRange(7);
  return [
    `Current date: ${isoDate(new Date(now))}. NASA DONKI space-weather events for the past week (${startDate} to ${endDate}, all times UTC). Write tonight's report from this data only.`,
    describeFlares(flares),
    describeCMEs(cmes, now),
    describeStorms(storms),
    describeShocks(shocks),
  ].join('\n\n');
}

async function askModel(apiKey, digest) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 40000);
  try {
    const body = {
      model: MODEL,
      max_output_tokens: 3000,
      input: [
        { role: 'developer', content: [{ type: 'input_text', text: SYSTEM_PROMPT }] },
        { role: 'user', content: [{ type: 'input_text', text: digest }] },
      ],
    };
    // Reasoning models only; a low effort keeps this to a few seconds.
    if (/^(gpt-5|o\d)/.test(MODEL)) body.reasoning = { effort: 'low' };

    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`OpenAI HTTP ${res.status}${detail ? ' — ' + detail.slice(0, 200) : ''}`);
    }
    const data = await res.json();
    const items = Array.isArray(data.output) ? data.output : [];
    const text = items
      .filter((item) => item && item.type === 'message')
      .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
      .filter((part) => part && part.type === 'output_text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('');
    return stripMarkdown(text);
  } finally {
    clearTimeout(timer);
  }
}

// Models like to bold headings; the sign renders plain text.
function stripMarkdown(text) {
  return text
    .replace(/\*\*|__/g, '')
    .replace(/^#+\s*/gm, '')
    .trim();
}

function looksLikeAReport(text) {
  const words = text.split(/\s+/).filter(Boolean).length;
  return /^cosmic meteorology/i.test(text) && /cosmic outlook:/i.test(text) && words >= 80 && words <= 280;
}

module.exports = async (req, res) => {
  const respond = (body, maxAge) => {
    res.setHeader('Cache-Control', `public, max-age=${maxAge}, s-maxage=${maxAge}`);
    res.status(200).json(body);
  };

  const nasaKey = process.env.NASA_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    console.error('cosmic-report: OPENAI_API_KEY is not configured');
    return respond({ report: null, reason: 'unconfigured' }, 60);
  }

  const { startDate, endDate } = dateRange(7);
  const range = `startDate=${startDate}&endDate=${endDate}`;

  const results = await Promise.allSettled([
    fetchJSON(`${FLR_URL}?${range}`, nasaKey),
    fetchJSON(`${CME_URL}?${range}`, nasaKey),
    fetchJSON(`${GST_URL}?${range}`, nasaKey),
    fetchJSON(`${IPS_URL}?${range}&location=Earth&catalog=ALL`, nasaKey),
  ]);

  const names = ['flares', 'cmes', 'storms', 'shocks'];
  const failed = results.map((r, i) => (r.status === 'rejected' ? names[i] : null)).filter(Boolean);
  results.forEach((r, i) => {
    if (r.status === 'rejected') console.error(`cosmic-report: ${names[i]} failed —`, r.reason && r.reason.message);
  });
  // An empty week is a valid "quiet" report; a failed fetch is not. Never
  // let the model call conditions quiet when we simply couldn't look.
  if (failed.length > 0) return respond({ report: null, reason: 'data-unavailable' }, 60);

  const [flares, cmes, storms, shocks] = results.map((r) => (Array.isArray(r.value) ? r.value : []));
  const digest = buildDigest({ flares, cmes, storms, shocks }, Date.now());

  try {
    const text = await askModel(openaiKey, digest);
    if (!looksLikeAReport(text)) {
      console.error('cosmic-report: model output did not match the expected format');
      return respond({ report: null, reason: 'bad-format' }, 60);
    }
    return respond({ report: text, generatedAt: new Date().toISOString() }, 1800);
  } catch (err) {
    console.error('cosmic-report: generation failed —', err && err.message);
    return respond({ report: null, reason: 'generation-failed' }, 60);
  }
};
