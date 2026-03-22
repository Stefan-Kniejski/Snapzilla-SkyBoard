import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { findNearestAirport } from './airportLookup.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8787;
const OPENWEATHER_KEY = process.env.OPENWEATHER_API_KEY;
const AVIATION_KEY = process.env.AVIATIONSTACK_ACCESS_KEY;

const app = express();
app.use(cors());
app.use(express.json());

function requireKeys(res) {
  if (!OPENWEATHER_KEY) {
    res.status(500).json({ error: 'Missing OPENWEATHER_API_KEY in .env' });
    return false;
  }
  return true;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseIsoMinutes(dep, arr) {
  const a = new Date(dep).getTime();
  const b = new Date(arr).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
  return Math.round((b - a) / 60000);
}

const US_AIRLINE_IATA = new Set([
  'AA',
  'UA',
  'DL',
  'WN',
  'B6',
  'AS',
  'F9',
  'NK',
  'HA',
  'G4',
  'SY',
  'MX',
  'XP',
]);

function airlineIsUs(f) {
  const code = String(f.airline?.country_code || '')
    .trim()
    .toUpperCase();
  const countryName = String(f.airline?.country_name || f.airline?.country || '').toLowerCase();
  const iata = String(f.airline?.iata || '')
    .trim()
    .toUpperCase();
  if (code === 'US' || code === 'USA') return true;
  if (countryName.includes('united states')) return true;
  if (iata && US_AIRLINE_IATA.has(iata)) return true;
  return false;
}

/** One segment from AviationStack flight object */
function legFromFlightApi(f) {
  const dep = f.departure?.scheduled || f.departure?.estimated;
  const arr = f.arrival?.scheduled || f.arrival?.estimated;
  const durationMin = dep && arr ? parseIsoMinutes(dep, arr) : null;
  if (durationMin == null || durationMin <= 0) return null;
  const dlat = parseFloat(f.departure?.latitude);
  const dlon = parseFloat(f.departure?.longitude);
  const alat = parseFloat(f.arrival?.latitude);
  const alon = parseFloat(f.arrival?.longitude);
  let distanceKm = null;
  if (
    Number.isFinite(dlat) &&
    Number.isFinite(dlon) &&
    Number.isFinite(alat) &&
    Number.isFinite(alon)
  ) {
    distanceKm = haversineKm(dlat, dlon, alat, alon);
  }
  return {
    flightIata: f.flight?.iata || f.flight?.number,
    airline: f.airline?.name,
    airlineIata: f.airline?.iata,
    depAirport: f.departure?.iata,
    arrAirport: f.arrival?.iata,
    depScheduled: dep,
    arrScheduled: arr,
    durationMin,
    distanceKm,
    terminal: f.arrival?.terminal,
    gate: f.arrival?.gate,
  };
}

const MIN_LAYOVER_MS = 40 * 60 * 1000;
const MAX_LAYOVER_MS = 16 * 60 * 60 * 1000;

/**
 * Pair outbound A→* legs with *→B legs at a common hub (one stop).
 */
function buildConnectingJourneys(outboundRaw, inboundRaw, depIata, arrIata) {
  const depU = String(depIata).toUpperCase();
  const arrU = String(arrIata).toUpperCase();

  const out = outboundRaw
    .filter(airlineIsUs)
    .map(legFromFlightApi)
    .filter(Boolean)
    .filter(
      (l) =>
        String(l.depAirport || '').toUpperCase() === depU &&
        String(l.arrAirport || '').toUpperCase() !== arrU
    );

  const inn = inboundRaw
    .filter(airlineIsUs)
    .map(legFromFlightApi)
    .filter(Boolean)
    .filter(
      (l) =>
        String(l.arrAirport || '').toUpperCase() === arrU &&
        String(l.depAirport || '').toUpperCase() !== depU
    );

  const arrFromA = new Set(
    out.map((l) => String(l.arrAirport || '').toUpperCase()).filter(Boolean)
  );
  const depToB = new Set(
    inn.map((l) => String(l.depAirport || '').toUpperCase()).filter(Boolean)
  );
  const hubs = [...arrFromA].filter(
    (h) => depToB.has(h) && h !== depU && h !== arrU
  );

  const candidates = [];
  for (const h of hubs) {
    const firsts = out.filter((l) => String(l.arrAirport || '').toUpperCase() === h);
    const seconds = inn.filter((l) => String(l.depAirport || '').toUpperCase() === h);
    for (const l1 of firsts) {
      for (const l2 of seconds) {
        const tArr = new Date(l1.arrScheduled).getTime();
        const tDep2 = new Date(l2.depScheduled).getTime();
        const tDep1 = new Date(l1.depScheduled).getTime();
        const tEnd = new Date(l2.arrScheduled).getTime();
        if (
          !Number.isFinite(tArr) ||
          !Number.isFinite(tDep2) ||
          !Number.isFinite(tDep1) ||
          !Number.isFinite(tEnd)
        ) {
          continue;
        }
        const layMs = tDep2 - tArr;
        if (layMs < MIN_LAYOVER_MS || layMs > MAX_LAYOVER_MS) continue;
        if (tDep2 <= tArr || tEnd <= tDep1) continue;
        const totalDurationMin = Math.round((tEnd - tDep1) / 60000);
        if (totalDurationMin <= 0) continue;
        const d1 = l1.distanceKm;
        const d2 = l2.distanceKm;
        const distanceKm =
          d1 != null && d2 != null ? Math.round((d1 + d2) * 10) / 10 : null;
        candidates.push({
          kind: 'connection',
          segments: [l1, l2],
          layoverMins: Math.round(layMs / 60000),
          layoverHub: h,
          totalDurationMin,
          distanceKm,
          firstDep: l1.depScheduled,
          lastArr: l2.arrScheduled,
        });
      }
    }
  }

  const seen = new Set();
  const unique = [];
  for (const j of candidates) {
    const k = `${j.segments[0].flightIata}|${j.segments[1].flightIata}|${j.segments[0].depScheduled}|${j.segments[1].depScheduled}`;
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(j);
  }
  unique.sort((a, b) => a.totalDurationMin - b.totalDurationMin);
  return unique;
}

/** U.S. hubs commonly used for long-haul to each country (not exhaustive). */
const US_GATEWAYS_BY_COUNTRY = {
  AR: ['MIA', 'ATL', 'IAH', 'EWR', 'DFW', 'JFK'],
  BR: ['MIA', 'ATL', 'IAH', 'EWR', 'MCO'],
  CL: ['MIA', 'ATL', 'IAH', 'DFW'],
  CO: ['MIA', 'ATL', 'IAH', 'FLL'],
  PE: ['MIA', 'ATL', 'IAH'],
  UY: ['MIA', 'EWR', 'ATL'],
  EC: ['MIA', 'ATL', 'IAH'],
  CA: ['JFK', 'EWR', 'ORD', 'DTW', 'BOS', 'SEA'],
  MX: ['DFW', 'IAH', 'ATL', 'MIA', 'LAX', 'DEN'],
  GB: ['JFK', 'EWR', 'BOS', 'IAD', 'ORD', 'ATL'],
  FR: ['JFK', 'EWR', 'ATL', 'BOS', 'IAD'],
  DE: ['JFK', 'EWR', 'ATL', 'ORD', 'IAD'],
  IT: ['JFK', 'EWR', 'ATL', 'BOS'],
  ES: ['JFK', 'EWR', 'MIA', 'ATL'],
  NL: ['JFK', 'EWR', 'ATL', 'BOS'],
  JP: ['LAX', 'SFO', 'SEA', 'JFK', 'EWR', 'ORD', 'DFW'],
  KR: ['LAX', 'SFO', 'SEA', 'JFK', 'ATL', 'DFW'],
  CN: ['LAX', 'SFO', 'SEA', 'JFK', 'ORD', 'DFW'],
  IN: ['JFK', 'EWR', 'ORD', 'SFO', 'ATL', 'IAH'],
  AU: ['LAX', 'SFO', 'DFW', 'IAH'],
  NZ: ['LAX', 'SFO'],
};

function getUsGatewaysForCountry(countryIso2) {
  const c = String(countryIso2 || '').toUpperCase();
  return US_GATEWAYS_BY_COUNTRY[c] || [
    'MIA',
    'ATL',
    'JFK',
    'EWR',
    'DFW',
    'IAH',
    'ORD',
    'LAX',
  ];
}

async function fetchGatewayDirectToDestination(userDepIata, arrIata, arrCountry) {
  const arrU = String(arrIata).toUpperCase();
  const userU = String(userDepIata).toUpperCase();
  const rawList = getUsGatewaysForCountry(arrCountry);
  const gateways = [...new Set(rawList.map((g) => String(g).toUpperCase()))].filter(
    (g) => g && g !== arrU && g !== userU
  );
  const toQuery = gateways.slice(0, 4);
  if (toQuery.length === 0) return { journeys: [], gatewaysQueried: [] };

  const results = await Promise.all(
    toQuery.map((dep_iata) =>
      fetchFlightsWithFilters({ dep_iata, arr_iata: arrU })
    )
  );

  const legs = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const g = toQuery[i];
    if (!r.ok) continue;
    for (const f of r.data || []) {
      if (!airlineIsUs(f)) continue;
      const leg = legFromFlightApi(f);
      if (!leg) continue;
      if (String(leg.depAirport || '').toUpperCase() !== g) continue;
      if (String(leg.arrAirport || '').toUpperCase() !== arrU) continue;
      legs.push(leg);
    }
  }

  const seen = new Set();
  const deduped = [];
  for (const l of legs) {
    const k = `${l.flightIata}|${l.depScheduled}|${l.arrScheduled}`;
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(l);
  }
  deduped.sort((a, b) => a.durationMin - b.durationMin);

  const journeys = deduped.slice(0, 10).map((leg) => ({
    kind: 'gateway_direct',
    segments: [leg],
    layoverMins: null,
    layoverHub: null,
    totalDurationMin: leg.durationMin,
    distanceKm: leg.distanceKm,
    firstDep: leg.depScheduled,
    lastArr: leg.arrScheduled,
  }));

  return { journeys, gatewaysQueried: toQuery };
}

/** Group OpenWeather 3-hour forecast into daily buckets (up to 7 days). */
function aggregateForecastDays(list) {
  const byDay = new Map();
  for (const item of list) {
    const day = item.dt_txt?.slice(0, 10);
    if (!day) continue;
    if (!byDay.has(day)) {
      byDay.set(day, {
        day,
        temps: [],
        pops: [],
        wind: [],
        humidity: [],
        icons: [],
        descriptions: [],
      });
    }
    const bucket = byDay.get(day);
    bucket.temps.push(item.main?.temp);
    bucket.pops.push(item.pop ?? 0);
    bucket.wind.push(item.wind?.speed ?? 0);
    bucket.humidity.push(item.main?.humidity ?? 0);
    if (item.weather?.[0]) {
      bucket.icons.push(item.weather[0].icon);
      bucket.descriptions.push(item.weather[0].description);
    }
  }
  const sortedDays = [...byDay.keys()].sort();
  const rows = sortedDays.slice(0, 7).map((day) => {
    const b = byDay.get(day);
    const temps = b.temps.filter((t) => typeof t === 'number');
    const minT = temps.length ? Math.min(...temps) : null;
    const maxT = temps.length ? Math.max(...temps) : null;
    const avg = (arr) =>
      arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null;
    const midIcon = b.icons[Math.floor(b.icons.length / 2)] ?? b.icons[0];
    const midDesc =
      b.descriptions[Math.floor(b.descriptions.length / 2)] ?? b.descriptions[0];
    return {
      date: day,
      tempMin: minT,
      tempMax: maxT,
      pop: avg(b.pops),
      windSpeed: avg(b.wind),
      humidity: avg(b.humidity),
      icon: midIcon,
      description: midDesc,
    };
  });
  return rows;
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

/** Geocode city name → lat, lon, labels */
app.get('/api/geocode', async (req, res) => {
  if (!requireKeys(res)) return;
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Missing q' });
  const url = new URL('https://api.openweathermap.org/geo/1.0/direct');
  url.searchParams.set('q', q);
  url.searchParams.set('limit', '1');
  url.searchParams.set('appid', OPENWEATHER_KEY);
  try {
    const r = await fetch(url);
    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({ error: data?.message || 'Geocode failed' });
    }
    if (!Array.isArray(data) || !data[0]) {
      return res.status(404).json({ error: 'City not found' });
    }
    const g = data[0];
    res.json({
      name: g.name,
      country: g.country,
      state: g.state ?? null,
      lat: g.lat,
      lon: g.lon,
    });
  } catch (e) {
    res.status(502).json({ error: String(e?.message || e) });
  }
});

/** Current weather + 5-day/3h forecast (aggregated to daily, up to 7 rows when data allows). */
app.get('/api/weather', async (req, res) => {
  if (!requireKeys(res)) return;
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: 'lat and lon required' });
  }
  const units = 'imperial';
  const base = 'https://api.openweathermap.org/data/2.5';
  try {
    const [curR, fcR] = await Promise.all([
      fetch(`${base}/weather?lat=${lat}&lon=${lon}&units=${units}&appid=${OPENWEATHER_KEY}`),
      fetch(`${base}/forecast?lat=${lat}&lon=${lon}&units=${units}&appid=${OPENWEATHER_KEY}`),
    ]);
    const current = await curR.json();
    const forecast = await fcR.json();
    if (!curR.ok) {
      return res.status(curR.status).json({ error: current?.message || 'Weather failed' });
    }
    if (!fcR.ok) {
      return res.status(fcR.status).json({ error: forecast?.message || 'Forecast failed' });
    }
    const daily = aggregateForecastDays(forecast.list || []);
    res.json({
      current: {
        name: current.name,
        dt: current.dt,
        timezone: current.timezone,
        temp: current.main?.temp,
        feelsLike: current.main?.feels_like,
        humidity: current.main?.humidity,
        pressure: current.main?.pressure,
        windSpeed: current.wind?.speed,
        windDeg: current.wind?.deg,
        clouds: current.clouds?.all,
        visibility: current.visibility,
        rain1h: current.rain?.['1h'] ?? null,
        snow1h: current.snow?.['1h'] ?? null,
        description: current.weather?.[0]?.description,
        icon: current.weather?.[0]?.icon,
        main: current.weather?.[0]?.main,
      },
      daily,
      forecastNote:
        daily.length < 7
          ? 'Daily outlook uses OpenWeather’s free 3-hour forecast; fewer than 7 future days may be available depending on time of request.'
          : null,
    });
  } catch (e) {
    res.status(502).json({ error: String(e?.message || e) });
  }
});

async function fetchFlightsWithFilters(filters) {
  const attempts = [null, 'scheduled', 'active'];
  for (const status of attempts) {
    const flightsUrl = new URL('https://api.aviationstack.com/v1/flights');
    flightsUrl.searchParams.set('access_key', AVIATION_KEY);
    flightsUrl.searchParams.set('limit', '100');
    for (const [key, val] of Object.entries(filters)) {
      if (val != null && val !== '') flightsUrl.searchParams.set(key, String(val));
    }
    if (status) flightsUrl.searchParams.set('flight_status', status);

    const flR = await fetch(flightsUrl);
    const flData = await flR.json();
    if (!flR.ok || flData.error) {
      return {
        ok: false,
        error: flData.error?.info || flData.error?.message || `Flights HTTP ${flR.status}`,
        code: flData.error?.code,
      };
    }
    const raw = flData.data || [];
    if (raw.length > 0) {
      return { ok: true, data: raw, flightStatusTried: status };
    }
  }
  return { ok: true, data: [], flightStatusTried: 'none' };
}

function hubNote(resolved, cityLabel) {
  const city = cityLabel || resolved.city || '';
  return `${resolved.name} (${resolved.iata}) — ~${resolved.distanceKm} km from ${city || 'search point'}`;
}

/** Start + destination hubs: nonstop A→B first, then 1-stop via hub if needed (40min–16h layover). */
app.get('/api/flights', async (req, res) => {
  if (!AVIATION_KEY) {
    return res.status(500).json({ error: 'Missing AVIATIONSTACK_ACCESS_KEY in .env' });
  }
  const depCity = String(req.query.depCity || '').trim();
  const depCountry = String(req.query.depCountry || '').trim();
  const depLat = Number(req.query.depLat);
  const depLon = Number(req.query.depLon);
  const arrCity = String(req.query.arrCity || '').trim();
  const arrCountry = String(req.query.arrCountry || '').trim();
  const arrLat = Number(req.query.arrLat);
  const arrLon = Number(req.query.arrLon);

  if (!Number.isFinite(depLat) || !Number.isFinite(depLon)) {
    return res.status(400).json({ error: 'Missing or invalid depLat / depLon' });
  }
  if (!Number.isFinite(arrLat) || !Number.isFinite(arrLon)) {
    return res.status(400).json({ error: 'Missing or invalid arrLat / arrLon' });
  }

  try {
    const depResolved = findNearestAirport(depLat, depLon, depCountry);
    const arrResolved = findNearestAirport(arrLat, arrLon, arrCountry);
    if (!depResolved?.iata) {
      return res.status(404).json({
        error:
          'Could not resolve a departure airport near your start city. Try a larger city nearby.',
      });
    }
    if (!arrResolved?.iata) {
      return res.status(404).json({
        error:
          'Could not resolve an arrival airport near your destination. Try a larger city nearby.',
      });
    }

    const depCountryU = String(depResolved.country || '').toUpperCase();
    const arrCountryU = String(arrResolved.country || '').toUpperCase();
    const isInternationalRoute = depCountryU !== arrCountryU;

    if (depResolved.iata === arrResolved.iata) {
      return res.json({
        departureAirport: {
          name: depResolved.name,
          iata: depResolved.iata,
          city: depResolved.city || depCity || null,
          country: depResolved.country,
          lat: depResolved.lat,
          lon: depResolved.lon,
          lookupNote: hubNote(depResolved, depCity),
        },
        arrivalAirport: {
          name: arrResolved.name,
          iata: arrResolved.iata,
          city: arrResolved.city || arrCity || null,
          country: arrResolved.country,
          lat: arrResolved.lat,
          lon: arrResolved.lon,
          lookupNote: hubNote(arrResolved, arrCity),
        },
        flights: [],
        travelAdvice: null,
        meta: {
          flightStatusTried: 'none',
          rawCount: 0,
          pairFilteredCount: 0,
          usFilteredCount: 0,
          sameHub: true,
          nonstopCount: 0,
          connectionCount: 0,
          layoverSearchUsed: false,
          isInternationalRoute: false,
        },
        disclaimer:
          'Ticket prices are not available from this API. Rows highlight the shortest total trip time only.',
      });
    }

    const nonstopResult = await fetchFlightsWithFilters({
      dep_iata: depResolved.iata,
      arr_iata: arrResolved.iata,
    });
    if (!nonstopResult.ok) {
      return res.status(502).json({
        error: nonstopResult.error || 'Flights request failed',
        aviationCode: nonstopResult.code,
      });
    }

    const rawNonstop = nonstopResult.data || [];
    const nonstopLegs = rawNonstop
      .filter(airlineIsUs)
      .map(legFromFlightApi)
      .filter(Boolean)
      .filter(
        (l) =>
          String(l.depAirport || '').toUpperCase() === depResolved.iata &&
          String(l.arrAirport || '').toUpperCase() === arrResolved.iata
      );
    nonstopLegs.sort((a, b) => a.durationMin - b.durationMin);

    const nonstopJourneys = nonstopLegs.slice(0, 10).map((leg) => ({
      kind: 'nonstop',
      segments: [leg],
      layoverMins: null,
      layoverHub: null,
      totalDurationMin: leg.durationMin,
      distanceKm: leg.distanceKm,
      firstDep: leg.depScheduled,
      lastArr: leg.arrScheduled,
    }));

    let layoverSearchUsed = false;
    let outboundRaw = [];
    let inboundRaw = [];
    let outboundRawCount = 0;
    let inboundRawCount = 0;
    let connectionCandidates = 0;

    const need = 10 - nonstopJourneys.length;
    const extraJourneys = [];
    if (need > 0) {
      const [outRes, inRes] = await Promise.all([
        fetchFlightsWithFilters({ dep_iata: depResolved.iata }),
        fetchFlightsWithFilters({ arr_iata: arrResolved.iata }),
      ]);
      layoverSearchUsed = true;
      if (outRes.ok) outboundRaw = outRes.data || [];
      if (inRes.ok) inboundRaw = inRes.data || [];
      outboundRawCount = outboundRaw.length;
      inboundRawCount = inboundRaw.length;
      if (outRes.ok && inRes.ok) {
        const built = buildConnectingJourneys(
          outboundRaw,
          inboundRaw,
          depResolved.iata,
          arrResolved.iata
        );
        connectionCandidates = built.length;
        extraJourneys.push(...built.slice(0, need));
      }
    }

    let all = [...nonstopJourneys, ...extraJourneys];
    let fallbackDeparturesFromOrigin = false;
    let internationalGatewayFallback = false;
    let gatewaysQueried = [];

    if (all.length === 0) {
      if (isInternationalRoute) {
        const gw = await fetchGatewayDirectToDestination(
          depResolved.iata,
          arrResolved.iata,
          arrResolved.country
        );
        gatewaysQueried = gw.gatewaysQueried || [];
        if (gw.journeys.length > 0) {
          all = gw.journeys;
          internationalGatewayFallback = true;
        }
      } else {
        if (outboundRaw.length === 0) {
          const outOnly = await fetchFlightsWithFilters({
            dep_iata: depResolved.iata,
          });
          if (outOnly.ok) {
            outboundRaw = outOnly.data || [];
            outboundRawCount = outboundRaw.length;
            layoverSearchUsed = true;
          }
        }
        const depU = String(depResolved.iata).toUpperCase();
        const fbLegs = outboundRaw
          .filter(airlineIsUs)
          .map(legFromFlightApi)
          .filter(Boolean)
          .filter((l) => String(l.depAirport || '').toUpperCase() === depU);
        fbLegs.sort(
          (a, b) =>
            new Date(a.depScheduled).getTime() - new Date(b.depScheduled).getTime()
        );
        all = fbLegs.slice(0, 10).map((leg) => ({
          kind: 'origin_fallback',
          segments: [leg],
          layoverMins: null,
          layoverHub: null,
          totalDurationMin: leg.durationMin,
          distanceKm: leg.distanceKm,
          firstDep: leg.depScheduled,
          lastArr: leg.arrScheduled,
        }));
        fallbackDeparturesFromOrigin = all.length > 0;
      }
    }

    const minDur =
      all.length > 0 ? Math.min(...all.map((j) => j.totalDurationMin)) : null;

    const flights = all.map((j) => ({
      ...j,
      isQuickest: minDur != null && j.totalDurationMin === minDur,
    }));

    const standardDisclaimer =
      'Fares are not available from this API. “Quickest” is the shortest total trip time. One-stop options use 40min–16h connections at the hub.';

    const fallbackDisclaimer =
      `No US-airline itinerary in the feed reached ${arrResolved.iata}. These rows are other US-airline flights leaving ${depResolved.iata} (nearest major hub to your start city). Destinations vary — verify routes with an airline or booking site. Fares are not available here.`;

    const destLabel = [arrCity, arrResolved.name].filter(Boolean)[0] || arrResolved.iata;
    const travelAdvice =
      all.length === 0 && isInternationalRoute
        ? `No US-airline flights to ${arrResolved.iata} appeared in this feed from ${depResolved.iata} or from the major U.S. gateways we checked (${gatewaysQueried.join(', ') || 'MIA, ATL, etc.'}). Travel to ${destLabel} (${arrResolved.country}) is long-haul. Try another gateway as your start city or check airline schedules.`
        : null;

    const gatewayDisclaimer = internationalGatewayFallback
      ? `No match from your start hub (${depResolved.iata}) appeared in the feed. These rows are US-airline nonstops to ${arrResolved.iata}, but each flight departs from the hub shown in that row (e.g. MIA, ATL)—not from ${depResolved.iata}. Plan your own connection to that hub; total door-to-door time is longer than the block time shown. Fares are not available here.`
        : null;

    const disclaimer = internationalGatewayFallback
      ? gatewayDisclaimer
      : travelAdvice
        ? 'Domestic-only alternate flights from your city are hidden for international searches; we instead query major U.S. gateways to your destination when possible.'
        : fallbackDeparturesFromOrigin
          ? fallbackDisclaimer
          : standardDisclaimer;

    res.json({
      departureAirport: {
        name: depResolved.name,
        iata: depResolved.iata,
        city: depResolved.city || depCity || null,
        country: depResolved.country,
        lat: depResolved.lat,
        lon: depResolved.lon,
        lookupNote: hubNote(depResolved, depCity),
      },
      arrivalAirport: {
        name: arrResolved.name,
        iata: arrResolved.iata,
        city: arrResolved.city || arrCity || null,
        country: arrResolved.country,
        lat: arrResolved.lat,
        lon: arrResolved.lon,
        lookupNote: hubNote(arrResolved, arrCity),
      },
      flights,
      travelAdvice,
      meta: {
        flightStatusTried: nonstopResult.flightStatusTried,
        rawCount: rawNonstop.length,
        pairFilteredCount: nonstopLegs.length,
        usFilteredCount: rawNonstop.filter(airlineIsUs).length,
        sameHub: false,
        nonstopCount: nonstopJourneys.length,
        connectionCount: extraJourneys.length,
        layoverSearchUsed,
        outboundRawCount: layoverSearchUsed ? outboundRawCount : undefined,
        inboundRawCount: layoverSearchUsed ? inboundRawCount : undefined,
        connectionCandidates,
        fallbackDeparturesFromOrigin,
        intendedDestinationIata: arrResolved.iata,
        isInternationalRoute,
        internationalGatewayFallback,
        gatewaysQueried:
          internationalGatewayFallback && gatewaysQueried.length
            ? gatewaysQueried
            : undefined,
      },
      disclaimer,
    });
  } catch (e) {
    res.status(502).json({ error: String(e?.message || e) });
  }
});

// Vercel runs the UI as static files and APIs via serverless (see api/server.js).
if (!process.env.VERCEL) {
  const distPath = path.join(__dirname, '../dist');
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(distPath, 'index.html'), (err) => {
        if (err) next();
      });
    });
  }

  app.listen(PORT, () => {
    console.log(`Snapzilla SkyBoard API on http://localhost:${PORT}`);
  });
}

export default app;
