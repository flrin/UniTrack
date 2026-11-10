import { useEffect, useMemo, useState } from 'react'
import AppHeader from '../components/AppHeader'
import MapView from '../components/MapView'
import ScheduleList from '../components/ScheduleList'
import WarningBanner from '../components/WarningBanner'
import { useAttendanceHeartbeat } from '../hooks/useAttendanceHeartbeat'
import { getStudentSchedule } from '../services/studentService'
import type { ScheduleItem, StudentConfig } from '../types/student'

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
  const { statuses, error: heartbeatError } = useAttendanceHeartbeat(schedule)

  useEffect(() => {
    let active = true
    void getStudentSchedule().then((items) => {
      if (active) setSchedule(items)
    })
    return () => {
      active = false
    }
  }, [])

  // Show the status the heartbeat last got back from the backend.
  const scheduleWithStatus = useMemo(
    () => schedule.map((item) => ({ ...item, status: statuses[item.class_id] ?? item.status })),
    [schedule, statuses],
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
        {heartbeatError && (
          <p className="error-message" role="alert">
            {heartbeatError.message}
          </p>
        )}
        <ScheduleList items={scheduleWithStatus} />
        {config.optionals.length > 0 && (
          <div className="selected-courses">
            <strong>Selected electives</strong>
            <p>{config.optionals.join(', ')}</p>
          </div>
        )}
      </section>
      <section className="dashboard-card map-card">
        <h2>Class building</h2>
        <p className="intro">Your location compared with the building for your next class.</p>
        <MapView
          targetLat={45.7489}
          targetLng={21.2087}
          userLat={45.7495}
          userLng={21.211}
        />
      </section>
    </main>
  )
}
