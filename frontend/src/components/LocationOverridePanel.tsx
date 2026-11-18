import type { LastCheckInInfo } from '../hooks/useAttendanceHeartbeat'
import type { GeoPoint } from '../services/geolocationService'
import type { ScheduleItem } from '../types/student'
import {
  CAMPUS_RADIUS_METERS,
  calculateDistanceMeters,
  findMatchingBuildingPreset,
  formatCoordinates,
  formatDistanceMeters,
  type BuildingPreset,
  type LocationOverrideMode,
} from '../utils/locationOverride'
import './LocationOverridePanel.css'

type LocationOverridePanelProps = {
  mode: LocationOverrideMode
  buildingPresets: readonly BuildingPreset[]
  selectedBuildingId: string
  effectiveLocation: GeoPoint | null
  relevantClass: ScheduleItem | null
  lastCheckIn: LastCheckInInfo | null
  hasActiveClass: boolean
  onSelectGps: () => void
  onSelectBuilding: (buildingId: string) => void
  onRandomCluj: () => void
}

export default function LocationOverridePanel({
  mode,
  buildingPresets,
  selectedBuildingId,
  effectiveLocation,
  relevantClass,
  lastCheckIn,
  hasActiveClass,
  onSelectGps,
  onSelectBuilding,
  onRandomCluj,
}: LocationOverridePanelProps) {
  const relevantBuilding = relevantClass
    ? findMatchingBuildingPreset(buildingPresets, {
        lat: relevantClass.target_lat,
        lng: relevantClass.target_lng,
      })
    : null

  const defaultBuildingId =
    relevantBuilding?.id ?? buildingPresets[0]?.id ?? ''

  const distanceToTarget =
    effectiveLocation && relevantClass
      ? calculateDistanceMeters(effectiveLocation, {
          lat: relevantClass.target_lat,
          lng: relevantClass.target_lng,
        })
      : null

  const isInsideArea =
    distanceToTarget !== null && distanceToTarget <= CAMPUS_RADIUS_METERS

  return (
    <section
      aria-labelledby="location-override-title"
      className="dashboard-card override-card"
    >
      <div className="override-header">
        <h2 id="location-override-title">Location override</h2>
        <span
          className={`override-pill ${
            mode === 'gps' ? 'override-pill-gps' : 'override-pill-active'
          }`}
        >
          {mode === 'gps' ? 'Real device GPS' : 'Override active'}
        </span>
      </div>
      <p className="intro">
        Override the coordinates sent to the backend and displayed on the map to
        verify how the UI looks inside and outside the class area.
      </p>

      <div aria-label="Location source" className="override-mode-group" role="group">
        <button
          aria-pressed={mode === 'gps'}
          className={`override-mode-button ${mode === 'gps' ? 'selected' : ''}`}
          onClick={onSelectGps}
          type="button"
        >
          Device GPS
        </button>
        <button
          aria-pressed={mode === 'building'}
          className={`override-mode-button ${mode === 'building' ? 'selected' : ''}`}
          onClick={() => onSelectBuilding(selectedBuildingId || defaultBuildingId)}
          type="button"
        >
          Building location
        </button>
        <button
          aria-pressed={mode === 'random-cluj'}
          className={`override-mode-button ${mode === 'random-cluj' ? 'selected' : ''}`}
          onClick={onRandomCluj}
          type="button"
        >
          Random in Cluj
        </button>
      </div>

      {mode === 'building' && (
        <div className="override-controls">
          <label className="override-label" htmlFor="override-building-select">
            Campus building
          </label>
          <select
            className="override-select"
            id="override-building-select"
            onChange={(event) => onSelectBuilding(event.target.value)}
            value={selectedBuildingId || defaultBuildingId}
          >
            {buildingPresets.map((preset) => {
              const isCurrentClassBuilding = relevantBuilding?.id === preset.id
              return (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                  {isCurrentClassBuilding ? ' (current class)' : ''} (
                  {preset.lat.toFixed(4)}, {preset.lng.toFixed(4)})
                </option>
              )
            })}
          </select>
        </div>
      )}

      {mode === 'random-cluj' && effectiveLocation && (
        <div className="override-controls">
          <span className="override-label">Random Cluj-Napoca coordinates</span>
          <div className="override-random-row">
            <span className="override-coords-chip">
              {formatCoordinates(effectiveLocation)}
            </span>
            <button
              className="secondary-button"
              onClick={onRandomCluj}
              type="button"
            >
              New random location
            </button>
          </div>
        </div>
      )}

      <div className="override-status">
        <div className="override-status-row">
          <span className="override-status-label">Coordinates sent to backend</span>
          <span className="override-status-value">
            {effectiveLocation
              ? formatCoordinates(effectiveLocation)
              : 'Waiting for active class GPS fix'}
          </span>
        </div>

        {distanceToTarget !== null && relevantClass && (
          <div className="override-status-row">
            <span className="override-status-label">
              Area check ({relevantClass.building_name})
            </span>
            <span
              className={`status-badge ${
                isInsideArea ? 'status-present' : 'status-missed'
              }`}
            >
              {isInsideArea ? 'Inside area' : 'Outside area'} (
              {formatDistanceMeters(distanceToTarget)})
            </span>
          </div>
        )}

        {lastCheckIn ? (
          <div className="override-status-row">
            <span className="override-status-label">Last backend response</span>
            <span
              className={`status-badge ${
                lastCheckIn.response.status === 'Present'
                  ? 'status-present'
                  : lastCheckIn.response.status === 'Pending'
                    ? 'status-pending'
                    : 'status-missed'
              }`}
            >
              {lastCheckIn.response.status} (
              {formatDistanceMeters(lastCheckIn.response.distance_meters)})
            </span>
          </div>
        ) : (
          <p className="override-backend-note">
            {hasActiveClass
              ? 'Sending check-in heartbeat to backend…'
              : 'No class is currently active. The selected location is previewed on the map and will be sent automatically once a class window starts.'}
          </p>
        )}
      </div>

      {mode !== 'gps' && (
        <div className="override-actions">
          <button
            className="secondary-button"
            onClick={onSelectGps}
            type="button"
          >
            Reset to device GPS
          </button>
        </div>
      )}
    </section>
  )
}
