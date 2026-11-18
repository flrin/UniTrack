import type { GeoPoint } from '../services/geolocationService'
import type { ScheduleItem } from '../types/student'

/** Attendance geofence radius used by the backend and map circle. */
export const CAMPUS_RADIUS_METERS = 100

/** Approximate urban bounding box for Cluj-Napoca. */
export const CLUJ_BOUNDS = {
  minLat: 46.745,
  maxLat: 46.79,
  minLng: 23.545,
  maxLng: 23.645,
} as const

export type BuildingPreset = {
  id: string
  name: string
  lat: number
  lng: number
  fromSchedule?: boolean
}

export type LocationOverrideMode = 'gps' | 'building' | 'random-cluj'

export type LocationOverrideState =
  | { mode: 'gps' }
  | { mode: 'building'; buildingId: string }
  | { mode: 'random-cluj'; point: GeoPoint }

/**
 * Known campus building coordinates matching the backend scraper's geocoding
 * presets (`backend/scraper.py`).
 */
export const CAMPUS_BUILDING_PRESETS: readonly BuildingPreset[] = [
  { id: 'centrala-ubb', name: 'Cladirea Centrala UBB', lat: 46.7679, lng: 23.5898 },
  { id: 'fsega', name: 'Cladirea FSEGA', lat: 46.7732, lng: 23.6236 },
  { id: 'mathematica', name: 'Cladirea Mathematica', lat: 46.7766, lng: 23.5938 },
  { id: 'cantemir', name: 'Univ Dimitrie Cantemir', lat: 46.5743, lng: 23.7841 },
  { id: 'avram-iancu', name: 'Cladirea Avram Iancu', lat: 46.7672, lng: 23.5912 },
  { id: 'ntt-data', name: 'NTT Data', lat: 46.7745, lng: 23.593 },
  { id: 'litere', name: 'Facultatea de Litere', lat: 46.7801, lng: 23.5857 },
  { id: 'observator', name: 'Observatorul Astronomic', lat: 46.7584, lng: 23.5907 },
  { id: 'chimie', name: 'Facultatea de Chimie', lat: 46.7663, lng: 23.5828 },
  { id: 'sociologie', name: 'Facultatea de Sociologie', lat: 46.7725, lng: 23.5985 },
  { id: 'ioan-bob', name: 'Scoala Gimnaziala Ioan Bob', lat: 46.769, lng: 23.588 },
  { id: 'codespring', name: 'Sediul Codespring', lat: 46.7712, lng: 23.6015 },
  { id: 'mhp', name: 'Sediul MHP', lat: 46.771, lng: 23.602 },
]

const EARTH_RADIUS_METERS = 6_371_000

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

/** Haversine distance in metres, matching `backend/utils.py::calculate_distance`. */
export function calculateDistanceMeters(a: GeoPoint, b: GeoPoint): number {
  const phi1 = toRadians(a.lat)
  const phi2 = toRadians(b.lat)
  const dPhi = toRadians(b.lat - a.lat)
  const dLambda = toRadians(b.lng - a.lng)

  const h =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

function coordKey(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`
}

export function findMatchingBuildingPreset(
  presets: readonly BuildingPreset[],
  point: GeoPoint,
): BuildingPreset | null {
  const key = coordKey(point.lat, point.lng)
  const exact = presets.find((preset) => coordKey(preset.lat, preset.lng) === key)
  if (exact) return exact

  return (
    presets.find((preset) => calculateDistanceMeters(preset, point) <= 15) ?? null
  )
}

/**
 * Combines unique coordinates from the student's loaded schedule with the
 * known UBB campus buildings so the user can always test both inside and
 * outside their scheduled class buildings.
 */
export function buildBuildingPresets(
  schedule: readonly ScheduleItem[],
): BuildingPreset[] {
  const knownByCoord = new Map<string, BuildingPreset>()
  for (const preset of CAMPUS_BUILDING_PRESETS) {
    knownByCoord.set(coordKey(preset.lat, preset.lng), { ...preset })
  }

  const schedulePresets: BuildingPreset[] = []
  const seenScheduleCoords = new Set<string>()

  for (const item of schedule) {
    const key = coordKey(item.target_lat, item.target_lng)
    if (seenScheduleCoords.has(key)) continue
    seenScheduleCoords.add(key)

    const known = knownByCoord.get(key)
    if (known) {
      known.fromSchedule = true
      schedulePresets.push(known)
    } else {
      schedulePresets.push({
        id: `schedule-${key}`,
        name: item.building_name,
        lat: item.target_lat,
        lng: item.target_lng,
        fromSchedule: true,
      })
    }
  }

  const remainingPresets = CAMPUS_BUILDING_PRESETS.filter(
    (preset) => !seenScheduleCoords.has(coordKey(preset.lat, preset.lng)),
  ).map((preset) => ({ ...preset }))

  return [...schedulePresets, ...remainingPresets]
}

function roundCoord(value: number): number {
  return Number(value.toFixed(6))
}

/**
 * Generates a random coordinate inside Cluj-Napoca, preferring locations at
 * least `minDistanceMeters` away from `avoidPoints` so random points reliably
 * represent being outside the target geofence.
 */
export function generateRandomClujLocation(
  avoidPoints: readonly GeoPoint[] = [],
  minDistanceMeters = 200,
  randomFn: () => number = Math.random,
): GeoPoint {
  const latSpan = CLUJ_BOUNDS.maxLat - CLUJ_BOUNDS.minLat
  const lngSpan = CLUJ_BOUNDS.maxLng - CLUJ_BOUNDS.minLng

  let fallback: GeoPoint = {
    lat: roundCoord(CLUJ_BOUNDS.minLat + randomFn() * latSpan),
    lng: roundCoord(CLUJ_BOUNDS.minLng + randomFn() * lngSpan),
  }

  for (let attempt = 0; attempt < 25; attempt += 1) {
    const candidate: GeoPoint = {
      lat: roundCoord(CLUJ_BOUNDS.minLat + randomFn() * latSpan),
      lng: roundCoord(CLUJ_BOUNDS.minLng + randomFn() * lngSpan),
    }
    fallback = candidate

    const farFromAll = avoidPoints.every(
      (point) => calculateDistanceMeters(candidate, point) >= minDistanceMeters,
    )
    if (farFromAll) return candidate
  }

  return fallback
}

export function formatCoordinates(point: GeoPoint): string {
  return `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`
}

export function formatDistanceMeters(meters: number): string {
  return `${Math.round(meters).toLocaleString('en-US')} m`
}
