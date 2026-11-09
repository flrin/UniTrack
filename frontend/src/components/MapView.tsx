import L, { type LatLngTuple } from 'leaflet'
import { Circle, MapContainer, Marker, Popup, TileLayer } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

type MapViewProps = {
  targetLat: number
  targetLng: number
  userLat: number
  userLng: number
  radius?: number
}

const userLocationIcon = L.divIcon({
  className: 'user-location-marker',
  html: '<span aria-hidden="true"></span>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
})

export default function MapView({
  targetLat,
  targetLng,
  userLat,
  userLng,
  radius = 100,
}: MapViewProps) {
  const targetPosition: LatLngTuple = [targetLat, targetLng]
  const userPosition: LatLngTuple = [userLat, userLng]

  return (
    <div className="map-view">
      <MapContainer center={targetPosition} zoom={16} scrollWheelZoom={false}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Circle
          center={targetPosition}
          pathOptions={{ color: '#0284c7', fillColor: '#38bdf8', fillOpacity: 0.2 }}
          radius={radius}
        >
          <Popup>Class building</Popup>
        </Circle>
        <Marker icon={userLocationIcon} position={userPosition}>
          <Popup>Your current location</Popup>
        </Marker>
      </MapContainer>
    </div>
  )
}
