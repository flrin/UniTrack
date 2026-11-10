import { useNow } from '../hooks/useNow'
import type { AttendanceStatus } from '../types/roster'
import type { ScheduleItem } from '../types/student'
import { getClassPhase, getTodaysClasses } from '../utils/classTime'
import type { ClassPhase } from '../utils/classTime'
import './ScheduleList.css'

type AttendanceLabel = AttendanceStatus | 'Missed'

const PHASE_CLASS: Record<ClassPhase, string> = {
  Waiting: 'status-waiting',
  'Tracking Active': 'status-active',
  Ended: 'status-ended',
}

const ATTENDANCE_CLASS: Record<AttendanceLabel, string> = {
  Pending: 'status-pending',
  Present: 'status-present',
  Missed: 'status-missed',
  'Left Early': 'status-missed',
}

// A class that ended without the backend ever recording attendance was missed.
function getAttendanceLabel(phase: ClassPhase, status: AttendanceStatus): AttendanceLabel {
  return phase === 'Ended' && status === 'Pending' ? 'Missed' : status
}

/**
 * Today's classes. There is deliberately no check-in or start control: each
 * class's phase follows the clock and attendance is reported by the heartbeat.
 */
export default function ScheduleList({ items }: { items: readonly ScheduleItem[] }) {
  const now = useNow()
  const todaysClasses = getTodaysClasses(items, now).sort(
    (a, b) => Date.parse(a.start_time) - Date.parse(b.start_time),
  )

  if (todaysClasses.length === 0) {
    return <p className="schedule-empty">No classes scheduled for today.</p>
  }

  return (
    <ul className="schedule-list">
      {todaysClasses.map((item) => {
        const phase = getClassPhase(item, now)
        const attendance = getAttendanceLabel(phase, item.status)

        return (
          <li className={`schedule-item ${PHASE_CLASS[phase]}`} key={item.class_id}>
            <div className="schedule-time">{item.time}</div>
            <div className="schedule-details">
              <div className="schedule-subject">{item.subject}</div>
              <div className="schedule-building">{item.building_name}</div>
            </div>
            <div className="schedule-statuses">
              <span className={`status-badge ${PHASE_CLASS[phase]}`}>
                {phase === 'Tracking Active' && (
                  <span aria-hidden="true" className="status-dot" />
                )}
                {phase}
              </span>
              <span className={`status-badge ${ATTENDANCE_CLASS[attendance]}`}>
                {attendance}
              </span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
