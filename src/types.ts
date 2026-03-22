export type GeocodeResult = {
  name: string;
  country: string;
  state: string | null;
  lat: number;
  lon: number;
};

export type WeatherCurrent = {
  name: string;
  dt: number;
  timezone: number;
  temp: number;
  feelsLike: number;
  humidity: number;
  pressure: number;
  windSpeed: number;
  windDeg?: number;
  clouds?: number;
  visibility?: number;
  rain1h: number | null;
  snow1h: number | null;
  description?: string;
  icon?: string;
  main?: string;
};

export type DailyForecast = {
  date: string;
  tempMin: number | null;
  tempMax: number | null;
  pop: number | null;
  windSpeed: number | null;
  humidity: number | null;
  icon?: string;
  description?: string;
};

export type WeatherBundle = {
  current: WeatherCurrent;
  daily: DailyForecast[];
  forecastNote: string | null;
};

export type FlightLeg = {
  flightIata: string | null;
  airline: string | null;
  airlineIata: string | null;
  depAirport: string | null;
  arrAirport: string | null;
  depScheduled: string | null;
  arrScheduled: string | null;
  durationMin: number | null;
  distanceKm: number | null;
  terminal: string | null;
  gate: string | null;
};

export type FlightJourney = {
  kind: 'nonstop' | 'connection' | 'origin_fallback' | 'gateway_direct';
  segments: FlightLeg[];
  layoverMins: number | null;
  layoverHub: string | null;
  totalDurationMin: number;
  distanceKm: number | null;
  firstDep: string | null;
  lastArr: string | null;
  isQuickest: boolean;
};

export type AirportHub = {
  name: string;
  iata: string;
  city: string | null;
  country: string;
  lat: number;
  lon: number;
  lookupNote?: string;
};

export type FlightsResponse = {
  departureAirport: AirportHub;
  arrivalAirport: AirportHub;
  flights: FlightJourney[];
  travelAdvice?: string | null;
  meta?: {
    flightStatusTried: string | null;
    rawCount: number;
    pairFilteredCount?: number;
    usFilteredCount: number;
    sameHub?: boolean;
    nonstopCount?: number;
    connectionCount?: number;
    layoverSearchUsed?: boolean;
    outboundRawCount?: number;
    inboundRawCount?: number;
    connectionCandidates?: number;
    fallbackDeparturesFromOrigin?: boolean;
    intendedDestinationIata?: string;
    isInternationalRoute?: boolean;
    internationalGatewayFallback?: boolean;
    gatewaysQueried?: string[];
  };
  disclaimer: string;
};
