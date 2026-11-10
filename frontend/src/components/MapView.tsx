import L, { type LatLngTuple } from 'leaflet'
import { useEffect } from 'react'
import { Circle, MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

type MapViewProps = {
  targetLat: number
  targetLng: number
  userLat?: number | null
  userLng?: number | null
  buildingName?: string
  radius?: number
}

const userLocationIcon = L.divIcon({
  className: 'user-location-marker',
  html: '<span aria-hidden="true"></span>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
})

function MapCenterUpdater({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap()

  useEffect(() => {
    map.setView([lat, lng])
  }, [map, lat, lng])

  return null
}

export default function MapView({
  targetLat,
  targetLng,
  userLat,
  userLng,
  buildingName,
  radius = 100,
}: MapViewProps) {
  const targetPosition: LatLngTuple = [targetLat, targetLng]
  const hasUserLocation =
    typeof userLat === 'number' &&
    Number.isFinite(userLat) &&
    typeof userLng === 'number' &&
    Number.isFinite(userLng)
  const userPosition: LatLngTuple | null = hasUserLocation
    ? [userLat, userLng]
    : null

  return (
    <div className="map-view">
      <MapContainer center={targetPosition} zoom={16} scrollWheelZoom={false}>
        <MapCenterUpdater lat={targetLat} lng={targetLng} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Circle
          center={targetPosition}
          pathOptions={{ color: '#0284c7', fillColor: '#38bdf8', fillOpacity: 0.2 }}
          radius={radius}
        >
          <Popup>{buildingName ?? 'Class building'}</Popup>
        </Circle>
        {userPosition && (
          <Marker icon={userLocationIcon} position={userPosition}>
            <Popup>Your current location</Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  )
}
