/**
 * Nearest major airport for lat/lon. AviationStack free plans cannot use
 * GET /v1/airports?search= (paid-only); we map from OpenWeather coordinates instead.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

let _cache;
function loadAirports() {
  if (_cache) return _cache;
  const raw = readFileSync(path.join(__dirname, 'data', 'major-airports.json'), 'utf8');
  _cache = JSON.parse(raw);
  return _cache;
}

/**
 * @param {number} lat
 * @param {number} lon
 * @param {string} countryIso2 OpenWeather country code (e.g. US, GB)
 * @returns {{ iata: string, name: string, city?: string, country: string, lat: number, lon: number } | null}
 */
export function findNearestAirport(lat, lon, countryIso2) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const cc = String(countryIso2 || '').trim().toUpperCase();
  const airports = loadAirports();

  const inCountry = airports.filter((a) => a.country === cc);
  const pool =
    inCountry.length > 0
      ? inCountry
      : airports;

  let best = null;
  let bestD = Infinity;
  for (const a of pool) {
    const d = haversineKm(lat, lon, a.lat, a.lon);
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }

  if (!best) return null;

  if (inCountry.length > 0 && bestD > 420) {
    let gBest = null;
    let gD = Infinity;
    for (const a of airports) {
      const d = haversineKm(lat, lon, a.lat, a.lon);
      if (d < gD) {
        gD = d;
        gBest = a;
      }
    }
    if (gBest && gD < bestD) {
      best = gBest;
      bestD = gD;
    }
  }

  return {
    iata: best.iata,
    name: best.name,
    city: best.city,
    country: best.country,
    lat: best.lat,
    lon: best.lon,
    distanceKm: Math.round(bestD),
  };
}
