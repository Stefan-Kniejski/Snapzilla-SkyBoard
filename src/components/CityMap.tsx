import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

const DefaultIcon = L.icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

const StartIcon = L.divIcon({
  className: 'city-marker city-marker--start',
  html: '<span aria-hidden="true">A</span>',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

const DestIcon = L.divIcon({
  className: 'city-marker city-marker--dest',
  html: '<span aria-hidden="true">B</span>',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

function FitTwoCities({
  startLat,
  startLon,
  destLat,
  destLon,
}: {
  startLat: number;
  startLon: number;
  destLat: number;
  destLon: number;
}) {
  const map = useMap();
  useEffect(() => {
    const b = L.latLngBounds(
      [startLat, startLon],
      [destLat, destLon]
    );
    map.fitBounds(b, { padding: [52, 52], maxZoom: 9 });
  }, [map, startLat, startLon, destLat, destLon]);
  return null;
}

type Props = {
  startLat: number;
  startLon: number;
  startLabel: string;
  destLat: number;
  destLon: number;
  destLabel: string;
};

export function CityMap({ startLat, startLon, startLabel, destLat, destLon, destLabel }: Props) {
  const midLat = (startLat + destLat) / 2;
  const midLon = (startLon + destLon) / 2;

  return (
    <MapContainer
      center={[midLat, midLon]}
      zoom={4}
      scrollWheelZoom
      style={{ height: '100%', width: '100%' }}
    >
      <FitTwoCities
        startLat={startLat}
        startLon={startLon}
        destLat={destLat}
        destLon={destLon}
      />
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Polyline
        positions={[
          [startLat, startLon],
          [destLat, destLon],
        ]}
        pathOptions={{
          color: '#38bdf8',
          weight: 2,
          opacity: 0.75,
          dashArray: '8 10',
        }}
      />
      <Marker position={[startLat, startLon]} icon={StartIcon}>
        <Popup>
          <strong>From</strong>
          <br />
          {startLabel}
        </Popup>
      </Marker>
      <Marker position={[destLat, destLon]} icon={DestIcon}>
        <Popup>
          <strong>To</strong>
          <br />
          {destLabel}
        </Popup>
      </Marker>
    </MapContainer>
  );
}
