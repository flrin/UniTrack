import type { AttendanceStatus } from './roster'

export type StudentConfig = {
  group: string
  optionals: string[]
}

export type ScheduleItem = {
  class_id: string
  subject: string
  time: string
  building_name: string
  target_lat: number
  target_lng: number
  /**
   * ISO 8601 UTC timestamps from ClassSession. The `GET /api/student/schedule`
   * contract currently only returns the display string in `time`, so the
   * backend must also return these two fields for the heartbeat to know when a
   * class starts and ends.
   */
  start_time: string
  end_time: string
  status: AttendanceStatus
}

/** Payload of `POST /api/student/checkin` (fired every 60s during a class). */
export type CheckInPayload = {
  class_id: string
  user_lat: number
  user_lng: number
}

/** Response of `POST /api/student/checkin`. */
export type CheckInResponse = {
  status: AttendanceStatus
  distance_meters: number
}
