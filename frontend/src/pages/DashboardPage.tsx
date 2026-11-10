import { useEffect, useMemo, useState } from 'react'
import AppHeader from '../components/AppHeader'
import MapView from '../components/MapView'
import ScheduleList from '../components/ScheduleList'
import WarningBanner from '../components/WarningBanner'
import { useAttendanceHeartbeat } from '../hooks/useAttendanceHeartbeat'
import { useNow } from '../hooks/useNow'
import { getStudentSchedule } from '../services/studentService'
import type { ScheduleItem, StudentConfig } from '../types/student'
import { getRelevantClass } from '../utils/classTime'

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
  const now = useNow()
  const { statuses, location, error: heartbeatError } = useAttendanceHeartbeat(schedule)
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
        {heartbeatError && (
          <p className="error-message" role="alert">
            {heartbeatError.message}
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
