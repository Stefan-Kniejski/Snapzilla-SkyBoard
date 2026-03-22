import { useCallback, useState, type FormEvent } from 'react';
import './App.css';
import { CityMap } from './components/CityMap';
import { ForecastChart } from './components/ForecastChart';
import type { FlightJourney, FlightsResponse, GeocodeResult, WeatherBundle } from './types';

function iconUrl(code?: string) {
  if (!code) return null;
  return `https://openweathermap.org/img/wn/${code}@2x.png`;
}

function formatDuration(min: number | null) {
  if (min == null || min <= 0) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

function formatTime(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function rowClass(j: FlightJourney) {
  if (j.isQuickest) return 'row-quickest';
  return '';
}

function journeyKey(j: FlightJourney) {
  return j.segments.map((s) => `${s.flightIata}-${s.depScheduled}-${s.arrScheduled}`).join('|');
}

function formatFlightCodes(j: FlightJourney) {
  return j.segments.map((s) => s.flightIata || '—').join(' → ');
}

function formatAirlines(j: FlightJourney) {
  const names = j.segments.map((s) => s.airline || '—');
  return [...new Set(names)].join(' · ');
}

function stopsLabel(j: FlightJourney, intendedDestIata?: string | null) {
  if (j.kind === 'gateway_direct') {
    const dep = j.segments[0]?.depAirport ?? '—';
    return `Nonstop from ${dep}`;
  }
  if (j.kind === 'origin_fallback') {
    const arr = j.segments[0]?.arrAirport ?? '—';
    return intendedDestIata
      ? `To ${arr} (not ${intendedDestIata})`
      : `To ${arr}`;
  }
  if (j.kind === 'nonstop') return 'Nonstop';
  if (j.layoverHub && j.layoverMins != null) {
    return `1 stop (${j.layoverHub}) · ${j.layoverMins}m layover`;
  }
  return '1 stop';
}

function formatCityLine(g: GeocodeResult) {
  return [g.name, g.state, g.country].filter(Boolean).join(', ');
}

export default function App() {
  const [startQuery, setStartQuery] = useState('');
  const [destQuery, setDestQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [geoStart, setGeoStart] = useState<GeocodeResult | null>(null);
  const [geoDest, setGeoDest] = useState<GeocodeResult | null>(null);
  const [weather, setWeather] = useState<WeatherBundle | null>(null);
  const [flights, setFlights] = useState<FlightsResponse | null>(null);

  const runSearch = useCallback(async () => {
    const from = startQuery.trim();
    const to = destQuery.trim();
    if (!from || !to) return;
    setLoading(true);
    setError(null);
    setGeoStart(null);
    setGeoDest(null);
    setWeather(null);
    setFlights(null);
    try {
      const [gFromRes, gToRes] = await Promise.all([
        fetch(`/api/geocode?q=${encodeURIComponent(from)}`),
        fetch(`/api/geocode?q=${encodeURIComponent(to)}`),
      ]);
      const gFromJson = await gFromRes.json();
      const gToJson = await gToRes.json();
      if (!gFromRes.ok) throw new Error(`Start city: ${gFromJson.error || 'Geocoding failed'}`);
      if (!gToRes.ok) throw new Error(`Destination: ${gToJson.error || 'Geocoding failed'}`);
      const gStart = gFromJson as GeocodeResult;
      const gDest = gToJson as GeocodeResult;
      setGeoStart(gStart);
      setGeoDest(gDest);

      const flightParams = new URLSearchParams({
        depLat: String(gStart.lat),
        depLon: String(gStart.lon),
        depCountry: gStart.country,
        depCity: gStart.name,
        arrLat: String(gDest.lat),
        arrLon: String(gDest.lon),
        arrCountry: gDest.country,
        arrCity: gDest.name,
      });

      const [wRes, fRes] = await Promise.all([
        fetch(`/api/weather?lat=${gDest.lat}&lon=${gDest.lon}`),
        fetch(`/api/flights?${flightParams.toString()}`),
      ]);
      const wJson = await wRes.json();
      if (!wRes.ok) throw new Error(wJson.error || 'Weather failed');
      setWeather(wJson as WeatherBundle);

      const fJson = await fRes.json();
      if (fRes.ok) setFlights(fJson as FlightsResponse);
      else {
        const detail = [fJson.error, fJson.aviationCode && `code ${fJson.aviationCode}`]
          .filter(Boolean)
          .join(' ');
        setError((prev) => [prev, detail || 'Flights unavailable'].filter(Boolean).join(' · '));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, [startQuery, destQuery]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void runSearch();
  };

  const startTitle = geoStart ? formatCityLine(geoStart) : null;
  const destTitle = geoDest ? formatCityLine(geoDest) : null;

  const wIcon = iconUrl(weather?.current.icon);

  const canSubmit = Boolean(startQuery.trim() && destQuery.trim());

  return (
    <div className="app">
      <header className="brand">
        <div>
          <h1>Snapzilla SkyBoard</h1>
          <span>
            Plan a trip: weather at your destination + US-airline flights between major hubs
            (OpenWeather & AviationStack)
          </span>
        </div>
      </header>

      <form className="search-form" onSubmit={onSubmit}>
        <div className="search-fields">
          <div className="field-group">
            <label htmlFor="start-city">From (start)</label>
            <input
              id="start-city"
              type="search"
              placeholder="e.g. Chicago, Denver"
              value={startQuery}
              onChange={(e) => setStartQuery(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="field-group">
            <label htmlFor="dest-city">To (destination)</label>
            <input
              id="dest-city"
              type="search"
              placeholder="e.g. Miami, London"
              value={destQuery}
              onChange={(e) => setDestQuery(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="search-actions">
            <button type="submit" disabled={loading || !canSubmit}>
              {loading ? 'Loading…' : 'Explore'}
            </button>
          </div>
        </div>
      </form>

      {error && <div className="error">{error}</div>}

      {geoStart && geoDest && weather && (
        <div className="grid">
          <section className="panel">
            <h2>Route map</h2>
            <div className="map-wrap">
              <CityMap
                startLat={geoStart.lat}
                startLon={geoStart.lon}
                startLabel={startTitle || geoStart.name}
                destLat={geoDest.lat}
                destLon={geoDest.lon}
                destLabel={destTitle || geoDest.name}
              />
            </div>
            <p className="note">
              <strong>A</strong> = start city center · <strong>B</strong> = destination city center · dashed line is a
              straight guide (not a real air route).
            </p>
          </section>

          <section className="panel">
            <h2>Destination weather — right now</h2>
            <p className="note" style={{ marginTop: 0, marginBottom: '0.65rem' }}>
              Forecasts are for <strong>{destTitle}</strong>.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              {wIcon && <img src={wIcon} alt="" width={72} height={72} />}
              <div>
                <div style={{ fontSize: '2rem', fontWeight: 700 }}>
                  {Math.round(weather.current.temp)}°F
                </div>
                <div style={{ color: 'var(--muted)' }}>
                  {weather.current.description} · feels like{' '}
                  {Math.round(weather.current.feelsLike)}°F
                </div>
              </div>
            </div>
            <div className="stats">
              <div className="stat">
                <span>Humidity</span>
                <strong>{weather.current.humidity}%</strong>
              </div>
              <div className="stat">
                <span>Wind</span>
                <strong>{Math.round(weather.current.windSpeed)} mph</strong>
              </div>
              <div className="stat">
                <span>Pressure</span>
                <strong>{weather.current.pressure} hPa</strong>
              </div>
              <div className="stat">
                <span>Clouds</span>
                <strong>{weather.current.clouds ?? '—'}%</strong>
              </div>
              <div className="stat">
                <span>Rain (1h)</span>
                <strong>
                  {weather.current.rain1h != null ? `${weather.current.rain1h} mm` : '—'}
                </strong>
              </div>
              <div className="stat">
                <span>Snow (1h)</span>
                <strong>
                  {weather.current.snow1h != null ? `${weather.current.snow1h} mm` : '—'}
                </strong>
              </div>
            </div>
          </section>

          <section className="panel" style={{ gridColumn: '1 / -1' }}>
            <h2>Daily outlook at destination (up to 7 days)</h2>
            {weather.forecastNote && <p className="note">{weather.forecastNote}</p>}
            {weather.daily.length > 0 ? (
              <ForecastChart daily={weather.daily} />
            ) : (
              <p className="empty">No forecast rows returned.</p>
            )}
          </section>

          <section className="panel" style={{ gridColumn: '1 / -1' }}>
            <h2>
              {flights?.meta?.internationalGatewayFallback && flights.flights.length > 0
                ? `US-airline flights to ${flights.arrivalAirport.iata} (major U.S. gateways)`
                : flights?.travelAdvice && flights.flights.length === 0
                  ? `Flights — no matches in feed (${flights.departureAirport.iata} → ${flights.arrivalAirport.iata})`
                  : flights?.meta?.fallbackDeparturesFromOrigin
                    ? `US-airline departures from ${flights.departureAirport.iata} (start hub)`
                    : 'Top 10 US-airline options (nonstop first, then 1-stop)'}
            </h2>
            {!flights && (
              <p className="empty">Flight data did not load — check AviationStack key and quota.</p>
            )}
            {flights && (
              <>
                {flights.meta?.internationalGatewayFallback && flights.flights.length > 0 ? (
                  <div className="callout callout-gateway">
                    <p style={{ margin: 0 }}>
                      Nothing from your start hub <strong>{flights.departureAirport.iata}</strong> to{' '}
                      <strong>{flights.arrivalAirport.iata}</strong> showed up in the feed. Below are US-airline
                      nonstops that land at <strong>{flights.arrivalAirport.iata}</strong> but leave from other U.S.
                      hubs we checked
                      {flights.meta.gatewaysQueried?.length
                        ? ` (${flights.meta.gatewaysQueried.join(', ')})`
                        : ''}
                      . <strong>Total time</strong> is only that long-haul segment—you still need a way to reach the
                      departure hub.
                    </p>
                    <p className="note" style={{ margin: '0.65rem 0 0' }}>
                      {flights.disclaimer}
                    </p>
                  </div>
                ) : flights.travelAdvice ? (
                  <div className="callout callout-international">
                    <p style={{ margin: 0 }}>{flights.travelAdvice}</p>
                    <p className="note" style={{ margin: '0.65rem 0 0' }}>
                      {flights.disclaimer}
                    </p>
                  </div>
                ) : flights.meta?.fallbackDeparturesFromOrigin ? (
                  <div className="callout callout-fallback">
                    <p style={{ margin: 0 }}>
                      No US-airline nonstop or one-stop match was found for{' '}
                      <strong>
                        {flights.departureAirport.iata} → {flights.arrivalAirport.iata}
                      </strong>
                      . Below are up to <strong>10 US-airline flights leaving {flights.departureAirport.iata}</strong>{' '}
                      (nearest major hub to your start city). Each row’s <strong>To</strong> column is that flight’s
                      actual destination — these are <strong>not</strong> guaranteed to reach{' '}
                      {flights.arrivalAirport.iata}.
                    </p>
                    <p className="note" style={{ margin: '0.65rem 0 0' }}>
                      {flights.disclaimer}
                    </p>
                  </div>
                ) : (
                  <p className="note">
                    Nonstop rows are <strong>{flights.departureAirport.iata}</strong> →{' '}
                    <strong>{flights.arrivalAirport.iata}</strong>. One-stop rows start at{' '}
                    <strong>{flights.departureAirport.iata}</strong>, connect at a US hub, and end at{' '}
                    <strong>{flights.arrivalAirport.iata}</strong> (40 min–16 hr connection). {flights.disclaimer}
                  </p>
                )}
                {flights.meta?.sameHub && (
                  <p className="note" style={{ marginTop: '0.35rem' }}>
                    Start and destination resolve to the same major airport — there is no separate city-pair route.
                    Choose cities farther apart.
                  </p>
                )}
                <p className="note" style={{ marginTop: '0.35rem' }}>
                  <strong>Departure hub:</strong> {flights.departureAirport.lookupNote}
                  <br />
                  <strong>Destination hub (your “to” city):</strong> {flights.arrivalAirport.lookupNote}
                </p>
                {flights.flights.length > 0 && (
                  <div className="legend">
                    <span>
                      <span
                        className="dot-quick"
                        style={{
                          display: 'inline-block',
                          width: 10,
                          height: 10,
                          borderRadius: 2,
                          background: 'var(--good)',
                          marginRight: 6,
                        }}
                      />
                      <strong>Quickest</strong> —{' '}
                      {flights.meta?.internationalGatewayFallback
                        ? 'shortest long-haul block time among listed gateway departures (not door-to-door from your start city).'
                        : flights.meta?.fallbackDeparturesFromOrigin
                          ? 'shortest block time among these departures from your start hub.'
                          : 'shortest total trip time (first takeoff → final landing).'}{' '}
                      Fares are not provided by the flight data API.
                    </span>
                  </div>
                )}
                {flights.meta?.sameHub ? (
                  <p className="empty">No flights to list for identical start and destination hubs.</p>
                ) : flights.flights.length === 0 && flights.travelAdvice ? null : flights.flights.length === 0 ? (
                  <p className="empty">
                    No US-airline flights appeared in the feed departing{' '}
                    <strong>{flights.departureAirport.iata}</strong>. Try a larger origin city, another destination, or
                    check your AviationStack quota.
                    {flights.meta?.layoverSearchUsed ? (
                      <>
                        {' '}
                        (Feeds checked: {flights.meta.outboundRawCount ?? 0} outbound /{' '}
                        {flights.meta.inboundRawCount ?? 0} inbound raw rows; {flights.meta.connectionCandidates ?? 0}{' '}
                        hub-pair candidates.)
                      </>
                    ) : null}
                  </p>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="flights-table">
                      <thead>
                        <tr>
                          <th>Flights</th>
                          <th>Airline(s)</th>
                          <th>Stops</th>
                          <th>Depart</th>
                          <th>Arrive</th>
                          <th>Total time</th>
                          <th>Total mi</th>
                        </tr>
                      </thead>
                      <tbody>
                        {flights.flights.map((j) => (
                          <tr key={journeyKey(j)} className={rowClass(j)}>
                            <td className="td-flights">
                              <span className="flight-id">{formatFlightCodes(j)}</span>
                              {j.isQuickest ? <span className="tag tag-quick">Quickest</span> : null}
                            </td>
                            <td>{formatAirlines(j)}</td>
                            <td>{stopsLabel(j, flights.meta?.intendedDestinationIata)}</td>
                            <td>{formatTime(j.firstDep)}</td>
                            <td>{formatTime(j.lastArr)}</td>
                            <td>{formatDuration(j.totalDurationMin)}</td>
                            <td>
                              {j.distanceKm != null
                                ? `${Math.round(j.distanceKm * 0.621371)} mi`
                                : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
