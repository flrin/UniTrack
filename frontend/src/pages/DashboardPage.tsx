import { useEffect, useMemo, useState } from 'react'
import AppHeader from '../components/AppHeader'
import LocationOverridePanel from '../components/LocationOverridePanel'
import MapView from '../components/MapView'
import ScheduleList from '../components/ScheduleList'
import WarningBanner from '../components/WarningBanner'
import { useAttendanceHeartbeat } from '../hooks/useAttendanceHeartbeat'
import { useNow } from '../hooks/useNow'
import { GeolocationError, type GeoPoint } from '../services/geolocationService'
import { getStudentSchedule } from '../services/studentService'
import type { ScheduleItem, StudentConfig } from '../types/student'
import { getActiveClasses, getRelevantClass } from '../utils/classTime'
import {
  buildBuildingPresets,
  findMatchingBuildingPreset,
  generateRandomClujLocation,
  type LocationOverrideState,
} from '../utils/locationOverride'

export default function DashboardPage({
  config,
  onEditConfig,
  onLogout,
}: {
  config: StudentConfig
  onEditConfig: () => void
  onLogout: () => void
}) {
  const [schedule, setSchedule] = useState<ScheduleItem[]>([])
  const [isLoadingSchedule, setIsLoadingSchedule] = useState(true)
  const [scheduleError, setScheduleError] = useState<Error | null>(null)
  const [overrideState, setOverrideState] = useState<LocationOverrideState>({
    mode: 'gps',
  })
  const now = useNow()

  const buildingPresets = useMemo(
    () => buildBuildingPresets(schedule),
    [schedule],
  )

  const locationOverride = useMemo<GeoPoint | null>(() => {
    if (overrideState.mode === 'gps') return null
    if (overrideState.mode === 'random-cluj') return overrideState.point
    const preset =
      buildingPresets.find((item) => item.id === overrideState.buildingId) ??
      buildingPresets[0]
    return preset ? { lat: preset.lat, lng: preset.lng } : null
  }, [overrideState, buildingPresets])

  const {
    statuses,
    location,
    lastCheckIns,
    error: heartbeatError,
  } = useAttendanceHeartbeat(schedule, { locationOverride })
  const optionalsKey = JSON.stringify(config.optionals)

  useEffect(() => {
    const controller = new AbortController()

    getStudentSchedule({ signal: controller.signal })
      .then((items) => {
        if (controller.signal.aborted) return
        setSchedule(items)
        setScheduleError(null)
        setIsLoadingSchedule(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setSchedule([])
        setScheduleError(err instanceof Error ? err : new Error(String(err)))
        setIsLoadingSchedule(false)
      })

    return () => {
      controller.abort()
    }
  }, [config.group, optionalsKey])

  // Show the status the heartbeat last got back from the backend.
  const scheduleWithStatus = useMemo(
    () => schedule.map((item) => ({ ...item, status: statuses[item.class_id] ?? item.status })),
    [schedule, statuses],
  )

  const relevantClass = useMemo(
    () => getRelevantClass(scheduleWithStatus, now),
    [scheduleWithStatus, now],
  )

  const hasActiveClass = useMemo(
    () => getActiveClasses(scheduleWithStatus, now).length > 0,
    [scheduleWithStatus, now],
  )

  const relevantLastCheckIn = relevantClass
    ? (lastCheckIns[relevantClass.class_id] ?? null)
    : null

  const visibleHeartbeatError =
    locationOverride && heartbeatError instanceof GeolocationError
      ? null
      : heartbeatError

  const defaultBuildingId =
    (relevantClass
      ? findMatchingBuildingPreset(buildingPresets, {
          lat: relevantClass.target_lat,
          lng: relevantClass.target_lng,
        })?.id
      : undefined) ??
    buildingPresets[0]?.id ??
    ''

  const selectedBuildingId =
    overrideState.mode === 'building'
      ? overrideState.buildingId
      : defaultBuildingId

  const handleSelectGps = () => {
    setOverrideState({ mode: 'gps' })
  }

  const handleSelectBuilding = (buildingId: string) => {
    setOverrideState({ mode: 'building', buildingId })
  }

  const handleRandomCluj = () => {
    const avoidPoints: GeoPoint[] = buildingPresets.map((item) => ({
      lat: item.lat,
      lng: item.lng,
    }))
    if (relevantClass) {
      avoidPoints.push({
        lat: relevantClass.target_lat,
        lng: relevantClass.target_lng,
      })
    }
    setOverrideState({
      mode: 'random-cluj',
      point: generateRandomClujLocation(avoidPoints),
    })
  }

  return (
    <main className="dashboard-page">
      <AppHeader group={config.group} onEditConfig={onEditConfig} onLogout={onLogout} />
      <WarningBanner />
      <section className="dashboard-card">
        <h2>Today&apos;s classes</h2>
        <p className="intro">
          Attendance is tracked automatically from your location while a class is running.
          There is nothing to press.
        </p>
        {scheduleError && (
          <p className="error-message" role="alert">
            {scheduleError.message}
          </p>
        )}
        {visibleHeartbeatError && (
          <p className="error-message" role="alert">
            {visibleHeartbeatError.message}
          </p>
        )}
        {isLoadingSchedule ? (
          <p className="schedule-empty">Loading your schedule…</p>
        ) : (
          !scheduleError && <ScheduleList items={scheduleWithStatus} />
        )}
        {config.optionals.length > 0 && (
          <div className="selected-courses">
            <strong>Selected electives</strong>
            <p>{config.optionals.join(', ')}</p>
          </div>
        )}
      </section>
      <LocationOverridePanel
        buildingPresets={buildingPresets}
        effectiveLocation={location}
        hasActiveClass={hasActiveClass}
        lastCheckIn={relevantLastCheckIn}
        mode={overrideState.mode}
        onRandomCluj={handleRandomCluj}
        onSelectBuilding={handleSelectBuilding}
        onSelectGps={handleSelectGps}
        relevantClass={relevantClass}
        selectedBuildingId={selectedBuildingId}
      />
      <section className="dashboard-card map-card">
        <h2>Class building</h2>
        <p className="intro">
          {relevantClass
            ? `${relevantClass.subject} — ${relevantClass.building_name}`
            : 'Your location compared with the building for your active or upcoming class.'}
        </p>
        {relevantClass ? (
          <>
            <MapView
              buildingName={relevantClass.building_name}
              isOverridden={locationOverride !== null}
              targetLat={relevantClass.target_lat}
              targetLng={relevantClass.target_lng}
              userLat={location?.lat}
              userLng={location?.lng}
            />
            {!location && (
              <p className="schedule-empty">
                Waiting for your GPS fix during an active class window.
              </p>
            )}
          </>
        ) : (
          <p className="schedule-empty">
            {scheduleError
              ? 'Schedule unavailable.'
              : isLoadingSchedule
                ? 'Loading class building coordinates…'
                : 'No scheduled class building to display.'}
          </p>
        )}
      </section>
    </main>
  )
}
