import type { ScheduleItem } from '../types/student'

const MINUTE_MS = 60_000

// Same format as the backend's `time` field, e.g. "10:00 AM - 12:00 PM".
function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function mockClass(
  now: number,
  startOffsetMin: number,
  endOffsetMin: number,
  fields: Pick<
    ScheduleItem,
    'class_id' | 'subject' | 'building_name' | 'room' | 'class_type' | 'status'
  >,
): ScheduleItem {
  const start = now + startOffsetMin * MINUTE_MS
  const end = now + endOffsetMin * MINUTE_MS

  return {
    ...fields,
    time: `${formatTime(start)} - ${formatTime(end)}`,
    target_lat: 46.5743,
    target_lng: 23.7841,
    start_time: new Date(start).toISOString(),
    end_time: new Date(end).toISOString(),
  }
}

/**
 * Dummy `GET /api/student/schedule` response with three classes. The times
 * are relative to `now` so that, whenever the app is opened, one class has
 * already ended, one is running and one is still ahead. (Opened within about
 * two hours of midnight, some of them fall on another day and are hidden.)
 */
export function createMockSchedule(now: number = Date.now()): ScheduleItem[] {
  return [
    mockClass(now, -150, -30, {
      class_id: 'mock-class-1',
      subject: 'Interactiunea om-calculator',
      building_name: 'Univ Dimitrie Cantemir, etaj 5',
      room: 'DC508',
      class_type: 'Laborator',
      status: 'Pending',
    }),
    mockClass(now, -5, 55, {
      class_id: 'mock-class-2',
      subject: 'Cloud Computing',
      building_name: 'Univ Dimitrie Cantemir, etaj 5',
      room: 'DC507',
      class_type: 'Curs',
      status: 'Pending',
    }),
    mockClass(now, 120, 240, {
      class_id: 'mock-class-3',
      subject: 'Machine Learning',
      building_name: 'FSEGA, etaj 2',
      room: 'L402',
      class_type: 'Seminar',
      status: 'Pending',
    }),
  ]
}
