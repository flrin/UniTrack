import { useEffect, useState } from 'react'
import MapView from '../components/MapView'
import { getStudentSchedule } from '../services/studentService'
import type { ScheduleItem, StudentConfig } from '../types/student'

export default function DashboardPage({
  config,
  onEditConfig,
}: {
  config: StudentConfig
  onEditConfig: () => void
}) {
  const [schedule, setSchedule] = useState<ScheduleItem[]>([])

  useEffect(() => {
    let active = true
    void getStudentSchedule().then((items) => {
      if (active) setSchedule(items)
    })
    return () => {
      active = false
    }
  }, [])

  return (
    <main className="dashboard-page">
      <header className="dashboard-header">
        <div>
          <div className="eyebrow">UniTrack</div>
          <h1>Your schedule</h1>
          <p>Group {config.group}</p>
        </div>
        <button className="secondary-button" onClick={onEditConfig} type="button">
          Edit configuration
        </button>
      </header>
      <section className="dashboard-card">
        <h2>{schedule.length ? 'Upcoming classes' : 'Your schedule is ready'}</h2>
        <p className="intro">
          {schedule.length
            ? 'Your classes are filtered for your subgroup and electives.'
            : 'No classes are available yet. Your selected courses will appear here.'}
        </p>
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
