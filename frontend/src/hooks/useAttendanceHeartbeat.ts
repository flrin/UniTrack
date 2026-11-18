import { useEffect, useRef, useState } from 'react'
import { getCurrentPosition, type GeoPoint } from '../services/geolocationService'
import { createHeartbeatManager } from '../services/heartbeatService'
import type { HeartbeatManager } from '../services/heartbeatService'
import type { AttendanceStatus } from '../types/roster'
import type { CheckInPayload, CheckInResponse, ScheduleItem } from '../types/student'

export type LastCheckInInfo = {
  classId: string
  payload: CheckInPayload
  response: CheckInResponse
  timestamp: number
}

export type UseAttendanceHeartbeatOptions = {
  /** Optional manual location sent to the backend instead of device GPS. */
  locationOverride?: GeoPoint | null
}

function overrideKey(point: GeoPoint | null): string {
  return point ? `${point.lat},${point.lng}` : 'gps'
}

/**
 * Runs the automatic GPS heartbeat for the given classes: it starts by itself
 * when a class begins and stops when it ends. Returns the latest attendance
 * status the backend reported per class, the effective location (manual
 * override or latest successful GPS fix), the latest backend check-in results,
 * and the most recent heartbeat error.
 */
export function useAttendanceHeartbeat(
  classes: readonly ScheduleItem[],
  options: UseAttendanceHeartbeatOptions = {},
) {
  const locationOverride = options.locationOverride ?? null
  const [statuses, setStatuses] = useState<Record<string, AttendanceStatus>>({})
  const [lastCheckIns, setLastCheckIns] = useState<Record<string, LastCheckInInfo>>({})
  const [gpsLocation, setGpsLocation] = useState<GeoPoint | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const managerRef = useRef<HeartbeatManager | null>(null)
  const locationOverrideRef = useRef<GeoPoint | null>(locationOverride)
  const prevOverrideKeyRef = useRef<string>(overrideKey(locationOverride))

  useEffect(() => {
    const manager = createHeartbeatManager({
      getPosition: () => {
        const override = locationOverrideRef.current
        return override ? Promise.resolve(override) : getCurrentPosition()
      },
      onLocation: (position) => {
        if (locationOverrideRef.current === null) {
          setGpsLocation(position)
        }
      },
      onCheckIn: (classId, response, payload) => {
        setStatuses((current) => ({ ...current, [classId]: response.status }))
        setLastCheckIns((current) => ({
          ...current,
          [classId]: {
            classId,
            payload,
            response,
            timestamp: Date.now(),
          },
        }))
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

  useEffect(() => {
    locationOverrideRef.current = locationOverride
    const nextKey = overrideKey(locationOverride)
    if (prevOverrideKeyRef.current !== nextKey) {
      prevOverrideKeyRef.current = nextKey
      managerRef.current?.triggerHeartbeat()
    }
  }, [locationOverride])

  return {
    statuses,
    location: locationOverride ?? gpsLocation,
    gpsLocation,
    lastCheckIns,
    error,
  }
}
