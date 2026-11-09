import { useEffect, useRef, useState } from 'react'
import { createHeartbeatManager } from '../services/heartbeatService'
import type { HeartbeatManager } from '../services/heartbeatService'
import type { AttendanceStatus } from '../types/roster'
import type { ScheduleItem } from '../types/student'

/**
 * Runs the automatic GPS heartbeat for the given classes: it starts by itself
 * when a class begins and stops when it ends. Returns the latest attendance
 * status the backend reported per class and the most recent heartbeat error
 * (cleared by the next successful check-in or when no class is being tracked).
 */
export function useAttendanceHeartbeat(classes: readonly ScheduleItem[]) {
  const [statuses, setStatuses] = useState<Record<string, AttendanceStatus>>({})
  const [error, setError] = useState<Error | null>(null)
  const managerRef = useRef<HeartbeatManager | null>(null)

  useEffect(() => {
    const manager = createHeartbeatManager({
      onCheckIn: (classId, response) => {
        setStatuses((current) => ({ ...current, [classId]: response.status }))
        setError(null)
      },
      onError: (_classId, heartbeatError) => setError(heartbeatError),
      onTrackingChange: (trackedClassIds) => {
        if (trackedClassIds.length === 0) setError(null)
      },
    })

    managerRef.current = manager
    manager.start()

    return () => {
      manager.stop()
      managerRef.current = null
    }
  }, [])

  useEffect(() => {
    managerRef.current?.setClasses(classes)
  }, [classes])

  return { statuses, error }
}
