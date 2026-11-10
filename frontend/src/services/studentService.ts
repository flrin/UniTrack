import type { ScheduleItem, StudentConfig } from '../types/student'
import {
  buildApiUrl,
  clearAuthToken,
  isAttendanceStatus,
  readErrorDetail,
  requireAuthToken,
  saveAuthToken,
} from './apiClient'

export const CONFIG_STORAGE_KEY = 'unitrack.student.config'
export const STUDENT_CONFIG_ENDPOINT = '/api/student/config'
export const STUDENT_SCHEDULE_ENDPOINT = '/api/student/schedule'
export const STUDENT_OPTIONALS_ENDPOINT = '/api/student/optionals'

const VALID_BASE_GROUP_PATTERN = /^(?:[1-9]|10|1[3-6])[1-4]\d$/

export function isValidBaseGroup(baseGroup: string): boolean {
  return VALID_BASE_GROUP_PATTERN.test(baseGroup.trim())
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !Number.isNaN(Date.parse(value))
}

function isOptionalString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === 'string'
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function parseScheduleItem(raw: unknown, index: number): ScheduleItem {
  if (!isRecord(raw)) {
    throw new Error(`Malformed schedule response: item ${index} is not an object.`)
  }

  const {
    class_id,
    subject,
    time,
    building_name,
    room,
    class_type,
    target_lat,
    target_lng,
    start_time,
    end_time,
    status,
  } = raw

  if (
    typeof class_id !== 'string' ||
    class_id.trim().length === 0 ||
    typeof subject !== 'string' ||
    typeof time !== 'string' ||
    typeof building_name !== 'string' ||
    !isOptionalString(room) ||
    !isOptionalString(class_type) ||
    !isFiniteNumber(target_lat) ||
    !isFiniteNumber(target_lng) ||
    !isValidTimestamp(start_time) ||
    !isValidTimestamp(end_time) ||
    !isAttendanceStatus(status)
  ) {
    throw new Error(`Malformed schedule item at index ${index}.`)
  }

  return {
    class_id,
    subject,
    time,
    building_name,
    room: normalizeOptionalString(room),
    class_type: normalizeOptionalString(class_type),
    target_lat,
    target_lng,
    start_time,
    end_time,
    status,
  }
}

export async function saveStudentConfig(
  endpoint: string,
  config: StudentConfig,
  token?: string,
): Promise<{ message: string }> {
  const authToken = requireAuthToken(token)
  const response = await fetch(buildApiUrl(endpoint), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify(config),
  })

  if (!response.ok) {
    throw new Error(await readErrorDetail(response, 'Could not save student configuration'))
  }

  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new Error('Malformed configuration response from server.')
  }

  saveAuthToken(authToken)
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config))
  }

  const message =
    isRecord(data) && typeof data.message === 'string'
      ? data.message
      : 'Configuration saved'
  return { message }
}

export const DEFAULT_SCHEDULE_WINDOW_DAYS = 7

export function formatLocalDateParam(date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export async function getStudentSchedule(options?: {
  signal?: AbortSignal
  date?: string
  days?: number
}): Promise<ScheduleItem[]> {
  const authToken = requireAuthToken()
  const query = new URLSearchParams({
    date: options?.date ?? formatLocalDateParam(),
    days: String(options?.days ?? DEFAULT_SCHEDULE_WINDOW_DAYS),
  })
  const response = await fetch(
    buildApiUrl(`${STUDENT_SCHEDULE_ENDPOINT}?${query.toString()}`),
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
      signal: options?.signal,
    },
  )

  if (!response.ok) {
    throw new Error(await readErrorDetail(response, 'Could not load student schedule'))
  }

  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new Error('Malformed schedule response: invalid JSON.')
  }

  if (!Array.isArray(data)) {
    throw new Error('Malformed schedule response: expected a list of classes.')
  }

  return data.map((item, index) => parseScheduleItem(item, index))
}

export async function getOptionalCourses(options?: {
  group?: string
  signal?: AbortSignal
}): Promise<string[]> {
  const trimmedGroup = options?.group?.trim() ?? ''
  const path = trimmedGroup
    ? `${STUDENT_OPTIONALS_ENDPOINT}?${new URLSearchParams({ group: trimmedGroup }).toString()}`
    : STUDENT_OPTIONALS_ENDPOINT

  const response = await fetch(buildApiUrl(path), {
    method: 'GET',
    signal: options?.signal,
  })

  if (!response.ok) {
    throw new Error(await readErrorDetail(response, 'Could not load optional courses'))
  }

  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new Error('Malformed optional courses response: invalid JSON.')
  }

  if (
    !Array.isArray(data) ||
    data.some((item) => typeof item !== 'string' || item.trim().length === 0)
  ) {
    throw new Error('Malformed optional courses response: expected a list of course names.')
  }

  return data.map((course: string) => course.trim())
}

export function clearStudentConfig(): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.removeItem(CONFIG_STORAGE_KEY)
  }
  clearAuthToken()
}

export function getSavedStudentConfig(): StudentConfig | null {
  if (typeof window === 'undefined' || !window.localStorage) return null
  const savedConfig = window.localStorage.getItem(CONFIG_STORAGE_KEY)
  if (!savedConfig) return null

  try {
    const config = JSON.parse(savedConfig) as StudentConfig
    if (typeof config.group === 'string' && Array.isArray(config.optionals)) {
      return config
    }
  } catch {
    window.localStorage.removeItem(CONFIG_STORAGE_KEY)
  }

  return null
}
