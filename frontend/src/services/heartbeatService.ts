import { getActiveClasses, isClassActive, type ClassWindow } from '../utils/classTime'
import { sendCheckIn } from './checkInService'
import { getCurrentPosition, type GeoPoint } from './geolocationService'
import type { CheckInPayload, CheckInResponse } from '../types/student'

/** How often a GPS heartbeat is sent while a class is running. */
export const HEARTBEAT_INTERVAL_MS = 60_000

/** How often the clock is compared against the class windows. */
const CLOCK_CHECK_INTERVAL_MS = 1_000

export type TrackableClass = ClassWindow & { class_id: string }

export type HeartbeatManagerOptions = {
  /** Called after each successful check-in with the backend's response and payload sent. */
  onCheckIn?: (
    classId: string,
    response: CheckInResponse,
    payload: CheckInPayload,
  ) => void
  /** Called whenever a GPS fix succeeds during a tracked heartbeat. */
  onLocation?: (position: GeoPoint) => void
  /** Called when reading the GPS or sending the check-in fails. */
  onError?: (classId: string, error: Error) => void
  /** Called whenever the set of classes being tracked changes. */
  onTrackingChange?: (trackedClassIds: string[]) => void

  // Overridable so the manager can be exercised without a browser or backend.
  getPosition?: () => Promise<GeoPoint>
  sendCheckIn?: (payload: CheckInPayload) => Promise<CheckInResponse>
  now?: () => number
  heartbeatIntervalMs?: number
  clockCheckIntervalMs?: number
}

export type HeartbeatManager = {
  /** Starts watching the clock. Safe to call more than once. */
  start: () => void
  /** Stops watching and clears every heartbeat interval. */
  stop: () => void
  /** Replaces the classes to watch; takes effect immediately if started. */
  setClasses: (classes: readonly TrackableClass[]) => void
  /** Immediately sends a heartbeat for active tracked classes, superseding any in-flight beat. */
  triggerHeartbeat: () => void
}

type TrackedClass = {
  intervalId: ReturnType<typeof setInterval>
  inFlight: boolean
  epoch: number
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

/**
 * Starts a 60-second GPS heartbeat for each class while it is running and
 * clears that class's interval the moment it ends. There is no user action:
 * a single one-second clock check compares `now` against every class's
 * start/end time, so it keeps working however far away the next class is.
 */
export function createHeartbeatManager(
  options: HeartbeatManagerOptions = {},
): HeartbeatManager {
  const {
    onCheckIn,
    onLocation,
    onError,
    onTrackingChange,
    getPosition = getCurrentPosition,
    sendCheckIn: send = sendCheckIn,
    now = Date.now,
    heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS,
    clockCheckIntervalMs = CLOCK_CHECK_INTERVAL_MS,
  } = options

  let classes: readonly TrackableClass[] = []
  let watcherId: ReturnType<typeof setInterval> | undefined
  const tracking = new Map<string, TrackedClass>()

  const notifyTrackingChange = () => onTrackingChange?.([...tracking.keys()])

  function stopTracking(classId: string) {
    const tracked = tracking.get(classId)
    if (!tracked) return

    clearInterval(tracked.intervalId)
    tracking.delete(classId)
    notifyTrackingChange()
  }

  async function heartbeat(classId: string, tracked: TrackedClass, force = false) {
    // Skip scheduled ticks while still waiting on the previous GPS fix or request.
    if (!force && tracked.inFlight) return

    // Timers can fire late (throttled tabs), so re-check the window first.
    const item = classes.find((candidate) => candidate.class_id === classId)
    if (!item || !isClassActive(item, now())) {
      stopTracking(classId)
      return
    }

    const beatEpoch = ++tracked.epoch
    const isCurrentBeat = () =>
      tracking.get(classId) === tracked && tracked.epoch === beatEpoch
    tracked.inFlight = true

    try {
      const position = await getPosition()
      // The class may have ended or a newer forced beat superseded this one.
      if (!isCurrentBeat()) return
      onLocation?.(position)

      const payload: CheckInPayload = {
        class_id: classId,
        user_lat: position.lat,
        user_lng: position.lng,
      }
      const response = await send(payload)
      if (isCurrentBeat()) onCheckIn?.(classId, response, payload)
    } catch (error) {
      if (isCurrentBeat()) onError?.(classId, toError(error))
    } finally {
      if (tracked.epoch === beatEpoch) tracked.inFlight = false
    }
  }

  function startTracking(classId: string) {
    const tracked: TrackedClass = {
      intervalId: setInterval(() => {
        void heartbeat(classId, tracked)
      }, heartbeatIntervalMs),
      inFlight: false,
      epoch: 0,
    }

    tracking.set(classId, tracked)
    notifyTrackingChange()
    // Check in right away instead of waiting a full minute for the first beat.
    void heartbeat(classId, tracked)
  }

  function syncWithClock() {
    const activeIds = new Set(
      getActiveClasses(classes, now()).map((item) => item.class_id),
    )

    for (const classId of [...tracking.keys()]) {
      if (!activeIds.has(classId)) stopTracking(classId)
    }
    for (const classId of activeIds) {
      if (!tracking.has(classId)) startTracking(classId)
    }
  }

  return {
    start() {
      if (watcherId !== undefined) return
      watcherId = setInterval(syncWithClock, clockCheckIntervalMs)
      syncWithClock()
    },

    stop() {
      if (watcherId !== undefined) {
        clearInterval(watcherId)
        watcherId = undefined
      }
      for (const classId of [...tracking.keys()]) stopTracking(classId)
    },

    setClasses(nextClasses) {
      classes = nextClasses
      if (watcherId !== undefined) syncWithClock()
    },

    triggerHeartbeat() {
      if (watcherId === undefined) return
      const previouslyTracked = [...tracking.keys()]
      syncWithClock()

      for (const classId of previouslyTracked) {
        const tracked = tracking.get(classId)
        if (!tracked) continue
        clearInterval(tracked.intervalId)
        tracked.intervalId = setInterval(() => {
          void heartbeat(classId, tracked)
        }, heartbeatIntervalMs)
        void heartbeat(classId, tracked, true)
      }
    },
  }
}
